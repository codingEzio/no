// Keep the MV3 package self-contained while sharing one reviewed source policy.
const source = new URL(
  "../vendor/prometheus/bookmark_source_policy.js",
  import.meta.url,
);
const product = await Deno.readTextFile(
  new URL("../product.json", import.meta.url),
).then(JSON.parse).catch((e) => {
  if (e instanceof Deno.errors.NotFound) return null;
  throw e;
});
const target = new URL(
  product
    ? "../extension_chrome/src/bookmark-source-policy.js"
    : "../x_collector/extension_chrome/src/bookmark-source-policy.js",
  import.meta.url,
);
export async function syncBookmarkSourcePolicy(args: string[] = Deno.args) {
  // Registry queries and other products must not mutate the collector package.
  if (
    args.includes("--list") || (product && product.product !== "x_collector")
  ) return;
  const onlyIndex = args.indexOf("--only");
  if (onlyIndex !== -1 && args[onlyIndex + 1] !== "x-collector") return;
  const expected = await Deno.readTextFile(source);
  if (args.includes("--check")) {
    if (await Deno.readTextFile(target) !== expected) {
      throw new Error(
        "Bookmark source policy drift; run sync_bookmark_source_policy.ts",
      );
    }
  } else {
    await Deno.writeTextFile(target, expected);
  }
}

if (import.meta.main) await syncBookmarkSourcePolicy();
