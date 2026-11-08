// Implements Mozilla web-ext's getRoot/addonsActor/installTemporaryAddon flow
// over its documented length-prefixed Remote Debugging Protocol. Requires an
// already-enabled USB debugger; never changes Firefox prefs or stops its app.
const serial = Deno.args[0];
const inspect = Deno.args.includes("--inspect");
if (!serial || !/^[a-zA-Z0-9._:-]+$/u.test(serial)) {
  throw new Error("Pass the explicitly approved ADB device serial");
}
const project = new URL("../../", import.meta.url);
const candidateArgument = Deno.args.find((arg) =>
  arg.startsWith("--candidate=")
)?.slice("--candidate=".length);
const candidate = candidateArgument
  ? new URL(
    `${candidateArgument.replace(/\/$/u, "")}/`,
    `file://${Deno.cwd()}/`,
  )
  : new URL("Local/firefox-android/candidate/", project);
if (!candidate.href.startsWith(new URL("Local/", project).href)) {
  throw new Error("Candidate must stay in project Local");
}
const report = JSON.parse(
  await Deno.readTextFile(new URL("build-report.json", candidate)),
);
const text = new TextDecoder();
const encoder = new TextEncoder();
async function adb(...args: string[]) {
  const result = await new Deno.Command("adb", {
    args: ["-s", serial, ...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) throw new Error(text.decode(result.stderr));
  return text.decode(result.stdout).trim();
}
const sockets = await adb("shell", "cat", "/proc/net/unix");
const socket = "org.mozilla.firefox/firefox-debugger-socket";
if (!sockets.includes(`@${socket}`)) {
  throw new Error(
    "Approved existing Firefox USB debugger is unavailable; no settings changed",
  );
}
const port = Number(await adb("forward", "tcp:0", `localabstract:${socket}`));
if (!Number.isInteger(port) || port <= 0) {
  throw new Error("ADB did not allocate a forward port");
}
const installed: unknown[] = [];
let conn: Deno.TcpConn | undefined;
try {
  conn = await Deno.connect({ hostname: "127.0.0.1", port });
  let pending = new Uint8Array(0);
  const packet = async (): Promise<Record<string, unknown>> => {
    const deadline = setTimeout(() => {
      try {
        conn?.close();
      } catch { /* Already closed. */ }
    }, 20000);
    try {
      while (true) {
        const colon = pending.indexOf(58);
        if (colon >= 0) {
          const prefix = text.decode(pending.subarray(0, colon));
          if (!/^\d{1,8}$/u.test(prefix)) {
            throw new Error("Invalid RDP frame prefix");
          }
          const length = Number(prefix);
          if (length > 8 * 1024 * 1024) {
            throw new Error("RDP packet exceeds bound");
          }
          if (pending.length >= colon + 1 + length) {
            const result = JSON.parse(
              text.decode(pending.subarray(colon + 1, colon + 1 + length)),
            );
            pending = pending.slice(colon + 1 + length);
            return result;
          }
        }
        const buffer = new Uint8Array(65536);
        const length = await conn!.read(buffer);
        if (length === null) {
          throw new Error("Firefox closed the debugger connection");
        }
        const next = new Uint8Array(pending.length + length);
        next.set(pending);
        next.set(buffer.subarray(0, length), pending.length);
        pending = next;
      }
    } finally {
      clearTimeout(deadline);
    }
  };
  const request = async (
    to: string,
    type: string,
    args: Record<string, unknown> = {},
  ) => {
    const body = encoder.encode(JSON.stringify({ to, type, ...args }));
    const prefix = encoder.encode(`${body.length}:`);
    const bytes = new Uint8Array(prefix.length + body.length);
    bytes.set(prefix);
    bytes.set(body, prefix.length);
    let sent = 0;
    while (sent < bytes.length) sent += await conn!.write(bytes.subarray(sent));
    console.error(`RDP request ${type}`);
    for (let count = 0; count < 64; count++) {
      const response = await packet();
      console.error(
        `RDP response ${type}: ${String(response.from)} ${
          String(response.type ?? "reply")
        }`,
      );
      if (response.from !== to || response.type === "addonListChanged") {
        continue;
      }
      if (response.error) {
        throw new Error(
          `Firefox ${type}: ${String(response.error)} ${
            String(response.message ?? "")
          }`,
        );
      }
      return response;
    }
    throw new Error("Debugger response did not match request");
  };
  const greeting = await packet();
  if (greeting.from !== "root") throw new Error("Unexpected debugger greeting");
  const root = await request("root", "getRoot");
  if (typeof root.addonsActor !== "string") {
    throw new Error("Temporary add-on installation is unsupported");
  }
  const before = await request("root", "listAddons");
  const remoteDir =
    `/data/local/tmp/delete_after_use_prometheus_firefox_${Date.now()}`;
  if (!inspect) await adb("shell", "mkdir", "-p", remoteDir);
  for (const product of inspect ? [] : report.products) {
    if (
      !product.xpi.startsWith(candidate.pathname) || product.signed !== false
    ) {
      throw new Error("Unexpected candidate path/state");
    }
    const bytes = await Deno.readFile(product.xpi);
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    ]
      .map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (hash !== product.xpi_sha256) {
      throw new Error("Candidate bytes changed after build");
    }
    const remoteFile = `${remoteDir}/${product.product}.xpi`;
    await adb("push", product.xpi, remoteFile);
    const response = await request(root.addonsActor, "installTemporaryAddon", {
      addonPath: remoteFile,
      openDevTools: false,
    });
    const addon = response.addon as { id?: string } | undefined;
    if (addon?.id !== product.id) {
      throw new Error("Installed add-on ID mismatch");
    }
    installed.push({
      product: product.product,
      id: product.id,
      source_version: product.version,
      xpi_sha256: hash,
      response,
      temporary: true,
      signed: false,
      durable: false,
    });
  }
  const readback = await request("root", "listAddons");
  const evidence = {
    observed_at: new Date().toISOString(),
    serial,
    temporary: true,
    durable: false,
    debug_setting_changed: false,
    installed,
    inspect_only: inspect,
    before,
    readback,
  };
  await Deno.writeTextFile(
    new URL(
      inspect ? "temporary-inspect.json" : "temporary-install.json",
      candidate,
    ),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  try {
    conn?.close();
  } catch { /* Timeout already closed it. */ }
  await adb("forward", "--remove", `tcp:${port}`);
}
