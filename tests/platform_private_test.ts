import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

Deno.test("Safari and Firefox source generation exclude private Chrome defaults", async () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  await Deno.mkdir(join(root, "Local"), { recursive: true });
  const fixture = await Deno.makeTempDir({
    dir: join(root, "Local"),
    prefix: "platform-private-",
  });
  const write = async (p: string, data: string | Uint8Array) => {
    const dest = join(fixture, p);
    await Deno.mkdir(dirname(dest), { recursive: true });
    await Deno.writeFile(
      dest,
      typeof data === "string" ? new TextEncoder().encode(data) : data,
    );
  };
  const copy = async (p: string) =>
    await write(p, await Deno.readFile(join(root, p)));
  const run = (args: string[]) =>
    new Deno.Command("deno", {
      cwd: fixture,
      args: [
        "run",
        "--no-config",
        "--no-lock",
        "--allow-read",
        "--allow-write=Local,extension_safari",
        "--allow-run=zip",
        ...args,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
  try {
    for (
      const p of [
        "scripts/sync_safari.ts",
        "scripts/calmly_package_guard.ts",
        "extension_firefox/build_extensions.ts",
        "extension_firefox/desktop_adapter.ts",
      ]
    ) await copy(p);
    await write(
      "scripts/sync_bookmark_source_policy.ts",
      "export async function syncBookmarkSourcePolicy() {}\n",
    );
    await write(
      "scripts/sync_capture_menu.ts",
      "export async function syncCaptureMenuSettings() {}\n",
    );
    await write("product.json", JSON.stringify({ firefox: "no" }));
    await write(
      "products.json",
      JSON.stringify({
        safariBuilds: [{
          id: "no",
          sourceRoot: "extension_chrome",
          webRoot: "extension_safari/web-extension",
          hostRoot: "extension_safari/host",
          appName: "no",
          installApp: "no.app",
          hostBundleId: "example.host",
          extensionBundleId: "example.host.extension",
          handler: "default",
        }],
      }),
    );
    const names = Array.from({ length: 9 }, (_, i) => `font-${i}.woff2`);
    const font = new TextEncoder().encode("wOF2 synthetic");
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", font)),
    ].map((n) => n.toString(16).padStart(2, "0")).join("");
    for (const name of names) {
      await write(`extension_chrome/ui-fonts/browser/${name}`, font);
    }
    await write(
      "extension_chrome/ui-fonts/browser-font-manifest.json",
      JSON.stringify({
        schemaVersion: 1,
        mode: "browser-v1",
        fonts: names.slice(0, 7).map((file) => ({ file })),
        emoji: { files: { default: names[7], android: names[8] } },
        assets: names.map((file) => ({
          file,
          sha256: hash,
          bytes: font.length,
        })),
      }),
    );
    await write(
      "extension_chrome/manifest.json",
      JSON.stringify({
        manifest_version: 3,
        name: "fixture",
        version: "1.0.0",
        background: { service_worker: "background.js" },
        permissions: [],
        host_permissions: [],
        content_scripts: [],
        web_accessible_resources: [],
      }),
    );
    await write("extension_chrome/background.js", "// synthetic\n");
    await write(
      "extension_chrome/private-defaults.json",
      '{"domains":["sentinel.example"]}',
    );
    let result = await run(["scripts/sync_safari.ts", "--only", "no"]);
    assert.equal(result.code, 0, new TextDecoder().decode(result.stderr));
    await assert.rejects(
      Deno.stat(
        join(fixture, "extension_safari/web-extension/private-defaults.json"),
      ),
      Deno.errors.NotFound,
    );
    await write(
      "extension_safari/web-extension/private-defaults.json",
      "stale private file",
    );
    result = await run(["scripts/sync_safari.ts", "--only", "no", "--check"]);
    assert.notEqual(result.code, 0, "check must detect a stale private target");
    result = await run([
      "scripts/sync_safari.ts",
      "--version-only",
      "--only",
      "no",
      "--check",
    ]);
    assert.notEqual(
      result.code,
      0,
      "prepared-source build must reject a stale private target",
    );
    assert.match(
      new TextDecoder().decode(result.stderr),
      /private defaults present/,
    );
    result = await run([
      "extension_firefox/build_extensions.ts",
      "Local/firefox",
      "--only=no",
    ]);
    assert.equal(result.code, 0, new TextDecoder().decode(result.stderr));
    await assert.rejects(
      Deno.stat(join(fixture, "Local/firefox/no/private-defaults.json")),
      Deno.errors.NotFound,
    );
    const report = await Deno.readTextFile(
      join(fixture, "Local/firefox/build-report.json"),
    );
    assert(
      !report.includes("private-defaults.json") &&
        !report.includes("sentinel.example"),
    );
    const listed = await new Deno.Command("unzip", {
      args: ["-Z1", join(fixture, "Local/firefox/no-1.0.0-unsigned.xpi")],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert.equal(listed.code, 0);
    assert(
      !new TextDecoder().decode(listed.stdout).includes(
        "private-defaults.json",
      ),
    );
  } finally {
    await Deno.remove(fixture, { recursive: true });
  }
});
