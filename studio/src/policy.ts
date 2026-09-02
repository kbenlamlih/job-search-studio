/**
 * policy.ts - the one place that decides what the agent may touch.
 *
 * Why a policy at all, rather than the allow-list in settings alone: this framework
 * keeps her whole profile in `.claude/skills/job-application-assistant/*.md`, and
 * Claude Code hard-blocks writes inside any `.claude/` directory - no `allow` rule can
 * pre-approve them. That guardrail is a good one (it stops an agent rewriting its own
 * configuration), but headless it means /setup writes CLAUDE.md and then silently fails
 * on the files that *are* the profile.
 *
 * So Job Studio decides for itself, through a PreToolUse hook (see permission-hook.ts),
 * with this explicit policy instead of a blanket --dangerously-skip-permissions. The
 * default is refusal: anything not named here is denied, so the failure mode is a
 * refusal she can see rather than a surprise write.
 */

import { resolve, sep } from "node:path";

export type Decision = { allow: true; why: string } | { allow: false; why: string };

/**
 * Never writable, whatever the agent's reasoning. Everything else inside the workspace
 * is: the framework's workflows write to the root, to profile/, cv/, cover_letters/,
 * documents/, job_scraper/, templates/, upskill/, company_research/, gmail_sync/ and
 * .agents/skills/, and /add-portal invents new paths by design. Enumerating the
 * permitted ones would break a workflow every time upstream adds an output.
 */
const FORBIDDEN: RegExp[] = [
  /^\.claude\/settings(\.local|\.studio)?\.json$/, // no rewriting its own permissions
  /^\.claude\/commands\//, // the workflow definitions are not the agent's to edit
  /^\.claude\/skills\/[^/]+\/SKILL\.md$/, // nor the skill contracts
  /^\.git\//,
];

function relativeToWorkspace(raw: unknown, workspace: string): { rel: string | null; why: string } {
  if (typeof raw !== "string" || !raw.trim()) return { rel: null, why: "no file path given" };
  const abs = resolve(workspace, raw);
  if (abs !== workspace && !abs.startsWith(workspace + sep)) {
    return { rel: null, why: "that file is outside your Job Studio folder" };
  }
  return { rel: abs.slice(workspace.length + 1).split(sep).join("/"), why: "" };
}

export function decide(toolName: string, input: any, workspace: string): Decision {
  const ws = resolve(workspace);

  switch (toolName) {
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit": {
      const { rel, why } = relativeToWorkspace(input?.file_path ?? input?.notebook_path, ws);
      if (rel === null) return { allow: false, why };
      if (FORBIDDEN.some((re) => re.test(rel)))
        return { allow: false, why: `${rel} is part of how Job Studio works and cannot be changed from here` };
      return { allow: true, why: `writing ${rel}` };
    }

    case "Read":
    case "NotebookRead": {
      const { rel, why } = relativeToWorkspace(input?.file_path ?? input?.notebook_path, ws);
      if (rel === null) return { allow: false, why };
      return { allow: true, why: `reading ${rel}` };
    }

    // Anything else keeps whatever the settings file decided; the hook stays out of it.
    default:
      return { allow: false, why: `${toolName} is not the policy's business` };
  }
}

/** Tools the hook has an opinion about. Everything else is left to settings. */
export const HOOKED_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit"];
