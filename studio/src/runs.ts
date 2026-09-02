/**
 * runs.ts - one job at a time, streamed to every open browser tab.
 *
 * A "run" is one task (build my profile, find jobs, write this application) plus every
 * follow-up message inside it. The Claude process stays alive for the whole run, so a
 * workflow can ask a question, get an answer, and carry on with its context intact.
 *
 * Deliberately single-slot: two /apply runs writing the same tracker CSV at the same
 * time would corrupt it, and she has no way to reason about that. Starting something
 * new asks her to finish or stop the current one.
 */

import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AgentSession, type UiEvent } from "./agent.ts";
import { DATA, WORKSPACE, documentsSince, ensureDirs } from "./store.ts";
import { HOOKED_TOOLS } from "./policy.ts";
import { TASKS, buildPrompt } from "./tasks.ts";

export type RunStatus = "running" | "waiting" | "done" | "error" | "stopped";

export interface RunMeta {
  id: string;
  taskId: string;
  title: string;
  args: string;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  sessionId?: string | null;
  turns: number;
  lastNote?: string;
}

export interface StoredEvent {
  seq: number;
  at: number;
  /** `say` appears only in the on-disk transcript: one finished assistant message. */
  e: UiEvent | { t: "user"; text: string } | { t: "say"; text: string };
}

/**
 * Kept in the app's own folder rather than in workspace/.claude/, so the framework's
 * directory stays exactly as upstream ships it and no workflow trips over a settings
 * file it doesn't recognise while inventorying the project.
 */
const SETTINGS_FILE = join(DATA, "agent-settings.json");

/** Permissions the studio grants. Merged on top of the workspace's own settings.json. */
function writeAgentSettings() {
  const settings = {
    permissions: {
      defaultMode: "acceptEdits",
      allow: [
        "Read",
        "Glob",
        "Grep",
        "Write",
        "Edit",
        "MultiEdit",
        "TodoWrite",
        "Task",
        "WebSearch",
        "WebFetch",
        "Skill",
        // Job board CLIs shipped with the framework, plus anything /add-portal generates.
        "Bash(bun run .agents/skills/*/cli/src/cli.ts:*)",
        "Bash(bun install:*)",
        "Bash(bun --version)",
        "Bash(bun test:*)",
        // PDF toolchain.
        "Bash(typst:*)",
        // The framework's own helpers, when a Python happens to be present.
        "Bash(python3 tools/verify_pdf.py:*)",
        "Bash(python tools/verify_pdf.py:*)",
        "Bash(python3 salary_lookup.py:*)",
        "Bash(python salary_lookup.py:*)",
        "Bash(python3 tools/robots_check.py:*)",
        "Bash(pdftotext:*)",
        // The documented fallback when a job portal rejects WebFetch's user agent.
        "Bash(curl:*)",
        // Read-only git. /setup's own first step checks `git remote get-url origin`
        // to warn her before writing personal data into a public fork; blocking it
        // makes that safety check fail silently. Writes stay denied below.
        "Bash(git remote get-url:*)",
        "Bash(git status:*)",
        "Bash(git log:*)",
        "Bash(git diff:*)",
        // Housekeeping inside the workspace. `cd` matters more than it looks: the
        // compile command in the template manifests is `cd cv && typst compile ...`,
        // and a chained command needs every segment allowed. `rm` covers build-artifact
        // cleanup and /reset; `rm -rf` stays denied below.
        "Bash(cd:*)",
        "Bash(rm:*)",
        "Bash(mkdir:*)",
        "Bash(ls:*)",
        "Bash(cp:*)",
        "Bash(mv:*)",
        "Bash(date:*)",
        "Bash(cat:*)",
      ],
      deny: [
        // An agent that can rewrite its own permissions has none. Not hypothetical: an
        // earlier run that hit a blocked write went straight for the settings file to
        // grant itself the permission. The hook below enforces the same thing on paths.
        "Edit(.claude/settings.json)",
        "Write(.claude/settings.json)",
        "Edit(.claude/settings.local.json)",
        "Write(.claude/settings.local.json)",
        "Bash(sudo:*)",
        "Bash(rm -rf:*)",
        "Bash(git push:*)",
        "Bash(git commit:*)",
        "Bash(gh:*)",
        "Bash(ssh:*)",
        "Bash(chmod:*)",
        "Bash(npm publish:*)",
      ],
    },
    // Defence in depth on top of the allow/deny lists: policy.ts refuses any write
    // outside the workspace and to the handful of files that define how the app
    // behaves. Settings rules alone cannot express "anywhere under here except these".
    hooks: {
      PreToolUse: [
        {
          matcher: HOOKED_TOOLS.join("|"),
          hooks: [{ type: "command", command: `${process.execPath} run ${join(import.meta.dir, "permission-hook.ts")}` }],
        },
      ],
    },
  };
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
  return SETTINGS_FILE;
}

