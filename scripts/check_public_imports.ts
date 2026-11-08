// Check literal relative imports against the independently selected source files.
// Nonliteral dynamic imports and non-JS resources need their own checks.
import { dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
export function missingImports(files: Map<string, string>): string[] {
  const missing: string[] = [];
  const pattern =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'](\.[^"']+)["']/g;
  for (const [path, source] of files) {
    if (!/\.(?:[cm]?js|[cm]?ts)$/.test(path)) continue;
    for (const match of source.matchAll(pattern)) {
      const target = posix.normalize(posix.join(posix.dirname(path), match[1]));
      if (!files.has(target)) missing.push(`${path}: ${match[1]}`);
    }
  }
  return missing.sort();
}
if (import.meta.main) {
  const selection = JSON.parse(
    await Deno.readTextFile(`${root}/public-source.json`),
  );
  const files = new Map<string, string>();
  for (const path of selection.files as string[]) {
    files.set(
      path,
      /\.(?:[cm]?js|[cm]?ts)$/.test(path)
        ? await Deno.readTextFile(`${root}/${path}`)
        : "",
    );
  }
  const missing = missingImports(files);
  if (missing.length) {
    throw Error(`Unselected relative imports:\n${missing.join("\n")}`);
  }
  console.log(`Selected source import check passed (${files.size} files)`);
}
