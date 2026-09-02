/* =====================================================================
   app.js - views, routing, and the live run console.
   ===================================================================== */

import {
  $, api, clear, daysUntil, empty, fileUrl, fmtAgo, fmtBytes, fmtDate, fmtDuration, h,
  markdown, mdBlock, statusChip, toast, STATUS_LABEL,
} from "./lib.js";
import { barsH, barsV, funnel, scoreMeter, truncate } from "./charts.js";

const state = {
  data: null,
  view: location.hash.slice(1) || "today",
  run: null,
  events: [],
  jobFilter: "unapplied",
  jobQuery: "",
  expanded: new Set(),
};

const VIEWS = [
  { id: "today", label: "Today", icon: "☀️", title: "Today", sub: "" },
  { id: "profile", label: "About me", icon: "🙋", title: "About me", sub: "Your documents and the profile Claude writes from" },
  { id: "jobs", label: "Jobs", icon: "🔎", title: "Jobs", sub: "Everything the search has found for you" },
  { id: "applications", label: "Applications", icon: "📄", title: "Applications", sub: "What you've sent, and what came back" },
  { id: "dashboard", label: "Progress", icon: "📊", title: "Progress", sub: "How the search is actually going" },
  { id: "learn", label: "Learn", icon: "🎓", title: "Learn", sub: "The skills worth picking up next" },
  { id: "settings", label: "Setup", icon: "⚙️", title: "Setup", sub: "Job boards, checks and extras" },
];

/* =====================================================================
   Boot
   ===================================================================== */

async function boot() {
  buildNav();
  wireConsole();
  wireTheme();
  await refresh();
  connectStream();
  window.addEventListener("hashchange", () => {
    state.view = location.hash.slice(1) || "today";
    render();
  });
  checkConnection();
}

async function refresh() {
  try {
    state.data = await api.get("/api/state");
  } catch (e) {
    toast(`Couldn't reach the app's own server: ${e.message}`, "bad");
    return;
  }
  buildNav();
  await render();
}

function buildNav() {
  const nav = clear($("#nav"));
  const c = state.data?.counts ?? {};
  const badges = { jobs: c.newJobs || 0, applications: c.open || 0 };
  for (const v of VIEWS) {
    const badge = badges[v.id];
    nav.append(
      h(
        "button",
        {
          "aria-current": String(state.view === v.id),
          onclick: () => {
            location.hash = v.id;
          },
        },
        h("span.nav-icon", {}, v.icon),
        h("span", {}, v.label),
        badge ? h("span.badge", {}, String(badge)) : null,
      ),
    );
  }
}

function wireTheme() {
  const stored = localStorage.getItem("studio-theme");
  if (stored) document.documentElement.dataset.theme = stored;
  const label = () => {
    const now = document.documentElement.dataset.theme;
    $("[data-theme-label]").textContent = now === "dark" ? "Light" : "Dark";
  };
  label();
  $("#theme-toggle").onclick = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("studio-theme", next);
    label();
    render();
  };
}

async function checkConnection() {
  const el = $("#conn");
  el.textContent = "checking…";
  try {
    const r = await api.post("/api/doctor/test");
    el.innerHTML = r.ok ? "🟢 Claude ready" : "🔴 not signed in";
    el.title = r.message ?? "";
    if (!r.ok) toast(r.message, "bad");
  } catch {
    el.innerHTML = "🔴 offline";
  }
}

/* =====================================================================
   Run console
   ===================================================================== */

let timerHandle = null;
let currentBubble = null;
let currentText = "";

function wireConsole() {
  $("#console-toggle").onclick = () => {
    const c = $("#console");
    c.classList.toggle("collapsed");
    $("#console-toggle").setAttribute("aria-expanded", String(!c.classList.contains("collapsed")));
  };
  $("#reply-send").onclick = sendReply;
  $("#reply-input").addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === "Return") && !e.shiftKey) {
      e.preventDefault();
      sendReply();
    }
  });
  $("#run-finish").onclick = async () => {
    await api.post("/api/runs/finish");
    await refresh();
  };
  const stop = async () => {
    await api.post("/api/runs/stop");
    toast("Stopped.");
    await refresh();
  };
  $("#run-stop").onclick = stop;
  $("#run-stop-2").onclick = stop;
  $("#run-continue").onclick = async () => {
    try {
      await api.post("/api/runs/reply", {
        text: "Continue the workflow from exactly where you left off, without repeating work you have already done. If the task is complete, say so and end with [DONE].",
      });
    } catch (e) {
      toast(e.message, "bad");
    }
  };
}

async function sendReply() {
  const box = $("#reply-input");
  const text = box.value.trim();
  if (!text) return;
  box.value = "";
  try {
    await api.post("/api/runs/reply", { text });
  } catch (e) {
    toast(e.message, "bad");
    box.value = text;
  }
}

function connectStream() {
  const es = new EventSource("/api/runs/stream");
  es.addEventListener("run", (m) => {
    const snap = JSON.parse(m.data);
    state.run = snap.run;
    state.events = snap.events ?? [];
    redrawConsole();
    paintRunState();
  });
  es.addEventListener("event", (m) => {
    const stored = JSON.parse(m.data);
    state.events.push(stored);
    appendEvent(stored.e);
  });
  es.addEventListener("documents", () => refresh());
  es.onerror = () => {
    /* EventSource retries by itself */
  };
}

function paintRunState() {
  const run = state.run;
  const dot = $("#console-dot");
  const title = $("#console-title");
  const status = run?.status;
  dot.className = "dot " + (status === "running" ? "run" : status === "waiting" ? "wait" : status === "error" ? "err" : status === "done" ? "ok" : "idle");
  title.textContent = run
    ? status === "running"
      ? `${run.title}…`
      : status === "waiting"
        ? `${run.title} - your turn`
        : status === "error"
          ? `${run.title} - hit a problem`
          : `${run.title} - finished`
    : "Nothing running";

  $("#console-reply").hidden = status !== "waiting";
  $("#console-running").hidden = status !== "running";

  if (status === "waiting") {
    $("#console").classList.remove("collapsed");
    $("#console-toggle").setAttribute("aria-expanded", "true");
    setTimeout(() => $("#reply-input")?.focus(), 60);
  }

  clearInterval(timerHandle);
  if (run && (status === "running" || status === "waiting")) {
    const tick = () => ($("#console-timer").textContent = fmtDuration(Date.now() - run.startedAt));
    tick();
    timerHandle = setInterval(tick, 1000);
  } else {
    $("#console-timer").textContent = run?.endedAt ? fmtDuration(run.endedAt - run.startedAt) : "";
  }
  document.querySelectorAll("[data-needs-idle]").forEach((b) => {
    b.disabled = !!run && (status === "running" || status === "waiting");
  });
}

