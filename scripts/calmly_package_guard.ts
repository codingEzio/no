// Exact runtime allowlist shared by every extension. Retained source fonts are separate.
export const calmlyPackageBudget = Object.freeze({ xpiBytes: 80_000_000 });
export function checkCalmlyXpiSize(bytes: number): void {
  if (
    !Number.isSafeInteger(bytes) || bytes <= 0 ||
    bytes > calmlyPackageBudget.xpiBytes
  ) throw Error(`Calmly XPI size ${bytes} exceeds the reviewed 80 MB budget`);
}
export async function checkBrowserFontPackage(root: URL) {
  const manifest = JSON.parse(
    await Deno.readTextFile(
      new URL("ui-fonts/browser-font-manifest.json", root),
    ),
  );
  if (
    manifest.schemaVersion !== 1 || manifest.mode !== "browser-v1" ||
    !Array.isArray(manifest.assets)
  ) throw Error("Missing reviewed browser-v1 font manifest");
  const fonts = manifest.fonts.map((font: { file: string }) => font.file);
  if (fonts.length !== 7 || new Set(fonts).size !== 7) throw Error("Expected seven final font artifacts");

  const reviewed = new Map<string, { sha256: string; bytes: number }>();
  for (const asset of manifest.assets) {
    if (
      typeof asset.file !== "string" || asset.file.startsWith("/") ||
      asset.file.split("/").some((part: string) => part === ".." || !part) ||
      reviewed.has(asset.file) || !/^[a-f0-9]{64}$/u.test(asset.sha256) ||
      !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0
    ) throw Error("Invalid browser font manifest asset");
    reviewed.set(asset.file, asset);
  }
  const allFonts=[...fonts,manifest.emoji?.files?.default,manifest.emoji?.files?.android];
  if(allFonts.length!==9||allFonts.some(f=>typeof f!=="string")||new Set(allFonts).size!==9)throw Error("Missing shared platform emoji adapters");
  const fontAssets = [...reviewed.keys()].filter((path) =>
    /\.(?:woff2?|[ot]tf)$/iu.test(path)
  ).sort();
  if (JSON.stringify(fontAssets) !== JSON.stringify(allFonts.sort())) {
    throw Error(
      "Browser font allowlist differs from the final seven-font catalog",
    );
  }
  // Every license/provenance asset is hash checked too, not just the fonts.
  let bytes = 0;
  for (const [file, record] of reviewed) {
    const data = await Deno.readFile(new URL(`ui-fonts/browser/${file}`, root));
    const digest = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
    ].map((n) => n.toString(16).padStart(2, "0")).join("");
    if (digest !== record.sha256 || data.length !== record.bytes) {
      throw Error(`Browser asset differs from provenance: ${file}`);
    }
    if (
      file.endsWith(".woff2") &&
      new TextDecoder().decode(data.subarray(0, 4)) !== "wOF2"
    ) throw Error(`Invalid WOFF2: ${file}`);
    bytes += data.length;
  }
  const found: string[] = [];
  async function scan(directory: URL, prefix = "") {
    for await (const entry of Deno.readDir(directory)) {
      if (entry.isSymlink) {
        throw Error(`Font package refuses symlink: ${prefix}${entry.name}`);
      }
      const path = prefix + entry.name;
      if (entry.isDirectory) {
        await scan(new URL(entry.name + "/", directory), path + "/");
      } else {
        if (
          path.startsWith("ui-fonts/browser/") && !reviewed.has(path.slice(17))
        ) throw Error(`Unreviewed browser asset: ${path}`);
        if (/\.(?:woff2?|[ot]tf)$/iu.test(path)) found.push(path);
        if (/\.(?:css|js|html)$/iu.test(path)) {
          const text = await Deno.readTextFile(new URL(entry.name, directory));
          if (/data:(?:font\/|application\/(?:font|x-font))/iu.test(text)) {
            throw Error(`Unreviewed embedded font: ${path}`);
          }
          if (
            /url\([^)]*(?:compact\/|dotomod\/|dotorefined\/|roboto\/|doto\/|Geist-Variable)/iu
              .test(text)
          ) throw Error(`Retired font URL: ${path}`);
        }
      }
    }
  }
  await scan(root);
  const expected = allFonts.map((file) => `ui-fonts/browser/${file}`).sort();
  if (JSON.stringify(found.sort()) !== JSON.stringify(expected)) {
    throw Error(`Extra or missing runtime fonts: ${JSON.stringify(found)}`);
  }
  return { files: allFonts.length, families:fonts.length, bytes, mode: "browser-v1" };
}
export const checkCalmlyFontPackage = checkBrowserFontPackage;
if (import.meta.main) {
  console.log(
    JSON.stringify(
      await checkBrowserFontPackage(
        new URL(Deno.args[0] ?? "../calmly/extension_chrome/", import.meta.url),
      ),
    ),
  );
}
