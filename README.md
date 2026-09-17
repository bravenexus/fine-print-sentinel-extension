# Fine Print Sentinel

A Brave/Chrome extension that watches for links to a Terms of Service or
Privacy Policy on any page you're signing up for, drops a small "Scan"
badge right next to them (like a password manager badges a login field),
and flags language that's out of the ordinary before you click "I agree."

It runs entirely in your browser: no server, no account, no cost, and
nothing you scan is sent anywhere except the normal request to load the
terms page itself, the same as if you'd opened it yourself. It checks
pages against a fixed list of known red-flag patterns (word-matching, not
AI), and it's meant to be extended over time, not a finished product.

**Disclaimer:** this is offered free for personal use, as-is, with no
guarantee it's complete or accurate. It's a research shortcut, not a legal
opinion, use your own judgment on every result. See [LICENSE](./LICENSE)
for the full terms, this is not open source, personal use only.

## How to install it (load unpacked)

1. Open Brave (or Chrome) and go to `brave://extensions` (or
   `chrome://extensions`).
2. Turn on **Developer mode** (top right toggle).
3. Click **Load unpacked**.
4. Select this `sentinel-extension` folder.
5. That's it. It's now active on every page. Look for small "Scan" badges
   next to any Terms/Privacy links.

Whenever the code updates, pull the latest and click the refresh icon on
the extension's card at `brave://extensions` to pick it up. If a page was
already open before you refreshed, reload that page too, otherwise it's
still talking to the old version and scans will silently fail. If an
update added a new permission (check `manifest.json`'s `permissions`
list against what you last approved), Brave/Chrome will ask you to
re-approve it after the refresh, that's expected, not a bug.

## How it works right now

- `content.js` scans the page for links whose text or URL looks like
  "Terms of Service," "Privacy Policy," "Conditions of Use," etc., and
  inserts a small badge next to each one, plus one floating "Scan" button
  (top-right by default) that scans every linked page on the page at
  once. That floating button is draggable, press and drag it anywhere
  that's not blocking real page content, it remembers where you left it.
- Clicking a badge sends that link to `background.js`, which fetches the
  page, strips it down to plain text, and checks it against the rules in
  `rules.js`. It also scans the *current* page's own visible text for
  consent language that lives outside the linked document (things like
  "by creating an account you agree...").
- Results show up in a panel: a quick-glance overview card per document
  type (Terms, Privacy, etc.), then each document's own detailed findings
  (what was flagged, why it matters in plain English, and the actual
  sentence it matched, so you can judge for yourself), then, lower down
  and clearly secondary, whatever the current page's own visible text
  turned up.
- If the page has a real contact email or contact-page link, the panel
  shows a button to reach the company directly, useful when a clause is
  ambiguous and the fastest way to get clarity is to just ask them, in
  writing.
- The panel can be minimized down to just its header (the **–** button, or
  clicking the header once minimized to bring it back), so you can interact
  with the page underneath without losing your results or re-scanning to
  see them again.
- A document that couldn't actually be checked is labeled "Unchecked," not
  "Clear." Those are deliberately kept separate: a green "Clear" badge
  means the scan ran and found nothing, not that the scan never ran.

## Current rule set (`rules.js`)

Fourteen patterns seeded from real terms pages, including a hidden
irrevocable content-license clause on a music-generation platform that
prompted this whole project: irrevocable/perpetual content licenses, outright ownership
transfer, moral-rights waivers, data broker resale, broad third-party
sharing, forced arbitration + class-action waivers, terms that change
without notice, sensitive-data collection, vague/indefinite data
retention, auto-renewal, sole-discretion account termination, broad
liability disclaimers, implied consent with no real opt-in, and
cross-device fingerprinting.

This is a heuristic pass, not legal advice, and it will both miss things
(if a site phrases a clause differently) and occasionally flag something
standard-for-the-industry as if it were unusual. Treat every flag as a
"go read that sentence yourself," not a verdict.

## When a site won't scan automatically

