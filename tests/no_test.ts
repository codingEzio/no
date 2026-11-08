// Focused policy tests for the `no` Chrome extension.
// Run with: deno test --allow-read module_extensions/tests/no_test.ts

import {
  DEFAULT_DOMAINS,
  defaultSettings,
  matchesDomain,
  MAX_DOMAINS,
  migrateSettings,
  normalizeDomainInput,
  pendingFor,
  pendingMarker,
  planSave,
  PolicyError,
  rulesFor,
  rulesMatch,
  validateEntries,
} from "../extension_chrome/src/core.js";
import { createController } from "../extension_chrome/src/controller.js";
import { VERSION } from "../extension_chrome/src/version.js";

const extensionRoot = new URL("../extension_chrome/", import.meta.url);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) {
    throw new Error(`${message ?? "assertEquals"}: ${left} !== ${right}`);
  }
}

function assertThrows(fn: () => unknown, code: string, message?: string) {
  let thrown: unknown;
  let threw = false;
  try {
    fn();
  } catch (error) {
    threw = true;
    thrown = error;
  }
  assert(threw, `${message ?? "assertThrows"}: nothing was thrown`);
  assert(
    thrown instanceof PolicyError,
    `${message ?? "assertThrows"}: not a PolicyError`,
  );
  assertEquals(thrown.code, code, message);
}

interface FakeRule {
  id: number;
  priority: number;
  action: { type: string; redirect: { extensionPath: string } };
  condition: {
    urlFilter: string;
    requestDomains: string[];
    resourceTypes: string[];
  };
}

interface StoredSettings {
  schemaVersion?: number;
  revision?: number;
  domains?: { domain: string; enabled: boolean }[] | string[];
  theme?: string;
  language?: string;
}

interface FakeState {
  saved: { settings?: StoredSettings };
  pending: { revision: number } | undefined;
  rules: FakeRule[];
  failRules: boolean;
  ruleReads: number;
  ruleUpdates: number;
}

function fixture() {
  const state: FakeState = {
    saved: {},
    pending: undefined,
    rules: [],
    failRules: false,
    ruleReads: 0,
    ruleUpdates: 0,
  };
  const api = {
    storage: {
      local: {
        get: () =>
          Promise.resolve({
            ...structuredClone(state.saved),
            ...(state.pending === undefined
              ? {}
              : { pending: structuredClone(state.pending) }),
          }),
        set: (value: Record<string, unknown>) => {
          const next = structuredClone(value);
          if (Object.hasOwn(next, "pending")) {
            state.pending = next.pending as { revision: number } | undefined;
            delete next.pending;
          }
          Object.assign(state.saved, next);
          return Promise.resolve();
        },
        remove: (key: string) => {
          if (key === "pending") state.pending = undefined;
          return Promise.resolve();
        },
      },
    },
    declarativeNetRequest: {
      getDynamicRules: () => {
        state.ruleReads += 1;
        return Promise.resolve(structuredClone(state.rules));
      },
      updateDynamicRules: ({ addRules }: { addRules: FakeRule[] }) => {
        state.ruleUpdates += 1;
        if (state.failRules) throw new Error("Interrupted");
        state.rules = structuredClone(addRules);
        return Promise.resolve();
      },
    },
  };
  return { state, api };
}

Deno.test("new installations start with no blocked domains", () => {
  assertEquals(DEFAULT_DOMAINS, []);
  assertEquals(defaultSettings(), { schemaVersion: 2, revision: 0, domains: [] });
});

Deno.test("a saved empty list stays empty and never falls back to defaults", () => {
  const migrated = migrateSettings({
    schemaVersion: 2,
    revision: 4,
    domains: [],
  });
  assertEquals(migrated.domains, []);
  assertEquals(migrated.revision, 4);
  assertEquals(rulesFor(migrated.domains), []);
  assertEquals(
    migrateSettings({ schemaVersion: 1, revision: 2, domains: [] }).domains,
    [],
  );
  assertEquals(migrateSettings(undefined).domains.length, 0);
});

