// Four desktop-source ports; old VIA wrapper build.ts remains for recovery.
import {
  checkCalmlyFontPackage,
  checkCalmlyXpiSize,
} from "../scripts/calmly_package_guard.ts";
import {
  adaptManifest,
  adaptSource,
  fontLoader,
  products,
} from "./desktop_adapter.ts";
const project = new URL("../", import.meta.url);
const owner = await Deno.readTextFile(new URL("product.json", project)).then(JSON.parse).catch(e => {if(e instanceof Deno.errors.NotFound) return null; throw e;});
const desktop = Deno.args.includes("--desktop");
const only = Deno.args.find((arg) => arg.startsWith("--only="))?.slice(7) ?? owner?.firefox;
if (owner && only !== owner.firefox) throw Error("This repository owns only " + owner.firefox);
if (only && !products.some((product) => product.slug === only)) {
  throw new Error("Unknown product");
}
if (desktop && only !== "bookmark") {
  throw new Error("Desktop target currently supports --only=bookmark");
}
const output = Deno.args[0] && !Deno.args[0].startsWith("--")
  ? new URL(`${Deno.args[0].replace(/\/$/u, "")}/`, `file://${Deno.cwd()}/`)
  : new URL("Local/firefox-android/desktop-candidate/", project);
if (!output.href.startsWith(new URL("Local/", project).href)) {
  throw new Error("Output must stay in project Local");
}
try {
  await Deno.stat(new URL("build-report.json", output));
  throw new Error("Use a fresh candidate directory");
} catch (e) {
  if (!(e instanceof Deno.errors.NotFound)) throw e;
}
await Deno.mkdir(output, { recursive: true });
const hash = async (bytes: Uint8Array) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)),
    ),
  ].map((n) => n.toString(16).padStart(2, "0")).join("");
const report = [];
const tooling = Object.fromEntries(
  await Promise.all(
    [
      "build_extensions.ts",
      "desktop_adapter.ts",
      "../scripts/calmly_package_guard.ts",
    ].map(async (path) => [
      path,
      await hash(await Deno.readFile(new URL(path, import.meta.url))),
    ]),
  ),
);
for (
  const product of products.filter((product) => !only || product.slug === only)
) {
  const source = new URL(owner ? "extension_chrome/" : `${product.source}/`, project);
  const target = new URL(`${product.slug}/`, output);
  const fontPackage = product.slug === "calmly"
    ? await checkCalmlyFontPackage(source)
    : undefined;
  await Deno.mkdir(target, { recursive: true });
  const original = JSON.parse(
    await Deno.readTextFile(new URL("manifest.json", source)),
  );
  const manifest = adaptManifest(original, product, desktop);
  const files: string[] = [];
  const inputs: Record<string, string> = {};
  const copy = async (dir: URL, prefix = "") => {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.name === ".DS_Store") continue;
      if (entry.isSymlink) throw new Error("Package refuses symlinks");
      const path = prefix + entry.name;
      if (entry.isDirectory) {
        await Deno.mkdir(new URL(`${path}/`, target), { recursive: true });
        await copy(new URL(`${entry.name}/`, dir), `${path}/`);
      } else if (entry.isFile) {
        const bytes = await Deno.readFile(new URL(entry.name, dir));
        inputs[path] = await hash(bytes);
        files.push(path);
        if (path === "manifest.json") {
          await Deno.writeTextFile(
            new URL(path, target),
            JSON.stringify(manifest, null, 2) + "\n",
          );
        } else if (/\.(js|css|html)$/u.test(path)) {
          await Deno.writeTextFile(
            new URL(path, target),
            adaptSource(
              product,
              path,
              new TextDecoder().decode(bytes),
              desktop,
            ),
          );
        } else await Deno.writeFile(new URL(path, target), bytes);
      }
    }
  };
  await copy(source);
  if (product.slug === "calmly") {
    const loader = fontLoader(
      await Deno.readTextFile(new URL("fonts.css", source)),
    );
    await Deno.writeTextFile(new URL("firefox-fonts.js", target), loader);
    files.push("firefox-fonts.js");
    const note =
      `(() => { const label = { en: 'Firefox Android: X + Content Rules. Other sites are not available yet.', zh_CN: 'Firefox Android：X 和 Content Rules 已提供；其他网站尚未开放。', zh_TW: 'Firefox Android：X 與 Content Rules 已提供；其他網站尚未開放。', ja: 'Firefox Android：X と Content Rules。その他のサイトは未対応です。', ko: 'Firefox Android: X와 Content Rules. 다른 사이트는 아직 지원하지 않습니다.', es: 'Firefox Android: X y Content Rules. Los demás sitios aún no están disponibles.', ru: 'Firefox Android: X и Content Rules. Другие сайты пока недоступны.', uk: 'Firefox Android: X і Content Rules. Інші сайти поки недоступні.' }; const language = globalThis.CalmlyI18n; const paint = () => { const lang = language.locale.replace('-', '_'); document.getElementById('firefox-scope').textContent = label[lang] || label.en; }; language.subscribe(paint); paint(); })();\n`;
    await Deno.writeTextFile(new URL("firefox-scope.js", target), note);
    files.push("firefox-scope.js");
    const popup = new URL("popup.html", target);
    await Deno.writeTextFile(
      popup,
      (await Deno.readTextFile(popup)).replace(
        "</body>",
        '<script src="firefox-scope.js"></script></body>',
      ),
    );
  }
  const xpi = new URL(
    `${product.slug}-${manifest.version}-unsigned.xpi`,
    output,
  );
  try {
    await Deno.stat(xpi);
    throw new Error("Refusing stale XPI");
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const zipArgs = ["-q", "-X", xpi.pathname, ...files.sort()];
  const android = Deno.build.target.endsWith("-android");
  // Android requires its system linker for Termux executables without LD_PRELOAD.
  // The shell resolves zip before removing preload; Deno.execPath can report the loader.
  const zipPath = Deno.args.find((arg) => arg.startsWith("--zip-path="))?.slice(11);
  if (android && (!zipPath?.startsWith("/") || !zipPath.endsWith("/zip"))) {
    throw new Error("Native Android packaging requires the absolute zip path from its shell entrypoint");
  }
  const zip = await new Deno.Command(android ? "/system/bin/linker64" : "zip", {
    cwd: target,
    args: android ? [zipPath!, ...zipArgs] : zipArgs,
    ...(android ? { clearEnv: true, env: {} } : {}),
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!zip.success) throw new Error(new TextDecoder().decode(zip.stderr));
  const xpiBytes = (await Deno.stat(xpi)).size;
  if (product.slug === "calmly") checkCalmlyXpiSize(xpiBytes);
  report.push({
    product: product.slug,
    id: product.id,
    version: manifest.version,
    source_version: original.version,
    source: product.source,
    source_files_sha256: inputs,
    output: target.pathname,
    xpi: xpi.pathname,
    xpi_bytes: xpiBytes,
    font_package: fontPackage,
    xpi_sha256: await hash(await Deno.readFile(xpi)),
    signed: false,
    installed: false,
    files,
  });
}
await Deno.writeTextFile(
  new URL("build-report.json", output),
  JSON.stringify(
    {
      built_at: new Date().toISOString(),
      platform: desktop ? "desktop" : "android",
      tooling_sha256: tooling,
      products: report,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    report.map(({ product, id, version, xpi, xpi_sha256 }) => ({
      product,
      id,
      version,
      xpi,
      xpi_sha256,
    })),
    null,
    2,
  ),
);
