import { permissionOrigin } from "./endpoint.js";
import { parseUseTargetInput } from "./use-target.js";
import { targetMessage } from "./use-target-copy.js";

export function mountUseTargetUi(
  {
    api,
    host,
    prefix,
    message = (key) => targetMessage(api, key),
    openImport = false,
  },
) {
  if (!host) return;
  const box = document.createElement("section");
  box.className = "stack use-target-controls";
  box.style.cssText = "display:grid;gap:6px;min-width:0;margin:8px 0";
  const label = document.createElement("label");
  const select = document.createElement("select");
  label.textContent = message("targetLabel");
  select.setAttribute("aria-label", message("targetLabel"));
  select.style.cssText = "width:100%;max-width:100%;min-width:0";
  const status = document.createElement("small");
  status.className = "muted";
  status.style.overflowWrap = "anywhere";
  status.setAttribute("role", "status");
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = message("targetAddress");
  const input = document.createElement("input");
  input.type = "text";
  input.style.cssText =
    "display:block;width:100%;margin:6px 0;font:inherit;color:inherit;background:Canvas;border:1px solid GrayText;border-radius:6px;padding:6px";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", message("targetAddress"));
  input.placeholder = message("targetAddress");
  const verify = document.createElement("button");
  verify.type = "button";
  verify.textContent = message("targetVerify");
  const hint = document.createElement("small");
  hint.className = "muted";
  hint.textContent = message(openImport ? "targetExportHint" : "targetFuture");
  const link = document.createElement("a");
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = message("targetOpen");
  link.hidden = !openImport;
  details.append(summary, input, verify, hint);
  box.append(label, select, status, details, link);
  host.append(box);
  function failure(error) {
    const reason = error instanceof Error ? error.message : "";
    const key = /credentials|profile|JSON|origin|address/.test(reason)
      ? "targetProfileError"
      : /Pair this exact|pairing|session/i.test(reason)
      ? "targetPairRequired"
      : /different capture dataset|scope mismatch/.test(reason)
      ? "targetDatasetMismatch"
      : /read-only follower/.test(reason)
      ? "targetFollower"
      : /permission|Website permission/.test(reason)
      ? "targetPermissionDenied"
      : "targetUnavailable";
    status.textContent = `${message("targetFailed")} · ${message(key)}`;
    status.title = reason;
  }
  let current = null, pending = false;
  async function send(action, values = {}) {
    const reply = await api.runtime.sendMessage({
      type: `${prefix}${action}`,
      ...values,
    });
    if (reply?.accepted === false || reply?.ok === false) {
      throw new Error(reply.message || reply.error || message("targetFailed"));
    }
    return prefix === "target-" ? reply.result : reply;
  }
  async function refresh() {
    try {
      current = await send("status");
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = message("targetChoose");
      select.replaceChildren(
        empty,
        ...current.profiles.map((profile) => {
          const option = document.createElement("option");
          option.value = profile.origin;
          option.textContent = `${profile.label} · ${profile.origin}`;
          return option;
        }),
      );
      select.value = current.selected?.origin ?? "";
      status.removeAttribute("title");
      const role = current.selected?.role;
      const roleText = message(
        role === "writer"
          ? "targetRoleWriter"
          : role === "follower"
          ? "targetRoleFollower"
          : "targetRoleUnknown",
      );
      status.textContent = `${
        current.selected?.label ?? current.origin
      } · ${roleText}${
        current.selected?.verified_at
          ? ` · ${message("targetVerified")} ${
            new Date(current.selected.verified_at).toLocaleString()
          }`
          : ""
      }`;
      if (current.mode === "local" && (current.writer || current.writerError)) {
        status.textContent = current.writer
          ? `${targetMessage(api, "targetFollowsWriter")}: ${current.writer.label} · ${targetMessage(api, "targetConnection")}: ${current.selected?.label ?? current.origin}`
          : targetMessage(api, "targetWriterPending");
      }
      link.hidden = !openImport || !current.selected;
      if (current.selected) {
        link.href = `${current.selected.origin}/?view=entries`;
      }
      if (!input.value) input.value = current.origin;
    } catch (error) {
      failure(error);
    }
  }
  async function change(value, selected) {
    if (pending) return;
    pending = true;
    select.disabled = verify.disabled = true;
    try {
      const origin = selected ? value : parseUseTargetInput(value).apiBase;
      if (
        !api.permissions?.request ||
        !await api.permissions.request({ origins: [permissionOrigin(origin)] })
      ) throw new Error("Website permission was not granted");
      await send(
        selected ? "select" : "configure",
        selected ? { origin } : { value },
      );
      await refresh();
      dispatchEvent(new Event("capture-route-changed"));
    } catch (error) {
      select.value = current?.selected?.origin ?? "";
      failure(error);
    } finally {
      pending = false;
      select.disabled = verify.disabled = false;
    }
  }
  select.addEventListener("change", () => {
    if (select.value) void change(select.value, true);
  });
  verify.addEventListener("click", () => void change(input.value, false));
  addEventListener("capture-route-changed", () => void refresh());
  void refresh();
}
