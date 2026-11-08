const ROOT = new URL("../", import.meta.url);
const FILES = ["menu_settings.js", "menu_settings_ui.js", "menu_settings.css"];
const product = await Deno.readTextFile(new URL("product.json", ROOT)).then(
  JSON.parse,
).catch((e) => {
  if (e instanceof Deno.errors.NotFound) return null;
  throw e;
});
const CONSUMERS = product
  ? (["mastermind-active", "mastermind-bookmark"].includes(product.safariId)
    ? [{ id: product.safariId, root: "extension_chrome/src/" }]
    : [])
  : [
    {
      id: "mastermind-bookmark",
      root: "mastermind_capture/extension_chrome/bookmark/src/",
    },
    {
      id: "mastermind-active",
      root: "mastermind_capture/extension_chrome/active/src/",
    },
  ];
export async function syncCaptureMenuSettings(args: string[]) {
  if (args.includes("--list")) return;
  const only = args.includes("--only")
    ? args[args.indexOf("--only") + 1]
    : null;
  const check = args.includes("--check");
  for (
    const consumer of CONSUMERS.filter((consumer) =>
      !only || consumer.id === only
    )
  ) {
    for (const file of FILES) {
      const source = await Deno.readFile(
        new URL("shared/capture-menu/" + file, ROOT),
      );
      const destination = new URL(consumer.root + file, ROOT);
      const current = await Deno.readFile(destination).catch((error) => {
        if (error instanceof Deno.errors.NotFound) return null;
        throw error;
      });
      if (
        current?.length === source.length &&
        current.every((byte, index) => byte === source[index])
      ) continue;
      if (check) {
        throw new Error(
          "Capture menu core differs: " + consumer.id + "/" + file,
        );
      }
      await Deno.writeFile(destination, source);
    }
  }
}
if (import.meta.main) await syncCaptureMenuSettings(Deno.args);
