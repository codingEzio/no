import { parseServerIdentity, type ServerIdentity } from "./transport.ts";

export type ProviderCapability = {
  implemented: boolean;
  configured: boolean;
  available: boolean;
  reason: string | null;
};
export type CalendarCapabilities = {
  native_calendar: ProviderCapability;
  /** Browser client configuration is checked by the browser, never inferred here. */
  outlook: ProviderCapability;
};
export function calendarCapabilities(
  _authority: "local" | "cloud",
  _platform?: string,
  _nativeConfigured = false,
): CalendarCapabilities {
  return {
    native_calendar: {
      implemented: false,
      configured: false,
      available: false,
      reason: "retired",
    },
    outlook: {
      implemented: false,
      configured: false,
      available: false,
      reason: "retired",
    },
  };
}
export type ServerAddressGroup = { local_urls: string[]; lan_urls: string[] };
export type CaptureCapability = {
  available: boolean;
  transport_mode: "local" | "paired";
  identity_path: "/api/identity";
  session_path: "/api/session" | null;
  pair_claim_path: "/api/pair/claim" | null;
  write_path: "/api/preview/write";
  readback_path: "/api/preview/entries/:id";
  prepare_path: "/api/preview/bookmarks/parse";
  tags_path: "/api/preview/tags";
  recent_path: "/api/preview/recent";
  pairing_supported: boolean;
  methods: {
    identity: "GET";
    session: "GET";
    pair_claim: "POST";
    write: "POST";
    readback: "GET";
    prepare: "POST";
    tags: "GET";
    recent: "GET";
  };
  auth: {
    kind: "local-trust" | "paired-device";
    authorization_header: "Authorization" | null;
    site_access_header: "OAI-Sites-Authorization" | null;
  };
  scopes: {
    create_journal: readonly string[];
    create_bookmark: readonly string[];
    entry_link: readonly string[];
    prepare: readonly string[];
    options: readonly string[];
    recent: readonly string[];
    readback: readonly string[];
  };
};
export type ServerInfo = {
  version: 1;
  runtime: "mac" | "termux" | "sites" | "other";
  origin: string;
  identity: ServerIdentity;
  addresses: {
    frontend: ServerAddressGroup;
    /** Usable public API proxy addresses, including physical LAN links. */
    api: ServerAddressGroup;
    /** Optional private listener metadata; never a LAN capture destination. */
    backend_listener?: ServerAddressGroup;
  };
  observed_at: string;
  capabilities: CalendarCapabilities & { capture: CaptureCapability };
  endpoints: {
    api_base: string;
    identity: string;
    capabilities: string;
    server_info: string;
    settings: string;
    settings_schema: string;
  };
};
/** Safe discovery metadata only. Each selected endpoint still requires live identity validation. */
export function buildServerInfo(options: {
  origin: string;
  identity: ServerIdentity;
  platform?: string;
  nativeCalendarConfigured?: boolean;
  captureWritable?: boolean;
  frontendAddresses?: ServerAddressGroup;
  apiAddresses?: ServerAddressGroup;
  backendListenerAddresses?: ServerAddressGroup;
  now?: Date;
}): ServerInfo {
  const url = new URL(options.origin);
  if (
    !["http:", "https:"].includes(url.protocol) || url.username ||
    url.password || url.pathname !== "/" || url.search || url.hash
  ) {
    throw new Error("Invalid server origin");
  }
  const origin = url.origin;
  const identity = parseServerIdentity(options.identity);
  const cloud = identity.authority === "cloud";
  const empty = () => ({ local_urls: [], lan_urls: [] });
  const addressGroup = (group?: ServerAddressGroup) =>
    group
      ? { local_urls: group.local_urls, lan_urls: group.lan_urls }
      : empty();
  const scopes = (scope: string) => cloud ? [scope] : [];
  const capture: CaptureCapability = {
    available: options.captureWritable !== false,
    transport_mode: cloud ? "paired" : "local",
    identity_path: "/api/identity",
    session_path: cloud ? "/api/session" : null,
    pair_claim_path: cloud ? "/api/pair/claim" : null,
    write_path: "/api/preview/write",
    readback_path: "/api/preview/entries/:id",
    prepare_path: "/api/preview/bookmarks/parse",
    tags_path: "/api/preview/tags",
    recent_path: "/api/preview/recent",
    pairing_supported: cloud,
    methods: {
      identity: "GET",
      session: "GET",
      pair_claim: "POST",
      write: "POST",
      readback: "GET",
      prepare: "POST",
      tags: "GET",
      recent: "GET",
    },
    auth: {
      kind: cloud ? "paired-device" : "local-trust",
      authorization_header: cloud ? "Authorization" : null,
      site_access_header: cloud ? "OAI-Sites-Authorization" : null,
    },
    scopes: {
      create_journal: scopes("journal:create"),
      create_bookmark: scopes("bookmark:capture"),
      entry_link: scopes("entry:capture"),
      prepare: scopes("capture:prepare"),
      options: scopes("capture:options"),
      recent: scopes("capture:recent"),
      readback: scopes("capture:read-own"),
    },
  };
  return {
    version: 1,
    runtime: cloud
      ? "sites"
      : options.platform === "darwin"
      ? "mac"
      : options.platform === "android"
      ? "termux"
      : "other",
    origin,
    identity,
    addresses: {
      frontend: cloud ? empty() : addressGroup(options.frontendAddresses),
      api: cloud ? empty() : addressGroup(options.apiAddresses),
      ...(!cloud && options.backendListenerAddresses
        ? { backend_listener: addressGroup(options.backendListenerAddresses) }
        : {}),
    },
    observed_at: (options.now ?? new Date()).toISOString(),
    capabilities: {
      ...calendarCapabilities(
        identity.authority,
        options.platform,
        options.nativeCalendarConfigured,
      ),
      capture,
    },
    endpoints: {
      api_base: origin,
      identity: `${origin}/api/identity`,
      capabilities: `${origin}/api/capabilities`,
      server_info: `${origin}/api/server-info`,
      settings: `${origin}/api/settings`,
      settings_schema: `${origin}/api/settings/schema`,
    },
  };
}
