/* =====================================================================
   lib.js - the small amount of plumbing every view needs.
   ===================================================================== */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Minimal element builder. h("div.card", {onclick}, child, child) */
export function h(spec, props = {}, ...children) {
  const [tagPart, ...classes] = String(spec).split(".");
  const el = document.createElement(tagPart || "div");
  if (classes.length) el.className = classes.join(" ");
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = [el.className, v].filter(Boolean).join(" ");
    else if (k === "html") el.innerHTML = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat(3)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const clear = (node) => {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
};

/* ------------------------------------------------------------------ api */

async function request(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      ...(opts.body && !(opts.body instanceof FormData) ? { "content-type": "application/json" } : {}),
      ...(opts.method && opts.method !== "GET" ? { "x-studio": "1" } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { ok: false, error: text.slice(0, 200) };
  }
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: "POST", body: JSON.stringify(body ?? {}) }),
  del: (p, body) => request(p, { method: "DELETE", body: JSON.stringify(body ?? {}) }),
  upload: (p, formData) => request(p, { method: "POST", body: formData }),
};

/* --------------------------------------------------------------- toasts */

export function toast(message, kind = "") {
  const t = h("div.toast" + (kind ? "." + kind : ""), {}, message);
  $("#toasts").append(t);
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transition = "opacity .3s";
    setTimeout(() => t.remove(), 320);
  }, kind === "bad" ? 8000 : 4200);
}

/* -------------------------------------------------------------- format */

export const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function fmtDate(v) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function fmtAgo(ts) {
  if (!ts) return "";
  const secs = Math.max(0, (Date.now() - Number(ts)) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days < 31) return `${days} day${days === 1 ? "" : "s"} ago`;
  return fmtDate(Number(ts));
}

export function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

export function daysUntil(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso ?? "")) return null;
  const d = new Date(iso + "T12:00:00");
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

export const fmtBytes = (n) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;

/** Job status vocabulary, in plain words. */
export const STATUS_LABEL = {
  drafted: "Draft ready",
  applied: "Applied",
  screening: "Screening",
  interview: "Interview",
  final_interview: "Final interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
  no_response: "No reply",
  withdrawn: "Withdrawn",
  offer_declined: "Turned down",
};

export const STATUS_KIND = {
  drafted: "accent",
  applied: "",
  screening: "accent",
  interview: "accent",
  final_interview: "accent",
  offer: "good",
  hired: "good",
  rejected: "bad",
  no_response: "",
  withdrawn: "",
  offer_declined: "warn",
};

export const statusChip = (norm) =>
  h("span.chip" + (STATUS_KIND[norm] ? "." + STATUS_KIND[norm] : ""), {}, STATUS_LABEL[norm] ?? norm ?? "unknown");

/* ------------------------------------------------------------ markdown */

/**
 * Escape first, then apply markdown. Nothing the agent (or a job posting it read)
 * emits can inject markup this way.
 */
export function markdown(src) {
  const lines = String(src ?? "").replace(/\r/g, "").split("\n");
  const out = [];
  let list = null;
  let table = null;
  let code = false;

  const inline = (s) =>
    escapeHtml(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer noopener">$2</a>');

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  const closeTable = () => {
    if (table) {
      out.push("</tbody></table>");
      table = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (/^```/.test(line)) {
      closeList();
      closeTable();
      out.push(code ? "</pre>" : "<pre>");
      code = !code;
      continue;
    }
    if (code) {
      out.push(escapeHtml(raw) + "\n");
      continue;
    }

    // Table rows
    if (/^\|.*\|$/.test(line)) {
      const cells = line.slice(1, -1).split("|").map((c) => c.trim());
      if (/^[\s|:-]+$/.test(line)) continue; // separator row
      closeList();
      if (!table) {
        out.push("<table><thead><tr>" + cells.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>");
        table = true;
      } else {
        out.push("<tr>" + cells.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>");
      }
      continue;
    }
    closeTable();

    if (!line.trim()) {
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      const lvl = Math.min(6, heading[1].length + 1);
      out.push(`<h${lvl}>${inline(heading[2])}</h${lvl}>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      closeList();
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      if (list !== "ul") {
        closeList();
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    if (/^\d+[.)]\s+/.test(line)) {
      if (list !== "ol") {
        closeList();
        out.push("<ol>");
        list = "ol";
      }
      out.push(`<li>${inline(line.replace(/^\d+[.)]\s+/, ""))}</li>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line)) {
      closeList();
      out.push("<hr>");
      continue;
    }

    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  closeTable();
  if (code) out.push("</pre>");
  return out.join("");
}

export const mdBlock = (src, cls = "markdown") => h("div." + cls, { html: markdown(src) });

/* ------------------------------------------------------------- helpers */

export const empty = (icon, title, note, action) =>
  h("div.empty", {}, h("span.empty-icon", {}, icon), h("h3", {}, title), note && h("p.sub", {}, note), action);

export function confirmish(message) {
  return window.confirm(message);
}

/** Open a workspace file: PDFs inline, text as text. */
export function fileUrl(path, download = false) {
  return `/api/file?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;
}
