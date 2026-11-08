// Browser-independent context-menu settings. Product adapters own destinations;
// display edits never change the behavior of Custom or Copy actions.
export const MAX_MENU_ITEMS = 48;

function text(value, limit) {
  if (
    typeof value !== "string" || /\p{Cc}/u.test(value) ||
    [...value].length > limit
  ) {
    throw new Error("menuInvalid");
  }
  return value.trim();
}

export function normalizeMenuConfig(raw, defaults, validateDestination) {
  const config = raw === undefined ? defaults : raw;
  if (
    !config || config.version !== 1 || !Array.isArray(config.items) ||
    config.items.length > MAX_MENU_ITEMS
  ) {
    throw new Error("menuInvalid");
  }
  const ids = new Set();
  const fixed = new Set();
  const items = config.items.map((item) => {
    if (
      !item || typeof item.id !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(item.id) || ids.has(item.id) ||
      !["save", "custom", "copy"].includes(item.kind) ||
      typeof item.visible !== "boolean"
    ) {
      throw new Error("menuInvalid");
    }
    ids.add(item.id);
    if (item.kind !== "save") {
      if (fixed.has(item.kind) || item.destination !== null) {
        throw new Error("menuInvalid");
      }
      fixed.add(item.kind);
    }
    return {
      id: item.id,
      kind: item.kind,
      visible: item.visible,
      emoji: text(item.emoji, 16),
      prefix: text(item.prefix, 40),
      label: text(item.label, 80),
      destination: item.kind === "save"
        ? validateDestination(item.destination)
        : null,
    };
  });
  return { version: 1, items };
}

export function menuItemLabel(item, fallbackLabel) {
  return [item.emoji, item.prefix, item.label || fallbackLabel].filter(Boolean)
    .join(" ");
}

export function moveMenuItem(items, id, delta) {
  const index = items.findIndex((item) => item.id === id);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= items.length) return [...items];
  const result = [...items];
  [result[index], result[next]] = [result[next], result[index]];
  return result;
}
