/**
 * tasks.ts - turns a button in the UI into a prompt for the agent.
 *
 * The framework's workflows live in workspace/.claude/commands/*.md (slash commands)
 * and .claude/skills/<name>/SKILL.md (skills). Rather than typing "/apply" and hoping
 * the CLI expands it the same way in headless mode, we read the definition off disk and
 * hand it to the agent inline. Same instructions, no dependence on CLI slash-command
 * behavior, and the workflow file stays the single source of truth - upstream can change
 * apply.md and Job Studio picks it up with no code change.
 */

import { join } from "node:path";
import { readIfExists, ws, WORKSPACE } from "./store.ts";

export interface TaskDef {
  id: string;
  title: string;
  /** One line she reads on the button. */
  blurb: string;
  /** Where the definition comes from. */
  kind: "command" | "skill" | "prompt";
  source?: string;
  /** Free text the UI collects (job URL, company name, ...). */
  argLabel?: string;
  argPlaceholder?: string;
  argRequired?: boolean;
  /** Roughly how long she should expect to wait. */
  eta?: string;
  /** Shown as a warning before starting. */
  caution?: string;
}

export const TASKS: Record<string, TaskDef> = {
  setup: {
    id: "setup",
    title: "Build my profile",
    blurb: "Reads everything you uploaded and builds your profile. Ask me anything it can't find.",
    kind: "command",
    source: "setup",
    eta: "5-15 minutes",
  },
  setupSection: {
    id: "setupSection",
    title: "Update one part of my profile",
    blurb: "Re-do a single section, like what you're looking for.",
    kind: "command",
    source: "setup",
    argLabel: "Which section?",
    argPlaceholder: "search",
    eta: "3-5 minutes",
  },
  expand: {
    id: "expand",
    title: "Find skills I forgot to mention",
    blurb: "Looks at links already in your profile (GitHub, portfolio, courses) and adds what it finds.",
    kind: "command",
    source: "expand",
    eta: "5-10 minutes",
  },
  scrape: {
    id: "scrape",
    title: "Find new jobs",
    blurb: "Searches the job boards you turned on and saves anything new.",
    kind: "skill",
    source: "job-scraper",
    argLabel: "Focus on anything in particular? (optional)",
    argPlaceholder: "e.g. marketing, remote, part-time - or leave empty",
    eta: "5-15 minutes",
  },
  rank: {
    id: "rank",
    title: "Score the new jobs",
    blurb: "Scores every new job against your profile and sorts them best-first.",
    kind: "command",
    source: "rank",
    eta: "5-20 minutes",
  },
  apply: {
    id: "apply",
    title: "Write my application",
    blurb: "Checks the fit, writes a tailored CV and cover letter, has a second Claude critique them, then builds the PDFs.",
    kind: "command",
    source: "apply",
    argLabel: "Job link, or paste the whole advert",
    argPlaceholder: "https://... or paste the job description",
    argRequired: true,
    eta: "10-25 minutes",
  },
  interview: {
    id: "interview",
    title: "Prepare me for an interview",
    blurb: "Builds a prep pack from the actual advert and your documents, then runs a mock interview.",
    kind: "command",
    source: "interview",
    argLabel: "Which company?",
    argPlaceholder: "e.g. Novo Nordisk",
    argRequired: true,
    eta: "5-15 minutes",
  },
  outcome: {
    id: "outcome",
    title: "Record what happened",
    blurb: "Log an interview, an offer, a rejection or silence, and file the documents away.",
    kind: "command",
    source: "outcome",
    argLabel: "Company (and what happened, if you like)",
    argPlaceholder: "e.g. Novo Nordisk - got invited to a first interview",
    argRequired: true,
    eta: "2-5 minutes",
  },
  followup: {
    id: "followup",
    title: "Chase up quiet applications",
    blurb: "Finds applications that have gone quiet and drafts a polite nudge. Never sends anything.",
    kind: "command",
    source: "outcome",
    eta: "3-8 minutes",
  },
  upskill: {
    id: "upskill",
    title: "What should I learn next?",
    blurb: "Compares your profile with the jobs you're chasing and builds a learning plan.",
    kind: "skill",
    source: "upskill",
    argLabel: "A specific job link (optional)",
    argPlaceholder: "leave empty to use all your saved jobs",
    eta: "5-15 minutes",
  },
  htmlReport: {
    id: "htmlReport",
    title: "Make a shareable report",
    blurb: "Builds a single-file dashboard you can email or open offline.",
    kind: "command",
    source: "html-report",
    eta: "2-5 minutes",
  },
  addPortal: {
    id: "addPortal",
    title: "Add a job board",
    blurb: "Teaches the app to search another job site. Give it the site's address.",
    kind: "command",
    source: "add-portal",
    argLabel: "Job board web address",
    argPlaceholder: "e.g. https://www.stepstone.de",
    argRequired: true,
    eta: "10-20 minutes",
    caution: "This writes new search code. It test-runs a live search before switching it on.",
  },
  gmailSync: {
    id: "gmailSync",
    title: "Check my email for replies",
    blurb: "Reads your Gmail for interview invites, offers and rejections, and proposes updates for you to approve.",
    kind: "command",
    source: "gmail-sync",
    eta: "3-10 minutes",
    caution: "Needs the Gmail connector switched on in Claude first. Nothing is ever sent or deleted.",
  },
  notionSync: {
    id: "notionSync",
    title: "Publish to Notion",
    blurb: "Copies your pipeline into a Notion database you can check from your phone.",
    kind: "command",
    source: "notion-sync",
    eta: "3-10 minutes",
    caution: "Needs the Notion connector switched on in Claude first. One-way: nothing syncs back.",
  },
  reset: {
    id: "reset",
    title: "Start over",
    blurb: "Wipes your profile, your uploaded documents, or both. Claude shows you exactly what goes first.",
    kind: "command",
    source: "reset",
    argLabel: "What should go?",
    argPlaceholder: "profile, documents, or all",
    argRequired: true,
    eta: "1-2 minutes",
    caution: "Nothing is deleted until you type RESET in the chat box to confirm. Your applications and tracker are kept either way.",
  },
  ask: {
    id: "ask",
    title: "Ask anything",
    blurb: "Career questions, rewrite a paragraph, explain a job advert.",
    kind: "prompt",
    argLabel: "What do you want to ask?",
    argRequired: true,
  },
};

