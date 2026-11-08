// Keep the visible NO ✋ mark text-free; localize the title/accessibility label
// explicitly because Chrome does not substitute __MSG_*__ in ordinary HTML.
// Preserve the readable static mark if the localized message is unavailable.
const api = globalThis.chrome;

document.documentElement.lang = api.i18n.getUILanguage();
const blocked = api.i18n.getMessage("blocked");
const label = blocked ? `NO ✋ ${blocked}` : "NO ✋";
document.title = label;
document.querySelector("h1")?.setAttribute("aria-label", label);

function fit() {
  const text = document.querySelector(".no text");
  if (!text) return;
  const style = getComputedStyle(text);
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return;
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const ink = context.measureText(text.textContent ?? "");
  // SVG getBBox includes this font's large line box. Fit visible glyph ink.
  document.querySelector(".no")?.setAttribute(
    "viewBox",
    `${-ink.actualBoundingBoxLeft} ${-ink.actualBoundingBoxAscent} ${
      ink.actualBoundingBoxLeft + ink.actualBoundingBoxRight
    } ${ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent}`,
  );
}

fit();
document.fonts.ready.then(fit);
document.fonts.addEventListener("loadingdone", fit);
