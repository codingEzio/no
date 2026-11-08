import { createController } from "./src/controller.js";
import { normalizeDomainInput, PolicyError } from "./src/core.js";

const api = globalThis.chrome;
async function loadDefaults() {
  let response;
  try {
    response = await fetch(api.runtime.getURL("private-defaults.json"));
  } catch {
    // Missing and unreadable extension resources can both reject fetch. In both
    // cases leave existing dynamic rules untouched when no settings are stored.
    return null;
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new PolicyError("private_defaults");
  try {
    const config = await response.json();
    if (!config || Object.keys(config).length !== 1 || !Array.isArray(config.domains) || config.domains.length > 1000) throw Error();
    const domains = config.domains.map(normalizeDomainInput);
    if (new Set(domains).size !== domains.length) throw Error();
    return domains;
  } catch {
    throw new PolicyError("private_defaults", "Invalid private defaults");
  }
}
const supportsPrivateDefaults = api.runtime.getURL("").startsWith("chrome-extension://");
const controller = supportsPrivateDefaults
  ? createController(api, loadDefaults, true)
  : createController(api);

// Durable intent is replayed on install, browser start and every worker start.
function recover() {
  controller.reconcile().catch((error) =>
    console.error("no", error.code, error.message)
  );
}

api.runtime.onInstalled.addListener(recover);
api.runtime.onStartup.addListener(recover);
api.runtime.onMessage.addListener((message, sender, reply) => {
  if (
    sender.id !== api.runtime.id || !message ||
    !["get", "save"].includes(message.type)
  ) return false;
  controller.handle(message).then(
    (value) => reply({ ok: true, ...value }),
    (error) =>
      reply({
        ok: false,
        code: error.code ?? "storage",
        detail: error.message,
        saved: error.saved ?? false,
      }),
  );
  return true;
});
recover();
