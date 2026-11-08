// Shared build input. Edit in X-ExtShared, then explicitly sync pinned consumers.
import { dirname, fromFileUrl, join } from "./paths.ts";

export const root = dirname(dirname(fromFileUrl(import.meta.url)));
export async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
export async function filesAt(
  directory: string,
  prefix = "",
): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    if (entry.name === ".DS_Store") continue;
    const path = join(directory, entry.name);
    if (entry.isSymlink) {
      throw Error(`Package refuses symlink assets: ${prefix}${entry.name}`);
    }
    if (entry.isDirectory) {
      files.push(...await filesAt(path, `${prefix}${entry.name}/`));
    } else if (entry.isFile) files.push(prefix + entry.name);
    else throw Error(`Unsupported asset: ${prefix}${entry.name}`);
  }
  return files.sort();
}
export async function verify() {
  const product = JSON.parse(
    await Deno.readTextFile(join(root, "product.json")),
  );
  const chrome = join(root, "extension_chrome");
  const { checkBrowserFontPackage } = await import(
    new URL("../scripts/calmly_package_guard.ts", import.meta.url).href
  );
  if (product.fontPolicy === "system") {
    const runtimeFiles = await filesAt(chrome);
    if (runtimeFiles.some((path) => /\.(?:woff2?|[ot]tf)$/iu.test(path))) {
      throw Error("System-font-only extension must not bundle font files");
    }
  } else if (product.fontPolicy === "glyphgrove") {
    const manifest = JSON.parse(await Deno.readTextFile(join(chrome, "glyphgrove-assets.json")));
    const files = await filesAt(chrome);
    const expectedFonts = new Set<string>();
    for (const asset of manifest.assets as { path: string; sha256: string }[]) {
      if (!asset.path.startsWith("glyphgrove/") || asset.path.includes("..") || !/^[a-f0-9]{64}$/u.test(asset.sha256)) throw Error("Invalid Glyphgrove asset");
      const bytes = await Deno.readFile(join(chrome, asset.path));
      if (await sha256(bytes) !== asset.sha256) throw Error(`Glyphgrove asset differs: ${asset.path}`);
      if (asset.path.endsWith(".woff2")) {
        if (new TextDecoder().decode(bytes.subarray(0, 4)) !== "wOF2") throw Error(`Invalid WOFF2: ${asset.path}`);
        expectedFonts.add(asset.path);
      }
    }
    if (files.some((p) => /\.(?:woff2?|[ot]tf)$/iu.test(p) && !expectedFonts.has(p))) throw Error("Unexpected bundled font");
  } else {
    await checkBrowserFontPackage(new URL("../extension_chrome/", import.meta.url));
  }
  const manifest = JSON.parse(
    await Deno.readTextFile(join(chrome, "manifest.json")),
  );
  if (
    !manifest.name || !/^\d+\.\d+\.\d+$/u.test(manifest.version) ||
    !manifest.key
  ) throw Error("Chrome identity/version is missing");
  const keyBytes = Uint8Array.from(atob(manifest.key), (c) => c.charCodeAt(0));
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", keyBytes),
  );
  const id = Array.from(
    digest.slice(0, 16),
    (b) => String.fromCharCode(97 + (b >> 4), 97 + (b & 15)),
  ).join("");
  if (id !== product.chromeId) {
    throw Error(
      "Pinned Chrome ID changed; do not silently replace an installed identity",
    );
  }
  const files = await filesAt(chrome);
  const present = new Set(files);
  const required: string[] = [
    ...Object.values(manifest.icons ?? {}) as string[],
    ...[
      manifest.background?.service_worker,
      manifest.action?.default_popup,
      manifest.options_ui?.page,
      manifest.options_page,
    ].filter(Boolean),
    ...(manifest.background?.scripts ?? []),
    ...(manifest.content_scripts ?? []).flatMap((
      row: { js?: string[]; css?: string[] },
    ) => [...row.js ?? [], ...row.css ?? []]),
    ...Object.values(manifest.chrome_url_overrides ?? {}) as string[],
  ];
  for (const path of required) {
    if (!present.has(path)) throw Error(`Missing manifest resource: ${path}`);
  }
  const byteHashes = [];
  for (const path of files) {
    const bytes = await Deno.readFile(join(chrome, path));
    if (
      path.endsWith(".woff2") &&
      new TextDecoder().decode(bytes.slice(0, 4)) !== "wOF2"
    ) throw Error(`Invalid bundled WOFF2: ${path}`);
    byteHashes.push({ path, sha256: await sha256(bytes), bytes: bytes.length });
  }
  const pins = JSON.parse(
    await Deno.readTextFile(join(root, "dependencies.lock.json")),
  );
  for (const file of pins.files as { path: string; sha256: string }[]) {
    const bytes = await Deno.readFile(join(root, file.path));
    if (await sha256(bytes) !== file.sha256) {
      throw Error(
        `Generated dependency changed: ${file.path}; edit its recorded owner and sync explicitly`,
      );
    }
  }
  if (product.viaRoot) {
    const entries = await filesAt(join(root, product.viaRoot));
    if (!entries.some((p) => p.endsWith(".user.js"))) {
      throw Error("VIA source is missing");
    }
  }
  return {
    project: product.name,
    version: manifest.version,
    chromeId: id,
    files: byteHashes,
    dependencies: pins.files.length,
    otherBrowsers:
      "Safari and Firefox retained source only; generation, signing, installation and live browser behavior are not verified by this receipt",
  };
}
if (import.meta.main) {
  const result = await verify();
  console.log(JSON.stringify({ ...result, files: result.files.length }));
}
