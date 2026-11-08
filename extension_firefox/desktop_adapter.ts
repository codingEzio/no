// Chrome owns product behavior. These bounded transforms own Firefox delivery.
export const products = [
  {
    slug: "no",
    source: "no/extension_chrome",
    id: "{5daeeb02-3a1a-502c-a235-20e410518450}",
    data: ["none"],
  },
  {
    slug: "calmly",
    source: "calmly/extension_chrome",
    id: "{76bd4ae5-f9d2-5c62-b9fc-d02b11ed20de}",
    version: "0.7.8",
    data: ["none"],
  },
  {
    slug: "journal",
    source: "mastermind_capture/extension_chrome/active",
    id: "{7e2b00f7-9b52-55c2-872d-2f2abbb976ce}",
    version: "0.2.3",
    data: ["browsingActivity", "websiteContent", "personalCommunications"],
  },
  {
    slug: "bookmark",
    source: "mastermind_capture/extension_chrome/bookmark",
    id: "{0ca238b6-fa1b-5d21-a7e5-7588791fd7ca}",
    version: "0.2.4",
    data: ["browsingActivity", "websiteContent", "personalCommunications"],
  },
] as const;
export type Product = typeof products[number];

function replaceRequired(text: string, before: string, after: string) {
  if (!text.includes(before)) {
    throw new Error(`Source adapter drift: ${before}`);
  }
  return text.replace(before, after);
}
function replaceSection(
  text: string,
  start: string,
  end: string,
  replacement: string,
) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Source adapter drift: ${start}`);
  return text.slice(0, from) + replacement + text.slice(to);
}

type Manifest = {
  [key: string]: unknown;
  key?: string;
  version: string;
  background: { service_worker?: string; scripts?: string[]; type?: string };
  permissions: string[];
  host_permissions: string[];
  content_scripts: { css: string[]; js: string[]; matches: string[] }[];
  web_accessible_resources: { matches: string[]; resources: string[] }[];
  options_ui?: { page: string; open_in_tab: boolean };
  browser_specific_settings?: {
    gecko: {
      id: string;
      strict_min_version: string;
      data_collection_permissions: { required: string[] };
    };
    gecko_android?: { strict_min_version: string };
  };
};
export function adaptManifest(
  source: Manifest,
  product: Product,
  desktop = false,
) {
  const manifest = structuredClone(source);
  delete manifest.key;
  manifest.version = "version" in product ? product.version : source.version;
  for (
    const key of ["host_permissions", "optional_host_permissions"] as const
  ) {
    const patterns = manifest[key] as string[] | undefined;
    if (patterns) {
      manifest[key] = [
        ...new Set(
          patterns.map((pattern) => pattern.replace(/:\d+(?=\/)/u, "")),
        ),
      ];
    }
  }
  manifest.background = {
    scripts: ["background.js"],
    ...(source.background.type ? { type: source.background.type } : {}),
  };
  manifest.browser_specific_settings = {
    gecko: {
      id: product.id,
      strict_min_version: "140.0",
      data_collection_permissions: { required: [...product.data] },
    },
    ...(desktop ? {} : { gecko_android: { strict_min_version: "142.0" } }),
  };
  manifest.options_ui = { page: "popup.html", open_in_tab: true };
  // Firefox Android has no extension-owned context menus. Popup actions remain
  // the capture entry; unsupported APIs must not prevent background startup.
  if (!desktop) {
    manifest.permissions = manifest.permissions.filter((p) =>
      p !== "contextMenus"
    );
  }
  if (product.slug === "calmly") {
    // Keyboard commands are unavailable on Firefox Android.
    delete manifest.commands;
    const matches = ["https://x.com/*", "https://twitter.com/*"];
    manifest.permissions = manifest.permissions.filter((p: string) =>
      p !== "downloads"
    );
    manifest.host_permissions = matches;
    manifest.content_scripts = [structuredClone(source.content_scripts[0])];
    manifest.content_scripts[0].js.unshift("firefox-fonts.js");
    manifest.background = {
      scripts: [
        "text-rules.js",
        "src/content-rules.js",
        "settings.js",
        "src/download.js",
        "src/i18n.js",
        "background.js",
      ],
    };
    for (const entry of manifest.web_accessible_resources) {
      entry.matches = matches;
    }
  }
  return manifest;
}

// FontFace uses the actual Firefox runtime UUID, retaining subset unicode ranges
// and variable weights. Faces load on demand, with no CDN or eager 8 MB fetch.
export function fontLoader(css: string) {
  const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/gu)].map((match) => {
    const block = match[1];
    const family = block.match(/font-family:\s*["']([^"']+)["']/u)?.[1];
    const path = block.match(
      /url\(["']chrome-extension:\/\/__MSG_@@extension_id__\/([^"']+)["']\)/u,
    )?.[1];
    if (!family || !path) throw new Error("Unrecognized packaged font face");
    const descriptors: Record<string, string> = {};
    for (
      const [cssKey, jsKey] of [
        ["font-style", "style"],
        ["font-weight", "weight"],
        ["font-display", "display"],
        ["unicode-range", "unicodeRange"],
      ]
    ) {
      const value = block.match(new RegExp(`${cssKey}:\\s*([^;]+);`, "u"))?.[1];
      if (value) descriptors[jsKey] = value.trim();
    }
    return { family, path, descriptors };
  });
  if (!faces.length) throw new Error("No bundled font faces");
  return `"use strict";\nfor (const face of ${
    JSON.stringify(faces)
  }) {\n document.fonts.add(new FontFace(face.family, 'url("' + browser.runtime.getURL(face.path) + '")', face.descriptors));\n}\n`;
}

export function adaptSource(
  product: Product,
  path: string,
  input: string,
  desktop = false,
) {
  let text = input;
  if (path.endsWith(".js")) {
    text = text.replaceAll("globalThis.chrome", "globalThis.browser").replace(
      /\bchrome\./gu,
      "browser.",
    );
  }
  if (path === "src/version.js" && "version" in product) {
    text = text.replace(
      /export const VERSION = "[^"]+"/u,
      `export const VERSION = "${product.version}"`,
    );
  }
  if (path.endsWith(".css")) {
    text = text.replaceAll("chrome-extension://__MSG_@@extension_id__/", "");
  }
  if (path === "popup.html" && !text.includes('name="viewport"')) {
    text = replaceRequired(
      text,
      '<meta charset="utf-8">',
      '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">',
    );
  }
  if (path === "popup.css") {
    text +=
      "\n/* Firefox Android also opens this UI as an extension tab. */\n:root { --popup-width:min(360px,100vw); }\nhtml,body { max-width:100vw; min-width:0; }\nbody { width:min(360px,100vw); }\n.popup { max-width:100%; box-sizing:border-box; }\n";
  }
  if (product.slug === "journal" || product.slug === "bookmark") {
    if (path === "background.js" && !desktop) {
      text = replaceSection(
        text,
        "async function installMenu() {",
        product.slug === "journal"
          ? "async function bootstrap()"
          : "async function saveMenuConfig(",
        "async function installMenu() {\n  // Android has no context-menu API; retain durable replay scheduling.\n  await api.alarms.create(REPLAY_ALARM, { periodInMinutes: 1 });\n}\n\n",
      );
      text = replaceSection(
        text,
        "api.contextMenus.onClicked.addListener(",
        "api.alarms.onAlarm.addListener(",
        "// Capture is initiated from the Android extension popup.\n",
      );
    }
    if (product.slug === "journal" && path === "popup.js") {
      text = replaceRequired(
        text,
        "async function load() {",
        `async function readAndroidSelection() {
  const key = "mastermind.capture.journal.selection.v1";
  if ((await api.storage.local.get(key))[key]) return;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url ?? "")) return;
  let results;
  try {
    results = await api.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const element = document.activeElement;
        if (element?.matches("input,textarea,[contenteditable=true]")) return "";
        return window.getSelection()?.toString() ?? "";
      },
    });
  } catch { return; } // Restricted pages cannot supply a selection.
  const text = results?.[0]?.result;
  if (typeof text !== "string" || !text.trim()) return;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tab.id + "\\n" + text));
  const id = "firefox-selection-" + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const draft = (await api.storage.local.get(DRAFT_KEY))[DRAFT_KEY];
  if (draft?.selectionId === id) return;
  const selection = { id, text };
  await api.storage.local.set({ [key]: selection });
  const saved = (await api.storage.local.get(key))[key];
  if (saved?.id !== selection.id || saved?.text !== text) throw new Error("Selection was not saved");
}
async function load() {
  await readAndroidSelection();`,
      );
    }
    return text;
  }
  if (product.slug !== "calmly") return text;
  if (path === "popup.html") {
    text = replaceRequired(
      text,
      "</head>",
      '<script src="firefox-fonts.js"></script>\n</head>',
    );
  }
  if (path === "src/version.js") {
    text = text.replace(
      /globalThis.CalmlyVersion = "[^"]+"/u,
      `globalThis.CalmlyVersion = "${product.version}"`,
    );
  }
  if (path === "fonts.css") {
    // Keep the shared combination variables/selectors; faces are registered by
    // firefox-fonts.js because a content stylesheet has no stable runtime UUID.
    text = text.replace(/@font-face\s*\{[^}]+\}/gu, "");
  }
  if (path === "background.js") {
    text = text.replace(/^importScripts\([\s\S]*?\);\s*/u, "");
    text = "const FIREFOX_X_ONLY = true;\n" + text;
    // Other site runtimes are absent; reject their dormant download requests.
    text = replaceRequired(
      text,
      "if (!browser.downloads?.download)",
      "if (FIREFOX_X_ONLY || !browser.downloads?.download)",
    );
    // Android does not support popup windows; open the normal options tab.
    text = replaceRequired(
      text,
      "if (browser.windows?.create)",
      "if (!FIREFOX_X_ONLY && browser.windows?.create)",
    );
  }
  if (path === "popup.html") {
    for (const site of ["youtube", "bilibili", "chatgpt"]) {
      text = replaceRequired(
        text,
        `id="tab-${site}"`,
        `id="tab-${site}" disabled aria-disabled="true"`,
      );
    }
    text = replaceRequired(
      text,
      "</nav>",
      '</nav><small id="firefox-scope"></small>',
    );
  }
  if (path === "popup.js") {
    text = replaceRequired(
      text,
      'const TABS = Object.freeze(["x", "youtube", "bilibili", "chatgpt", "rules"]);',
      'const TABS = Object.freeze(["x", "rules"]);',
    );
    text = replaceRequired(
      text,
      "const siteTabs = Array.from(\n    document.querySelectorAll(\"[role='tab'][data-site]\"),\n  );",
      "const siteTabs = Array.from(document.querySelectorAll(\"[role='tab'][data-site]:not([disabled])\"));",
    );
  }
  if (path === "settings.js") {
    // Only factory defaults change. Existing settings and rule migrations remain
    // authoritative. Values were read from Chrome World / Calmly 0.6.8 on X.
    for (
      const [before, after] of [
        [
          'const EMOJI_DEFAULT = "builtin";',
          'const EMOJI_DEFAULT = "noto-color-emoji";',
        ],
        [
          "const FONT_WEIGHT_DEFAULT = 400;",
          "const FONT_WEIGHT_DEFAULT = 500;",
        ],
        [
          "const LETTER_SPACING_DEFAULT = 0;",
          "const LETTER_SPACING_DEFAULT = -0.01;",
        ],
        ["const AUTHOR_DIM_DEFAULT = 82;", "const AUTHOR_DIM_DEFAULT = 79;"],
        ['theme: "bootstrap",', 'theme: "nothing",'],
        ["chromeDim: 41,", "chromeDim: 54,"],
        ["chromeBlur: 4,", "chromeBlur: 6,"],
        ["emojiDim: 70,", "emojiDim: 84,"],
        ["mediaScale: 70,", "mediaScale: 65,"],
        ["mediaDim: 0,", "mediaDim: 26,"],
        ["tweetBlur: 4,", "tweetBlur: 6,"],
      ]
    ) text = replaceRequired(text, before, after);
  }
  return text;
}
