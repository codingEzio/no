// Canonical versioned source policy. Generated browser copies must match bytes.
export const BOOKMARK_SOURCE_POLICY_VERSION = 1;
export const BOOKMARK_SOURCE_RULES = Object.freeze([
  {
    id: "bili-nsfw",
    site: "bili",
    account: "10997485",
    folder: "3852211585",
    name: "NSFW",
    tag: "nsfw-yt-bili",
    archived: false,
    nsfw: true,
  },
  {
    id: "bili-sfw",
    site: "bili",
    account: "10997485",
    folder: "59504785",
    name: "SFW",
    tag: "video",
    archived: true,
    nsfw: false,
  },
  {
    id: "bili-hajimi",
    site: "bili",
    account: "10997485",
    folder: "3944938085",
    name: "哈吉米",
    tag: "video",
    archived: true,
    nsfw: false,
  },
  {
    id: "bili-bf",
    site: "bili",
    account: "10997485",
    folder: "3872405585",
    name: "BF Series",
    tag: "video",
    archived: true,
    nsfw: false,
  },
  {
    id: "x-bookmarks",
    site: "x",
    name: "Bookmarks",
    tag: "inbox",
    archived: false,
    nsfw: false,
  },
  {
    id: "x-likes",
    site: "x",
    name: "Likes",
    tag: "inbox",
    archived: true,
    nsfw: false,
  },
]);
/** @param {string[]} ids */
export function resolveBookmarkSourcePolicy(ids) {
  if (
    !Array.isArray(ids) || !ids.length ||
    ids.length > BOOKMARK_SOURCE_RULES.length ||
    new Set(ids).size !== ids.length
  ) throw new Error("Invalid bookmark source membership");
  const rules = ids.map((id) => {
    const rule = BOOKMARK_SOURCE_RULES.find((r) => r.id === id);
    if (!rule) throw new Error("Unknown bookmark source ID");
    return rule;
  });
  const first = rules[0];
  if (
    rules.some((r) =>
      r.site !== first.site || r.tag !== first.tag || r.nsfw !== first.nsfw
    )
  ) throw new Error("Conflicting bookmark source policies");
  return {
    tag: first.tag,
    archived: rules.every((r) => r.archived),
    nsfw: first.nsfw,
  };
}
/** @typedef {{id:string,account?:string,account_id?:string,captured_at?:string}} BookmarkSourceMembership */
/** @typedef {{version:number,record_id:string,url:string,sources:BookmarkSourceMembership[]}} BookmarkSourceProvenance */
/** @param {unknown} value @returns {BookmarkSourceProvenance} */
export function normalizeBookmarkSourceProvenance(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid bookmark provenance");
  }
  const input = /** @type {Record<string, unknown>} */ (value);
  if (
    Object.keys(input).some((k) =>
      !["version", "record_id", "url", "sources"].includes(k)
    ) || input.version !== BOOKMARK_SOURCE_POLICY_VERSION ||
    !Array.isArray(input.sources)
  ) throw new Error("Unsupported bookmark source policy version or field");
  const sources = input.sources.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Invalid bookmark source membership");
    }
    const source = /** @type {Record<string, unknown>} */ (raw);
    if (
      Object.keys(source).some((k) =>
        !["id", "account", "account_id", "captured_at"].includes(k)
      ) || typeof source.id !== "string"
    ) throw new Error("Invalid bookmark source membership");
    const rule = BOOKMARK_SOURCE_RULES.find((r) => r.id === source.id);
    if (!rule) throw new Error("Unknown bookmark source ID");
    const result = /** @type {BookmarkSourceMembership} */ ({ id: source.id });
    if (source.account !== undefined) {
      if (
        typeof source.account !== "string" ||
        (rule.site === "bili"
          ? source.account !== rule.account
          : !/^[A-Za-z0-9_]{1,15}$/.test(source.account))
      ) throw new Error("Invalid bookmark source account");
      result.account = source.account;
    }
    if (source.account_id !== undefined) {
      if (
        typeof source.account_id !== "string" ||
        !/^\d{1,30}$/.test(source.account_id)
      ) throw new Error("Invalid bookmark source account ID");
      result.account_id = source.account_id;
    }
    if (source.captured_at !== undefined) {
      if (
        typeof source.captured_at !== "string" ||
        source.captured_at.length > 35 ||
        !/^\d{4}-\d{2}-\d{2}T/.test(source.captured_at) ||
        !Number.isFinite(Date.parse(source.captured_at))
      ) throw new Error("Invalid bookmark source capture time");
      result.captured_at = source.captured_at;
    }
    return result;
  });
  resolveBookmarkSourcePolicy(sources.map((s) => s.id));
  for (const field of ["account", "account_id"]) {
    if (new Set(sources.map((s) => s[field]).filter(Boolean)).size > 1) {
      throw new Error("Conflicting bookmark source accounts");
    }
  }
  if (
    typeof input.url !== "string" || input.url.length > 4096 ||
    typeof input.record_id !== "string" || input.record_id.length > 40
  ) {
    throw new Error("Invalid bookmark source record");
  }
  const url = new URL(input.url),
    site = BOOKMARK_SOURCE_RULES.find((r) => r.id === sources[0].id).site;
  const id = site === "x"
    ? url.pathname.match(/^\/[A-Za-z0-9_]{1,15}\/status\/(\d{1,30})$/)?.[1]
    : url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10}|av\d+)$/)?.[1];
  if (
    !id || url.protocol !== "https:" || url.port || url.username ||
    url.password || url.search || url.hash ||
    (site === "x"
      ? url.hostname !== "x.com"
      : url.hostname !== "www.bilibili.com") ||
    input.record_id !== `${site}:${id}`
  ) throw new Error("Invalid bookmark source record identity");
  return {
    version: BOOKMARK_SOURCE_POLICY_VERSION,
    record_id: input.record_id,
    url: input.url,
    sources,
  };
}
/** @param {BookmarkSourceProvenance} provenance */
export function bookmarkSourceComment(provenance) {
  const p = normalizeBookmarkSourceProvenance(provenance);
  // Compact tuple avoids repeating the already explicit Markdown URL.
  const sources = p.sources.map((s) => {
    const tuple = [
      s.id,
      s.account ?? null,
      s.account_id ?? null,
      s.captured_at ?? null,
    ];
    while (tuple.at(-1) === null) tuple.pop();
    return tuple;
  });
  return `<!-- prometheus-source:${
    encodeURIComponent(JSON.stringify([p.version, p.record_id, sources]))
  } -->`;
}
/** @param {string} token @param {string} url */
export function parseBookmarkSourceComment(token, url) {
  const value = JSON.parse(decodeURIComponent(token));
  if (!Array.isArray(value) || value.length !== 3 || !Array.isArray(value[2])) {
    throw new Error("Invalid bookmark source comment");
  }
  return normalizeBookmarkSourceProvenance({
    version: value[0],
    record_id: value[1],
    url,
    sources: value[2].map((s) => {
      if (!Array.isArray(s) || s.length < 1 || s.length > 4) {
        throw new Error("Invalid bookmark source tuple");
      }
      return {
        id: s[0],
        ...(s[1] == null ? {} : { account: s[1] }),
        ...(s[2] == null ? {} : { account_id: s[2] }),
        ...(s[3] == null ? {} : { captured_at: s[3] }),
      };
    }),
  });
}
