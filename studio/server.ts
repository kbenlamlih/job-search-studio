/**
 * server.ts - Job Studio's local web server.
 *
 * Binds to 127.0.0.1 only: this is a personal app holding a CV, salary expectations and
 * an email history, and none of it should be reachable from the network. Mutating
 * requests must carry an X-Studio header, which a hostile web page cannot add to a
 * cross-origin request without a CORS preflight this server never approves.
 */

import { existsSync, statSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import { checks, applyFix, testConnection } from "./src/doctor.ts";
import { atsCheck } from "./src/pdf.ts";
import { runs } from "./src/runs.ts";
import { TASKS } from "./src/tasks.ts";
import { profileRelocated, relocateProfile } from "./src/relocate.ts";
import { activateTemplates, deactivateTemplates, templatesActive } from "./src/templates.ts";
import {
  DOC_FOLDERS,
  PROFILE_FILES,
  ROOT,
  PROFILE_DIR,
  WORKSPACE,
  dashboard,
  ensureDirs,
  listDocuments,
  listPortals,
  profileStatus,
  readApplications,
  readIfExists,
  readJobs,
  readSettings,
  readTracker,
  recentDocuments,
  safeWorkspacePath,
  setPortalEnabled,
  upskillReports,
  writeFileSafe,
  writeSettings,
  ws,
} from "./src/store.ts";

const PORT = Number(process.env.STUDIO_PORT ?? 4173);
const WEB = join(ROOT, "studio", "web");

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const bad = (message: string, status = 400) => json({ ok: false, error: message }, status);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".typ": "text/plain; charset=utf-8",
  ".tex": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

ensureDirs();
// First run (and after any upstream merge): move the profile out of .claude/, which
// Claude Code will not let the agent write to. See relocate.ts for the full story.
if (!profileRelocated()) {
  const r = relocateProfile();
  if (!r.alreadyDone) console.log(`  Moved ${r.moved} profile file(s) to workspace/profile/ and updated ${r.rewritten} reference(s).`);
}
// Make sure /apply has a working toolchain before she ever presses a button.
if (!templatesActive()) activateTemplates();

const handler = {
  hostname: "127.0.0.1",
  idleTimeout: 255,
  async fetch(req: Request) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // CSRF guard: anything that changes state must be same-origin and marked.
    if (method !== "GET" && method !== "HEAD") {
      const origin = req.headers.get("origin");
      const marked = req.headers.get("x-studio") === "1";
      const sameOrigin = !origin || origin === url.origin;
      if (!marked || !sameOrigin) return bad("Blocked: this request didn't come from Job Studio.", 403);
    }

    try {
      /* ------------------------------------------------------------ pages */
      if (path === "/" || path === "/index.html") return file(join(WEB, "index.html"));
      if (path.startsWith("/static/")) {
        const p = join(WEB, path.slice("/static/".length));
        if (!p.startsWith(WEB)) return bad("no", 403);
        return file(p);
      }

      /* ------------------------------------------------------------- state */
      if (path === "/api/state") {
        const profile = profileStatus();
        const jobs = readJobs();
        const apps = readApplications();
        return json({
          profile,
          settings: readSettings(),
          portals: listPortals(),
          templatesActive: templatesActive(),
          counts: {
            documents: listDocuments().length,
            jobs: jobs.length,
            newJobs: jobs.filter((j) => j.status === "new").length,
            rankedJobs: jobs.filter((j) => typeof j.rank_score === "number").length,
            applications: apps.length,
            open: apps.filter((a) => !["rejected", "no_response", "withdrawn", "hired", "offer_declined"].includes(a.statusNorm)).length,
          },
          tasks: TASKS,
          run: runs.snapshot().run,
        });
      }

      /* ------------------------------------------------------------ doctor */
      if (path === "/api/doctor") return json({ checks: await checks() });
      if (path === "/api/doctor/fix" && method === "POST") {
        const { id } = await req.json();
        return json(await applyFix(String(id)));
      }
      if (path === "/api/doctor/test" && method === "POST") return json(await testConnection());
      if (path === "/api/doctor/templates" && method === "POST") {
        const { enable } = await req.json();
        return json(enable === false ? deactivateTemplates() : activateTemplates());
      }

      /* -------------------------------------------------------------- runs */
      if (path === "/api/runs/stream") {
        let unsub = () => {};
        const stream = new ReadableStream({
          start(controller) {
            const enc = new TextEncoder();
            const send = (s: string) => {
              try {
                controller.enqueue(enc.encode(s));
              } catch {
                unsub();
              }
            };
            send(`event: run\ndata: ${JSON.stringify(runs.snapshot())}\n\n`);
            unsub = runs.subscribe(send);
            const ping = setInterval(() => send(": ping\n\n"), 20000);
            req.signal.addEventListener("abort", () => {
              clearInterval(ping);
              unsub();
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            });
          },
          cancel() {
            unsub();
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
          },
        });
      }
      if (path === "/api/runs/current") return json(runs.snapshot());
      if (path === "/api/runs/history") return json({ runs: runs.history() });
      if (path.startsWith("/api/runs/transcript/")) {
        return json({ events: runs.transcript(decodeURIComponent(path.split("/").pop() ?? "")) });
      }
      if (path === "/api/runs/start" && method === "POST") {
        const { taskId, args } = await req.json();
        const r = runs.start(String(taskId), String(args ?? ""));
        return r.ok ? json(r) : bad(r.error ?? "Could not start", 409);
      }
      if (path === "/api/runs/reply" && method === "POST") {
        const { text } = await req.json();
        if (!String(text ?? "").trim()) return bad("Nothing to send.");
        const r = runs.reply(String(text));
        return r.ok ? json(r) : bad(r.error ?? "Could not send", 409);
      }
      if (path === "/api/runs/finish" && method === "POST") return json(runs.finish());
      if (path === "/api/runs/stop" && method === "POST") return json(runs.stop());

      /* ----------------------------------------------------------- profile */
      if (path === "/api/profile") {
        // One shape for the UI: the status flags (filled/unfilled/words) alongside the
        // text, so a card and its chip can never disagree.
        const status = profileStatus();
        const files = status.files.map((f) => ({
          ...f,
          content: readIfExists(join(PROFILE_DIR, f.file)) ?? "",
        }));
        return json({ status, files, summary: readIfExists(ws("CLAUDE.md")) ?? "" });
      }
      if (path === "/api/profile/save" && method === "POST") {
        const { key, content } = await req.json();
        const def = PROFILE_FILES.find((f) => f.key === key);
        if (!def) return bad("Unknown section.");
        writeFileSafe(join(PROFILE_DIR, def.file), String(content));
        return json({ ok: true });
      }

      /* --------------------------------------------------------- documents */
      if (path === "/api/documents" && method === "GET")
        return json({ folders: DOC_FOLDERS, documents: listDocuments() });
      if (path === "/api/documents/upload" && method === "POST") {
        const form = await req.formData();
        const folder = String(form.get("folder") ?? "cv");
        if (!DOC_FOLDERS.some((f) => f.key === folder)) return bad("Unknown folder.");
        const saved: string[] = [];
        for (const entry of form.getAll("files")) {
          if (!(entry instanceof File)) continue;
          const name = entry.name.replace(/[\/\\]/g, "_").replace(/^\.+/, "");
          if (!name) continue;
          if (entry.size > 40 * 1024 * 1024) return bad(`${name} is bigger than 40 MB.`);
          const target = ws("documents", folder, name);
          await Bun.write(target, entry);
          saved.push(name);
        }
        if (!saved.length) return bad("No files arrived.");
        return json({ ok: true, saved });
      }
      if (path === "/api/documents" && method === "DELETE") {
        const { path: rel } = await req.json();
        const abs = safeWorkspacePath(String(rel));
        if (!abs || !abs.includes(join("documents", "")) || !existsSync(abs)) return bad("Can't delete that.");
        unlinkSync(abs);
        return json({ ok: true });
      }

      /* -------------------------------------------------------------- data */
      if (path === "/api/jobs") return json({ jobs: readJobs() });
      if (path === "/api/applications") return json({ applications: readApplications(), documents: recentDocuments() });
      if (path === "/api/dashboard") return json(dashboard());
      if (path === "/api/tracker") return json(readTracker());
      if (path === "/api/upskill") return json({ reports: upskillReports() });

      /* ----------------------------------------------------------- portals */
      if (path === "/api/portals") return json({ portals: listPortals() });
      if (path === "/api/portals/toggle" && method === "POST") {
        const { slug, enabled } = await req.json();
        const ok = setPortalEnabled(String(slug), !!enabled);
        return ok ? json({ ok: true, portals: listPortals() }) : bad("Unknown job board.");
      }

      /* ---------------------------------------------------- search queries */
      if (path === "/api/search-queries" && method === "GET") {
        return json({ content: readIfExists(join(PROFILE_DIR, "search-queries.md")) ?? "" });
      }
      if (path === "/api/search-queries" && method === "POST") {
        const { content } = await req.json();
        writeFileSafe(join(PROFILE_DIR, "search-queries.md"), String(content));
        return json({ ok: true });
      }

      /* ---------------------------------------------------------- settings */
      if (path === "/api/settings" && method === "POST") return json(writeSettings(await req.json()));

      /* ------------------------------------------------------------- files */
      if (path === "/api/file") {
        const rel = url.searchParams.get("path") ?? "";
        const abs = safeWorkspacePath(rel);
        if (!abs || !existsSync(abs) || !statSync(abs).isFile()) return bad("File not found.", 404);
        const download = url.searchParams.get("download") === "1";
        const res = file(abs);
        if (download) {
          const headers = new Headers(res.headers);
          headers.set("content-disposition", `attachment; filename="${abs.split("/").pop()}"`);
          return new Response(res.body, { headers });
        }
        return res;
      }
      if (path === "/api/ats") {
        const rel = url.searchParams.get("path") ?? "";
        const expected = url.searchParams.get("pages");
        const abs = safeWorkspacePath(rel);
        if (!abs || !existsSync(abs)) return bad("File not found.", 404);
        if (!abs.toLowerCase().endsWith(".pdf")) return bad("Only PDFs can be checked.");
        try {
          return json(await atsCheck(abs, expected ? Number(expected) : null));
        } catch (e: any) {
          return bad(`Could not read that PDF: ${e?.message ?? e}`, 500);
        }
      }

      return bad("Not found", 404);
    } catch (e: any) {
      console.error("[studio]", e);
      return bad(e?.message ?? "Something went wrong", 500);
    }
  },
};

