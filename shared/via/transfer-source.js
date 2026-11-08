// Source for the identical, inline transfer helper in both standalone scripts.
// No network requests, credentials, automatic destination changes or deletions.
(() => {
  const MAX_ITEMS = 64;
  const MAX_BYTES = 512 * 1024;
  const SITE = "https://prometheus.cupofcup.chatgpt.site";
  const TARGETS = ["termux", "mac", "site"];
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const size = (value) =>
    new TextEncoder().encode(JSON.stringify(value)).length;
  function uuid() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
      hex.slice(16, 20)
    }-${hex.slice(20)}`;
  }
  function validateOrigin(value) {
    if (
      typeof value !== "string" || value.length > 2048 ||
      !/^https?:\/\/[^/?#]+\/?$/i.test(value) || /[\s\\]/u.test(value)
    ) throw new Error("Invalid origin");
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const parts = host.split(".").map(Number);
    const privateHost = host === "localhost" || host === "::1" ||
      /^(?:fc|fd)[0-9a-f]{2}:|^fe[89ab][0-9a-f]:/i.test(host) ||
      parts.length === 4 &&
        parts.every((part) =>
          Number.isInteger(part) && part >= 0 && part <= 255
        ) &&
        (parts[0] === 127 || parts[0] === 10 ||
          parts[0] === 192 && parts[1] === 168 ||
          parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 ||
          parts[0] === 169 && parts[1] === 254);
    if (
      url.username || url.password || url.pathname !== "/" || url.search ||
      url.hash ||
      url.protocol === "http:" && !privateHost
    ) throw new Error("Invalid origin");
    return url.origin;
  }
  function validScope(scope) {
    if (scope === null) return null;
    const fields = ["owner_id", "dataset_id", "replica_id", "authority"];
    if (
      !scope ||
      fields.some((field) =>
        typeof scope[field] !== "string" || !scope[field] ||
        Array.from(scope[field] ?? "").some((character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
        ) ||
        scope[field].length > 128
      ) ||
      !["local", "cloud"].includes(scope.authority) ||
      scope.dataset_epoch !== undefined &&
        (typeof scope.dataset_epoch !== "string" || !scope.dataset_epoch ||
          scope.dataset_epoch.length > 128)
    ) throw new Error("Invalid identity scope");
    return Object.fromEntries(
      [...fields, "dataset_epoch"].filter((field) => scope[field] !== undefined)
        .map((field) => [field, scope[field]]),
    );
  }
  function profile(target, value, enforceRoute = true) {
    if (!TARGETS.includes(target)) throw new Error("Invalid target");
    const origin = validateOrigin(value.origin);
    const host = new URL(origin).hostname.replace(/^\[|\]$/g, "");
    const loopback = host === "localhost" || host === "::1" ||
      /^127\./.test(host);
    if (
      enforceRoute &&
        (target === "termux" && !loopback || target === "mac" && loopback) ||
      target === "site" && origin !== SITE ||
      target !== "site" && !origin.startsWith("http://")
    ) throw new Error("Target origin mismatch");
    const scope = validScope(value.scope ?? null);
    if (scope && scope.authority !== (target === "site" ? "cloud" : "local")) {
      throw new Error("Target authority mismatch");
    }
    return { origin, scope };
  }
  function parseProfile(target, value) {
    let input = value;
    if (typeof input === "string" && input.trim().startsWith("{")) {
      input = JSON.parse(input);
    }
    if (typeof input === "string") {
      return profile(target, { origin: input, scope: null });
    }
    if (
      input?.version !== 1 || !input.endpoints || !input.identity ||
      typeof input.capabilities?.capture?.available !== "boolean"
    ) throw new Error("Invalid Server Info");
    const saved = profile(target, {
      origin: input.endpoints.api_base,
      scope: input.identity,
    });
    if (input.origin && validateOrigin(input.origin) !== saved.origin) {
      throw new Error("Descriptor origin mismatch");
    }
    return saved;
  }
  function defaultState() {
    return {
      version: 1,
      selected: "termux",
      profiles: {
        termux: { origin: "http://localhost:10012", scope: null },
        mac: { origin: "", scope: null },
        site: { origin: SITE, scope: null },
      },
      items: [],
    };
  }
  function receiverUrl(origin) {
    return validateOrigin(origin) + "/capture";
  }
  function validateEnvelope(envelope, retained = false) {
    if (
      !envelope || envelope.schema !== "prometheus.via.capture.v1" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        envelope.operation_id,
      ) ||
      !["via-bookmark", "via-calmly"].includes(envelope.source) ||
      !["bookmark", "entry"].includes(envelope.kind) ||
      !Number.isFinite(Date.parse(envelope.captured_at))
    ) throw new Error("Invalid capture");
    const destination = profile(
      envelope.destination?.target,
      envelope.destination ?? {},
      !retained,
    );
    if (destination.origin !== envelope.destination.origin) {
      throw new Error("Noncanonical destination");
    }
    const payload = envelope.payload;
    if (
      typeof payload?.url !== "string" || payload.url.length > 4096 ||
      payload.url !== payload.url.trim() || payload.url.includes("\0")
    ) throw new Error("Invalid source URL");
    const url = new URL(payload?.url);
    if (
      !["http:", "https:"].includes(url.protocol) || url.username ||
      url.password
    ) throw new Error("Invalid source URL");
    if (envelope.kind === "entry") {
      if (
        envelope.source !== "via-calmly" || typeof payload.text !== "string" ||
        !payload.text.trim() || payload.text.length > 100000 ||
        payload.text.includes("\0") ||
        ["title", "author"].some((field) =>
          payload[field] !== undefined &&
          (typeof payload[field] !== "string" || payload[field].length > 1000 ||
            payload[field].includes("\0"))
        )
      ) throw new Error("Invalid entry");
    } else if (
      envelope.source !== "via-bookmark" ||
      payload.schema !== "prometheus.bookmark.v1" ||
      typeof payload.title !== "string" || payload.title.length > 1000 ||
      payload.title.includes("\0") || typeof payload.tag_id !== "string" ||
      !payload.tag_id || payload.tag_id.length > 100 ||
      payload.tag_id.includes("\0") ||
      !["active", "archived"].includes(payload.status) ||
      !["sfw", "nsfw"].includes(payload.visibility) ||
      payload.source !== "via" ||
      !Number.isFinite(Date.parse(payload.captured_at))
    ) throw new Error("Invalid bookmark");
    if (size(envelope) > MAX_BYTES) throw new Error("Queue capacity exceeded");
    return envelope;
  }
  function checkState(state) {
    if (
      !state || state.version !== 1 || !TARGETS.includes(state.selected) ||
      !Array.isArray(state.items) || state.items.length > MAX_ITEMS ||
      size(state) > MAX_BYTES
    ) throw new Error("Invalid or full queue storage");
    for (const target of TARGETS) {
      // Existing routes are immutable evidence; stricter routing applies to new captures.
      const saved = state.profiles?.[target];
      if (target === "mac" && saved?.origin === "" && saved.scope === null) continue;
      profile(target, saved ?? {}, false);
    }
    const ids = new Set();
    for (const item of state.items) {
      validateEnvelope(item.envelope, true);
      if (
        !["pending", "saved", "cancelled"].includes(item.status) ||
        ids.has(item.envelope.operation_id)
      ) throw new Error("Invalid queue item");
      ids.add(item.envelope.operation_id);
      if (item.status === "saved" && !validateAck(item.ack, item.envelope)) {
        throw new Error("Invalid retained acknowledgement");
      }
    }
    return state;
  }
  function addIntent(state, input) {
    if (state.items.length >= MAX_ITEMS) {
      throw new Error("Queue full; original captures retained");
    }
    const next = copy(checkState(state));
    if (!next.profiles[next.selected].origin) throw new Error("Configure target origin first");
    const envelope = validateEnvelope({
      schema: "prometheus.via.capture.v1",
      operation_id: uuid(),
      source: input.source,
      kind: input.kind,
      captured_at: input.kind === "bookmark"
        ? input.payload.captured_at
        : new Date().toISOString(),
      destination: {
        target: next.selected,
        ...copy(next.profiles[next.selected]),
      },
      payload: copy(input.payload),
    });
    next.items.push({ envelope, status: "pending" });
    if (size(next) > MAX_BYTES) {
      throw new Error("Queue full; original captures retained");
    }
    return next;
  }
  function retryEnvelope(state, id) {
    const item = state.items.find((item) => item.envelope.operation_id === id);
    if (!item || item.status !== "pending") {
      throw new Error("Capture unavailable, saved or cancelled");
    }
    return copy(item.envelope);
  }
  function cancelIntent(state, id) {
    const next = copy(state),
      item = next.items.find((item) => item.envelope.operation_id === id);
    if (!item) throw new Error("Unknown capture");
    if (item.status === "saved") {
      throw new Error(
        "Already acknowledged; cancellation cannot undo a saved write",
      );
    }
    item.status = "cancelled";
    return next;
  }
  function validateAck(ack, envelope) {
    try {
      const exact = (value, required, optional = []) =>
        !!value && typeof value === "object" && !Array.isArray(value) &&
        required.every((key) => Object.hasOwn(value, key)) &&
        Object.keys(value).every((key) =>
          required.includes(key) || optional.includes(key)
        );
      if (
        !exact(ack, [
          "schema",
          "operation_id",
          "destination",
          "result",
          "status",
        ]) ||
        !exact(ack.destination, [
          "origin",
          "owner_id",
          "dataset_id",
          "replica_id",
          "authority",
        ], ["dataset_epoch"]) || !exact(ack.result, ["id", "revision"])
      ) return false;
      if (
        !ack || ack.schema !== "prometheus.via.receipt.v1" ||
        ack.status !== "saved" ||
        ack.operation_id !== envelope.operation_id ||
        ack.destination?.origin !== envelope.destination.origin ||
        typeof ack.result?.id !== "string" || !ack.result.id ||
        ack.result.id.length > 256 ||
        !Number.isSafeInteger(ack.result.revision) || ack.result.revision < 1
      ) return false;
      const scope = validScope(ack.destination);
      const bound = envelope.destination.scope;
      return !!scope && scope.authority ===
          (envelope.destination.target === "site" ? "cloud" : "local") &&
        (!bound ||
          ["owner_id", "dataset_id", "replica_id", "authority", "dataset_epoch"]
            .every((key) => scope[key] === bound[key]));
    } catch {
      return false;
    }
  }
  function validEventAck(event, opened, envelope) {
    return !!opened && event.source === opened &&
      event.origin === envelope.destination.origin &&
      validateAck(event.data, envelope);
  }
  function createStore(read, write) {
    let tail = Promise.resolve();
    const load = async () => {
      const raw = await read();
      return raw === undefined || raw === null || raw === ""
        ? defaultState()
        : checkState(JSON.parse(raw));
    };
    const change = (apply) => {
      const result = tail.then(async () => {
        const state = await load(),
          next = apply(state),
          bytes = JSON.stringify(checkState(next));
        await write(bytes);
        if (await read() !== bytes) {
          throw new Error("Capture storage readback failed");
        }
        return copy(next);
      });
      tail = result.catch(() => {});
      return result;
    };
    return {
      load,
      configure: (target, value) =>
        change((state) => ({
          ...state,
          selected: target,
          profiles: { ...state.profiles, [target]: profile(target, value) },
        })),
      enqueue: async (input, route) => {
        const next = await change((state) => {
          if (route) {
            state = {
              ...state,
              selected: route.target,
              profiles: {
                ...state.profiles,
                [route.target]: profile(route.target, route.profile),
              },
            };
          }
          return addIntent(state, input);
        });
        return copy(next.items.at(-1).envelope);
      },
      cancel: (id) => change((state) => cancelIntent(state, id)),
      acknowledge: (ack, source) =>
        change((state) => {
          if (!["manual", "window"].includes(source)) {
            throw new Error("Invalid acknowledgement source");
          }
          const next = copy(state),
            item = next.items.find((item) =>
              item.envelope.operation_id === ack?.operation_id
            );
          if (!item || !validateAck(ack, item.envelope)) {
            throw new Error("Acknowledgement does not match original capture");
          }
          if (item.ack) {
            const same = [
              "origin",
              "owner_id",
              "dataset_id",
              "replica_id",
              "authority",
              "dataset_epoch",
            ]
              .every((key) =>
                item.ack.destination[key] === ack.destination[key]
              ) &&
              item.ack.result.id === ack.result.id &&
              item.ack.result.revision === ack.result.revision;
            if (!same) {
              throw new Error("Conflicting acknowledgement; original retained");
            }
            return next;
          }
          // A saved server acknowledgement may arrive after local cancellation.
          item.status = "saved";
          item.ack = copy(ack);
          item.ack_source = source;
          return next;
        }),
    };
  }

  const words = {
    en: {
      send: "Send to Prometheus",
      target: "Destination",
      origin: "Origin or Server Info",
      save: "Save destination",
      unverified: "Unverified · receiver checks identity before saving",
      descriptor: "Descriptor imported · receiver must verify current identity",
      queued: "Queued; paste and review in the receiver",
      copy: "Copy + Open",
      retry: "Copy + Open again",
      cancel: "Cancel intent",
      cancelled: "Cancelled; a server write is not undone",
      receipt: "Paste receipt",
      confirm: "Confirm supplied receipt",
      manual: "User-supplied acknowledgement; original retained",
      saved: "Receiver acknowledgement; original retained",
      close: "Close",
      pending: "Pending",
      busy: "Preparing capture; wait for completion",
      original: "Original destination",
      future:
        "Destination changes apply only to new captures; reopen the source transfer action to start one",
      history: "Retained captures",
      suggestion: "Mac address is a suggestion; verify its current LAN origin",
      blocked: "Open blocked; tap Copy + Open again",
      storage: "VIA script storage is unavailable",
      invalidOrigin:
        "Use a bare private HTTP origin or the configured HTTPS Site; check identity and target",
      invalidCapture: "Capture is empty or invalid; original queue is retained",
      invalidReceipt:
        "Receipt does not match the original capture, origin and identity",
      capacity: "Queue capacity reached; original captures are retained",
      copyError: "Copy failed; a queued original remains available for retry",
      cancelledState: "Cancelled",
      savedState: "Saved",
      unknownError: "Action failed; original captures are retained",
    },
    "zh-TW": {
      send: "傳送至 Prometheus",
      target: "目的地",
      origin: "Origin 或 Server Info",
      save: "儲存目的地",
      unverified: "未驗證 · 接收頁儲存前會核對身分",
      descriptor: "已匯入描述 · 接收頁仍須驗證目前身分",
      queued: "已排隊，請在接收頁貼上並檢視",
      copy: "複製並開啟",
      retry: "重新複製並開啟",
      cancel: "取消意圖",
      cancelled: "已取消；不會撤銷伺服器寫入",
      receipt: "貼上回條",
      confirm: "確認提供的回條",
      manual: "使用者提供的確認；原始內容已保留",
      saved: "接收頁確認；原始內容已保留",
      close: "關閉",
      pending: "待處理",
      busy: "正在準備擷取，請等待完成",
      original: "原始目的地",
      future: "目的地變更只套用新擷取；請重新開啟來源傳送入口來建立",
      history: "保留的擷取",
      suggestion: "Mac 位址僅供參考；請核對目前 LAN origin",
      blocked: "開啟被擋，請再點複製並開啟",
      storage: "VIA 腳本儲存不可用",
      invalidOrigin:
        "請填入私有 HTTP origin 或既定 HTTPS Site，並核對身分與目的地",
      invalidCapture: "擷取內容空白或無效；原始佇列已保留",
      invalidReceipt: "回條與原始擷取、origin 或身分不符",
      capacity: "佇列容量已滿；原始擷取已保留",
      copyError: "複製失敗；已排隊的原始內容仍可重試",
      cancelledState: "已取消",
      savedState: "已儲存",
      unknownError: "操作失敗；原始擷取已保留",
    },
    "zh-CN": {
      send: "发送至 Prometheus",
      target: "目的地",
      origin: "Origin 或 Server Info",
      save: "保存目的地",
      unverified: "未验证 · 接收页保存前会核对身份",
      descriptor: "已导入描述 · 接收页仍须验证当前身份",
      queued: "已排队，请在接收页粘贴并检查",
      copy: "复制并打开",
      retry: "重新复制并打开",
      cancel: "取消意图",
      cancelled: "已取消；不会撤销服务器写入",
      receipt: "粘贴回执",
      confirm: "确认提供的回执",
      manual: "用户提供的确认；原始内容已保留",
      saved: "接收页确认；原始内容已保留",
      close: "关闭",
      pending: "待处理",
      busy: "正在准备采集，请等待完成",
      original: "原始目的地",
      future: "目的地变更仅用于新采集；请重新打开来源发送入口来创建",
      history: "保留的采集",
      suggestion: "Mac 地址仅供参考；请核对当前 LAN origin",
      blocked: "打开被阻止，请再次点击复制并打开",
      storage: "VIA 脚本存储不可用",
      invalidOrigin:
        "请填入私有 HTTP origin 或既定 HTTPS Site，并核对身份与目的地",
      invalidCapture: "采集内容为空或无效；原始队列已保留",
      invalidReceipt: "回执与原始采集、origin 或身份不符",
      capacity: "队列容量已满；原始采集已保留",
      copyError: "复制失败；已排队的原始内容仍可重试",
      cancelledState: "已取消",
      savedState: "已保存",
      unknownError: "操作失败；原始采集已保留",
    },
  };
  function labels(language) {
    const value = String(language ?? "en").toLowerCase();
    return value.startsWith("zh")
      ? words[value.includes("tw") || value.includes("hk") ? "zh-TW" : "zh-CN"]
      : words.en;
  }
  function createUi({ source, document, language }) {
    let t = labels(language);
    const key = `prometheus.via.transfer.${source}.v1`;
    function errorText(error) {
      const text = String(error?.message ?? "");
      if (text === t.storage || /storage|JSON/i.test(text)) return t.storage;
      if (/queue full|capacity/i.test(text)) return t.capacity;
      if (/acknowledgement|receipt/i.test(text)) return t.invalidReceipt;
      if (/origin|identity|target|descriptor|Server Info/i.test(text)) {
        return t.invalidOrigin;
      }
      if (/clipboard|copy/i.test(text)) return t.copyError;
      if (/capture|entry|bookmark|source URL|cancelled/i.test(text)) {
        return t.invalidCapture;
      }
      return t.unknownError;
    }
    const store = createStore(async () => {
      if (typeof GM_getValue !== "function") throw new Error(t.storage);
      return await Promise.resolve(GM_getValue(key, undefined));
    }, async (value) => {
      if (typeof GM_setValue !== "function") throw new Error(t.storage);
      await Promise.resolve(GM_setValue(key, value));
    });
    let currentInput, pendingId, root, ui, sending = false;
    const opened = new Map();
    function node(tag, text = "") {
      const result = document.createElement(tag);
      result.textContent = text;
      return result;
    }
    async function clipboard(bytes) {
      if (typeof GM_setClipboard === "function") {
        await Promise.resolve(GM_setClipboard(bytes, "text"));
      } else if (globalThis.navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(bytes);
      } else {
        const field = node("textarea");
        field.value = bytes;
        document.body.append(field);
        field.select();
        const success = document.execCommand?.("copy") === true;
        field.remove();
        if (!success) throw new Error("Clipboard unavailable");
      }
    }
    async function handoff(envelope, windowRef) {
      await clipboard(JSON.stringify(envelope));
      if (windowRef && !windowRef.closed) {
        opened.set(envelope.operation_id, windowRef);
        windowRef.location.href = receiverUrl(envelope.destination.origin);
        ui.message.textContent = t.queued;
      } else ui.message.textContent = t.blocked;
    }
    function openWindow() {
      return globalThis.open?.("about:blank", "_blank") ?? null;
    }
    async function render() {
      const state = await store.load();
      ui.target.value = state.selected;
      ui.origin.value = state.profiles[state.selected].origin;
      ui.verified.textContent = state.profiles[state.selected].scope
        ? t.descriptor
        : t.unverified;
      const current = state.items.find((item) =>
        item.envelope.operation_id === pendingId
      );
      ui.pinned.textContent = current
        ? `${t.original}: ${current.envelope.destination.target} · ${current.envelope.destination.origin}\n${t.future}`
        : "";
      ui.send.disabled = sending || !!current && current.status !== "pending";
      ui.send.textContent = current?.status === "saved"
        ? t.savedState
        : current?.status === "cancelled"
        ? t.cancelledState
        : current
        ? t.retry
        : t.copy;
      ui.list.replaceChildren();
      for (const item of [...state.items].reverse()) {
        const row = node("div");
        row.className = "item";
        row.append(
          node(
            "span",
            `${item.envelope.destination.target} · ${
              item.envelope.captured_at.slice(0, 16)
            } · ${
              item.status === "pending"
                ? t.pending
                : item.status === "saved"
                ? t.savedState
                : t.cancelledState
            }`,
          ),
        );
        if (item.status === "pending") {
          const retry = node("button", t.retry);
          retry.type = "button";
          retry.disabled = sending;
          retry.onclick = () => {
            if (sending) return;
            sending = true;
            pendingId = item.envelope.operation_id;
            ui.send.disabled = true;
            const ref = openWindow();
            void handoff(item.envelope, ref).catch((error) => {
              ref?.close();
              ui.message.textContent = errorText(error);
            }).finally(() => {
              sending = false;
              void render().catch((error) => {
                ui.message.textContent = errorText(error);
              });
            });
          };
          const cancel = node("button", t.cancel);
          cancel.type = "button";
          cancel.disabled = sending;
          cancel.onclick = () => {
            if (sending) return;
            void store.cancel(item.envelope.operation_id).then(render).then(
              () => {
                ui.message.textContent = t.cancelled;
              },
            ).catch((error) => {
              ui.message.textContent = errorText(error);
            });
          };
          row.append(retry, cancel);
        }
        if (item.ack) {
          row.append(
            node("small", item.ack_source === "manual" ? t.manual : t.saved),
          );
        }
        ui.list.append(row);
      }
    }
    function mount() {
      if (root) return;
      root = node("div");
      root.id = `prometheus-via-transfer-${source}`;
      const shadow = root.attachShadow({ mode: "open" });
      const style = node("style");
      style.textContent =
        ":host{all:initial;color-scheme:light dark}*{box-sizing:border-box}.sheet{position:fixed;z-index:2147483647;bottom:12px;left:50%;transform:translateX(-50%);width:min(350px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;background:#f7f7f7;color:#171717;border:1px solid #888;border-radius:14px;padding:12px;font:14px system-ui;box-shadow:0 8px 30px #0005}header{display:flex;align-items:center;justify-content:space-between}label{display:grid;gap:4px;margin:8px 0}button,input,select,textarea{font:inherit;color:inherit}input,select,textarea{width:100%;padding:7px;border:1px solid #8887;border-radius:7px;background:transparent}button{min-height:36px;background:transparent;border:1px solid #8887;border-radius:7px;padding:5px 8px;cursor:pointer}textarea{min-height:54px;resize:vertical}.primary{width:100%;margin:8px 0;background:#222;color:white}.hint,small{font-size:12px;line-height:1.4}.item{display:flex;gap:6px;flex-wrap:wrap;padding:8px 0;border-top:1px solid #8885}.item span,.item small{width:100%}.message{white-space:pre-wrap;font-size:12px}details{margin-top:8px}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #7b9cff;outline-offset:2px}@media(prefers-color-scheme:dark){.sheet{background:#222;color:#eee}.primary{background:#eee;color:#222}}";
      const sheet = node("section");
      sheet.className = "sheet";
      sheet.setAttribute("role", "dialog");
      sheet.setAttribute("aria-label", t.send);
      const header = node("header"), close = node("button", t.close);
      close.type = "button";
      close.onclick = () => root.remove();
      header.append(node("strong", t.send), close);
      const target = node("select");
      for (
        const [value, text] of [
          ["termux", "Android · Termux"],
          ["mac", "Mac"],
          ["site", "Site"],
        ]
      ) {
        const option = node("option", text);
        option.value = value;
        target.append(option);
      }
      const targetLabel = node("label", t.target);
      targetLabel.append(target);
      const origin = node("textarea");
      origin.setAttribute("aria-label", t.origin);
      const originLabel = node("label", t.origin);
      originLabel.append(origin);
      const save = node("button", t.save);
      save.type = "button";
      const verified = node("p");
      verified.className = "hint";
      const send = node("button", t.copy);
      send.type = "button";
      send.className = "primary";
      const pinned = node("p");
      pinned.className = "hint";
      const message = node("p");
      message.className = "message";
      message.setAttribute("role", "status");
      const receipts = node("details"),
        receipt = node("textarea"),
        confirm = node("button", t.confirm);
      receipt.setAttribute("aria-label", t.receipt);
      confirm.type = "button";
      receipts.append(node("summary", t.receipt), receipt, confirm);
      const history = node("details"), list = node("div");
      history.append(node("summary", t.history), list);
      sheet.append(
        header,
        targetLabel,
        originLabel,
        save,
        verified,
        pinned,
        send,
        message,
        receipts,
        history,
      );
      shadow.append(style, sheet);
      document.documentElement.append(root);
      ui = { target, origin, verified, pinned, send, message, list };
      target.onchange = () => {
        void store.load().then((state) => {
          origin.value = state.profiles[target.value].origin;
          verified.textContent = target.value === "mac"
            ? t.suggestion
            : state.profiles[target.value].scope
            ? t.descriptor
            : t.unverified;
        }).catch((error) => {
          message.textContent = errorText(error);
        });
      };
      save.onclick = () => {
        void (async () => {
          await store.configure(
            target.value,
            parseProfile(target.value, origin.value),
          );
          await render();
        })().catch((error) => {
          message.textContent = errorText(error);
        });
      };
      send.onclick = () => {
        if (sending || send.disabled) return;
        if (!currentInput) {
          message.textContent = t.invalidCapture;
          return;
        }
        sending = true;
        send.disabled = true;
        const input = copy(currentInput),
          retryId = pendingId,
          selectedTarget = target.value,
          selectedOrigin = origin.value;
        // Reserve the user-gesture window before asynchronous storage/clipboard.
        const ref = openWindow();
        void (async () => {
          let envelope;
          if (retryId) envelope = retryEnvelope(await store.load(), retryId);
          else {
            const saved = await store.load();
            const value =
              selectedOrigin === saved.profiles[selectedTarget].origin
                ? saved.profiles[selectedTarget]
                : parseProfile(selectedTarget, selectedOrigin);
            envelope = await store.enqueue(input, {
              target: selectedTarget,
              profile: value,
            });
          }
          pendingId = envelope.operation_id;
          await handoff(envelope, ref);
          await render();
        })().catch((error) => {
          ref?.close();
          message.textContent = errorText(error);
        }).finally(() => {
          sending = false;
          void render().catch((error) => {
            message.textContent = errorText(error);
          });
        });
      };
      confirm.onclick = () => {
        void (async () => {
          const ack = JSON.parse(receipt.value);
          await store.acknowledge(ack, "manual");
          receipt.value = "";
          await render();
          message.textContent = t.manual;
        })().catch((error) => {
          message.textContent = errorText(error);
        });
      };
    }
    globalThis.addEventListener?.("message", (event) => {
      if (event.data?.schema !== "prometheus.via.receipt.v1") return;
      void (async () => {
        const state = await store.load(),
          item = state.items.find((item) =>
            item.envelope.operation_id === event.data.operation_id
          );
        if (
          !item ||
          !validEventAck(
            event,
            opened.get(event.data.operation_id),
            item.envelope,
          )
        ) return;
        await store.acknowledge(event.data, "window");
        if (ui) {
          await render();
          ui.message.textContent = t.saved;
        }
      })().catch(
        () => {/* Unverified acknowledgement never changes status. */},
      );
    });
    return {
      async show(input, nextLanguage) {
        if (sending) {
          ui.message.textContent = t.busy;
          return;
        }
        if (nextLanguage !== undefined && labels(nextLanguage) !== t) {
          root?.remove();
          root = null;
          t = labels(nextLanguage);
        }
        currentInput = input;
        pendingId = null;
        mount();
        if (!root.isConnected) document.documentElement.append(root);
        await render();
      },
      async isReceiver(value) {
        try {
          const state = await store.load();
          return Object.values(state.profiles).some((saved) =>
            new URL(value).origin === saved.origin
          );
        } catch {
          return false;
        }
      },
    };
  }
  globalThis.PrometheusViaTransfer = {
    MAX_ITEMS,
    MAX_BYTES,
    validateOrigin,
    validScope,
    parseProfile,
    defaultState,
    receiverUrl,
    validateEnvelope,
    addIntent,
    retryEnvelope,
    cancelIntent,
    validateAck,
    validEventAck,
    createStore,
    createUi,
    labels,
  };
})();
