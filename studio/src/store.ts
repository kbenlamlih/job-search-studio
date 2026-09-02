/**
 * store.ts - reads and writes the workspace that the framework owns.
 *
 * Rule: the files in workspace/ are the system of record, exactly as the framework
 * defines them. Job Studio never invents a parallel database. Every view in the UI is
 * a projection of these files, so anything Claude writes shows up in the app and
 * anything the app writes is understood by the next Claude run.
 */

import { join, dirname, basename, relative, resolve, sep } from "node:path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";

export const ROOT = resolve(import.meta.dir, "..", "..");
export const WORKSPACE = join(ROOT, "workspace");
export const DATA = join(ROOT, "studio", ".data");
/** Where the profile lives after relocation (see relocate.ts for why it moved). */
export const PROFILE_DIR = join(WORKSPACE, "profile");
export const SKILL_DIR = PROFILE_DIR;
export const SCRAPER_SKILL_DIR = join(WORKSPACE, ".claude", "skills", "job-scraper");
export const PORTAL_DIR = join(WORKSPACE, ".agents", "skills");

export const ws = (...p: string[]) => join(WORKSPACE, ...p);

export function ensureDirs() {
  for (const d of [
    DATA,
    join(DATA, "runs"),
    PROFILE_DIR,
    ws("documents", "cv"),
    ws("documents", "linkedin"),
    ws("documents", "diplomas"),
    ws("documents", "references"),
    ws("documents", "applications"),
    ws("documents", "postings"),
    ws("job_scraper"),
    ws("company_research"),
  ]) {
    mkdirSync(d, { recursive: true });
  }
}

/** Guard every path that comes from the browser: it must stay inside the workspace. */
export function safeWorkspacePath(rel: string): string | null {
  const p = resolve(WORKSPACE, rel);
  if (p !== WORKSPACE && !p.startsWith(WORKSPACE + sep)) return null;
  return p;
}

export function readIfExists(p: string): string | null {
  try {
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  } catch {
    return null;
  }
}

export function writeFileSafe(p: string, content: string) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, "utf8");
}

/* ------------------------------------------------------------------ profile */

export const PROFILE_FILES = [
  { key: "candidate", file: "01-candidate-profile.md", title: "Who you are", hint: "Education, jobs, skills, languages" },
  { key: "behavioral", file: "02-behavioral-profile.md", title: "How you work", hint: "Strengths, working style, ideal environment" },
  { key: "writing", file: "03-writing-style.md", title: "How you write", hint: "Tone rules your cover letters follow" },
  { key: "evaluation", file: "04-job-evaluation.md", title: "What you want", hint: "Deal-breakers, goals, how jobs get scored" },
  { key: "interview", file: "07-interview-prep.md", title: "Your stories", hint: "STAR examples used in interview prep" },
] as const;

