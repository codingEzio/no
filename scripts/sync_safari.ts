import { checkBrowserFontPackage } from "./calmly_package_guard.ts";

const ROOT = new URL("../", import.meta.url);

type SafariBuild = {
  id: string;
  sourceRoot: string;
  webRoot: string;
  hostRoot: string;
  appName: string;
  installApp: string;
  hostBundleId: string;
  extensionBundleId: string;
  handler: "default" | "atlaskit";
};

type Registry = { safariBuilds: SafariBuild[] };

function pathOf(relative: string): URL {
  return new URL(
    relative.replace(/^\/+/, "") + (relative.endsWith("/") ? "" : "/"),
    ROOT,
  );
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length &&
    left.every((byte, index) => byte === right[index]);
}

async function collect(
  directory: URL,
  prefix = "",
): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for await (const entry of Deno.readDir(directory)) {
    if (entry.name === ".DS_Store" || entry.name === ".gitkeep") continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const url = new URL(entry.name + (entry.isDirectory ? "/" : ""), directory);
    if (entry.isSymlink) {
      throw new Error(`Safari sync refuses symlink: ${url.pathname}`);
    }
    if (entry.isDirectory) {
      for (const [path, bytes] of await collect(url, relative)) {
        files.set(path, bytes);
      }
    } else if (entry.isFile) {
      files.set(relative, await Deno.readFile(url));
    }
  }
  return files;
}

type Manifest = {
  key?: string;
  permissions?: string[];
  host_permissions?: string[];
  background?: { type?: string; service_worker?: string };
  options_ui?: { open_in_tab?: boolean };
  content_scripts?: {
    css?: string[];
    js?: string[];
  }[];
};

function safariManifest(build: SafariBuild, source: Uint8Array): Uint8Array {
  const manifest = JSON.parse(new TextDecoder().decode(source)) as {
    key?: string;
    externally_connectable?: unknown;
    permissions?: string[];
    host_permissions?: string[];
    optional_host_permissions?: string[];
    background?: { type?: string; service_worker?: string };
    options_ui?: { open_in_tab?: boolean };
    content_scripts?: {
      css?: string[];
      js?: string[];
    }[];
  };
  const moduleWorker = manifest.background?.type === "module";
  if (build.id === "x-collector") {
    // The autonomous launcher is for the owner's current Chrome profile only.
    // Safari keeps the shared manual collector without a new loopback grant.
    delete manifest.externally_connectable;
    manifest.host_permissions = manifest.host_permissions?.filter((origin) =>
      origin !== "http://127.0.0.1:15013/*"
    );
  }
  if (manifest.background) {
    delete manifest.background.type;
    if (moduleWorker) {
      manifest.background.service_worker = "safari_background.js";
    }
  }
  if (manifest.options_ui) delete manifest.options_ui.open_in_tab;
  manifest.permissions = (manifest.permissions ?? []).filter((item) =>
    item !== "downloads"
  );
  if (build.id === "tab-merge-n-sort" || build.id === "mastermind-bookmark") {
    manifest.host_permissions = [
      ...new Set([...(manifest.host_permissions ?? []), "<all_urls>"]),
    ];
  }
  if (build.id === "atlaskit-capture") {
    delete manifest.key;
    // Safari uses its native URL/cookie bridge, not Chrome's page-image picker.
    manifest.permissions = manifest.permissions.filter((item) =>
      item !== "activeTab" && item !== "scripting"
    );
    manifest.permissions = [
      ...new Set([
        ...(manifest.permissions ?? []),
        "cookies",
        "nativeMessaging",
      ]),
    ];
    manifest.host_permissions = [
      ...new Set([...(manifest.host_permissions ?? []), "<all_urls>"]),
    ];
    manifest.background = { service_worker: "safari_background.js" };
  }
  // Safari match patterns reject explicit ports; API destinations keep theirs.
  for (
    const key of ["host_permissions", "optional_host_permissions"] as const
  ) {
    if (manifest[key]) {
      manifest[key] = [
        ...new Set(
          manifest[key].map((pattern) => pattern.replace(/:\d+(?=\/)/u, "")),
        ),
      ];
    }
  }
  if (build.id === "calmly") {
    for (const script of manifest.content_scripts ?? []) {
      script.css = (script.css ?? []).filter((file) => file !== "fonts.css");
      script.js = [
        "safari_fonts.js",
        ...(script.js ?? []).filter((file) => file !== "safari_fonts.js"),
      ];
    }
  }
  return new TextEncoder().encode(JSON.stringify(manifest, null, 2) + "\n");
}