/**
 * What the end of a turn means. Pure so it can be tested without a subprocess.
 *
 * Seen in testing: a long /apply run ended a turn with "I'll apply its feedback as soon
 * as it reports back" - no question asked, workflow half done, no PDFs written. The
 * console said "your turn" and there was nothing for her to answer. Hence the three-way
 * reading, and the [DONE] marker the system prompt asks for.
 */
export function interpretTurnEnd(said: string, autoContinues: number): "done" | "ask" | "continue" {
  const tail = said.slice(-400);
  if (/\[DONE\]/.test(tail)) return "done";
  if (/\?/.test(tail) || /^\s*\d\)/m.test(said.slice(-600))) return "ask";
  return autoContinues >= 3 ? "ask" : "continue";
}

type Subscriber = (payload: string) => void;

class RunManager {
  current: { meta: RunMeta; session: AgentSession; events: StoredEvent[] } | null = null;
  private subs = new Set<Subscriber>();
  private seq = 0;
  private textBuf = "";
  /** The last complete thing the agent said, used to interpret the end of a turn. */
  private lastSaid = "";
  private autoContinues = 0;

  constructor() {
    ensureDirs();
  }

  subscribe(fn: Subscriber): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  private broadcast(kind: string, data: unknown) {
    const payload = `event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const s of this.subs) {
      try {
        s(payload);
      } catch {
        /* a dead tab; the response close handler removes it */
      }
    }
  }

  /** Live to every open tab, and kept in memory so a page reload can replay it. */
  private push(e: StoredEvent["e"]): StoredEvent {
    const stored: StoredEvent = { seq: ++this.seq, at: Date.now(), e };
    this.current?.events.push(stored);
    this.broadcast("event", stored);
    return stored;
  }

  /** Written to the run's transcript on disk. */
  private persist(e: StoredEvent["e"]) {
    if (!this.current) return;
    try {
      appendFileSync(
        join(DATA, "runs", `${this.current.meta.id}.jsonl`),
        JSON.stringify({ seq: this.seq, at: Date.now(), e }) + "\n",
      );
    } catch {
      /* a transcript is a nicety, never fatal */
    }
  }

  private record(e: StoredEvent["e"]) {
    if (!this.current) return;
    this.push(e);
    this.persist(e);
  }

  private setStatus(status: RunStatus, note?: string) {
    if (!this.current) return;
    this.current.meta.status = status;
    if (note) this.current.meta.lastNote = note;
    if (status === "done" || status === "error" || status === "stopped") this.current.meta.endedAt = Date.now();
    this.current.meta.sessionId = this.current.session.sessionId;
    this.persistMeta();
    this.broadcast("run", this.snapshot());
  }

  private persistMeta() {
    if (!this.current) return;
    try {
      writeFileSync(
        join(DATA, "runs", `${this.current.meta.id}.json`),
        JSON.stringify(this.current.meta, null, 2),
      );
    } catch {
      /* ignore */
    }
  }

  snapshot() {
    if (!this.current) return { run: null, events: [] as StoredEvent[] };
    return { run: this.current.meta, events: this.current.events };
  }

  get busy(): boolean {
    return !!this.current && (this.current.meta.status === "running" || this.current.meta.status === "waiting");
  }

  start(taskId: string, args: string): { ok: boolean; error?: string; run?: RunMeta } {
    if (this.busy) {
      return { ok: false, error: "Something is already running. Finish or stop it first." };
    }
    const task = TASKS[taskId];
    if (!task) return { ok: false, error: `Unknown task: ${taskId}` };
    const built = buildPrompt(taskId, args);
    if (built.error) return { ok: false, error: built.error };

    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${taskId}`;
    const settingsPath = writeAgentSettings();
    const meta: RunMeta = {
      id,
      taskId,
      title: task.title,
      args,
      status: "running",
      startedAt: Date.now(),
      turns: 0,
    };
    const session = new AgentSession({
      cwd: WORKSPACE,
      settingsPath,
      onEvent: (e) => this.onAgentEvent(e),
    });
    this.current = { meta, session, events: [] };
    this.seq = 0;
    this.lastSaid = "";
    this.autoContinues = 0;
    this.persistMeta();
    this.record({ t: "status", text: `Starting: ${task.title}` });
    session.send(built.prompt);
    this.broadcast("run", this.snapshot());
    return { ok: true, run: meta };
  }

