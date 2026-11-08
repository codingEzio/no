// No-owned portable candidate path. The generated strict verifier and pins stay unchanged.
import { join } from "./paths.ts";
import { filesAt, root, sha256 } from "./verify.ts";
const product = JSON.parse(
  await Deno.readTextFile(join(root, "product.json")),
);
if (
  product.fontPolicy !== undefined &&
  !["glyphgrove", "system", "browser-v1"].includes(product.fontPolicy)
) {
  throw Error("Unsupported font policy");
}
import { checkBrowserFontPackage } from "./calmly_package_guard.ts";

const selection = JSON.parse(
  await Deno.readTextFile(join(root, "public-source.json")),
);
const selected = new Set<string>(selection.files);
const excludedDocumentation = [
  "extension_firefox/README.md",
  "extension_firefox/PLAN.md",
];
if (
  selection.schemaVersion !== 1 || selected.size !== selection.files.length ||
  excludedDocumentation.some((path) => selected.has(path))
) throw Error("Invalid independent source selection");
for (const path of selected) {
  if (
    typeof path !== "string" || !path || path.startsWith("/") ||
    path.includes("\\") ||
    [...path].some((char) =>
      char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
    ) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) throw Error("Invalid independent source path");
  const file = join(root, path);
  if (!(await Deno.lstat(file)).isFile || await Deno.realPath(file) !== file) {
    throw Error(`Independent source must be a regular file: ${path}`);
  }
}
const safariFontManifest =
  "extension_safari/web-extension/ui-fonts/browser-font-manifest.json";
if (
  !selected.has(safariFontManifest) ||
  !/^[a-f0-9]{64}$/.test(selection.safariFontManifestSha256) ||
  await sha256(await Deno.readFile(join(root, safariFontManifest))) !==
    selection.safariFontManifestSha256
) throw Error("Safari font manifest differs from selected pin");

// A receipt verifies copy integrity, not the identity or trustworthiness of its source.
let sourceReceipt = "absent";
const receiptPath = join(root, "SOURCE-RECEIPT.json");
let receiptExists = true;
try {
  await Deno.lstat(receiptPath);
} catch (error) {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
  receiptExists = false;
}
if (receiptExists) {
  const stat = await Deno.lstat(receiptPath);
  if (!stat.isFile || await Deno.realPath(receiptPath) !== receiptPath) {
    throw Error("Source receipt must be a regular file");
  }
  const source = JSON.parse(await Deno.readTextFile(receiptPath));
  if (
    source.schemaVersion !== 1 || !Array.isArray(source.files) ||
    source.files.length !== selected.size ||
    new Set(source.files.map((file: { path: string }) => file.path)).size !==
      selected.size ||
    await sha256(new TextEncoder().encode(JSON.stringify(source.files))) !==
      source.seal
  ) throw Error("Invalid source receipt");
  for (const entry of source.files) {
    if (
      !selected.has(entry.path) || !["100644", "100755"].includes(entry.mode)
    ) {
      throw Error("Source receipt selection differs");
    }
    const file = join(root, entry.path);
    const info = await Deno.lstat(file);
    if (
      (info.mode !== null && (info.mode & 0o777) !==
          (entry.mode === "100755" ? 0o755 : 0o644)) ||
      info.size !== entry.bytes ||
      await sha256(await Deno.readFile(file)) !== entry.sha256
    ) throw Error(`Source receipt mismatch: ${entry.path}`);
  }
  sourceReceipt = "verified";
}
const lock = JSON.parse(
  await Deno.readTextFile(join(root, "dependencies.lock.json")),
);
const omitted: string[] = [];
for (const pin of lock.files as { path: string; sha256: string }[]) {
  if (!selected.has(pin.path)) {
    if (!excludedDocumentation.includes(pin.path)) {
      throw Error(`Required runtime/build pin is not selected: ${pin.path}`);
    }
    omitted.push(pin.path);
    continue;
  }
  if (await sha256(await Deno.readFile(join(root, pin.path))) !== pin.sha256) {
    throw Error(`Selected dependency pin differs: ${pin.path}`);
  }
}
if (
  omitted.length !== 0 &&
  JSON.stringify(omitted.sort()) !==
    JSON.stringify(excludedDocumentation.sort())
) {
  throw Error("Expected no excluded documentation pins or exactly both");
}
const manifest = JSON.parse(
  await Deno.readTextFile(join(root, "extension_chrome/manifest.json")),
);
const digest = await sha256(
  Uint8Array.from(atob(manifest.key), (c) => c.charCodeAt(0)),
);
const chromeId = [...digest.slice(0, 32)].map((hex) =>
  String.fromCharCode(97 + Number.parseInt(hex, 16))
).join("");
if (
  chromeId !== product.chromeId || manifest.version !== product.version ||
  !manifest.name
) {
  throw Error("Pinned Chrome identity/version differs");
}
const chromeFiles = (await filesAt(join(root, "extension_chrome")))
  .filter((path) => path !== "private-defaults.json");
const expected = [...selected].filter((path) =>
  path.startsWith("extension_chrome/")
)
  .map((path) => path.slice("extension_chrome/".length)).sort();
