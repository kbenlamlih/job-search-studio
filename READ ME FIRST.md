# Job Studio

Hello. This is a job-search assistant that lives on your own computer. You don't
need to know anything about computers to use it, and you'll never have to type a
command. Everything happens on ordinary web pages with buttons.

There are only two files in this folder you ever need to touch.

---

## First time: set it up

**On Windows** — double-click **`install.bat`**
**On a Mac** — double-click **`install.command`**

A black window opens and text scrolls past. That's normal. It takes about five
minutes. Partway through it will ask you to press Enter and then open a browser
window so you can log in to Claude — use the same account your Claude
subscription is on.

When it finishes, the app opens by itself.

> If your Mac says the file "cannot be opened because it is from an
> unidentified developer": right-click the file instead, choose **Open**, then
> click **Open** in the box that appears. You only do this once.

## Every time after that

**On Windows** — double-click **`Start Job Studio.bat`**
**On a Mac** — double-click **`Start Job Studio.command`**

A small black window stays open while you use the app. Ignore it — but don't
close it until you're finished, because closing it turns the app off. Your
browser will open at the app by itself.

---

## What you'll actually do

Work down the list. Each step only needs the one before it.

### 1. Put your documents in

Go to **About me**. Drag in your CV, and anything else you have: a PDF of your
LinkedIn profile, your diplomas, reference letters. More material means better
results — this is the single biggest thing you control.

Don't have a nice CV? Doesn't matter. An old one is fine. So is a rough one.

### 2. Build your profile

Press **Build my profile**. Claude reads everything you gave it and writes up
who you are, how you work, what you're looking for, and the stories you can
tell in an interview.

It will ask you questions along the way. Answer them in the box at the bottom
of the screen in normal words, like texting a friend. If a question doesn't
apply to you, just say so.

This takes 5–15 minutes. You can leave it running and come back.

Read what it wrote, on the same page. If something is wrong, fix it — you can
edit any of it directly, and your changes are used from then on.

### 3. Find jobs

Go to **Jobs** and press **Find new jobs**. It searches the job boards that are
switched on (see **Setup** to choose which — LinkedIn and freehire work
anywhere, the other four are Danish).

Then press **Score them**. That's the useful bit: each job gets a score out of
100 against your actual profile, with honest notes on where you fit and where
you don't. Sort by score and you have a shortlist worth your time.

### 4. Apply

Press **Apply** on a job. This is the part that saves you a whole afternoon:

- it checks whether the job is genuinely a good fit, and tells you if it isn't
- it writes a CV tailored to that specific advert
- it writes a cover letter in your voice, in the language of the advert
- a *second* Claude then reads both as if it were the hiring manager and picks
  them apart, and the first one rewrites them
- it builds both as PDFs, looks at the pages, and fixes anything ugly
- it checks the CV is readable by the screening software companies use

You get two finished PDFs. Read them before you send them — they're written from
your profile, but you're the one who knows the truth. Nothing is ever sent
anywhere on your behalf.

Somewhere in the middle it will ask you whether to go ahead. That's your cue to
say yes or no.

### 5. Keep track

Every application is on the **Applications** page. When something happens —
an interview invitation, a rejection, silence — press **Update** and say what
happened in normal words.

**Progress** shows how it's actually going: how many you've sent, how many turned
into interviews, what's closing soon.

When an interview gets booked, press **Interview prep** on that application. It
builds a prep pack from the actual advert and the actual CV they read, works out
the likely questions, and will run a mock interview with you if you want.

---

## Things worth knowing

**It's honest on purpose.** It will not invent experience you don't have. If a
job asks for something you lack, it says so plainly and finds the closest true
thing instead. That's a feature: it's what stops you getting caught out in an
interview.

**Read before you send.** It reads job adverts off the internet, and a rare
badly-behaved advert can contain text designed to mislead it. It's built to
ignore that, but you're the last check. Skim what it wrote.

**One thing at a time.** The app runs a single job at a time. If a button is
greyed out, something's already running — look at the panel in the bottom-right
corner.

**If it seems stuck.** Look at that bottom-right panel. If it says *your turn*,
it's waiting on you. If it's been "Working" for more than about 25 minutes,
press **Stop** and start the same thing again; nothing you've already done is
lost.

**If it says you've run out.** Your Claude subscription has a usage limit per
few hours. The app tells you when you're close and when you've hit it, and
everything you've done so far is saved. Come back later and carry on.

**Your things stay yours.** Everything lives in this folder on this computer.
Nothing is uploaded anywhere except the parts of your documents Claude has to
read to do the job you asked for. Nobody else can see it. If you ever want it
all gone, delete the folder.

---

## Where your things are, if you ever want them

Inside this folder, in `workspace`:

| What | Where |
| --- | --- |
| Your profile, as Claude wrote it | `workspace/profile/` |
| The documents you uploaded | `workspace/documents/` |
| Your finished CVs | `workspace/cv/` |
| Your finished cover letters | `workspace/cover_letters/` |
| Your application list as a spreadsheet | `workspace/job_search_tracker.csv` |
| Everything about one application | `workspace/documents/applications/` |

They're ordinary files. Open them, copy them, email them, back them up.

---

Good luck. Genuinely — this exists because it worked for the person who built
the workflow underneath it, and it will do the boring half of the job for you.
