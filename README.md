# Job Studio

A local web app that puts a friendly interface on
[MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search), so
someone who doesn't code can use the whole framework without ever opening a
terminal or typing a slash command.

**This file is for whoever sets it up. The person using it reads
[`READ ME FIRST.md`](READ%20ME%20FIRST.md) instead** — hand her that one and nothing else.

---

## What it is

The upstream project is a Claude Code "operating manual": thirteen slash commands
and three skills, written as markdown prompts, plus six Bun job-portal scrapers
and LaTeX document templates. All of its intelligence is in the prompts, and all
of its state is in files.

That means a web UI can't replace it — it has to *drive* it. So Job Studio is:

```
  browser  ──►  Bun server  ──►  claude (headless, streaming both ways)
  buttons        localhost         │
  forms          only              └─►  workspace/  ← the framework, unmodified
  dashboard                             profile, tracker CSV, jobs JSON, PDFs
```

- **Her Claude subscription pays for it.** The server drives the Claude Code CLI,
  which is signed in with her own account. No API key, no per-token bill for you.
- **Nothing is forked or reimplemented.** Every workflow is read off disk from
  `workspace/.claude/commands/*.md` at run time and handed to the agent inline.
  Upstream can rewrite `apply.md` and this app picks up the change with no code
  edit. The UI is a projection of the framework's own files, never a second
  database.
- **The CLI is an invisible engine.** She never sees it. Buttons start workflows;
  when a workflow needs a decision, the agent ends its turn with a plain question
  and her typed answer goes back into the same live process.

## What she can do

Everything the framework does, in this order: upload documents → build profile →
search job boards → score jobs against her profile → generate a tailored CV and
cover letter as PDFs (drafter → reviewer → compile → ATS check) → track outcomes →
interview prep with mock interviews → skill-gap learning plans → Gmail and Notion
sync → add a new job board → shareable HTML report → start over.

## Install requirements — deliberately three single binaries

| | Why | Installed by |
| --- | --- | --- |
| Claude Code | the engine | `install.command` / `install.bat` |
| Bun | runs the server *and* the framework's scrapers (they need `@bunli/core`) | same |
| Typst | builds the PDFs | same |

No Node, no Python, no LaTeX, no admin rights. Everything lands in her user
folder.

**Typst instead of LaTeX** is the one substantive deviation from upstream, and it
needs no fork: `/apply` already resolves an `ACTIVE-TEMPLATE` managed block for
the source extension and compile command, so `studio/src/templates.ts` registers
Typst CV and cover-letter templates exactly the way `/add-template` would. A full
TeX distribution is multi-gigabyte and a reliable source of pain on Windows;
Typst is one 40 MB binary. The stock LaTeX templates are untouched in
`workspace/`, so `POST /api/doctor/templates {"enable":false}` reverts to them if
you ever install TeX.

## Handing it over

1. Copy this whole folder to her computer — a USB stick, Dropbox, a zip, whatever.
   Keep it as one folder; the app expects `workspace/` beside `studio/`.
2. Tell her to open `READ ME FIRST.md` and double-click the installer.
3. That's it. There's nothing to configure. Job boards default to LinkedIn +
   freehire (country-agnostic) and she picks the rest under **Setup**.

Worth telling her in person:

- **A Claude Pro subscription will feel tight.** One `/apply` run is a
  drafter, a reviewer sub-agent, several web fetches and a compile-inspect loop.
  Expect a handful of applications per five-hour window on Pro; Max makes it a
  non-issue. The app surfaces rate-limit warnings as they arrive and everything
  is saved when a limit hits.
- **The 2012 MacBook won't work.** It tops out at macOS 10.15 and all three
  binaries need macOS 11+. Use the Dell.

## Layout

```
job-search-studio/
├── READ ME FIRST.md          # her guide - the only doc she needs
├── install.command / .bat    # one-time setup (macOS / Windows)
├── Start Job Studio.command / .bat
├── workspace/                # the upstream framework + all her data
│   └── profile/              # her profile, moved here out of .claude/ (see below)
└── studio/
    ├── server.ts             # HTTP + SSE, 127.0.0.1 only
    ├── src/
    │   ├── agent.ts          # spawns claude, translates stream-json into UI events
    │   ├── runs.ts           # one run at a time, transcripts, permissions
    │   ├── tasks.ts          # button -> workflow prompt (reads commands off disk)
    │   ├── store.ts          # reads/writes the framework's own files
    │   ├── templates.ts      # installs + activates the Typst templates
    │   ├── pdf.ts            # ATS text-layer check
    │   └── doctor.ts         # dependency checks and self-repair
    ├── assets/templates/     # the Typst CV + cover letter
    └── web/                  # no-build frontend (vanilla ES modules)
```

## Design decisions worth knowing before you change anything

**One run at a time.** Two `/apply` runs would write `job_search_tracker.csv`
concurrently and corrupt it, and she has no way to reason about that. `runs.ts`
is a single slot; starting something new asks her to finish or stop.

