"use strict";
// Complete emoji sequences own the font decision. No observer, storage or network
// runs until a caller explicitly invokes an API. Shared by page and shadow UI.
(() => {
  if (globalThis.ExtensionBrowserEmoji?.version === 1) {
    globalThis.CalmlyBrowserEmoji = globalThis.ExtensionBrowserEmoji;
    return;
  }
  const CLASS = "extension-browser-emoji";
  const PROVIDER = "data-extension-emoji-provider";
  const IMAGE = "data-extension-emoji-image";
  const SOURCE = "data-extension-emoji-source";
  const SYSTEM = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",emoji';
  const CUSTOM = '"Extension Emoji3D",' + SYSTEM;
  const SKIP = "script,style,noscript,textarea,input,select,option,svg,math,[contenteditable]:not([contenteditable='false']),[role='textbox'],[data-extension-emoji-skip]";
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const imageStates = new WeakMap();
  const presentations = new WeakMap();
  const textStates = new WeakMap();
  const textOwners = new WeakMap();
  const requests = new Map();
  let supported = new Set();
  let configured = false;

  function configure(value) {
    const input = Array.isArray(value) ? value : value?.sequences;
    if (!Array.isArray(input)) throw new TypeError("Emoji sequences must be an array");
    const next = new Set();
    for (const row of input) {
      const sequence = typeof row === "string" ? row : row?.sequence;
      if (typeof sequence !== "string" || !sequence || [...segmenter.segment(sequence)].length !== 1) {
        throw new TypeError("Emoji entries must be complete single graphemes");
      }
      next.add(sequence);
    }
    supported = next;
    configured = true;
    return supported.size;
  }

  async function loadSequences(url) {
    const key = String(url);
    if (!requests.has(key)) {
      const request = (async () => {
        const response = await fetch(key);
        if (!response.ok) throw new Error("Emoji sequence load failed: " + response.status);
        const value = await response.json();
        configure(value);
        return value;
      })();
      requests.set(key, request);
      request.catch(() => { if (requests.get(key) === request) requests.delete(key); });
    }
    return await requests.get(key);
  }

  const parts = value => [...segmenter.segment(value)].map(row => row.segment);
  function emoji(value, image = false) {
    return /\p{Emoji_Presentation}/u.test(value) ||
      (/\p{Extended_Pictographic}/u.test(value) && (image || value.includes("\uFE0F"))) ||
      /^[#*0-9]\uFE0F?\u20E3$/u.test(value);
  }
  function excluded(node) {
    const element = node.nodeType === 1 ? node : node.parentElement;
    return !!element?.closest(SKIP);
  }
  function decorated(root) {
    const result = [...root.querySelectorAll?.("." + CLASS) ?? []];
    if (root.nodeType === 1 && root.classList.contains(CLASS)) result.unshift(root);
    return result;
  }
  function paint(span, mode) {
    const provider = mode === "noto3d" && supported.has(span.textContent) ? "noto3d" : "system";
    if (span.getAttribute(PROVIDER) !== provider) {
      span.setAttribute(PROVIDER, provider);
      span.style.setProperty("font-family", provider === "noto3d" ? CUSTOM : SYSTEM, "important");
    }
    return provider;
  }
  function make(document, sequence, mode) {
    const span = document.createElement("span");
    span.className = CLASS;
    span.textContent = sequence;
    paint(span, mode);
    return span;
  }
  function verifiedImage(image) {
    const alt = image.getAttribute("alt") ?? "";
    if (parts(alt).length !== 1 || !emoji(alt, true)) return false;
    try {
      const url = new URL(image.src);
      return url.protocol === "https:" && url.hostname === "abs.twimg.com" && url.pathname.startsWith("/emoji/");
    } catch { return false; }
  }
  function restoreImage(image, state) {
    if (image.getAttribute("style") === state.hiddenStyle) {
      if (state.style === null) image.removeAttribute("style");
      else image.setAttribute("style", state.style);
    } else if (image.style.getPropertyValue("display") === "none" && image.style.getPropertyPriority("display") === "important") {
      image.style.removeProperty("display");
      if (state.display) image.style.setProperty("display", state.display, state.priority);
    }
    image.removeAttribute(SOURCE);
    state.span.remove();
    imageStates.delete(image);
    presentations.delete(state.span);
  }

  function textAnchors(root) {
    const anchors = new Set();
    for (const span of decorated(root)) {
      const anchor = textOwners.get(span);
      if (anchor) anchors.add(anchor);
    }
    if (root.nodeType === 3 && textStates.has(root)) anchors.add(root);
    return anchors;
  }
  function restoreText(anchor) {
    const state = textStates.get(anchor);
    if (!state) return;
    if (anchor.nodeValue === state.prefix) anchor.nodeValue = state.original;
    for (const addition of state.additions) {
      addition.remove();
      textOwners.delete(addition);
    }
    textStates.delete(anchor);
  }
  function apply(root, { mode = "system", replaceImages = true, textSelector = null } = {}) {
    if (mode !== "system" && mode !== "noto3d") throw new TypeError("Unknown emoji mode");
    if (!root) return { textEmoji: 0, imageEmoji: 0, customSequences: 0, providerReady: configured };
    const document = root.ownerDocument ?? root;
    let textEmoji = 0, imageEmoji = 0, customSequences = 0;
    for (const anchor of textAnchors(root)) {
      const state = textStates.get(anchor);
      if (mode === "system" || anchor.nodeValue !== state.prefix || anchor.parentNode !== state.parent) restoreText(anchor);
    }
    for (const span of decorated(root)) {
      const original = presentations.get(span);
      if (original && (original.parentNode !== span.parentNode || !verifiedImage(original) || excluded(original))) {
        restoreImage(original, imageStates.get(original));
        continue;
      }
      if (span.hasAttribute(IMAGE)) continue;
      if (excluded(span)) continue;
      if (paint(span, mode) === "noto3d") customSequences++;
    }
    const nodes = [];
    if (root.nodeType === 3) nodes.push(root);
    else {
      const walker = document.createTreeWalker(root, 4);
      while (walker.nextNode()) nodes.push(walker.currentNode);
    }
    for (const node of nodes) {
      if (mode === "system" || !node.parentNode || textOwners.has(node) || textStates.has(node) || excluded(node) || node.parentElement?.closest("." + CLASS)) continue;
      if (textSelector && !node.parentElement?.closest(textSelector)) continue;
      const values = parts(node.nodeValue ?? "");
      if (!values.some(value => emoji(value))) continue;
      const original = node.nodeValue;
      const first = values.findIndex(value => emoji(value));
      const prefix = values.slice(0, first).join("");
      const fragment = document.createDocumentFragment();
      const additions = [];
      for (const value of values.slice(first)) {
        let addition;
        if (emoji(value)) {
          const span = make(document, value, mode);
          if (span.getAttribute(PROVIDER) === "noto3d") customSequences++;
          addition = span;
          textEmoji++;
        } else addition = document.createTextNode(value);
        additions.push(addition);
        textOwners.set(addition, node);
        fragment.append(addition);
      }
      textStates.set(node, { original, prefix, additions, parent: node.parentNode });
      node.nodeValue = prefix;
      node.after(fragment);
    }
    const images = [...root.querySelectorAll?.("img") ?? []];
    if (root.nodeType === 1 && root.tagName === "IMG") images.unshift(root);
    for (const image of images) {
      const previous = imageStates.get(image);
      if (!replaceImages || excluded(image) || !verifiedImage(image)) {
        if (previous) restoreImage(image, previous);
        continue;
      }
      const sequence = image.getAttribute("alt");
      let state = previous;
      if (!state || !state.span.parentNode) {
        const span = make(document, sequence, mode);
        span.setAttribute(IMAGE, "true");
        span.setAttribute("role", "img");
        state = {
          span, style: image.getAttribute("style"),
          display: image.style.getPropertyValue("display"),
          priority: image.style.getPropertyPriority("display"),
        };
        image.after(span);
        image.style.setProperty("display", "none", "important");
        state.hiddenStyle = image.getAttribute("style");
        image.setAttribute(SOURCE, "");
        imageStates.set(image, state);
        presentations.set(span, image);
      }
      if (state.span.textContent !== sequence) state.span.textContent = sequence;
      if (state.span.getAttribute("aria-label") !== sequence) state.span.setAttribute("aria-label", sequence);
      if (paint(state.span, mode) === "noto3d") customSequences++;
      imageEmoji++;
    }
    return { textEmoji, imageEmoji, customSequences, providerReady: configured };
  }

  function restore(root) {
    if (!root) return;
    for (const anchor of textAnchors(root)) restoreText(anchor);
    for (const span of decorated(root)) {
      const image = presentations.get(span);
      if (image) restoreImage(image, imageStates.get(image));
      else span.replaceWith(span.ownerDocument.createTextNode(span.textContent));
    }
  }
  const api = Object.freeze({ version: 1, configure, loadSequences, apply, restore });
  globalThis.ExtensionBrowserEmoji = api;
  globalThis.CalmlyBrowserEmoji = api;
})();
