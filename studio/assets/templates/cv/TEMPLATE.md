# Template: studio-clean

- **Type:** CV
- **Source extension:** .typ
- **Engine/toolchain:** typst (display label only)
- **Page limit:** 2 page(s)
- **Fonts:** Helvetica Neue / Helvetica / Arial, falling back to Typst's bundled New Computer Modern (system font - no font files to install; Arial ships with Windows and macOS)
- **Class/packages:** standard - no imports, no local packages. The template is self-contained, so a copy placed anywhere compiles unchanged.

## Compile command

    cd cv && typst compile main_<company>_<role>.typ main_<company>_<role>.pdf

## Style rules

- Single column, always. An ATS reads the PDF text layer, and a sidebar or a two-column layout interleaves lines from different sections when extracted. This template's extraction order matches its visual order; keep it that way.
- Contact details are printed as plain text in `cv-contact`, never as icons. An email carried only by an icon glyph or a link target is invisible to a parser.
- Personal details live in the `#let` block at the top (`cv-name`, `cv-headline`, `cv-contact`). Fill those in rather than writing the name into the layout below.
- Section order: Profile, Experience, Education, Skills, Languages. Reorder only when a posting makes a different order obviously better (e.g. a recent graduate leading with Education).
- Every job, degree or project goes through `#entry(role:, org:, dates:, place:)[...]`, which is `breakable: false` so a title can never orphan away from its bullets.
- Bullets go through `#bullets(...)`, one `[...]` per bullet. Achievement first, then the number, where an honest number exists.
- Dates use the same format throughout the document, e.g. `Mar 2023 - Present`.
- Accent colour is `accent` at the top (`#20415e`). One accent colour, used for the name, section headings and rules. Do not add a second.

## Compile-and-fit levers

Change these in order. Never reduce the page margins, and never drop `leading` below `0.5em`.

1. `body-size`: `10pt` default. Drop to `9.6pt` to pull content back onto 2 pages, raise to `10.4pt` to fill a thin second page.
2. `lead`: `0.62em` default, `0.56em` when tighter is needed.
3. `section-gap`: `0.95em` default, `0.75em` when tighter is needed.
4. Cut the least relevant bullet, scored by relevance to this posting, uniqueness in the document, and whether the cover letter depends on it.

## Known pitfalls

- **Square brackets are content syntax in Typst.** A literal `[PLACEHOLDER]` written in markup renders as its contents with the brackets stripped. Placeholder tokens therefore live inside quoted strings (`#let cv-name = "[YOUR_NAME]"`), which is also where the drafter should write the real values. If a literal bracket is ever needed in prose, escape it: `\[`.
- **`@` in markup is a label reference, so an unescaped email address fails the compile** with `label <example.com> does not exist`. Contact details belong in the `cv-contact` strings, where `@` is literal. If an address must appear in prose, escape it: `name\@example.com`.
- `#entry(...)` takes its bullets as a trailing content block, so the closing `]` must be on its own line after `#bullets(...)`. A missing `]` produces an "unclosed delimiter" error pointing at the end of the file rather than at the entry.
- `#bullets()` with zero items is an error. Call `#entry(...)[]` with an empty block, or omit the body, for an entry with no bullets.
- A two-page CV whose second page holds only one short section reads as padding. Either fill it to at least a third, or tighten to a single page.
- Typst caches fonts per run; there is nothing to clean up after a compile beyond the PDF itself (no `.aux`/`.log` equivalents).