type CalmlyFontFace = {
  family: string;
  path: string;
  style: string;
  weight: string;
  unicodeRange?: string;
};

function calmlyDeclaration(
  block: string,
  property: string,
): string | undefined {
  return block.match(new RegExp(`\\b${property}\\s*:\\s*([^;]+);`, "u"))?.[1]
    ?.trim();
}

function calmlyFontBootstrap(cssSource: Uint8Array): Uint8Array {
  const css = new TextDecoder().decode(cssSource);
  const faces: CalmlyFontFace[] = [];
  const remainingCss = css.replace(
    /@font-face\s*\{([\s\S]*?)\}\s*/gu,
    (match, block: string) => {
      const family = calmlyDeclaration(block, "font-family")?.replaceAll(
        '"',
        "",
      );
      if (!family) {
        throw new Error("calmly: an @font-face is missing its family");
      }
      const path = block.match(
        /url\("chrome-extension:\/\/__MSG_@@extension_id__\/((?:fonts|ui-fonts)\/[^"]+)"\)/u,
      )?.[1];
      if (!path) {
        const src = calmlyDeclaration(block, "src") ?? "";
        if (/\blocal\(/u.test(src) && !/\burl\(/u.test(src)) {
          // Local-only faces resolve from the system; keep them in the CSS
          // instead of byte-loading them through the extension runtime.
          return match;
        }
        throw new Error(
          "calmly: an @font-face is missing its family or bundled path",
        );
      }
      faces.push({
        family,
        path,
        style: calmlyDeclaration(block, "font-style") ?? "normal",
        weight: calmlyDeclaration(block, "font-weight") ?? "400",
        unicodeRange: calmlyDeclaration(block, "unicode-range"),
      });
      return "";
    },
  );
  if (faces.length === 0) {
    throw new Error("calmly: fonts.css has no bundled @font-face rules");
  }
  const source = `// Generated by scripts/sync_safari.ts. Do not edit.\n` +
    `(() => {\n"use strict";\n` +
    `  const runtime = globalThis.browser?.runtime ?? globalThis.chrome?.runtime;\n` +
    `  if (!runtime?.getURL) throw new Error("Calmly Safari runtime.getURL is unavailable");\n` +
    `  if (!document.documentElement || document.querySelector("style[data-calmly-fonts]")) return;\n` +
    `  const faces = ${JSON.stringify(faces)};\n` +
    `  const loaded = new Set();\n` +
    `  const loading = new Map();\n` +
    `  const rangeCache = new Map();\n` +
    `  function rangesFor(face) {\n` +
    `    if (!face.unicodeRange) return null;\n` +
    `    if (rangeCache.has(face.path)) return rangeCache.get(face.path);\n` +
    `    const ranges = face.unicodeRange.split(",").map((part) => {\n` +
    `      const [start, end = start] = part.trim().replace(/^U\\+/u, "").split("-");\n` +
    `      return [Number.parseInt(start, 16), Number.parseInt(end, 16)];\n` +
    `    });\n` +
    `    rangeCache.set(face.path, ranges);\n` +
    `    return ranges;\n` +
    `  }\n` +
    `  function faceMatchesText(face, text) {\n` +
    `    const ranges = rangesFor(face);\n` +
    `    if (!ranges) return true;\n` +
    `    for (const character of text) {\n` +
    `      const point = character.codePointAt(0);\n` +
    `      if (ranges.some(([start, end]) => point >= start && point <= end)) return true;\n` +
    `    }\n` +
    `    return false;\n` +
    `  }\n` +
    `  function cssFamilies() {\n` +
    `    const families = new Set();\n` +
    `    const styles = getComputedStyle(document.documentElement);\n` +
    `    for (const variable of ["--calmly-content-font", "--calmly-dense-font", "--calmly-technical-font", "--calmly-ui-font", "--calmly-emoji-font", "--ui-font", "--ui-mono", "--ui-emoji"]) {\n` +
    `      for (const part of styles.getPropertyValue(variable).split(",")) {\n` +
    `        const name = part.trim().replace(/^["']/u, "").replace(/["']$/u, "").trim();\n` +
    `        if (name && name !== "inherit" && name !== "initial") families.add(name);\n` +
    `      }\n` +
    `    }\n` +
    `    return families;\n` +
    `  }\n` +
    `  function familiesFor(font, emoji) {\n` +
    `    const families = cssFamilies();\n` +
    `    families.add("GeistMixUI_NerdAndZhAndEmoji3D");\n` +
    `    if (emoji === "noto3d") families.add("Extension Emoji3D");\n` +
    `    return families;\n` +
    `  }\n` +
    `  async function loadFace(face) {\n` +
    `    if (loaded.has(face.path)) return;\n` +
    `    if (loading.has(face.path)) return loading.get(face.path);\n` +
    `    const pending = (async () => {\n` +
    `      const response = await fetch(runtime.getURL(face.path));\n` +
    `      if (!response.ok) throw new Error(\`Calmly Safari font fetch failed: \${face.path}\`);\n` +
    `      const bytes = await response.arrayBuffer();\n` +
    `      const nativeFace = new FontFace(face.family, bytes, {\n` +
    `        style: face.style, weight: face.weight, unicodeRange: face.unicodeRange, display: "swap",\n` +
    `      });\n` +
    `      await nativeFace.load();\n` +
    `      document.fonts.add(nativeFace);\n` +
    `      loaded.add(face.path);\n` +
    `    })().finally(() => loading.delete(face.path));\n` +
    `    loading.set(face.path, pending);\n` +
    `    return pending;\n` +
    `  }\n` +
    `  function markCalmlyFonts(state) {\n` +
    `    try {\n` +
    `      document.documentElement.setAttribute("data-calmly-fonts-state", state);\n` +
    `    } catch {\n` +
    `      // Diagnostic marker only.\n` +
    `    }\n` +
    `  }\n` +
    `  function load(font, emoji) {\n` +
    `    const families = familiesFor(font, emoji);\n` +
    `    const loadMatchingFaces = () => {\n` +
    `      const text = document.body?.innerText ?? document.documentElement.innerText;\n` +
    `      const matching = faces.filter((face) => families.has(face.family) && faceMatchesText(face, text));\n` +
    `      markCalmlyFonts("loading:" + matching.length);\n` +
    `      return Promise.all(matching.map(loadFace));\n` +
    `    };\n` +
    `    const initial = loadMatchingFaces();\n` +
    `    if (document.readyState === "loading") {\n` +
    `      document.addEventListener("DOMContentLoaded", () => { void loadMatchingFaces(); }, { once: true });\n` +
    `    }\n` +
    `    return initial.then(() => markCalmlyFonts("loaded:" + loaded.size)).catch((error) => {\n` +
    `      markCalmlyFonts("error:" + String(error && error.message ? error.message : error).slice(0, 120));\n` +
    `      console.warn("Calmly Safari could not load a selected font", error);\n` +
    `    });\n` +
    `  }\n` +
    `  globalThis.CalmlySafariFonts = Object.freeze({ load });\n` +
    `  const style = document.createElement("style");\n` +
    `  style.dataset.calmlyFonts = "true";\n` +
    `  style.textContent = ${JSON.stringify(remainingCss)};\n` +
    `  (document.head ?? document.documentElement).append(style);\n` +
    `  markCalmlyFonts("ready");\n` +
    `})();\n`;
  return new TextEncoder().encode(source);
}

function moduleId(root: URL, url: URL): string {
  const rootPath = decodeURIComponent(root.pathname);
  const path = decodeURIComponent(url.pathname);
  if (!path.startsWith(rootPath)) {
    throw new Error(`Module leaves extension root: ${path}`);
  }
  return path.slice(rootPath.length);
}

async function bundleClassic(
  root: URL,
  entry = "background.js",
  override?: string,
): Promise<Uint8Array> {
  const modules = new Map<string, string>();
  const visiting = new Set<string>();
  const namedImport =
    /^\s*import\s*\{([\s\S]*?)\}\s*from\s*["'](.+?)["'];?\s*$/gm;

  async function visit(id: string, sourceOverride?: string) {
    if (modules.has(id)) return;
    if (visiting.has(id)) throw new Error(`Cyclic Safari worker module: ${id}`);
    visiting.add(id);
    const url = new URL(id, root);
    let source = sourceOverride ?? await Deno.readTextFile(url);
    const imports: { clause: string; specifier: string; dependency: string }[] =
      [];
    for (const match of source.matchAll(namedImport)) {
      const dependency = moduleId(root, new URL(match[2], url));
      imports.push({ clause: match[1], specifier: match[0], dependency });
      await visit(dependency);
    }
    for (const item of imports) {
      const clause = item.clause.replace(/\s+as\s+/g, ": ").replace(/\s+/g, " ")
        .trim();
      source = source.replace(
        item.specifier,
        `const { ${clause} } = __require(${JSON.stringify(item.dependency)});`,
      );
    }
    if (/^\s*import\s/m.test(source)) {
      throw new Error(`${id}: unsupported import syntax in Safari worker`);
    }
    source = source.replace(
      /@typedef\s+\{import\([^)]*\)\.[^}]+\}/g,
      "@typedef {Object}",
    );

    const exports = new Map<string, string>();
    source = source.replace(
      /^\s*export\s*\{([\s\S]*?)\};?\s*$/gm,
      (_whole, names: string) => {
        for (const raw of names.split(",")) {
          const [local, exported = local] = raw.trim().split(/\s+as\s+/);
          if (local) exports.set(exported, local);
        }
        return "";
      },
    );
    source = source.replace(
      /\bexport\s+(?=(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*))/g,
      (_whole, name: string) => {
        exports.set(name, name);
        return "";
      },
    );
    if (/\bexport\s+(?:default|\*)/u.test(source)) {
      throw new Error(`${id}: unsupported export syntax in Safari worker`);
    }
    const assignments = [...exports.entries()].map(([name, local]) =>
      `exports[${JSON.stringify(name)}] = ${local};`
    ).join("\n");
    modules.set(id, `${source}\n${assignments}`);
    visiting.delete(id);
  }

  await visit(entry, override);
  const definitions = [...modules.entries()].map(([id, source]) =>
    `__modules[${
      JSON.stringify(id)
    }] = (exports, __require) => {\n${source}\n};`
  ).join("\n");
  const output = `// Generated by scripts/sync_safari.ts. Do not edit.\n` +
    `(() => {\n"use strict";\nconst __modules = Object.create(null);\n` +
    `const __cache = Object.create(null);\n` +
    `function __require(id) {\n` +
    `  if (__cache[id]) return __cache[id];\n` +
    `  const factory = __modules[id];\n` +
    `  if (!factory) throw new Error("Missing bundled module: " + id);\n` +
    `  const exports = {};\n` +
    `  __cache[id] = exports;\n` +
    `  factory(exports, __require);\n` +
    `  return exports;\n` +
    `}\n${definitions}\n__require(${JSON.stringify(entry)});\n})();\n`;
  return new TextEncoder().encode(output);
}

