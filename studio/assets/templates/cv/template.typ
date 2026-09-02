// =====================================================================
// Studio Clean - CV template (Typst)
//
// Single column on purpose: an applicant tracking system reads the PDF's
// text layer, and multi-column layouts scramble that reading order.
// No icon fonts either, so the email and phone survive as real text.
//
// PAGE-FIT LEVERS - reach for these in order, never touch the margins:
//   1. body-size   10pt -> 9.6pt   (or 10.4pt to fill a thin second page)
//   2. lead         0.62em -> 0.56em
//   3. section-gap  0.95em -> 0.75em
//   4. cut the least relevant bullet
// =====================================================================

#let body-size = 10pt
#let lead = 0.62em
#let section-gap = 0.95em
#let accent = rgb("#20415e")

// ---- Your details: replace the text inside the quotes ---------------
#let cv-name = "[YOUR_NAME]"
#let cv-headline = "[YOUR_PROFESSIONAL_HEADLINE]"
#let cv-contact = (
  "[YOUR_EMAIL]",
  "[YOUR_PHONE]",
  "[YOUR_CITY_COUNTRY]",
  "[YOUR_LINKEDIN_URL]",
)

// ---- Layout: you rarely need to change anything below ---------------
#set page(paper: "a4", margin: (x: 17mm, top: 15mm, bottom: 14mm))
#set text(
  font: ("Helvetica Neue", "Helvetica", "Arial", "New Computer Modern"),
  size: body-size,
  lang: "en",
)
#set par(leading: lead, justify: false)
#show link: it => text(fill: accent, it)

#let section(title) = {
  v(section-gap)
  block(breakable: false, width: 100%)[
    #text(size: body-size + 1pt, weight: "bold", fill: accent, tracking: 0.4pt, upper(title))
    #v(-0.45em)
    #line(length: 100%, stroke: 0.6pt + accent.lighten(40%))
  ]
  v(0.3em)
}

// One job, degree or project. breakable: false keeps a title with its bullets,
// which is the single most common way a CV goes ugly across a page break.
#let entry(role: "", org: "", dates: "", place: "", body) = {
  block(breakable: false, width: 100%, inset: (bottom: 0.45em))[
    #grid(
      columns: (1fr, auto),
      gutter: 8pt,
      text(weight: "bold", role),
      text(fill: gray.darken(35%), dates),
    )
    #if org != "" or place != "" {
      v(-0.45em)
      text(style: "italic", org + if place != "" and org != "" { ", " + place } else { place })
    }
    #if body != none [
      #v(0.2em)
      #body
    ]
  ]
}

#let bullets(..items) = list(spacing: lead + 0.15em, indent: 0.55em, ..items)

#let skillrow(label, value) = grid(
  columns: (auto, 1fr),
  gutter: 8pt,
  inset: (bottom: 0.25em),
  text(weight: "bold", label + ":"),
  value,
)

// ---- Header ---------------------------------------------------------
#align(center)[
  #text(size: 19pt, weight: "bold", fill: accent, cv-name)
  #v(0.15em)
  #text(size: body-size + 0.5pt, fill: gray.darken(40%), cv-headline)
  #v(0.4em)
  #text(size: body-size - 0.5pt, cv-contact.filter(c => c != "").join("  ·  "))
]
#v(0.2em)

// ---- Profile --------------------------------------------------------
#section("Profile")
Three or four lines, written for this one job advert. Lead with the single
strongest match to what they asked for, name the field you work in, and close
with what you are looking for next. No adjectives you cannot evidence below.

// ---- Experience -----------------------------------------------------
#section("Experience")

#entry(role: "[JOB_TITLE]", org: "[EMPLOYER]", dates: "[MONTH_YEAR] - [MONTH_YEAR]", place: "[CITY]")[
  #bullets(
    [What you were responsible for, then what changed because of you. Put a number on it where you honestly have one.],
    [A second achievement, chosen because it matches this advert rather than because it came next chronologically.],
    [A tool or method the advert names, shown in use rather than listed.],
  )
]

#entry(role: "[JOB_TITLE]", org: "[EMPLOYER]", dates: "[MONTH_YEAR] - [MONTH_YEAR]", place: "[CITY]")[
  #bullets(
    [Same pattern. Older roles get fewer bullets, unless an older role is the one that matches this advert.],
    [Keep every date and title exactly as they appear in the profile. Never round a date to make a gap disappear.],
  )
]

// ---- Education ------------------------------------------------------
#section("Education")

#entry(role: "[DEGREE]", org: "[INSTITUTION]", dates: "[YEAR] - [YEAR]", place: "[CITY]")[
  #bullets([Thesis, specialisation or grade, when it is relevant to this advert.])
]

// ---- Skills ---------------------------------------------------------
#section("Skills")
#skillrow("[SKILL_GROUP]", "[Comma-separated skills, most relevant to this advert first]")
#skillrow("[SKILL_GROUP]", "[Comma-separated skills]")

// ---- Languages ------------------------------------------------------
#section("Languages")
#skillrow("[LANGUAGE]", "[level, e.g. native / fluent / B2]")
#skillrow("[LANGUAGE]", "[level]")
