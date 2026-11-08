# Prometheus owner API client

## Explicit endpoint configuration

`endpoint.js`, `capture-route.js` and `capture-route-service.js` are shared pure
source for the three Capture products and retained direct-save Collector routes.
`deno task endpoints:sync` materializes them inside each independent package;
`endpoints:check` rejects drift. Safari generation consumes the Chrome source.
No shared runtime or native host is added.

New unset local addresses default to `http://127.0.0.1:10012`, the native
frontend/API proxy. Explicit Mac backend15012 addresses retain their grants;
changing this default never migrates saved addresses or accepted queued routes.
Capture's old route-less queue entries bind to the saved local address or their
original15012 default. They never adopt the new10012 default during recovery.

Endpoint fields accept a bare API origin or copyable `GET /api/server-info` JSON
(`version: 1`). Extraction validates `endpoints.api_base`, identity
authority/owner/dataset/epoch, capture availability, fixed write/readback paths
and POST/GET methods. Fresh `/api/identity` or paired `/api/session` must match
before retaining configuration. Local configuration also reads Server Info and
refuses declared read-only/unsupported writers. Legacy 404 means unknown
capability, retaining the existing verified-identity compatibility path.

HTTP is limited to explicit loopback/private IPv4 LAN and local IPv6, with
arbitrary ports. Servers use HTTPS. Credentials, paths, queries, fragments and
public HTTP are rejected. There is no autodiscovery/scan. Broad optional
permissions are an envelope; each user action requests its selected origin in
Chrome. Safari and Firefox match patterns omit ports, so their grant covers the
selected scheme and exact host across ports. The API destination, identity
verification and retained pending route still include the exact selected port.
Invalid saved configuration fails closed. Pending work retains its original
origin, scope, operation ID and bytes. Automatic preference is local-only;
paired delivery requires explicit Cloud selection.

Only the current private ChatGPT Site receives its origin-bound
`OAI-Sites-Authorization` token; LAN and other HTTPS servers never receive it.
Future servers still must implement narrow device scopes, matching receipts and
exact readback; HTTPS alone is not proof. Existing owner API helpers retain
their separate owner authorization boundary.

Bookmark Collector's shipping exporter stays offline; its API code is retained
recovery. Bilibili is retired recovery-only, with storage preserved. VIA remains
clipboard-only. AtlasKit keeps its native Atlas/Kit bridge. Calmly, no and Tab
Merge N Sort use no Prometheus API.

`prometheus-api.ts` is a browser TypeScript source helper for extensions that
explicitly need the owner's domain or portable-settings API. It does not change
any installed extension, manifest, permission, package version or queue. Each
product must approve and package an integration through its own plan; Safari
classic workers still require a generated bundle without unresolved imports.

The supported contract is defined by the configured Prometheus server. Use
that server project's API documentation and discover its current modules,
allowed actions and fields with `catalog()` before constructing a command. Domain validation, revisions, archive/restore rules and matching
receipt/readback remain owned by the server.

Integration and delivery status belong to the consuming product's maintenance
record; this portable reference defines only the shared source contract. Existing extension packages keep their
current manifests, permissions, queues and destinations. This client neither
upgrades a Capture device principal nor enables owner authentication inside an
installed extension automatically.

| Client method               | Fixed endpoint                      | Purpose                                           |
| --------------------------- | ----------------------------------- | ------------------------------------------------- |
| `catalog()`                 | `GET /api/agent/catalog`            | Version 2 capability catalog                      |
| `preview(command)`          | `POST /api/agent/preview`           | Validate a command without applying it            |
| `read(command)`             | `POST /api/agent/crud`              | A command whose action is `read`                  |
| `write(envelope)`           | `POST /api/agent/crud`              | Create, update, delete or restore                 |
| `settingsSchema()`          | `GET /api/settings/schema`          | Portable, non-secret key definitions              |
| `exportSettings()`          | `GET /api/settings/export`          | Version 1 settings document                       |
| `previewSettings(document)` | `POST /api/settings/preview`        | Validate keys and inspect their current revisions |
| `writeSettings(body)`       | `POST /api/settings`                | Atomic revision-checked key updates               |
| `importSettings(body)`      | `POST /api/settings/import`         | Atomic versioned document import                  |
| `pending()` / `retry()`     | Durable slot / original fixed route | Inspect or retry an unresolved operation          |

## Caller responsibilities

- Supply an already authorized **owner** transport bound to one verified
  authority, owner, dataset and epoch. Preserve its normal Origin/CSRF handling
  and exact host permission. The helper does not pair devices, acquire session
  credentials, read cookies, or add Authorization headers. Existing Capture
  device tokens retain their narrower Capture permissions and cannot become
  owner credentials through this helper.
