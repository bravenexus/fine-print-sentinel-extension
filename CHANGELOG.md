# Changelog

All notable changes to Fine Print Sentinel, newest first. Versions match
`manifest.json`. This log starts at 0.5.13; everything before that predates
this file.

## 0.6.4
- Real bug: an uncaught "Cannot set properties of undefined (setting
  'display')" in `updateLauncher`, seen on a raw S3/JSON URL opened
  directly in a tab rather than a real webpage. A Terms/Privacy link can
  never appear on a bare JSON/XML/text response, so there's nothing for
  this extension to do there anyway. `content.js` now skips scanning
  entirely on a non-HTML document (JSON, XML, plain text), and
  `updateLauncher` also guards against a launcher element that somehow
  isn't a normal styleable node, so this whole class of not-a-real-webpage
  error can't crash the script again.

## 0.6.3
- Real bug (onetrust.com): a quoted "wording" snippet showed raw, garbled
  markup instead of plain text, things like
  `&lt;span class=\&#34;body3-v2\&#34;&gt;`. Some pages HTML-escape their
  own markup a second time (likely a CMS baking rich text into a JSON blob
  for client-side hydration), so a real `<span>` tag is stored as the
  literal text `&lt;span&gt;` rather than an actual tag, and the old
  entity decoder only handled a handful of named entities, so it survived
  as unreadable escaped text. Entity decoding is now much more complete
  (covers `&lt; &gt; &#34;` and generic numeric entities), and tags are
  stripped a second time after decoding to catch a layer of markup that
  was hiding underneath the escaping.
- Decoding that snippet also exposed a real false positive underneath it:
  the actual text was "Assign ownership for regulatory and operational
  updates", a compliance-software product feature about assigning a task
  to a team member, nothing to do with anyone's content or intellectual
  property, but it matched `content-ownership-transfer` anyway because
  "assign" + "ownership" alone was enough. That rule now also requires a
  content/work/IP-related word nearby, closing off that whole
  false-positive shape without narrowing what real content-ownership
  clauses it still catches (both existing passing cases still pass).

## 0.6.2
- Fixed a real error showing up in Brave's extension error console:
  "Uncaught (in promise) Error: No tab with id: N", from the new badge
  feature (0.5.35). chrome.action's badge methods return a promise in MV3,
  and the tab a badge update was meant for can genuinely be gone by the
  time it runs (closed, or a service-worker restart replaying a message),
  a normal race, not a real problem, but with nothing catching the
  rejection it surfaced as an error even though nothing was actually
  broken. Silently ignored now, there's nothing to do when the tab's gone.

## 0.6.1
- Real bug (vumatel.co.za), and a serious one: their real Terms &
  Conditions, Code of Conduct, and Privacy Policy links all point straight
  at PDF files, not web pages. Fetched and run through the same text
  extraction as an HTML page, a PDF's compressed binary content turns into
  mostly unreadable garbage that no rule will ever match, which used to be
  completely indistinguishable from "read it and it was genuinely clean."
  That's exactly the false all-clear this project exists to prevent, the
  same category as the earlier name.com "Registration Agreement" miss. A
  PDF is now detected (by content type and by its own file signature, in
  case a server mislabels it) and reported honestly as "can't check this
  automatically yet" with a link to open and read it yourself, never as
  Clear. Real PDF text extraction is a bigger feature for another day; this
  closes the false-positive safety gap in the meantime.

## 0.6.0
- Structural change: the launcher button and the results panel now render
  inside a Shadow DOM instead of as plain elements in the page. This is the
  real fix for a whole recurring bug category this session, a host page's
  CSS reaching in and recoloring/resizing this extension's own UI
  (invisible text on hellopeter.com, a disappearing link on GoHighLevel, a
  full-width button on alison.com, a red-recolored panel header on
  securiti.ai). A shadow root is the browser's own answer to this exact
  problem: a host page's stylesheet cannot select into it, or out of it,
  no matter how broad its rules are. That whole class of bug should no
  longer be possible, not just patched again for the next site that finds
  it.
  - The small inline "Scan"/"Unchecked" badges next to links on the page
    itself are NOT part of this, they still live in the regular page (they
    need to sit inline with the page's own content, not float in a fixed
    corner), so they remain exposed to the same category of risk in
    principle, though none of the bugs found this session were actually
    ones of those.
  - manifest.json now lists content.css under web_accessible_resources, so
    it can be loaded into the shadow root at runtime; this is a small,
    standard, well-understood permission addition for this exact pattern,
    worth knowing about plainly: it means a page could detect (not read,
    just detect) that this extension is installed by checking whether that
    file loads.

