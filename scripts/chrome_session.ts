// Minimal Chrome DevTools Protocol session for isolated extension checks.
// Deno-only: uses Deno.Command, fetch and WebSocket. No npm packages.

// Branded Google Chrome 137+ refuses --load-extension, so the check needs a
// Chromium-family binary that still honors it: Chrome for Testing, Chromium,
// or Playwright's bundled Chromium.
function chromiumCandidates(): string[] {
  const home = Deno.env.get("HOME") ?? "";
  const candidates: string[] = [];
  const override = Deno.env.get("EXTENSION_CHECK_CHROME");
  if (override) candidates.push(override);
  const appPaths = [
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    `${home}/Applications/Chromium.app/Contents/MacOS/Chromium`,
    `${home}/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  ];
  candidates.push(...appPaths);
  const playwright = `${home}/Library/Caches/ms-playwright`;
  try {
    for (const entry of Deno.readDirSync(playwright)) {
      if (entry.isDirectory && entry.name.startsWith("chromium-")) {
        candidates.push(
          `${playwright}/${entry.name}/chrome-mac/Chromium.app/Contents/MacOS/Chromium`,
        );
      }
    }
  } catch {
    // No Playwright cache on this machine.
  }
  return candidates.reverse();
}

export function findChrome(): string {
  for (const candidate of chromiumCandidates()) {
    try {
      Deno.statSync(candidate);
      return candidate;
    } catch {
      // Try the next known location.
    }
  }
  throw new Error(
    "No Chromium binary that accepts --load-extension was found. " +
      "Install Chrome for Testing or set EXTENSION_CHECK_CHROME.",
  );
}

// Chrome derives a keyed extension ID from SHA-256 of its decoded DER public
// key. An unkeyed unpacked extension instead uses its absolute path. In both
// cases the first 16 digest bytes map each nibble onto a-p.
export async function extensionIdForDirectory(
  directory: URL,
): Promise<string> {
  const path = Deno.realPathSync(
    decodeURIComponent(directory.pathname).replace(/\/$/, ""),
  );
  const manifest = JSON.parse(
    await Deno.readTextFile(`${path}/manifest.json`),
  );
  let identity: Uint8Array<ArrayBuffer>;
  if (manifest.key === undefined) {
    identity = new TextEncoder().encode(path);
  } else if (typeof manifest.key === "string" && manifest.key.length > 0) {
    identity = Uint8Array.from(
      atob(manifest.key),
      (character) => character.charCodeAt(0),
    );
  } else {
    throw new Error("Extension manifest key must be a base64 DER public key");
  }
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", identity),
  );
  return [...hash.slice(0, 16)].map((byte) =>
    String.fromCharCode(97 + (byte >> 4)) +
    String.fromCharCode(97 + (byte & 15))
  ).join("");
}

// Target handles are opaque and valid only while their owned browser socket is
// alive. They cannot be converted into arbitrary local DevTools connections.
const targetHandles = new Map<
  string,
  { browser: OwnedBrowser; targetId: string }
>();

class OwnedBrowser {
  readonly socket: WebSocket;
  #nextId = 1;
  #closed = false;
  #pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  #handlers = new Map<
    string,
    (message: { method?: string; params?: unknown }) => void
  >();
  #handles = new Map<string, string>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.onmessage = (event) => {
      let message: {
        id?: number;
        sessionId?: string;
        method?: string;
        params?: unknown;
        result?: unknown;
        error?: unknown;
      };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        this.invalidate();
        return;
      }
      if (typeof message.id === "number") {
        const pending = this.#pending.get(message.id);
        if (!pending) return;
        this.#pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) {
          pending.reject(new Error(JSON.stringify(message.error)));
        } else pending.resolve(message.result);
      } else if (message.sessionId) {
        this.#handlers.get(message.sessionId)?.(message);
      }
    };
    socket.onclose = () => this.invalidate();
    socket.onerror = () => this.invalidate();
  }

  static async connect(url: string): Promise<OwnedBrowser> {
    const socket = new WebSocket(url);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Owned Chromium connection timed out")),
          2000,
        );
        socket.onopen = () => {
          clearTimeout(timer);
          resolve();
        };
        socket.onerror = () => {
          clearTimeout(timer);
          reject(new Error("Owned Chromium connection failed"));
        };
        socket.onclose = () => {
          clearTimeout(timer);
          reject(new Error("Owned Chromium connection closed"));
        };
      });
      return new OwnedBrowser(socket);
    } catch (error) {
      socket.close();
      throw error;
    }
  }

  get closed(): boolean {
    return this.#closed;
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<unknown> {
    if (this.#closed || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Owned Chromium connection is closed"));
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.#pending.delete(id)) {
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 15_000);
      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(
          JSON.stringify({
            id,
            method,
            params,
            ...(sessionId ? { sessionId } : {}),
          }),
        );
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  handle(targetId: string): string {
    if (this.#closed) throw new Error("Owned Chromium connection is closed");
    let handle = this.#handles.get(targetId);
    if (!handle) {
      handle = `cdp-owned:${crypto.randomUUID()}`;
      this.#handles.set(targetId, handle);
      targetHandles.set(handle, { browser: this, targetId });
    }
    return handle;
  }

  listen(
    sessionId: string,
    handler: (message: { method?: string; params?: unknown }) => void,
  ) {
    this.#handlers.set(sessionId, handler);
  }

  unlisten(sessionId: string) {
    this.#handlers.delete(sessionId);
  }

  invalidate() {
    if (this.#closed) return;
    this.#closed = true;
    for (const handle of this.#handles.values()) targetHandles.delete(handle);
    this.#handles.clear();
    this.#handlers.clear();
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Owned Chromium connection closed"));
    }
    this.#pending.clear();
  }

  close() {
    this.invalidate();
    this.socket.close();
  }
}

export class CdpClient {
  onEvent?: (message: { method?: string; params?: unknown }) => void;
  #browser: OwnedBrowser;
  #sessionId: string;
  #closed = false;

  private constructor(browser: OwnedBrowser, sessionId: string) {
    this.#browser = browser;
    this.#sessionId = sessionId;
    browser.listen(sessionId, (message) => this.onEvent?.(message));
  }

  static async connect(handle: string): Promise<CdpClient> {
    const target = targetHandles.get(handle);
    if (!target || target.browser.closed) {
      throw new Error("Target is not owned by an active Chromium session");
    }
    const result = await target.browser.send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    }) as { sessionId?: unknown };
    if (typeof result?.sessionId !== "string" || !result.sessionId) {
      throw new Error("Target attachment failed");
    }
    if (target.browser.closed || targetHandles.get(handle) !== target) {
      throw new Error("Owned Chromium connection closed during attachment");
    }
    return new CdpClient(target.browser, result.sessionId);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (this.#closed) {
      return Promise.reject(new Error("CDP target client is closed"));
    }
    return this.#browser.send(method, params, this.#sessionId);
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#browser.unlisten(this.#sessionId);
    void this.#browser.send("Target.detachFromTarget", {
      sessionId: this.#sessionId,
    }).catch(() => {});
  }
}

export interface TargetInfo {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

async function exitedWithin(process: Deno.ChildProcess, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      process.status.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// A profile capability is created by this helper and cannot wrap an existing
// user profile. Callers that need restart persistence can explicitly retain it
// across sessions and dispose it once the last child has exited.
const ownedProfiles = new WeakMap<
  OwnedChromeProfile,
  {
    inUse: boolean;
    disposed: boolean;
    disposing: boolean;
    dev: number;
    ino: number;
  }
>();
const profileFactoryToken = Symbol("owned-profile-factory");

async function verifyOwnedProfile(profile: OwnedChromeProfile): Promise<void> {
  const state = ownedProfiles.get(profile);
  if (!state) throw new Error("Owned Chromium profile is unavailable");
  const info = await Deno.lstat(profile.path);
  if (
    !info.isDirectory || info.isSymlink || info.dev !== state.dev ||
    info.ino !== state.ino
  ) {
    throw new Error(
      "Owned Chromium profile identity changed; no files were removed",
    );
  }
}

export class OwnedChromeProfile {
  readonly path: string;

  private constructor(token: symbol, path: string, dev: number, ino: number) {
    if (token !== profileFactoryToken) {
      throw new Error("Owned Chromium profiles must be created by the helper");
    }
    this.path = path;
    ownedProfiles.set(this, {
      inUse: false,
      disposed: false,
      disposing: false,
      dev,
      ino,
    });
    Object.freeze(this);
  }

  static async create(
    options: { dir?: string } = {},
  ): Promise<OwnedChromeProfile> {
    const path = await Deno.makeTempDir({
      dir: options.dir,
      prefix: "extension-check-",
    });
    const info = await Deno.lstat(path);
    if (
      !info.isDirectory || info.isSymlink || typeof info.dev !== "number" ||
      typeof info.ino !== "number"
    ) {
      throw new Error(
        "Cannot verify the new disposable Chromium profile; it was retained for diagnosis",
      );
    }
    return new OwnedChromeProfile(
      profileFactoryToken,
      path,
      info.dev,
      info.ino,
    );
  }

  async dispose(): Promise<void> {
    const state = ownedProfiles.get(this);
    if (!state || state.disposed || state.disposing) {
      throw new Error("Owned Chromium profile is already disposed");
    }
    if (state.inUse) throw new Error("Owned Chromium profile is still in use");
    state.disposing = true;
    try {
      await verifyOwnedProfile(this);
      await Deno.remove(this.path, { recursive: true });
      state.disposed = true;
    } finally {
      state.disposing = false;
    }
  }
}

async function stopChromium(
  process: Deno.ChildProcess,
  browser?: OwnedBrowser,
) {
  if (await exitedWithin(process, 20)) {
    browser?.close();
    return true;
  }
  if (browser && !browser.closed) {
    // This command travels only on the already established owned socket. It
    // never rediscovers an endpoint after a process exit or port reuse.
    void browser.send("Browser.close").catch(() => {});
    if (await exitedWithin(process, 4000)) {
      browser.close();
      return true;
    }
  }
  browser?.close();
  try {
    process.kill("SIGTERM");
  } catch { /* Already exited. */ }
  return await exitedWithin(process, 4000);
}

function targetInfo(
  browser: OwnedBrowser,
  info: { targetId?: unknown; type?: unknown; title?: unknown; url?: unknown },
): TargetInfo {
  if (
    typeof info.targetId !== "string" || !info.targetId ||
    typeof info.type !== "string" ||
    typeof info.title !== "string" || typeof info.url !== "string"
  ) throw new Error("Invalid owned target information");
  return {
    id: info.targetId,
    type: info.type,
    title: info.title,
    url: info.url,
    webSocketDebuggerUrl: browser.handle(info.targetId),
  };
}

export class ChromeSession {
  #process: Deno.ChildProcess;
  #profile: OwnedChromeProfile;
  #autoDispose: boolean;
  #browser: OwnedBrowser;
  #extensionDir: string;
  #closing?: Promise<void>;

  private constructor(
    process: Deno.ChildProcess,
    profile: OwnedChromeProfile,
    autoDispose: boolean,
    browser: OwnedBrowser,
    extensionDir: string,
  ) {
    this.#process = process;
    this.#profile = profile;
    this.#autoDispose = autoDispose;
    this.#browser = browser;
    this.#extensionDir = extensionDir;
  }

  static async launch(
    extensionDir: URL,
    _legacyPort = 9223,
    extraArgs: string[] = [],
    retainedProfile?: OwnedChromeProfile,
  ): Promise<ChromeSession> {
    // The legacy number is retained for existing callers, but no fixed port is
    // used. Chromium selects an unoccupied port for a fresh disposable profile.
    if (
      extraArgs.some((arg) =>
        /^--(?:remote-debugging-port|remote-debugging-pipe|remote-debugging-address|user-data-dir)(?:=|$)/
          .test(arg)
      )
    ) {
      throw new Error(
        "Chrome check cannot override its owned debugger or profile",
      );
    }
    if (
      Deno.build.os === "darwin" && Deno.env.get("CODEX_SANDBOX") === "seatbelt"
    ) {
      throw new Error(
        "Isolated Chromium is blocked in the macOS sandbox because it can abort at startup and show a crash dialog. Run this check outside the sandbox; no browser was launched.",
      );
    }
    const profile = retainedProfile ?? await OwnedChromeProfile.create();
    const profileState = ownedProfiles.get(profile);
    if (
      !profileState || profileState.disposed || profileState.disposing ||
      profileState.inUse
    ) {
      throw new Error("Owned Chromium profile is unavailable");
    }
    profileState.inUse = true;
    let process: Deno.ChildProcess | undefined;
    let browser: OwnedBrowser | undefined;
    try {
      const path = decodeURIComponent(extensionDir.pathname).replace(/\/$/, "");
      await verifyOwnedProfile(profile);
      // On restart, Chromium may leave its previous port announcement behind.
      // This path belongs to the explicitly owned disposable profile only.
      try {
        await Deno.remove(`${profile.path}/DevToolsActivePort`);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      process = new Deno.Command(findChrome(), {
        args: [
          "--headless=new",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-gpu",
          "--disable-features=Translate,DisableLoadExtensionCommandLineSwitch",
          `--user-data-dir=${profile.path}`,
          `--load-extension=${path}`,
          `--disable-extensions-except=${path}`,
          "--remote-debugging-port=0",
          ...extraArgs,
          "about:blank",
        ],
        stdout: "null",
        stderr: "null",
      }).spawn();
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (await exitedWithin(process, 0)) {
          throw new Error("Owned Chromium exited before debugger readiness");
        }
        let active: string | undefined;
        try {
          active = await Deno.readTextFile(
            `${profile.path}/DevToolsActivePort`,
          );
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
        if (active !== undefined) {
          const lines = active.trimEnd().split("\n");
          const port = Number(lines[0]);
          // Chromium writes a random UUID browser path to this file. Wait for
          // a valid prefix to become complete; never connect to a partial path.
          const prefix = "/devtools/browser/";
          const shape = "hhhhhhhh-hhhh-hhhh-hhhh-hhhhhhhhhhhh";
          const text = lines[1] ?? "";
          const token = text.startsWith(prefix)
            ? text.slice(prefix.length)
            : "";
          const validPrefix = token.length <= shape.length &&
            [...token].every((ch, i) =>
              shape[i] === "-" ? ch === "-" : /^[0-9a-f]$/i.test(ch)
            );
          const partialPath = lines.length === 2 &&
            (prefix.startsWith(text) ||
              (text.startsWith(prefix) && validPrefix &&
                token.length < shape.length));
          if (
            (lines.length === 1 && /^\d{0,5}$/.test(lines[0])) || partialPath
          ) {
            await new Promise((resolve) => setTimeout(resolve, 200));
            continue;
          }
          if (
            lines.length !== 2 || !/^\d+$/.test(lines[0]) || port < 1 ||
            port > 65535 ||
            !text.startsWith(prefix) || !validPrefix ||
            token.length !== shape.length
          ) throw new Error("Invalid owned Chromium debugger announcement");
          if (await exitedWithin(process, 0)) {
            throw new Error("Owned Chromium exited before debugger connection");
          }
          browser = await OwnedBrowser.connect(
            `ws://127.0.0.1:${port}${lines[1]}`,
          );
          if (await exitedWithin(process, 0) || browser.closed) {
            throw new Error("Owned Chromium exited during debugger connection");
          }
          return new ChromeSession(
            process,
            profile,
            !retainedProfile,
            browser,
            path,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error(
        "Chrome did not announce its owned DevTools endpoint in time.",
      );
    } catch (error) {
      if (!process || await stopChromium(process, browser)) {
        profileState.inUse = false;
        if (!retainedProfile) await profile.dispose().catch(() => {});
      } else {
        throw new Error(
          "Chromium did not exit cleanly; its temporary profile was retained for diagnosis.",
          { cause: error },
        );
      }
      throw error;
    }
  }

  async targets(): Promise<TargetInfo[]> {
    const result = await this.#browser.send("Target.getTargets") as {
      targetInfos?: unknown;
    };
    if (!Array.isArray(result?.targetInfos)) {
      throw new Error("Invalid owned target list");
    }
    return result.targetInfos.map((info) => targetInfo(this.#browser, info));
  }

  async extensionId(): Promise<string> {
    return await extensionIdForDirectory(
      new URL(`file://${this.#extensionDir}/`),
    );
  }

  async openUrl(url: string): Promise<TargetInfo> {
    const result = await this.#browser.send("Target.createTarget", { url }) as {
      targetId?: unknown;
    };
    if (typeof result?.targetId !== "string" || !result.targetId) {
      throw new Error("Could not create owned target");
    }
    const details = await this.#browser.send("Target.getTargetInfo", {
      targetId: result.targetId,
    }) as { targetInfo?: unknown };
    if (!details?.targetInfo || typeof details.targetInfo !== "object") {
      throw new Error("No owned target information");
    }
    return targetInfo(this.#browser, details.targetInfo);
  }

  async openExtensionPage(
    extensionId: string,
    file: string,
  ): Promise<TargetInfo> {
    return await this.openUrl(`chrome-extension://${extensionId}/${file}`);
  }

  async evaluate<T>(target: TargetInfo, expression: string): Promise<T> {
    if (!target.webSocketDebuggerUrl) throw new Error("Target is not devtools");
    const client = await CdpClient.connect(target.webSocketDebuggerUrl);
    try {
      const result = await client.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      }) as {
        result?: { value?: T };
        exceptionDetails?: {
          text?: string;
          exception?: { description: string };
        };
      };
      if (result.exceptionDetails) {
        throw new Error(
          result.exceptionDetails.exception?.description ??
            result.exceptionDetails.text ?? "Evaluation failed",
        );
      }
      return result.result?.value as T;
    } finally {
      client.close();
    }
  }

  async close() {
    if (this.#closing) return await this.#closing;
    this.#closing = (async () => {
      const stopped = await stopChromium(this.#process, this.#browser);
      if (!stopped) {
        throw new Error(
          "Disposable Chromium did not exit after Browser.close and SIGTERM; its temporary profile was retained.",
        );
      }
      const state = ownedProfiles.get(this.#profile);
      if (!state) throw new Error("Owned Chromium profile is unavailable");
      state.inUse = false;
      if (this.#autoDispose) {
        try {
          await this.#profile.dispose();
        } catch { /* Best effort; profile is disposable. */ }
      }
    })();
    try {
      await this.#closing;
    } catch (error) {
      this.#closing = undefined;
      throw error;
    }
  }
}
