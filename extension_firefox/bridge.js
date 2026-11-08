// Loaded in the extension's isolated content world before the shared script.
// Each Firefox identity has its own storage; no VIA/browser profile is copied.
// deno-lint-ignore no-unused-vars
async function GM_getValue(key, fallback) {
  const values = await browser.storage.local.get(key);
  return values[key] === undefined ? fallback : values[key];
}
// deno-lint-ignore no-unused-vars
async function GM_setValue(key, value) {
  await browser.storage.local.set({ [key]: value });
}
// deno-lint-ignore no-unused-vars
async function GM_setClipboard(text, format = "text") {
  if (typeof text !== "string" || format !== "text") {
    throw new Error("Unsupported clipboard value");
  }
  const result = await browser.runtime.sendMessage({
    type: "prometheus.firefox.clipboard.v1",
    text,
  });
  if (result?.ok !== true) throw new Error("Clipboard write failed");
}
