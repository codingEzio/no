import { isNsfwTagName } from "./bookmark_tag_scope.ts";
import {
  normalizeBookmarkSourceProvenance,
  parseBookmarkSourceComment,
  resolveBookmarkSourcePolicy,
} from "./bookmark_source_policy.js";
export type BookmarkSourceProvenance = ReturnType<
  typeof normalizeBookmarkSourceProvenance
>;
import type { Tag } from "./review.ts";

export const MAX_BOOKMARK_INTAKE_ROWS = 10_000;
export const MAX_BOOKMARK_INTAKE_BYTES = 2 * 1024 * 1024;
// Structured rows retain origin metadata in addition to the Markdown payload.
export const MAX_BOOKMARK_IMPORT_BYTES = 8 * 1024 * 1024;
export const MAX_BOOKMARK_TITLE_GRAPHEMES = 120;

export interface BookmarkIntakeRow {
  provenance?: BookmarkSourceProvenance;
  row_id: string;
  line: number;
  original: string;
  title: string | null;
  original_title: string | null;
  url: string | null;
  archived: boolean;
  nsfw: boolean;
  tag_id: string | null;
  tag_name?: string;
  tag_labels: string[];
  duplicate_url: boolean;
  warnings: string[];
  errors: string[];
}

export interface BookmarkParseResult {
  rows: BookmarkIntakeRow[];
  count: number;
  valid_count: number;
  needs_review: number;
}

export interface BookmarkParseResponse extends BookmarkParseResult {
  tags: Tag[];
}

export interface BookmarkPreparation {
  result: BookmarkParseResult;
  tags: Tag[];
  verified_existing: boolean;
  catalog_available: boolean;
}

export interface BookmarkIntakeDefaults {
  archived?: boolean;
  nsfw?: boolean;
  tag_id?: string;
}

export interface BookmarkImportItem {
  provenance?: BookmarkSourceProvenance;
  row_id: string;
  title: string;
  url: string;
  tag_id: string | null;
  tag_name?: string;
  archived: boolean;
  nsfw: boolean;
}

export interface BookmarkImportResult {
  provenance?: Record<string, BookmarkSourceProvenance>;
  operation_id: string;
  saved: number;
  created: number;
  updated: number;
  restored: number;
  tag_ids: Record<string, string>;
  duplicate_urls: number;
}

export class BookmarkIntakeLimitError extends Error {}

export function applyBookmarkIntakeDefaults(
  rows: BookmarkIntakeRow[],
  tags: Tag[],
  defaults: BookmarkIntakeDefaults = {},
): BookmarkIntakeRow[] {
  const expectedNsfw = defaults.nsfw ?? false;
  return rows.map((row) => {
    const next = { ...row };
    const collectionTag = next.tag_labels.length === 1 &&
      ["inbox", "video", "nsfw-yt-bili"].includes(
        next.tag_labels[0].normalize("NFC").toLowerCase(),
      );
    if (defaults.nsfw && !collectionTag && !next.provenance) next.nsfw = true;
    if (!next.tag_labels.length && !next.tag_name && !next.provenance) {
      const selected = next.nsfw === expectedNsfw ? defaults.tag_id : undefined;
      next.tag_id = selected ??
        tags.find((tag) => tag.default_for === (next.nsfw ? "nsfw" : "sfw"))
          ?.id ??
        next.tag_id;
    }
    if (
      defaults.archived && !next.provenance &&
      !/^\s*(?:[-*]\s*)?\[\s*[xX ]\s*\]/u.test(next.original)
    ) {
      next.archived = true;
    }
    return next;
  });
}

const titleSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

function firstGraphemes(value: string, limit: number) {
  let title = "";
  let count = 0;
  for (const part of titleSegmenter.segment(value)) {
    if (count === limit) return { title, shortened: true };
    title += part.segment;
    count++;
  }
  return { title, shortened: false };
}

export function normalizeBookmarkTitle(value: string) {
  const normalized = value.replace(/\p{Cc}/gu, " ")
    .replace(/\s+/gu, " ").trim();
  const limited = firstGraphemes(normalized, MAX_BOOKMARK_TITLE_GRAPHEMES);
  const title = limited.title.trim();
  return {
    title,
    changed: normalized !== value || limited.shortened ||
      title !== limited.title,
    shortened: limited.shortened,
  };
}

