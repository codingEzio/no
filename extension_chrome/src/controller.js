import {
  migrateSettings,
  pendingFor,
  pendingMarker,
  planSave,
  PolicyError,
  rulesFor,
  rulesMatch,
} from "./core.js";

/**
 * @typedef {import("./core.js").Settings} Settings
 * @typedef {{
 *   settings: Settings,
 *   pending?: { revision: number },
 * }} ControllerReply
 */

// Storage and dynamic-rule orchestration with every browser API injected, so
// the Deno tests drive exactly this code. One queue serializes writes; reads
// stay immediate and never wait for a rule rebuild.
export function createController(api) {
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();

  async function readRaw() {
    const data = await api.storage.local.get("settings");
    return data?.settings;
  }

  /** @returns {Promise<Settings>} */
  async function read() {
    const raw = await readRaw();
    const settings = migrateSettings(raw);
    if (raw !== undefined && raw?.schemaVersion !== settings.schemaVersion) {
      // Explicit v1 -> v2 shape upgrade. Entries are unchanged, so the same
      // revision stays valid for a concurrent editor.
      await api.storage.local.set({ settings });
    }
    return settings;
  }

  async function readPending() {
    const data = await api.storage.local.get("pending");
    const revision = data?.pending?.revision;
    return Number.isSafeInteger(revision) && revision >= 0
      ? { revision }
      : undefined;
  }

  async function markPending(revision) {
    try {
      await api.storage.local.set(pendingMarker(revision));
    } catch {
      // Saved settings stay authoritative if the marker cannot be written.
    }
  }

  async function clearPending() {
    try {
      if (typeof api.storage.local.remove === "function") {
        await api.storage.local.remove("pending");
      } else {
        await api.storage.local.set({ pending: undefined });
      }
    } catch {
      // A stale marker is harmless; the next successful reconcile clears it.
    }
  }

  /**
   * @param {Settings} settings
   * @param {boolean} saved
   */
  async function apply(settings, saved) {
    try {
      const expected = rulesFor(settings.domains);
      const existing = await api.declarativeNetRequest.getDynamicRules();
      if (rulesMatch(existing, expected)) {
        await clearPending();
        return;
      }
      await api.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existing.map((rule) => rule.id),
        addRules: expected,
      });
      const actual = await api.declarativeNetRequest.getDynamicRules();
      if (!rulesMatch(actual, expected)) {
        throw new Error("Rule readback differs from saved settings");
      }
      await clearPending();
    } catch (error) {
      throw new PolicyError("apply", String(error), saved);
    }
  }

  /** @returns {Promise<ControllerReply>} */
  async function run(message) {
    const current = await read();
    if (message.type === "get") {
      const pending = await readPending();
      return {
        settings: current,
        ...(pendingFor(current, pending) ? { pending } : {}),
      };
    }
    if (message.type !== "save") throw new PolicyError("message");
    const next = planSave(current, message.settings, message.baseRevision);
    // Persist intent first. A restarted worker replays it before acknowledging.
    await api.storage.local.set({ settings: next });
    const persisted = await read();
    if (JSON.stringify(persisted) !== JSON.stringify(next)) {
      throw new PolicyError("storage");
    }
    try {
      await apply(next, true);
    } catch (error) {
      await markPending(next.revision);
      throw error;
    }
    return { settings: next };
  }

  /**
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  function enqueue(task) {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  }

  return {
    /** @returns {Promise<ControllerReply>} */
    handle(message) {
      if (message?.type === "get") return run(message);
      return enqueue(() => run(message));
    },
    /** @returns {Promise<ControllerReply>} */
    reconcile() {
      return enqueue(async () => {
        const settings = await read();
        await apply(settings, true);
        return { settings };
      });
    },
  };
}