function redrawConsole() {
  const feed = clear($("#console-feed"));
  currentBubble = null;
  currentText = "";
  $("#console-todos").hidden = true;
  for (const stored of state.events) appendEvent(stored.e, feed);
}

function appendEvent(e, feedEl) {
  const feed = feedEl ?? $("#console-feed");
  const scrolled = isNearBottom();

  switch (e.t) {
    case "text.delta":
      if (!currentBubble) {
        currentBubble = h("div.say");
        currentText = "";
        feed.append(currentBubble);
      }
      currentText += e.text;
      currentBubble.textContent = stripMarker(currentText);
      break;
    case "text.end":
      if (currentBubble) currentBubble.innerHTML = markdown(stripMarker(currentText));
      currentBubble = null;
      currentText = "";
      break;
    case "user":
      feed.append(h("div.say.me", {}, e.text));
      break;
    case "activity": {
      // Runs repeat the same step a lot (six reads in a row); collapse them
      // into one line with a count instead of a wall of identical text.
      const last = feed.lastElementChild;
      if (last?.classList.contains("act") && last.dataset.text === e.text) {
        const n = Number(last.dataset.count ?? "1") + 1;
        last.dataset.count = String(n);
        last.querySelector(".act-count").textContent = ` ×${n}`;
        break;
      }
      feed.append(
        h(
          "div.act",
          { dataset: { text: e.text, count: "1" } },
          h("span.act-icon", {}, iconFor(e.icon)),
          h("span", {}, e.text),
          h("span.act-count.muted.small"),
        ),
      );
      break;
    }
    case "status":
      feed.append(h("div.sys", {}, e.text));
      break;
    case "error":
      feed.append(h("div.say.err", {}, e.text));
      break;
    case "ratelimit":
      feed.append(h("div.callout." + (e.level === "warn" ? "bad" : "warn"), {}, e.text));
      toast(e.text, e.level === "warn" ? "bad" : "");
      break;
    case "todos": {
      const box = clear($("#console-todos"));
      box.hidden = false;
      for (const t of e.items) {
        box.append(
          h(
            "div.todo" + (t.status === "completed" ? ".done" : t.status === "in_progress" ? ".active" : ""),
            {},
            h("span", {}, t.status === "completed" ? "✓" : t.status === "in_progress" ? "▸" : "○"),
            h("span", {}, t.content),
          ),
        );
      }
      break;
    }
    case "done":
      if (e.note) feed.append(h("div.callout." + (e.ok ? "good" : "bad"), {}, e.note));
      refresh();
      break;
    case "turn.end":
      break;
  }
  if (scrolled) scrollFeed();
}

/** [DONE] is how the agent tells the server a task finished; she never needs to see it. */
const stripMarker = (s) => s.replace(/\n*\[DONE\]\s*$/, "").replace(/\[DONE\]/g, "");

const isNearBottom = () => {
  const b = $(".console-body");
  return !b || b.scrollHeight - b.scrollTop - b.clientHeight < 120;
};
const scrollFeed = () => {
  const b = $(".console-body");
  if (b) b.scrollTop = b.scrollHeight;
};

const ICONS = {
  book: "📖", pen: "✍️", search: "🔎", globe: "🌐", users: "🤝",
  file: "📄", eye: "👀", chart: "📈", folder: "🗂", gear: "⚙️",
};
const iconFor = (k) => ICONS[k] ?? "•";

/* =====================================================================
   Starting tasks
   ===================================================================== */

async function startTask(taskId, prefill = "") {
  const task = state.data?.tasks?.[taskId];
  if (!task) return;
  if (state.run && (state.run.status === "running" || state.run.status === "waiting")) {
    toast("Something is already running. Finish or stop it first.", "bad");
    $("#console").classList.remove("collapsed");
    return;
  }

  const needsArg = !!task.argLabel;
  if (needsArg || task.caution) {
    const dlg = $("#task-dialog");
    $("#task-title").textContent = task.title;
    $("#task-blurb").textContent = task.blurb;
    $("#task-eta").textContent = task.eta ? `Usually takes ${task.eta}. You can keep using the app while it runs.` : "";
    const caution = $("#task-caution");
    caution.hidden = !task.caution;
    caution.textContent = task.caution ?? "";
    const wrap = $("#task-arg-wrap");
    wrap.hidden = !needsArg;
    $("#task-arg-label").textContent = task.argLabel ?? "";
    const input = $("#task-arg");
    input.placeholder = task.argPlaceholder ?? "";
    input.value = prefill;
    dlg.showModal();
    setTimeout(() => (needsArg ? input.focus() : $("#task-go").focus()), 50);

    const result = await new Promise((resolve) => {
      $("#task-form").onsubmit = (ev) => {
        resolve(ev.submitter?.value === "go" ? input.value : null);
      };
      dlg.addEventListener("close", () => resolve(dlg.returnValue === "go" ? input.value : null), { once: true });
    });
    if (result === null) return;
    if (task.argRequired && !String(result).trim()) {
      toast(`${task.title} needs ${task.argLabel.toLowerCase()}.`, "bad");
      return;
    }
    await fire(taskId, String(result));
    return;
  }
  await fire(taskId, prefill);
}

async function fire(taskId, args) {
  try {
    await api.post("/api/runs/start", { taskId, args });
    $("#console").classList.remove("collapsed");
    $("#console-toggle").setAttribute("aria-expanded", "true");
    state.events = [];
    redrawConsole();
  } catch (e) {
    toast(e.message, "bad");
  }
}

