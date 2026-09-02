/**
 * doctor.ts - "is this machine ready?" checks, phrased for someone who does not code.
 *
 * Every check returns a plain-language status and, where possible, a fix the app can
 * run itself. The three binaries (claude, bun, typst) are the installer's job; by the
 * time this code runs, bun is obviously present, so the checks that actually matter at
 * runtime are: is Claude logged in, is Typst there, are the job-board tools installed,
 * and are the PDF templates wired up.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PORTAL_DIR, PROFILE_DIR, WORKSPACE, listPortals, readIfExists, ws } from "./store.ts";

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  /** Action id the UI can POST to /api/doctor/fix. */
  fix?: string;
  fixLabel?: string;
  /** A blocker stops the main workflows; a warning does not. */
  severity: "blocker" | "warning" | "info";
}

export function run(cmd: string, args: string[], opts: { cwd?: string; timeout?: number } = {}) {
  return new Promise<{ code: number; out: string; err: string }>((resolve) => {
    let out = "";
    let err = "";
    let done = false;
    const p = spawn(cmd, args, { cwd: opts.cwd ?? WORKSPACE, env: process.env });
    const finish = (code: number) => {
      if (done) return;
      done = true;
      resolve({ code, out, err });
    };
    p.stdout?.on("data", (d) => (out += d));
    p.stderr?.on("data", (d) => (err += d));
    p.on("error", (e) => {
      err += e.message;
      finish(127);
    });
    p.on("close", (c) => finish(c ?? 0));
    if (opts.timeout) setTimeout(() => { try { p.kill(); } catch {} finish(124); }, opts.timeout);
  });
}

const version = async (cmd: string, args = ["--version"]) => {
  const r = await run(cmd, args, { timeout: 15000 });
  return r.code === 0 ? r.out.trim().split("\n")[0] : null;
};

export async function checks(): Promise<Check[]> {
  const out: Check[] = [];

  const claude = await version("claude");
  out.push({
    id: "claude",
    label: "Claude",
    ok: !!claude,
    detail: claude ? `Installed (${claude.split(" ")[0]})` : "Not found. Run the installer again.",
    severity: "blocker",
  });

  const bun = await version("bun");
  out.push({
    id: "bun",
    label: "Job board search tools",
    ok: !!bun,
    detail: bun ? `Ready (Bun ${bun})` : "Not found. Run the installer again.",
    severity: "blocker",
  });

  const typst = await version("typst");
  out.push({
    id: "typst",
    label: "PDF builder",
    ok: !!typst,
    detail: typst ? `Ready (${typst})` : "Not found - your CV can't be turned into a PDF until this is installed.",
    fix: typst ? undefined : "install-typst",
    fixLabel: "Install it for me",
    severity: "blocker",
  });

  const portals = listPortals();
  const missing = portals.filter((p) => !p.installed);
  out.push({
    id: "portal-deps",
    label: "Job boards",
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? `${portals.filter((p) => p.enabled).length} of ${portals.length} switched on`
        : `${missing.length} need a one-time download: ${missing.map((m) => m.name).join(", ")}`,
    fix: missing.length ? "install-portals" : undefined,
    fixLabel: "Download them now",
    severity: missing.length ? "warning" : "info",
  });

  const cvActive = /BEGIN ACTIVE-TEMPLATE/.test(readIfExists(join(PROFILE_DIR, "05-cv-templates.md")) ?? "");
  const clActive = /BEGIN ACTIVE-TEMPLATE/.test(readIfExists(join(PROFILE_DIR, "06-cover-letter-templates.md")) ?? "");
  const templatesPresent =
    existsSync(ws("templates", "cv", "studio-clean", "template.typ")) &&
    existsSync(ws("templates", "cover_letters", "studio-clean", "template.typ"));
  out.push({
    id: "templates",
    label: "CV and letter design",
    ok: cvActive && clActive && templatesPresent,
    detail:
      cvActive && clActive && templatesPresent
        ? "Using the built-in clean design"
        : "Not wired up yet - documents would fail to build.",
    fix: templatesPresent && (!cvActive || !clActive) ? "activate-templates" : undefined,
    fixLabel: "Fix it",
    severity: "blocker",
  });

  const gitOk = existsSync(join(WORKSPACE, ".git"));
  out.push({
    id: "workspace",
    label: "Your folder",
    ok: existsSync(WORKSPACE) && existsSync(ws(".claude", "commands", "apply.md")),
    detail: existsSync(ws(".claude", "commands", "apply.md"))
      ? gitOk
        ? "Everything in place, updates available"
        : "Everything in place"
      : "The job search framework is missing from workspace/.",
    severity: "blocker",
  });

  return out;
}

