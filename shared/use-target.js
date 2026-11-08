import { parseEndpointInput, validateApiBase } from "./endpoint.js";

// A main-page profile is an observation, not permission, authentication or proof.
export function parseUseTargetInput(value) {
  if (typeof value === "string" && value.trim().startsWith("{")) {
    const parsed = JSON.parse(value);
    if (parsed.version === 1 && parsed.origin && parsed.kind) {
      if (!["mac", "termux", "site"].includes(parsed.kind)) {
        throw new Error("Unsupported use target");
      }
      if (
        Object.keys(parsed).some((key) =>
          ![
            "version",
            "kind",
            "label",
            "origin",
            "identity",
            "verified_at",
          ].includes(key)
        )
      ) throw new Error("Use target profile must contain no credentials");
      if (
        parsed.identity && (typeof parsed.identity !== "object" ||
          Object.keys(parsed.identity).some((key) =>
            ![
              "version",
              "owner_id",
              "dataset_id",
              "dataset_epoch",
              "replica_id",
              "authority",
            ].includes(key)
          ))
      ) throw new Error("Use target identity must contain no credentials");
      return {
        apiBase: validateApiBase(parsed.origin),
        mode: parsed.kind === "site" ? "cloud" : "local",
        kind: parsed.kind,
        label: typeof parsed.label === "string"
          ? parsed.label.trim().slice(0, 80)
          : "",
        observedIdentity: parsed.identity ?? null,
        scope: null,
      };
    }
  }
  return parseEndpointInput(value);
}

export function safeUseTarget(profile) {
  if (
    !profile || !["mac", "termux", "site"].includes(profile.kind) ||
    !["local", "cloud"].includes(profile.mode) ||
    !profile.identity ||
    ["owner_id", "dataset_id", "dataset_epoch"].some((key) =>
      typeof profile.identity[key] !== "string" || !profile.identity[key]
    )
  ) return null;
  try {
    const origin = validateApiBase(profile.origin);
    if ((profile.kind === "site") !== (profile.mode === "cloud")) return null;
    return {
      version: 1,
      kind: profile.kind,
      mode: profile.mode,
      origin,
      label: typeof profile.label === "string"
        ? profile.label.slice(0, 80)
        : profile.kind,
      identity: Object.fromEntries(
        ["owner_id", "dataset_id", "dataset_epoch"].map((
          key,
        ) => [key, profile.identity[key]]),
      ),
      verified_at: typeof profile.verified_at === "string"
        ? profile.verified_at
        : null,
      role: ["writer", "follower"].includes(profile.role) ? profile.role : null,
    };
  } catch {
    return null;
  }
}
