/** Synchronize shared UI and exactly the reviewed browser fonts; retain source archives. */
const MODULES = new URL("../", import.meta.url);
const checkOnly = Deno.args.includes("--check");
const projectArg = Deno.args.find((arg) => arg.startsWith("--project-root="))
  ?.slice(15);
const projectRoot = projectArg
  ? new URL(`file://${projectArg.replace(/\/$/, "")}/`)
  : null;
const registry: {
  product?: string;
  products: { id: string; roots: string[] }[];
} = projectRoot
  ? {
    product:
      JSON.parse(await Deno.readTextFile(new URL("product.json", projectRoot)))
        .product,
    products: [{ id: "", roots: ["extension_chrome"] }],
  }
  : JSON.parse(await Deno.readTextFile(new URL("products.json", MODULES)));
const source = new URL("shared/design/", MODULES);
const manifestBytes = await Deno.readFile(
  new URL("browser-font-manifest.json", source),
);
const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
if (
  manifest.mode !== "browser-v1" || manifest.schemaVersion !== 1 ||
  !Array.isArray(manifest.assets)
) throw Error("Unknown browser font manifest");
const encoder = new TextEncoder();
let differences = 0;
let packages = 0;
let assetBytes = 0;
async function syncBytes(target: URL, expected: Uint8Array) {
  let current: Uint8Array | undefined;
  try {
    current = await Deno.readFile(target);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  if (
    current?.length === expected.length &&
    current.every((byte, index) => byte === expected[index])
  ) return;
  differences++;
  if (checkOnly) {
    console.error(`Out of sync: ${target.pathname}`);
    return;
  }
  await Deno.mkdir(new URL("./", target), { recursive: true });
  await Deno.writeFile(target, expected);
}
const fonts = [];
for (const asset of manifest.assets) {
  if (
    !asset.file || asset.file.startsWith("/") ||
    asset.file.split("/").includes("..")
  ) throw Error("Unsafe font asset path");
  const bytes = await Deno.readFile(
    new URL(`fonts/browser/${asset.file}`, source),
  );
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hash !== asset.sha256 || bytes.length !== asset.bytes) {
    throw Error(`Invalid browser font source: ${asset.file}`);
  }
  fonts.push({ name: asset.file, bytes });
}
const emojiRenderer = await Deno.readFile(new URL("browser-emoji.js", source));
const typography = encoder.encode(
  await Deno.readTextFile(new URL("typography-geometry.js", source)) + "\n" +
    (await Deno.readTextFile(new URL("ui-typography.js", source))).replace(
      "__FINAL_FONT_CATALOG__",
      JSON.stringify(manifest.fonts),
    ),
);
const interactions = await Deno.readFile(new URL("ui-interactions.js", source));
const popupBaseline = await Deno.readTextFile(new URL("popup.css", source));
const collectionBaseline = await Deno.readTextFile(
  new URL("collection.css", source),
);
const icons = await Promise.all(
  ["block", "check", "chevron", "close", "edit", "refresh", "settings"].map(
    async (name) => ({
      name: `${name}.svg`,
      bytes: await Deno.readFile(new URL(`icons/${name}.svg`, source)),
    }),
  ),
);
for (const product of registry.products) {
  const kind = registry.product ?? product.id;
  for (const relative of product.roots) {
    if (
      Deno.args.includes("--chrome-only") &&
      !relative.includes("extension_chrome")
    ) continue;
    const packageRoot = projectRoot
      ? new URL(`${relative}/`, projectRoot)
      : new URL(`${product.id}/${relative}/`, MODULES);
    packages++;
    for (const font of fonts) {
      assetBytes += font.bytes.length;
      await syncBytes(
        new URL(`ui-fonts/browser/${font.name}`, packageRoot),
        font.bytes,
      );
    }
    await syncBytes(
      new URL("ui-fonts/browser-font-manifest.json", packageRoot),
      manifestBytes,
    );
    for (const icon of icons) {
      await syncBytes(
        new URL(`ui-icons/${icon.name}`, packageRoot),
        icon.bytes,
      );
    }
    await syncBytes(new URL("ui-interactions.js", packageRoot), interactions);
    await syncBytes(new URL("browser-emoji.js", packageRoot), emojiRenderer);
    // Calmly owns its typography persistence and popup controls, not the generic UI helper.
    if (kind === "calmly") continue;
    await syncBytes(new URL("ui-typography.js", packageRoot), typography);
    for (const name of ["popup.html", "collection.html"]) {
      const file = new URL(name, packageRoot);
      try {
        const html = await Deno.readTextFile(file);
        let updated = html;
        // Popup typography is fixed by its CSS. Collection pages retain their
        // independent typography controls.
        if (
          name === "popup.html" &&
          (relative.includes("extension_chrome") ||
            relative.includes("extension_safari"))
        ) {
          updated = updated.replace(
            /^[ \t]*<script src="(?:browser-emoji|ui-typography)\.js" defer><\/script>\s*\n/gm,
            "",
          );
          await syncBytes(file, encoder.encode(updated));
          continue;
        }
        if (!updated.includes('src="ui-typography.js"')) {
          updated = updated.replace(
            "</head>",
            '  <script src="ui-typography.js" defer></script>\n</head>',
          );
        }
        if (!updated.includes('src="browser-emoji.js"')) {
          updated = updated.replace(
            '<script src="ui-typography.js"',
            '<script src="browser-emoji.js" defer></script>\n  <script src="ui-typography.js"',
          );
        }
        await syncBytes(file, encoder.encode(updated));
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }
    const collector = kind === "x_collector";
    const css = new URL(
      collector ? "collection.css" : "popup.css",
      packageRoot,
    );
    const original = (await Deno.readTextFile(css)).replace(
      /@font-face\s*\{[^}]*\}\s*/g,
      "",
    );
    const marker = collector
      ? /\/\* --- shared collection baseline start --- \*\/[\s\S]*?\/\* --- shared collection baseline end --- \*\//
      : /\/\* --- shared popup baseline start --- \*\/[\s\S]*?\/\* --- shared popup baseline end --- \*\//;
    const baseline = collector ? collectionBaseline : popupBaseline;
    if (!collector && !marker.test(original)) {
      throw Error(`Missing shared popup marker: ${css.pathname}`);
    }
    await syncBytes(
      css,
      encoder.encode(
        marker.test(original)
          ? original.replace(marker, baseline.trimEnd())
          : `${baseline}\n${original}`,
      ),
    );
  }
}
console.log(JSON.stringify({ checkOnly, packages, assetBytes, differences }));
if (checkOnly && differences) Deno.exit(1);
