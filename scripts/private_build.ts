// Apply optional local defaults to a verified public Chrome candidate only.
import { join } from "./paths.ts";
import { filesAt, root, sha256 } from "./verify.ts";
import { normalizeDomainInput } from "../extension_chrome/src/core.js";

const config = JSON.parse(
  await Deno.readTextFile(join(root, "Local/private-defaults.json")),
);
if (
  !config || Object.keys(config).length !== 1 ||
  !Array.isArray(config.domains) || config.domains.length > 1000
) {
  throw Error("Expected Local/private-defaults.json with a domains array");
}
const domains = config.domains.map((value: unknown) => {
  if (typeof value !== "string") throw Error("Domain must be a string");
  return normalizeDomainInput(value);
});
if (new Set(domains).size !== domains.length) {
  throw Error("Duplicate default domain");
}
const build = await new Deno.Command("deno", {
  cwd: root,
  args: [
    "run",
    "--allow-read",
    "--allow-write=Local",
    "scripts/public_build.ts",
  ],
  stdout: "piped",
  stderr: "piped",
}).output();
if (!build.success) {
  throw Error(`Public build failed: ${new TextDecoder().decode(build.stderr)}`);
}
const receipt = JSON.parse(new TextDecoder().decode(build.stdout));
if (!/^Local\/public-build\/[a-f0-9]{64}$/.test(receipt.output)) {
  throw Error("Invalid public build output");
}
const source = join(root, receipt.output, "extension_chrome");
const output = await Deno.makeTempDir({
  dir: join(root, "Local"),
  prefix: "private-build-",
});
for (const file of await filesAt(source)) {
  const destination = join(output, "extension_chrome", file);
  await Deno.mkdir(destination.slice(0, destination.lastIndexOf("/")), {
    recursive: true,
  });
  let bytes = await Deno.readFile(join(source, file));
  if (["src/core.js", "navigation.js"].includes(file)) {
    const original = new TextDecoder().decode(bytes);
    const needle = "const DEFAULT_DOMAINS = [];";
    if (original.split(needle).length !== 2) {
      throw Error(`Default marker differs: ${file}`);
    }
    bytes = new TextEncoder().encode(
      original.replace(
        needle,
        `const DEFAULT_DOMAINS = ${JSON.stringify(domains)};`,
      ),
    );
  }
  await Deno.writeFile(destination, bytes, { createNew: true, mode: 0o600 });
  if (await sha256(await Deno.readFile(destination)) !== await sha256(bytes)) {
    throw Error(`Readback failed: ${file}`);
  }
}
console.log(
  JSON.stringify({
    output,
    chromeId: receipt.chromeId,
    version: receipt.version,
    defaults: domains.length,
    readback: "exact",
  }),
);