const taskButton = (taskId, opts = {}) => {
  const task = state.data?.tasks?.[taskId];
  if (!task) return null;
  return h(
    "button." + (opts.style ?? "ghost") + (opts.small ? ".small" : ""),
    { "data-needs-idle": "1", onclick: () => startTask(taskId, opts.prefill ?? "") },
    opts.label ?? task.title,
  );
};

const bigAction = (icon, title, sub, taskId, prefill = "", cta = "Start") =>
  h(
    "button.big-action",
    { "data-needs-idle": "1", onclick: () => startTask(taskId, prefill) },
    h("span.ba-icon", {}, icon),
    h("span", {}, h("div.ba-title", {}, title), h("div.ba-sub", {}, sub)),
    h("span.ba-go", {}, cta + " →"),
  );

/* =====================================================================
   Render
   ===================================================================== */

async function render() {
  const def = VIEWS.find((v) => v.id === state.view) ?? VIEWS[0];
  $("#view-title").textContent = def.title;
  $("#view-sub").textContent = def.sub;
  clear($("#topbar-actions"));
  const host = clear($("#view"));
  buildNav();

  if (!state.data) {
    host.append(h("p.muted", {}, "Loading…"));
    return;
  }

  const views = {
    today: viewToday,
    profile: viewProfile,
    jobs: viewJobs,
    applications: viewApplications,
    dashboard: viewDashboard,
    learn: viewLearn,
    settings: viewSettings,
  };
  try {
    await views[def.id](host);
  } catch (e) {
    host.append(h("div.callout.bad", {}, `Something broke while drawing this page: ${e.message}`));
    console.error(e);
  }
  paintRunState();
}

/* ------------------------------------------------------------ Today */

async function viewToday(host) {
  const { profile, counts } = state.data;
  const name = profile.name?.split(/\s+/)[0];
  $("#view-title").textContent = name ? `Hello ${name}` : "Welcome";
  $("#view-sub").textContent = nextLine();

  const steps = [];

  if (!counts.documents && !profile.ready) {
    steps.push(
      h(
        "button.big-action",
        { onclick: () => (location.hash = "profile") },
        h("span.ba-icon", {}, "📎"),
        h("span", {}, h("div.ba-title", {}, "Add your CV"), h("div.ba-sub", {}, "Drop in your CV and anything else you have. Everything else builds on this.")),
        h("span.ba-go", {}, "Go →"),
      ),
    );
  } else if (!profile.ready) {
    steps.push(bigAction("🙋", "Build your profile", "Claude reads what you uploaded and asks about anything missing.", "setup", "", "Build it"));
  } else {
    if (!counts.jobs) {
      steps.push(bigAction("🔎", "Find your first jobs", "Searches the job boards you have switched on.", "scrape", "", "Search"));
    } else if (counts.newJobs && counts.rankedJobs < counts.jobs) {
      steps.push(bigAction("⭐", `Score ${counts.newJobs} new job${counts.newJobs === 1 ? "" : "s"}`, "Ranks them against your profile so you know which are worth the effort.", "rank", "", "Score them"));
    }
    const best = await bestJob();
    if (best) {
      steps.push(
        h(
          "button.big-action",
          { "data-needs-idle": "1", onclick: () => startTask("apply", best.url || "") },
          h("span.ba-icon", {}, "✍️"),
          h(
            "span",
            {},
            h("div.ba-title", {}, `Apply to ${truncate(best.title, 46)}`),
            h("div.ba-sub", {}, `${best.company}${best.rank_score ? ` · scored ${best.rank_score}/100` : ""}${best.deadline ? ` · closes ${fmtDate(best.deadline)}` : ""}`),
          ),
          h("span.ba-go", {}, "Write it →"),
        ),
      );
    }
    // Only when there are already jobs; otherwise "Find your first jobs" above says it.
    if (counts.jobs && counts.newJobs === 0) {
      steps.push(bigAction("🔎", "Look for new jobs", "Checks the boards again and only shows what you have not seen.", "scrape", "", "Search"));
    }
  }

  host.append(h("div.stack", {}, ...steps));

  // Deadlines and quiet applications are the two things that genuinely need chasing.
  const dash = await api.get("/api/dashboard");
  const urgent = dash.upcoming.filter((u) => (daysUntil(u.deadline) ?? 99) <= 10);
  if (urgent.length) {
    host.append(
      h(
        "div.card",
        {},
        h("div.card-head", {}, h("h2", {}, "Closing soon")),
        h(
          "div.stack",
          {},
          ...urgent.map((u) => {
            const d = daysUntil(u.deadline);
            return h(
              "div.spread",
              {},
              h("div", {}, h("strong", {}, u.role || "(role)"), h("div.sub", {}, u.company)),
              h("span.chip." + (d <= 3 ? "bad" : "warn"), {}, d <= 0 ? "closes today" : `${d} day${d === 1 ? "" : "s"} left`),
            );
          }),
        ),
      ),
    );
  }
  if (dash.quiet.length) {
    host.append(
      h(
        "div.card",
        {},
        h("div.card-head", {}, h("h2", {}, "Gone quiet"), h("div.actions", {}, taskButton("followup", { label: "Draft polite nudges", small: true }))),
        h("p.sub", {}, `${dash.quiet.length} application${dash.quiet.length === 1 ? "" : "s"} with no word for 10 days or more.`),
        h(
          "div.stack",
          { style: "margin-top:10px" },
          ...dash.quiet.map((q) =>
            h("div.spread", {}, h("div", {}, h("strong", {}, q.role || "(role)"), h("div.sub", {}, q.company)), h("span.muted.small", {}, `applied ${fmtDate(q.date)}`)),
          ),
        ),
      ),
    );
  }

  host.append(
    h(
      "div.grid.tiles",
      {},
      tile("Jobs found", counts.jobs, counts.newJobs ? `${counts.newJobs} not looked at` : "all reviewed"),
      tile("Applications", counts.applications, `${counts.open} still open`),
      tile("Interviews", dash.interviews, dash.interviewRate !== null ? `${dash.interviewRate}% of those you sent` : ""),
      tile("Offers", dash.offers, dash.offers ? "🎉" : ""),
    ),
  );

  host.append(
    h(
      "div.card",
      {},
      h("div.card-head", {}, h("h2", {}, "Anything else"), h("div.actions", {}, taskButton("ask", { label: "Ask Claude a question", small: true }))),
      h(
        "div.row",
        {},
        taskButton("scrape", { small: true, label: "Look for new jobs" }),
        taskButton("expand", { small: true }),
        taskButton("upskill", { small: true }),
        taskButton("htmlReport", { small: true }),
      ),
    ),
  );

  function nextLine() {
    if (!counts.documents && !profile.ready) return "Let's start with your CV.";
    if (!profile.ready) return "Your documents are in. Next: build your profile.";
    if (!counts.jobs) return "Profile's ready. Time to go looking.";
    if (counts.newJobs) return `${counts.newJobs} job${counts.newJobs === 1 ? "" : "s"} waiting to be looked at.`;
    return "Here's where things stand.";
  }
}

