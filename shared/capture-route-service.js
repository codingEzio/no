import {
  configuredCloudBase,
  DEFAULT_API_BASE,
  parseEndpointInput,
  SITE_ORIGIN,
  validateApiBase,
  validateCloudBase,
} from "./endpoint.js";
export { configuredCloudBase };
import {
  captureScope,
  chooseCaptureRoute,
  sameCaptureScope,
} from "./capture-route.js";
import { parseUseTargetInput, safeUseTarget } from "./use-target.js";

const LOCAL_PROBE_TIMEOUT_MS = 2500;
const CLOUD_REQUEST_TIMEOUT_MS = 8000;
export const CLOUD_DELIVERY_TIMEOUT_MS = 20000;

function rawSiteToken(value) {
  return String(value ?? "").trim().replace(/^Bearer(?:[ \t]+|$)/i, "")
    .trim();
}

async function jsonFetch(
  fetchImpl,
  url,
  init = {},
  timeoutMs = CLOUD_REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
      credentials: "omit",
    });
    const body = await response.json().catch(() => null);
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

/** @param {{storage: any, apiKey: string, tokenKey: string, siteAccessKey?: string, anchorKey: string, preferenceKey?: string, cloudBaseKey?: string, cloudBase: string, requiredScopes?: string[], fetchImpl?: typeof fetch}} options */
export function createRouteService(
  {
    storage,
    apiKey,
    tokenKey,
    siteAccessKey,
    anchorKey,
    preferenceKey,
    cloudBase,
    cloudBaseKey,
    requiredScopes = [],
    fetchImpl = fetch,
  },
) {
  if (cloudBase === SITE_ORIGIN && !siteAccessKey) {
    throw new Error("Site access storage key is required");
  }
  async function localBase() {
    const saved = await storage.get(apiKey);
    return validateApiBase(saved ?? DEFAULT_API_BASE);
  }

  const targetsKey = `${apiKey}.use-targets.v1`;
  const selectedTargetKey = `${apiKey}.use-target.v1`;
  async function targets() {
    const saved = await storage.get(targetsKey);
    return Array.isArray(saved)
      ? saved.map(safeUseTarget).filter(Boolean).slice(0, 8)
      : [];
  }

  async function currentWriter(base, identity) {
    const {response,body}=await jsonFetch(fetchImpl,`${base}/api/current-writer/status`,{},15000);
    if(response.status===404)return null; // Older standalone servers retain explicit local delivery.
    if(!response.ok||body?.version!==1||body.available!==true||body.routing!=="current-writer")throw new Error("Current writer unavailable. Capture stays pending.");
    if(!sameCaptureScope(body.scope,identity))throw new Error("Current writer belongs to a different capture dataset");
    if(typeof body.writer?.node_id!=="string"||!body.writer.node_id||!Number.isSafeInteger(body.writer.term)||body.writer.term<1||!["Mac","Android"].includes(body.writer.label))throw new Error("Current writer proof is incomplete. Capture stays pending.");
    return body.writer;
  }
  async function nativeRoute(route, identity) {
    const writer=await currentWriter(route.apiBase,identity);
    return {...route,...(writer?{writer}:{})};
  }
  function writableDescriptor(info, writer) {
    return writer ? {...info,capabilities:{...info.capabilities,capture:{...info.capabilities?.capture,available:true}}} : info;
  }

  async function inspectTarget(value) {
    const candidate = parseUseTargetInput(value);
    const base = candidate.apiBase;
    const mode = candidate.mode ??
      (base.startsWith("https:") ? "cloud" : "local");
    if (mode === "cloud") validateCloudBase(base);
    const session = mode === "cloud" ? await cloudSession(base) : null;
    if (mode === "cloud" && !session) {
      throw new Error(
        "Pair this exact server in this extension before selecting it",
      );
    }
    const headers = session
      ? {
        Authorization: `Bearer ${session.token}`,
        ...(session.siteToken && base === SITE_ORIGIN
          ? { "OAI-Sites-Authorization": `Bearer ${session.siteToken}` }
          : {}),
      }
      : {};
    const identityResult = await jsonFetch(fetchImpl, `${base}/api/identity`, {
      headers,
    });
    const identity = mode === "cloud" ? session.identity : identityResult.body;
    if (
      !identityResult.response.ok || identityResult.body?.authority !== mode ||
      !sameCaptureScope(identityResult.body, identity) ||
      !captureScope(identity)
    ) {
      throw new Error("Target identity is unavailable or changed");
    }
    const trusted = await anchor();
    if (
      (trusted && !sameCaptureScope(trusted, identity)) ||
      (candidate.scope && !sameCaptureScope(candidate.scope, identity)) ||
      (candidate.observedIdentity &&
        ["owner_id", "dataset_id", "dataset_epoch", "authority"].some((key) =>
          candidate.observedIdentity[key] !== undefined &&
          candidate.observedIdentity[key] !== identity[key]
        ))
    ) {
      throw new Error("Target belongs to a different capture dataset");
    }
    const infoResult = await jsonFetch(fetchImpl, `${base}/api/server-info`, {
      headers,
    });
    if (!infoResult.response.ok) {
      throw new Error("Fresh Server Info is required for this target");
    }
    const writer = mode === "local" ? await currentWriter(base,identity) : null;
    const verified = parseEndpointInput(JSON.stringify(writableDescriptor(infoResult.body,writer)));
    if (
      verified.apiBase !== base || verified.mode !== mode ||
      !sameCaptureScope(verified.scope, identity)
    ) {
      throw new Error("Target Server Info does not match its identity");
    }
    const kind = infoResult.body.runtime === "mac"
      ? "mac"
      : infoResult.body.runtime === "termux"
      ? "termux"
      : infoResult.body.runtime === "sites"
      ? "site"
      : null;
    if (!kind || (candidate.kind && candidate.kind !== kind)) {
      throw new Error("Target runtime does not match the selected device");
    }
    let role = null;
    if (mode === "local") {
      try {
        const node = await jsonFetch(fetchImpl, `${base}/api/native-node`, {
          headers,
        }, LOCAL_PROBE_TIMEOUT_MS);
        const state = node.body;
        if (
          node.response.ok && state?.enabled === true &&
          state.ownerId === identity.owner_id &&
          state.datasetId === identity.dataset_id &&
          state.datasetEpoch === identity.dataset_epoch &&
          ["writer", "follower"].includes(state.role)
        ) role = state.role;
      } catch {
        /* No role proof is an unknown role, never an inferred writer. */
      }
    }
    if (role === "follower" && !writer) {
      throw new Error(
        "This target is a read-only follower; choose the current writer for capture",
      );
    }
    return safeUseTarget({
      kind,
      mode,
      origin: base,
      label: candidate.label ||
        (kind === "mac" ? "Mac" : kind === "termux" ? "Termux" : "Site"),
      identity: captureScope(identity),
      verified_at: new Date().toISOString(),
      role,
    });
  }

  async function configureTarget(value) {
    const profile = await inspectTarget(value);
    const saved = await targets();
    const profiles = [
      profile,
      ...saved.filter((item) =>
        item.origin !== profile.origin || item.mode !== profile.mode
      ),
    ].slice(0, 8);
    const values = {
      [targetsKey]: profiles,
      [selectedTargetKey]: profile,
      [anchorKey]: profile.identity,
      ...(profile.mode === "local"
        ? { [apiKey]: profile.origin }
        : cloudBaseKey
        ? { [cloudBaseKey]: profile.origin }
        : {}),
      ...(preferenceKey ? { [preferenceKey]: profile.mode } : {}),
    };
    await storage.set(values);
    const selected = safeUseTarget(await storage.get(selectedTargetKey));
    if (
      !selected || JSON.stringify(selected) !== JSON.stringify(profile) ||
      !sameCaptureScope(await storage.get(anchorKey), profile.identity) ||
      (profile.mode === "local" && await localBase() !== profile.origin) ||
      (profile.mode === "cloud" &&
        await selectedCloudBase() !== profile.origin) ||
      (preferenceKey && await preference() !== profile.mode)
    ) throw new Error("Use target configuration readback failed");
    return { configured: true, profile };
  }

  async function selectTarget(origin) {
    const profile = (await targets()).find((item) => item.origin === origin);
    if (!profile) {
      throw new Error("Select a verified target or import its profile");
    }
    return await configureTarget(
      JSON.stringify({
        version: 1,
        kind: profile.kind,
        label: profile.label,
        origin: profile.origin,
        identity: profile.identity,
      }),
    );
  }

  async function targetStatus() {
    const mode = await preference() === "cloud" ? "cloud" : "local";
    const origin = mode === "cloud"
      ? await selectedCloudBase()
      : await localBase();
    const profiles = await targets();
    let selected =
      profiles.find((item) => item.origin === origin && item.mode === mode) ??
        null;
    let writer=null,writerError=null;
    if(mode==="local"){
      try {
        const identity=await localIdentity(origin);
        const trusted=await anchor();
        if(!identity||trusted&&!sameCaptureScope(trusted,identity))throw new Error("Target identity changed");
        writer=await currentWriter(origin,identity);
        if(selected){
          const node=await jsonFetch(fetchImpl,`${origin}/api/native-node`,{},LOCAL_PROBE_TIMEOUT_MS);
          selected={...selected,role:node.response.ok&&node.body?.enabled===true&&node.body.ownerId===identity.owner_id&&node.body.datasetId===identity.dataset_id&&node.body.datasetEpoch===identity.dataset_epoch&&["writer","follower"].includes(node.body?.role)?node.body.role:null,verified_at:new Date().toISOString()};
        }
      }catch(error){writerError=error instanceof Error?error.message:"Current writer unavailable";if(selected)selected={...selected,role:null,verified_at:null};}
    }
    return { profiles, selected, origin, mode, writer, writerError };
  }

  async function selectedCloudBase() {
    const saved = cloudBaseKey ? await storage.get(cloudBaseKey) : null;
    return validateCloudBase(saved ?? cloudBase);
  }

  async function configureLocal(value) {
    const descriptor = parseEndpointInput(value);
    if (descriptor.mode && descriptor.mode !== "local") {
      throw new Error("Use a local Server Info descriptor for local delivery");
    }
    const base = descriptor.apiBase;
    const identity = await localIdentity(base);
    const trusted = await anchor();
    if (
      !identity || (trusted && !sameCaptureScope(trusted, identity)) ||
      (descriptor.scope && !sameCaptureScope(descriptor.scope, identity))
    ) {
      throw new Error(
        "API identity is unavailable or differs from the verified capture dataset",
      );
    }
    const info = await jsonFetch(
      fetchImpl,
      `${base}/api/server-info`,
      {},
      LOCAL_PROBE_TIMEOUT_MS,
    );
    // A legacy 404 means unknown capability, never an invented declaration.
    if (info.response.status !== 404) {
      if (!info.response.ok) {
        throw new Error(
          `Server Info unavailable (HTTP ${info.response.status})`,
        );
      }
      const writer=await currentWriter(base,identity);
      const advertised = parseEndpointInput(JSON.stringify(writableDescriptor(info.body,writer)));
      if (
        advertised.apiBase !== base || advertised.mode !== "local" ||
        !sameCaptureScope(advertised.scope, identity)
      ) {
        throw new Error("Server Info does not match the selected API identity");
      }
    }
    await storage.set({ [apiKey]: base, [anchorKey]: captureScope(identity) });
    if (
      await storage.get(apiKey) !== base ||
      !sameCaptureScope(await storage.get(anchorKey), identity)
    ) {
      throw new Error("API configuration readback failed");
    }
    return { configured: true, apiBase: base };
  }

  async function anchor() {
    return captureScope(await storage.get(anchorKey));
  }

  async function preference() {
    const saved = preferenceKey ? await storage.get(preferenceKey) : null;
    return ["automatic", "local", "cloud"].includes(saved)
      ? saved
      : "automatic";
  }

  async function localIdentity(apiBase) {
    try {
      const { response, body } = await jsonFetch(
        fetchImpl,
        `${apiBase}/api/identity`,
        {},
        LOCAL_PROBE_TIMEOUT_MS,
      );
      return response.ok && body?.authority === "local" && captureScope(body)
        ? body
        : null;
    } catch {
      return null;
    }
  }

  async function siteAuthorization(base, candidate = null) {
    if (base !== SITE_ORIGIN) return null;
    const access = candidate ??
      (siteAccessKey && await storage.get(siteAccessKey));
    return access?.cloudBase === SITE_ORIGIN &&
        typeof access?.token === "string" && rawSiteToken(access.token)
      ? rawSiteToken(access.token)
      : null;
  }

  async function fetchCloudSession(base, token, siteToken = null) {
    try {
      const { response, body } = await jsonFetch(
        fetchImpl,
        `${base}/api/session`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            ...(siteToken
              ? { "OAI-Sites-Authorization": `Bearer ${siteToken}` }
              : {}),
          },
        },
        CLOUD_REQUEST_TIMEOUT_MS,
      );
      if (
        !response.ok || body?.authority !== "cloud" || !captureScope(body) ||
        !Array.isArray(body.scopes) ||
        requiredScopes.some((scope) => !body.scopes.includes(scope))
      ) return null;
      return body;
    } catch {
      return null;
    }
  }

  async function cloudSession(base) {
    const saved = await storage.get(tokenKey);
    if (
      typeof saved?.token !== "string" || !saved.token ||
      saved.cloudBase !== base
    ) return null;
    const siteToken = await siteAuthorization(base);
    if (base === SITE_ORIGIN && !siteToken) return null;
    const body = await fetchCloudSession(base, saved.token, siteToken);
    if (!body) return null;
    try {
      if (
        saved.clientId !== body.client_id ||
        saved.authorityId !== body.authority_id ||
        saved.subjectId !== body.subject_id ||
        !sameCaptureScope(saved.scope, body)
      ) return null;
      return { identity: body, token: saved.token, siteToken };
    } catch {
      return null;
    }
  }

  async function initialRoute() {
    return {
      mode: "unresolved",
      apiBase: await localBase(),
      cloudBase: await selectedCloudBase(),
      scope: await anchor(),
      preference: await preference(),
    };
  }

  async function resolveRoute(route) {
    if (!route || typeof route.apiBase !== "string") {
      throw new Error("Capture route is missing; operation remains pending");
    }
    validateApiBase(route.apiBase);
    const trusted = await anchor();
    if (route.mode === "cloud") {
      const session = await cloudSession(validateCloudBase(route.apiBase));
      if (
        !session ||
        !sameCaptureScope(route.scope, session.identity) ||
        route.clientId !== session.identity.client_id ||
        route.authorityId !== session.identity.authority_id ||
        route.subjectId !== session.identity.subject_id
      ) {
        throw new Error(
          "Paired cloud access changed; operation remains pending for this destination",
        );
      }
      return {
        route,
        authorization: `Bearer ${session.token}`,
        serviceAuthorization: session.siteToken
          ? `Bearer ${session.siteToken}`
          : null,
      };
    }
    if (route.mode === "local") {
      const identity = await localIdentity(route.apiBase);
      if (!identity || !sameCaptureScope(route.scope, identity)) {
        throw new Error(
          "Pinned local capture dataset is unavailable or changed",
        );
      }
      return { route: await nativeRoute(route,identity), authorization: null };
    }
    if (route.mode === "legacy-unverified") {
      const identity = await localIdentity(route.apiBase);
      if (!identity || (trusted && !sameCaptureScope(trusted, identity))) {
        throw new Error(
          "Legacy capture destination needs matching local identity before retry",
        );
      }
      const next = {
        mode: "local",
        apiBase: route.apiBase,
        scope: captureScope(identity),
      };
      if (!trusted) await storage.set({ [anchorKey]: next.scope });
      return { route: await nativeRoute(next,identity), authorization: null };
    }
    if (route.mode !== "unresolved") {
      throw new Error("Unsupported capture destination");
    }
    if (!route.scope && route.preference === "cloud") {
      throw new Error(
        "Cloud-only capture had no verified pairing when accepted; create a new capture",
      );
    }
    const local = route.preference === "cloud"
      ? null
      : await localIdentity(route.apiBase);
    const expected = route.scope ?? trusted;
    // A capture accepted before any verified scope cannot acquire a new cloud
    // destination merely because pairing happened after it was queued.
    if (!route.scope && !local) {
      throw new Error(
        "Unverified capture waits for its original local destination",
      );
    }
    if (
      route.preference !== "cloud" && local && expected &&
      !sameCaptureScope(expected, local)
    ) {
      throw new Error(
        "Local capture dataset differs from the verified account; operation remains pending",
      );
    }
    const session = route.preference === "cloud"
      ? await cloudSession(validateCloudBase(route.cloudBase))
      : null;
    if (session && expected && !sameCaptureScope(expected, session.identity)) {
      throw new Error(
        "Paired cloud dataset differs from the verified account; operation remains pending",
      );
    }
    if (route.preference === "local" && !local) {
      throw new Error(
        "Local-only capture waits for its original local service",
      );
    }
    if (route.preference === "cloud" && !session) {
      throw new Error(
        "Cloud-only capture waits for its original paired account",
      );
    }
    const chosen = chooseCaptureRoute({
      localIdentity: local,
      cloudIdentity: route.scope ? session?.identity ?? null : null,
      localBase: route.apiBase,
      cloudBase: route.cloudBase,
      preference: route.preference,
    });
    if (chosen.mode === "unverified-local") {
      throw new Error(
        "Local capture is unavailable and no matching paired cloud is connected",
      );
    }
    if (!trusted) await storage.set({ [anchorKey]: chosen.scope });
    return {
      route: chosen.mode === "local" ? await nativeRoute(chosen,local) : chosen,
      authorization: chosen.mode === "cloud" ? `Bearer ${session.token}` : null,
      serviceAuthorization: chosen.mode === "cloud" && session.siteToken
        ? `Bearer ${session.siteToken}`
        : null,
    };
  }

  /** @param {string|null} candidateBase */
  async function pair(code, label, accessToken, candidateBase = null) {
    const descriptor = parseEndpointInput(
      candidateBase ?? await selectedCloudBase(),
    );
    if (descriptor.mode && descriptor.mode !== "cloud") {
      throw new Error("Use a cloud Server Info descriptor for paired delivery");
    }
    const base = validateCloudBase(descriptor.apiBase);
    const pairingCode = String(code ?? "").trim();
    if (!pairingCode) {
      throw new Error("Enter a pairing code from the Sites owner page");
    }
    const proposedAccess = {
      cloudBase: base,
      token: rawSiteToken(accessToken),
    };
    const siteToken = await siteAuthorization(base, proposedAccess);
    if (base === SITE_ORIGIN && !siteToken) {
      throw new Error("Enter the Site access token for this origin");
    }
    const { response, body } = await jsonFetch(
      fetchImpl,
      `${base}/api/pair/claim`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(siteToken
            ? { "OAI-Sites-Authorization": `Bearer ${siteToken}` }
            : {}),
        },
        body: JSON.stringify({
          pairing_code: pairingCode,
          label: String(label ?? "Mastermind Capture"),
        }),
      },
      CLOUD_REQUEST_TIMEOUT_MS,
    );
    if (
      !response.ok || !body?.token || !body?.client_id || !body?.authority_id ||
      !body?.subject_id
    ) {
      throw new Error(`Cloud pairing failed (HTTP ${response.status})`);
    }
    const identity = await fetchCloudSession(base, body.token, siteToken);
    const trusted = await anchor();
    if (
      !identity || (trusted && !sameCaptureScope(trusted, identity)) ||
      (descriptor.scope && !sameCaptureScope(descriptor.scope, identity)) ||
      identity.client_id !== body.client_id ||
      identity.authority_id !== body.authority_id ||
      identity.subject_id !== body.subject_id
    ) {
      throw new Error(
        "Paired cloud scope does not match the verified capture dataset",
      );
    }
    const candidate = {
      token: body.token,
      cloudBase: base,
      clientId: body.client_id,
      authorityId: body.authority_id,
      subjectId: body.subject_id,
      scope: captureScope(identity),
      expiresAt: identity.token_expires_at ?? body.token_expires_at ?? null,
    };
    await storage.set({
      [tokenKey]: candidate,
      ...(cloudBaseKey ? { [cloudBaseKey]: base } : {}),
      [anchorKey]: captureScope(identity),
      ...(siteToken && siteAccessKey
        ? { [siteAccessKey]: { cloudBase: base, token: siteToken } }
        : {}),
    });
    const persisted = await storage.get(tokenKey);
    if (
      persisted?.token !== candidate.token || persisted?.cloudBase !== base ||
      persisted?.clientId !== candidate.clientId ||
      persisted?.authorityId !== candidate.authorityId ||
      persisted?.subjectId !== candidate.subjectId ||
      !sameCaptureScope(persisted?.scope, identity) ||
      !sameCaptureScope(await storage.get(anchorKey), identity) ||
      (cloudBaseKey && await storage.get(cloudBaseKey) !== base) ||
      (siteToken && (await storage.get(siteAccessKey))?.token !== siteToken)
    ) {
      throw new Error("Paired configuration readback failed");
    }
    return { connected: true, scope: captureScope(identity) };
  }

  async function status() {
    const token = await storage.get(tokenKey);
    const apiBase = await localBase();
    const [trusted, session, local] = await Promise.all([
      anchor(),
      selectedCloudBase().then(cloudSession),
      localIdentity(apiBase),
    ]);
    let localCapability = "unavailable";
    if (local) {
      try {
        const info = await jsonFetch(
          fetchImpl,
          `${apiBase}/api/server-info`,
          {},
          LOCAL_PROBE_TIMEOUT_MS,
        );
        if (info.response.status === 404) localCapability = "unknown";
        else if (info.response.ok) {
          const advertised = parseEndpointInput(JSON.stringify(info.body));
          if (
            advertised.apiBase === apiBase && advertised.mode === "local" &&
            sameCaptureScope(advertised.scope, local)
          ) localCapability = "available";
        }
      } catch { /* Failed metadata is not a verified writer capability. */ }
    }
    return {
      paired: !!session,
      pairing: session
        ? "connected"
        : token?.token
        ? "needs-pairing"
        : "not-paired",
      expiresAt: session?.identity?.token_expires_at ?? token?.expiresAt ??
        null,
      local: !!local && localCapability !== "unavailable",
      localCapability,
      mismatch: !!local && !!trusted && !sameCaptureScope(local, trusted),
      scope: trusted,
      apiBase,
      cloudBase: await selectedCloudBase(),
    };
  }

  async function read(path) {
    const initial = await initialRoute();
    const { route, authorization, serviceAuthorization } = await resolveRoute(
      initial,
    );
    const headers = {
      ...(route.writer ? {"X-Prometheus-Writer-Node":route.writer.node_id,"X-Prometheus-Writer-Term":String(route.writer.term),"X-Prometheus-Owner-Id":route.scope.owner_id,"X-Prometheus-Dataset-Id":route.scope.dataset_id,"X-Prometheus-Dataset-Epoch":route.scope.dataset_epoch} : {}),
      ...(authorization ? { Authorization: authorization } : {}),
      ...(route.mode === "cloud" && route.apiBase === SITE_ORIGIN &&
          serviceAuthorization
        ? { "OAI-Sites-Authorization": serviceAuthorization }
        : {}),
    };
    const { response, body } = await jsonFetch(
      fetchImpl,
      `${route.apiBase}${route.writer ? "/api/current-writer" : ""}${path}`,
      { headers },
      route.mode === "cloud"
        ? CLOUD_REQUEST_TIMEOUT_MS
        : route.writer ? 15000 : LOCAL_PROBE_TIMEOUT_MS,
    );
    if (!response.ok) {
      throw new Error(`Capture read unavailable (HTTP ${response.status})`);
    }
    return { body, route: route.mode, savedOn: route.writer ?? null };
  }

  return Object.freeze({
    initialRoute,
    resolveRoute,
    pair,
    status,
    read,
    localBase,
    configureLocal,
    configureTarget,
    selectTarget,
    targetStatus,
  });
}
