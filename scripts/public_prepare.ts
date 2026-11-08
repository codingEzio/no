// Local review/export of the explicitly selected Git index, never Git history.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (Deno.args.length === 1 && Deno.args[0] === "--build") {
  await import("./public_build.ts");
  Deno.exit(0);
}
const localReview = Deno.args.length === 1 && Deno.args[0] === "--local-review";
const exportCandidate = Deno.args.includes("--prepare") || localReview;
if (
  Deno.args.some((arg) => arg !== "--prepare" && arg !== "--local-review") ||
  Deno.args.length > 1
) {
  throw Error("Unknown argument");
}
async function git(...args: string[]): Promise<Uint8Array> {
  const result = await new Deno.Command("git", {
    cwd: root,
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) throw Error(`Git index read failed (${args[0]})`);
  return result.stdout;
}
const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const product = JSON.parse(decode(await git("show", ":product.json")));
if (
  product.fontPolicy !== undefined &&
  !["glyphgrove", "system", "browser-v1"].includes(product.fontPolicy)
) {
  throw Error("Unsupported font policy");
}
const hash = async (b: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(b)))]
    .map((n) => n.toString(16).padStart(2, "0")).join("");
const config = JSON.parse(decode(await git("show", ":public-source.json")));
if (
  config.schemaVersion !== 1 || !Array.isArray(config.files) ||
  !config.files.length || config.releaseStatus !== "source-authorized"
) throw Error("Invalid public source selection");
const modes = new Map(
  decode(await git("ls-files", "--stage", "-z")).split("\0").filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("\t");
      const metadata = line.slice(0, separator);
      const path = line.slice(separator + 1);
      const [mode, , stage] = metadata.split(" ");
      if (stage !== "0") {
        throw Error("Resolve index conflicts before reviewing");
      }
      return [path, mode];
    }),
);
const paths = config.files as string[];
if (new Set(paths).size !== paths.length) {
  throw Error("Duplicate selected source path");
}
const entries: {
  path: string;
  mode: string;
  bytes: number;
  sha256: string;
  data: Uint8Array;
}[] = [];
for (const path of paths) {
  if (
    typeof path !== "string" || !path || path.startsWith("/") ||
    [...path].some((char) =>
      char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
    ) ||
    path.includes("\\") || path.split("/").some((part) =>
      !part || part === "." || part === ".."
    )
  ) throw Error("Invalid selected source path");
  if (
    /^(?:Local|\.git|\.env|docs\/legacy)(?:\/|$)/.test(path) ||
    path === "extension_chrome/private-defaults.json" ||
    /(?:^|\/)(?:AGENTS\.md|TASKS\.md|PLAN\.md|ERRORLOG\.txt|SOURCE-MANIFEST\.json)$/
      .test(path)
  ) throw Error(`Private source selection: ${path}`);
  const mode = modes.get(path);
  if (mode !== "100644" && mode !== "100755") {
    throw Error(
      `Selected path is missing or not a regular indexed file: ${path}`,
    );
  }
  const data = await git("show", ":" + path);
  if (!data.includes(0)) {
    const text = decode(data);
    const rules = [
      ["home-path", /(?:\/Users\/|\/home\/)[^\s/]+\//],
      ["owner-workspace", /~\/X\//],
      ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
      ["token", /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
    ] as const;
    for (const [category, pattern] of rules) {
      if (pattern.test(text)) {
        throw Error(
          `Review blocked: ${path} (${category}); contents suppressed`,
        );
      }
    }
  }
  entries.push({
    path,
    mode,
    bytes: data.length,
    sha256: await hash(data),
    data,
  });
}
const files = entries.map(({ data: _data, ...entry }) => entry);
const seal = await hash(new TextEncoder().encode(JSON.stringify(files)));
if (exportCandidate) {
  const receipt = new TextEncoder().encode(
    JSON.stringify(
      {
        schemaVersion: 1,
        seal,
        files,
        releaseReady: false,
        ...(localReview
          ? {
            scope: "local-review-only",
          }
          : {}),
        limitations: config.limitations,
      },
      null,
      2,
    ) + "\n",
  );
  if (paths.includes("SOURCE-RECEIPT.json")) {
    throw Error("Reserved receipt path");
  }
  const payload = [...entries, {
    path: "SOURCE-RECEIPT.json",
    mode: "100644",
    bytes: receipt.length,
    sha256: await hash(receipt),
    data: receipt,
  }];
  const expected = new Map(payload.map((entry) => [entry.path, entry]));
  const directories = new Set<string>();
  for (const entry of payload) {
    let parent = dirname(entry.path);
    while (parent !== ".") {
      directories.add(parent);
      parent = dirname(parent);
    }
  }
  const ensureDirectory = async (path: string) => {
    try {
      await Deno.mkdir(path);
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    const stat = await Deno.lstat(path);
    if (!stat.isDirectory || stat.isSymlink) {
      throw Error("Candidate directory must not be a symlink");
    }
  };
  await ensureDirectory(join(root, "Local"));
  const candidateRoot = localReview ? "local-review-source" : "public-source";
  await ensureDirectory(join(root, "Local", candidateRoot));
  const directory = join(root, "Local", candidateRoot, seal);
  let existing = false;
  try {
    await Deno.mkdir(directory);
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    existing = true;
  }
  const stat = await Deno.lstat(directory);
  if (!stat.isDirectory || stat.isSymlink) {
    throw Error("Candidate must be a real directory");
  }
  if (!existing) {
    for (
      const path of [...directories].sort((a, b) =>
        a.split("/").length - b.split("/").length
      )
    ) await ensureDirectory(join(directory, path));
    for (const entry of payload) {
      await Deno.writeFile(join(directory, entry.path), entry.data, {
        createNew: true,
        mode: entry.mode === "100755" ? 0o755 : 0o644,
      });
    }
  }
  const seen = new Set<string>();
  const verifyDirectory = async (prefix = ""): Promise<void> => {
    for await (const entry of Deno.readDir(join(directory, prefix))) {
      const path = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.isSymlink) throw Error(`Candidate contains symlink: ${path}`);
      if (entry.isDirectory) {
        if (!directories.has(path)) {
          throw Error(`Unexpected candidate directory: ${path}`);
        }
        await verifyDirectory(path);
      } else {
        const wanted = expected.get(path);
        if (!entry.isFile || !wanted) {
          throw Error(`Unexpected candidate file: ${path}`);
        }
        const file = join(directory, path);
        const mode = (await Deno.lstat(file)).mode;
        if (
          mode !== null &&
          (mode & 0o777) !== (wanted.mode === "100755" ? 0o755 : 0o644)
        ) throw Error(`Candidate mode mismatch: ${path}`);
        if (await hash(await Deno.readFile(file)) !== wanted.sha256) {
          throw Error(`Candidate readback failed: ${path}`);
        }
        seen.add(path);
      }
    }
  };
  await verifyDirectory();
  if (seen.size !== payload.length) {
    throw Error("Candidate is incomplete; retained without overwrite");
  }
  console.log(
    `Candidate: Local/${candidateRoot}/${seal} (${
      existing ? "verified existing" : "created and verified"
    })`,
  );
}
console.log(
  JSON.stringify({
    selectedFiles: files.length,
    seal,
    snapshot: "git-index",
    releaseReady: false,
    limitations: config.limitations,
  }),
);