const tile = (label, value, note) =>
  h("div.tile", {}, h("div.tile-label", {}, label), h("div.tile-value.tabular", {}, String(value ?? "-")), note ? h("div.tile-note", {}, note) : null);

async function bestJob() {
  const { jobs } = await api.get("/api/jobs");
  const open = jobs.filter((j) => !j.applied && j.status !== "expired" && (j.language_gate !== "FAIL"));
  const scored = open.filter((j) => typeof j.rank_score === "number").sort((a, b) => b.rank_score - a.rank_score);
  if (scored.length) return scored[0];
  return open.find((j) => j.fit === "high") ?? null;
}

/* ---------------------------------------------------------- About me */

async function viewProfile(host) {
  const [{ folders, documents }, profile] = await Promise.all([api.get("/api/documents"), api.get("/api/profile")]);

  $("#topbar-actions").append(
    taskButton("setup", { style: "primary", label: profile.status.ready ? "Rebuild my profile" : "Build my profile" }),
    taskButton("expand", { label: "Find forgotten skills" }),
  );

  // --- readiness
  const ready = profile.status.ready;
  host.append(
    h(
      "div.card.raised",
      {},
      h(
        "div.spread",
        {},
        h(
          "div",
          {},
          h("h2", {}, ready ? "Your profile is ready" : "Your profile isn't built yet"),
          h(
            "p.sub",
            {},
            ready
              ? "This is what every CV, cover letter and job score is written from. Rebuild it whenever you add new documents."
              : "Upload what you have below, then press “Build my profile”. Claude will ask you about anything it can't find.",
          ),
        ),
        h("span.chip." + (ready ? "good" : "warn"), {}, ready ? "Ready" : "Not ready"),
      ),
      h(
        "div.grid.three",
        { style: "margin-top:14px" },
        ...profile.files.map((f) =>
          h(
            "div.tile",
            {},
            h("div.spread", {}, h("strong", {}, f.title), h("span.chip." + (f.filled ? "good" : "warn"), {}, f.filled ? "done" : "thin")),
            h("div.tile-note", {}, f.hint),
          ),
        ),
      ),
    ),
  );

  // --- documents
  const docCard = h("div.card", {}, h("div.card-head", {}, h("h2", {}, "Your documents"), h("p.sub", {}, "Nothing leaves your computer except what Claude needs to read.")));
  const grid = h("div.grid.two");
  for (const f of folders) {
    const mine = documents.filter((d) => d.folder === f.key);
    const zone = h(
      "div.dropzone",
      {},
      h("strong", {}, f.title),
      h("div.small", {}, f.hint),
      h("div.small.muted", { style: "margin-top:6px" }, "Drop files here, or click to choose"),
    );
    const input = h("input", { type: "file", multiple: true, style: "display:none" });
    zone.onclick = () => input.click();
    input.onchange = () => upload(f.key, input.files);
    zone.ondragover = (e) => {
      e.preventDefault();
      zone.classList.add("over");
    };
    zone.ondragleave = () => zone.classList.remove("over");
    zone.ondrop = (e) => {
      e.preventDefault();
      zone.classList.remove("over");
      upload(f.key, e.dataTransfer.files);
    };
    grid.append(
      h(
        "div.stack",
        {},
        zone,
        input,
        ...mine.map((d) =>
          h(
            "div.file-row",
            {},
            h("span", {}, d.name.toLowerCase().endsWith(".pdf") ? "📄" : "📃"),
            h("span.name.grow", {}, truncate(d.name, 34)),
            h("span.muted.small", {}, fmtBytes(d.size)),
            h("button.ghost.small", { onclick: () => window.open(fileUrl(d.path), "_blank") }, "Open"),
            h(
              "button.ghost.small.danger",
              {
                onclick: async () => {
                  if (!confirm(`Delete ${d.name}?`)) return;
                  await api.del("/api/documents", { path: d.path });
                  render();
                },
              },
              "Delete",
            ),
          ),
        ),
      ),
    );
  }
  docCard.append(grid);
  host.append(docCard);

  // --- editable sections
  const sections = h("div.card", {}, h("div.card-head", {}, h("h2", {}, "What Claude knows about you"), h("p.sub", {}, "Read it, fix anything wrong. Your edits are used straight away.")));
  for (const f of profile.files) {
    const ta = h("textarea", { rows: 14, style: "display:none;margin-top:8px" });
    ta.value = f.content;
    const saveRow = h(
      "div.row",
      { style: "display:none;margin-top:8px" },
      h(
        "button.primary.small",
        {
          onclick: async () => {
            await api.post("/api/profile/save", { key: f.key, content: ta.value });
            toast("Saved.", "good");
          },
        },
        "Save changes",
      ),
      h("span.muted.small", {}, "Plain text with markdown formatting."),
    );
    const toggle = h(
      "button.ghost.small",
      {
        onclick: () => {
          const open = ta.style.display === "none";
          ta.style.display = open ? "block" : "none";
          saveRow.style.display = open ? "flex" : "none";
          toggle.textContent = open ? "Hide" : "View & edit";
        },
      },
      "View & edit",
    );
    sections.append(
      h(
        "div",
        { style: "padding:10px 0;border-bottom:1px solid var(--grid)" },
        h("div.spread", {}, h("div", {}, h("strong", {}, f.title), h("div.sub", {}, f.hint)), h("div.row", {}, h("span.muted.small", {}, `${f.content.trim().split(/\s+/).filter(Boolean).length} words`), toggle)),
        ta,
        saveRow,
      ),
    );
  }
  host.append(sections);

  async function upload(folder, files) {
    if (!files?.length) return;
    const fd = new FormData();
    fd.set("folder", folder);
    for (const f of files) fd.append("files", f);
    try {
      const r = await api.upload("/api/documents/upload", fd);
      toast(`Added ${r.saved.join(", ")}`, "good");
      await refresh();
    } catch (e) {
      toast(e.message, "bad");
    }
  }
}

