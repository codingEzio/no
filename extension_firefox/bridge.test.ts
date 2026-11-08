// Same source-test assert dependency as the owning VIA module.
// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("bridge.js", import.meta.url));
function fixture() {
  const values: Record<string, unknown> = {};
  const messages: unknown[] = [];
  let rejectCopy = false;
  const browser = {
    storage: {
      local: {
        get: (key: string) => Promise.resolve({ [key]: values[key] }),
        set: (next: Record<string, unknown>) => {
          Object.assign(values, structuredClone(next));
          return Promise.resolve();
        },
      },
    },
    runtime: {
      sendMessage: (message: unknown) => {
        messages.push(message);
        return Promise.resolve(rejectCopy ? { ok: false } : { ok: true });
      },
    },
  };
  const bridge = new Function(
    "browser",
    `${source}; return { GM_getValue, GM_setValue, GM_setClipboard };`,
  )(browser);
  return { bridge, messages, values, rejectClipboard: () => rejectCopy = true };
}

Deno.test("extension storage persists and exactly reads back the original capture bytes", async () => {
  const { bridge, values } = fixture();
  assertEquals(await bridge.GM_getValue("missing", "fallback"), "fallback");
  const envelope = {
    outbox: [{ operation_id: "fixture-operation", bytes: "原文\n" }],
    target: "termux",
  };
  await bridge.GM_setValue("prometheus.via.transfer.via-bookmark.v1", envelope);
  assertEquals(
    await bridge.GM_getValue("prometheus.via.transfer.via-bookmark.v1"),
    envelope,
  );
  assertEquals(Object.keys(values), [
    "prometheus.via.transfer.via-bookmark.v1",
  ]);
});

Deno.test("clipboard bridge awaits success and propagates failure without claiming Copy", async () => {
  const { bridge, messages, rejectClipboard } = fixture();
  await bridge.GM_setClipboard("原文\n", "text");
  assertEquals(messages, [{
    type: "prometheus.firefox.clipboard.v1",
    text: "原文\n",
  }]);
  rejectClipboard();
  await assertRejects(() => bridge.GM_setClipboard("retry", "text"));
});
