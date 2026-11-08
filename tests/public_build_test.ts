import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

Deno.test("synthetic independent build preserves policy and source boundaries", async () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  await Deno.mkdir(join(root, "Local"), { recursive: true });
  const fixture = await Deno.makeTempDir({
    dir: join(root, "Local"),
    prefix: "synthetic-build-",
  });
  const write = async (path: string, data: string) => {
    await Deno.mkdir(dirname(join(fixture, path)), { recursive: true });
    await Deno.writeTextFile(join(fixture, path), data, { createNew: true });
  };
  const hash = async (data: Uint8Array) =>
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", Uint8Array.from(data)),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
  const key = btoa("synthetic key");
  const digest = await hash(new TextEncoder().encode("synthetic key"));
  const chromeId = [...digest.slice(0, 32)].map((c) =>
    String.fromCharCode(97 + parseInt(c, 16))
  ).join("");
  const product = {
    name: "fixture",
    version: "1.0.0",
    chromeId,
    fontPolicy: "system",
  };
  const files = [
    "product.json",
    "public-source.json",
    "dependencies.lock.json",
    "extension_chrome/manifest.json",
    "shared/fixture.txt",
    "scripts/public_build.ts",
    "scripts/verify.ts",
    "scripts/paths.ts",
    "scripts/calmly_package_guard.ts",
  ];
  const safariRoot = "extension_safari/web-extension/ui-fonts";
  const fontNames = Array.from({ length: 9 }, (_, i) => `font-${i}.woff2`);
  files.push(
    `${safariRoot}/browser-font-manifest.json`,
    ...fontNames.map((name) => `${safariRoot}/browser/${name}`),
  );
  const fontBytes = "wOF2 synthetic";
  const fontHash = await hash(new TextEncoder().encode(fontBytes));
  for (const name of fontNames) {
    await write(`${safariRoot}/browser/${name}`, fontBytes);
  }
  await write(
    `${safariRoot}/browser-font-manifest.json`,
    JSON.stringify({
      schemaVersion: 1,
      mode: "browser-v1",
      fonts: fontNames.slice(0, 7).map((file) => ({ file })),
      emoji: { files: { default: fontNames[7], android: fontNames[8] } },
      assets: fontNames.map((file) => ({
        file,
        sha256: fontHash,
        bytes: fontBytes.length,
      })),
    }),
  );
  const safariFontManifestSha256 = await hash(
    await Deno.readFile(
      join(fixture, safariRoot, "browser-font-manifest.json"),
    ),
  );
  for (const path of files.filter((path) => path.startsWith("scripts/"))) {
    await Deno.mkdir(dirname(join(fixture, path)), { recursive: true });
    await Deno.copyFile(join(root, path), join(fixture, path));
  }
  await write("product.json", JSON.stringify(product));
  await write(
    "extension_chrome/manifest.json",
    JSON.stringify({ name: "fixture", version: product.version, key }),
  );
  await write("shared/fixture.txt", "synthetic pin");
  await write(
    "dependencies.lock.json",
    JSON.stringify({
      files: [
        {
          path: "shared/fixture.txt",
          sha256: await hash(new TextEncoder().encode("synthetic pin")),
        },
        { path: "extension_firefox/README.md" },
        { path: "extension_firefox/PLAN.md" },
      ],
    }),
  );
  await write(
    "public-source.json",
    JSON.stringify({ schemaVersion: 1, files, safariFontManifestSha256 }),
  );
  const run = () =>
    new Deno.Command("deno", {
      cwd: fixture,
      args: [
        "run",
        "--no-config",
        "--no-lock",
        "--allow-read",
        "--allow-write=Local",
        "scripts/public_build.ts",
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
  try {
    await Deno.writeTextFile(
      join(fixture, "product.json"),
      JSON.stringify({ ...product, fontPolicy: "unknown" }),
    );
    const unknown = await run();
    assert.notEqual(unknown.code, 0);
    assert.match(
      new TextDecoder().decode(unknown.stderr),
      /Unsupported font policy/,
    );
    await Deno.writeTextFile(
      join(fixture, "product.json"),
      JSON.stringify({ ...product, fontPolicy: "glyphgrove" }),
    );
    const chromeFontRoot = "extension_chrome/ui-fonts";
    const chromeFontPaths = [
      `${chromeFontRoot}/browser-font-manifest.json`,
      ...fontNames.map((name) => `${chromeFontRoot}/browser/${name}`),
    ];
    for (const path of chromeFontPaths) {
      const sourcePath = path.replace(chromeFontRoot, safariRoot);
      await Deno.mkdir(dirname(join(fixture, path)), { recursive: true });
      await Deno.copyFile(join(fixture, sourcePath), join(fixture, path));
    }
    await Deno.writeTextFile(
      join(fixture, "public-source.json"),
      JSON.stringify({
        schemaVersion: 1,
        safariFontManifestSha256,
        files: [...files, ...chromeFontPaths],
      }),
    );
    for (const policy of ["browser-v1", undefined]) {
      await Deno.writeTextFile(
        join(fixture, "product.json"),
        JSON.stringify({ ...product, fontPolicy: policy }),
      );
      const legacy = await run();
      assert.equal(legacy.code, 0, new TextDecoder().decode(legacy.stderr));
    }
    await Deno.remove(join(fixture, chromeFontRoot), { recursive: true });
    await Deno.writeTextFile(
      join(fixture, "public-source.json"),
      JSON.stringify({ schemaVersion: 1, files, safariFontManifestSha256 }),
    );
    await Deno.writeTextFile(
      join(fixture, "product.json"),
      JSON.stringify(product),
    );
    const first = await run();
    assert.equal(first.code, 0, new TextDecoder().decode(first.stderr));
    const correlatedManifest = join(
      fixture,
      safariRoot,
      "browser-font-manifest.json",
    );
    const originalManifest = await Deno.readTextFile(correlatedManifest);
    const changedBytes = "wOF2 modified";
    const modified = JSON.parse(originalManifest);
    modified.assets[0].sha256 = await hash(
      new TextEncoder().encode(changedBytes),
    );
    modified.assets[0].bytes = changedBytes.length;
    await Deno.writeTextFile(
      join(fixture, safariRoot, "browser", fontNames[0]),
      changedBytes,
    );
    await Deno.writeTextFile(correlatedManifest, JSON.stringify(modified));
    const correlated = await run();
    assert.notEqual(
      correlated.code,
      0,
      "paired manifest and font mutation must fail",
    );
    assert.match(
      new TextDecoder().decode(correlated.stderr),
      /Safari font manifest differs from selected pin/,
    );
    await Deno.writeTextFile(
      join(fixture, safariRoot, "browser", fontNames[0]),
      fontBytes,
    );
    await Deno.writeTextFile(correlatedManifest, originalManifest);
    const receipt = JSON.parse(new TextDecoder().decode(first.stdout));
    assert.equal(receipt.sourceReceipt, "absent");
    const sourceFiles = await Promise.all(files.map(async (path) => {
      const data = await Deno.readFile(join(fixture, path));
      const stat = await Deno.stat(join(fixture, path));
      return {
        path,
        mode: (stat.mode! & 0o111) ? "100755" : "100644",
        bytes: data.length,
        sha256: await hash(data),
      };
    }));
    const sourceSeal = await hash(
      new TextEncoder().encode(JSON.stringify(sourceFiles)),
    );
    const sourceReceiptPath = join(fixture, "SOURCE-RECEIPT.json");
    await Deno.writeTextFile(
      sourceReceiptPath,
      JSON.stringify({
        schemaVersion: 1,
        seal: sourceSeal,
        files: sourceFiles,
      }),
      { createNew: true },
    );
    const verified = await run();
    assert.equal(verified.code, 0, new TextDecoder().decode(verified.stderr));
    assert.equal(
      JSON.parse(new TextDecoder().decode(verified.stdout)).sourceReceipt,
      "verified",
    );
    const pathsFile = join(fixture, "scripts/paths.ts");
    const originalPaths = await Deno.readTextFile(pathsFile);
    await Deno.writeTextFile(pathsFile, originalPaths + "\n");
    const changed = await run();
    assert.notEqual(changed.code, 0);
    assert.match(
      new TextDecoder().decode(changed.stderr),
      /Source receipt mismatch: scripts\/paths.ts/,
    );
    await Deno.writeTextFile(pathsFile, originalPaths);
    await Deno.remove(sourceReceiptPath);
    assert.equal(receipt.releaseReady, false);
    assert.deepEqual(receipt.omittedPinnedDocumentation, [
      "extension_firefox/PLAN.md",
      "extension_firefox/README.md",
    ]);
    assert.equal((await run()).code, 0);
    const safariManifest = join(
      fixture,
      safariRoot,
      "browser-font-manifest.json",
    );
    const safariManifestBytes = await Deno.readFile(safariManifest);
    await Deno.remove(safariManifest);
    assert.notEqual((await run()).code, 0, "missing Safari manifest fails");
    await Deno.writeFile(safariManifest, safariManifestBytes, {
      createNew: true,
    });
    const safariFont = join(fixture, safariRoot, "browser", fontNames[0]);
    await Deno.writeTextFile(safariFont, "tampered");
    const safariFailure = await run();
    assert.notEqual(safariFailure.code, 0);
    assert.match(
      new TextDecoder().decode(safariFailure.stderr),
      /Browser asset differs from provenance/,
    );
    await Deno.writeTextFile(safariFont, fontBytes);
    await Deno.writeTextFile(join(fixture, "shared/fixture.txt"), "tampered");
    assert.notEqual((await run()).code, 0);
    await Deno.writeTextFile(
      join(fixture, "shared/fixture.txt"),
      "synthetic pin",
    );
    await Deno.writeTextFile(
      join(fixture, "product.json"),
      JSON.stringify({ ...product, chromeId: "wrong" }),
    );
    assert.notEqual((await run()).code, 0);
    await Deno.writeTextFile(
      join(fixture, "product.json"),
      JSON.stringify(product),
    );
    await Deno.writeTextFile(
      join(fixture, "public-source.json"),
      JSON.stringify({
        schemaVersion: 1,
        safariFontManifestSha256,
        files: files.filter((path) => path !== "shared/fixture.txt"),
      }),
    );
    assert.notEqual((await run()).code, 0);
    await Deno.writeTextFile(
      join(fixture, "public-source.json"),
      JSON.stringify({ schemaVersion: 1, files, safariFontManifestSha256 }),
    );
    await Deno.writeTextFile(
      join(fixture, "extension_chrome/unexpected.woff2"),
      "synthetic font",
    );
    const selectionPath = join(fixture, "public-source.json");
    await Deno.writeTextFile(
      selectionPath,
      JSON.stringify({
        schemaVersion: 1,
        safariFontManifestSha256,
        files: [...files, "extension_chrome/unexpected.woff2"],
      }),
    );
    const font = await run();
    assert.notEqual(font.code, 0);
    assert.match(
      new TextDecoder().decode(font.stderr),
      /must not bundle font files/,
    );
    await Deno.remove(join(fixture, "extension_chrome/unexpected.woff2"));
    await Deno.writeTextFile(
      selectionPath,
      JSON.stringify({ schemaVersion: 1, files, safariFontManifestSha256 }),
    );
    await Deno.writeTextFile(
      join(fixture, receipt.output, "extra.txt"),
      "unexpected",
    );
    assert.notEqual((await run()).code, 0);
    assert.equal(
      await Deno.readTextFile(join(fixture, receipt.output, "extra.txt")),
      "unexpected",
    );
  } finally {
    await Deno.remove(fixture, { recursive: true });
  }
});