**`AskUserQuestion` is disabled.** In headless mode there's nobody to render it.
Instead the appended system prompt tells the agent to end its turn with a plain
question, which the console shows with a reply box. That's also better UX — she
can answer in her own words rather than picking from four options.

**Workflows are inlined, not invoked as slash commands.** `tasks.ts` reads
`.claude/commands/<name>.md`, substitutes `$ARGUMENTS`, and sends it as the
prompt. Deterministic, independent of how the CLI expands slash commands in
headless streaming mode, and it keeps the workflow file as the single source of
truth.

**The profile is moved out of `.claude/`, and that is not optional.** Upstream keeps
the job-seeker's profile in `.claude/skills/job-application-assistant/*.md`. Claude Code
refuses every write inside a `.claude/` directory and *nothing* overrides it — not an
`allow` rule in settings, not `--permission-prompt-tool` (also blocked outright by some
enterprise policies), not a `PreToolUse` hook returning `allow`. All three were tried.
The guardrail is correct — an agent must not be able to rewrite its own configuration —
but it means a headless `/setup` writes `CLAUDE.md` and the master CV and then silently
fails on the seven files that *are* the profile, which is exactly the half-built profile
this app was watched producing. The only alternative was
`--dangerously-skip-permissions`, which is not a reasonable thing to ship on a machine
that fetches job adverts off the open web.

So `studio/src/relocate.ts` moves those files to `workspace/profile/` and rewrites every
reference: one path prefix, markdown only, 51 occurrences across 13 files. It runs
automatically on server start, is idempotent, and re-running it repairs whatever an
upstream merge reintroduces. `SKILL.md` stays where Claude Code expects a skill to live —
it is only ever read. `workspace/profile/README.md` explains the move to her in plain
words. If upstream ever moves the profile out of `.claude/` itself, delete this module.

**Permissions are an explicit allowlist**, written to
`studio/.data/agent-settings.json` on every run (`runs.ts`), merged over the
workspace's own settings, with `--permission-mode acceptEdits` for file
writes. `Bash(curl:*)` is allowed because the framework's documented escalation
for a 403 job board is a browser-header curl retry; read-only `git` is allowed so
`/setup`'s own "are you about to publish your salary expectations to a public fork?"
check can run; `sudo`, `rm -rf`, `git push`, `gh` and friends are denied. On top of that,
a `PreToolUse` hook (`permission-hook.ts`) enforces `policy.ts`: writes outside the
workspace are refused, as are writes to `settings.json`, the command definitions, the
skill contracts and `.git/` — the things that would let a run change how the next run
behaves. That list is a denylist on purpose; an allowlist of expected outputs broke
`/html-report` the first time it wrote to the workspace root.

Job postings are untrusted input and the framework's defenses are instruction-level, not
a sandbox — the same caveat as upstream's `SECURITY.md`, which is why
`READ ME FIRST.md` tells her to read documents before sending them.

**The ATS check runs in the app, not the agent.** `/apply` step 5d wants
`pypdf` or Poppler through Python. There is no Python in this stack, so
`pdf.ts` does the extraction with `unpdf` and the UI shows the extracted text
under "Robot check" — where she'll actually read it. The agent's own pass
degrades to a visual review, which `apply.md` explicitly allows for.

**Bound to 127.0.0.1, and mutating requests need an `X-Studio` header**, which a
hostile page can't add cross-origin without a preflight this server never
approves. It holds a CV, salary expectations and an email history; it has no
business being reachable.

## Keeping up with upstream

`workspace/` is a git checkout with upstream as its remote:

```bash
cd workspace && git fetch upstream && git log --oneline HEAD..upstream/master
```

Upstream ships tagged releases and two triage helpers
(`tools/check_upstream_updates.py`, `tools/upstream_triage.py`) — those need
Python, so run them on your machine, not hers. Because Job Studio reads the
workflow files at run time, a merge usually needs zero changes here. Two things to do
after a merge: restart the app, which re-runs the profile relocation over any
reintroduced `.claude/skills/job-application-assistant/` references, and press the
templates check under **Setup** if the merge touched `05-cv-templates.md` or
`06-cover-letter-templates.md`.

A merge will conflict on the profile files themselves, since they moved. Take her
version every time — upstream's copies are placeholder scaffolding.

Her personal data lives in tracked files in that checkout. Don't add a public
remote and don't push.

## Development

```bash
cd studio && bun run server.ts        # STUDIO_OPEN=0 to skip opening a browser
                                      # STUDIO_PORT=4173 by default
cd studio && bun test                 # smoke tests: CSV, path guard, prompt builder,
                                      # folder-naming rule, PDF text extraction
```

No build step: the frontend is ES modules served straight from `studio/web/`.
`unpdf` is the only runtime dependency.

## Credit

The framework, and every workflow that makes this useful, is
[Mads Lorentzen's](https://github.com/MadsLorentzen/ai-job-search) (MIT). This
repo is a front-end over it.
