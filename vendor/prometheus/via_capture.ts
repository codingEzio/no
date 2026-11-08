import type { ServerIdentity } from "./transport.ts";
import { validDateOnly } from "./review.ts";
export const VIA_CAPTURE_BYTES = 512 * 1024;
export type ViaScope = Pick<
  ServerIdentity,
  "owner_id" | "dataset_id" | "dataset_epoch" | "replica_id" | "authority"
>;
type Base = {
  schema: "prometheus.via.capture.v1";
  operation_id: string;
  source: "via-bookmark" | "via-calmly";
  captured_at: string;
  destination: {
    target: "termux" | "mac" | "site";
    origin: string;
    scope: ViaScope | null;
  };
};
export type ViaCapture =
  & Base
  & ({
    kind: "bookmark";
    payload: {
      schema: "prometheus.bookmark.v1";
      url: string;
      title: string;
      tag_id: string;
      status: "active" | "archived";
      visibility: "sfw" | "nsfw";
      captured_at: string;
      source: "via";
    };
  } | {
    kind: "entry";
    payload: { url: string; text: string; title?: string; author?: string };
  });
export type ViaReceipt = {
  schema: "prometheus.via.receipt.v1";
  operation_id: string;
  destination: ViaScope & { origin: string };
  result: { id: string; revision: number };
  status: "saved";
};
export class ViaCaptureError extends Error {
  constructor(
    public code:
      | "invalid"
      | "origin"
      | "scope"
      | "confirm"
      | "unavailable"
      | "privacy"
      | "tag"
      | "storage"
      | "unconfirmed"
      | "capacity",
  ) {
    super(code);
    this.name = "ViaCaptureError";
  }
}
function invalid(): never {
  throw new ViaCaptureError("invalid");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function exact(
  row: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
) {
  if (
    required.some((key) => !(key in row)) ||
    Object.keys(row).some((key) =>
      !required.includes(key) && !optional.includes(key)
    )
  ) invalid();
}
function text(value: unknown, max: number, nonempty = false): string {
  if (
    typeof value !== "string" || value.length > max || value.includes("\0") ||
    nonempty && !value
  ) invalid();
  return value;
}
function timestamp(value: unknown): string {
  const s = text(value, 100, true);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
      .test(s) ||
    !Number.isFinite(Date.parse(s)) || !validDateOnly(s.slice(0, 10))
  ) invalid();
  return s;
}
export function parseViaScope(value: unknown): ViaScope {
  const row = object(value);
  exact(row, ["owner_id", "dataset_id", "replica_id", "authority"], [
    "dataset_epoch",
  ]);
  for (
    const k of [
      "owner_id",
      "dataset_id",
      "replica_id",
      ...(row.dataset_epoch === undefined ? [] : ["dataset_epoch"]),
    ]
  ) {
    const s = text(row[k], 256, true);
    if (
      [...s].some((char) =>
        char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
      )
    ) invalid();
  }
  if (!["local", "cloud"].includes(String(row.authority))) invalid();
  return row as ViaScope;
}
export function viaIdentityScope(identity: ServerIdentity): ViaScope {
  return {
    owner_id: identity.owner_id,
    dataset_id: identity.dataset_id,
    ...(identity.dataset_epoch !== undefined
      ? { dataset_epoch: identity.dataset_epoch }
      : {}),
    replica_id: identity.replica_id,
    authority: identity.authority,
  };
}
export function viaSameScope(a: ViaScope, b: ViaScope): boolean {
  return ["owner_id", "dataset_id", "dataset_epoch", "replica_id", "authority"]
    .every((k) => a[k as keyof ViaScope] === b[k as keyof ViaScope]);
}
export function viaHasNsfwMarker(value: string): boolean {
  return /(?:^|\s)#nsfw(?:\b|$)/iu.test(value);
}
export function viaRequiresPrivate(capture: ViaCapture): boolean {
  return capture.kind === "bookmark"
    ? capture.payload.visibility === "nsfw" ||
      viaHasNsfwMarker(capture.payload.title)
    : viaHasNsfwMarker(
      `${capture.payload.title ?? ""}\n${capture.payload.text}`,
    );
}
export function parseViaCapture(raw: string, origin: string): ViaCapture {
  if (
    raw.length > VIA_CAPTURE_BYTES ||
    new TextEncoder().encode(raw).length > VIA_CAPTURE_BYTES
  ) {
    throw new ViaCaptureError("capacity");
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    invalid();
  }
  const row = object(value);
  exact(row, [
    "schema",
    "operation_id",
    "source",
    "captured_at",
    "kind",
    "destination",
    "payload",
  ]);
  if (
    row.schema !== "prometheus.via.capture.v1" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(text(row.operation_id, 36))
  ) invalid();
  timestamp(row.captured_at);
  const dest = object(row.destination);
  exact(dest, ["target", "origin", "scope"]);
  if (!["mac", "termux", "site"].includes(String(dest.target))) invalid();
  try {
    const url = new URL(text(dest.origin, 4096));
    if (
      url.origin !== dest.origin || dest.origin !== origin ||
      !["http:", "https:"].includes(url.protocol)
    ) throw Error();
  } catch {
    throw new ViaCaptureError("origin");
  }
  if (dest.scope !== null) parseViaScope(dest.scope);
  const payload = object(row.payload);
  let url: URL;
  try {
    const literal = text(payload.url, 4096, true);
    url = new URL(literal);
    if (
      [...literal].some((char) =>
        char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127
      ) ||
      !["http:", "https:"].includes(url.protocol) || url.username ||
      url.password
    ) invalid();
  } catch {
    invalid();
  }
  if (row.kind === "bookmark") {
    exact(payload, [
      "schema",
      "url",
      "title",
      "tag_id",
      "status",
      "visibility",
      "captured_at",
      "source",
    ]);
    if (
      row.source !== "via-bookmark" ||
      payload.schema !== "prometheus.bookmark.v1" || payload.source !== "via" ||
      !["active", "archived"].includes(String(payload.status)) ||
      !["sfw", "nsfw"].includes(String(payload.visibility)) ||
      timestamp(payload.captured_at) !== row.captured_at
    ) invalid();
    text(payload.title, 1000);
    text(payload.tag_id, 100, true);
  } else if (row.kind === "entry") {
    exact(payload, ["url", "text"], ["title", "author"]);
    if (row.source !== "via-calmly") invalid();
    text(payload.text, 100000, true);
    if (!String(payload.text).trim()) invalid();
    if (payload.title !== undefined) text(payload.title, 1000);
    if (payload.author !== undefined) text(payload.author, 1000);
  } else invalid();
  return value as ViaCapture;
}
export function bindViaDestination(
  capture: ViaCapture,
  identity: ServerIdentity,
  runtime: string,
  origin: string,
  confirmed: boolean,
): ViaScope {
  if (capture.destination.origin !== origin) {
    throw new ViaCaptureError("origin");
  }
  if (
    (capture.destination.target === "site"
      ? "sites"
      : capture.destination.target) !== runtime
  ) throw new ViaCaptureError("scope");
  const scope = viaIdentityScope(identity);
  if (capture.destination.scope === null) {
    if (!confirmed) throw new ViaCaptureError("confirm");
  } else if (!viaSameScope(capture.destination.scope, scope)) {
    throw new ViaCaptureError("scope");
  }
  return scope;
}
export function makeViaReceipt(
  capture: ViaCapture,
  scope: ViaScope,
  result: { id: string; revision: number },
): ViaReceipt {
  if (
    !result.id || !Number.isSafeInteger(result.revision) || result.revision < 1
  ) throw new ViaCaptureError("unconfirmed");
  return {
    schema: "prometheus.via.receipt.v1",
    operation_id: capture.operation_id,
    destination: { origin: capture.destination.origin, ...scope },
    result: { id: result.id, revision: result.revision },
    status: "saved",
  };
}