const PREAMBLE = `You are running one job of the Job Studio app for the person who owns this folder.`;

/** Read a slash-command definition and inline it, so headless behavior matches the CLI. */
function commandBody(name: string): string | null {
  return readIfExists(ws(".claude", "commands", `${name}.md`));
}

export function buildPrompt(taskId: string, args: string): { prompt: string; error?: string } {
  const task = TASKS[taskId];
  if (!task) return { prompt: "", error: `Unknown task: ${taskId}` };
  const arg = (args ?? "").trim();
  if (task.argRequired && !arg) return { prompt: "", error: `${task.title} needs ${task.argLabel}.` };

  if (task.kind === "prompt") {
    return {
      prompt: [
        PREAMBLE,
        "",
        "She asked:",
        "",
        arg,
        "",
        "Answer using her profile in this folder where it is relevant (read it if you need it).",
        "If the answer means changing one of her documents or her profile, do it and say what you changed.",
      ].join("\n"),
    };
  }

  if (task.kind === "skill") {
    const skillPath = join(".claude", "skills", task.source!, "SKILL.md");
    const exists = readIfExists(ws(skillPath));
    if (!exists) return { prompt: "", error: `Missing workflow file: ${skillPath}` };
    return {
      prompt: [
        PREAMBLE,
        "",
        `Run the **${task.source}** workflow now.`,
        "",
        `Read \`${skillPath}\` in full first, then follow its execution steps exactly and in order,`,
        "including every file it tells you to read and every state file it tells you to write.",
        arg ? `\nArguments for this run: ${arg}` : "\nNo extra arguments for this run: use the defaults.",
        "",
        "When the workflow says to ask her something, end your turn with the question in plain words",
        "and wait for her reply. Never use the AskUserQuestion tool.",
      ].join("\n"),
    };
  }

  const body = commandBody(task.source!);
  if (!body) return { prompt: "", error: `Missing workflow file: .claude/commands/${task.source}.md` };

  // Task-specific arguments, mapped onto what the command expects in $ARGUMENTS.
  let commandArgs = arg;
  if (taskId === "setupSection") commandArgs = `--section ${arg || "search"}`;
  if (taskId === "followup") commandArgs = "followup";
  const filled = body.replaceAll("$ARGUMENTS", commandArgs);

  return {
    prompt: [
      PREAMBLE,
      "",
      `Run the project's \`/${task.source}\` workflow now. Its definition is between the <workflow> tags`,
      "below and is authoritative: follow every step in order and skip nothing that it marks mandatory.",
      "",
      `<workflow name="${task.source}">`,
      filled,
      "</workflow>",
      "",
      commandArgs
        ? `The workflow's \`$ARGUMENTS\` for this run: ${commandArgs}`
        : "This run has no `$ARGUMENTS`.",
      "",
      "Where the workflow asks her a question, end your turn with that question in plain words and wait",
      "for her reply. Never use the AskUserQuestion tool, and never ask her to run a command herself.",
    ].join("\n"),
  };
}

/** Free-text follow-up inside an existing run. */
export const followUpPrompt = (text: string) => text;

export const workspaceRoot = WORKSPACE;