## 0.5.36
- Real bug (education.securiti.ai): the panel's own header bar rendered
  with a solid red/maroon background instead of its normal dark color,
  the title bar itself, not any of the severity-colored flag cards.
  Same host-CSS-bleed category as the Alison button-width bug: a
  security-brand site plausibly has its own broad styling for anything
  with "header" in its class name, and the panel's background/text colors
  had nothing declared with enough weight to resist it. The panel shell,
  its header, and its minimize/close buttons all now have their
  background and text colors locked with `!important` in both light and
  dark mode, so a host page's own CSS can't reach in and recolor them.

## 0.5.35
- Real bug (alison.com): the floating "Scan" launcher button had no width
  of its own set, so a host site's own "every button is full-width" rule
  (common on course/signup platforms) had nothing to override, and the
  button spanned the entire page. Both the launcher and the results panel
  now have their box-defining properties locked with `!important`, same
  fix as the earlier invisible-text and disappearing-link bugs, so a host
  page's own CSS can never reshape either one again.
- The results panel can now be dragged by its header, same as the launcher
  button already could be, and remembers where it was left. It could be
  minimized or closed before, but not moved, and it can land pinned over
  the exact corner of a page you need.
- The toolbar icon now does something: clicking it re-runs a full scan of
  the page (the same action as the on-page "Scan" button), so there's a
  way back in from anywhere on the page after closing the panel, not just
  by scrolling back down to find a badge again.
- The toolbar icon also now shows a small red badge with a count once a
  scan has found high-severity flags, similar to how a password manager's
  icon shows how many logins it saved for a page. It reflects whatever's
  already been scanned (via a badge, the launcher, or the icon itself), it
  does not silently scan every page you visit in the background.

## 0.5.34
- The two clauses considered most alarming to sue over or be bound by
  forever, forced arbitration + class-action waiver and terms that can
  change without notice, now get explicit top priority alongside the
  content-license and moral-rights clauses, so all four sort to the very
  top of a document's results together instead of mixing in with the rest
  of the high-severity flags.
- Added a warning banner: any document with 3 or more high-severity flags
  now shows "⚠️ N major red flags in this document" above its results, so
  a document with several serious clauses stacked together reads as
  noticeably more alarming than one with just a single red flag.