async function expectedFiles(
  build: SafariBuild,
): Promise<Map<string, Uint8Array>> {
  const sourceRoot = pathOf(build.sourceRoot);
  await checkBrowserFontPackage(sourceRoot);
  const files = await collect(sourceRoot);
  const manifest = files.get("manifest.json");
  if (!manifest) throw new Error(`${build.id}: source manifest is missing`);
  const sourceManifest = JSON.parse(
    new TextDecoder().decode(manifest),
  ) as Manifest;
  files.set("manifest.json", safariManifest(build, manifest));
  if (build.id === "calmly") {
    const chromeCss = files.get("fonts.css");
    if (!chromeCss) throw new Error("calmly: fonts.css is missing");
    files.set("safari_fonts.js", calmlyFontBootstrap(chromeCss));
    // The popup links this stylesheet in the extension origin. Content pages
    // still use the byte-loading bridge because their CSP is independent.
    files.set(
      "fonts.css",
      new TextEncoder().encode(
        new TextDecoder().decode(chromeCss).replaceAll(
          "chrome-extension://__MSG_@@extension_id__/",
          "",
        ),
      ),
    );
  }
  if (build.handler === "atlaskit") {
    // Works from X-ExtShared (aggregate symlinks) and inside the product repo.
    const productPrefix = build.sourceRoot.split("/").slice(0, -1).join("/");
    const adapter = await Deno.readTextFile(
      new URL(
        `${
          productPrefix ? `${productPrefix}/` : ""
        }extension_safari/platform/safari_background.js`,
        ROOT,
      ),
    );
    files.set(
      "safari_background.js",
      await bundleClassic(sourceRoot, "background.js", adapter),
    );
  } else if (sourceManifest.background?.type === "module") {
    files.set("safari_background.js", await bundleClassic(sourceRoot));
  }
  return files;
}

