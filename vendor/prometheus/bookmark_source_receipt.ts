import { normalizeBookmarkSourceProvenance } from "./bookmark_source_policy.js";
import type { BookmarkSourceProvenance } from "./bookmark_intake.ts";

/** Internal receipt compression only; public receipts retain exact source objects. */
export interface BookmarkSourceReceipt {
  version: 1;
  sources: BookmarkSourceProvenance["sources"][];
  rows: Record<string, [string, string, number]>;
}
export function packBookmarkSourceReceipt(
  provenance: Record<string, BookmarkSourceProvenance>,
): BookmarkSourceReceipt {
  const normalized = Object.entries(provenance).map(([row, p]) =>
    [row, normalizeBookmarkSourceProvenance(p)] as const
  );
  const keys = [
    ...new Set(normalized.map(([, p]) => JSON.stringify(p.sources))),
  ].sort();
  const indices = new Map(keys.map((key, index) => [key, index]));
  return {
    version: 1,
    sources: keys.map((s) => JSON.parse(s)),
    rows: Object.fromEntries(
      normalized.map((
        [row, p],
      ) => [row, [
        p.record_id,
        p.url,
        indices.get(JSON.stringify(p.sources))!,
      ]]),
    ),
  };
}
export function unpackBookmarkSourceReceipt(
  value: unknown,
): Record<string, BookmarkSourceProvenance> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid bookmark source receipt");
  }
  const packed = value as BookmarkSourceReceipt;
  if (
    packed.version !== 1 || !Array.isArray(packed.sources) || !packed.rows ||
    typeof packed.rows !== "object" || Array.isArray(packed.rows)
  ) throw new Error("Invalid bookmark source receipt");
  return Object.fromEntries(
    Object.entries(packed.rows).map(([row, tuple]) => {
      if (
        !Array.isArray(tuple) || tuple.length !== 3 ||
        !Number.isSafeInteger(tuple[2]) || tuple[2] < 0 ||
        tuple[2] >= packed.sources.length
      ) throw new Error("Invalid bookmark source receipt row");
      return [
        row,
        normalizeBookmarkSourceProvenance({
          version: 1,
          record_id: tuple[0],
          url: tuple[1],
          sources: packed.sources[tuple[2]],
        }),
      ];
    }),
  );
}
