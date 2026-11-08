function assert(value: unknown): asserts value {
  if (!value) throw new Error("Assertion failed");
}
function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
import {
  adaptManifest,
  adaptSource,
  fontLoader,
  products,
} from "./desktop_adapter.ts";
const root = new URL("../", import.meta.url);
const read = (product: typeof products[number], path: string) =>
  Deno.readTextFile(new URL(`${product.source}/${path}`, root));

Deno.test("desktop Bookmark retains native context menus and the shared NSFW destinations", async () => {
  const product = products.find((product) => product.slug === "bookmark")!;
  const manifest = adaptManifest(
    JSON.parse(await read(product, "manifest.json")),
    product,
    true,
  );
  assert(manifest.permissions.includes("contextMenus"));
  assert(!manifest.browser_specific_settings?.gecko_android);
  const background = adaptSource(
    product,
    "background.js",
    await read(product, "background.js"),
    true,
  );
  assert(background.includes("api.contextMenus.onClicked.addListener"));
  assert(background.includes("await api.contextMenus.removeAll()"));
  const presets = adaptSource(
    product,
    "src/presets.js",
    await read(product, "src/presets.js"),
    true,
  );
  assert(presets.includes('id: "nsfw-video-archive"'));
  assert(presets.includes('id: "nsfw-source-active"'));
});

Deno.test("four Firefox identities keep module workers and X-only host boundary", async () => {
  for (const product of products) {
    const source = JSON.parse(await read(product, "manifest.json"));
    const manifest = adaptManifest(source, product);
    assertEquals(manifest.browser_specific_settings?.gecko.id, product.id);
    assert(!manifest.background.service_worker);
    for (
      const pattern of [
        ...manifest.host_permissions,
        ...((manifest.optional_host_permissions ?? []) as string[]),
      ]
    ) {
      assert(!/:\d+\/\*/u.test(pattern));
    }
    assertEquals(
      manifest.background.type,
      product.slug === "calmly" ? undefined : "module",
    );
    if (product.slug === "calmly") {
      assertEquals(manifest.host_permissions, [
        "https://x.com/*",
        "https://twitter.com/*",
      ]);
      assertEquals(manifest.content_scripts.length, 1);
      assert(manifest.content_scripts[0].css.includes("fonts.css"));
      assertEquals(manifest.content_scripts[0].js[0], "firefox-fonts.js");
      assert(!manifest.permissions.includes("downloads"));
      assert(!manifest.commands);
    }
  }
});

Deno.test("Firefox font registration preserves every bundled face and subset", async () => {
  const calmly = products[1];
  const source = await read(calmly, "fonts.css");
  const faces: {
    family: string;
    source: string;
    descriptors: Record<string, string>;
  }[] = [];
  class Face {
    constructor(
      family: string,
      source: string,
      descriptors: Record<string, string>,
    ) {
      faces.push({ family, source, descriptors });
    }
  }
  new Function("browser", "document", "FontFace", fontLoader(source))(
    { runtime: { getURL: (p: string) => `moz-extension://fixture/${p}` } },
    { fonts: { add() {} } },
    Face,
  );
  assertEquals(faces.length, [...source.matchAll(/@font-face/gu)].length);
  assert(faces.some((face) => face.family === "Calmly Compact"));
  assert(faces.some((face) => face.family === "Noto Color Emoji"));
  assert(faces.some((face) => face.descriptors.unicodeRange));
  for (const face of faces) {
    assert(face.source.startsWith('url("moz-extension://fixture/'));
    const path = face.source.slice('url("moz-extension://fixture/'.length, -2);
    assert((await Deno.stat(new URL(`${calmly.source}/${path}`, root))).isFile);
  }
  const css = adaptSource(calmly, "fonts.css", source);
  assert(!css.includes("@font-face"));
  assert(css.includes('--calmly-cjk: "Calmly Compact"'));
  const popup = adaptSource(
    calmly,
    "popup.html",
    await read(calmly, "popup.html"),
  );
  assert(popup.includes('<script src="firefox-fonts.js"></script>'));
});

