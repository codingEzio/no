(() => {
  const key = "no.displayFont.v1";
  const allowed = new Set(["system", "pixel", "departure"]);
  const apply = value => {
    const font = allowed.has(value) ? value : "system";
    document.documentElement.dataset.noFont = font;
    const select = document.getElementById("font-choice");
    if (select) select.value = font;
  };
  const select = document.getElementById("font-choice");
  chrome.storage.local.get(key).then(value => apply(value[key]));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[key]) apply(changes[key].newValue);
  });
  select?.addEventListener("change", async () => {
    const before = (await chrome.storage.local.get(key))[key];
    select.disabled = true;
    try {
      await chrome.storage.local.set({ [key]: select.value });
      const saved = (await chrome.storage.local.get(key))[key];
      if (saved !== select.value) throw new Error("Font preference readback differs");
      apply(saved);
    } catch {
      apply(before);
      const status = document.getElementById("status");
      if (status) { status.textContent = chrome.i18n.getMessage("storage"); status.dataset.error = "true"; }
    } finally { select.disabled = false; }
  });
})();