function validUrl(value: string): boolean {
  if (value.length === 0 || value.length > 4096 || /\s/u.test(value)) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function markdownLink(
  value: string,
): { title: string; url: string; tail: string } | null {
  if (!value.startsWith("[")) return null;
  const escaped = (index: number) => {
    let count = 0;
    while (index > 0 && value[--index] === "\\") count++;
    return count % 2 === 1;
  };
  let close = -1;
  for (let i = 1; i < value.length - 1; i++) {
    if (value[i] === "]" && value[i + 1] === "(" && !escaped(i)) {
      close = i;
      break;
    }
  }
  if (close < 0) return null;
  let depth = 1;
  for (let i = close + 2; i < value.length; i++) {
    if (value[i] === "(" && !escaped(i)) depth++;
    if (value[i] === ")" && !escaped(i)) depth--;
    if (depth === 0) {
      return {
        title: value.slice(1, close).replace(/\\([\\\[\]])/gu, "$1"),
        url: value.slice(close + 2, i),
        tail: value.slice(i + 1).trim(),
      };
    }
  }
  return null;
}

function trailingTags(tail: string) {
  const labels: string[] = [];
  let rest = tail.trim();
  while (rest.startsWith("#")) {
    const match = /^#([^\s#]+)(?:\s+|$)/u.exec(rest);
    if (!match) break;
    labels.push(match[1]);
    rest = rest.slice(match[0].length).trimStart();
  }
  return { labels, rest };
}

export function parseBookmarkIntake(
  input: string,
  tags: Tag[],
  existingUrls: ReadonlySet<string> = new Set<string>(),
): BookmarkParseResult {
  if (typeof input !== "string") throw new Error("text must be a string");
  if (new TextEncoder().encode(input).length > MAX_BOOKMARK_INTAKE_BYTES) {
    throw new BookmarkIntakeLimitError("Bookmark intake text exceeds 2 MiB");
  }
  const rows: BookmarkIntakeRow[] = [];
  const seenUrls = new Set<string>();
  for (const [index, original] of input.split(/\r?\n/u).entries()) {
    if (!original.trim()) continue;
    if (rows.length >= MAX_BOOKMARK_INTAKE_ROWS) {
      throw new BookmarkIntakeLimitError(
        "Bookmark intake exceeds 10000 nonempty rows",
      );
    }
    const row: BookmarkIntakeRow = {
      row_id: `line-${index + 1}`,
      line: index + 1,
      original,
      title: null,
      original_title: null,
      url: null,
      archived: false,
      nsfw: false,
      tag_id: null,
      tag_labels: [],
      duplicate_url: false,
      warnings: [],
      errors: [],
    };
    let text = original.trim();
    text = text.replace(/^-\s+/u, "");
    const checkbox = /^\[([ xX])\](?:\s+|$)/u.exec(text);
    if (checkbox) {
      row.archived = checkbox[1].toLowerCase() === "x";
      text = text.slice(checkbox[0].length).trimStart();
    }
    let title: string | null = null;
    let link: string | null = null;
    let tail = "";
    const markdown = markdownLink(text);
    if (markdown) {
      title = markdown.title;
      link = markdown.url;
      tail = markdown.tail;
    } else if (text.startsWith("[")) {
      row.errors.push("invalid_markdown_link");
    } else {
      const bare = /^(https?:\/\/\S+)(?:\s+|$)/iu.exec(text);
      if (bare) {
        link = bare[1];
        tail = text.slice(bare[0].length).trim();
        if (validUrl(link)) {
          const parsed = new URL(link);
          title = `${parsed.hostname}${parsed.pathname}`;
          row.warnings.push("title_needs_review");
        }
      } else {
        row.errors.push("unrecognized_line");
      }
    }
    if (link !== null) {
      if (!validUrl(link)) row.errors.push("invalid_url");
      else row.url = link;
    }
    if (title !== null) {
      const clean = normalizeBookmarkTitle(title);
      if (!clean.title) row.errors.push("empty_title");
      else row.title = clean.title;
      if (clean.changed) row.original_title = title;
      if (clean.shortened) row.warnings.push("title_shortened");
      else if (clean.changed) row.warnings.push("title_normalized");
    }
    const sourceComment = /(?:^|\s)<!-- prometheus-source:([^ ]+) -->$/u.exec(
      tail,
    );
    if (sourceComment) {
      try {
        row.provenance = parseBookmarkSourceComment(
          sourceComment[1],
          row.url ?? "",
        );
      } catch {
        row.errors.push("invalid_source_provenance");
      }
      tail = tail.slice(0, sourceComment.index).trimEnd();
    }
    const trailing = trailingTags(tail);
    row.tag_labels = trailing.labels;
    if (trailing.rest) {
      row.errors.push(
        /https?:\/\/|\[[^\]]+\]\(/iu.test(trailing.rest)
          ? "multiple_links"
          : "trailing_text",
      );
    }
    if (row.tag_labels.length > 1) {
      row.errors.push("multiple_tags");
    } else if (row.tag_labels.length === 1) {
      const label = row.tag_labels[0];
      // The collector's explicit private-video tag must survive a plain
      // Markdown round trip, including when the tag is created on import.
      if (isNsfwTagName(label)) {
        row.nsfw = true;
      }
      const matches = tags.filter((tag) =>
        tag.name.normalize("NFC").toLowerCase() ===
          label.normalize("NFC").toLowerCase()
      );
      if (matches.length === 1) row.tag_id = matches[0].id;
      else if (matches.length > 1) row.errors.push("ambiguous_tag");
      else {
        row.tag_name = label;
        row.warnings.push("new_tag");
      }
    } else {
      row.tag_id = tags.find((tag) => tag.default_for === "sfw")?.id ?? null;
    }
    if (row.provenance) {
      const policy = resolveBookmarkSourcePolicy(
        row.provenance.sources.map((source) => source.id),
      );
      // Source context fills only omitted values. Literal review decisions win.
      if (!checkbox) row.archived = policy.archived;
      if (!row.tag_labels.length) {
        row.nsfw = policy.nsfw;
        const match = tags.find((tag) =>
          tag.name.normalize("NFC").toLowerCase() === policy.tag
        );
        row.tag_id = match?.id ?? null;
        if (!match) {
          row.tag_name = policy.tag;
          row.warnings.push("new_tag");
        }
      }
    }
    if (row.url !== null) {
      if (existingUrls.has(row.url)) {
        row.duplicate_url = true;
        row.warnings.push("existing_url");
      }
      if (seenUrls.has(row.url)) {
        row.duplicate_url = true;
        row.warnings.push("duplicate_in_input");
      }
      seenUrls.add(row.url);
    }
    rows.push(row);
  }
  return {
    rows,
    count: rows.length,
    valid_count: rows.filter((row) => row.errors.length === 0).length,
    needs_review:
      rows.filter((row) => row.errors.length > 0 || row.warnings.length > 0)
        .length,
  };
}

export function normalizeBookmarkImportItem(
  input: unknown,
): BookmarkImportItem {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Import item must be an object");
  }
  const item = input as Record<string, unknown>;
  const allowed = new Set([
    "provenance",
    "row_id",
    "title",
    "url",
    "tag_id",
    "tag_name",
    "archived",
    "nsfw",
  ]);
  if (Object.keys(item).some((key) => !allowed.has(key))) {
    throw new Error("Unsupported import item field");
  }
  if (
    typeof item.row_id !== "string" ||
    !/^[A-Za-z0-9._:-]{1,100}$/u.test(item.row_id)
  ) {
    throw new Error("Invalid row_id");
  }
  if (typeof item.title !== "string") throw new Error("Invalid title");
  const clean = normalizeBookmarkTitle(item.title);
  if (!clean.title || clean.shortened) {
    throw new Error("Title must be 1-120 graphemes");
  }
  if (clean.changed) {
    throw new Error("Title must match the reviewed normalized title");
  }
  if (
    typeof item.url !== "string" || item.url.trim() !== item.url ||
    !validUrl(item.url)
  ) {
    throw new Error("Invalid URL");
  }
  if (
    item.tag_id !== undefined && item.tag_id !== null &&
    (typeof item.tag_id !== "string" || !item.tag_id ||
      item.tag_id.length > 100)
  ) {
    throw new Error("Invalid tag_id");
  }
  if (
    item.tag_name !== undefined &&
    (typeof item.tag_name !== "string" || !item.tag_name.trim() ||
      firstGraphemes(item.tag_name.trim(), 120).shortened ||
      item.tag_id !== undefined && item.tag_id !== null)
  ) {
    throw new Error("Invalid tag_name");
  }
  if (typeof item.archived !== "boolean" || typeof item.nsfw !== "boolean") {
    throw new Error("archived and nsfw must be booleans");
  }
  return {
    ...(item.provenance === undefined
      ? {}
      : { provenance: normalizeBookmarkSourceProvenance(item.provenance) }),
    row_id: item.row_id,
    title: item.title,
    url: item.url,
    tag_id: item.tag_id ?? null,
    ...(item.tag_name === undefined
      ? {}
      : { tag_name: item.tag_name.trim().normalize("NFC") }),
    archived: item.archived,
    nsfw: item.nsfw,
  };
}
