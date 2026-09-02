# Template: studio-clean

- **Type:** Cover letter
- **Source extension:** .typ
- **Engine/toolchain:** typst (display label only)
- **Page limit:** 1 page(s)
- **Fonts:** Helvetica Neue / Helvetica / Arial, falling back to Typst's bundled New Computer Modern (system font - no font files to install; Arial ships with Windows and macOS)
- **Class/packages:** standard - no imports, no local packages. The template is self-contained, so a copy placed anywhere compiles unchanged.

## Compile command

    cd cover_letters && typst compile cover_<company>_<role>.typ cover_<company>_<role>.pdf

## Style rules

- One page. Always. The signature block must be visible on that page, never pushed to a second.
- Sender, recipient, subject and date live in the `#let` blocks at the top (`sender`, `recipient`, `subject`, `letter-date`). Fill those in rather than writing them into the layout.
- `recipient.name` is the full salutation without its comma, e.g. `Dear Ms Jensen` or `Dear Hiring Manager` - the template appends the comma. Address a named person whenever the posting names one.
- `subject` follows `Application: <role title>`, in the language of the posting.
- Matches the language of the job advert, not the language of the CV.
- Four paragraphs is the target shape: opening (why this role, this company, now, with one verified specific about them), two middle paragraphs answering the advert's stated requirements with evidence, and a close stating what happens next plus availability.
- No em-dashes, no cliches, no thanking them for their time twice, no apologetic hedging.
- Same accent colour as the CV (`#20415e`), used only for the name and the rule under the header.

## Compile-and-fit levers

Change these in order. Never reduce the page margins.

1. `body-size`: `10.5pt` default, `10pt` when the letter runs long.
2. `lead`: `0.72em` default, `0.65em` when tighter is needed.
3. `para-gap`: `0.75em` default, `0.6em` when tighter is needed.
4. Cut the sentence that repeats what a CV bullet already says. Then cut a bullet or clause that does not hit the posting's language. Never cut the availability sentence or the signature.

## Known pitfalls

- **Square brackets are content syntax in Typst.** Placeholder tokens live inside quoted strings (`"[COMPANY]"`), which is where the drafter writes the real values too. A literal bracket in prose must be escaped as `\[`.
- **`@` in markup is a label reference, so an unescaped email address fails the compile** with `label <example.com> does not exist`. Contact details belong in the `sender` strings, where `@` is literal. In prose, escape it: `name\@example.com`.
- Paragraphs are separated by a blank line. Two lines of text with no blank line between them become one paragraph, which silently merges an argument the reader was meant to take in two beats.
- A bulleted list inside the body is allowed (`#list([...], [...])`) and inherits the body font, unlike the LaTeX template this replaces. Keep it to one short list; a cover letter that is mostly bullets reads as a CV.
- If the letter spills to a second page by two or three lines, the fit levers above handle it. If it spills by a paragraph, it is too long: cut, do not compress.
- Typst leaves no build artifacts beyond the PDF.
