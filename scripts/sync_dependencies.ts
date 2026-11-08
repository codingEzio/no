// Explicit local dependency update; normal checks/builds never consult siblings.
import { dirname, fromFileUrl, join, resolve } from "./paths.ts";
import { sha256 } from "./verify.ts";
const root = dirname(dirname(fromFileUrl(import.meta.url)));
const owner = Deno.args.find((a) => a.startsWith("--owner="))?.slice(8);
if (!owner) {
  throw Error(
    "Choose one recorded owner with --owner=X-ExtShared (or A-Prometheus)",
  );
}
const workspace = resolve(
  Deno.args.find((a) => a.startsWith("--workspace="))?.slice(12) ??
    join(root, ".."),
);
const path = join(root, "dependencies.lock.json");
const lock = JSON.parse(await Deno.readTextFile(path));
const selected = lock.files.filter((f: { owner: string }) => f.owner === owner);
if (!selected.length) throw Error("No pinned inputs for that owner");
const inputs = await Promise.all(
  selected.map(async (f: { source: string; path: string }) => {
    for (const value of [f.source, f.path]) {
      if (value.startsWith("/") || value.split("/").includes("..")) {
        throw Error("Dependency paths must remain within their owner");
      }
    }
    const bytes = await Deno.readFile(join(workspace, owner, f.source));
    return { file: f, bytes, hash: await sha256(bytes) };
  }),
);
for (const { file, bytes, hash } of inputs) {
  const target = join(root, file.path);
  await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), {
    recursive: true,
  });
  await Deno.writeFile(target, bytes);
  if (await sha256(await Deno.readFile(join(root, file.path))) !== hash) {
    throw Error("Dependency readback failed");
  }
  file.sha256 = hash;
}
await Deno.writeTextFile(path, JSON.stringify(lock, null, 2) + "\n");
console.log(
  `Synchronized ${inputs.length} pinned files from ${owner}. Run deno task check before committing.`,
);