## 0.5.33
- Fixed a real "second dead button" bug: an on-page badge could sit
  visibly overlapping the open results panel, next to the panel's own
  "↗ Open & scan" link, looking like a mixed-up duplicate CTA. Not
  something the panel renders, an actual in-page badge that the
  overlap-hiding logic failed to catch. Root cause: 'scroll' events don't
  bubble, so sites that scroll an inner container instead of the window
  (GitHub's docs pages, e.g.) never triggered a re-check; also added a
  re-check on every DOM-mutation-driven rescan, for reflows that shift a
  badge's position with no scroll event at all.

## 0.5.32
- Fixed the minimize button: it appeared completely unresponsive because
  its own click was bubbling up to the header's click listener, which
  immediately expanded the panel again in the same click, undoing it
  before it was ever visible.
- "Nothing flagged in that document" / "on the visible page" now make
  "that document" / "the visible page" themselves real, underlined,
  clickable links straight to the exact page checked, not just nearby
  plain text.

## 0.5.31
- Real bug (fnb.co.za): the "Contact" button could point back at the very
  Terms/legal page you were already reading, because that page had its
  own in-page "Contact us" jump link (an anchor to a section further down
  the same page), which got mistaken for a real contact page. It now
  skips a candidate link that resolves to the same page it was found on
  and keeps looking for a genuinely separate one.

## 0.5.30
- Added a minimize button to the results panel. Closing used to be the
  only option, which meant losing the results entirely to go interact
  with the page underneath; minimizing collapses it to just its header
  (click the header, or the button, to expand again) with nothing lost or
  re-scanned.

## 0.5.29
- Real bug (name.com): a domain registrar's actual binding contract is
  often called a "Registration Agreement," not "Terms of Service" or
  "Terms & Conditions," so it was never badged or scanned at all, the
  panel showed an all-clear "PRIVACY" card while the real Terms-equivalent
  document was silently skipped. Broadened link detection to also catch
  "Registration/Member/Subscriber/Service Agreement" and "EULA."

## 0.5.28
- Every place the panel refers to "this page" or "that document" now shows
  the actual URL underneath, so it's never ambiguous which page is being
  talked about (the one that just opened vs. the one the panel is on).
- "Clear" results now show as a green pill badge, matching the visual
  weight flagged results already get, instead of being an easy-to-skim
  plain sentence.
- Accessibility pass: the new pill's first green (#27ae60) and the new URL
  text's first grey were both below the 4.5:1 WCAG AA contrast minimum,
  fixed to a darker green and darker grey that clear it.

## 0.5.27
- Raised "Terms can change without notice" from medium to high severity.
  Reasoning: this clause isn't a bounded risk like the others, it removes
  the limit on what any future clause could say, since the company can add
  new terms unilaterally and continued use alone counts as agreeing to
  them, whether or not you ever saw the change.

## 0.5.26
- Cut the redundant "That's not the same as clear, it's genuinely
  unchecked" sentence from the unchecked-document message.
- For the JavaScript-rendering case specifically, the message now says
  plainly *why* in the person's own terms ("Based on how this site is
  built, it can't be read automatically") instead of a raw error string.

## 0.5.25
- Fixed: after clicking "↗ Open & scan" and landing on the real page, that
  document's own badge still showed "Unchecked", because it was still
  re-running a background fetch that can never see JavaScript-rendered
  content, no matter who's looking at the page. It now uses the page's own
  already-rendered text instead of re-fetching when you're standing on the
  exact document a badge points to.
- Removed the now-redundant duplicate "on this page" section when it would
  have shown the same result twice.

## 0.5.24
- Fixed a real bug: the "jump to this wording" link had no protected text
  color, so a host site's own CSS could override it and make it disappear
  on hover. Now underlined by default (reads as a link at rest, not just
  on hover) with its color locked so a host page's styles can't leak in.
- Shortened its label to "↗ Open & scan" to match the badge wording
  elsewhere.

## 0.5.23
- Accessibility pass: fixed a real invisible-text bug (a bare `<strong>`
  tag with no protected color was inheriting a host site's own styling).
  Also ran a full WCAG AA contrast check across light and dark mode and
  fixed two genuine failures (dark-mode error text, light-mode footnote
  text) that were below the 4.5:1 minimum.

## 0.5.22
- The floating "Scan" launcher button is now draggable, drag it anywhere
  that isn't blocking real page content; it remembers where you left it
  (new `storage` permission, used only for this).

## 0.5.21
- Moved the "on this page" visible-text check to the bottom of the panel,
  after the real per-document results, since the linked Terms/Privacy
  documents are the actual point, and relabeled it to read as the minor
  bonus check it is.

## 0.5.20
- Fixed the "on this page" text showing up duplicated once per linked
  document in the same panel.
- Fixed the overview grid double-counting the same visible-page flags into
  every category card (Terms and Privacy both), inflating both.

## 0.5.19
- The "couldn't check it" recommendation now names the exact link by its
  own label and says where to look, instead of a vague "the link on the
  page."

## 0.5.18
- Real fix, not just copy: when a linked page can't be read because it
  needs JavaScript to render, the badge itself turns into an "↗ Open &
  scan" action that opens the real page, instead of a dead-end "Check"
  button that silently re-runs the same failing fetch forever.

## 0.5.17
- Fixed the overview grid showing a false green "Clear" for a category
  whose linked document actually failed to load. "Unchecked" is now always
  visually distinct from "Clear."

## 0.5.16
- Fixed the contact button rendering twice (once per scanned document
  instead of once per panel).

## 0.5.15
- Added the top-of-panel overview grid (one card per document type: Terms,
  Privacy, etc.) and made Terms sort first, since it matters most.

## 0.5.14
- Added the contact-finder: if a real email or contact page is found on
  the fetched page, the panel offers a direct way to reach the company.
- Redesigned the floating launcher button to a two-line "Scan" / "N pages
  identified" layout.

## 0.5.13
- Fixed a real click-eating bug: the launcher button rebuilt its own DOM
  on every scan tick, and a click landing mid-rebuild could get silently
  dropped by the browser. It now only touches the DOM when its visible
  state actually changes.
