// Pure domain-blocking policy. No browser globals, no storage, no network.
// The popup, the background service worker and the Deno tests share this file.

export const SCHEMA_VERSION = 2;
export const DEFAULT_DOMAINS = [];
export const MAX_DOMAINS = 1000;
export const RULE_ID = 1;

/**
 * @typedef {{ domain: string, enabled: boolean }} DomainEntry
 * @typedef {{
 *   schemaVersion: number,
 *   revision: number,
 *   domains: DomainEntry[],
 *   theme?: string,
 *   language?: string,
 * }} Settings
 */

export class PolicyError extends Error {
  constructor(code, detail = "", saved = false) {
    super(detail || code);
    this.code = code;
    this.saved = saved;
  }
}

// Canonical hostname of one added domain or pasted http(s) URL. Strict on
// purpose: wildcards, whitespace, a bare port/path or userinfo are rejected
// instead of guessed, and only the hostname survives a full URL.
export function normalizeDomainInput(raw) {
  const detail = typeof raw === "string" ? raw.trim() : "";
  if (typeof raw !== "string" || raw.length > 2048 || detail === "") {
    throw new PolicyError("domain", detail);
  }
  if (/\s|[\\*]/u.test(detail)) throw new PolicyError("domain", detail);
  const fullURL = /^https?:\/\//i.test(detail);
  if (!fullURL && /[:/?#@]/u.test(detail)) {
    throw new PolicyError("domain", detail);
  }
  let url;
  try {
    url = new URL(fullURL ? detail : `https://${detail}`);
  } catch {
    throw new PolicyError("domain", detail);
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new PolicyError("domain", detail);
  }
  const domain = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    domain.length === 0 || domain.length > 253 || !domain.includes(".") ||
    /^[\d.]+$/.test(domain)
  ) throw new PolicyError("domain", detail);
  if (
    !domain.split(".").every((part) =>
      /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(part)
    )
  ) throw new PolicyError("domain", detail);
  return domain;
}

// Stored entries are normalized on the way in: first domain wins, and only an
// explicit enabled: true blocks, so corrupt rows never start blocking a site.
/** @returns {DomainEntry[]} */
export function validateEntries(value) {
  if (!Array.isArray(value)) throw new PolicyError("settings");
  if (value.length > MAX_DOMAINS) throw new PolicyError("limit");
  const entries = [];
  const seen = new Set();
  for (const item of value) {
    if (!item || typeof item !== "object") throw new PolicyError("settings");
    const domain = normalizeDomainInput(item.domain);
    if (seen.has(domain)) continue;
    seen.add(domain);
    entries.push({ domain, enabled: item.enabled === true });
  }
  return entries;
}

export function enabledDomains(entries) {
  const seen = new Set();
  for (const item of entries ?? []) {
    if (item?.enabled === true && typeof item.domain === "string") {
      seen.add(item.domain);
    }
  }
  return [...seen].sort();
}

// Source rule shape: one dynamic rule redirects main-frame http(s) visits to
// the local block page. requestDomains keeps exact-domain plus subdomain
// behavior, never a wider suffix match.
export function rulesFor(entries) {
  const requestDomains = enabledDomains(entries);
  if (requestDomains.length === 0) return [];
  return [{
    id: RULE_ID,
    priority: 1,
    action: {
      type: "redirect",
      redirect: { extensionPath: "/blocked.html" },
    },
    condition: {
      urlFilter: "|http",
      requestDomains,
      resourceTypes: ["main_frame"],
    },
  }];
}

export function matchesDomain(value, domain) {
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

/** @returns {Settings} */
export function defaultSettings() {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    domains: DEFAULT_DOMAINS.map((domain) => ({ domain, enabled: true })),
  };
}

// Legacy theme/language values are kept so a rebuilt popup never destroys
// stored data it does not edit. Any other unknown key is safely ignored.
/** @returns {{ theme?: string, language?: string }} */
function preservedExtras(value) {
  /** @type {{ theme?: string, language?: string }} */
  const extras = {};
  if (typeof value?.theme === "string") extras.theme = value.theme;
  if (typeof value?.language === "string") extras.language = value.language;
  return extras;
}

function revisionOf(value) {
  return Number.isSafeInteger(value?.revision) && value.revision >= 0
    ? value.revision
    : 0;
}

/** @returns {Settings} */
export function migrateSettings(value) {
  if (value === undefined || value === null) return defaultSettings();
  if (value.schemaVersion === SCHEMA_VERSION) {
    if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
      throw new PolicyError("settings");
    }
    return {
      ...preservedExtras(value),
      schemaVersion: SCHEMA_VERSION,
      revision: value.revision,
      domains: validateEntries(value.domains),
    };
  }
  if (value.schemaVersion === 1 || value.schemaVersion === undefined) {
    if (!Array.isArray(value.domains)) throw new PolicyError("settings");
    if (value.domains.length > MAX_DOMAINS) throw new PolicyError("limit");
    const domains = [];
    const seen = new Set();
    for (const item of value.domains) {
      if (typeof item !== "string") throw new PolicyError("settings");
      const domain = normalizeDomainInput(item);
      if (seen.has(domain)) continue;
      seen.add(domain);
      domains.push({ domain, enabled: true });
    }
    return {
      ...preservedExtras(value),
      schemaVersion: SCHEMA_VERSION,
      revision: revisionOf(value),
      domains,
    };
  }
  throw new PolicyError("settings");
}

// Pure save plan: the revision check refuses a stale editor, and stored extras
// survive because only the entry list is replaced.
/** @returns {Settings} */
export function planSave(current, incoming, baseRevision) {
  if (!current || baseRevision !== current.revision) {
    throw new PolicyError("conflict");
  }
  return {
    ...current,
    schemaVersion: SCHEMA_VERSION,
    revision: current.revision + 1,
    domains: validateEntries(incoming?.domains),
  };
}

export function pendingMarker(revision) {
  return { pending: { revision } };
}

export function pendingFor(settings, pending) {
  if (
    settings && pending && Number.isSafeInteger(pending.revision) &&
    pending.revision === settings.revision
  ) return { revision: pending.revision };
  return undefined;
}

function canonical(value, key = "") {
  if (Array.isArray(value)) {
    const result = value.map((item) => canonical(item));
    return key === "requestDomains" ? result.sort() : result;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([entryKey, entryValue]) => [
          entryKey,
          canonical(entryValue, entryKey),
        ]),
    );
  }
  return value;
}

// Rule readback compares canonically: key order and requestDomains order are
// not meaningful, any real difference is.
export function rulesMatch(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected));
}