async function writeFiles(root: URL, files: Map<string, Uint8Array>) {
  try {
    await Deno.remove(root, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  await Deno.mkdir(root, { recursive: true });
  for (const [relative, bytes] of files) {
    const target = new URL(relative, root);
    await Deno.mkdir(new URL("./", target), { recursive: true });
    await Deno.writeFile(target, bytes);
  }
}

async function checkFiles(
  build: SafariBuild,
  expected: Map<string, Uint8Array>,
) {
  const root = pathOf(build.webRoot);
  let actual: Map<string, Uint8Array>;
  try {
    actual = await collect(root);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`${build.id}: Safari root is missing; run safari:sync`);
    }
    throw error;
  }
  const expectedPaths = [...expected.keys()].sort();
  const actualPaths = [...actual.keys()].sort();
  if (JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths)) {
    throw new Error(`${build.id}: Safari file list drifted; run safari:sync`);
  }
  for (const path of expectedPaths) {
    if (!bytesEqual(expected.get(path)!, actual.get(path)!)) {
      throw new Error(
        `${build.id}: Safari file drift at ${path}; run safari:sync`,
      );
    }
  }
}

// Narrow release bumps must preserve Safari adapters, permissions and assets.
function validVersion(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}$/u.test(value) ||
    value.split(".").some((part) => Number(part) > 65535) ||
    value.split(".").every((part) => Number(part) === 0)
  ) {
    throw new Error(
      `${label}: invalid extension version ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function manifestVersion(source: string, label: string): string {
  const manifest = JSON.parse(source);
  return validVersion(manifest?.version, label);
}

function replaceManifestVersion(source: string, version: string): string {
  // JSON is validated first. Track depth so nested metadata is left untouched.
  const tokens = [...source.matchAll(/"(?:\\.|[^"\\])*"|[{}[\]:,]/gu)];
  let depth = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token[0] === "{" || token[0] === "[") depth++;
    else if (token[0] === "}" || token[0] === "]") depth--;
    else if (
      depth === 1 && token[0].startsWith('"') &&
      JSON.parse(token[0]) === "version" && tokens[index + 1]?.[0] === ":"
    ) {
      const value = tokens[index + 2];
      if (!value?.[0].startsWith('"')) break;
      return source.slice(0, value.index) + JSON.stringify(version) +
        source.slice(value.index! + value[0].length);
    }
  }
  throw new Error("Safari manifest: version token is missing");
}

async function syncVersion(build: SafariBuild, root: URL, check: boolean) {
  const source = new URL(`${build.sourceRoot}/manifest.json`, root);
  const destination = new URL(`${build.webRoot}/manifest.json`, root);
  const version = manifestVersion(await Deno.readTextFile(source), build.id);
  const manifest = await Deno.readTextFile(destination);
  manifestVersion(manifest, `${build.id}: Safari manifest`);
  const changes: { path: URL; current: string; expected: string }[] = [{
    path: destination,
    current: manifest,
    expected: replaceManifestVersion(manifest, version),
  }];
  for (const relative of ["src/version.js", "popup.html"]) {
    const path = new URL(`${build.webRoot}/${relative}`, root);
    const current = await Deno.readTextFile(path).catch((error) => {
      if (error instanceof Deno.errors.NotFound) return null;
      throw error;
    });
    if (current === null) continue;
    let expected = current;
    if (relative === "src/version.js") {
      const declaration = build.id === "calmly"
        ? /\bglobalThis\.CalmlyVersion\s*=\s*(["'])([^"'\r\n]*)\1/gu
        : /\bexport\s+const\s+VERSION\s*=\s*(["'])([^"'\r\n]*)\1/gu;
      const matches = [...current.matchAll(declaration)];
      if (matches.length !== 1) {
        throw new Error(`${build.id}: ${relative} must declare one version`);
      }
      validVersion(matches[0][2], `${build.id}: ${relative}`);
      expected = current.replace(
        declaration,
        (whole, quote, previous) =>
          whole.slice(0, -(previous.length + 1)) + version + quote,
      );
    } else {
      // Empty runtime-filled elements stay empty; never replace arbitrary numbers.
      const element =
        /(<([a-z][\w:-]*)\b[^>]*\sid\s*=\s*["']version["'][^>]*>)([^<]*)(<\/\2\s*>)/giu;
      const matches = [...current.matchAll(element)];
      if (matches.length > 1) {
        throw new Error(
          `${build.id}: popup.html has duplicate version elements`,
        );
      }
      if (matches[0]?.[3].trim()) {
        const content = matches[0][3];
        const token = content.match(/^(\s*)(v?)(\S+)(\s*)$/u);
        if (!token) {
          throw new Error(`${build.id}: malformed popup.html version`);
        }
        validVersion(token[3], `${build.id}: popup.html version`);
        expected = current.replace(
          element,
          (_whole, open, _tag, _text, close) =>
            open + token[1] + token[2] + version + token[4] + close,
        );
      }
    }
    changes.push({ path, current, expected });
  }
  // Read and validate every target before the first write, including in check mode.
  for (const change of changes) {
    if (change.current === change.expected) continue;
    if (check) {
      throw new Error(
        `${build.id}: Safari version drift at ${change.path.pathname}`,
      );
    }
    await Deno.writeTextFile(change.path, change.expected);
  }
}

export async function syncSafari(argsList: string[] = Deno.args, root = ROOT) {
  const registry = JSON.parse(
    await Deno.readTextFile(new URL("products.json", root)),
  ) as Registry;
  const args = new Set(argsList);
  const only = argsList[argsList.indexOf("--only") + 1];
  if (
    args.has("--only") &&
    !registry.safariBuilds.some((build) => build.id === only)
  ) {
    throw new Error(`Unknown Safari sync id: ${only}`);
  }
  if (args.has("--version-only")) {
    if (
      !args.has("--only") ||
      argsList.filter((arg) => arg === "--only").length !== 1
    ) {
      throw new Error(
        "Safari --version-only requires one explicit --only <id>",
      );
    }
    if (args.has("--list")) {
      throw new Error("Safari --version-only cannot be combined with --list");
    }
    await syncVersion(
      registry.safariBuilds.find((build) => build.id === only)!,
      root,
      args.has("--check"),
    );
    console.log(
      `${only}: Safari version ${
        args.has("--check") ? "matches" : "synchronized"
      }.`,
    );
    return;
  }
  const { syncBookmarkSourcePolicy } = await import(
    "./sync_bookmark_source_policy.ts"
  );
  const { syncCaptureMenuSettings } = await import("./sync_capture_menu.ts");
  await syncBookmarkSourcePolicy(argsList);
  await syncCaptureMenuSettings(argsList);
  if (args.has("--list")) {
    for (const build of registry.safariBuilds) {
      console.log([
        build.id,
        build.sourceRoot,
        build.webRoot,
        build.hostRoot,
        build.appName,
        build.installApp,
        build.hostBundleId,
        build.extensionBundleId,
        build.handler,
      ].join("\t"));
    }
  } else {
    for (const build of registry.safariBuilds) {
      if (args.has("--only") && build.id !== only) continue;
      const expected = await expectedFiles(build);
      if (args.has("--check")) await checkFiles(build, expected);
      else await writeFiles(pathOf(build.webRoot), expected);
    }
    console.log(
      args.has("--check")
        ? "Safari sources are synchronized."
        : "Safari sources synchronized.",
    );
  }
}

if (import.meta.main) await syncSafari();
