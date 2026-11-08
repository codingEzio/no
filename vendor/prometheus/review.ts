export type ReviewKind =
  | "inventory"
  | "journal"
  | "bookmark"
  | "entry"
  | "prompt";
export type InventoryStatus = "owned" | "wanted" | "goodvalue";
export type JournalCategory =
  | "idea"
  | "work"
  | "life"
  | "misc";
export const journalCategories: readonly JournalCategory[] = [
  "idea",
  "work",
  "life",
  "misc",
];
export type BookmarkGroup = "all" | "channel" | "media" | "other";

export interface ReviewEntryBase {
  id: string;
  kind: ReviewKind;
  revision: number;
  archived: boolean;
  source_ref: string | null;
  created_at: string;
}

export interface InventoryEntry extends ReviewEntryBase {
  kind: "inventory";
  title: string;
  status: InventoryStatus;
  category: string | null;
  model: string | null;
  urls: string[];
  image_url: string | null;
}

export interface JournalEntry extends ReviewEntryBase {
  kind: "journal";
  title?: string;
  body: string;
  occurred_at: string;
  category: JournalCategory;
  effective_category: JournalCategory;
  show_body?: boolean;
}

export interface BookmarkEntry extends ReviewEntryBase {
  title_prefix?: string;
  kind: "bookmark";
  title: string;
  url: string;
  favicon_url?: string | null;
  reading_available?: boolean;
  saved_at: string;
  tag_id: string | null;
  nsfw: boolean;
  /** Kept for a future recommendation; no sharing has occurred. SFW only. */
  recommend_later: boolean;
}

/** Canonical saved content. Empty optional content is represented by an empty
 * string on the wire; storage and migration retain the original values. */
export interface Entry extends ReviewEntryBase {
  title_prefix?: string;
  updated_at?: string;
  kind: "entry";
  /** Historical replication identity; never a user-selected content type. */
  origin_kind?: "journal" | "bookmark" | null;
  title: string;
  body: string;
  url: string;
  occurred_at: string;
  saved_at: string;
  tag_id: string | null;
  nsfw: boolean;
  recommend_later: boolean;
  favicon_url?: string | null;
  reading_available?: boolean;
}

export const promptCategories = ["IMG", "SYS", "NSFW", "Courses"] as const;
export type PromptCategory = typeof promptCategories[number];
export function isPromptCategory(value: unknown): value is PromptCategory {
  return promptCategories.some((category) => category === value);
}
export interface PromptEntry extends ReviewEntryBase {
  kind: "prompt";
  code: string;
  display_name?: string | null;
  body: string;
  category: PromptCategory;
  updated_at: string;
  body_hash?: string;
}

export type ReviewEntry =
  | InventoryEntry
  | JournalEntry
  | BookmarkEntry
  | Entry
  | PromptEntry;

export interface ReviewListEntry extends ReviewEntryBase {
  title_prefix?: string;
  origin_kind?: "journal" | "bookmark" | null;
  title?: string;
  body?: string;
  body_preview?: string;
  show_body?: boolean;
  status?: InventoryStatus;
  category?: string | null;
  model?: string | null;
  urls?: string[];
  image_url?: string | null;
  occurred_at?: string;
  effective_category?: JournalCategory;
  saved_at?: string;
  url?: string;
  favicon_url?: string | null;
  reading_available?: boolean;
  tag_id?: string | null;
  nsfw?: boolean;
  recommend_later?: boolean;
  group?: Exclude<BookmarkGroup, "all">;
  code?: string;
  display_name?: string | null;
  body_hash?: string;
  updated_at?: string;
}

/** Additive page metadata for Review list responses; older clients may ignore it. */
export interface ReviewPage<T> {
  counts?: { bookmarks: number; journals: number };
  items: T[];
  more: boolean;
  total: number;
  page: number;
  page_size: number;
}

export type HomePlacement =
  | { key: "widget:time"; type: "time" }
  | { key: string; type: "journal"; entry: ReviewListEntry };

export interface HomeState {
  revision: number;
  items: HomePlacement[];
}

export interface HomeMutationReceipt {
  operation_id: string;
  revision: number;
  keys: string[];
}

export interface Tag {
  id: string;
  name: string;
  default_for?: "sfw" | "nsfw";
  nsfw?: boolean;
}

export function bookmarkHost(value: string): string | null {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** A host-only filter using the same www/case normalization as bookmarkHost. */
export function normalizeBookmarkDomain(value: string): string | null {
  const input = value.trim();
  if (!input || input.length > 253 || /[\s\\/:?#@]/u.test(input)) return null;
  try {
    const host = new URL(`https://${input}/`).hostname.toLowerCase().replace(
      /^www\./,
      "",
    );
    return host && host !== "." ? host : null;
  } catch {
    return null;
  }
}

export function bookmarkGroup(value: string): Exclude<BookmarkGroup, "all"> {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "");
    if (
      (host === "youtube.com" || host === "m.youtube.com") &&
      /^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)/i.test(path)
    ) return "channel";
    if (
      host === "space.bilibili.com" ||
      host === "bilibili.com" && /^\/space\/\d+/i.test(path)
    ) {
      return "channel";
    }
    if (
      host === "youtu.be" ||
      ((host === "youtube.com" || host === "m.youtube.com") &&
        (parsed.searchParams.has("v") || /^\/shorts\//i.test(path) ||
          /^\/playlist/i.test(path))) ||
      (host === "bilibili.com" && /^\/(?:video|list)\//i.test(path))
    ) return "media";
  } catch {
    // Invalid URLs are rejected at the write boundary and remain other here.
  }
  return "other";
}

export function bodyPreview(body: string, limit = 240): string {
  if (body.length <= limit) return body;
  return `${body.slice(0, Math.max(0, limit - 1))}…`;
}

export function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day;
}
