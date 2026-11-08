// Pure shared source, copied into each independent browser package.
const root = new URL("../", import.meta.url);
const source = await Deno.readTextFile(new URL("shared/endpoint.js", root));
const routes = (await Deno.readTextFile(
  new URL("shared/capture-route-service.js", root),
)).replace('from "./capture-route.js"', 'from "./route.js"');
const routeRules = await Deno.readTextFile(
  new URL("shared/capture-route.js", root),
);
const targetRules = await Deno.readTextFile(
  new URL("shared/use-target.js", root),
);
const targetUi = await Deno.readTextFile(
  new URL("shared/use-target-ui.js", root),
);
const targetCopy = await Deno.readTextFile(
  new URL("shared/use-target-copy.js", root),
);
const product = await Deno.readTextFile(new URL("product.json", root)).then(
  JSON.parse,
).catch((e) => {
  if (e instanceof Deno.errors.NotFound) return null;
  throw e;
});
const destinations = product
  ? (["mastermind_capture", "x_collector"].includes(product.product)
    ? ["extension_chrome/src/endpoint.js"]
    : [])
  : [
    "mastermind_capture/extension_chrome/active/src/endpoint.js",
    "mastermind_capture/extension_chrome/archive/src/endpoint.js",
    "mastermind_capture/extension_chrome/bookmark/src/endpoint.js",
    "x_collector/extension_chrome/src/endpoint.js",
  ];
for (const destination of destinations) {
  const path = new URL(destination, root);
  if (Deno.args.includes("--check")) {
    if (await Deno.readTextFile(path).catch(() => "") !== source) {
      throw new Error(`Endpoint helper differs: ${destination}`);
    }
  } else {
    await Deno.writeTextFile(path, source);
  }
  const routePath = new URL(
    destination.replace("endpoint.js", "route_service.js"),
    root,
  );
  if (Deno.args.includes("--check")) {
    if (await Deno.readTextFile(routePath) !== routes) {
      throw new Error(`Route service differs: ${destination}`);
    }
  } else {
    await Deno.writeTextFile(routePath, routes);
  }
  const rulesPath = new URL(
    destination.replace("endpoint.js", "route.js"),
    root,
  );
  if (Deno.args.includes("--check")) {
    if (await Deno.readTextFile(rulesPath) !== routeRules) {
      throw new Error(`Route rules differ: ${destination}`);
    }
  } else {
    await Deno.writeTextFile(rulesPath, routeRules);
  }
  const targetPath = new URL(
    destination.replace("endpoint.js", "use-target.js"),
    root,
  );
  if (Deno.args.includes("--check")) {
    if (await Deno.readTextFile(targetPath).catch(() => "") !== targetRules) {
      throw new Error(`Use target rules differ: ${destination}`);
    }
  } else await Deno.writeTextFile(targetPath, targetRules);
  const targetUiPath = new URL(
    destination.replace("endpoint.js", "use-target-ui.js"),
    root,
  );
  if (Deno.args.includes("--check")) {
    if (await Deno.readTextFile(targetUiPath).catch(() => "") !== targetUi) {
      throw new Error(`Use target UI differs: ${destination}`);
    }
  } else await Deno.writeTextFile(targetUiPath, targetUi);
  const targetCopyPath = new URL(
    destination.replace("endpoint.js", "use-target-copy.js"),
    root,
  );
  if (Deno.args.includes("--check")) {
    if (
      await Deno.readTextFile(targetCopyPath).catch(() => "") !== targetCopy
    ) throw new Error(`Use target copy differs: ${destination}`);
  } else await Deno.writeTextFile(targetCopyPath, targetCopy);
}
