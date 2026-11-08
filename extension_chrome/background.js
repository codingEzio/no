import { createController } from "./src/controller.js";

const api = globalThis.chrome;
const controller = createController(api);

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
