/**
 * templates.ts - installs the Typst CV and cover-letter templates into the workspace
 * and activates them the way /add-template does.
 *
 * Why not LaTeX: the framework ships moderncv + a custom cover.cls, which needs a full
 * TeX distribution (multi-GB, and a reliable source of pain on Windows). /apply is
 * already template-agnostic - it reads an ACTIVE-TEMPLATE block for the source extension
 * and compile command - so pointing it at Typst gives the same output from a single
 * 40 MB binary. The stock LaTeX templates stay in the workspace untouched, so switching
 * back later is one edit away.
 */

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PROFILE_DIR, ROOT, readIfExists, writeFileSafe, ws } from "./store.ts";

const NAME = "studio-clean";
const ASSETS = join(ROOT, "studio", "assets", "templates");

const TARGETS = [
  {
    type: "cv" as const,
    guidance: "05-cv-templates.md",
    pages: 2,
    output: "cv/main_<company>_<role>.typ",
    compile: "cd cv && typst compile main_<company>_<role>.typ main_<company>_<role>.pdf",
  },
  {
    type: "cover_letters" as const,
    guidance: "06-cover-letter-templates.md",
    pages: 1,
    output: "cover_letters/cover_<company>_<role>.typ",
    compile: "cd cover_letters && typst compile cover_<company>_<role>.typ cover_<company>_<role>.pdf",
  },
];

const FONTS = "Helvetica Neue / Helvetica / Arial, falling back to Typst's bundled New Computer Modern - no font files to install";

function block(t: (typeof TARGETS)[number]): string {
  return [
    "<!-- BEGIN ACTIVE-TEMPLATE (managed by /add-template - do not edit by hand) -->",
    `> **Active template override: \`${NAME}\`**`,
    ">",
    "> A custom template is active. Where this block conflicts with the stock guidance below, this block wins. Structural advice below (tailoring, page-budget, cutting rules) still applies.",
    ">",
    `> - **Template skeleton:** \`templates/${t.type}/${NAME}/template.typ\` — use this as the structural reference instead of the stock template`,
    `> - **Manifest:** \`templates/${t.type}/${NAME}/TEMPLATE.md\` — read this for style rules and known pitfalls before drafting`,
    "> - **Source extension:** `.typ` (Typst, not LaTeX)",
    `> - **Compile command:** \`${t.compile}\` (not the command named in the stock guidance below — \`/apply\`'s compile step must use this instead)`,
    `> - **Fonts:** ${FONTS}`,
    `> - **Page limit:** exactly ${t.pages} page${t.pages === 1 ? "" : "s"}`,
    `> - **Output file:** \`${t.output}\`; the template is self-contained, so nothing needs copying alongside it`,
    "<!-- END ACTIVE-TEMPLATE -->",
  ].join("\n");
}

/** Copy the skeleton + manifest into workspace/templates/. Idempotent. */
export function installTemplates(): { ok: boolean; message: string } {
  if (!existsSync(ASSETS)) return { ok: false, message: "Template assets are missing from the app." };
  for (const t of TARGETS) {
    const dest = ws("templates", t.type, NAME);
    mkdirSync(dest, { recursive: true });
    cpSync(join(ASSETS, t.type, "template.typ"), join(dest, "template.typ"));
    cpSync(join(ASSETS, t.type, "TEMPLATE.md"), join(dest, "TEMPLATE.md"));
  }
  return { ok: true, message: "Templates installed." };
}

/** Insert or replace the ACTIVE-TEMPLATE managed block in the two guidance files. */
export function activateTemplates(): { ok: boolean; message: string } {
  const install = installTemplates();
  if (!install.ok) return install;

  for (const t of TARGETS) {
    const path = join(PROFILE_DIR, t.guidance);
    const md = readIfExists(path);
    if (!md) return { ok: false, message: `Missing guidance file: ${t.guidance}` };

    const managed = block(t);
    let next: string;
    if (/<!-- BEGIN ACTIVE-TEMPLATE[\s\S]*?<!-- END ACTIVE-TEMPLATE -->/.test(md)) {
      next = md.replace(/<!-- BEGIN ACTIVE-TEMPLATE[\s\S]*?<!-- END ACTIVE-TEMPLATE -->/, managed);
    } else {
      // Immediately after the H1, per /add-template's activation rule.
      const h1 = md.match(/^#\s+.*$/m);
      next = h1
        ? md.replace(h1[0], `${h1[0]}\n\n${managed}`)
        : `${managed}\n\n${md}`;
    }
    if (next !== md) writeFileSafe(path, next);
  }
  return { ok: true, message: "Your CV and cover letter design is wired up." };
}

/** Remove the managed blocks, restoring the stock LaTeX guidance. */
export function deactivateTemplates(): { ok: boolean; message: string } {
  for (const t of TARGETS) {
    const path = join(PROFILE_DIR, t.guidance);
    const md = readIfExists(path);
    if (!md) continue;
    const next = md.replace(/<!-- BEGIN ACTIVE-TEMPLATE[\s\S]*?<!-- END ACTIVE-TEMPLATE -->\n*/g, "");
    if (next !== md) writeFileSafe(path, next);
  }
  return { ok: true, message: "Back to the stock LaTeX templates. You'll need a LaTeX install for those." };
}

export function templatesActive(): boolean {
  return TARGETS.every((t) =>
    /BEGIN ACTIVE-TEMPLATE/.test(readIfExists(join(PROFILE_DIR, t.guidance)) ?? ""),
  );
}
