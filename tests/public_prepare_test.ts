import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

Deno.test("public source index and immutable candidate boundaries", async () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  await Deno.mkdir(join(root, "Local"), { recursive: true });
  const directory = await Deno.makeTempDir({
    dir: join(root, "Local"),
    prefix: "delete_after_use_public_",
  });
  const script = await Deno.readFile(
    new URL("../scripts/public_prepare.ts", import.meta.url),
  );
  async function command(executable: string, args: string[]) {
    return await new Deno.Command(executable, {
      cwd: directory,
      args,
      stdout: "piped",
      stderr: "piped",
    }).output();
  }
  async function git(...args: string[]) {
    const result = await command("git", args);
    assert.equal(result.code, 0);
  }
  const prepare = () =>
    command("deno", [
      "run",
      "--no-config",
      "--no-lock",
      "--allow-read",
      "--allow-write=Local",
      "--allow-run=git",
      "scripts/public_prepare.ts",
      "--prepare",
    ]);
  try {
    await Deno.mkdir(join(directory, "scripts"));
    await Deno.writeFile(join(directory, "scripts/public_prepare.ts"), script);
    await Deno.writeTextFile(join(directory, "README.md"), "Public source.\n");
    await Deno.writeTextFile(
      join(directory, "product.json"),
      JSON.stringify({ fontPolicy: "system" }),
    );
    await Deno.writeTextFile(
      join(directory, "public-source.json"),
      JSON.stringify({
        schemaVersion: 1,
        releaseStatus: "source-authorized",
        limitations: ["fixture"],
        files: ["README.md", "public-source.json"],
      }),
    );
    await git("init", "-q");
    await git("add", "README.md", "public-source.json", "product.json");
    // Unselected local evidence must never enter an exported candidate.
    await Deno.mkdir(join(directory, "Local"));
    await Deno.writeTextFile(
      join(directory, "product.json"),
      JSON.stringify({ fontPolicy: "unknown" }),
    );
    await git("add", "product.json");
    const unknown = await prepare();
    assert.notEqual(unknown.code, 0);
    assert.match(
      new TextDecoder().decode(unknown.stderr),
      /Unsupported font policy/,
    );
    await Deno.writeTextFile(
      join(directory, "product.json"),
      JSON.stringify({ fontPolicy: "glyphgrove" }),
    );
    await git("add", "product.json");
    const review = await command("deno", [
      "run",
      "--no-config",
      "--no-lock",
      "--allow-read",
      "--allow-write=Local",
      "--allow-run=git",
      "scripts/public_prepare.ts",
      "--local-review",
    ]);
    assert.equal(review.code, 0, new TextDecoder().decode(review.stderr));
    const reviewPath = new TextDecoder().decode(review.stdout).match(
      /Candidate: (Local\/local-review-source\/[a-f0-9]{64})/,
    )![1];
    const reviewReceipt = JSON.parse(
      await Deno.readTextFile(
        join(directory, reviewPath, "SOURCE-RECEIPT.json"),
      ),
    );
    assert.equal(reviewReceipt.releaseReady, false);
    assert.equal(reviewReceipt.scope, "local-review-only");
    await Deno.writeTextFile(
      join(directory, "product.json"),
      JSON.stringify({ fontPolicy: "system" }),
    );
    await Deno.writeTextFile(
      join(directory, "Local/private.txt"),
      "private fixture",
    );
    await git("add", "product.json");
    const originalConfig = await Deno.readTextFile(
      join(directory, "public-source.json"),
    );
    for (const invalid of ["bad\tfile", "bad\nfile"]) {
      const config = JSON.parse(originalConfig);
      config.files.push(invalid);
      await Deno.writeTextFile(join(directory, invalid), "fixture");
      await Deno.writeTextFile(
        join(directory, "public-source.json"),
        JSON.stringify(config),
      );
      await git("add", "public-source.json", invalid);
      const rejected = await prepare();
      assert.notEqual(rejected.code, 0, "control-character path must fail");
      assert.match(
        new TextDecoder().decode(rejected.stderr),
        /Invalid selected source path/,
      );
      await git("rm", "--cached", "--", invalid);
      await Deno.remove(join(directory, invalid));
    }
    await Deno.writeTextFile(
      join(directory, "public-source.json"),
      originalConfig,
    );
    await git("add", "public-source.json");
    const first = await prepare();
    assert.equal(first.code, 0, new TextDecoder().decode(first.stderr));
    const output = new TextDecoder().decode(first.stdout).match(
      /Candidate: (Local\/public-source\/[a-f0-9]{64})/,
    )![1];
    const candidate = join(directory, output);
    assert.equal((await prepare()).code, 0, "identical candidate is reusable");
    await Deno.writeTextFile(join(candidate, "extra.txt"), "extra");
    assert.notEqual((await prepare()).code, 0, "unexpected file must fail");
    await Deno.remove(join(candidate, "extra.txt"));
    await Deno.writeTextFile(join(candidate, "README.md"), "tampered");
    assert.notEqual((await prepare()).code, 0, "tampered candidate must fail");
    assert.equal(
      await Deno.readTextFile(join(candidate, "README.md")),
      "tampered",
      "failed candidate is not overwritten",
    );
    await Deno.writeTextFile(join(candidate, "README.md"), "Public source.\n");
    await Deno.chmod(join(candidate, "README.md"), 0o755);
    assert.notEqual((await prepare()).code, 0, "mode mismatch must fail");
    await Deno.chmod(join(candidate, "README.md"), 0o644);
    await Deno.rename(
      join(directory, "Local/public-source"),
      join(directory, "Local/retained"),
    );
    await Deno.symlink("retained", join(directory, "Local/public-source"));
    assert.notEqual(
      (await prepare()).code,
      0,
      "symlinked candidate parent must fail",
    );
    await Deno.remove(join(directory, "Local/public-source"));
    await Deno.rename(
      join(directory, "Local/retained"),
      join(directory, "Local/public-source"),
    );
    await Deno.writeTextFile(
      join(directory, "README.md"),
      "/" + "Users/fixture/private\n",
    );
    await git("add", "README.md");
    await Deno.writeTextFile(
      join(directory, "README.md"),
      "clean working file\n",
    );
    assert.notEqual(
      (await prepare()).code,
      0,
      "index secret must fail despite clean working file",
    );
    await Deno.remove(join(directory, "README.md"));
    await Deno.symlink("public-source.json", join(directory, "README.md"));
    await git("add", "README.md");
    assert.notEqual((await prepare()).code, 0, "indexed symlink must fail");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
