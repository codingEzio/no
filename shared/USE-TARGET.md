# Extension use targets

`use-target.js`, `use-target-ui.js`, `use-target-copy.js` and the target methods
in `capture-route-service.js` are source helpers. `scripts/sync_endpoints.ts`
materializes them into each independent Capture/Collector package; Safari sync
then uses those package sources. There is no shared native host, browser login
store or runtime between extensions or the main app.

Quick selection lists at most eight previously verified origins per extension.
An explicit API origin, Server Info JSON or the main app's safe profile can add
a target. Every selection rechecks identity and Server Info at that exact
origin, matching owner/dataset/epoch and capture capability. Mac/Termux roles
come only from a successful, same-scope `/api/native-node`; unavailable role
proof stays Unknown. The UI labels saved observations with their last
verification time. Readonly capture targets are rejected. Loopback means the
current browser's device; it never redirects to another node. LAN addresses are
explicit.

A safe import profile is:

```json
{
  "version": 1,
  "kind": "termux",
  "label": "Termux",
  "origin": "http://192.168.1.80:10012",
  "identity": {
    "version": 1,
    "owner_id": "observed-owner-id",
    "dataset_id": "observed-dataset-id",
    "dataset_epoch": "observed-epoch",
    "replica_id": "observed-replica-id",
    "authority": "local"
  },
  "verified_at": "2026-10-05T00:00:00.000Z"
}
```

This example describes the schema, not a seed or a verified personal target.
`kind` is `mac`, `termux` or `site`. `identity` and `verified_at` are optional
observations; they never substitute for live proof. Origins must be bare private
HTTP or HTTPS origins. Extra credentials/authentication fields are refused. For
a paired target, the existing device token must already belong to that exact
origin in that extension; the current Site also needs its exact-origin outer
access token. Neither token is imported, displayed or copied from the main app.
HTTPS local servers should use a `mac`/`termux` profile or local Server Info; a
bare HTTPS address selects the paired-server route.

Target settings live under `<existing apiKey>.use-targets.v1` and
`<existing apiKey>.use-target.v1`. Verified selection persists with readback and
updates only future-capture API/preference keys. Accepted queues, payloads,
operation IDs, routes, scopes and collector checkpoints remain unchanged. A
target failure does not pause or redirect an existing direct-save job. Existing
pending work can still confirm its original destination through the normal
receipt/readback flow.

Capture exposes this picker before Settings. Bookmark Collector's shipping
exporter stays offline: its picker only selects the app to open for Entries
import, and never uploads the Markdown. Copy/download, review and confirmation
remain explicit. The retained direct-save route keeps its own pinned jobs. All
target-picker copy is present in the project's eight locales; existing
light/dark/system settings continue to own appearance.

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