/** A cheap live call that proves she is logged in and has allowance left. */
export async function testConnection() {
  const env = { ...process.env } as Record<string, string | undefined>;
  for (const k of [
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_AGENT_SDK_VERSION",
  ])
    delete env[k];

  const r = await new Promise<{ code: number; out: string; err: string }>((resolve) => {
    let out = "";
    let err = "";
    const p = spawn("claude", ["-p", "Reply with exactly: READY", "--output-format", "json", "--model", "haiku"], {
      cwd: WORKSPACE,
      env: env as NodeJS.ProcessEnv,
    });
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => resolve({ code: 127, out, err: e.message }));
    p.on("close", (c) => resolve({ code: c ?? 0, out, err }));
    setTimeout(() => { try { p.kill(); } catch {} resolve({ code: 124, out, err: "timeout" }); }, 90000);
  });

  if (r.code === 127) return { ok: false, message: "Claude isn't installed on this computer yet." };
  if (r.code === 124) return { ok: false, message: "Claude took too long to answer. Check your internet connection." };

  let parsed: any = null;
  try {
    parsed = JSON.parse(r.out.trim().split("\n").filter(Boolean).pop() ?? "");
  } catch {
    /* fall through */
  }
  const blob = `${r.out}\n${r.err}`;
  if (/not logged in|please run.*login|authentication|invalid api key|oauth/i.test(blob) && !parsed?.result) {
    return { ok: false, message: "You're not signed in to Claude yet. Close the app and run the installer's sign-in step." };
  }
  if (parsed?.is_error || !parsed?.result) {
    return { ok: false, message: `Claude answered with an error: ${(parsed?.result ?? r.err ?? "unknown").toString().slice(0, 300)}` };
  }
  return {
    ok: true,
    message: "Connected to Claude and signed in.",
    model: Object.keys(parsed.modelUsage ?? {}).join(", "),
  };
}

/* -------------------------------------------------------------------- fixes */

export async function applyFix(id: string): Promise<{ ok: boolean; message: string }> {
  switch (id) {
    case "install-portals": {
      const portals = listPortals().filter((p) => !p.installed);
      const failed: string[] = [];
      for (const p of portals) {
        const r = await run("bun", ["install"], { cwd: join(PORTAL_DIR, p.slug, "cli"), timeout: 240000 });
        if (r.code !== 0) failed.push(p.name);
      }
      return failed.length
        ? { ok: false, message: `Couldn't set up: ${failed.join(", ")}. Check your internet connection and try again.` }
        : { ok: true, message: "All job boards are ready." };
    }
    case "install-typst": {
      const plat = process.platform;
      if (plat === "darwin") {
        const brew = await version("brew");
        if (brew) {
          const r = await run("brew", ["install", "typst"], { timeout: 600000 });
          if (r.code === 0) return { ok: true, message: "PDF builder installed." };
        }
        return { ok: false, message: "Couldn't install it automatically. Run the installer again - it handles this." };
      }
      if (plat === "win32") {
        const r = await run("winget", ["install", "--id", "Typst.Typst", "-e", "--accept-package-agreements", "--accept-source-agreements"], { timeout: 600000 });
        return r.code === 0
          ? { ok: true, message: "PDF builder installed. Restart Job Studio." }
          : { ok: false, message: "Couldn't install it automatically. Run the installer again - it handles this." };
      }
      return { ok: false, message: "Please install Typst manually: https://github.com/typst/typst/releases" };
    }
    case "activate-templates": {
      const { activateTemplates } = await import("./templates.ts");
      return activateTemplates();
    }
    default:
      return { ok: false, message: `Unknown fix: ${id}` };
  }
}
