// Pure destination rules. A queued operation keeps its route when settings change.
const FIELDS = ["owner_id", "dataset_id", "dataset_epoch"];

export function captureScope(identity) {
  if (
    !identity ||
    FIELDS.some((field) =>
      typeof identity[field] !== "string" || !identity[field] ||
      identity[field].length > 128
    )
  ) return null;
  return Object.fromEntries(FIELDS.map((field) => [field, identity[field]]));
}

export function sameCaptureScope(left, right) {
  const a = captureScope(left);
  const b = captureScope(right);
  return !!a && !!b && FIELDS.every((field) => a[field] === b[field]);
}

export function chooseCaptureRoute(
  {
    localIdentity,
    cloudIdentity,
    localBase,
    cloudBase,
    preference = "automatic",
  },
) {
  const local = captureScope(localIdentity);
  const cloud = captureScope(cloudIdentity);
  if (localIdentity && !local) {
    throw new Error("Local capture identity is incomplete");
  }
  if (cloudIdentity && !cloud) {
    throw new Error("Cloud capture identity is incomplete");
  }
  if (
    preference === "automatic" && local && cloud &&
    !sameCaptureScope(local, cloud)
  ) {
    throw new Error(
      "Local and paired cloud capture datasets differ; choose the correct local service",
    );
  }
  if (preference !== "cloud" && local) {
    return { mode: "local", apiBase: localBase, scope: local };
  }
  if (preference === "cloud" && cloud) {
    if (
      ["client_id", "authority_id", "subject_id"].some((field) =>
        typeof cloudIdentity[field] !== "string" || !cloudIdentity[field] ||
        cloudIdentity[field].length > 128
      )
    ) {
      throw new Error("Paired cloud capture session is incomplete");
    }
    return {
      mode: "cloud",
      apiBase: cloudBase,
      scope: cloud,
      clientId: cloudIdentity.client_id,
      authorityId: cloudIdentity.authority_id,
      subjectId: cloudIdentity.subject_id,
    };
  }
  return { mode: "unverified-local", apiBase: localBase, scope: null };
}

export function bindLegacyQueue(queue, apiBase) {
  return queue.map((entry) =>
    entry.route ? entry : {
      ...entry,
      route: { mode: "legacy-unverified", apiBase, scope: null },
    }
  );
}
// The selected API remains the trusted gateway. Only native execution follows
// its signed writer; immutable request bytes and owner/dataset/epoch stay pinned.
export function writerCaptureUrl(apiBase, path, route) {
  return `${apiBase}${route?.writer ? "/api/current-writer" : ""}${path}`;
}
export function writerCaptureHeaders(route) {
  return route?.writer ? {
    "X-Prometheus-Writer-Node": route.writer.node_id,
    "X-Prometheus-Writer-Term": String(route.writer.term),
    "X-Prometheus-Owner-Id": route.scope.owner_id,
    "X-Prometheus-Dataset-Id": route.scope.dataset_id,
    "X-Prometheus-Dataset-Epoch": route.scope.dataset_epoch,
  } : {};
}
export function writerDestinationMatches(route, destination) {
  return !route?.writer || destination?.node_id === route.writer.node_id &&
    destination?.term === route.writer.term &&
    destination?.label === route.writer.label;
}