/** A profile file still holding template placeholders has not been filled in yet. */
function looksUnfilled(text: string): boolean {
  return /\[YOUR_|\[PLACEHOLDER\]|\[Your |<your |TODO: fill/i.test(text);
}

/**
 * Which profile files have actually been personalised.
 *
 * Compared against the upstream text of the same file, which relocate.ts saved to
 * studio/.data/pristine/ before anything could write to it. Exact, and it does not
 * care about git state. Word counts and placeholder-sniffing both misfire here: several
 * of the shipped files are long, and their own guidance contains bracketed examples that
 * look exactly like unfilled placeholders.
 */
function pristineText(file: string): string | null {
  return readIfExists(join(DATA, "pristine", file));
}

export function profileStatus() {
  const files = PROFILE_FILES.map((f) => {
    const text = readIfExists(join(PROFILE_DIR, f.file));
    const words = text ? text.trim().split(/\s+/).length : 0;
    const pristine = pristineText(f.file);
    const filled = !!text && (pristine !== null
      ? text.trim() !== pristine.trim()
      : words > 350 && !looksUnfilled(text));
    return {
      ...f,
      exists: !!text,
      words,
      unfilled: !!text && looksUnfilled(text),
      filled,
    };
  });

  // The Identity block writes `- **Name:** Marie Lindqvist`; strip the markdown
  // rather than trying to match every way emphasis can wrap a colon.
  const claude = readIfExists(ws("CLAUDE.md")) ?? "";
  let name: string | null = null;
  for (const line of claude.split("\n").slice(0, 80)) {
    // Strip emphasis and list markers, but never underscores: they are what makes
    // an untouched `[YOUR_NAME]` recognisable as a placeholder further down.
    const plain = line.replace(/[*`]/g, "").replace(/^\s*[-+]\s*/, "").trim();
    const m = plain.match(/^Name\s*:\s*(.+)$/i);
    if (m) {
      name = m[1].split("<!--")[0].replace(/\|/g, "").trim();
      break;
    }
  }
  const candidate = files.find((f) => f.key === "candidate");
  return {
    ready: candidate?.filled === true || files.filter((f) => f.filled).length >= 2,
    name: name && !looksUnfilled(name) ? name : null,
    files,
  };
}

/* ------------------------------------------------------------------ documents */

export interface DocEntry {
  name: string;
  folder: string;
  size: number;
  modified: number;
  path: string;
}

export const DOC_FOLDERS = [
  { key: "cv", title: "CV / resume", hint: "Your current CV as a PDF or Word file" },
  { key: "linkedin", title: "LinkedIn export", hint: "Save your LinkedIn profile as PDF" },
  { key: "diplomas", title: "Diplomas", hint: "Degrees, transcripts, certificates" },
  { key: "references", title: "References", hint: "Reference letters, recommendations" },
] as const;

export function listDocuments(): DocEntry[] {
  const out: DocEntry[] = [];
  for (const f of DOC_FOLDERS) {
    const dir = ws("documents", f.key);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (!st.isFile()) continue;
      out.push({
        name,
        folder: f.key,
        size: st.size,
        modified: st.mtimeMs,
        path: relative(WORKSPACE, p),
      });
    }
  }
  return out.sort((a, b) => b.modified - a.modified);
}

/* ------------------------------------------------------------------ jobs */

export interface Job {
  key: string;
  title: string;
  company: string;
  url: string;
  location?: string;
  portal?: string;
  fit?: string;
  status?: string;
  first_seen?: string;
  posted_date?: string | null;
  deadline?: string | null;
  rank_score?: number;
  rank_verdict?: string;
  rank_date?: string;
  strengths?: string[];
  gaps?: string[];
  language_gate?: string;
  language_note?: string;
  location_verdict?: string;
  applied?: boolean;
}

export function readJobs(): Job[] {
  const raw = readIfExists(ws("job_scraper", "seen_jobs.json"));
  if (!raw) return [];
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const seen = parsed?.seen ?? {};
  const tracked = new Set(
    readTracker().rows.map((r) => `${(r.company ?? "").toLowerCase()}|${(r.role ?? "").toLowerCase()}`),
  );
  return Object.entries(seen).map(([key, v]: [string, any]) => ({
    key,
    title: v.title ?? "(untitled)",
    company: v.company ?? "",
    url: v.url ?? "",
    location: v.location && !/^(PASS|FAIL|FLAG)$/.test(v.location) ? v.location : undefined,
    portal: v.portal,
    fit: v.fit,
    status: v.status,
    first_seen: v.first_seen,
    posted_date: v.posted_date ?? null,
    deadline: v.deadline ?? null,
    rank_score: typeof v.rank_score === "number" ? v.rank_score : undefined,
    rank_verdict: v.rank_verdict,
    rank_date: v.rank_date,
    strengths: Array.isArray(v.strengths) ? v.strengths : undefined,
    gaps: Array.isArray(v.gaps) ? v.gaps : undefined,
    language_gate: v.language_gate,
    language_note: v.language_note,
    location_verdict: v.location_verdict ?? (/^(PASS|FAIL|FLAG)$/.test(v.location ?? "") ? v.location : undefined),
    applied: tracked.has(`${(v.company ?? "").toLowerCase()}|${(v.title ?? "").toLowerCase()}`),
  }));
}

/* ------------------------------------------------------------------ tracker */

export const TRACKER_HEADER =
  "date,company,sector,role,role_type,channel,status,contact_person,fit_rating,notes,cv_file,cover_letter_file,source,deadline";

export type TrackerRow = Record<string, string> & { _i: number };

/** Minimal RFC4180 parser: the framework writes quoted fields with commas in notes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

export function toCsv(rows: string[][]): string {
  return (
    rows
      .map((r) =>
        r
          .map((f) => (/[",\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f))
          .join(","),
      )
      .join("\n") + "\n"
  );
}

export function readTracker(): { header: string[]; rows: TrackerRow[] } {
  const raw = readIfExists(ws("job_search_tracker.csv"));
  if (!raw) return { header: TRACKER_HEADER.split(","), rows: [] };
  const grid = parseCsv(raw);
  if (!grid.length) return { header: TRACKER_HEADER.split(","), rows: [] };
  const header = grid[0].map((h) => h.trim());
  const rows = grid.slice(1).map((cells, i) => {
    const o: any = { _i: i };
    header.forEach((h, j) => (o[h] = (cells[j] ?? "").trim()));
    return o as TrackerRow;
  });
  return { header, rows };
}

/** Status vocabulary, ordered as a funnel. Legacy space spellings are normalized. */
export const STATUS_ORDER = [
  "drafted",
  "applied",
  "screening",
  "interview",
  "final_interview",
  "offer",
  "hired",
  "rejected",
  "no_response",
  "withdrawn",
  "offer_declined",
] as const;

export const FINAL_STATUSES = new Set(["hired", "rejected", "no_response", "withdrawn", "offer_declined"]);

export function normStatus(s: string): string {
  return (s || "").trim().toLowerCase().replace(/\s+/g, "_");
}

export function dashboard() {
  const { rows } = readTracker();
  const byStatus: Record<string, number> = {};
  const bySector: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  const byMonth: Record<string, number> = {};
  let fitSum = 0;
  let fitN = 0;
  const upcoming: { company: string; role: string; deadline: string }[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const r of rows) {
    const st = normStatus(r.status);
    byStatus[st] = (byStatus[st] ?? 0) + 1;
    if (r.sector) bySector[r.sector] = (bySector[r.sector] ?? 0) + 1;
    if (r.channel) byChannel[r.channel] = (byChannel[r.channel] ?? 0) + 1;
    if (/^\d{4}-\d{2}/.test(r.date)) {
      const m = r.date.slice(0, 7);
      byMonth[m] = (byMonth[m] ?? 0) + 1;
    }
    const fit = Number(r.fit_rating);
    if (!Number.isNaN(fit) && fit > 0) {
      fitSum += fit;
      fitN++;
    }
    if (r.deadline && /^\d{4}-\d{2}-\d{2}$/.test(r.deadline) && r.deadline >= today && !FINAL_STATUSES.has(st)) {
      upcoming.push({ company: r.company, role: r.role, deadline: r.deadline });
    }
  }

  const count = (...ss: string[]) => ss.reduce((n, s) => n + (byStatus[s] ?? 0), 0);
  const submitted = rows.filter((r) => normStatus(r.status) !== "drafted").length;
  const interviews = count("interview", "final_interview", "offer", "hired") + count("screening");
  const offers = count("offer", "hired", "offer_declined");

  // Applications that have gone quiet: applied, no final status, nothing for 10+ days.
  const quiet = rows
    .filter((r) => {
      const st = normStatus(r.status);
      if (st === "drafted" || FINAL_STATUSES.has(st)) return false;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return false;
      const days = (Date.now() - new Date(r.date).getTime()) / 86400000;
      return days >= 10;
    })
    .map((r) => ({ company: r.company, role: r.role, date: r.date, status: normStatus(r.status) }));

  return {
    total: rows.length,
    drafted: byStatus["drafted"] ?? 0,
    submitted,
    interviews,
    offers,
    rejected: byStatus["rejected"] ?? 0,
    avgFit: fitN ? Math.round(fitSum / fitN) : null,
    responseRate: submitted ? Math.round((100 * (interviews + offers + (byStatus["rejected"] ?? 0))) / submitted) : null,
    interviewRate: submitted ? Math.round((100 * interviews) / submitted) : null,
    byStatus,
    bySector,
    byChannel,
    byMonth,
    upcoming: upcoming.sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 8),
    quiet: quiet.slice(0, 8),
  };
}

/** Applications with their generated documents, newest first. */
export function readApplications() {
  const { rows } = readTracker();
  return rows
    .map((r) => {
      const docs: { label: string; path: string; exists: boolean }[] = [];
      for (const [label, val] of [
        ["CV", r.cv_file],
        ["Cover letter", r.cover_letter_file],
      ] as const) {
        if (!val) continue;
        const src = val.trim();
        const pdf = src.replace(/\.(tex|typ|md)$/i, ".pdf");
        const p = existsSync(ws(pdf)) ? pdf : src;
        docs.push({ label, path: p, exists: existsSync(ws(p)) });
      }
      const folder = archiveFolder(r.company, r.role);
      return {
        ...r,
        statusNorm: normStatus(r.status),
        docs,
        archive: folder && existsSync(ws("documents", "applications", folder)) ? folder : null,
      };
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

/**
 * The framework's `<company>_<role>` subfolder rule, verbatim from documents/README.md:
 * lowercase, spaces to underscores, every character that is not a letter, digit or
 * underscore *dropped* (so `Novo Nordisk A/S` -> `novo_nordisk_as`), runs of
 * underscores collapsed, leading and trailing underscores trimmed. An empty result
 * means the caller must not create a path at all.
 */
export function archiveFolder(company: string, role: string): string | null {
  const clean = (s: string) =>
    (s || "")
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^\p{L}\p{N}_]+/gu, "")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
  const name = clean(`${company} ${role}`);
  return name || null;
}

/* ------------------------------------------------------------------ portals */

export interface Portal {
  slug: string;
  name: string;
  enabled: boolean;
  installed: boolean;
  market: string;
  note?: string;
}

const PORTAL_META: Record<string, { name: string; market: string; note?: string }> = {
  "jobindex-search": { name: "Jobindex", market: "Denmark" },
  "jobnet-search": { name: "Jobnet", market: "Denmark", note: "Government portal" },
  "jobbank-search": { name: "Akademikernes Jobbank", market: "Denmark" },
  "jobdanmark-search": { name: "Jobdanmark", market: "Denmark" },
  "linkedin-search": { name: "LinkedIn", market: "Anywhere", note: "Public listings. Personal use only, keep volume low." },
  "freehire-search": { name: "freehire", market: "Anywhere", note: "Tech roles, structured results" },
};

export function listPortals(): Portal[] {
  if (!existsSync(PORTAL_DIR)) return [];
  return readdirSync(PORTAL_DIR)
    .filter((d) => existsSync(join(PORTAL_DIR, d, "SKILL.md")))
    .map((slug) => {
      const md = readIfExists(join(PORTAL_DIR, slug, "SKILL.md")) ?? "";
      const fm = md.match(/^---\n([\s\S]*?)\n---/);
      const enabled = !(fm && /^enabled:\s*false\s*$/im.test(fm[1]));
      const meta = PORTAL_META[slug] ?? { name: slug.replace(/-search$/, ""), market: "Unknown" };
      return {
        slug,
        ...meta,
        enabled,
        installed: existsSync(join(PORTAL_DIR, slug, "cli", "node_modules")) ||
          existsSync(join(PORTAL_DIR, slug, "cli", "bun.lock")) ||
          existsSync(join(PORTAL_DIR, slug, "cli", "bun.lockb")),
      };
    })
    .sort((a, b) => (a.market === b.market ? a.name.localeCompare(b.name) : a.market.localeCompare(b.market)));
}

/** Flip a portal's `enabled:` frontmatter key, which is what /scrape honors. */
export function setPortalEnabled(slug: string, enabled: boolean): boolean {
  const p = join(PORTAL_DIR, slug, "SKILL.md");
  const md = readIfExists(p);
  if (!md) return false;
  const fm = md.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return false;
  let block = fm[1];
  if (/^enabled:\s*\S+\s*$/im.test(block)) {
    block = block.replace(/^enabled:\s*\S+\s*$/im, `enabled: ${enabled}`);
  } else {
    block = `${block}\nenabled: ${enabled}`;
  }
  writeFileSafe(p, md.replace(fm[0], `---\n${block}\n---`));
  return true;
}

/* ------------------------------------------------------------------ settings */

export interface StudioSettings {
  location: string;
  remoteOk: boolean;
  displayName: string;
  seenWelcome: boolean;
}

const SETTINGS_PATH = () => join(DATA, "settings.json");

export function readSettings(): StudioSettings {
  const raw = readIfExists(SETTINGS_PATH());
  const def: StudioSettings = { location: "", remoteOk: true, displayName: "", seenWelcome: false };
  if (!raw) return def;
  try {
    return { ...def, ...JSON.parse(raw) };
  } catch {
    return def;
  }
}

export function writeSettings(patch: Partial<StudioSettings>): StudioSettings {
  const next = { ...readSettings(), ...patch };
  writeFileSafe(SETTINGS_PATH(), JSON.stringify(next, null, 2));
  return next;
}

/* ------------------------------------------------------------------ artifacts */

/** PDFs and drafts produced by /apply, newest first. */
export function recentDocuments(limit = 40) {
  const out: { name: string; path: string; modified: number; kind: string }[] = [];
  for (const dir of ["cv", "cover_letters", "upskill"]) {
    const d = ws(dir);
    if (!existsSync(d)) continue;
    for (const name of readdirSync(d)) {
      if (!/\.(pdf|typ|tex|md)$/i.test(name)) continue;
      if (/^(main_example|cover_example)\./.test(name)) continue;
      const st = statSync(join(d, name));
      if (!st.isFile()) continue;
      out.push({
        name,
        path: `${dir}/${name}`,
        modified: st.mtimeMs,
        kind: name.toLowerCase().endsWith(".pdf") ? "pdf" : "source",
      });
    }
  }
  return out.sort((a, b) => b.modified - a.modified).slice(0, limit);
}

/** Files under cv/ and cover_letters/ touched since a timestamp - used to surface run output. */
export function documentsSince(ts: number) {
  return recentDocuments(60).filter((d) => d.modified >= ts);
}

export const upskillReports = () => {
  const d = ws("upskill");
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ name: f, path: `upskill/${f}`, modified: statSync(join(d, f)).mtimeMs }))
    .sort((a, b) => b.modified - a.modified);
};

export { basename };
