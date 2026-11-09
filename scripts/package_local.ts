// Project-owned package path; private defaults never enter the candidate.
// Existing candidates are read-only; each new output is exclusively claimed.
import { dirname, join } from "./paths.ts";
import { root, sha256, verify } from "./verify.ts";

const MAX_CANDIDATES = 32;
const receipt = await verify();
receipt.files = receipt.files.filter((file) =>
  file.path !== "private-defaults.json"
);
const seal = await sha256(
  new TextEncoder().encode(JSON.stringify(receipt.files)),
);

async function ensureDirectory(path: string) {
  try {
    await Deno.mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
  }
  const info = await Deno.lstat(path);
  if (
    !info.isDirectory || info.isSymlink || await Deno.realPath(path) !== path
  ) {
    throw Error("Candidate parent must be a real directory");
  }
}
await ensureDirectory(join(root, "Local"));
await ensureDirectory(join(root, "Local/candidates"));

const expectedFiles = new Set([
  "receipt.json",
  ...receipt.files.map((file) => `extension_chrome/${file.path}`),
]);
const expectedDirs = new Set<string>();
for (const path of expectedFiles) {
  let dir = dirname(path);
  while (dir !== ".") {
    expectedDirs.add(dir);
    dir = dirname(dir);
  }
}
async function matches(output: string): Promise<boolean> {
  try {
    const rootInfo = await Deno.lstat(output);
    if (
      !rootInfo.isDirectory || rootInfo.isSymlink ||
      (rootInfo.mode !== null && (rootInfo.mode & 0o777) !== 0o700) ||
      await Deno.realPath(output) !== output
    ) return false;
    const files = new Set<string>();
    const dirs = new Set<string>();
    const scan = async (path: string, prefix = ""): Promise<boolean> => {
      for await (const entry of Deno.readDir(path)) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isSymlink) return false;
        const info = await Deno.lstat(join(path, entry.name));
        const expectedMode = entry.isDirectory ? 0o700 : 0o600;
        if (info.mode !== null && (info.mode & 0o777) !== expectedMode) {
          return false;
        }
        if (entry.isDirectory) {
          dirs.add(relative);
          if (!await scan(join(path, entry.name), relative)) return false;
        } else if (entry.isFile) files.add(relative);
        else return false;
      }
      return true;
    };
    if (
      !await scan(output) || files.size !== expectedFiles.size ||
      dirs.size !== expectedDirs.size ||
      [...expectedFiles].some((p) => !files.has(p)) ||
      [...expectedDirs].some((p) => !dirs.has(p))
    ) return false;
    if (
      await Deno.readTextFile(join(output, "receipt.json")) !==
        JSON.stringify({ ...receipt, seal, output }, null, 2) + "\n"
    ) return false;
    for (const file of receipt.files) {
      const bytes = await Deno.readFile(
        join(output, "extension_chrome", file.path),
      );
      if (bytes.length !== file.bytes || await sha256(bytes) !== file.sha256) {
        return false;
      }
    }
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

let output = "";
let reused = false;
for (let attempt = 0; attempt < MAX_CANDIDATES; attempt++) {
  const suffix = attempt === 0 ? "" : `-${String(attempt).padStart(2, "0")}`;
  const path = join(root, "Local/candidates", seal.slice(0, 16) + suffix);
  try {
    await Deno.mkdir(path, { mode: 0o700 });
    output = path;
    break;
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    if (await matches(path)) {
      output = path;
      reused = true;
      break;
    }
  }
}
if (!output) {
  throw Error(
    `No free or matching candidate among ${MAX_CANDIDATES} attempts; existing candidates were retained`,
  );
}
if (!reused) {
  for (const file of receipt.files) {
    const destination = join(output, "extension_chrome", file.path);
    await Deno.mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const bytes = await Deno.readFile(
      join(root, "extension_chrome", file.path),
    );
    if (bytes.length !== file.bytes || await sha256(bytes) !== file.sha256) {
      throw Error(`Source changed during packaging: ${file.path}`);
    }
    await Deno.writeFile(destination, bytes, { createNew: true, mode: 0o600 });
  }
  await Deno.writeTextFile(
    join(output, "receipt.json"),
    JSON.stringify({ ...receipt, seal, output }, null, 2) + "\n",
    { createNew: true, mode: 0o600 },
  );
  if (!await matches(output)) {
    throw Error(
      "Candidate readback differs; incomplete candidate was retained",
    );
  }
}
console.log(
  JSON.stringify({
    project: receipt.project,
    output,
    files: receipt.files.length,
    readback: "exact",
    chromeId: receipt.chromeId,
    reused,
  }),
);
