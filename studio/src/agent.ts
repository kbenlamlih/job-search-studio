/**
 * agent.ts - drives Claude Code headless as a long-lived, two-way conversation.
 *
 * One AgentSession == one `claude -p --input-format stream-json` child process.
 * The process stays alive between turns, so a workflow that needs to ask the user
 * something (every /setup path, /apply's "should I draft this?") just ends its turn
 * with a question and waits for the next stdin message.
 *
 * Raw stream-json events are translated into small UI events (see UiEvent) so the
 * browser never has to know what a tool_use block is.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { basename } from "node:path";

export type UiEvent =
  | { t: "status"; text: string }
  | { t: "text.delta"; text: string }
  | { t: "text.end" }
  | { t: "activity"; icon: string; text: string }
  | { t: "todos"; items: { content: string; status: string }[] }
  | { t: "turn.end"; awaiting: boolean }
  | { t: "ratelimit"; text: string; level: "info" | "warn" }
  | { t: "done"; ok: boolean; ms: number; note?: string }
  | { t: "error"; text: string };

/** Env vars that leak a parent Claude Code session into the child. */
const PARENT_ENV_KEYS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_HOST_SESSION_ID",
  "CLAUDE_AGENT_SDK_VERSION",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "AI_AGENT",
];

export const STUDIO_SYSTEM_PROMPT = `
You are the engine behind "Job Studio", a small desktop app. The person using it is
job hunting. She does not write code, has never used a terminal, and will never see one.
The app renders your messages as chat bubbles next to buttons, forms and a dashboard.

How to behave:
- Never tell her to run a command, open a terminal, install something, edit a file by
  hand, or type a slash command. If something needs doing, do it yourself with your tools.
- Never use the AskUserQuestion tool. When you need a decision, end your turn with a
  short question in plain words. If there are options, list them as "1)", "2)", "3)".
  The app shows the question and sends her answer back as the next message. Then continue.
- Write for a smart non-technical reader. No jargon, no file paths in prose, no LaTeX or
  Typst internals, no talk of "the repo", "commits" or "markdown files". Say "your CV",
  not "cv/main_acme_analyst.typ". Naming a document is fine; pasting a path is not.
- Keep it short. Three sentences beats a paragraph. Use a table only when comparing things.
- Never invent experience, skills, dates or numbers. If something is a genuine gap, say so.
- End a finished task with one line on what changed and one on what she can do next,
  then a final line containing only [DONE]. Use [DONE] when the whole task is finished,
  never when you are pausing for her answer or still working - the app relies on it to
  know whether to wait for her or let you carry on.
`.trim();

export interface AgentSessionOpts {
  cwd: string;
  settingsPath: string;
  /** Existing Claude session id to continue from, if any. */
  resume?: string;
  model?: string;
  onEvent: (e: UiEvent) => void;
}

export class AgentSession {
  proc: ChildProcessWithoutNullStreams | null = null;
  sessionId: string | null = null;
  /** true while a turn is in flight (between our message and its `result`). */
  busy = false;
  private buf = "";
  private textOpen = false;
  private sawDelta = false;
  private startedAt = 0;
  private opts: AgentSessionOpts;
  private closed = false;
  private lastError: string | null = null;

  constructor(opts: AgentSessionOpts) {
    this.opts = opts;
  }

  private emit(e: UiEvent) {
    this.opts.onEvent(e);
  }

