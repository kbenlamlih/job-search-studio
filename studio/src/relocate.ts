/**
 * relocate.ts - moves the profile files out of `.claude/` so the agent can write them.
 *
 * The problem, established the hard way: Claude Code refuses every write inside a
 * `.claude/` directory and nothing overrides it - not an `allow` rule in settings, not
 * a `--permission-prompt-tool`, not a PreToolUse hook returning "allow". The guardrail
 * is deliberate and correct (an agent must not be able to rewrite its own
 * configuration), but this framework happens to keep the job-seeker's entire profile in
 * `.claude/skills/job-application-assistant/*.md`. Headless, /setup therefore writes
 * CLAUDE.md and the master CV and then silently fails on the seven files that *are* the
 * profile. The only alternative was --dangerously-skip-permissions, which is not a
 * reasonable thing to ship on a machine that fetches job adverts off the open web.
 *
 * So the files move to `workspace/profile/` and every reference to them is rewritten.
 * That is one substitution of one path prefix, applied to markdown only, and it is
 * idempotent: run it again after merging an upstream update and it fixes up whatever
 * the merge reintroduced. `SKILL.md` itself stays where Claude Code expects to find a
 * skill - it is only ever read, never written.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { DATA, WORKSPACE, ws } from "./store.ts";

const OLD_PREFIX = ".claude/skills/job-application-assistant/";
const NEW_PREFIX = "profile/";
const SKILL_MD = ws(".claude", "skills", "job-application-assistant", "SKILL.md");
const SCRAPER_SKILL_MD = ws(".claude", "skills", "job-scraper", "SKILL.md");
const PRISTINE = join(DATA, "pristine");

/** The numbered reference files. SKILL.md is deliberately not in this list. */
const isProfileFile = (name: string) => /^\d\d-.*\.md$/.test(name);

const README = `# Your profile

These files are your profile. Everything Job Studio writes for you - every tailored CV,
every cover letter, every job score - is written from what is in here.

They started life inside \`.claude/skills/job-application-assistant/\`, which is where
this framework keeps them. Job Studio moves them here because Claude Code will not write
to any folder called \`.claude\`, as a safety rule, and that rule would otherwise stop
your profile from ever being filled in.

| File | What it holds |
| --- | --- |
| \`01-candidate-profile.md\` | Education, jobs, skills, languages |
| \`02-behavioral-profile.md\` | How you work, your strengths, the environments that suit you |
| \`03-writing-style.md\` | The tone rules your cover letters follow |
| \`04-job-evaluation.md\` | Your deal-breakers, goals, and how jobs get scored |
| \`05-cv-templates.md\` | How your CV is structured |
| \`06-cover-letter-templates.md\` | How your cover letters are structured |
| \`07-interview-prep.md\` | Your STAR stories for interviews |
| \`08-application-forms.md\` | Guidance for the free-text boxes on application forms |
| \`09-web-research.md\` | Rules for researching an employer before applying |
| \`search-queries.md\` | What the job search looks for |

They are ordinary text files. You can read or edit them in the app under **About me**.
`;

/** Save the upstream version of each profile file, so "has this been filled in?" is exact. */
function capturePristine(oldPaths: string[]) {
  mkdirSync(PRISTINE, { recursive: true });
  for (const rel of oldPaths) {
    const name = rel.split("/").pop()!;
    const dest = join(PRISTINE, name);
    if (existsSync(dest)) continue;
    try {
      const original = execFileSync("git", ["show", `HEAD:${rel}`], {
        cwd: WORKSPACE,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      });
      writeFileSync(dest, original, "utf8");
    } catch {
      // Not a git checkout, or the file is new. Fall back to whatever is on disk now,
      // which is still pristine at the moment relocation first runs.
      const current = ws(...rel.split("/"));
      if (existsSync(current)) writeFileSync(dest, readFileSync(current, "utf8"), "utf8");
    }
  }
}

/** Every markdown file in the workspace that could name the old path. */
function markdownFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === "node_modules" || name === "OpenFonts") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) markdownFiles(p, out);
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

export function relocateProfile(): { moved: number; rewritten: number; alreadyDone: boolean } {
  const oldDir = ws(".claude", "skills", "job-application-assistant");
  const newDir = ws("profile");
  mkdirSync(newDir, { recursive: true });

  // 1. Capture the upstream text of each file before anything is written to it.
  const candidates = existsSync(oldDir) ? readdirSync(oldDir).filter(isProfileFile) : [];
  capturePristine([
    ...candidates.map((n) => OLD_PREFIX + n),
    ".claude/skills/job-scraper/search-queries.md",
  ]);

  // 2. Move the numbered files, and the scraper's search queries.
  let moved = 0;
  for (const name of candidates) {
    const from = join(oldDir, name);
    const to = join(newDir, name);
    if (existsSync(to)) continue; // already relocated; leave her version alone
    renameSync(from, to);
    moved++;
  }
  const oldQueries = ws(".claude", "skills", "job-scraper", "search-queries.md");
  const newQueries = join(newDir, "search-queries.md");
  if (existsSync(oldQueries) && !existsSync(newQueries)) {
    renameSync(oldQueries, newQueries);
    moved++;
  }

  // 3. Rewrite every reference. One prefix, plus the bare filenames that the two
  //    SKILL.md files use because the files used to sit beside them.
  let rewritten = 0;
  for (const file of markdownFiles(WORKSPACE)) {
    const before = readFileSync(file, "utf8");
    let after = before.replaceAll(OLD_PREFIX, NEW_PREFIX);

    if (file === SKILL_MD) {
      // `01-candidate-profile.md` -> `profile/01-candidate-profile.md`
      after = after.replace(/`(\d\d-[a-z-]+\.md)`/g, "`profile/$1`");
    }
    if (file === SCRAPER_SKILL_MD) {
      after = after
        .replace(/`search-queries\.md` \(this directory\)/g, "`profile/search-queries.md`")
        .replace(/`search-queries\.md`/g, "`profile/search-queries.md`");
    }
    // Guard against double-prefixing when this runs a second time.
    after = after.replaceAll("profile/profile/", "profile/");

    if (after !== before) {
      writeFileSync(file, after, "utf8");
      rewritten++;
    }
  }

  writeFileSync(join(newDir, "README.md"), README, "utf8");

  return { moved, rewritten, alreadyDone: moved === 0 && rewritten === 0 };
}

/** True when the profile files are where Job Studio expects them. */
export function profileRelocated(): boolean {
  return (
    existsSync(ws("profile", "01-candidate-profile.md")) &&
    !existsSync(ws(".claude", "skills", "job-application-assistant", "01-candidate-profile.md"))
  );
}

export const PRISTINE_DIR = PRISTINE;
export const relativeToWorkspace = (p: string) => relative(WORKSPACE, p);
