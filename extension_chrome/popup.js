import { MAX_DOMAINS, normalizeDomainInput } from "./src/core.js";
import { VERSION } from "./src/version.js";

const api = globalThis.chrome;
const uiLanguage = api.i18n.getUILanguage();
const numbers = new Intl.NumberFormat(uiLanguage.replace("_", "-"));
const limitText = numbers.format(MAX_DOMAINS);

function byId(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node;
}

const panel = byId("domains-panel");
const list = byId("entries");
const count = byId("count");
const addButton = byId("add");
const saveButton = byId("save");
const statusLine = byId("status");

let current;
let busy = false;

function t(key, ...substitutions) {
  return api.i18n.getMessage(key, substitutions) || key;
}

function showStatus(message = "", error = false) {
  statusLine.textContent = message;
  statusLine.dataset.error = String(error);
}

function localize() {
  document.documentElement.lang = uiLanguage;
  document.title = t("extName");
  for (const node of document.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.getAttribute("data-i18n") ?? "");
  }
}

async function send(message) {
  const result = await api.runtime.sendMessage(message);
  if (!result?.ok) {
    throw Object.assign(new Error(result?.detail ?? ""), {
      code: result?.code ?? "storage",
      saved: result?.saved === true,
    });
  }
  return result;
}

function errorMessage(error) {
  const code = error?.code ?? "storage";
  if (code === "limit") return t("limit", limitText);
  if (code === "conflict") return t("conflict");
  if (code === "settings") return t("settings");
  if (code === "apply") return t("pending");
  return t("storage");
}

function rowMessage(item) {
  const value = item.value.trim() || "—";
  return t("row", numbers.format(item.index + 1), t("domain", value));
}

function entryRow(entry) {
  const row = document.createElement("div");
  row.className = "entry";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = entry.enabled;
  toggle.setAttribute("aria-label", t("site"));
  const field = document.createElement("input");
  field.type = "text";
  field.value = entry.domain;
  field.spellcheck = false;
  field.setAttribute("autocapitalize", "off");
  field.setAttribute("autocomplete", "off");
  field.setAttribute("aria-label", t("domains"));
  const error = document.createElement("small");
  error.className = "row-error";
  error.hidden = true;
  row.append(toggle, field, error);
  return row;
}

function updateCount() {
  count.textContent = current ? numbers.format(current.domains.length) : "";
}

function updateAdd() {
  addButton.disabled = !current || list.children.length >= MAX_DOMAINS;
}

function render(entries) {
  list.replaceChildren(...entries.map(entryRow));
  updateCount();
  updateAdd();
}

function collect() {
  return [...list.children].map((row, index) => {
    const field = row.querySelector('input[type="text"]');
    const toggle = row.querySelector('input[type="checkbox"]');
    const item = {
      row,
      field,
      toggle,
      error: row.querySelector(".row-error"),
      index,
      value: field ? field.value : "",
      enabled: Boolean(toggle?.checked),
      domain: undefined,
      failure: undefined,
    };
    try {
      item.domain = normalizeDomainInput(item.value);
    } catch (caught) {
      item.failure = caught;
    }
    return item;
  });
}

function showRowErrors(items) {
  for (const item of items) {
    const failed = Boolean(item.failure);
    item.error.hidden = !failed;
    item.error.textContent = failed ? rowMessage(item) : "";
    if (failed) item.field.setAttribute("aria-invalid", "true");
    else item.field.removeAttribute("aria-invalid");
  }
}

async function reload(keepRows) {
  const response = await send({ type: "get" });
  current = response.settings;
  if (!keepRows) render(current.domains);
  else {
    updateCount();
    updateAdd();
  }
  return response.pending !== undefined;
}

async function checkAccess() {
  try {
    const allowed = await api.permissions.contains({
      origins: ["http://*/*", "https://*/*"],
    });
    if (!allowed) showStatus(t("access"), true);
  } catch {
    // The access hint is optional; its failure must not hide the real state.
  }
}

async function save() {
  if (!current || busy) return;
  const items = collect();
  const invalid = items.filter((item) => item.failure);
  showRowErrors(items);
  if (invalid.length > 0) {
    // Nothing is sent: every valid edit stays in the form for the next attempt.
    showStatus(rowMessage(invalid[0]), true);
    invalid[0].field.focus();
    return;
  }
  if (items.length > MAX_DOMAINS) {
    showStatus(t("limit", limitText), true);
    return;
  }
  busy = true;
  saveButton.disabled = true;
  saveButton.setAttribute("aria-busy", "true");
  showStatus(t("saving"));
  try {
    const response = await send({
      type: "save",
      settings: {
        domains: items.map((item) => ({
          domain: item.domain,
          enabled: item.enabled,
        })),
      },
      baseRevision: current.revision,
    });
    current = response.settings;
    render(current.domains);
    showStatus(t("saved"));
  } catch (error) {
    if (error.code === "conflict") {
      try {
        await reload(true);
      } catch {
        // Keep the edited rows and the conflict message.
      }
      showStatus(t("conflict"), true);
    } else if (error.saved) {
      try {
        await reload(false);
      } catch {
        // The persisted list is already shown; keep the edited rows instead.
      }
      showStatus(t("pending"), true);
    } else {
      showStatus(errorMessage(error), true);
    }
  } finally {
    busy = false;
    saveButton.disabled = false;
    saveButton.setAttribute("aria-busy", "false");
  }
}

addButton.addEventListener("click", () => {
  if (!current || list.children.length >= MAX_DOMAINS) return;
  panel.open = true;
  const row = entryRow({ domain: "", enabled: true });
  list.append(row);
  updateAdd();
  const field = row.querySelector('input[type="text"]');
  if (field) field.focus();
});

saveButton.addEventListener("click", () => {
  void save();
});

byId("version").textContent = `v${VERSION}`;
localize();
saveButton.disabled = true;
addButton.disabled = true;
showStatus(t("loading"));
send({ type: "get" }).then(async (response) => {
  current = response.settings;
  render(current.domains);
  saveButton.disabled = false;
  if (response.pending !== undefined) {
    showStatus(t("pending"), true);
  } else {
    showStatus("");
    await checkAccess();
  }
}).catch((error) => {
  showStatus(errorMessage(error), true);
});