Deno.test("only enabled entries produce the source rule shape", () => {
  const rules = rulesFor([
    { domain: "y.com", enabled: false },
    { domain: "x.com", enabled: true },
    { domain: "z.com", enabled: true },
    { domain: "x.com", enabled: true },
  ]);
  assertEquals(rules.length, 1);
  assertEquals(rules[0], {
    id: 1,
    priority: 1,
    action: {
      type: "redirect",
      redirect: { extensionPath: "/blocked.html" },
    },
    condition: {
      urlFilter: "|http",
      requestDomains: ["x.com", "z.com"],
      resourceTypes: ["main_frame"],
    },
  });
  assertEquals(
    rulesFor([
      { domain: "x.com", enabled: false },
      { domain: "y.com", enabled: false },
    ]),
    [],
  );
});

Deno.test("add parsing accepts bare domains and http(s) URLs", () => {
  assertEquals(normalizeDomainInput("v2ex.com"), "v2ex.com");
  assertEquals(normalizeDomainInput(" V2EX.COM. "), "v2ex.com");
  assertEquals(normalizeDomainInput("https://x.com/path?q=1#top"), "x.com");
  assertEquals(normalizeDomainInput("http://ITHOME.COM"), "ithome.com");
  assertEquals(normalizeDomainInput("例子.台灣"), "xn--fsqu00a.xn--kpry57d");
});

Deno.test("add parsing rejects wildcards, ports, paths, spaces, userinfo, IP-only and dotless input", () => {
  const rejected = [
    "",
    "com",
    "*.x.com",
    "x.com evil.com",
    "https://user:pass@x.com",
    "x.com:443",
    "x.com/path",
    "x.com?q=1",
    "x.com#top",
    "file:///x.com",
    "-bad.com",
    "a..com",
    "127.0.0.1",
    "192.168.0.1",
    "x.com\\y",
  ];
  for (const bad of rejected) {
    assertThrows(
      () => normalizeDomainInput(bad),
      "domain",
      `accepted ${JSON.stringify(bad)}`,
    );
  }
});

Deno.test("add parsing enforces the hostname length and entry limits", () => {
  const long = [
    "a".repeat(63),
    "b".repeat(63),
    "c".repeat(63),
    "d".repeat(62),
  ].join(".");
  assertEquals(long.length, 254);
  assertThrows(() => normalizeDomainInput(long), "domain");

  const entries = Array.from({ length: MAX_DOMAINS }, (_, index) => ({
    domain: `host${index}.example.com`,
    enabled: true,
  }));
  assertEquals(validateEntries(entries).length, MAX_DOMAINS);
  assertThrows(
    () =>
      validateEntries([...entries, {
        domain: "extra.example.com",
        enabled: true,
      }]),
    "limit",
  );
});

Deno.test("matchesDomain covers roots, subdomains, suffix lookalikes and protocols", () => {
  for (
    const url of [
      "https://x.com/",
      "http://www.x.com/a",
      "https://a.b.x.com:444/",
      "https://x.com./",
    ]
  ) {
    assertEquals(matchesDomain(url, "x.com"), true, url);
  }
  for (
    const url of [
      "https://notx.com",
      "https://x.com.evil.test",
      "https://example.com/?next=x.com",
      "ftp://x.com/",
      "file:///x.com",
      "chrome-extension://abc/x.com",
      "invalid",
    ]
  ) {
    assertEquals(matchesDomain(url, "x.com"), false, url);
  }
  assertEquals(matchesDomain("https://x.com", "x.com."), true);
});

Deno.test("v1 string lists migrate to enabled entries and keep legacy values", () => {
  const migrated = migrateSettings({
    schemaVersion: 1,
    revision: 3,
    domains: ["v2ex.com", "V2EX.COM.", "x.com"],
    theme: "dark",
    language: "zh_TW",
    typographyMode: "roboto",
  });
  assertEquals(migrated.schemaVersion, 2);
  assertEquals(migrated.revision, 3);
  assertEquals(migrated.domains, [
    { domain: "v2ex.com", enabled: true },
    { domain: "x.com", enabled: true },
  ]);
  assertEquals(migrated.theme, "dark");
  assertEquals(migrated.language, "zh_TW");
  assertEquals(Object.hasOwn(migrated, "typographyMode"), false);
  assertEquals(
    migrateSettings({ schemaVersion: 1, domains: ["x.com"] }).revision,
    0,
  );
});