  start() {
    const args = [
      "-p",
      "--verbose", // required by the CLI whenever output-format is stream-json
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--include-partial-messages",
      "--permission-mode",
      "acceptEdits",
      "--settings",
      this.opts.settingsPath,
      "--append-system-prompt",
      STUDIO_SYSTEM_PROMPT,
      "--disallowed-tools",
      "AskUserQuestion",
    ];
    if (this.opts.model) args.push("--model", this.opts.model);
    if (this.opts.resume) args.push("--resume", this.opts.resume);

    const env: Record<string, string | undefined> = { ...process.env };
    for (const k of PARENT_ENV_KEYS) delete env[k];

    this.proc = spawn("claude", args, {
      cwd: this.opts.cwd,
      env: env as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (chunk: string) => {
      const s = chunk.trim();
      // The CLI writes benign warnings to stderr; only surface things that look real.
      if (/error|failed|not found|denied/i.test(s) && !/MCP servers blocked/i.test(s)) {
        this.lastError = s.slice(0, 400);
        this.emit({ t: "error", text: this.lastError });
      }
    });
    this.proc.on("error", (err: Error) => {
      this.emit({
        t: "error",
        text:
          err.message.includes("ENOENT")
            ? "Claude Code isn't installed yet. Open Settings and run the setup check."
            : err.message,
      });
    });
    this.proc.on("close", (code: number | null) => {
      this.closed = true;
      this.closeText();
      if (this.busy) {
        this.busy = false;
        this.emit({
          t: "done",
          ok: false,
          ms: Date.now() - this.startedAt,
          note: this.lastError ?? `Claude stopped unexpectedly (code ${code}).`,
        });
      }
    });
  }

  get alive() {
    return !!this.proc && !this.closed;
  }

  /** Send a user message. Starts the process on first use. */
  send(text: string) {
    if (!this.proc || this.closed) this.start();
    this.startedAt = Date.now();
    this.busy = true;
    this.proc!.stdin.write(
      JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "text", text }] },
      }) + "\n",
    );
  }

  stop() {
    if (!this.proc || this.closed) return;
    this.closed = true;
    try {
      this.proc.stdin.end();
      this.proc.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }

  private closeText() {
    if (this.textOpen) {
      this.textOpen = false;
      this.emit({ t: "text.end" });
    }
  }

  private onStdout(chunk: string) {
    this.buf += chunk;
    const lines = this.buf.split("\n");
    this.buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let e: any;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      this.handle(e);
    }
  }

  private handle(e: any) {
    switch (e.type) {
      case "system":
        if (e.subtype === "init") {
          this.sessionId = e.session_id ?? this.sessionId;
          this.emit({ t: "status", text: "Claude is ready." });
        }
        return;

      case "stream_event": {
        const ev = e.event;
        if (ev?.type === "message_start") this.sawDelta = false;
        if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          if (!this.textOpen) this.textOpen = true;
          this.sawDelta = true;
          this.emit({ t: "text.delta", text: ev.delta.text });
        }
        if (ev?.type === "content_block_stop") this.closeText();
        return;
      }

      case "assistant": {
        // Text normally arrives as deltas via stream_event. If partial messages
        // didn't come through (older CLI, or a turn that never streamed), fall
        // back to the complete block so her chat is never silently empty.
        if (!this.sawDelta) {
          for (const c of e.message?.content ?? []) {
            if (c.type === "text" && c.text?.trim()) {
              this.emit({ t: "text.delta", text: c.text });
              this.emit({ t: "text.end" });
            }
          }
        }
        for (const c of e.message?.content ?? []) {
          if (c.type === "tool_use") {
            this.closeText();
            if (c.name === "TodoWrite") {
              const items = (c.input?.todos ?? []).map((t: any) => ({
                content: t.content ?? t.activeForm ?? "",
                status: t.status ?? "pending",
              }));
              if (items.length) this.emit({ t: "todos", items });
            } else {
              const a = humanizeTool(c.name, c.input);
              if (a) this.emit({ t: "activity", icon: a.icon, text: a.text });
            }
          }
        }
        return;
      }

      case "rate_limit_event": {
        const txt = describeRateLimit(e);
        if (txt) this.emit({ t: "ratelimit", text: txt.text, level: txt.level });
        return;
      }

      case "result": {
        this.closeText();
        this.sessionId = e.session_id ?? this.sessionId;
        this.busy = false;

        // A blocked tool call does not fail the turn: the agent apologises in prose,
        // improvises, and the run still reports success while having written nothing.
        // Surface it loudly instead of letting it hide in the chat.
        const denials: any[] = e.permission_denials ?? [];
        if (denials.length) {
          const what = [...new Set(denials.map((d) => describeDenial(d)))].slice(0, 4);
          this.emit({
            t: "error",
            text: `Claude wasn't allowed to do ${what.length > 1 ? "these things" : "this"}: ${what.join("; ")}. That is often harmless, but if something looks missing from the result, mention it to whoever set this up.`,
          });
        }
        if (e.is_error) {
          this.emit({
            t: "done",
            ok: false,
            ms: e.duration_ms ?? Date.now() - this.startedAt,
            note: typeof e.result === "string" ? e.result.slice(0, 600) : "Claude hit an error.",
          });
        } else {
          this.emit({ t: "done", ok: true, ms: e.duration_ms ?? Date.now() - this.startedAt });
        }
        // Process stays alive: the turn ended, she can reply or start something else.
        this.emit({ t: "turn.end", awaiting: true });
        return;
      }
    }
  }
}

/** A denied tool call, in words she could repeat to someone who can fix it. */
function describeDenial(d: any): string {
  const tool = d.tool_name ?? d.tool ?? "a tool";
  const input = d.tool_input ?? {};
  if (input.file_path) return `${tool === "Read" ? "reading" : "writing"} ${basename(String(input.file_path))}`;
  if (input.command) return `running ${String(input.command).split(/\s+/)[0]}`;
  if (input.url) return `fetching ${String(input.url).slice(0, 60)}`;
  return `using ${tool}`;
}

/** Portal slug -> the name a human would recognize. */
const PORTALS: Record<string, string> = {
  "jobindex-search": "Jobindex",
  "jobnet-search": "Jobnet",
  "jobbank-search": "Akademikernes Jobbank",
  "jobdanmark-search": "Jobdanmark",
  "linkedin-search": "LinkedIn",
  "freehire-search": "freehire",
};

