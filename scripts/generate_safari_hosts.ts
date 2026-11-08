const ROOT = new URL("../", import.meta.url);

import { relative } from "node:path";
import { fileURLToPath } from "node:url";
type SafariBuild = {
  iconRoot?: string;
  id: string;
  sourceRoot: string;
  webRoot: string;
  hostRoot: string;
  appName: string;
  displayName?: string;
  installApp: string;
  hostBundleId: string;
  extensionBundleId: string;
  handler: "default" | "atlaskit";
};

const registry = JSON.parse(
  await Deno.readTextFile(new URL("products.json", ROOT)),
) as { safariBuilds: SafariBuild[] };
const check = Deno.args.includes("--check");
const only = Deno.args[Deno.args.indexOf("--only") + 1];
if (
  Deno.args.includes("--only") &&
  !registry.safariBuilds.some((build) => build.id === only)
) {
  throw new Error(`Unknown Safari host id: ${only}`);
}

function rootURL(relative: string): URL {
  return new URL(
    relative.replace(/^\/+/, "") + (relative.endsWith("/") ? "" : "/"),
    ROOT,
  );
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function iconRoot(build: SafariBuild): URL {
  const pieces = build.sourceRoot.split("/");
  if (build.iconRoot) return rootURL(build.iconRoot);
  const product = pieces[0];
  const variant = product === "mastermind_capture" ? `/${pieces.at(-1)}` : "";
  return new URL(
    `${product}/design${variant}/generated/apple-static/default/`,
    ROOT,
  );
}

async function topDirectories(root: URL): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(root)) {
    if (entry.isDirectory) names.push(entry.name);
  }
  return names.sort();
}

async function projectYAML(
  build: SafariBuild,
  team: string,
  signer: string,
): Promise<string> {
  const manifest = JSON.parse(
    await Deno.readTextFile(new URL("manifest.json", rootURL(build.webRoot))),
  ) as { version: string };
  const directories = await topDirectories(rootURL(build.webRoot));
  const hostPath = fileURLToPath(rootURL(build.hostRoot));
  const webPath = relative(hostPath, fileURLToPath(rootURL(build.webRoot)));
  const sharedPrefix = relative(
    hostPath,
    fileURLToPath(rootURL("shared/safari-host")),
  );
  const scriptsPrefix = relative(hostPath, fileURLToPath(rootURL("scripts")));
  const handlerPath = build.handler === "atlaskit"
    ? "../../platform/SafariWebExtensionHandler.swift"
    : `${sharedPrefix}/SafariWebExtensionHandler.swift`;
  const directorySources = directories.map((name) =>
    `      - path: ${
      quote(`${webPath}/${name}`)
    }\n        type: folder\n        buildPhase: resources`
  ).join("\n");
  const excludes = directories.length
    ? `\n        excludes: [${directories.map(quote).join(", ")}]`
    : "";
  const extensionName = `${build.appName} Extension`;
  const displayName = build.displayName ?? build.appName;
  const isAtlas = build.handler === "atlaskit";
  const bridgeName = `${build.appName} Bridge`;
  const hostSources = isAtlas
    ? `\n      - path: "../../platform/AtlasBridgeProtocol.swift"\n      - path: "../../platform/AtlasBridgeSelfTest.swift"`
    : "";
  const hostDependencies = isAtlas
    ? `\n      - target: ${quote(bridgeName)}\n        embed: true`
    : "";
  const hostConditions = isAtlas
    ? "\n        SWIFT_ACTIVE_COMPILATION_CONDITIONS: ATLAS_BRIDGE"
    : "";
  const extensionSources = isAtlas
    ? `\n      - path: "../../platform/AtlasBridgeProtocol.swift"`
    : "";
  const bridgeTarget = isAtlas
    ? `  ${quote(bridgeName)}:
    type: xpc-service
    platform: macOS
    sources:
      - path: "../../platform/AtlasBridgeService"
      - path: "../../platform/AtlasBridgeProtocol.swift"
    info:
      path: Bridge-Info.plist
      properties:
        CFBundleDisplayName: ${quote(bridgeName)}
        XPCService:
          ServiceType: Application
    settings:
      base:
        PRODUCT_NAME: ${quote(bridgeName)}
        PRODUCT_BUNDLE_IDENTIFIER: "app.alex.y-atlaskit-capture.bridge"
        GENERATE_INFOPLIST_FILE: YES
        SKIP_INSTALL: YES
        ENABLE_HARDENED_RUNTIME: YES
        ENABLE_APP_SANDBOX: NO
`
    : "";
  return `name: ${quote(build.appName)}
options:
  minimumXcodeGenVersion: 2.46.0
  deploymentTarget:
    macOS: "15.0"
settings:
  base:
    SWIFT_VERSION: "5.0"
    MARKETING_VERSION: ${quote(manifest.version)}
    CURRENT_PROJECT_VERSION: "1"
    CODE_SIGN_STYLE: Manual
    DEVELOPMENT_TEAM: ${quote(team)}
    CODE_SIGN_IDENTITY: ${quote(signer)}
    ENABLE_USER_SCRIPT_SANDBOXING: NO
targets:
  ${quote(build.appName)}:
    type: application
    platform: macOS
    sources:
      - path: ${quote(`${sharedPrefix}/HostApp.swift`)}
${hostSources}
      - path: Assets.xcassets
    dependencies:
      - target: ${quote(extensionName)}
        embed: true
${hostDependencies}
    info:
      path: Host-Info.plist
      properties:
        CFBundleDisplayName: ${quote(displayName)}
${
    build.displayName
      ? `        CFBundleName: ${quote(displayName)}\n`
      : ""
  }        CFBundleShortVersionString: $(MARKETING_VERSION)
        CFBundleVersion: $(CURRENT_PROJECT_VERSION)
        SafariExtensionBundleIdentifier: ${quote(build.extensionBundleId)}
        LSApplicationCategoryType: public.app-category.productivity
    settings:
      base:
        PRODUCT_NAME: ${quote(build.appName)}
        PRODUCT_BUNDLE_IDENTIFIER: ${quote(build.hostBundleId)}
        ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon
        ENABLE_HARDENED_RUNTIME: YES
        ENABLE_APP_SANDBOX: YES
${hostConditions}
  ${quote(extensionName)}:
    type: app-extension
    platform: macOS
    sources:
      - path: ${quote(handlerPath)}
${extensionSources}
      - path: ${quote(webPath)}${excludes}
        buildPhase: resources
${directorySources ? directorySources + "\n" : ""}    info:
      path: Extension-Info.plist
      properties:
        CFBundleDisplayName: ${quote(displayName)}
${
    build.displayName
      ? `        CFBundleName: ${quote(displayName)}\n`
      : ""
  }        NSExtension:
          NSExtensionPointIdentifier: com.apple.Safari.web-extension
          NSExtensionPrincipalClass: $(PRODUCT_MODULE_NAME).SafariWebExtensionHandler
    settings:
      base:
        PRODUCT_NAME: ${quote(extensionName)}
        PRODUCT_BUNDLE_IDENTIFIER: ${quote(build.extensionBundleId)}
        GENERATE_INFOPLIST_FILE: YES
        SKIP_INSTALL: YES
        ENABLE_HARDENED_RUNTIME: YES
        ENABLE_APP_SANDBOX: YES
${bridgeTarget}schemes:
  ${quote(build.appName)}:
    build:
      targets:
        ${quote(build.appName)}: all
      runPostActionsOnFailure: true
      postActions:
        - name: Forget Safari Build Copy
          settingsTarget: ${quote(build.appName)}
          script: '${"$SRCROOT"}/${scriptsPrefix}/forget-safari-build-copy.sh "${"$TARGET_BUILD_DIR"}/${"$FULL_PRODUCT_NAME"}" "${"$HOME"}/Applications/${build.installApp}"'
    run:
      config: Debug
    archive:
      config: Release
`;
}