/**
 * If she left an older copy running (or something else owns the port), walk up a
 * few ports rather than dying with a stack trace in her face.
 */
function listen() {
  for (let p = PORT; p < PORT + 8; p++) {
    try {
      return Bun.serve({ ...handler, port: p });
    } catch (e: any) {
      if (!/EADDRINUSE|address already in use/i.test(String(e?.message ?? e))) throw e;
    }
  }
  console.error(
    `\n  Job Studio couldn't start: ports ${PORT}-${PORT + 7} are all busy.\n` +
      `  Close any other Job Studio window and try again.\n`,
  );
  process.exit(1);
}

const server = listen();

function file(abs: string): Response {
  if (!existsSync(abs)) return bad("Not found", 404);
  const type = MIME[extname(abs).toLowerCase()] ?? "application/octet-stream";
  return new Response(Bun.file(abs), {
    headers: { "content-type": type, "cache-control": "no-store" },
  });
}

const url = `http://127.0.0.1:${server.port}`;
console.log(`\n  Job Studio is running.\n\n    ${url}\n`);
console.log(`  Workspace: ${WORKSPACE}`);
console.log(`  Close this window to stop it.\n`);

if (process.env.STUDIO_OPEN !== "0") {
  const opener =
    process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  try {
    Bun.spawn(opener, { stdout: "ignore", stderr: "ignore" });
  } catch {
    /* she can click the link above */
  }
}
