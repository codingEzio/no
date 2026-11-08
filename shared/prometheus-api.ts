/** Owner API helper. Packaging and authentication stay with each extension. */
export type PrometheusAction =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "restore";
export interface PrometheusCommand {
  module: string;
  action: PrometheusAction;
  operation_id?: string;
  id?: string;
  revision?: number;
  data?: Record<string, unknown>;
  query?: Record<string, unknown>;
}
export interface PrometheusScope {
  authority: string;
  owner_id: string;
  dataset_id: string;
  dataset_epoch: string;
}
export interface PrometheusEnvelope {
  command: PrometheusCommand;
  replication?: Record<string, unknown>;
}
/** A dedicated durable slot. One client/worker owns this slot at a time. */
export interface PrometheusRecoveryStore {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
}
export interface PrometheusSettingsDocument {
  format: "prometheus-settings";
  version: 1;
  items: Array<{ key: string; value: unknown }>;
}
export interface PrometheusSettingsImport {
  operation_id: string;
  document: PrometheusSettingsDocument;
  expected_revisions: Record<string, number>;
}
export interface PrometheusSettingsWrite {
  operation_id: string;
  items: Array<{ key: string; revision: number; value: unknown }>;
}
export interface PrometheusPendingOperation {
  version: 1;
  scope: PrometheusScope;
  kind: "domain" | "settings" | "settings-import";
  body: Record<string, unknown>;
}
export const prometheusApiLimits = Object.freeze({
  requestBytes: 128 * 1024,
  responseBytes: 2 * 1024 * 1024,
  settingsKeys: 128,
  timeoutMs: 30_000,
});
type Value = Record<string, unknown>;
const object = (value: unknown): value is Value =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function fail(message: string): never {
  throw new Error(message);
}
const identifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200 &&
  !Array.from(value).some((character) => character.charCodeAt(0) < 32);