const appIconContents = JSON.stringify(
  {
    images: [
      { size: "16x16", idiom: "mac", filename: "icon-16.png", scale: "1x" },
      { size: "16x16", idiom: "mac", filename: "icon-32.png", scale: "2x" },
      { size: "32x32", idiom: "mac", filename: "icon-32.png", scale: "1x" },
      { size: "32x32", idiom: "mac", filename: "icon-64.png", scale: "2x" },
      { size: "128x128", idiom: "mac", filename: "icon-128.png", scale: "1x" },
      { size: "128x128", idiom: "mac", filename: "icon-256.png", scale: "2x" },
      { size: "256x256", idiom: "mac", filename: "icon-256.png", scale: "1x" },
      { size: "256x256", idiom: "mac", filename: "icon-512.png", scale: "2x" },
      { size: "512x512", idiom: "mac", filename: "icon-512.png", scale: "1x" },
      { size: "512x512", idiom: "mac", filename: "icon-1024.png", scale: "2x" },
    ],
    info: { author: "xcode", version: 1 },
  },
  null,
  2,
) + "\n";
const catalogContents =
  JSON.stringify({ info: { author: "xcode", version: 1 } }, null, 2) + "\n";

async function verifyOrWrite(path: URL, expected: Uint8Array | string) {
  const bytes = typeof expected === "string"
    ? new TextEncoder().encode(expected)
    : expected;
  if (check) {
    let actual: Uint8Array;
    try {
      actual = await Deno.readFile(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new Error(`Missing generated host file: ${path.pathname}`);
      }
      throw error;
    }
    if (
      actual.length !== bytes.length ||
      !actual.every((byte, index) => byte === bytes[index])
    ) {
      throw new Error(`Generated host file drifted: ${path.pathname}`);
    }
    return;
  }
  await Deno.mkdir(new URL("./", path), { recursive: true });
  await Deno.writeFile(path, bytes);
}

// Private signing settings are passed by the build entrypoint, never generated into source.
const signing = {team: "", signer: ""};
for (const build of registry.safariBuilds) {
  if (Deno.args.includes("--only") && build.id !== only) continue;
  const host = rootURL(build.hostRoot);
  const appIcon = new URL("Assets.xcassets/AppIcon.appiconset/", host);
  await verifyOrWrite(
    new URL("project.yml", host),
    await projectYAML(build, signing.team, signing.signer),
  );
  await verifyOrWrite(
    new URL("Assets.xcassets/Contents.json", host),
    catalogContents,
  );
  await verifyOrWrite(new URL("Contents.json", appIcon), appIconContents);
  for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
    const source = new URL(`icon-${size}.png`, iconRoot(build));
    await verifyOrWrite(
      new URL(`icon-${size}.png`, appIcon),
      await Deno.readFile(source),
    );
  }
}
console.log(
  check ? "Safari hosts are generated and current." : "Safari hosts generated.",
);
