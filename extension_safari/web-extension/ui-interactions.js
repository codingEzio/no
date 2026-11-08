// Local, presentation-only extension interactions. No browser/storage/network API.
(() => {
  const timing = { enter: 160, exit: 120, easing: "cubic-bezier(.2,.8,.2,1)" };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const selectors =
    "[role=tabpanel],.site-panel,[data-appearance],#composer,#recent-panel,#recent-controls,.tab-detail,.rule-library,.rule-editor,.navigation-prompt,.rule-delete-confirm,#error-banner,[data-ui-reveal]";
  const cached = new WeakMap();
  const running = new WeakMap();
  const exitPaint = new Map();
  const disclosures = new WeakMap();
  const exitAccessibility = new WeakMap();
  const disclosureInert = new WeakMap();
  let initialized = false;

  function snapshot(node) {
    if (!(node instanceof HTMLElement) || !node.isConnected || node.hidden) {
      return;
    }
    const style = getComputedStyle(node);
    if (style.display === "none" || !node.getClientRects().length) return;
    const parent = node.offsetParent;
    cached.set(node, {
      display: style.display,
      left: node.offsetLeft,
      top: node.offsetTop,
      width: node.getBoundingClientRect().width,
      parent,
    });
  }
  function capture() {
    document.querySelectorAll(selectors).forEach(snapshot);
  }
  function clearExit(node) {
    node.removeAttribute("data-ui-exiting");
    const original = exitAccessibility.get(node);
    if (original) {
      if (original.ariaHidden === null) node.removeAttribute("aria-hidden");
      else node.setAttribute("aria-hidden", original.ariaHidden);
      node.inert = original.inert;
      exitAccessibility.delete(node);
    }
    for (
      const name of [
        "--ui-exit-display",
        "--ui-exit-left",
        "--ui-exit-top",
        "--ui-exit-width",
      ]
    ) {
      node.style.removeProperty(name);
    }
  }
  function interrupt(node) {
    const current = running.get(node);
    const style = getComputedStyle(node);
    const opacity = current ? Number(style.opacity) : 0;
    const transform = current ? style.transform : "translateY(4px)";
    current?.cancel();
    running.delete(node);
    return { opacity, transform };
  }
  function reveal(node) {
    if (!(node instanceof HTMLElement) || !node.matches(selectors)) return;
    if (node.hidden || getComputedStyle(node).display === "none") {
      const previous = cached.get(node);
      if (!previous || reduced.matches) {
        running.get(node)?.cancel();
        clearExit(node);
        return;
      }
      const old = running.get(node);
      const opacity = old ? Number(getComputedStyle(node).opacity) : 1;
      const transform = old
        ? getComputedStyle(node).transform
        : "translateY(0)";
      old?.cancel();
      if (!exitAccessibility.has(node)) {
        exitAccessibility.set(node, {
          ariaHidden: node.getAttribute("aria-hidden"),
          inert: node.inert,
        });
      }
      node.dataset.uiExiting = "true";
      node.setAttribute("aria-hidden", "true");
      node.inert = true;
      node.style.setProperty("--ui-exit-display", previous.display);
      node.style.setProperty("--ui-exit-left", `${previous.left}px`);
      node.style.setProperty("--ui-exit-top", `${previous.top}px`);
      node.style.setProperty("--ui-exit-width", `${previous.width}px`);
      const animation = node.animate([
        { opacity, transform },
        { opacity: 0, transform: "translateY(-4px)" },
      ], { duration: timing.exit, easing: timing.easing });
      running.set(node, animation);
      animation.finished.then(() => {
        if (running.get(node) !== animation) return;
        running.delete(node);
        clearExit(node);
      }).catch(() => {});
      return;
    }
    const presented = interrupt(node);
    clearExit(node);
    if (node.closest("[hidden]") || getComputedStyle(node).display === "none") {
      return;
    }
    snapshot(node);
    if (reduced.matches) return;
    const animation = node.animate([
      presented,
      { opacity: 1, transform: "translateY(0)" },
    ], { duration: timing.enter, easing: timing.easing });
    running.set(node, animation);
    animation.finished.then(() => {
      if (running.get(node) === animation) running.delete(node);
      snapshot(node);
    }).catch(() => {});
  }

  function setDisclosure(details, open) {
    const summary = details.querySelector(":scope > summary");
    if (!summary) return;
    const prior = disclosures.get(details);
    const fromHeight = details.getBoundingClientRect().height;
    const children = [...details.children].filter((node) => node !== summary);
    const opacity = prior?.animations.length
      ? Number(getComputedStyle(children[0] ?? summary).opacity)
      : open
      ? 0
      : 1;
    const transforms = children.map((node) =>
      prior?.animations.length
        ? getComputedStyle(node).transform
        : `translateY(${open ? 4 : 0}px)`
    );
    prior?.animations.forEach((animation) => animation.cancel());
    const state = { open, animations: [] };
    disclosures.set(details, state);
    details.style.removeProperty("height");
    details.style.removeProperty("overflow");
    details.dataset.uiExpanded = String(open);
    summary.setAttribute("aria-expanded", String(open));
    // Closed content is inert while it visibly exits. State/input never waits.
    children.forEach((node) => {
      if (!disclosureInert.has(node)) disclosureInert.set(node, node.inert);
      node.inert = !open || disclosureInert.get(node);
    });
    if (reduced.matches) {
      details.open = open;
      return;
    }
    details.open = true;
    const fullHeight = details.getBoundingClientRect().height;
    const summaryHeight = summary.getBoundingClientRect().height;
    const absolute = children.some((node) =>
      getComputedStyle(node).position === "absolute"
    );
    const duration = open ? timing.enter : timing.exit;
    if (!absolute) {
      details.style.overflow = "clip";
      state.animations.push(details.animate([
        { height: `${fromHeight}px` },
        { height: `${open ? fullHeight : summaryHeight}px` },
      ], { duration, easing: timing.easing, fill: "both" }));
    }
    for (const [index, child] of children.entries()) {
      state.animations.push(child.animate([
        { opacity, transform: transforms[index] },
        { opacity: open ? 1 : 0, transform: `translateY(${open ? 0 : -4}px)` },
      ], { duration, easing: timing.easing, fill: "both" }));
    }
    Promise.allSettled(state.animations.map((animation) => animation.finished))
      .then(() => {
        if (disclosures.get(details) !== state) return;
        details.open = open;
        state.animations.forEach((animation) => animation.cancel());
        state.animations = [];
        details.style.removeProperty("height");
        details.style.removeProperty("overflow");
        capture();
      });
  }

  // A dynamically rebuilt row can retain its removed reveal only as inert paint.
  // The product update and persistence run immediately; no hidden form is read.
  function change(root, update) {
    const exits = reduced.matches ? [] : [
      ...root.querySelectorAll(
        ".tab-detail:not([hidden]):not([data-ui-exiting])",
      ),
    ].map((node) => {
      const box = node.getBoundingClientRect();
      const parent = root.getBoundingClientRect();
      return {
        node,
        width: box.width,
        left: box.left - parent.left + root.scrollLeft,
        top: box.top - parent.top + root.scrollTop,
      };
    });
    const result = update();
    for (const exit of exits) {
      if (exit.node.isConnected) continue;
      const node = exit.node;
      node.dataset.uiExiting = "true";
      node.inert = true;
      node.setAttribute("aria-hidden", "true");
      node.style.setProperty("--ui-exit-display", "grid");
      node.style.setProperty("--ui-exit-left", `${exit.left}px`);
      node.style.setProperty("--ui-exit-top", `${exit.top}px`);
      node.style.setProperty("--ui-exit-width", `${exit.width}px`);
      root.append(node);
      const animation = node.animate([{
        opacity: 1,
        transform: "translateY(0)",
      }, { opacity: 0, transform: "translateY(-4px)" }], {
        duration: timing.exit,
        easing: timing.easing,
      });
      exitPaint.set(node, animation);
      animation.finished.finally(() => {
        if (exitPaint.get(node) !== animation) return;
        exitPaint.delete(node);
        node.remove();
      }).catch(() => {});
    }
    return result;
  }

  function mount() {
    if (initialized) return;
    initialized = true;
    document.documentElement.dataset.uiMotion = "ready";
    capture();
    // Capture before product handlers change visibility; one pass per input.
    document.addEventListener("pointerdown", capture, true);
    document.addEventListener("keydown", capture, true);
    document.addEventListener("click", (event) => {
      capture();
      const summary = event.target.closest?.("summary");
      if (!summary || summary.parentElement.tagName !== "DETAILS") return;
      if (
        event.target.closest?.(
          "a,button,input,select,textarea,[contenteditable=true]",
        )
      ) return;
      const details = summary.parentElement;
      event.preventDefault();
      const state = disclosures.get(details);
      setDisclosure(
        details,
        !(state?.animations.length ? state.open : details.open),
      );
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const open = document.querySelector(
        ".appearance-more[open], [data-ui-popover][open]",
      );
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        setDisclosure(open, false);
        open.querySelector("summary")?.focus();
      }
    }, true);
    document.addEventListener("click", (event) => {
      for (
        const details of document.querySelectorAll(
          ".appearance-more[open], [data-ui-popover][open]",
        )
      ) {
        if (!details.contains(event.target)) setDisclosure(details, false);
      }
    }, true);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && record.attributeName === "open") {
          const state = disclosures.get(record.target);
          if (state?.animations.length && !record.target.open) {
            if (state.open) setDisclosure(record.target, false);
            else record.target.open = true;
          }
        }
        if (record.type === "attributes" && record.attributeName === "hidden") {
          reveal(record.target);
        }
        if (
          record.type === "attributes" && record.attributeName === "data-view"
        ) {
          for (
            const node of record.target.querySelectorAll(
              ".rule-library,.rule-editor",
            )
          ) {
            if (getComputedStyle(node).display !== "none" || cached.has(node)) {
              reveal(node);
            }
          }
        }
        if (record.type === "childList") {
          for (const node of record.addedNodes) {
            if (!(node instanceof HTMLElement) || node.dataset.uiExiting) {
              continue;
            }
            if (node.matches(".tab-detail,[data-ui-reveal]")) reveal(node);
            node.querySelectorAll(".tab-detail:not([hidden])").forEach(reveal);
          }
        }
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["hidden", "data-view", "open"],
    });
    reduced.addEventListener("change", () => {
      if (!reduced.matches) return;
      for (const [node, animation] of exitPaint) {
        animation.cancel();
        node.remove();
      }
      exitPaint.clear();
      for (const node of document.querySelectorAll(selectors)) {
        running.get(node)?.cancel();
        running.delete(node);
        clearExit(node);
      }
      for (const details of document.querySelectorAll("details")) {
        const state = disclosures.get(details);
        if (state?.animations.length) setDisclosure(details, state.open);
      }
    });
  }
  globalThis.ExtensionUI = { setDisclosure, capture, reveal, change, timing };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else mount();
})();