if (JSON.stringify(chromeFiles) !== JSON.stringify(expected)) {
  throw Error("Chrome runtime files differ from the explicit source selection");
}
if (product.fontPolicy === "system") {
  if (chromeFiles.some((path) => /\.(?:woff2?|[ot]tf)$/iu.test(path))) {
    throw Error("System-font-only extension must not bundle font files");
  }
} else if (product.fontPolicy === "glyphgrove") {
  const fontManifest = JSON.parse(
    await Deno.readTextFile(
      join(root, "extension_chrome/glyphgrove-assets.json"),
    ),
  );
  const expectedFonts = new Set<string>();
  for (
    const asset of fontManifest.assets as { path: string; sha256: string }[]
  ) {
    if (
      !asset.path.startsWith("glyphgrove/") || asset.path.includes("..") ||
      !/^[a-f0-9]{64}$/u.test(asset.sha256)
    ) throw Error("Invalid Glyphgrove asset");
    const bytes = await Deno.readFile(
      join(root, "extension_chrome", asset.path),
    );
    if (await sha256(bytes) !== asset.sha256) {
      throw Error(`Glyphgrove asset differs: ${asset.path}`);
    }
    if (asset.path.endsWith(".woff2")) {
      if (
        new TextDecoder().decode(bytes.subarray(0, 4)) !== "wOF2"
      ) throw Error(`Invalid WOFF2: ${asset.path}`);
      expectedFonts.add(asset.path);
    }
  }
  if (
    chromeFiles.some((path) =>
      /\.(?:woff2?|[ot]tf)$/iu.test(path) && !expectedFonts.has(path)
    )
  ) throw Error("Unexpected bundled font");
} else {
  await checkBrowserFontPackage(
    new URL("../extension_chrome/", import.meta.url),
  );
}
// Safari retains its own browser-v1 font package even when Chrome uses system fonts.
await checkBrowserFontPackage(
  new URL("../extension_safari/web-extension/", import.meta.url),
);
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
  ) => [
    ...row.js ?? [],
    ...row.css ?? [],
  ]),
  ...Object.values(manifest.chrome_url_overrides ?? {}) as string[],
];
for (const path of required) {
  if (!chromeFiles.includes(path)) {
    throw Error(`Missing manifest resource: ${path}`);
  }
}
const files = await Promise.all(chromeFiles.map(async (path) => {
  const data = await Deno.readFile(join(root, "extension_chrome", path));
  return { path, bytes: data.length, sha256: await sha256(data) };
}));
const seal = await sha256(new TextEncoder().encode(JSON.stringify(files)));
const receipt = {
  schemaVersion: 1,
  project: product.name,
  version: manifest.version,
  chromeId,
  seal,
  files,
  omittedPinnedDocumentation: omitted,
  releaseReady: false,
  limits:
    "Local Chrome candidate only; no installed-browser, native or publication proof",
};
const ensureDirectory = async (path: string) => {
  try {
    await Deno.mkdir(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
  }
  if (
    !(await Deno.lstat(path)).isDirectory || await Deno.realPath(path) !== path
  ) {
    throw Error("Candidate directory must not be a symlink");
  }
};
await ensureDirectory(join(root, "Local"));
await ensureDirectory(join(root, "Local/public-build"));
const output = join(root, "Local/public-build", seal);
let existing = false;
try {
  await Deno.mkdir(output);
} catch (error) {
  if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
  existing = true;
}
if (
  !(await Deno.lstat(output)).isDirectory ||
  await Deno.realPath(output) !== output
) {
  throw Error("Candidate output must not be a symlink");
}
if (!existing) {
  for (const file of files) {
    const path = join(output, "extension_chrome", file.path);
    await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await Deno.writeFile(
      path,
      await Deno.readFile(join(root, "extension_chrome", file.path)),
      {
        createNew: true,
        mode: 0o644,
      },
    );
  }
  await Deno.writeTextFile(
    join(output, "receipt.json"),
    JSON.stringify(receipt, null, 2) + "\n",
    {
      createNew: true,
      mode: 0o644,
    },
  );
}
const expectedOutput = [
  ...files.map((f) => "extension_chrome/" + f.path),
  "receipt.json",
].sort();
if (JSON.stringify(await filesAt(output)) !== JSON.stringify(expectedOutput)) {
  throw Error("Independent candidate file collection differs");
}
for (const file of files) {
  if (
    await sha256(
      await Deno.readFile(join(output, "extension_chrome", file.path)),
    ) !== file.sha256
  ) {
    throw Error(`Independent candidate readback differs: ${file.path}`);
  }
}
if (
  JSON.stringify(
    JSON.parse(await Deno.readTextFile(join(output, "receipt.json"))),
  ) !==
    JSON.stringify(receipt)
) throw Error("Independent candidate receipt differs");
console.log(
  JSON.stringify({
    ...receipt,
    files: files.length,
    sourceReceipt,
    output: `Local/public-build/${seal}`,
    readback: "exact",
    existing,
  }),
);