Deno.test("v2 records reload without drift and unknown keys are ignored safely", () => {
  const stored = {
    schemaVersion: 2,
    revision: 7,
    domains: [
      { domain: "x.com", enabled: true },
      { domain: "y.com", enabled: false },
    ],
    theme: "light",
    typographyMode: "roboto",
    future: { nested: true },
  };
  const once = migrateSettings(stored);
  const twice = migrateSettings(JSON.parse(JSON.stringify(once)));
  assertEquals(twice, once);
  assertEquals(once.domains, [
    { domain: "x.com", enabled: true },
    { domain: "y.com", enabled: false },
  ]);
  assertEquals(once.theme, "light");
  assertEquals(Object.hasOwn(once, "typographyMode"), false);
  assertEquals(Object.hasOwn(once, "future"), false);
});

Deno.test("malformed stored records are rejected instead of guessed", () => {
  assertThrows(
    () => migrateSettings({ schemaVersion: 2, revision: "x", domains: [] }),
    "settings",
  );
  assertThrows(
    () =>
      migrateSettings({ schemaVersion: 2, revision: 1, domains: ["x.com"] }),
    "settings",
  );
  assertThrows(
    () => migrateSettings({ schemaVersion: 1, domains: "x.com" }),
    "settings",
  );
  assertThrows(
    () =>
      migrateSettings({ schemaVersion: 1, domains: ["x.com", "bad domain"] }),
    "domain",
  );
  assertThrows(
    () => migrateSettings({ schemaVersion: 9, domains: [] }),
    "settings",
  );
  assertThrows(
    () => validateEntries([{ domain: "x.com", enabled: true }, "y.com"]),
    "settings",
  );
  assertThrows(() => validateEntries("x.com"), "settings");
});

Deno.test("planSave enforces the revision check and keeps stored extras", () => {
  const current = migrateSettings({
    schemaVersion: 2,
    revision: 5,
    domains: [{ domain: "x.com", enabled: true }],
    theme: "dark",
  });
  const next = planSave(current, {
    domains: [{ domain: "y.com", enabled: false }],
  }, 5);
  assertEquals(next.revision, 6);
  assertEquals(next.domains, [{ domain: "y.com", enabled: false }]);
  assertEquals(next.theme, "dark");
  assertThrows(() => planSave(current, { domains: [] }, 4), "conflict");
  assertThrows(() => planSave(current, { domains: [] }, 6), "conflict");
});

Deno.test("pending markers only apply to their own revision", () => {
  assertEquals(pendingMarker(3), { pending: { revision: 3 } });
  assertEquals(pendingFor({ revision: 3 }, { revision: 3 }), { revision: 3 });
  assertEquals(pendingFor({ revision: 3 }, { revision: 2 }), undefined);
  assertEquals(pendingFor({ revision: 3 }, undefined), undefined);
  assertEquals(pendingFor({ revision: 3 }, { revision: "3" }), undefined);
});

Deno.test("rulesMatch compares rules ignoring key and domain order", () => {
  const expected = rulesFor([
    { domain: "y.com", enabled: true },
    { domain: "x.com", enabled: true },
  ]);
  const reordered = [{
    condition: {
      resourceTypes: ["main_frame"],
      requestDomains: ["y.com", "x.com"],
      urlFilter: "|http",
    },
    action: { redirect: { extensionPath: "/blocked.html" }, type: "redirect" },
    priority: 1,
    id: 1,
  }];
  assertEquals(rulesMatch(reordered, expected), true);
  assertEquals(rulesMatch([], expected), false);
  assertEquals(
    rulesMatch(expected, rulesFor([{ domain: "x.com", enabled: true }])),
    false,
  );
  assertEquals(rulesMatch([], []), true);
});

Deno.test("get is local: it never reads or rewrites dynamic rules", async () => {
  const { state, api } = fixture();
  const result = await createController(api).handle({ type: "get" });
  assertEquals(result.settings.domains.length, 0);
  assertEquals(state.ruleReads, 0);
  assertEquals(state.ruleUpdates, 0);
});

Deno.test("save persists intent before rules and reports pending when apply fails", async () => {
  const { state, api } = fixture();
  const controller = createController(api);
  const initial = await controller.handle({ type: "get" });
  state.failRules = true;
  let failure: unknown;
  try {
    await controller.handle({
      type: "save",
      settings: { domains: [{ domain: "example.com", enabled: true }] },
      baseRevision: initial.settings.revision,
    });
  } catch (error) {
    failure = error;
  }
  assert(failure instanceof PolicyError, "apply failure must be a PolicyError");
  assertEquals(failure.code, "apply");
  assertEquals(failure.saved, true);
  assertEquals(state.saved.settings?.domains, [
    { domain: "example.com", enabled: true },
  ]);
  assertEquals(state.saved.settings?.revision, 1);
  assertEquals(state.pending, { revision: 1 });

  const pendingRead = await controller.handle({ type: "get" });
  assertEquals(pendingRead.pending, { revision: 1 });

  state.failRules = false;
  await createController(api).reconcile();
  const applied = await controller.handle({ type: "get" });
  assertEquals(applied.pending, undefined);
  assertEquals(
    state.rules[0]?.condition.requestDomains[0],
    "example.com",
  );
});

