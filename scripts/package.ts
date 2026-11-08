// Reproducible Chrome packaging; no live browser, receiver or signing action.
import { join } from "./paths.ts";
import { filesAt, root, sha256, verify } from "./verify.ts";
const receipt = await verify();
const seal = await sha256(
  new TextEncoder().encode(JSON.stringify(receipt.files)),
);
const output = join(root, "Local/candidates", seal.slice(0, 16));
await Deno.mkdir(output, { recursive: true });
for (const file of receipt.files) {
  const from = join(root, "extension_chrome", file.path);
  const to = join(output, "extension_chrome", file.path);
  const parent = to.slice(0, to.lastIndexOf("/"));
  await Deno.mkdir(parent, { recursive: true });
  const bytes = await Deno.readFile(from);
  await Deno.writeFile(to, bytes);
  if (await sha256(await Deno.readFile(to)) !== file.sha256) {
    throw Error(`Candidate readback mismatch: ${file.path}`);
  }
}
if (
  JSON.stringify(await filesAt(join(output, "extension_chrome"))) !==
    JSON.stringify(receipt.files.map((file) => file.path))
) throw Error("Candidate contains stale or unexpected files");
await Deno.writeTextFile(
  join(output, "receipt.json"),
  JSON.stringify({ ...receipt, seal, output }, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    project: receipt.project,
    output,
    files: receipt.files.length,
    readback: "exact",
    chromeId: receipt.chromeId,
  }),
);
