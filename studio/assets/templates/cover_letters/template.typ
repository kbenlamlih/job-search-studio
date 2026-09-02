// =====================================================================
// Studio Clean - cover letter template (Typst)
//
// Exactly one page, always. The signature block must stay visible.
//
// PAGE-FIT LEVERS - in this order, never touch the margins:
//   1. body-size   10.5pt -> 10pt
//   2. lead         0.72em -> 0.65em
//   3. para-gap     0.75em -> 0.6em
//   4. cut the sentence that repeats what a CV bullet already says
// =====================================================================

#let body-size = 10.5pt
#let lead = 0.72em
#let para-gap = 0.75em
#let accent = rgb("#20415e")

// ---- Your details and theirs: replace the text inside the quotes ----
#let sender = (
  name: "[YOUR_NAME]",
  address: "[YOUR_CITY_COUNTRY]",
  email: "[YOUR_EMAIL]",
  phone: "[YOUR_PHONE]",
)
#let recipient = (
  name: "[HIRING_MANAGER_OR_DEAR_HIRING_MANAGER]",
  company: "[COMPANY]",
  address: "[COMPANY_CITY]",
)
#let subject = "Application: [ROLE_TITLE]"
#let letter-date = "[DATE]"

// ---- Layout ---------------------------------------------------------
#set page(paper: "a4", margin: (x: 20mm, top: 18mm, bottom: 16mm))
#set text(
  font: ("Helvetica Neue", "Helvetica", "Arial", "New Computer Modern"),
  size: body-size,
  lang: "en",
)
#set par(leading: lead, justify: false, spacing: para-gap)
#show link: it => text(fill: accent, it)

// ---- Header ---------------------------------------------------------
#grid(
  columns: (1fr, auto),
  gutter: 12pt,
  [
    #text(size: 15pt, weight: "bold", fill: accent, sender.name)
    #linebreak()
    #text(size: body-size - 1pt, fill: gray.darken(35%))[
      #sender.address · #sender.email · #sender.phone
    ]
  ],
  align(right + bottom, text(size: body-size - 1pt, fill: gray.darken(35%), letter-date)),
)
#v(-0.3em)
#line(length: 100%, stroke: 0.6pt + accent.lighten(40%))
#v(1.2em)

#text(recipient.company)
#if recipient.address != "" {
  linebreak()
  text(recipient.address)
}
#v(1.4em)

#text(weight: "bold", subject)
#v(0.9em)

#text(recipient.name + ",")
#v(0.4em)

// ---- Body -----------------------------------------------------------
// Opening: why this role, at this company, now. One concrete thing about them
// that you actually verified, not a compliment anyone could paste anywhere.

Opening paragraph.

// Middle: two or three paragraphs. Each takes something the advert asked for and
// answers it with evidence from your own history. Where you do not have what
// they asked for, say so once, plainly, and name the closest thing you do have.

Middle paragraph.

Middle paragraph.

// Close: what you want to happen next, and your availability. No pleading,
// no thanking them for their time twice.

Closing paragraph.

#v(1.1em)
#text("Kind regards,")
#v(1.6em)
#text(weight: "bold", sender.name)
