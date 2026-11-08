import type {
  BookmarkEntry,
  Entry,
  JournalCategory,
  JournalEntry,
  ReviewEntry,
} from "./review.ts";
import { splitBookmarkTitlePrefix } from "./bookmark_title_prefix.ts";
import { validDateOnly } from "./review.ts";

export const ENTRY_FIELDS = [
  "title",
  "title_prefix",
  "body",
  "url",
  "occurred_at",
  "saved_at",
  "tag_id",
  "nsfw",
  "archived",
  "recommend_later",
] as const;
export function validateEntryData(
  data: Record<string, unknown>,
  creating: boolean,
  invalid: (message: string) => never,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!(ENTRY_FIELDS as readonly string[]).includes(key)) {
      invalid(`Unsupported entry field: ${key}`);
    }
    if (key === "title_prefix" && typeof value !== "string") {
      invalid("Invalid title_prefix");
    }
    if (["nsfw", "archived", "recommend_later"].includes(key)) {
      if (typeof value !== "boolean") invalid(`${key} must be true or false`);
    } else if (value !== null) {
      const max = key === "body"
        ? 100_000
        : key === "url"
        ? 4096
        : key === "title_prefix"
        ? 30
        : key === "title"
        ? 1000
        : 100;
      if (typeof value !== "string" || value.length > max) {
        invalid(`Invalid ${key}`);
      }
      if (key === "url" && value) {
        try {
          if (!["https:", "http:"].includes(new URL(String(value)).protocol)) {
            invalid("URL must use HTTP or HTTPS");
          }
        } catch {
          invalid("Invalid URL");
        }
      }
      if (
        ["occurred_at", "saved_at"].includes(key) && value !== "" &&
        (!validDateOnly(String(value).slice(0, 10)) ||
          (String(value).length !== 10 &&
            !Number.isFinite(Date.parse(String(value)))))
      ) invalid(`Invalid ${key}`);
    }
    result[key] =
      ["url", "occurred_at", "saved_at"].includes(key) && value === ""
        ? null
        : value;
  }
  if (creating && result.saved_at === undefined) {
    result.saved_at = new Date().toISOString();
  }
  if (
    typeof result.title === "string" && typeof result.url === "string" &&
    result.title_prefix === undefined
  ) {
    Object.assign(
      result,
      splitBookmarkTitlePrefix(result.title, result.url) ?? {},
    );
  }
  return result;
}

export function entryHasContent(row: Record<string, unknown>): boolean {
  return [row.title, row.body, row.url].some((value) =>
    typeof value === "string" && value.trim()
  );
}

export function entryFromRow(row: Record<string, unknown>): Entry {
  return {
    id: String(row.id),
    kind: "entry",
    revision: Number(row.revision),
    archived: Boolean(row.archived),
    origin_kind:
      row.original_kind === "journal" || row.original_kind === "bookmark"
        ? row.original_kind
        : null,
    source_ref: row.source_ref == null ? null : String(row.source_ref),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at ?? row.created_at),
    title: String(row.title ?? ""),
    ...(Object.hasOwn(row, "title_prefix")
      ? { title_prefix: String(row.title_prefix ?? "") }
      : {}),
    body: String(row.body ?? ""),
    url: String(row.url ?? ""),
    occurred_at: String(row.occurred_at ?? ""),
    saved_at: String(row.saved_at ?? ""),
    tag_id: row.tag_id == null ? null : String(row.tag_id),
    nsfw: Boolean(row.nsfw),
    recommend_later: Boolean(row.recommend_later),
  };
}

/** Legacy clients receive their original wire kind. Additional content fields
 * stay present so a compatibility response cannot erase newer personal text. */
export function legacyEntry(
  entry: Entry,
  kind: "journal" | "bookmark",
): ReviewEntry {
  if (kind === "bookmark") {
    return {
      ...entry,
      kind,
      saved_at: entry.saved_at || entry.created_at,
    } as BookmarkEntry;
  }
  const journal = { ...entry };
  delete journal.title_prefix;
  const category = entry.tag_id?.startsWith("entry-journal-")
    ? entry.tag_id.slice("entry-journal-".length) as JournalCategory
    : "misc";
  return {
    ...journal,
    kind,
    occurred_at: entry.occurred_at || entry.saved_at || entry.created_at,
    category,
    effective_category: entry.archived ? "misc" : category,
    show_body: true,
  } as JournalEntry;
}
