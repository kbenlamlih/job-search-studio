/* =====================================================================
   charts.js - inline SVG charts, no library.

   Rules followed from the house data-viz method: one axis, thin marks,
   4px rounded data-ends anchored to the baseline, a 2px surface gap between
   adjacent fills, recessive grid, selective direct labels (never one per
   point on a dense axis), a hover tooltip on every mark, and a single
   sequential/ordinal blue hue rather than a rainbow. Colour comes from the CSS
   custom properties in style.css so light and dark are each selected, not flipped.
   ===================================================================== */

import { h } from "./lib.js";

const NS = "http://www.w3.org/2000/svg";

function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    el.setAttribute(k, String(v));
  }
  for (const kid of kids.flat(2)) if (kid) el.append(kid);
  return el;
}

const text = (str, attrs) => s("text", attrs, document.createTextNode(String(str)));

/* ------------------------------------------------------------- tooltip */

let tipEl = null;
function tip() {
  if (!tipEl) {
    tipEl = h("div.tooltip");
    document.body.append(tipEl);
  }
  return tipEl;
}

function hoverable(node, label) {
  node.classList.add("mark");
  node.addEventListener("mousemove", (e) => {
    const t = tip();
    t.innerHTML = label;
    t.classList.add("on");
    const pad = 14;
    t.style.left = `${Math.min(e.clientX + pad, window.innerWidth - t.offsetWidth - 8)}px`;
    t.style.top = `${Math.max(8, e.clientY - t.offsetHeight - 10)}px`;
  });
  node.addEventListener("mouseleave", () => tip().classList.remove("on"));
  return node;
}

/** Rounded only on the value end, square where it meets the baseline. */
function barPathH(x, y, w, hgt, r) {
  const rr = Math.max(0, Math.min(r, w, hgt / 2));
  if (w <= 0.5) return `M${x} ${y} h0.5 v${hgt} h-0.5 Z`;
  return `M${x} ${y} h${w - rr} a${rr} ${rr} 0 0 1 ${rr} ${rr} v${hgt - 2 * rr} a${rr} ${rr} 0 0 1 ${-rr} ${rr} h${-(w - rr)} Z`;
}

function barPathV(x, y, w, hgt, r) {
  const rr = Math.max(0, Math.min(r, w / 2, hgt));
  if (hgt <= 0.5) return `M${x} ${y + hgt} h${w} v0.5 h${-w} Z`;
  return `M${x} ${y + rr} a${rr} ${rr} 0 0 1 ${rr} ${-rr} h${w - 2 * rr} a${rr} ${rr} 0 0 1 ${rr} ${rr} v${hgt - rr} h${-w} Z`;
}

const ORD = ["var(--ord-1)", "var(--ord-2)", "var(--ord-3)", "var(--ord-4)", "var(--ord-5)"];

/* --------------------------------------------------------------- funnel */

/**
 * The application funnel. Ordinal, so it uses stepped shades of one hue,
 * darkest at the top of the funnel. Every stage is direct-labelled - there are
 * only five of them, and the count is the whole point.
 */
export function funnel(stages) {
  const rowH = 34;
  const gap = 8;
  const labelW = 128;
  const width = 620;
  const height = stages.length * (rowH + gap);
  const max = Math.max(1, ...stages.map((st) => st.value));
  const plotW = width - labelW - 56;

  const svg = s("svg", {
    class: "chart",
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": `Application funnel: ${stages.map((st) => `${st.label} ${st.value}`).join(", ")}`,
    preserveAspectRatio: "xMinYMin meet",
  });

  stages.forEach((st, i) => {
    const y = i * (rowH + gap);
    const w = (st.value / max) * plotW;
    svg.append(
      text(st.label, { x: labelW - 10, y: y + rowH / 2 + 4, "text-anchor": "end", class: "axis-label" }),
      s("line", { x1: labelW, x2: labelW, y1: y, y2: y + rowH, class: "gridline" }),
    );
    if (st.value > 0) {
      svg.append(
        hoverable(
          s("path", {
            d: barPathH(labelW + 2, y + 4, Math.max(w, 3), rowH - 8, 4),
            fill: ORD[Math.min(i, ORD.length - 1)],
          }),
          `<strong>${st.value}</strong> ${st.label.toLowerCase()}${st.note ? `<br>${st.note}` : ""}`,
        ),
      );
    }
    svg.append(
      text(st.value, {
        x: labelW + 2 + Math.max(w, 3) + 8,
        y: y + rowH / 2 + 4,
        class: "value-label",
      }),
    );
  });

  return svg;
}

/* ------------------------------------------------------- horizontal bars */