Deno.test("concurrent stale editors cannot overwrite an accepted revision", async () => {
  const { state, api } = fixture();
  const controller = createController(api);
  const initial = await controller.handle({ type: "get" });
  const results = await Promise.allSettled([
    controller.handle({
      type: "save",
      settings: { domains: [{ domain: "example.com", enabled: true }] },
      baseRevision: initial.settings.revision,
    }),
    controller.handle({
      type: "save",
      settings: { domains: [{ domain: "example.org", enabled: true }] },
      baseRevision: initial.settings.revision,
    }),
  ]);
  assertEquals(results[0].status, "fulfilled");
  assert(results[1].status === "rejected", "second save must fail");
  if (results[1].status === "rejected") {
    assertEquals(results[1].reason.code, "conflict");
  }
  assertEquals(state.saved.settings?.domains, [
    { domain: "example.com", enabled: true },
  ]);
});

Deno.test("an empty save releases every rule and a malformed save keeps storage", async () => {
  const { state, api } = fixture();
  const controller = createController(api);
  await controller.handle({ type: "get" });
  await controller.handle({
    type: "save",
    settings: { domains: [] },
    baseRevision: 0,
  });
  assertEquals(state.rules, []);
  const before = JSON.stringify(state.saved);
  let threw = false;
  try {
    await controller.handle({
      type: "save",
      settings: { domains: [{ domain: "bad domain", enabled: true }] },
      baseRevision: 1,
    });
  } catch {
    threw = true;
  }
  assert(threw, "an invalid domain must reject the save");
  assertEquals(JSON.stringify(state.saved), before);
});

Deno.test("a stored v1 record is upgraded in place with the same revision", async () => {
  const { state, api } = fixture();
  state.saved.settings = {
    schemaVersion: 1,
    revision: 6,
    domains: ["X.COM."],
    theme: "dark",
  };
  const controller = createController(api);
  const result = await controller.handle({ type: "get" });
  assertEquals(result.settings.schemaVersion, 2);
  assertEquals(result.settings.revision, 6);
  assertEquals(result.settings.domains, [
    { domain: "x.com", enabled: true },
  ]);
  assertEquals(state.saved.settings.schemaVersion, 2);
  assertEquals(state.saved.settings.theme, "dark");
  assertEquals(state.ruleReads, 0);
});

Deno.test("get answers without waiting for rule reconciliation", async () => {
  const { state, api } = fixture();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  api.declarativeNetRequest.getDynamicRules = () => {
    state.ruleReads += 1;
    return gate.then(() => structuredClone(state.rules));
  };
  const controller = createController(api);
  const reconciliation = controller.reconcile();
  const result = await controller.handle({ type: "get" });
  assertEquals(result.settings.domains.length, 0);
  release();
  await reconciliation;
  assertEquals(state.rules.length, 0);
});

Deno.test("manifest matches the product contract and the version authority", async () => {
  const manifest = JSON.parse(
    await Deno.readTextFile(new URL("manifest.json", extensionRoot)),
  );
  assertEquals(manifest.manifest_version, 3);
  assertEquals(manifest.name, "__MSG_extName__");
  assertEquals(manifest.description, "__MSG_extDescription__");
  assertEquals(manifest.version, VERSION);
  assertEquals(manifest.default_locale, "en");
  assertEquals(manifest.permissions, [
    "storage",
    "declarativeNetRequestWithHostAccess",
  ]);
  assertEquals(manifest.host_permissions, ["http://*/*", "https://*/*"]);
  assertEquals(manifest.background, {
    service_worker: "background.js",
    type: "module",
  });
  assertEquals(manifest.content_scripts.length, 1);
  assertEquals(manifest.content_scripts[0].js, ["navigation.js"]);
  assertEquals(manifest.content_scripts[0].run_at, "document_start");
  assertEquals(manifest.content_scripts[0].all_frames, false);
  assertEquals(manifest.options_ui, { page: "popup.html", open_in_tab: true });
  assertEquals(manifest.action.default_popup, "popup.html");
  assertEquals(Object.keys(manifest.icons), ["16", "32", "48", "128"]);
  assertEquals(Object.keys(manifest.action.default_icon), ["16", "24", "32"]);
  const declared = [
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    manifest.background.service_worker,
    manifest.action.default_popup,
    "navigation.js",
    "blocked.html",
    "blocked.css",
    "blocked.js",
    "popup.css",
    "popup.js",
  ];
  for (const relative of declared as string[]) {
    const info = await Deno.stat(new URL(relative, extensionRoot));
    assert(info.size > 0, `missing ${relative}`);
  }
});

