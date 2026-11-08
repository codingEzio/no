/** Non-secret server identity. Cloud requires authentication; local LAN remains unauthenticated. */
export type ServerIdentity = {
  version: 1;
  dataset_id: string;
  dataset_epoch?: string;
  authenticated_subject?: string;
  owner_id: string;
  replica_id: string;
  authority: "local" | "cloud";
  authenticated: boolean;
  local_only?: boolean;
};

export type TransportScope = {
  version: 1;
  dataset_id: string;
  dataset_epoch?: string;
  owner_id: string;
  replica_id: string;
  client_id: string;
  endpoint: string;
  authority: "local" | "cloud";
  local_only?: boolean;
};

/** Native domains confirm their own CAS, immutable receipt and exact readback.
 * An epoch identifies their durable queue; it does not enable retired Site sync. */
export function requiresSiteMetadata(scope: TransportScope): boolean {
  return !!scope.dataset_epoch && scope.local_only !== true;
}

/** Keep accepted metadata in storage; domain-only native writers receive the
 * same operation ID and revision. Core writes instead retain the full envelope
 * because their existing receipt hash includes its metadata. */
export function domainWritePayload<T extends object>(
  value: T,
  scope: TransportScope,
): T | Omit<T, "replication"> {
  if (scope.local_only !== true) return value;
  const { replication: _metadata, ...domain } = value as T & {
    replication?: unknown;
  };
  return domain;
}

export function parseServerIdentity(value: unknown): ServerIdentity {
  const row = value as Partial<ServerIdentity> | null;
  if (
    !row || row.version !== 1 ||
    !["local", "cloud"].includes(String(row.authority)) ||
    typeof row.authenticated !== "boolean" ||
    (row.local_only !== undefined &&
      (row.local_only !== true || row.authority !== "local")) ||
    (row.authority === "cloud" && row.authenticated !== true) ||
    (row.authority === "cloud" &&
      (typeof row.dataset_epoch !== "string" || !row.dataset_epoch ||
        typeof row.authenticated_subject !== "string" ||
        !row.authenticated_subject)) ||
    (row.dataset_epoch !== undefined &&
      (typeof row.dataset_epoch !== "string" || !row.dataset_epoch)) ||
    ![row.dataset_id, row.owner_id, row.replica_id].every((id) =>
      typeof id === "string" && id.length > 0 && id.length <= 256 &&
      ![...id].some((character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      )
    )
  ) throw new Error("Server identity invalid or cloud authentication missing");
  return {
    version: 1,
    dataset_id: row.dataset_id!,
    ...(row.dataset_epoch ? { dataset_epoch: row.dataset_epoch } : {}),
    ...(row.authenticated_subject
      ? { authenticated_subject: row.authenticated_subject }
      : {}),
    owner_id: row.owner_id!,
    replica_id: row.replica_id!,
    authority: row.authority!,
    authenticated: row.authenticated,
    ...(row.local_only ? { local_only: true } : {}),
  };
}

/** Replica/endpoint segregation is deliberate; a shared dataset is not forwarding authority. */
export function storageScopeKey(scope: TransportScope): string {
  const key = [
    scope.version,
    scope.dataset_id,
    scope.owner_id,
    scope.replica_id,
    scope.endpoint,
    scope.authority,
  ];
  // Preserve already accepted pre-epoch local keys; never adopt them into a new epoch.
  if (scope.dataset_epoch !== undefined) key.push(scope.dataset_epoch);
  return JSON.stringify(key);
}

export function sameOperationScope(
  a: TransportScope,
  b: TransportScope,
): boolean {
  return storageScopeKey(a) === storageScopeKey(b) &&
    a.client_id === b.client_id;
}
