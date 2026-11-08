// Deno-only packaging. Generated resources and unsigned XPIs stay in Local.
const project = new URL("../../", import.meta.url);
const moduleRoot = new URL("./", import.meta.url);
const products = [
  {
    slug: "bookmark",
    id: "{0ca238b6-fa1b-5d21-a7e5-7588791fd7ca}",
    name: "Prometheus Bookmark · Firefox Android",
    source:
      "module_extensions/mastermind_capture/via/prometheus-bookmark-via.user.js",
    icons:
      "module_extensions/mastermind_capture/extension_chrome/bookmark/icons/",
    matches: ["http://*/*", "https://*/*"],
    description:
      "Classify, copy, and retain bookmarks for explicit Prometheus receiver review.",
    translatedDescriptions: {
      zh_CN: "分类、复制与保留书签，再由明确选择的 Prometheus 接收页审核保存。",
      zh_TW: "分類、複製與保留書籤，再由明確選擇的 Prometheus 接收頁審核儲存。",
    },
    notices: [] as string[],
    data: ["browsingActivity", "websiteContent"],
  },
  {
    slug: "calmly",
    id: "{76bd4ae5-f9d2-5c62-b9fc-d02b11ed20de}",
    name: "Calmly X · Firefox Android",
    source: "module_extensions/calmly/via/z-calmly-x-via.user.js",
    icons: "module_extensions/calmly/extension_chrome/icons/",
    matches: ["https://x.com/*", "https://twitter.com/*"],
    description:
      "Calmly mobile X reading controls and explicit Prometheus capture.",
    translatedDescriptions: {
      zh_CN: "Calmly 移动版 X 阅读控制与明确选择目的地的 Prometheus 采集。",
      zh_TW: "Calmly 行動版 X 閱讀控制與明確選擇目的地的 Prometheus 擷取。",
    },
    notices: [
      "X-ExtShared/shared/design/fonts/browser/NOTICE.md",
      "X-ExtShared/shared/design/fonts/browser/licenses/OFL.txt",
      "X-ExtShared/shared/design/fonts/browser/licenses/Cubic11-OFL.txt",
      "X-ExtShared/shared/design/fonts/browser/licenses/Noto3D-OFL.txt",
    ],
    data: ["browsingActivity", "websiteContent", "personalCommunications"],
  },
];
const argument = Deno.args[0];
const out = argument
  ? new URL(`${argument.replace(/\/$/u, "")}/`, `file://${Deno.cwd()}/`)
  : new URL("Local/firefox-android/candidate/", project);
if (!out.href.startsWith(new URL("Local/", project).href)) {
  throw new Error("Candidate output must be inside project Local");
}
await Deno.mkdir(out, { recursive: true });
const sha = async (bytes: Uint8Array) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
const report = [];
for (const product of products) {
  const sourceBytes = await Deno.readFile(new URL(product.source, project));
  const source = new TextDecoder().decode(sourceBytes);
  const version = source.match(/^\/\/ @version\s+(\d+\.\d+\.\d+)$/mu)?.[1];
  if (!version) throw new Error(`Missing source version: ${product.slug}`);
  const output = new URL(`${product.slug}/`, out);
  await Deno.mkdir(new URL("icons/", output), { recursive: true });
  const files = ["background.js", "bridge.js", "source.js", "manifest.json"];
  for (const file of ["bridge.js", "background.js"]) {
    await Deno.copyFile(new URL(file, moduleRoot), new URL(file, output));
  }
  // Preserve the complete source, including fonts, settings keys and immutable
  // transfer schema/source labels. No policy fork or replacement parser.
  await Deno.writeFile(new URL("source.js", output), sourceBytes);
  const icons: Record<string, string> = {};
  for (const size of [48, 128]) {
    const file = `icons/icon-${size}.png`;
    await Deno.copyFile(
      new URL(`${product.icons}icon-${size}.png`, project),
      new URL(file, output),
    );
    icons[String(size)] = file;
    files.push(file);
  }
  for (const notice of product.notices) {
    const file = `notices/${notice}`;
    const target = new URL(file, output);
    await Deno.mkdir(new URL("./", target), { recursive: true });
    await Deno.copyFile(new URL(notice, project), target);
    files.push(file);
  }
  for (const locale of ["en", "zh_CN", "zh_TW"] as const) {
    const file = `_locales/${locale}/messages.json`;
    const target = new URL(file, output);
    await Deno.mkdir(new URL("./", target), { recursive: true });
    await Deno.writeTextFile(
      target,
      `${
        JSON.stringify(
          {
            extName: { message: product.name },
            extDescription: {
              message: locale === "en"
                ? product.description
                : product.translatedDescriptions[locale],
            },
          },
          null,
          2,
        )
      }\n`,
    );
    files.push(file);
  }
  const manifest = {
    manifest_version: 3,
    name: "__MSG_extName__",
    version,
    description: "__MSG_extDescription__",
    default_locale: "en",
    permissions: ["storage", "clipboardWrite"],
    host_permissions: product.matches,
    background: { scripts: ["background.js"] },
    browser_specific_settings: {
      gecko: {
        id: product.id,
        strict_min_version: "140.0",
        data_collection_permissions: { required: product.data },
      },
      gecko_android: { strict_min_version: "142.0" },
    },
    icons,
    content_scripts: [{
      matches: product.matches,
      js: ["bridge.js", "source.js"],
      run_at: "document_end",
      all_frames: false,
    }],
  };
  await Deno.writeTextFile(
    new URL("manifest.json", output),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const xpi = new URL(`${product.slug}-${version}-unsigned.xpi`, out);
  // Explicit file list; never package personal Local contents or stale extras.
  try {
    await Deno.remove(xpi);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const zip = await new Deno.Command("/usr/bin/zip", {
    cwd: output,
    args: ["-q", "-X", xpi.pathname, ...files],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!zip.success) throw new Error(new TextDecoder().decode(zip.stderr));
  report.push({
    product: product.slug,
    id: product.id,
    version,
    source: product.source,
    source_sha256: await sha(sourceBytes),
    output: output.pathname,
    xpi: xpi.pathname,
    xpi_sha256: await sha(await Deno.readFile(xpi)),
    signed: false,
    installed: false,
    files,
  });
}
await Deno.writeTextFile(
  new URL("build-report.json", out),
  `${
    JSON.stringify(
      { built_at: new Date().toISOString(), products: report },
      null,
      2,
    )
  }\n`,
);
console.log(JSON.stringify(report, null, 2));
