import { missingImports } from "../scripts/check_public_imports.ts";
Deno.test("selected relative imports must exist in the public selection", () => {
  const files = new Map([
    [
      "app/main.js",
      "import { x } from " + '"./x.js"; import(' + '"../shared/later.js");',
    ],
    ["app/x.js", "export const x = 1;"],
  ]);
  const missing = missingImports(files);
  if (
    JSON.stringify(missing) !==
      JSON.stringify(["app/main.js: ../shared/later.js"])
  ) throw Error("Missing import not detected");
  files.set("shared/later.js", "export {};");
  if (missingImports(files).length) throw Error("Valid import rejected");
});