/** Magnitude by identity: sorted descending, one hue, direct value labels. */
export function barsH(items, { max = null, unit = "", color = "var(--series-1)", labelW = 140 } = {}) {
  const rows = items.filter((i) => i.value > 0);
  if (!rows.length) return h("p.muted.small", {}, "Nothing to show yet.");
  const rowH = 26;
  const gap = 6;
  const width = 620;
  const height = rows.length * (rowH + gap);
  const top = max ?? Math.max(...rows.map((r) => r.value));
  const plotW = width - labelW - 50;

  const svg = s("svg", {
    class: "chart",
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": rows.map((r) => `${r.label}: ${r.value}`).join(", "),
    preserveAspectRatio: "xMinYMin meet",
  });

  rows.forEach((r, i) => {
    const y = i * (rowH + gap);
    const w = Math.max((r.value / top) * plotW, 3);
    svg.append(
      text(truncate(r.label, 22), { x: labelW - 10, y: y + rowH / 2 + 4, "text-anchor": "end", class: "axis-label" }),
      hoverable(
        s("path", { d: barPathH(labelW, y + 3, w, rowH - 6, 4), fill: color }),
        `<strong>${r.label}</strong><br>${r.value}${unit ? " " + unit : ""}`,
      ),
      text(r.value, { x: labelW + w + 8, y: y + rowH / 2 + 4, class: "value-label" }),
    );
  });
  return svg;
}

/* --------------------------------------------------------- vertical bars */

/** Counts over time. Discrete months, so bars rather than a line. */
export function barsV(items, { color = "var(--series-1)", unit = "" } = {}) {
  if (!items.length) return h("p.muted.small", {}, "Nothing to show yet.");
  const width = 620;
  const height = 190;
  const padL = 30;
  const padB = 26;
  const padT = 12;
  const top = Math.max(1, ...items.map((i) => i.value));
  const bw = Math.min(46, (width - padL - 10) / items.length - 6);
  const step = (width - padL - 10) / items.length;

  const svg = s("svg", {
    class: "chart",
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": items.map((i) => `${i.label}: ${i.value}`).join(", "),
    preserveAspectRatio: "xMinYMin meet",
  });

  // Two gridlines only: the axis and the top. More is noise at this size.
  const plotH = height - padB - padT;
  for (const frac of [0, 0.5, 1]) {
    const y = padT + plotH * (1 - frac);
    svg.append(
      s("line", { x1: padL, x2: width - 6, y1: y, y2: y, class: "gridline" }),
      text(Math.round(top * frac), { x: padL - 8, y: y + 4, "text-anchor": "end", class: "axis-label" }),
    );
  }

  items.forEach((it, i) => {
    const x = padL + i * step + (step - bw) / 2;
    const bh = (it.value / top) * plotH;
    if (it.value > 0) {
      svg.append(
        hoverable(
          s("path", { d: barPathV(x, padT + plotH - bh, bw, bh, 4), fill: color }),
          `<strong>${it.value}</strong>${unit ? " " + unit : ""}<br>${it.full ?? it.label}`,
        ),
      );
    }
    // Label every bar when there is room, otherwise every other one.
    if (items.length <= 8 || i % 2 === 0) {
      svg.append(
        text(it.label, { x: x + bw / 2, y: height - 8, "text-anchor": "middle", class: "axis-label" }),
      );
    }
  });
  return svg;
}

/* ------------------------------------------------------------ score bar */

/** A single 0-100 fit score, drawn as a thin meter with its number beside it. */
export function scoreMeter(score) {
  const width = 120;
  const height = 8;
  const v = Math.max(0, Math.min(100, Number(score) || 0));
  const color = v >= 75 ? "var(--good)" : v >= 55 ? "var(--series-1)" : v >= 40 ? "var(--warning)" : "var(--muted)";
  // The inline style is load-bearing: `.chart { width: 100% }` in the stylesheet
  // would otherwise stretch this meter and wrap its number onto the next line.
  const svg = s("svg", {
    class: "chart",
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    style: `width:${width}px;height:${height}px;flex:none`,
    "aria-hidden": "true",
  });
  svg.append(
    s("path", { d: barPathH(0, 0, width, height, 4), fill: "var(--grid)" }),
    s("path", { d: barPathH(0, 0, Math.max((v / 100) * width, 4), height, 4), fill: color }),
  );
  return h(
    "span.row",
    { style: "gap:8px;flex-wrap:nowrap", title: `Fit score ${Math.round(v)} out of 100` },
    svg,
    h("span.small.tabular", {}, `${Math.round(v)}`),
  );
}

const truncate = (str, n) => (String(str).length > n ? String(str).slice(0, n - 1) + "…" : String(str));

export { truncate };