  private onAgentEvent(e: UiEvent) {
    if (!this.current) return;

    // Stream text to the browser character by character, but write it to the
    // transcript as one finished message. Her /apply report - the verification
    // checklist, the tailoring decisions - is the thing most worth re-reading
    // later, and it would be lost if only tool steps were kept.
    if (e.t === "text.delta") {
      this.textBuf += e.text;
      this.push(e);
      return;
    }
    if (e.t === "text.end") {
      const said = this.textBuf.trim();
      this.textBuf = "";
      this.push(e);
      if (said) {
        this.lastSaid = said;
        this.persist({ t: "say", text: said } as any);
      }
      return;
    }

    this.record(e);
    if (e.t === "done") {
      this.current.meta.turns++;
      // Anything written to cv/ or cover_letters/ during this run is worth surfacing.
      const docs = documentsSince(this.current.meta.startedAt);
      if (docs.length) this.broadcast("documents", docs);
      if (!e.ok) this.setStatus("error", e.note);
    } else if (e.t === "turn.end") {
      if (this.current.meta.status !== "error") this.endOfTurn();
    } else if (e.t === "error") {
      this.current.meta.lastNote = e.text;
    }
  }

  private endOfTurn() {
    if (!this.current) return;
    switch (interpretTurnEnd(this.lastSaid, this.autoContinues)) {
      case "done":
        this.autoContinues = 0;
        this.setStatus("waiting"); // the task is done; she can still ask follow-ups
        this.record({ t: "status", text: "Finished. Ask a follow-up, or press \u201cAll done with this\u201d." });
        return;
      case "ask":
        this.setStatus("waiting");
        return;
      case "continue":
        this.autoContinues++;
        this.record({ t: "status", text: "Carrying on with the next step\u2026" });
        this.setStatus("running");
        this.current.session.send(
          "Continue the workflow from exactly where you left off, without repeating work you have already done. " +
            "If the task is complete, say so and end with [DONE].",
        );
        return;
    }
  }

  /** A follow-up message inside the current run. */
  reply(text: string): { ok: boolean; error?: string } {
    if (!this.current) return { ok: false, error: "Nothing is running." };
    if (this.current.meta.status === "running") return { ok: false, error: "Claude is still working. Give it a moment." };
    if (!this.current.session.alive) return { ok: false, error: "That conversation has ended. Start the task again." };
    this.record({ t: "user", text });
    this.autoContinues = 0;
    this.setStatus("running");
    this.current.session.send(text);
    return { ok: true };
  }

  /** She's happy with the result: close the conversation and free the slot. */
  finish(): { ok: boolean } {
    if (!this.current) return { ok: true };
    this.current.session.stop();
    this.setStatus("done");
    return { ok: true };
  }

  stop(): { ok: boolean } {
    if (!this.current) return { ok: true };
    this.current.session.stop();
    this.record({ t: "status", text: "Stopped." });
    this.setStatus("stopped");
    return { ok: true };
  }

  /** Past runs, newest first, for the History view. */
  history(limit = 40): RunMeta[] {
    const dir = join(DATA, "runs");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(readFileSync(join(dir, f), "utf8")) as RunMeta;
        } catch {
          return null;
        }
      })
      .filter((m): m is RunMeta => !!m)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  transcript(id: string): StoredEvent[] {
    const p = join(DATA, "runs", `${id}.jsonl`);
    if (!existsSync(p)) return [];
    return readFileSync(p, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as StoredEvent;
        } catch {
          return null;
        }
      })
      .filter((x): x is StoredEvent => !!x);
  }
}

export const runs = new RunManager();