Some sites (a growing number, since it's how modern web frameworks work)
don't put their actual Terms/Privacy text in the page's raw HTML, they
fill it in with JavaScript after the page loads. A background fetch never
runs that JavaScript, so it only ever sees an empty shell, no matter how
many times you click "check."

Fine Print Sentinel detects this specific case and turns the badge into
an "↗ Open & scan" button instead of leaving you stuck re-clicking
something that will never work: click it, it opens the real page in a new
tab, and once you're actually standing on that page, its own badge for
itself uses what's genuinely rendered in your browser, no re-fetch
involved, so it checks correctly from there.

## Jumping straight to a flagged clause

Each flag has an "↗ Open & scan" link of its own. Clicking it opens the
linked Terms/Privacy page and the browser automatically scrolls to and
highlights the exact sentence that was flagged, using Chromium's built-in
text-fragment navigation (the same feature behind Chrome's own "Copy link to
highlight"). It's a plain link to a public page, nothing more, so there's no
legal issue with it.

This is not a numbered clause reference (like "14.2.3"). Most Terms/Privacy
pages have no stable per-clause anchor in their HTML, and this extension
only ever sees the page's stripped plain text, not its heading structure, so
there's no section number to hand back even on a page that displays one.
Jumping to the exact matched sentence is the closest reliable substitute.
There's also a copy button next to every matched snippet, for pasting into
the page's own Find (Ctrl+F / Cmd+F) if you'd rather locate it that way.

## "Feedback" clauses vs. real content-license grabs

The irrevocable-license rule (the one seeded from the Suno situation) also
catches a completely different, near-universal clause: a "Feedback" license,
the boilerplate that lets a company use suggestions/bug reports you send
them without owing payment or credit if they build what you suggested. Same
legal shape (perpetual, irrevocable, royalty-free) as a real content-license
grab, but a much lower-stakes thing, it's about your comments, not your
voice, face, or uploaded work. When the matched snippet contains the word
"feedback," Sentinel now shows a calmer, accurate explanation for it instead
of the creator-content wording, and downgrades it to low severity.

## Permissions, and why each one is there

- **activeTab / scripting** — lets the extension read and badge the page
  you're currently on. Required for the core feature.
- **host_permissions: `<all_urls>`** — the badge and scan need to work on
  whatever site you're signing up with, there's no way to know that list
  in advance, so it's requested broadly rather than site by site.
- **storage** — used for exactly one thing: remembering where you dragged
  the floating "Scan" button to, so it doesn't reset to the default spot
  every page load. Nothing scanned or personal is ever stored.

No analytics, no telemetry, no remote server this extension talks to at
all. The only network requests it ever makes are fetching the Terms/Privacy
page you're checking, the same request your browser would make if you'd
clicked the link yourself.

## Known limitations (expected at this stage)

- A handful of sites block plain server-side fetches of their own pages
  outright; those will still show a genuine "couldn't check it" error,
  separate from the JavaScript-rendering case above.
- The rule set is a starting list, not exhaustive. Worth adding to as you
  run into new patterns worth flagging.
- This checks structure and known phrasing, not intent. A well-written bad
  clause in unfamiliar wording can still slip past it.

## Before shipping any change to rules.js

Run the regression tests first:

```
node tests/rules.test.js
```

This checks every rule against real cases that have already caused
problems (a past false positive, a past false negative, and a reverse
word-order miss found the same way), so a change can't silently bring
back a bug that was already fixed once. If it fails, don't push the
change; fix it until all tests pass. When you fix a new false positive or
false negative, add it to `tests/rules.test.js` as a permanent case so it
can never quietly come back.

Also worth a syntax check before shipping any `.js` change:

```
node --check content.js
```

## Before shipping any change to an HTML page (welcome.html, etc.)

Never put JavaScript inline in a `<script>` block inside the HTML file.
Manifest V3 blocks inline scripts outright (a Content Security Policy
restriction), with no error visible anywhere except `brave://extensions`
→ this extension's card → **Errors**. It fails silently otherwise: the
page loads fine, buttons just don't do anything. Always put JavaScript in
its own `.js` file and load it with `<script src="....js"></script>`.

After any change, reload the extension in `brave://extensions` and check
that card's **Errors** button specifically (click **Clear all** first if
it's showing old errors, so a fresh check isn't reading stale ones).

## Where this could go later

- More rules, and rules tuned from real flagged pages over time.
- Optional deeper AI-powered scan as a paid add-on (credit-based, e.g. $5
  for 10 scans), kept separate from this free local scanner so the free
  version never needs a backend or costs you anything to run.
- Auto-detecting a checkbox + terms link pairing directly, instead of
  relying on the visible link text.
- A Chrome Web Store listing, if it's ever worth reaching people who
  don't want to use Developer Mode.

## Contributions

This repo is public so people can see it, read about it, and use it
personally, not for outside pull requests. See [LICENSE](./LICENSE) for
what's actually permitted. If you hit a real bug or false positive/negative
on a site, feel free to open an issue describing it, that's genuinely
useful, but this isn't accepting code contributions.

## Branding

`social/sentinel-avatar.png` is a square logo image for profile pictures,
project cards, and the like. To set it as this repo's own preview image
(what shows up when the link is shared), go to the repo's Settings tab →
Social preview → Upload an image.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for what's changed release to release.