Deno.test("Chrome-observed factory defaults preserve saved preferences and explicit empty rules", async () => {
  const product = products[1];
  type Settings = {
    appearance: { theme: string };
    x: {
      typography: {
        font: string;
        emoji: string;
        fontWeight: number;
        themeFont: boolean;
      };
      mediaScale: number;
    };
    contentRules: { version: number; rules: unknown[] };
  };
  const context = {} as {
    CalmlySettings: {
      SETTINGS_KEY: string;
      loadSettings(storage: unknown): Promise<Settings>;
    };
  };
  new Function(
    "globalThis",
    adaptSource(product, "settings.js", await read(product, "settings.js")),
  )(context);
  const settings = context.CalmlySettings;
  const defaults = await settings.loadSettings({
    get: () => Promise.resolve({}),
  });
  assertEquals(defaults.appearance.theme, "nothing");
  assertEquals(defaults.x.typography.themeFont, true);
  assertEquals(defaults.x.typography.emoji, "noto-color-emoji");
  assertEquals(defaults.x.typography.fontWeight, 500);
  assertEquals(defaults.x.mediaScale, 65);
  const saved = {
    ...defaults,
    x: { ...defaults.x, mediaScale: 87 },
    contentRules: { version: 1, rules: [] },
  };
  const readback = await settings.loadSettings({
    get: () => Promise.resolve({ [settings.SETTINGS_KEY]: saved }),
    set: () => {
      throw new Error("Must not overwrite saved preferences");
    },
  });
  assertEquals(readback.x.mediaScale, 87);
  assertEquals(readback.contentRules.rules, []);
});

Deno.test("Android capture starts without menus and persists selection before popup consumption", async () => {
  for (const product of [products[2], products[3]]) {
    const manifest = adaptManifest(
      JSON.parse(await read(product, "manifest.json")),
      product,
    );
    assert(!manifest.permissions.includes("contextMenus"));
    const background = adaptSource(
      product,
      "background.js",
      await read(product, "background.js"),
    );
    assert(!background.includes("api.contextMenus.onClicked.addListener"));
    const menu = background.slice(
      background.indexOf("async function installMenu()"),
      background.indexOf(
        product.slug === "journal"
          ? "async function bootstrap()"
          : "async function saveMenuConfig(",
      ),
    );
    const scheduled: unknown[] = [];
    await new Function("api", "REPLAY_ALARM", `${menu}; return installMenu();`)(
      { alarms: { create: (...args: unknown[]) => scheduled.push(args) } },
      "replay",
    );
    assertEquals(scheduled, [["replay", { periodInMinutes: 1 }]]);
    const version = adaptSource(
      product,
      "src/version.js",
      await read(product, "src/version.js"),
    );
    assert(version.includes(`VERSION = "${product.version}"`));
  }
  const product = products[2];
  const popup = adaptSource(
    product,
    "popup.js",
    await read(product, "popup.js"),
  );
  const helper = popup.slice(
    popup.indexOf("async function readAndroidSelection()"),
    popup.indexOf("async function load()"),
  );
  const key = "mastermind.capture.journal.selection.v1";
  const draftKey = "fixture.draft";
  const stored: Record<string, unknown> = {};
  let writes = 0;
  const api = {
    storage: {
      local: {
        get: () => Promise.resolve(stored),
        set: (value: Record<string, unknown>) => {
          writes++;
          Object.assign(stored, value);
          return Promise.resolve();
        },
      },
    },
    tabs: {
      query: () => Promise.resolve([{ id: 42, url: "https://example.com" }]),
    },
    scripting: {
      executeScript: () => Promise.resolve([{ result: "原文 selected text" }]),
    },
  };
  const capture = new Function(
    "api",
    "DRAFT_KEY",
    `${helper}; return readAndroidSelection;`,
  )(api, draftKey);
  await capture();
  assertEquals(writes, 1);
  assertEquals((stored[key] as { text: string }).text, "原文 selected text");
  await capture();
  assertEquals(writes, 1); // Pending selection survives reopening; no overwrite.
  stored[draftKey] = { selectionId: (stored[key] as { id: string }).id };
  delete stored[key];
  await capture();
  assertEquals(writes, 1); // A consumed selection must not append again on reopen.
  delete stored[draftKey];
  delete stored[key];
  api.storage.local.set = () => Promise.resolve();
  let failed = false;
  try {
    await capture();
  } catch {
    failed = true;
  }
  assert(failed); // Missing durable readback is never accepted.
});