/* -------------------------------------------------------------- Jobs */

async function viewJobs(host) {
  const { jobs } = await api.get("/api/jobs");
  $("#topbar-actions").append(
    taskButton("scrape", { style: "primary", label: "Find new jobs" }),
    taskButton("rank", { label: "Score them" }),
  );

  if (!jobs.length) {
    host.append(
      h(
        "div.card",
        {},
        empty("🔎", "No jobs yet", "A search checks each job board you have switched on, then saves anything new here.", h("div.row", { style: "justify-content:center;margin-top:12px" }, taskButton("scrape", { style: "primary", label: "Search now" }))),
      ),
    );
    return;
  }

  const filters = [
    { id: "unapplied", label: "Not applied to" },
    { id: "scored", label: "Scored" },
    { id: "deadline", label: "Has a deadline" },
    { id: "all", label: "Everything" },
  ];
  const bar = h(
    "div.spread",
    {},
    h(
      "div.row",
      {},
      ...filters.map((f) =>
        h(
          "button." + (state.jobFilter === f.id ? "primary" : "ghost") + ".small",
          {
            onclick: () => {
              state.jobFilter = f.id;
              render();
            },
          },
          f.label,
        ),
      ),
    ),
    h("input", {
      type: "search",
      placeholder: "Search title or company",
      value: state.jobQuery,
      style: "max-width:230px",
      oninput: (e) => {
        state.jobQuery = e.target.value;
        clearTimeout(bar._t);
        bar._t = setTimeout(render, 220);
      },
    }),
  );

  const q = state.jobQuery.toLowerCase();
  let rows = jobs.filter((j) => {
    if (q && !`${j.title} ${j.company}`.toLowerCase().includes(q)) return false;
    if (state.jobFilter === "unapplied") return !j.applied && j.status !== "expired";
    if (state.jobFilter === "scored") return typeof j.rank_score === "number";
    if (state.jobFilter === "deadline") return !!j.deadline;
    return true;
  });
  rows.sort((a, b) => {
    const as = typeof a.rank_score === "number" ? a.rank_score : -1;
    const bs = typeof b.rank_score === "number" ? b.rank_score : -1;
    if (as !== bs) return bs - as;
    return (b.first_seen ?? "").localeCompare(a.first_seen ?? "");
  });

  const table = h("table");
  table.append(
    h("thead", {}, h("tr", {}, h("th", {}, "Fit"), h("th", {}, "Role"), h("th", {}, "Where"), h("th", {}, "Closes"), h("th", {}, ""))),
  );
  const body = h("tbody");
  for (const j of rows) {
    const dl = daysUntil(j.deadline);
    const open = state.expanded.has(j.key);
    const tr = h(
      "tr.row-click",
      {
        onclick: (e) => {
          if (e.target.closest("button, a")) return;
          open ? state.expanded.delete(j.key) : state.expanded.add(j.key);
          render();
        },
      },
      h("td", {}, typeof j.rank_score === "number" ? scoreMeter(j.rank_score) : h("span.chip" + (j.fit === "high" ? ".good" : j.fit === "medium" ? ".accent" : ""), {}, j.fit ?? "new")),
      h(
        "td",
        {},
        h("strong", {}, j.title),
        h("div.sub", {}, j.company + (j.rank_verdict ? ` · ${j.rank_verdict}` : "")),
        j.applied ? h("span.chip.good", {}, "applied") : null,
        j.status === "expired" ? h("span.chip.bad", {}, "closed") : null,
        j.language_gate === "FAIL" ? h("span.chip.bad", {}, "language gap") : null,
      ),
      h("td", {}, h("div.small", {}, j.location ?? "-"), h("div.muted.small", {}, portalName(j.portal))),
      h("td", {}, j.deadline ? h("span.chip" + (dl !== null && dl <= 3 ? ".bad" : dl !== null && dl <= 10 ? ".warn" : ""), {}, dl !== null && dl >= 0 ? `${dl}d` : fmtDate(j.deadline)) : h("span.muted.small", {}, "-")),
      h(
        "td",
        {},
        h(
          "div.row",
          {},
          j.url ? h("a.chip", { href: j.url, target: "_blank", rel: "noreferrer noopener" }, "Advert") : null,
          !j.applied ? h("button.primary.small", { "data-needs-idle": "1", onclick: () => startTask("apply", j.url ?? "") }, "Apply") : null,
        ),
      ),
    );
    body.append(tr);
    if (open) {
      body.append(
        h(
          "tr",
          {},
          h(
            "td",
            { colspan: "5", style: "background:var(--plane)" },
            h(
              "div.grid.two",
              {},
              h("div", {}, h("strong.small", {}, "Where you fit"), h("ul", {}, ...(j.strengths ?? ["Not scored yet."]).map((x) => h("li.small", {}, x)))),
              h("div", {}, h("strong.small", {}, "Where you don't"), h("ul", {}, ...(j.gaps ?? ["Not scored yet."]).map((x) => h("li.small", {}, x)))),
            ),
            j.language_note ? h("div.callout.warn", { style: "margin-top:8px" }, j.language_note) : null,
            h(
              "div.row",
              { style: "margin-top:10px" },
              h("span.muted.small", {}, `First seen ${fmtDate(j.first_seen)}${j.posted_date ? ` · posted ${fmtDate(j.posted_date)}` : ""}`),
              taskButton("upskill", { small: true, label: "What am I missing?", prefill: j.url ?? "" }),
            ),
          ),
        ),
      );
    }
  }
  table.append(body);
  host.append(bar, h("div.card", {}, table), h("p.muted.small", {}, `${rows.length} of ${jobs.length} shown. Click a row for the detail.`));
}