export function humanizeTool(name: string, input: any): { icon: string; text: string } | null {
  const f = (p: unknown) => (typeof p === "string" ? basename(p) : "a file");
  switch (name) {
    case "Read": {
      const b = f(input?.file_path);
      if (/\.pdf$/i.test(b)) return { icon: "eye", text: `Checking how ${b} looks` };
      return { icon: "book", text: `Reading ${prettyFile(b)}` };
    }
    case "Write":
      return { icon: "pen", text: `Writing ${prettyFile(f(input?.file_path))}` };
    case "Edit":
    case "MultiEdit":
      return { icon: "pen", text: `Polishing ${prettyFile(f(input?.file_path))}` };
    case "Glob":
    case "Grep":
      return { icon: "search", text: "Looking through your files" };
    case "WebSearch":
      return { icon: "globe", text: `Searching the web for “${String(input?.query ?? "").slice(0, 60)}”` };
    case "WebFetch": {
      let host = "a web page";
      try {
        host = new URL(String(input?.url)).hostname.replace(/^www\./, "");
      } catch {
        /* keep default */
      }
      return { icon: "globe", text: `Reading ${host}` };
    }
    case "Task":
    case "Agent":
      return { icon: "users", text: "Asking a second Claude to review the draft" };
    case "Skill":
      return { icon: "book", text: "Opening the job-application playbook" };
    case "Bash": {
      const cmd = String(input?.command ?? "");
      for (const [slug, label] of Object.entries(PORTALS)) {
        if (cmd.includes(slug)) {
          const detail = cmd.includes(" detail");
          return { icon: "search", text: detail ? `Opening a listing on ${label}` : `Searching ${label}` };
        }
      }
      if (/typst\s+compile/.test(cmd)) return { icon: "file", text: "Building the PDF" };
      if (/lualatex|xelatex|pdflatex/.test(cmd)) return { icon: "file", text: "Building the PDF" };
      if (/verify_pdf|pdftotext/.test(cmd)) return { icon: "eye", text: "Checking the PDF is machine-readable" };
      if (/salary_lookup/.test(cmd)) return { icon: "chart", text: "Looking up salary benchmarks" };
      if (/^\s*(mkdir|cp|mv|ls|rm)\b/.test(cmd)) return { icon: "folder", text: "Tidying up files" };
      if (/^\s*curl/.test(cmd)) return { icon: "globe", text: "Fetching a page the normal way was blocked" };
      if (/^\s*(git|gh)\b/.test(cmd)) return { icon: "folder", text: "Checking your folder" };
      if (/^\s*date\b/.test(cmd)) return { icon: "gear", text: "Checking today's date" };
      if (/bun\s+(--version|install)/.test(cmd)) return { icon: "gear", text: "Checking the job board tools" };
      return { icon: "gear", text: "Running a tool" };
    }
    default:
      return null;
  }
}

/** Turn internal filenames into something she'd recognize. */
function prettyFile(b: string): string {
  if (/^01-candidate-profile/.test(b)) return "your profile";
  if (/^02-behavioral-profile/.test(b)) return "your working-style profile";
  if (/^03-writing-style/.test(b)) return "your writing style notes";
  if (/^04-job-evaluation/.test(b)) return "your job-fit criteria";
  if (/^05-cv-templates|^06-cover-letter/.test(b)) return "your document templates";
  if (/^07-interview-prep/.test(b)) return "your interview examples";
  if (/^job_search_tracker/.test(b)) return "your application tracker";
  if (/^CLAUDE\.md$/.test(b)) return "your profile summary";
  if (/^cover/i.test(b)) return "your cover letter";
  if (/^main_/.test(b)) return "your CV";
  if (/^job_posting/.test(b)) return "the job posting";
  if (/^search-queries/.test(b)) return "your search settings";
  if (/^seen_jobs/.test(b)) return "your saved jobs";
  if (/^outcome\.md$/.test(b)) return "what happened last time";
  if (/^TEMPLATE\.md$/.test(b)) return "the document design notes";
  return b;
}

/**
 * Shape as emitted by the CLI:
 *   { type: "rate_limit_event", rate_limit_info: { status: "allowed",
 *     resetsAt: 1790812800, rateLimitType: "overage", ... } }
 * `resetsAt` is unix seconds. A plain "allowed" is the common case and says nothing
 * worth interrupting her for.
 */
function describeRateLimit(e: any): { text: string; level: "info" | "warn" } | null {
  const st = e.rate_limit_info ?? e.rate_limit ?? e;
  const status = String(st.status ?? st.state ?? "").toLowerCase();
  if (!status || status === "allowed" || status === "ok") return null;

  const resetsAt = st.resetsAt ?? st.reset_at ?? st.resets_at;
  const when = resetsAt ? new Date(Number(resetsAt) * (String(Math.trunc(Number(resetsAt))).length > 11 ? 1 : 1000)) : null;
  let whenStr = "";
  if (when && !isNaN(when.getTime())) {
    const hours = (when.getTime() - Date.now()) / 3600000;
    const time = when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    whenStr =
      hours > 20
        ? ` It resets on ${when.toLocaleDateString([], { weekday: "long" })} at ${time}.`
        : ` It resets around ${time}.`;
  }

  if (status.includes("reject") || status.includes("exceed") || status.includes("blocked"))
    return { text: `You've used up your Claude allowance for now.${whenStr} Everything you've done is saved - come back later and carry on.`, level: "warn" };
  if (status.includes("warn") || status.includes("approach"))
    return { text: `You're getting close to your Claude usage limit for this window.${whenStr}`, level: "info" };
  return null;
}