- Supply a durable `recovery` adapter with async `get`, `set` and `remove`. Use
  a dedicated key per verified scope. One extension worker owns that slot and
  client instance; independent workers need a caller-owned lock. Do not put
  credentials in the slot, command, settings document or logs.
- Set stable `operation_id` and record ID before calling `write`. Prepare any
  replication metadata using the existing verified replication context. Retry
  the same operation, including its IDs, revision, route and metadata; do not
  regenerate them after a timeout or restart.
- Present the actual pending/failure state. A pending operation is not Saved.
  Resolve a conflicting revision or changed readback before replacing its slot;
  there is no automatic discard, rerouting or background retry.

Example setup with adapters supplied by the extension:

```ts
import { createPrometheusApiClient } from "./prometheus-api.ts";

const api = createPrometheusApiClient({
  scope: verifiedOwnerScope,
  transport: ownerTransport,
  recovery: scopedDurableSlot,
});
await api.catalog();
await api.preview(command);
// After the caller's explicit save action:
await api.write({ command, ...(metadata ? { replication: metadata } : {}) });
// On restart, show the original operation before retrying:
const pending = await api.pending();
if (pending && userRequestedRetry) await api.retry();
```

Settings imports use `{ operation_id, document, expected_revisions }`, where
`document` is
`{ format: "prometheus-settings", version: 1, items: [{key,value}] }`. Get
revisions from the preview's `changes[].current.revision`; include exactly the
imported keys. Single/multiple key updates use
`{ operation_id, items: [{key,revision,value}] }`. Reset to a key's default uses
the catalogued `settings` domain command's `delete` action. Credentials, session
keys, security configuration and an extension's independent local preferences
are outside this portable-settings format.

## Persistence and limits

The helper snapshots canonical JSON, writes the scoped envelope and reads back
its exact bytes before sending a mutating request. Concurrent calls fail with
`client_busy`; there is one request in flight and no hidden queue. Read-only
inspection never overwrites a pending envelope. A retry loads and sends the
original bytes.

Domain completion requires `status: verified`, an exact match between the
preview-selected receipt record and returned readback, and the original
operation ID in the receipt or its declared operation-bound receipt route. The
latter covers definition receipts whose body is the canonical DTO. The explicit
`home-layout` descriptor projection compares only `{revision,keys}` for Home's
ordered placement aggregate; keys must be unique strings, and unknown
projections are rejected before mutation. Other receipt/readback fields remain
subject to exact comparison. Supplied replication metadata additionally requires
a confirmed, applied proof for the same client, scope, operation and document.
Settings completion fetches `/api/settings/operations/:operation_id`, compares
it with the write result, checks all requested keys/values/revisions, and
fetches each current `/api/settings/:key` record for exact comparison. Only then
is the recovery slot removed and read back as empty.

`prometheusApiLimits` owns the conservative 128 KiB request/recovery envelope,
128 settings keys, 2 MiB response bound and 30-second default timeout. JSON
depth is capped at 32. `timeoutMs` can override the request timeout from 100 ms
to 60 seconds; the trusted transport must honor `RequestInit.signal`, including
body reads. HTTP, transport, storage or proof failures retain the pending
operation. No automatic retry or unbounded memory queue is created.

Verification: `deno test tests/extension_api_client_test.ts` uses isolated
transport/storage fixtures for persistence failure, acceptance/disconnect,
restart, immutable replay, wrong scope, wrong receipts/readback, concurrency,
bounds, confirmed replication and settings verification. It does not prove an
installed extension's authentication, permissions or real-data delivery.

## Native capture follows the current writer — 2026-10-11

For Journal, Journal Archive, Bookmark (Chrome and VIA direct Save), and the
retained Collector save worker, the selected native origin is the connection
gateway. Fresh GET /api/current-writer/status verifies the paired writer within
the original owner/dataset/epoch. Capture writes and their receipt/readback
use /api/current-writer followed by the existing API path, with the verified
writer node/term and original scope headers. Payloads, operation IDs, gateway
identity and durable queues stay unchanged. No writer handoff or full-copy sync
is performed. Cloud pairing and the offline Collector exporter retain their
existing behavior.

Saved requires the original receipt and exact persisted readback from that
writer. The UI names its device (Saved on Android / Mac); this does not claim
the other copy was synced. A writer change, unavailable peer, wrong scope or
proof mismatch retains Pending for the same operation. Configured native
gateways never fall back to a follower write or another dataset. Only an
explicit 404 for the status endpoint permits the legacy standalone API route.
Existing follower gateways are selectable when their current writer is freshly
verified; settings show both the connection and saving device.