const PORTAL_NAMES = {
  "jobindex-search": "Jobindex",
  "jobnet-search": "Jobnet",
  "jobbank-search": "Jobbank",
  "jobdanmark-search": "Jobdanmark",
  "linkedin-search": "LinkedIn",
  "freehire-search": "freehire",
};
const portalName = (p) => PORTAL_NAMES[p] ?? p ?? "";

/* ------------------------------------------------------ Applications */

async function viewApplications(host) {
  const { applications } = await api.get("/api/applications");
  $("#topbar-actions").append(
    taskButton("apply", { style: "primary", label: "New application" }),
    taskButton("outcome", { label: "Record what happened" }),
    taskButton("gmailSync", { label: "Check email" }),
  );

  if (!applications.length) {
    host.append(h("div.card", {}, empty("📄", "No applications yet", "Pick a job from the Jobs page and press Apply. The finished CV and cover letter land here.")));
    return;
  }

  const openApps = applications.filter((a) => !["rejected", "no_response", "withdrawn", "hired", "offer_declined"].includes(a.statusNorm));
  const closed = applications.filter((a) => !openApps.includes(a));

  const section = (title, list) =>
    list.length
      ? h(
          "div.card",
          {},
          h("div.card-head", {}, h("h2", {}, title), h("span.muted.small", {}, `${list.length}`)),
          h("div.stack", {}, ...list.map(appRow)),
        )
      : null;

  host.append(section("In play", openApps), section("Closed", closed));

  function appRow(a) {
    const dl = daysUntil(a.deadline);
    return h(
      "div",
      { style: "padding:12px 0;border-bottom:1px solid var(--grid)" },
      h(
        "div.spread",
        {},
        h(
          "div",
          {},
          h("strong", {}, a.role || "(role)"),
          h("div.sub", {}, `${a.company}${a.sector ? ` · ${a.sector}` : ""} · ${fmtDate(a.date)}`),
          a.notes ? h("div.muted.small", { style: "margin-top:4px" }, truncate(a.notes, 150)) : null,
        ),
        h(
          "div.row",
          {},
          a.fit_rating ? h("span.chip", {}, `fit ${a.fit_rating}`) : null,
          a.deadline && dl !== null && dl >= 0 ? h("span.chip." + (dl <= 3 ? "bad" : "warn"), {}, `${dl}d left`) : null,
          statusChip(a.statusNorm),
        ),
      ),
      h(
        "div.row",
        { style: "margin-top:8px" },
        ...a.docs.map((d) =>
          d.exists
            ? h(
                "span.row",
                { style: "gap:4px" },
                h("button.ghost.small", { onclick: () => showDoc(d.label, d.path) }, `View ${d.label.toLowerCase()}`),
                d.path.endsWith(".pdf")
                  ? h("button.ghost.small", { onclick: () => atsPanel(d.label, d.path, d.label === "CV" ? 2 : 1) }, "Robot check")
                  : null,
              )
            : h("span.muted.small", {}, `${d.label} missing`),
        ),
        a.source ? h("a.chip", { href: a.source, target: "_blank", rel: "noreferrer noopener" }, "Advert") : null,
        h("span.grow", { style: "flex:1" }),
        taskButton("outcome", { small: true, label: "Update", prefill: `${a.company} - ` }),
        taskButton("interview", { small: true, label: "Interview prep", prefill: a.company }),
      ),
    );
  }
}

function showDoc(title, path) {
  const dlg = $("#doc-dialog");
  $("#doc-title").textContent = title;
  const body = clear($("#doc-body"));
  if (path.toLowerCase().endsWith(".pdf")) {
    body.append(
      h("div.row", { style: "margin-bottom:10px" }, h("a.chip", { href: fileUrl(path, true) }, "⬇ Download"), h("span.muted.small", {}, path)),
      h("iframe", { src: fileUrl(path), title }),
    );
  } else {
    fetch(fileUrl(path))
      .then((r) => r.text())
      .then((t) => body.append(h("pre", {}, t)));
  }
  $("#doc-close").onclick = () => dlg.close();
  dlg.showModal();
}

async function atsPanel(label, path, expectedPages) {
  const dlg = $("#doc-dialog");
  $("#doc-title").textContent = `${label} - what a screening robot sees`;
  const body = clear($("#doc-body"));
  body.append(h("p.muted", {}, "Reading the PDF…"));
  $("#doc-close").onclick = () => dlg.close();
  dlg.showModal();
  try {
    const r = await api.get(`/api/ats?path=${encodeURIComponent(path)}&pages=${expectedPages}`);
    clear(body).append(
      h(
        "div.callout." + (r.ok ? "good" : "bad"),
        {},
        r.ok
          ? "This document reads cleanly. An applicant tracking system will parse it correctly."
          : "Something here would trip up an automated screener. Details below.",
      ),
      h(
        "div.stack",
        { style: "margin-top:12px" },
        ...r.findings.map((f) =>
          h(
            "div.row",
            {},
            h("span", {}, f.level === "pass" ? "✅" : f.level === "warn" ? "⚠️" : "❌"),
            h("div", {}, h("strong", {}, f.label), h("div.sub", {}, f.detail)),
          ),
        ),
      ),
      h("h3", { style: "margin-top:16px" }, "The text it extracts"),
      h("p.muted.small", {}, "This is the whole document as a machine reads it. If something important is missing here, it is invisible to a screener."),
      h("pre", {}, r.text),
    );
  } catch (e) {
    clear(body).append(h("div.callout.bad", {}, e.message));
  }
}

/* ---------------------------------------------------------- Progress */

