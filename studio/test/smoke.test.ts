/**
 * Smoke tests for the parts of Job Studio where a silent mistake would be
 * expensive: the framework's file formats, the path guard, and the prompt builder.
 *
 *   cd studio && bun test
 */

import { expect, test, describe } from "bun:test";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { archiveFolder, normStatus, parseCsv, safeWorkspacePath, toCsv, TRACKER_HEADER, WORKSPACE } from "../src/store.ts";
import { buildPrompt, TASKS } from "../src/tasks.ts";
import { humanizeTool } from "../src/agent.ts";
import { interpretTurnEnd } from "../src/runs.ts";
import { atsCheck } from "../src/pdf.ts";

describe("tracker CSV", () => {
  test("survives a note containing commas and quotes", () => {
    const rows = [
      TRACKER_HEADER.split(","),
      ["2026-09-01", "Acme A/S", "retail", "Analyst", "", "portal", "applied", "", "78", 'Called them, spoke to "Jens"', "cv/main_x.typ", "cover_letters/cover_x.typ", "https://x.test/1", "2026-09-30"],
    ];
    const parsed = parseCsv(toCsv(rows));
    expect(parsed).toEqual(rows);
    expect(parsed[1][9]).toBe('Called them, spoke to "Jens"');
  });

  test("ignores blank trailing lines", () => {
    expect(parseCsv("a,b\n1,2\n\n").length).toBe(2);
  });

  test("normalises the legacy space spellings", () => {
    expect(normStatus("no response")).toBe("no_response");
    expect(normStatus("Offer Declined")).toBe("offer_declined");
  });
});

describe("archive folder rule", () => {
  test("drops stray characters rather than replacing them", () => {
    // documents/README.md's own worked example.
    expect(archiveFolder("Novo Nordisk A/S", "Data Analyst")).toBe("novo_nordisk_as_data_analyst");
  });

  test("collapses and trims underscores", () => {
    expect(archiveFolder("  Acme   Corp!!  ", " ML  Engineer ")).toBe("acme_corp_ml_engineer");
  });

  test("keeps non-ASCII letters, which are still letters", () => {
    expect(archiveFolder("Ørsted", "Analytiker")).toBe("ørsted_analytiker");
  });

  test("refuses to build a path from punctuation alone", () => {
    expect(archiveFolder("///", "***")).toBeNull();
  });
});

describe("path guard", () => {
  test("keeps requests inside the workspace", () => {
    expect(safeWorkspacePath("cv/main_example.tex")).toBe(join(WORKSPACE, "cv/main_example.tex"));
  });

  test("blocks traversal", () => {
    expect(safeWorkspacePath("../../../etc/passwd")).toBeNull();
    expect(safeWorkspacePath("../studio/.data/settings.json")).toBeNull();
  });
});

describe("prompt builder", () => {
  test("inlines the workflow definition and the arguments", () => {
    const { prompt, error } = buildPrompt("apply", "https://example.test/job/1");
    expect(error).toBeUndefined();
    expect(prompt).toContain("<workflow name=\"apply\">");
    expect(prompt).toContain("https://example.test/job/1");
    // A real step from apply.md proves the file was read, not paraphrased.
    expect(prompt).toContain("Compile & Inspect PDFs");
    expect(prompt).toContain("Never use the AskUserQuestion tool");
  });

  test("refuses a task whose argument is required and missing", () => {
    expect(buildPrompt("apply", "").error).toBeTruthy();
    expect(buildPrompt("interview", "  ").error).toBeTruthy();
  });

  test("maps studio-specific arguments onto the command's own vocabulary", () => {
    expect(buildPrompt("setupSection", "search").prompt).toContain("--section search");
    expect(buildPrompt("followup", "").prompt).toContain("followup");
  });

  test("skill tasks point at the skill file instead of inlining it", () => {
    const { prompt } = buildPrompt("scrape", "marketing");
    expect(prompt).toContain(".claude/skills/job-scraper/SKILL.md");
    expect(prompt).toContain("marketing");
  });

  test("every task resolves to a real workflow file", () => {
    for (const [id, task] of Object.entries(TASKS)) {
      const { prompt, error } = buildPrompt(id, task.argRequired ? "placeholder" : "");
      expect(error, `task ${id}`).toBeUndefined();
      expect(prompt.length, `task ${id}`).toBeGreaterThan(80);
    }
  });
});

describe("activity labels", () => {
  test("names the portal a search is hitting", () => {
    expect(humanizeTool("Bash", { command: "bun run .agents/skills/jobindex-search/cli/src/cli.ts search -q x" })?.text).toBe("Searching Jobindex");
  });

  test("recognises the PDF build", () => {
    expect(humanizeTool("Bash", { command: "cd cv && typst compile main_a_b.typ main_a_b.pdf" })?.text).toBe("Building the PDF");
  });

  test("translates internal filenames into her words", () => {
    expect(humanizeTool("Read", { file_path: "/x/01-candidate-profile.md" })?.text).toBe("Reading your profile");
    expect(humanizeTool("Write", { file_path: "/x/cover_letters/cover_acme_analyst.typ" })?.text).toBe("Writing your cover letter");
  });
});

describe("PDF checks", () => {
  test("reads the text layer of a Typst-built document in order", async () => {
    const pdf = join(WORKSPACE, "templates", "cv", "studio-clean", "_selftest.pdf");
    const src = join(WORKSPACE, "templates", "cv", "studio-clean", "template.typ");
    if (!existsSync(src)) return; // templates not installed yet
    const proc = Bun.spawnSync(["typst", "compile", src, pdf]);
    if (proc.exitCode !== 0) return; // no typst on this machine
    const r = await atsCheck(pdf, 1);
    expect(r.pages).toBe(1);
    expect(r.chars).toBeGreaterThan(400);
    expect(r.findings.find((f) => f.label === "Fonts")?.level).toBe("pass");
    // Reading order: the profile section must extract before experience.
    expect(r.text.indexOf("PROFILE")).toBeLessThan(r.text.indexOf("EXPERIENCE"));
    await Bun.file(pdf).delete();
  });
});

describe("end of a turn", () => {
  test("a declared finish is a finish", () => {
    expect(interpretTurnEnd("Both documents are ready. Next: record the outcome.\n\n[DONE]", 0)).toBe("done");
  });

  test("a question waits for her", () => {
    expect(interpretTurnEnd("Should I proceed with drafting the CV and cover letter for this role?", 0)).toBe("ask");
    expect(interpretTurnEnd("Three ways to start:\n1) Read my documents\n2) Paste a CV\n3) Interview me", 0)).toBe("ask");
  });

  test("stopping mid-workflow carries on by itself", () => {
    // The exact message that stranded a real /apply run halfway through.
    expect(interpretTurnEnd("I'll apply its feedback as soon as it reports back.", 0)).toBe("continue");
  });

  test("but not forever", () => {
    expect(interpretTurnEnd("Still working on it.", 3)).toBe("ask");
  });
});