Deno.test("the eight source locales ship the original description text", async () => {
  const descriptions: Record<string, string> = {
    en: "Block chosen domains with a full-window NO ✋.",
    es: "Bloquea dominios con un NO ✋ que ocupa toda la ventana.",
    ja: "指定したドメインをブロックし、ウインドウ全体に NO ✋ を表示します。",
    ko: "선택한 도메인을 차단하고 창 전체에 NO ✋를 표시합니다.",
    ru: "Блокируйте выбранные домены: NO ✋ на всё окно.",
    uk: "Блокуйте вибрані домени: NO ✋ на все вікно.",
    zh_CN: "屏蔽指定域名，显示填满窗口的 NO ✋。",
    zh_TW: "封鎖指定網域，顯示填滿視窗的 NO ✋。",
  };
  const expected = Object.keys(descriptions).sort();
  const localeRoot = new URL("_locales/", extensionRoot);
  const found: string[] = [];
  for await (const entry of Deno.readDir(localeRoot)) {
    if (entry.isDirectory) found.push(entry.name);
  }
  assertEquals(found.sort(), expected);

  let englishKeys: string[] | undefined;
  for (const id of expected) {
    const messages = JSON.parse(
      await Deno.readTextFile(new URL(`${id}/messages.json`, localeRoot)),
    );
    const keys = Object.keys(messages).sort();
    if (englishKeys === undefined) englishKeys = keys;
    else assertEquals(keys, englishKeys, `${id} key set`);
    assertEquals(messages.extName.message, "no", `${id} name`);
    assertEquals(messages.extDescription.message, descriptions[id], id);
  }
});

Deno.test("every message key used by the popup and block page exists", async () => {
  const english = JSON.parse(
    await Deno.readTextFile(
      new URL("_locales/en/messages.json", extensionRoot),
    ),
  );
  const keys = new Set<string>();
  for (const file of ["popup.html", "blocked.html", "popup.js"]) {
    const text = await Deno.readTextFile(new URL(file, extensionRoot));
    for (const match of text.matchAll(/data-i18n="([A-Za-z]+)"/g)) {
      keys.add(match[1]);
    }
    for (const match of text.matchAll(/__MSG_([A-Za-z]+)__/g)) {
      keys.add(match[1]);
    }
    for (const match of text.matchAll(/\bt\("([A-Za-z]+)"/g)) {
      keys.add(match[1]);
    }
  }
  const manifest = await Deno.readTextFile(
    new URL("manifest.json", extensionRoot),
  );
  for (const match of manifest.matchAll(/__MSG_([A-Za-z]+)__/g)) {
    keys.add(match[1]);
  }
  assert(keys.size > 0, "no message keys found");
  for (const key of keys) assert(key in english, `missing message key ${key}`);
});

Deno.test("prepared icons are copied byte-identically", async () => {
  const iconsRoot = new URL("icons/", extensionRoot);
  const generatedRoot = new URL("../design/generated/chrome/", extensionRoot);
  const expected = [
    "icon-16.png",
    "icon-32.png",
    "icon-48.png",
    "icon-128.png",
    "toolbar-light-16.png",
    "toolbar-light-24.png",
    "toolbar-light-32.png",
  ];
  const found: string[] = [];
  for await (const entry of Deno.readDir(iconsRoot)) {
    if (entry.isFile) found.push(entry.name);
  }
  assertEquals(found.sort(), [...expected].sort());

  for (const name of expected) {
    const source = await Deno.readFile(new URL(name, generatedRoot));
    const target = await Deno.readFile(new URL(name, iconsRoot));
    assertEquals(target.length, source.length, name);
    assert(
      source.every((byte, index) => byte === target[index]),
      `${name} differs from the prepared icon`,
    );
  }
});