async function viewDashboard(host) {
  const d = await api.get("/api/dashboard");
  $("#topbar-actions").append(taskButton("htmlReport", { label: "Make a shareable report" }));

  if (!d.total) {
    host.append(h("div.card", {}, empty("📊", "Nothing to chart yet", "Once you send your first application this fills up with your own numbers.")));
    return;
  }

  host.append(
    h(
      "div.grid.tiles",
      {},
      tile("Applications", d.total, `${d.drafted} still a draft`),
      tile("Sent", d.submitted, ""),
      tile("Interviews", d.interviews, d.interviewRate !== null ? `${d.interviewRate}% of sent` : ""),
      tile("Offers", d.offers, ""),
      tile("Average fit", d.avgFit ?? "-", "of 100"),
    ),
  );

  const stages = [
    { label: "Drafted", value: d.total },
    { label: "Sent", value: d.submitted },
    { label: "Screening", value: (d.byStatus.screening ?? 0) + d.interviews },
    { label: "Interview", value: d.interviews },
    { label: "Offer", value: d.offers },
  ];
  host.append(
    h(
      "div.card",
      {},
      h("div.card-head", {}, h("h2", {}, "How far applications get"), h("p.sub", {}, "Each stage counts every application that reached it or went further.")),
      funnel(stages),
    ),
  );

  const months = Object.entries(d.byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([m, v]) => ({
      label: new Date(m + "-01T12:00:00").toLocaleDateString(undefined, { month: "short" }),
      full: new Date(m + "-01T12:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" }),
      value: v,
    }));

  const grid = h("div.grid.two");
  grid.append(
    h("div.card", {}, h("div.card-head", {}, h("h2", {}, "Applications per month")), barsV(months, { unit: "applications" })),
    h(
      "div.card",
      {},
      h("div.card-head", {}, h("h2", {}, "Where the outcomes land")),
      barsH(
        Object.entries(d.byStatus)
          .map(([k, v]) => ({ label: STATUS_LABEL[k] ?? k, value: v }))
          .sort((a, b) => b.value - a.value),
        { unit: "applications" },
      ),
    ),
  );
  if (Object.keys(d.bySector).length)
    grid.append(
      h(
        "div.card",
        {},
        h("div.card-head", {}, h("h2", {}, "By sector")),
        barsH(Object.entries(d.bySector).map(([k, v]) => ({ label: k, value: v })).sort((a, b) => b.value - a.value).slice(0, 10), { unit: "applications" }),
      ),
    );
  if (Object.keys(d.byChannel).length)
    grid.append(
      h(
        "div.card",
        {},
        h("div.card-head", {}, h("h2", {}, "How you found them")),
        barsH(Object.entries(d.byChannel).map(([k, v]) => ({ label: k, value: v })).sort((a, b) => b.value - a.value), { unit: "applications" }),
      ),
    );
  host.append(grid);

  if (d.upcoming.length) {
    host.append(
      h(
        "div.card",
        {},
        h("div.card-head", {}, h("h2", {}, "Deadlines ahead")),
        h(
          "table",
          {},
          h("tbody", {}, ...d.upcoming.map((u) => h("tr", {}, h("td", {}, h("strong", {}, u.role)), h("td", {}, u.company), h("td", {}, fmtDate(u.deadline)), h("td", {}, h("span.chip" + ((daysUntil(u.deadline) ?? 99) <= 3 ? ".bad" : ""), {}, `${daysUntil(u.deadline)}d`))))),
        ),
      ),
    );
  }
}

/* ------------------------------------------------------------- Learn */

async function viewLearn(host) {
  const { reports } = await api.get("/api/upskill");
  $("#topbar-actions").append(taskButton("upskill", { style: "primary", label: "Build a learning plan" }));

  host.append(
    h(
      "div.card",
      {},
      h("div.card-head", {}, h("h2", {}, "Skill gaps")),
      h("p.sub", {}, "Compares your profile against the jobs you've been chasing, then finds the gaps worth closing and where to learn them. Works best once you have scored a few jobs."),
    ),
  );

  if (!reports.length) {
    host.append(h("div.card", {}, empty("🎓", "No learning plan yet", "Build one whenever you want a read on what to pick up next.")));
    return;
  }
  host.append(
    h(
      "div.card",
      {},
      h("div.card-head", {}, h("h2", {}, "Your plans")),
      h(
        "div.stack",
        {},
        ...reports.map((r) =>
          h(
            "div.file-row",
            {},
            h("span", {}, "🎓"),
            h("span.name.grow", {}, r.name.replace(/\.md$/, "").replace(/[-_]/g, " ")),
            h("span.muted.small", {}, fmtAgo(r.modified)),
            h("button.ghost.small", { onclick: () => showMarkdown(r.name, r.path) }, "Read"),
          ),
        ),
      ),
    ),
  );
}

/** What happened during an earlier run, from its saved transcript. */
async function showTranscript(run) {
  const dlg = $("#doc-dialog");
  $("#doc-title").textContent = `${run.title} · ${fmtDate(run.startedAt)}`;
  const body = clear($("#doc-body"));
  $("#doc-close").onclick = () => dlg.close();
  dlg.showModal();
  try {
    const { events } = await api.get(`/api/runs/transcript/${encodeURIComponent(run.id)}`);
    if (!events.length) {
      body.append(h("p.muted", {}, "No transcript was kept for this one."));
      return;
    }
    clear(body).append(
      h("div.feed", {},
        ...events.map(({ e }) => {
          if (e.t === "activity") return h("div.act", {}, h("span.act-icon", {}, iconFor(e.icon)), h("span", {}, e.text));
          if (e.t === "say") return h("div.say", { html: markdown(stripMarker(e.text)) });
          if (e.t === "user") return h("div.say.me", {}, e.text);
          if (e.t === "status") return h("div.sys", {}, e.text);
          if (e.t === "error") return h("div.say.err", {}, e.text);
          if (e.t === "done") return h("div.sys", {}, `${e.ok ? "Finished" : "Stopped"} after ${fmtDuration(e.ms)}${e.note ? ` - ${e.note}` : ""}`);
          return null;
        }).filter(Boolean),
      ),
      h("p.muted.small", { style: "margin-top:10px" }, `Saved ${fmtAgo(run.startedAt)}.`),
    );
  } catch (e) {
    clear(body).append(h("div.callout.bad", {}, e.message));
  }
}

