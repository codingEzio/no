// Fallback for navigations served directly by a site's Service Worker, where
// dynamic rules may not get a chance to redirect. Reads the URL and local
// policy only; never inspects page content.
(() => {
  const api = globalThis.chrome;
  const DEFAULT_DOMAINS = [];

  function matchesDomain(value, domain) {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase().replace(/\.$/, "");
      const target = String(domain).toLowerCase().replace(/\.$/, "");
      return target.length > 0 && /^https?:$/.test(url.protocol) &&
        (host === target || host.endsWith(`.${target}`));
    } catch {
      return false;
    }
  }

  // v2 entries and a not-yet-migrated v1 string list are both honored. An
  // explicitly saved empty list stays empty.
  function readDomains(settings) {
    const stored = settings?.domains;
    if (!Array.isArray(stored)) return DEFAULT_DOMAINS;
    const domains = [];
    for (const item of stored) {
      if (typeof item === "string") domains.push(item);
      else if (
        item && typeof item === "object" && item.enabled === true &&
        typeof item.domain === "string"
      ) domains.push(item.domain);
    }
    return domains;
  }

  async function enforce() {
    let domains = DEFAULT_DOMAINS;
    try {
      const response = await api.runtime.sendMessage({ type: "get" });
      if (!response?.ok) return false;
      domains = readDomains(response.settings);
    } catch {
      // The saved policy can still be used if the worker is unavailable.
      try {
        const { settings } = await api.storage.local.get("settings");
        domains = readDomains(settings);
      } catch { return false; }
    }
    if (
      !domains.some((domain) =>
        typeof domain === "string" && matchesDomain(location.href, domain)
      )
    ) return false;
    stop();
    location.replace(api.runtime.getURL("blocked.html"));
    return true;
  }

  enforce();
  addEventListener("pageshow", (event) => {
    if (event.persisted) enforce();
  });
})();