const revision = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0;
function fields(value: Value, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    fail("unknown_envelope_field");
  }
}
/** Canonical JSON snapshots reject values JSON.stringify silently changes. */
function canonical(value: unknown, depth = 0): string {
  if (depth > 32) return fail("json_too_deep");
  if (
    value === null || typeof value === "string" || typeof value === "boolean"
  ) return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonical(item, depth + 1)).join(",")}]`;
  }
  if (
    object(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    return `{${
      Object.keys(value).sort().map((key) =>
        `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`
      ).join(",")
    }}`;
  }
  return fail("non_json_value");
}
function snapshot<T>(value: T): T {
  const encoded = canonical(value);
  if (
    new TextEncoder().encode(encoded).length > prometheusApiLimits.requestBytes
  ) fail("request_too_large");
  return JSON.parse(encoded);
}
function command(value: unknown): asserts value is PrometheusCommand {
  if (!object(value)) fail("invalid_command");
  fields(value, [
    "module",
    "action",
    "operation_id",
    "id",
    "revision",
    "data",
    "query",
  ]);
  if (
    !identifier(value.module) ||
    !["create", "read", "update", "delete", "restore"].includes(
      String(value.action),
    )
  ) fail("invalid_command");
  if (value.action !== "read" && !identifier(value.operation_id)) {
    fail("stable_operation_id_required");
  }
  if (value.id !== undefined && !identifier(value.id)) {
    fail("invalid_record_id");
  }
  if (value.revision !== undefined && !revision(value.revision)) {
    fail("invalid_revision");
  }
  if (
    value.data !== undefined && !object(value.data) ||
    value.query !== undefined && !object(value.query)
  ) fail("invalid_command");
}
function settingsDocument(
  value: unknown,
): asserts value is PrometheusSettingsDocument {
  if (!object(value)) fail("invalid_settings_document");
  fields(value, ["format", "version", "items"]);
  if (
    value.format !== "prometheus-settings" || value.version !== 1 ||
    !Array.isArray(value.items) ||
    value.items.length > prometheusApiLimits.settingsKeys
  ) fail("invalid_settings_document");
  const keys = new Set<string>();
  for (const item of value.items) {
    if (!object(item)) fail("invalid_settings_item");
    fields(item, ["key", "value"]);
    if (!identifier(item.key) || !("value" in item) || keys.has(item.key)) {
      fail("invalid_settings_item");
    }
    keys.add(item.key);
  }
}
function receiptDescriptor(value: unknown): Value {
  if (!object(value)) return fail("invalid_receipt_descriptor");
  fields(value, ["path", "recordKey", "matchId", "matchField", "projection"]);
  if (
    typeof value.path !== "string" || !value.path.startsWith("/api/") ||
    value.recordKey !== undefined && typeof value.recordKey !== "string" ||
    value.matchId !== undefined && typeof value.matchId !== "string" ||
    value.matchField !== undefined && typeof value.matchField !== "string" ||
    value.projection !== undefined && value.projection !== "home-layout"
  ) return fail("invalid_receipt_descriptor");
  return value;
}
function previewPlan(value: Value): Value {
  if (
    !["ready", "replay"].includes(String(value.status)) || !object(value.plan)
  ) return fail("invalid_preview_no_write_sent");
  receiptDescriptor(value.plan.receipt);
  if (value.plan.readback !== undefined) receiptDescriptor(value.plan.readback);
  return value.plan;
}
function select(value: unknown, input: unknown): Value {
  const descriptor = receiptDescriptor(input);
  let selected = value;
  if (descriptor.recordKey !== undefined) {
    if (typeof descriptor.recordKey !== "string") {
      return fail("invalid_receipt_descriptor");
    }
    for (const key of descriptor.recordKey.split(".")) {
      if (!object(selected) || !Object.hasOwn(selected, key)) {
        return fail("invalid_receipt_shape");
      }
      selected = selected[key];
    }
  }
  if (descriptor.matchId !== undefined) {
    if (!Array.isArray(selected)) return fail("invalid_receipt_shape");
    const key = descriptor.matchField ?? "id";
    if (typeof key !== "string") return fail("invalid_receipt_descriptor");
    const matches = selected.filter((item) =>
      object(item) && item[key] === descriptor.matchId
    );
    if (matches.length !== 1) return fail("invalid_receipt_shape");
    selected = matches[0];
  }
  if (!object(selected)) return fail("invalid_receipt_shape");
  if (descriptor.projection === "home-layout") {
    const keys = Array.isArray(selected.keys)
      ? selected.keys
      : Array.isArray(selected.items)
      ? selected.items.map((item) => object(item) ? item.key : undefined)
      : undefined;
    if (
      !revision(selected.revision) || !keys ||
      keys.some((key) => typeof key !== "string") ||
      new Set(keys).size !== keys.length
    ) return fail("invalid_home_layout_receipt");
    return { revision: selected.revision, keys };
  }
  return selected;
}
function operationMatches(
  receipt: Value,
  operation: unknown,
  receiptPath?: unknown,
) {
  const ids = [receipt.operation_id, receipt.operationId].filter((id) =>
    id !== undefined
  );
  if (ids.some((id) => id !== operation)) {
    fail("receipt_operation_mismatch");
  }
  if (!ids.length) {
    // Definition receipts are the canonical DTO itself; its declared route
    // binds the operation. The server verifies that receipt's request hash.
    if (typeof receiptPath !== "string" || !receiptPath.startsWith("/api/")) {
      fail("receipt_operation_mismatch");
    }
    const path = new URL(receiptPath, "https://contract.invalid").pathname;
    if (decodeURIComponent(path.split("/").at(-1) ?? "") !== operation) {
      fail("receipt_operation_mismatch");
    }
  }
}

/**
 * The caller supplies an already authorized, fixed-authority owner transport.
 * This helper has no token pairing, cookies, arbitrary URL, or credential API.
 */
export function createPrometheusApiClient(options: {
  scope: PrometheusScope;
  recovery: PrometheusRecoveryStore;
  transport: (path: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}) {
  const scope = snapshot(options.scope);
  fields(scope as unknown as Value, [
    "authority",
    "owner_id",
    "dataset_id",
    "dataset_epoch",
  ]);
  if (
    Object.values(scope).length !== 4 ||
    Object.values(scope).some((value) => !identifier(value))
  ) fail("invalid_scope");
  const timeout = options.timeoutMs ?? prometheusApiLimits.timeoutMs;
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 60_000) {
    fail("invalid_timeout");
  }
  let busy = false;
  async function exclusive<T>(run: () => Promise<T>): Promise<T> {
    if (busy) fail("client_busy");
    busy = true;
    try {
      return await run();
    } finally {
      busy = false;
    }
  }
  function validatePending(
    value: unknown,
  ): asserts value is PrometheusPendingOperation {
    if (!object(value)) fail("invalid_recovery_envelope");
    fields(value, ["version", "scope", "kind", "body"]);
    if (
      value.version !== 1 || canonical(value.scope) !== canonical(scope) ||
      !object(value.body)
    ) fail("recovery_scope_mismatch");
    if (value.kind === "domain") {
      fields(value.body, ["command", "replication"]);
      command(value.body.command);
      if (value.body.command.action === "read") fail("invalid_recovery_read");
      if (value.body.replication !== undefined) {
        if (!object(value.body.replication)) {
          fail("invalid_replication_metadata");
        }
        const replication = value.body.replication;
        fields(replication, [
          "owner_id",
          "dataset_id",
          "dataset_epoch",
          "client_id",
          "origin_replica_id",
          "base_confirmed_version",
          "depends_on_operation_id",
        ]);
        for (
          const key of ["owner_id", "dataset_id", "dataset_epoch"] as const
        ) {
          if (replication[key] !== scope[key]) {
            fail("replication_scope_mismatch");
          }
        }
        if (
          !identifier(replication.client_id) ||
          !identifier(replication.origin_replica_id) ||
          !revision(replication.base_confirmed_version) ||
          replication.depends_on_operation_id !== undefined &&
            !identifier(replication.depends_on_operation_id)
        ) fail("invalid_replication_metadata");
      }
    } else if (value.kind === "settings-import") {
      fields(value.body, ["operation_id", "document", "expected_revisions"]);
      if (
        !identifier(value.body.operation_id) ||
        !object(value.body.expected_revisions)
      ) fail("invalid_settings_import");
      settingsDocument(value.body.document);
      const keys = value.body.document.items.map((item) => item.key);
      const expected = value.body.expected_revisions;
      if (
        keys.length < 1 || Object.keys(expected).length !== keys.length ||
        keys.some((key) => !revision(expected[key]))
      ) fail("invalid_expected_revisions");
    } else if (value.kind === "settings") {
      fields(value.body, ["operation_id", "items"]);
      if (
        !identifier(value.body.operation_id) ||
        !Array.isArray(value.body.items) ||
        value.body.items.length < 1 ||
        value.body.items.length > prometheusApiLimits.settingsKeys
      ) fail("invalid_settings_write");
      const keys = new Set<string>();
      for (const item of value.body.items) {
        if (!object(item)) fail("invalid_settings_item");
        fields(item, ["key", "revision", "value"]);
        if (
          !identifier(item.key) || !revision(item.revision) ||
          !("value" in item) || keys.has(item.key)
        ) fail("invalid_settings_item");
        keys.add(item.key);
      }
    } else fail("invalid_recovery_kind");
  }
  async function pending(): Promise<PrometheusPendingOperation | null> {
    const saved = await options.recovery.get();
    if (saved === null) return null;
    let value: unknown;
    try {
      value = snapshot(JSON.parse(saved));
    } catch {
      return fail("invalid_recovery_envelope_preserved");
    }
    validatePending(value);
    return value;
  }
  async function persist(value: PrometheusPendingOperation) {
    validatePending(value);
    const encoded = canonical(value);
    const prior = await options.recovery.get();
    if (prior !== null && prior !== encoded) {
      fail("pending_operation_preserved");
    }
    await options.recovery.set(encoded);
    if (await options.recovery.get() !== encoded) {
      fail("recovery_persistence_failed_no_write_sent");
    }
  }
  async function clear(value: PrometheusPendingOperation) {
    if (await options.recovery.get() !== canonical(value)) {
      fail("recovery_changed_preserved");
    }
    await options.recovery.remove();
    if (await options.recovery.get() !== null) {
      fail("verified_recovery_clear_failed");
    }
  }
  async function request(path: string, body?: unknown): Promise<Value> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeout);
    try {
      const response = await options.transport(path, {
        method: body === undefined ? "GET" : "POST",
        cache: "no-store",
        signal: abort.signal,
        ...(body === undefined ? {} : {
          headers: { "Content-Type": "application/json" },
          body: canonical(body),
        }),
      });
      const reader = response.body?.getReader();
      if (!reader) return fail("invalid_api_response");
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.length;
          if (size > prometheusApiLimits.responseBytes) {
            void reader.cancel().catch(() => {});
            return fail("api_response_too_large");
          }
          parts.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
      }
      let result: unknown;
      try {
        result = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
      } catch {
        return fail("invalid_api_response");
      }
      if (!response.ok) return fail(`api_http_${response.status}`);
      return object(result) ? result : fail("invalid_api_response");
    } finally {
      clearTimeout(timer);
    }
  }
  async function execute(value: PrometheusPendingOperation): Promise<Value> {
    await persist(value);
    if (value.kind === "domain") {
      const cmd = value.body.command as unknown as PrometheusCommand;
      const preview = await request("/api/agent/preview", { command: cmd });
      const plan = previewPlan(preview),
        descriptor = receiptDescriptor(plan.receipt);
      const result = await request("/api/agent/crud", value.body);
      if (
        result.status !== "verified" || !("result" in result) ||
        !object(result.receipt) || !object(result.readback)
      ) fail("verification_pending");
      operationMatches(
        result.receipt,
        cmd.operation_id,
        descriptor.path,
      );
      if (
        canonical(select(result.receipt, descriptor)) !==
          canonical(result.readback)
      ) fail("receipt_readback_mismatch");
      if (object(value.body.replication)) {
        const metadata = value.body.replication;
        const saved = result.result;
        const descriptor = plan.replication;
        const proof = object(saved) ? saved.replication_receipt : null;
        if (
          !object(saved) || saved.replication_state !== "confirmed" ||
          !object(descriptor) || !object(proof) || !object(proof.scope) ||
          !object(proof.document) || proof.outcome !== "applied" ||
          proof.operationId !== cmd.operation_id ||
          proof.clientId !== metadata.client_id ||
          proof.scope.ownerId !== scope.owner_id ||
          proof.scope.datasetId !== scope.dataset_id ||
          proof.scope.datasetEpoch !== scope.dataset_epoch ||
          proof.document.entity !== descriptor.entity ||
          proof.document.id !== descriptor.id
        ) fail("replication_verification_pending");
      }
      await clear(value);
      return result;
    }
    const response = await request(
      value.kind === "settings" ? "/api/settings" : "/api/settings/import",
      value.body,
    );
    const receipt = await request(
      `/api/settings/operations/${
        encodeURIComponent(String(value.body.operation_id))
      }`,
    );
    operationMatches(receipt, value.body.operation_id);
    if (
      receipt.status !== "saved" || !Array.isArray(receipt.records) ||
      canonical(response) !== canonical(receipt)
    ) fail("settings_receipt_mismatch");
    const items: Value[] = value.kind === "settings"
      ? value.body.items as Value[]
      : (value.body.document as unknown as PrometheusSettingsDocument).items;
    if (receipt.records.length !== items.length) {
      fail("settings_receipt_mismatch");
    }
    const seen = new Set<string>();
    for (const record of receipt.records) {
      if (!object(record) || !identifier(record.key) || seen.has(record.key)) {
        fail("settings_receipt_mismatch");
      }
      seen.add(record.key);
      const input = items.find((item) => item.key === record.key);
      const expected = value.kind === "settings"
        ? input?.revision
        : (value.body.expected_revisions as Value)[record.key];
      if (
        !input || canonical(input.value) !== canonical(record.value) ||
        record.revision !== Number(expected) + 1 || record.stored !== true
      ) fail("settings_receipt_mismatch");
      const readback = await request(
        `/api/settings/${encodeURIComponent(record.key)}`,
      );
      if (canonical(readback) !== canonical(record)) {
        fail("settings_readback_mismatch");
      }
    }
    await clear(value);
    return receipt;
  }
  function newPending(kind: PrometheusPendingOperation["kind"], body: unknown) {
    return snapshot({
      version: 1,
      scope,
      kind,
      body,
    }) as PrometheusPendingOperation;
  }
  return {
    pending: () => exclusive(pending),
    retry: () =>
      exclusive(async () => {
        const value = await pending();
        if (!value) return fail("no_pending_operation");
        return await execute(value);
      }),
    catalog: () =>
      exclusive(async () => {
        const result = await request("/api/agent/catalog");
        if (result.version !== 2 || !Array.isArray(result.modules)) {
          fail("unsupported_catalog");
        }
        return result;
      }),
    preview: (input: PrometheusCommand) =>
      exclusive(async () => {
        const cmd = snapshot(input);
        command(cmd);
        const result = await request("/api/agent/preview", { command: cmd });
        if (cmd.action !== "read") previewPlan(result);
        return result;
      }),
    read: (input: PrometheusCommand) =>
      exclusive(async () => {
        const cmd = snapshot(input);
        command(cmd);
        if (cmd.action !== "read") return fail("read_action_required");
        const result = await request("/api/agent/crud", { command: cmd });
        if (result.status !== "read" || !("result" in result)) {
          fail("invalid_read_response");
        }
        return result;
      }),
    write: (input: PrometheusEnvelope) =>
      exclusive(() => execute(newPending("domain", input))),
    settingsSchema: () => exclusive(() => request("/api/settings/schema")),
    exportSettings: () =>
      exclusive(async () => {
        const result = await request("/api/settings/export");
        settingsDocument(result);
        return snapshot(result);
      }),
    previewSettings: (input: PrometheusSettingsDocument) =>
      exclusive(() => {
        const document = snapshot(input);
        settingsDocument(document);
        return request("/api/settings/preview", { document });
      }),
    importSettings: (input: PrometheusSettingsImport) =>
      exclusive(() => execute(newPending("settings-import", input))),
    writeSettings: (input: PrometheusSettingsWrite) =>
      exclusive(() => execute(newPending("settings", input))),
  };
}