async function showMarkdown(title, path) {
  const dlg = $("#doc-dialog");
  $("#doc-title").textContent = title;
  const body = clear($("#doc-body"));
  $("#doc-close").onclick = () => dlg.close();
  dlg.showModal();
  const text = await fetch(fileUrl(path)).then((r) => r.text());
  clear(body).append(mdBlock(text));
}

/* ------------------------------------------------------------- Setup */

async function viewSettings(host) {
  const [{ checks }, { portals }, { runs: history }] = await Promise.all([
    api.get("/api/doctor"),
    api.get("/api/portals"),
    api.get("/api/runs/history"),
  ]);

  // --- health
  const list = h("div.stack");
  for (const c of checks) {
    list.append(
      h(
        "div.spread",
        { style: "padding:8px 0;border-bottom:1px solid var(--grid)" },
        h("div.row", {}, h("span", {}, c.ok ? "✅" : c.severity === "blocker" ? "❌" : "⚠️"), h("div", {}, h("strong", {}, c.label), h("div.sub", {}, c.detail))),
        c.fix
          ? h(
              "button.ghost.small",
              {
                onclick: async (e) => {
                  e.target.disabled = true;
                  e.target.textContent = "Working…";
                  try {
                    const r = await api.post("/api/doctor/fix", { id: c.fix });
                    toast(r.message, r.ok ? "good" : "bad");
                  } catch (err) {
                    toast(err.message, "bad");
                  }
                  render();
                },
              },
              c.fixLabel ?? "Fix",
            )
          : null,
      ),
    );
  }
  host.append(
    h(
      "div.card",
      {},
      h(
        "div.card-head",
        {},
        h("h2", {}, "Is everything working?"),
        h("div.actions", {}, h("button.ghost.small", { onclick: checkConnection }, "Test the Claude connection")),
      ),
      list,
    ),
  );

  // --- portals
  const pl = h("div.stack");
  for (const p of portals) {
    pl.append(
      h(
        "label.switch",
        { style: "border-bottom:1px solid var(--grid)" },
        h("input", {
          type: "checkbox",
          checked: p.enabled,
          onchange: async (e) => {
            try {
              await api.post("/api/portals/toggle", { slug: p.slug, enabled: e.target.checked });
              toast(`${p.name} ${e.target.checked ? "on" : "off"}.`);
            } catch (err) {
              toast(err.message, "bad");
              e.target.checked = !e.target.checked;
            }
          },
        }),
        h(
          "div",
          {},
          h("strong", {}, p.name),
          h("div.sub", {}, `${p.market}${p.note ? " · " + p.note : ""}${p.installed ? "" : " · needs a one-time download"}`),
        ),
      ),
    );
  }
  host.append(
    h(
      "div.card",
      {},
      h(
        "div.card-head",
        {},
        h("h2", {}, "Job boards"),
        h("div.actions", {}, taskButton("addPortal", { small: true, label: "Add another board" })),
      ),
      h("p.sub", {}, "LinkedIn and freehire work anywhere. The other four are Danish."),
      pl,
    ),
  );

  // --- what to search for
  const sq = await api.get("/api/search-queries");
  const sqBox = h("textarea", { rows: 16, style: "display:none;margin-top:10px" });
  sqBox.value = sq.content;
  const sqSave = h(
    "div.row",
    { style: "display:none;margin-top:8px" },
    h(
      "button.primary.small",
      {
        onclick: async () => {
          await api.post("/api/search-queries", { content: sqBox.value });
          toast("Saved.", "good");
        },
      },
      "Save",
    ),
  );
  host.append(
    h(
      "div.card",
      {},
      h(
        "div.card-head",
        {},
        h("h2", {}, "What the search looks for"),
        h(
          "div.actions",
          {},
          taskButton("setupSection", { small: true, label: "Redo this with Claude", prefill: "search" }),
          h(
            "button.ghost.small",
            {
              onclick: (e) => {
                const open = sqBox.style.display === "none";
                sqBox.style.display = open ? "block" : "none";
                sqSave.style.display = open ? "flex" : "none";
                e.target.textContent = open ? "Hide" : "Edit by hand";
              },
            },
            "Edit by hand",
          ),
        ),
      ),
      h("p.sub", {}, "Job titles, skills and locations the search uses. Easiest to change by asking Claude."),
      sqBox,
      sqSave,
    ),
  );

  // --- extras
  host.append(
    h(
      "div.card",
      {},
      h("div.card-head", {}, h("h2", {}, "Extras")),
      h("p.sub", {}, "These need a connector switched on inside Claude first."),
      h("div.row", { style: "margin-top:10px" }, taskButton("gmailSync"), taskButton("notionSync"), taskButton("htmlReport")),
    ),
  );

  // --- history
  if (history.length) {
    host.append(
      h(
        "div.card",
        {},
        h("div.card-head", {}, h("h2", {}, "Recent activity")),
        h(
          "div.stack",
          {},
          ...history.slice(0, 12).map((r) =>
            h(
              "div.spread.row-click",
              { style: "padding:6px 0", onclick: () => showTranscript(r) },
              h("div", {}, h("strong.small", {}, r.title), r.args ? h("div.muted.small", {}, truncate(r.args, 70)) : null),
              h(
                "div.row",
                {},
                h("span.muted.small", {}, fmtAgo(r.startedAt)),
                h("span.chip" + (r.status === "done" ? ".good" : r.status === "error" ? ".bad" : ""), {}, r.status),
              ),
            ),
          ),
        ),
      ),
    );
  }

  host.append(
    h(
      "div.card",
      {},
      h("div.card-head", {}, h("h2", {}, "Where your things live")),
      h("p.sub", {}, "Everything stays on this computer, in the Job Studio folder. Nothing is uploaded anywhere except the parts of a document Claude has to read to do a job you asked for."),
    ),
  );
}

boot();
