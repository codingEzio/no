import {
  MAX_MENU_ITEMS,
  menuItemLabel,
  moveMenuItem,
} from "./menu_settings.js";

// A compact native-controls editor shared by product adapters. The caller owns
// storage, route verification and destination fields; this module edits a draft.
export async function mountMenuSettings({
  root,
  message,
  defaults,
  loadConfig,
  saveConfig,
  loadCatalog,
  getLabel,
  getDestinationFields,
  newDestination,
}) {
  const node = (tag, className = "") => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    return element;
  };
  const body = node("div", "menu-settings-body");
  const hint = node("small", "muted");
  hint.textContent = message("menuHint");
  const target = node("small", "muted menu-target");
  const status = node("small", "menu-config-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const pickerRow = node("div", "menu-picker-row");
  const picker = node("select", "menu-item-picker");
  picker.setAttribute("aria-label", message("menuChooseItem"));
  const fields = node("fieldset", "menu-item-fields");
  const buttons = node("div", "menu-config-actions");
  let draft = structuredClone(defaults),
    saved = null,
    selected = "",
    catalog = null;
  let dirty = false, loading = false, ready = false, saving = true;

  function button(key, label, operation) {
    const result = node("button");
    result.type = "button";
    result.dataset.menuAction = key;
    result.textContent = label;
    result.setAttribute("aria-label", message(key));
    result.title = message(key);
    result.addEventListener("click", () => {
      if (!saving) void operation();
    });
    return result;
  }
  const up = button("menuMoveUp", "↑", () => move(-1));
  const down = button("menuMoveDown", "↓", () => move(1));
  const remove = button("menuRemove", "×", () => {
    draft.items = draft.items.filter((item) => item.id !== selected);
    selected = draft.items[0]?.id ?? "";
    change();
    render();
  });
  const add = button("menuAdd", message("menuAdd"), () => {
    const destination = newDestination(catalog);
    if (!destination || draft.items.length >= MAX_MENU_ITEMS) {
      status.textContent = message("menuCatalogUnavailable");
      return;
    }
    const item = {
      id: crypto.randomUUID(),
      kind: "save",
      visible: true,
      emoji: "",
      prefix: "",
      label: "",
      destination,
    };
    draft.items.push(item);
    selected = item.id;
    change();
    render();
  });
  const refresh = button(
    "menuRefreshTags",
    message("menuRefreshTags"),
    refreshCatalog,
  );
  const save = button("menuSave", message("menuSave"), async () => {
    saving = true;
    render();
    try {
      const result = await saveConfig(structuredClone(draft), saved);
      saved = structuredClone(result);
      draft = structuredClone(result);
      dirty = false;
      ready = true;
      status.textContent = message("menuSaved");
    } catch (error) {
      status.textContent = message(error?.message || "menuSaveFailed");
    } finally {
      saving = false;
      render();
    }
  });
  const cancel = button("menuCancel", message("menuCancel"), async () => {
    saving = true;
    render();
    try {
      saved = await loadConfig();
      draft = structuredClone(saved);
      ready = true;
      dirty = false;
      status.textContent = "";
    } catch {
      status.textContent = message("menuInvalid");
    } finally {
      saving = false;
      render();
    }
  });
  const reset = button("menuReset", message("menuReset"), () => {
    draft = structuredClone(defaults);
    ready = true;
    selected = draft.items[0]?.id ?? "";
    change();
    render();
  });
  pickerRow.append(picker, up, down, remove);
  buttons.append(add, refresh, save, cancel, reset);
  body.append(hint, target, pickerRow, fields, buttons, status);
  root.append(body);

  function change() {
    dirty = true;
    save.disabled = false;
    cancel.disabled = false;
    status.textContent = message("menuUnsaved");
    updatePicker();
  }
  function move(delta) {
    draft.items = moveMenuItem(draft.items, selected, delta);
    change();
    render();
  }
  function title(item) {
    return menuItemLabel(item, getLabel(item)) +
      (item.visible ? "" : " · " + message("menuHidden"));
  }
  function updatePicker() {
    picker.replaceChildren(...draft.items.map((item) => {
      const option = node("option");
      option.value = item.id;
      option.textContent = title(item);
      return option;
    }));
    picker.value = selected;
  }
  function labeled(key, control) {
    const label = node("label", "menu-field");
    const name = node("span");
    name.textContent = message(key);
    control.setAttribute("aria-label", message(key));
    label.append(name, control);
    fields.append(label);
  }
  function render() {
    if (!draft.items.some((item) => item.id === selected)) {
      selected = draft.items[0]?.id ?? "";
    }
    updatePicker();
    fields.replaceChildren();
    const item = draft.items.find((item) => item.id === selected);
    const index = draft.items.indexOf(item);
    fields.disabled = saving || !ready || !item;
    picker.disabled = saving || !ready || !item;
    up.disabled = saving || !ready || index <= 0;
    down.disabled = saving || !ready || index < 0 ||
      index === draft.items.length - 1;
    remove.disabled = saving || !ready || item?.kind !== "save";
    add.disabled = saving || !ready || !catalog ||
      draft.items.length >= MAX_MENU_ITEMS;
    save.disabled = saving || !dirty;
    cancel.disabled = saving || !dirty;
    reset.disabled = saving;
    refresh.disabled = saving || loading;
    if (!item) return;
    const visible = node("input");
    visible.type = "checkbox";
    visible.checked = item.visible;
    visible.dataset.menuField = "visible";
    visible.addEventListener("change", () => {
      if (saving) return;
      item.visible = visible.checked;
      change();
    });
    labeled("menuVisible", visible);
    for (const [key, limit] of [["emoji", 16], ["prefix", 40], ["label", 80]]) {
      const input = node("input");
      input.type = "text";
      input.maxLength = limit;
      input.dataset.menuField = key;
      input.value = item[key];
      input.autocomplete = "off";
      if (key === "label") input.placeholder = getLabel(item);
      input.addEventListener("input", () => {
        if (saving) return;
        item[key] = input.value;
        change();
      });
      labeled(
        key === "emoji"
          ? "menuEmoji"
          : key === "prefix"
          ? "menuPrefix"
          : "menuDisplayName",
        input,
      );
    }
    if (item.kind === "save") {
      for (const field of getDestinationFields(item, catalog)) {
        const select = node("select");
        select.dataset.menuField = field.key;
        const options = [...field.options];
        let current = options.findIndex((option) =>
          option.value === item.destination[field.key]
        );
        if (current < 0) {
          options.unshift({
            value: item.destination[field.key],
            label: String(item.destination[field.key]) + " · " +
              message("menuUnavailable"),
          });
          current = 0;
        }
        select.replaceChildren(...options.map((option, index) => {
          const element = node("option");
          element.value = String(index);
          element.textContent = option.label;
          return element;
        }));
        select.value = String(current);
        select.addEventListener("change", () => {
          if (saving) return;
          item.destination[field.key] = options[Number(select.value)].value;
          change();
        });
        labeled(field.label, select);
      }
    } else {
      const fixed = node("small", "muted menu-fixed");
      fixed.textContent = message(
        item.kind === "copy" ? "menuCopyFixed" : "menuCustomFixed",
      );
      fields.append(fixed);
    }
  }
  async function refreshCatalog() {
    if (loading || saving) return;
    loading = true;
    refresh.disabled = true;
    try {
      catalog = await loadCatalog();
      target.textContent = catalog.targetLabel;
      if (!dirty) status.textContent = "";
      render();
    } catch {
      catalog = null;
      target.textContent = message("menuCatalogUnavailable");
      render();
    } finally {
      loading = false;
      refresh.disabled = saving;
    }
  }
  picker.addEventListener("change", () => {
    if (saving) return;
    selected = picker.value;
    render();
  });
  root.addEventListener("toggle", () => {
    if (root.open) void refreshCatalog();
  });
  try {
    saved = await loadConfig();
    draft = structuredClone(saved);
    ready = true;
  } catch {
    status.textContent = message("menuInvalid");
  }
  saving = false;
  render();
  return { refreshCatalog };
}
