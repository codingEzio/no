import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

Deno.test("regular packaging preserves existing candidates and excludes private defaults", async () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  await Deno.mkdir(join(root, "Local"), { recursive: true });
  const fixture = await Deno.makeTempDir({
    dir: join(root, "Local"),
    prefix: "package-local-test-",
  });
  const write = async (path: string, data: string | Uint8Array) => {
    const target = join(fixture, path);
    await Deno.mkdir(dirname(target), { recursive: true });
    await Deno.writeFile(
      target,
      typeof data === "string" ? new TextEncoder().encode(data) : data,
    );
  };
  const run = (script: string) =>
    new Deno.Command("deno", {
      cwd: fixture,
      args: [
        "run",
        "--no-config",
        "--no-lock",
        "--allow-read",
        "--allow-write=Local",
        "--allow-run=deno",
        `scripts/${script}`,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
  const parse = (result: Deno.CommandOutput) => {
    assert.equal(result.code, 0, new TextDecoder().decode(result.stderr));
    return JSON.parse(new TextDecoder().decode(result.stdout));
  };
  try {
    const selection = JSON.parse(
      await Deno.readTextFile(join(root, "public-source.json")),
    );
    for (const path of selection.files as string[]) {
      await write(path, await Deno.readFile(join(root, path)));
    }
    await write(
      "extension_chrome/private-defaults.json",
      '{"domains":["private.example"]}',
    );
    await write(
      "Local/private-defaults.json",
      '{"domains":["private.example"]}',
    );

    // Concurrent builders either share a completed matching result or claim separate directories.
    const [a, b] = await Promise.all([
      run("package_local.ts"),
      run("package_local.ts"),
    ]);
    const built = [parse(a), parse(b)];
    for (const r of built) {
      await assert.rejects(
        Deno.lstat(join(r.output, "extension_chrome/private-defaults.json")),
        Deno.errors.NotFound,
      );
      assert.equal(r.readback, "exact");
    }
    const privateBytes = new TextEncoder().encode(
      '{"domains":["private.example"]}',
    );
    const privateHash = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", privateBytes)),
    ]
      .map((n) => n.toString(16).padStart(2, "0")).join("");
    for (const result of built) {
      const text = await Deno.readTextFile(join(result.output, "receipt.json"));
      assert(!text.includes("private.example") && !text.includes(privateHash));
    }
    const paths = [...new Set(built.map((r) => r.output as string))];
    const firstReceipt = await Deno.readTextFile(
      join(paths[0], "receipt.json"),
    );
    const firstStat = await Deno.stat(join(paths[0], "receipt.json"));
    const again = parse(await run("package_local.ts"));
    assert(
      again.reused && paths.includes(again.output),
      "complete candidate must be reused",
    );
    assert.equal(
      await Deno.readTextFile(join(paths[0], "receipt.json")),
      firstReceipt,
    );
    assert.equal(
      (await Deno.stat(join(paths[0], "receipt.json"))).mtime?.getTime(),
      firstStat.mtime?.getTime(),
    );

    // A mode-altered candidate is not identical and must not be repaired in place.
    for (const path of paths) {
      await Deno.chmod(join(path, "extension_chrome/manifest.json"), 0o644);
    }
    const modeCandidate = parse(await run("package_local.ts"));
    assert(!modeCandidate.reused && !paths.includes(modeCandidate.output));
    for (const path of paths) {
      assert.equal(
        (await Deno.stat(join(path, "extension_chrome/manifest.json"))).mode! &
          0o777,
        0o644,
      );
    }
    paths.push(modeCandidate.output);

    // Preserve legacy/modified receipts, a symlink target and an interrupted candidate.
    for (const path of paths) {
      await Deno.writeTextFile(
        join(path, "receipt.json"),
        "legacy receipt sentinel\n",
      );
    }
    const prefix = paths[0].replace(/-\d\d$/, "");
    const occupied = new Set(paths);
    const slot = (n: number) =>
      prefix + (n === 0 ? "" : `-${String(n).padStart(2, "0")}`);
    const free = Array.from({ length: 32 }, (_, i) => slot(i)).filter((p) =>
      !occupied.has(p)
    );
    const external = join(fixture, "outside");
    await Deno.mkdir(external);
    await Deno.writeTextFile(join(external, "sentinel"), "retain outside\n");
    await Deno.symlink(external, free[0]);
    await Deno.mkdir(free[1]);
    await Deno.writeTextFile(join(free[1], "interrupted"), "retain partial\n");
    const recovered = parse(await run("package_local.ts"));
    assert(
      !recovered.reused && recovered.output === free[2],
      "must claim the next exclusive slot",
    );
    for (const path of paths) {
      assert.equal(
        await Deno.readTextFile(join(path, "receipt.json")),
        "legacy receipt sentinel\n",
      );
    }
    assert.equal(
      await Deno.readTextFile(join(external, "sentinel")),
      "retain outside\n",
    );
    assert.deepEqual(
      [...await Array.fromAsync(Deno.readDir(external))].map((entry) =>
        entry.name
      ).sort(),
      ["sentinel"],
    );
    assert.equal(
      await Deno.readTextFile(join(free[1], "interrupted")),
      "retain partial\n",
    );

    // The bounded limit refuses further work without touching existing entries.
    await Deno.writeTextFile(
      join(recovered.output, "receipt.json"),
      "another old receipt\n",
    );
    for (const path of free.slice(3)) await Deno.mkdir(path);
    const exhausted = await run("package_local.ts");
    assert.notEqual(exhausted.code, 0);
    assert.match(new TextDecoder().decode(exhausted.stderr), /32 attempts/);
    assert.equal(
      await Deno.readTextFile(join(recovered.output, "receipt.json")),
      "another old receipt\n",
    );

    const publicResult = parse(await run("public_build.ts"));
    await assert.rejects(
      Deno.lstat(
        join(
          fixture,
          publicResult.output,
          "extension_chrome/private-defaults.json",
        ),
      ),
      Deno.errors.NotFound,
    );
    const publicReceipt = await Deno.readTextFile(
      join(fixture, publicResult.output, "receipt.json"),
    );
    assert(
      !publicReceipt.includes("private.example") &&
        !publicReceipt.includes(privateHash),
    );
    const privateResult = parse(await run("private_build.ts"));
    assert.deepEqual(
      JSON.parse(
        await Deno.readTextFile(
          join(privateResult.output, "extension_chrome/private-defaults.json"),
        ),
      ),
      { domains: ["private.example"] },
    );

    // Both parent symlink boundaries must fail before writing through them.
    await Deno.rename(join(fixture, "Local"), join(fixture, "Local-saved"));
    await Deno.symlink(external, join(fixture, "Local"));
    let denied = await run("package_local.ts");
    assert.notEqual(denied.code, 0);
    assert.match(new TextDecoder().decode(denied.stderr), /real directory/);
    assert.equal(
      await Deno.readTextFile(join(external, "sentinel")),
      "retain outside\n",
    );
    assert.deepEqual(
      [...await Array.fromAsync(Deno.readDir(external))].map((entry) =>
        entry.name
      ).sort(),
      ["sentinel"],
    );
    await Deno.remove(join(fixture, "Local"));
    await Deno.rename(join(fixture, "Local-saved"), join(fixture, "Local"));
    await Deno.rename(
      join(fixture, "Local/candidates"),
      join(fixture, "Local/candidates-saved"),
    );
    await Deno.symlink(external, join(fixture, "Local/candidates"));
    denied = await run("package_local.ts");
    assert.notEqual(denied.code, 0);
    assert.match(new TextDecoder().decode(denied.stderr), /real directory/);
    assert.equal(
      await Deno.readTextFile(join(external, "sentinel")),
      "retain outside\n",
    );
    assert.deepEqual(
      [...await Array.fromAsync(Deno.readDir(external))].map((entry) =>
        entry.name
      ).sort(),
      ["sentinel"],
    );
  } finally {
    await Deno.remove(fixture, { recursive: true });
  }
});
