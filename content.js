// Fine Print Sentinel content script.
// Finds links to Terms of Service / Privacy Policy pages (the kind that
// sit next to a signup checkbox), and injects a small inline "Scan" badge
// next to each one, similar to how a password manager badges a login field.

// Real report (name.com): the extension showed an all-clear "PRIVACY" card
// and never even offered a badge for the actual binding contract at all,
// because name.com (like most domain registrars) doesn't call it "Terms of
// Service," it calls it a "Registration Agreement." "Clear" on this
// extension can only ever mean "checked and found nothing," never
// "presumed fine because we didn't look," so missing that document
// entirely and still showing green would have been exactly the false
// all-clear this whole project exists to prevent. Broadened to catch the
// other common names a site's real contract goes by.
const TERMS_LINK_PATTERN =
  /terms( ?(of|&) ?(use|service|conditions))?|privacy( ?policy)?|conditions of use|(user|member|subscriber|registration|service) agreement|end.user license|\beula\b/i;

// A page can have more than one badge (a Terms link AND a separate Privacy
// link is common). This used to render into one shared panel that got
// completely overwritten on every scan, so scanning the second badge erased
// the first badge's results entirely, they were never actually broken, just
// invisible after the next click. Every scan's result now lives in this map,
// keyed by the linked URL, and the panel always re-renders ALL of them, so
// each link keeps its own section instead of the newest scan wiping out
// whatever came before it.
const scanResults = new Map(); // url -> { label, pageFlags, termsResult, termsError, connectionError }

// Real feedback: closing the panel left no way back in except scrolling
// down to find an on-page badge again, on a long page that's real friction.
// The toolbar icon now re-runs the same "scan everything" action the
// on-page launcher button does (see ensureLauncher's click handler), so the
// icon itself is always the way back in, from anywhere on the page,
// regardless of scroll position or whether the panel was closed.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "SENTINEL_TOOLBAR_CLICK") {
    document.querySelectorAll(".sentinel-badge").forEach((b) => {
      if (!b.disabled) b.click();
    });
  }
});

// Real report (2026-09-17): an uncaught "Cannot set properties of undefined
// (setting 'display')" in updateLauncher, seen on a raw S3/JSON URL opened
// directly in a tab rather than a real webpage. A Terms/Privacy link can
// never appear on a bare JSON/XML/text response in the first place, so
// there's nothing for this extension to do there anyway. This flag lets
// every entry point below (scanPage, the observer, the poll timer) no-op
// cheaply instead of touching the DOM on a document that isn't a normal
// webpage.
const SENTINEL_SKIP_CONTENT_TYPES = /^(application|text)\/(json|xml|.*\+json|.*\+xml)$|^text\/plain$/i;
const sentinelIsRealWebpage = !(document.contentType && SENTINEL_SKIP_CONTENT_TYPES.test(document.contentType));

// The launcher button and the results panel both used to be plain elements
// appended straight into the page's own DOM, styled by a regular stylesheet
// (content.css, injected via manifest.json). That's simple, but it means a
// host page's own CSS and this extension's CSS are both just rules in the
// same cascade, competing for the same elements, with nothing actually
// keeping them apart. Every "host site recolors/resizes our own UI" bug
// this extension has hit (a bare <strong> going invisible on hellopeter.com,
// a jump link disappearing on hover, the launcher going full-width on
// alison.com, the panel header turning red on securiti.ai) has been exactly
// that: the host page's CSS reaching in and winning a rule it was never
// supposed to be able to touch. Patching it one !important at a time works,
// but only after each new site finds the next unprotected property.
//
// A shadow root is the actual browser feature built for this: an
// encapsulated DOM/CSS boundary a host page's stylesheet cannot select
// into or be selected out of, in either direction, no matter how broad or
// aggressive its rules are. Everything visual (the launcher, the panel, and
// everything inside it) now lives inside one, so this whole bug category
// stops being possible rather than needing to be re-fixed every time a new
// site trips it. The small inline "Scan" badges next to links on the page
// itself stay in the regular DOM, since they need to sit inline in the
// page's own content, not float in a fixed corner; they were never actually
// the source of any of these bugs.
let sentinelShadowRoot = null;
function ensureShadowRoot() {
  if (sentinelShadowRoot) return sentinelShadowRoot;
  const host = document.createElement("div");
  host.id = "sentinel-shadow-host";
  document.body.appendChild(host);
  sentinelShadowRoot = host.attachShadow({ mode: "open" });
  // content.css still ships as its own file (readable, editable, and still
  // what styles the on-page badges in the regular DOM); it's just also
  // loaded in here so the same rules apply inside the shadow boundary too.
  // Requires content.css to be listed in manifest.json's
  // web_accessible_resources, otherwise the browser blocks a page-context
  // script from loading an extension file by URL.
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL("content.css");
  sentinelShadowRoot.appendChild(link);
  return sentinelShadowRoot;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

// Real report: "Clear, nothing flagged in that document" and "also
// checked this page" both left the person asking "wait, WHICH page is
// this talking about, the one that just opened or this one?" A label like
// "Privacy Policy" isn't enough when two tabs are both plausibly "the
// privacy page." Show the actual URL wherever we refer to a page or
// document, hostname + path, no query string or hash, so it stays short
// enough for the panel.
function shortUrlForDisplay(href) {
  try {
    const u = new URL(href);
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    return `${u.hostname.replace(/^www\./, "")}${path}`;
  } catch (err) {
    return href;
  }
}

// Mark badged status on the DOM node itself (via a data attribute), not in a
// separate href-keyed set. React-built sites (Suno included) frequently
// replace this whole section of the DOM right after first paint, or a step
// later when the form advances, which silently destroys the badge; tracking
// by href alone would then think the *new* anchor is already handled and
// skip it forever. Tracking on the node means a freshly-created anchor, even
// for the same URL, is always seen as unbadged and gets a new badge.

function looksLikeTermsLink(a) {
  if (!a.href || a.dataset.sentinelBadged) return false;
  const text = (a.textContent || "").trim();
  const href = a.getAttribute("href") || "";
  if (text.length > 60) return false; // avoid matching whole paragraphs
  return TERMS_LINK_PATTERN.test(text) || TERMS_LINK_PATTERN.test(href);
}

function makeBadge(anchor) {
  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = "sentinel-badge";
  badge.title = "Scan this page with Fine Print Sentinel";
  badge.innerHTML = `<span class="sentinel-dot"></span><span class="sentinel-label">Scan</span>`;
  badge.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Real report (helloperter.com): after a scan fails because the linked
    // page needs JavaScript to render its text, clicking the badge again
    // just re-runs the exact same fetch, which fails the exact same way,
    // forever. That's a dead end dressed up as a button. Once we know
    // that's the situation, the badge stops trying to re-fetch and instead
    // does what the person actually needs: opens the real page so they can
    // scan it themselves once it's actually loaded and rendered.
    if (badge.dataset.sentinelNeedsManualOpen === "1") {
      window.open(anchor.href, "_blank", "noopener,noreferrer");
      return;
    }
    const linkLabel = (anchor.textContent || "").trim() || anchor.href;
    runScan(anchor.href, badge, linkLabel);
  });
  anchor.insertAdjacentElement("afterend", badge);
  anchor.dataset.sentinelBadged = "1";
  updateLauncher();
  // A brand new badge can appear well after the panel is already open on a
  // page that keeps redrawing (Imgur, GoHighLevel), so check it against the
  // panel's current position right away instead of waiting for the next
  // hideOverlappingBadges() sweep.
  hideOverlappingBadges();
}

function scanPage() {
  if (!sentinelIsRealWebpage || !document.body) return;
  const anchors = document.querySelectorAll("a[href]");
  anchors.forEach((a) => {
    if (looksLikeTermsLink(a)) {
      makeBadge(a);
    }
  });
  updateLauncher();
  // Real bug: a site whose content reflows without a scroll event (a
  // lazy-loaded docs page inserting a section above an already-badged
  // link, e.g.) could shift an EXISTING badge into the open panel's
  // space with nothing to re-check it, scroll/resize listeners never
  // fired, so it stayed visible, sitting right next to our own "Open &
  // scan" link and looking like a second, dead control we'd built into
  // the panel itself. scanPage() already re-runs on every relevant DOM
  // mutation, piggyback the overlap re-check on that same cadence.
  scheduleHideOverlapCheck();
}

let panel = null;

function ensurePanel() {
  if (panel) return panel;
  panel = document.createElement("div");
  panel.className = "sentinel-panel";
  panel.innerHTML = `
    <div class="sentinel-panel-header">
      <span class="sentinel-panel-title">Fine Print Sentinel</span>
      <span class="sentinel-panel-header-actions">
        <button class="sentinel-panel-minimize" title="Minimize">–</button>
        <button class="sentinel-panel-close" title="Close">×</button>
      </span>
    </div>
    <div class="sentinel-panel-body"></div>
  `;
  ensureShadowRoot().appendChild(panel);
  panel.querySelector(".sentinel-panel-close").addEventListener("click", () => {
    panel.classList.remove("sentinel-open", "sentinel-minimized");
    showPageBadges();
    updateLauncher();
  });
  // Real feature request: closing the panel to interact with the page
  // underneath meant losing it entirely, reopening it meant clicking a
  // badge again (and re-scanning) just to see results that were already
  // sitting right there. Minimizing collapses it down to just its header,
  // out of the way but one click from being exactly where it was, nothing
  // gets re-fetched or re-rendered to bring it back.
  const minimizeBtn = panel.querySelector(".sentinel-panel-minimize");
  const setMinimized = (min) => {
    panel.classList.toggle("sentinel-minimized", min);
    minimizeBtn.textContent = min ? "▢" : "–";
    minimizeBtn.title = min ? "Expand" : "Minimize";
  };
  minimizeBtn.addEventListener("click", (e) => {
    // Real bug: this click also bubbles up to the header's own click
    // listener right below, which (now seeing the "minimized" class this
    // handler just added) immediately called setMinimized(false) again in
    // the SAME click, undoing it before it was ever visible. Net effect:
    // the button looked completely unresponsive. Stop it from bubbling.
    e.stopPropagation();
    setMinimized(!panel.classList.contains("sentinel-minimized"));
  });
  // The whole header (not just the tiny minimize button) reopens it when
  // minimized, a bigger, easier target than hunting for one small icon.
  panel.querySelector(".sentinel-panel-header").addEventListener("click", (e) => {
    if (!panel.classList.contains("sentinel-minimized")) return;
    if (e.target.closest(".sentinel-panel-close")) return;
    setMinimized(false);
  });
  // Event delegation, not one listener per button: the panel body's whole
  // innerHTML gets replaced on every scan (renderAllResults), which would
  // otherwise mean re-wiring a fresh listener onto every copy button after
  // every single rescan. One listener on the panel itself, checked against
  // whatever was actually clicked, survives that innerHTML replacement.
  panel.addEventListener("click", (e) => {
    const btn = e.target.closest(".sentinel-copy-btn");
    if (!btn) return;
    copySnippet(btn);
  });
  // Same fix as the MutationObserver below: scroll fires far too often to
  // run a getBoundingClientRect() sweep on every event. One check per
  // animation frame (so it still tracks the panel smoothly) instead of one
  // per scroll event (which can be 60+ a second during a fast scroll).
  //
  // Real bug (a GitHub docs-style page): 'scroll' events do NOT bubble in
  // the DOM, so a plain window listener only ever fires for scrolling the
  // whole page. A lot of modern sites (GitHub's docs UI included) scroll
  // an inner content container instead, the window itself never scrolls,
  // so this never re-ran and a badge could sit there, visibly overlapping
  // the open panel, looking like a second, dead "Scan" control mixed into
  // our own results. `capture: true` catches scroll on ANY nested
  // scrollable element too, capture-phase listeners reach the target
  // regardless of whether the event bubbles.
  window.addEventListener("scroll", scheduleHideOverlapCheck, { passive: true, capture: true });
  window.addEventListener("resize", scheduleHideOverlapCheck);
  makePanelDraggable(panel);
  try {
    chrome.storage?.local?.get("sentinelPanelPos", (data) => {
      if (data && data.sentinelPanelPos) {
        const pos = clampToViewport(data.sentinelPanelPos.left, data.sentinelPanelPos.top, panel);
        applyPanelPosition(panel, pos);
      }
    });
  } catch (err) {
    // no chrome.storage available, panel just keeps its default spot
  }
  return panel;
}

// The jump link (#:~:text=...) only works when the browser's own scroll-to-
// text-fragment feature can find an exact match on the live page, which is
// unreliable: whitespace/markup differences between the raw HTML we fetched
// and what actually renders, dynamically-injected content, or a browser
// setting can all silently break it, and per real user feedback, it often
// does. Copying the exact wording to paste into the page's own Find
// (Ctrl+F) always works, since Find does its own fuzzy, live-DOM search
// instead of depending on a URL trick.
function copySnippet(btn) {
  const text = btn.dataset.copyText || "";
  const onCopied = () => {
    const original = btn.innerHTML;
    btn.classList.add("sentinel-copied");
    btn.innerHTML = "✓";
    setTimeout(() => {
      btn.classList.remove("sentinel-copied");
      btn.innerHTML = original;
    }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onCopied, () => fallbackCopy(text, onCopied));
  } else {
    fallbackCopy(text, onCopied);
  }
}
function fallbackCopy(text, onDone) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch (err) {
    // Nothing more to try, the button just won't show the checkmark.
  }
  document.body.removeChild(ta);
  onDone();
}

// The results panel is a fixed overlay pinned to the top-right corner, but
// the little inline "Scan"/"Review" badges next to each Terms/Privacy link
// on the page itself are NOT fixed, they sit in normal document flow. On a
// page whose Terms/Privacy links happen to fall in that same top-right
// region at the current scroll position, an on-page badge can end up
// sitting right next to, or overlapping, a line inside the panel, reading
// as if it were part of that result (a real bug report: a "Scan" button
// appearing to be part of a result line).
//
// An earlier fix hid EVERY on-page badge while the panel was open, which
// fixed that, but broke something else: clicking one Terms/Privacy badge
// hid the OTHER badges on the same page too (three of them, in Jax's
// GoHighLevel footer), making it look like they'd vanished and blocking
// the normal workflow of scanning each one in turn. This checks each
// badge's actual on-screen position against the panel's, and only hides
// the ones that genuinely overlap it right now, leaving every other badge
// clickable. It re-checks on scroll/resize too, since which badges overlap
// can change as the page moves.
let hideOverlapRAF = null;
function scheduleHideOverlapCheck() {
  if (hideOverlapRAF) return;
  hideOverlapRAF = requestAnimationFrame(() => {
    hideOverlapRAF = null;
    hideOverlappingBadges();
  });
}

function hideOverlappingBadges() {
  if (!panel) return;
  const panelRect = panel.getBoundingClientRect();
  const panelVisible = panel.classList.contains("sentinel-open");
  document.querySelectorAll(".sentinel-badge").forEach((b) => {
    const overlaps =
      panelVisible &&
      (() => {
        const r = b.getBoundingClientRect();
        return !(r.right < panelRect.left || r.left > panelRect.right || r.bottom < panelRect.top || r.top > panelRect.bottom);
      })();
    if (overlaps) {
      b.dataset.sentinelHiddenForPanel = "1";
      b.style.visibility = "hidden";
    } else if (b.dataset.sentinelHiddenForPanel) {
      b.style.visibility = "";
      delete b.dataset.sentinelHiddenForPanel;
    }
  });
}
function showPageBadges() {
  document.querySelectorAll('.sentinel-badge[data-sentinel-hidden-for-panel]').forEach((b) => {
    b.style.visibility = "";
    delete b.dataset.sentinelHiddenForPanel;
  });
}

// A single, always-visible "Scan everything" button, fixed to the same
// top-right corner the results panel uses (and hidden while the panel is
// open, so the two never compete for the same spot). This exists because
// the per-link badges live wherever the site put its Terms/Privacy links,
// usually buried in a footer nobody scrolls to before clicking "sign up."
// One button in a consistent spot, found the moment the page loads, fixes
// that regardless of where a given site hides its links.
let launcher = null;

// Real report: on some sites the fixed top-right spot this button lives in
// sits right on top of real page content (a nav item, a sign-in button),
// so the person can't reach what's underneath it. Making it draggable
// fixes that without needing to guess a better default spot for every
// possible site layout, the person just drags it wherever it's out of the
// way, once, and it remembers.
function applyLauncherPosition(l, pos) {
  if (!pos) return;
  l.style.left = `${pos.left}px`;
  l.style.top = `${pos.top}px`;
  l.style.right = "auto";
  l.style.bottom = "auto";
}

function clampToViewport(left, top, el) {
  const rect = el.getBoundingClientRect();
  const maxLeft = Math.max(0, window.innerWidth - rect.width);
  const maxTop = Math.max(0, window.innerHeight - rect.height);
  return { left: Math.min(Math.max(0, left), maxLeft), top: Math.min(Math.max(0, top), maxTop) };
}

function makeLauncherDraggable(l) {
  const DRAG_THRESHOLD = 4; // px of movement before a press counts as a drag, not a click
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;

  l.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return; // left button / touch only
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    const rect = l.getBoundingClientRect();
    originLeft = rect.left;
    originTop = rect.top;
    l.setPointerCapture(e.pointerId);
  });

  l.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    moved = true;
    l.classList.add("sentinel-launcher-dragging");
    const { left, top } = clampToViewport(originLeft + dx, originTop + dy, l);
    applyLauncherPosition(l, { left, top });
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    l.classList.remove("sentinel-launcher-dragging");
    if (moved) {
      const rect = l.getBoundingClientRect();
      const pos = { left: rect.left, top: rect.top };
      try {
        chrome.storage?.local?.set({ sentinelLauncherPos: pos });
      } catch (err) {
        // storage not available for some reason, just skip persisting
      }
    }
  };
  l.addEventListener("pointerup", endDrag);
  l.addEventListener("pointercancel", endDrag);

  // A drag that moved the button shouldn't also fire the "scan everything"
  // click. The click event fires right after pointerup, so this only
  // needs to swallow it once per completed drag.
  l.addEventListener(
    "click",
    (e) => {
      if (moved) {
        e.preventDefault();
        e.stopImmediatePropagation();
        moved = false;
      }
    },
    true
  );
}

// Real feedback: minimizing/closing the panel existed, but there was no
// way to just move it out of the way, the way the launcher button already
// can be. It can land pinned over the exact corner of a page the person
// needs. Same drag mechanics as the launcher, grabbing only the header (not
// the whole panel) so the results body underneath keeps scrolling normally
// and its copy/link buttons still click.
function applyPanelPosition(p, pos) {
  if (!pos) return;
  p.style.left = `${pos.left}px`;
  p.style.top = `${pos.top}px`;
  p.style.right = "auto";
  p.style.bottom = "auto";
}

function makePanelDraggable(p) {
  const header = p.querySelector(".sentinel-panel-header");
  const DRAG_THRESHOLD = 4;
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;

  header.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest(".sentinel-panel-header-actions")) return; // don't hijack minimize/close
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    const rect = p.getBoundingClientRect();
    originLeft = rect.left;
    originTop = rect.top;
    header.setPointerCapture(e.pointerId);
  });

  header.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    moved = true;
    p.classList.add("sentinel-panel-dragging");
    const { left, top } = clampToViewport(originLeft + dx, originTop + dy, p);
    applyPanelPosition(p, { left, top });
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    p.classList.remove("sentinel-panel-dragging");
    if (moved) {
      const rect = p.getBoundingClientRect();
      const pos = { left: rect.left, top: rect.top };
      try {
        chrome.storage?.local?.set({ sentinelPanelPos: pos });
      } catch (err) {
        // storage not available for some reason, just skip persisting
      }
    }
  };
  header.addEventListener("pointerup", endDrag);
  header.addEventListener("pointercancel", endDrag);

  // A drag that moved the panel shouldn't also trigger the "expand when
  // minimized" click handler on the header (below). Same swallow-the-
  // trailing-click pattern as the launcher's own drag handling.
  header.addEventListener(
    "click",
    (e) => {
      if (moved) {
        e.preventDefault();
        e.stopImmediatePropagation();
        moved = false;
      }
    },
    true
  );
}

function ensureLauncher() {
  if (launcher) return launcher;
  launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "sentinel-launcher";
  launcher.title = "Scan every linked Terms/Privacy page. Drag to move.";
  launcher.addEventListener("click", () => {
    document.querySelectorAll(".sentinel-badge").forEach((b) => {
      if (!b.disabled) b.click();
    });
  });
  makeLauncherDraggable(launcher);
  ensureShadowRoot().appendChild(launcher);
  try {
    chrome.storage?.local?.get("sentinelLauncherPos", (data) => {
      if (data && data.sentinelLauncherPos) {
        const pos = clampToViewport(data.sentinelLauncherPos.left, data.sentinelLauncherPos.top, launcher);
        applyLauncherPosition(launcher, pos);
      }
    });
  } catch (err) {
    // no chrome.storage available, launcher just keeps its default spot
  }
  return launcher;
}
// Found the real cause of "the button doesn't respond to clicks" (real
// report, 2026-09-15): this used to rebuild the button's contents with
// innerHTML on EVERY call, and updateLauncher() runs on every scanPage(),
// which on a busy page can fire several times a second even after the
// throttling fix. If a click's mousedown and mouseup happen to straddle one
// of those rebuilds, the exact node the browser tracked from mousedown gets
// torn down and replaced mid-click, and Chromium can then fail to fire the
// click event at all, even though a visually identical button is still
// sitting right there afterward. That's indistinguishable from "the button
// is just broken" from the outside.
//
// Fix: only touch the DOM when the visible state actually needs to change
// (the link count changed, or shown/hidden flipped), which makes the
// steady-state case, by far the most common one, a total no-op. Also
// switched from innerHTML/a child <span> to plain textContent, so even a
// genuine update can't tear down and recreate a child node mid-click.
let launcherLastCount = -1;
let launcherLastVisible = null;
function updateLauncher() {
  const l = ensureLauncher();
  // Belt-and-suspenders: even with the non-webpage bailout above, never let
  // a launcher element that isn't a normal styleable node crash the script.
  if (!l || !l.style) return;
  const count = document.querySelectorAll(".sentinel-badge").length;
  const shouldShow = count > 0 && !(panel && panel.classList.contains("sentinel-open"));

  if (shouldShow !== launcherLastVisible) {
    l.style.display = shouldShow ? "flex" : "none";
    launcherLastVisible = shouldShow;
  }
  if (!shouldShow) return;
  if (count !== launcherLastCount) {
    // "Scan" is the action, so it's the loud part; the count is context,
    // not the headline, so it reads as a smaller line underneath instead
    // of competing with the verb for attention. Safe to use innerHTML with
    // a child element again now that updateLauncher() only runs on a real
    // change instead of on every scan tick, which is what caused the
    // click-eating race this was rebuilt to avoid in the first place.
    l.innerHTML = `<span class="sentinel-launcher-main">🛡️ Scan</span><span class="sentinel-launcher-count">${count} ${count === 1 ? "page" : "pages"} identified</span>`;
    launcherLastCount = count;
  }
}

// Chromium's built-in "text fragment" navigation (#:~:text=...) scrolls to
// and highlights an exact piece of text on a page, the same mechanism
// Chrome itself generates from "Copy link to highlight" in its right-click
// menu. We already capture the exact wording each flag matched (f.snippet,
// a verbatim slice of the fetched page's own text), so we can hand back a
// real link straight to that sentence instead of just quoting it.
//
// This is NOT the same as a numbered clause reference (e.g. "14.2.3").
// Most Terms/Privacy pages have no stable per-clause anchor in their HTML
// at all, and background.js only ever sees stripped plain text, not the
// page's heading structure, so there is no section number to hand back
// even when a page happens to display one. A text-fragment link is the
// closest reliable equivalent: click it and the browser jumps straight to,
// and highlights, the exact sentence that was flagged.
function buildJumpLink(pageUrl, snippet) {
  if (!pageUrl || !snippet) return null;
  const clean = snippet.trim().replace(/^…+\s*/, "").replace(/\s*…+$/, "");
  if (!clean) return null;
  const words = clean.split(/\s+/);
  // Long exact-phrase fragments are brittle (any whitespace/punctuation
  // difference between our fetched copy and the live rendered page breaks
  // the match), so for a long snippet use only its first few and last few
  // words as a start,end pair, exactly how Chrome's own "Copy link to
  // highlight" feature does it.
  const fragment =
    words.length <= 12
      ? encodeURIComponent(clean)
      : `${encodeURIComponent(words.slice(0, 6).join(" "))},${encodeURIComponent(words.slice(-6).join(" "))}`;
  const base = pageUrl.split("#")[0];
  return `${base}#:~:text=${fragment}`;
}

// Severity used to be communicated ONLY by a 10px grey uppercase word
// ("high"/"medium") tucked at the end of the title line, and by a subtle
// border/background tint. Found (real user report, 2026-09-15): that's
// functionally invisible, especially at a glance or for anyone who doesn't
// have sharp close-up vision. Accessibility needs two independent signals,
// not just color, so severity now shows as an icon AND a bold word AND a
// solid-color pill, never color alone.
function severityMeta(sev) {
  if (sev === "high") return { icon: "🚩", word: "HIGH RISK", color: "#c0392b", bg: "rgba(192, 57, 43, 0.14)" };
  if (sev === "medium") return { icon: "⚠️", word: "MEDIUM", color: "#a35a00", bg: "rgba(214, 136, 0, 0.16)" };
  return { icon: "ℹ️", word: "LOW", color: "#546069", bg: "rgba(127, 140, 141, 0.14)" };
}

// A quick-glance count row above the individual cards ("🚩 2 High risk  ⚠️ 1
// Medium"), so someone can tell how serious a section is before reading a
// single card, the same way an inbox shows an unread count.
function severitySummary(flags) {
  const counts = { high: 0, medium: 0, low: 0 };
  flags.forEach((f) => {
    if (counts[f.severity] !== undefined) counts[f.severity]++;
  });
  const parts = ["high", "medium", "low"]
    .filter((sev) => counts[sev] > 0)
    .map((sev) => {
      const m = severityMeta(sev);
      return `<span class="sentinel-summary-chip" style="background:${m.color}">${m.icon} ${counts[sev]} ${escapeHtml(
        sev === "high" ? "High risk" : sev === "medium" ? "Medium" : "Low"
      )}</span>`;
    });
  return parts.length ? `<div class="sentinel-summary-row">${parts.join("")}</div>` : "";
}

// Real feedback (2026-09-16): severity alone (one red pill among several)
// doesn't convey how much worse it is when several high-severity clauses
// stack up in the SAME document, versus just one. Three or more high-
// severity flags in one document gets its own loud banner above the
// individual results, so it reads as more alarming at a glance than the
// severity color alone.
const MAJOR_WARNING_THRESHOLD = 3;
function countHighSeverity(flags) {
  return flags.filter((f) => f.severity === "high").length;
}
function renderMajorWarning(flags) {
  const n = countHighSeverity(flags);
  if (n < MAJOR_WARNING_THRESHOLD) return "";
  return `<p class="sentinel-major-warning">⚠️ ${n} major red flags in this document</p>`;
}

// Real feedback: "it would be interesting to have a little dot" on the
// toolbar icon showing how many high-severity flags a scan turned up,
// updated automatically once a scan happens (not a re-scan-on-every-page-
// visit feature, that would mean silently background-fetching every linked
// document on every page Jax visits, a much bigger change to what this
// extension does; this only reflects whatever's already been scanned via
// a badge, the launcher, or the toolbar icon itself). Mirrors
// renderPageSection's own dedup logic exactly, so the badge count on the
// icon never disagrees with what the panel underneath actually shows.
function computeHighFlagTotal() {
  const entries = Array.from(scanResults.values());
  let total = 0;
  entries.forEach((entry) => {
    total += countHighSeverity(entryAllFlags(entry));
  });
  const anyOnDocAlready = entries.some((e) => e.onThatDocumentAlready);
  if (!anyOnDocAlready) {
    const checked = entries.find((e) => !e.connectionError && e.pageFlags);
    if (checked) total += countHighSeverity(checked.pageFlags);
  }
  return total;
}

function renderFlagGroup(title, flags, baseUrl) {
  if (!flags.length) return "";
  // f.label and f.explanation come from our own rules.js, always safe. But
  // f.snippet is the actual wording lifted from whatever page got scanned,
  // text this extension does not control. It was being inserted into
  // innerHTML unescaped: if a scanned page's visible text ever literally
  // contained something like "<img src=x onerror=...>", the browser would
  // parse it as real markup inside our own panel instead of showing it as
  // plain text. Unlikely in practice (background.js strips HTML tags
  // before scanning, and innerText doesn't preserve real markup either),
  // but it's untrusted input rendered without escaping, so it gets fixed
  // on principle rather than waiting for a page that actually triggers it.
  return (
    (title ? `<p class="sentinel-group-title">${title}</p>` : "") +
    severitySummary(flags) +
    flags
      .map((f) => {
        const jumpLink = buildJumpLink(baseUrl, f.snippet);
        const m = severityMeta(f.severity);
        return `
      <div class="sentinel-flag sentinel-flag-${f.severity}" style="background:${m.bg}; border-color:${m.color}">
        <div class="sentinel-sev-badge" style="background:${m.color}">${m.icon} ${escapeHtml(m.word)}</div>
        <div class="sentinel-flag-label">${escapeHtml(f.label)}</div>
        <div class="sentinel-flag-explain">${escapeHtml(f.explanation)}</div>
        <div class="sentinel-snippet-row">
          <div class="sentinel-flag-snippet">"…${escapeHtml(f.snippet)}…"</div>
          <button type="button" class="sentinel-copy-btn" data-copy-text="${escapeHtml(f.snippet)}" title="Copy this exact wording, then paste it into the page's own Find (Ctrl+F / Cmd+F) to locate it yourself" aria-label="Copy exact wording">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
              <path d="M3.5 10.5h-1a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="1.4"/>
            </svg>
          </button>
        </div>
        ${
          jumpLink
            ? `<a class="sentinel-jump-link" href="${escapeHtml(jumpLink)}" target="_blank" rel="noopener noreferrer">↗ Open &amp; scan</a>`
            : ""
        }
      </div>`;
      })
      .join("")
  );
}

function renderOneResult(entry) {
  const { label, url, termsResult, termsError, connectionError } = entry;
  let html = `<p class="sentinel-link-label">${escapeHtml(label)}</p><p class="sentinel-source-url" title="${escapeHtml(
    url
  )}">${escapeHtml(shortUrlForDisplay(url))}</p>`;

  if (connectionError) {
    html += `<p class="sentinel-error">Couldn't scan this one: ${escapeHtml(connectionError)}</p>`;
    return html;
  }

  // The "on this page" check (the CURRENT page's own visible text) used to
  // repeat inside every single entry block, identical every time, since
  // it's the same page text regardless of which link the badge belongs to.
  // Real report (imgur.com): seeing "Clear, nothing flagged on the visible
  // page" printed once under Terms and again, word for word, under
  // Privacy read as contradictory or duplicated, not as two honest repeats
  // of the same fact. It's now rendered exactly once, above every entry
  // (see renderPageSection), so each entry here only covers what's
  // specific to it: its own linked document.
  if (!termsResult) {
    // "That's not the same as clear, it's genuinely unchecked" used to run
    // after this every time. Real feedback: redundant, since the badge and
    // this line already only ever say one of "Clear" or "Couldn't check
    // it", never something that could be confused for the other. Cut it,
    // and for the specific case below (a site that needs to be open to
    // read), say plainly why in the person's own terms, not an error
    // string, then hand them the fix instead of just naming the problem.
    const isJsRenderIssue = termsError && /javascript|enough readable text/i.test(termsError);
    // Real bug (vumatel.co.za): several of their real Terms/Privacy links
    // point straight at a PDF, not a page. background.js now catches that
    // and throws this exact code rather than a sentence, deliberately not
    // matching the JS-render regex above: opening a PDF in a new tab and
    // clicking "scan" again would hit the exact same PDF and fail the exact
    // same way, so it needs its own message, not the JS-render one's
    // "open it and try again" advice, which would be actively wrong here.
    const isPdfIssue = termsError === "PDF_DOCUMENT";
    html += `<p class="sentinel-error">Couldn't check it${
      isPdfIssue
        ? ". It's a PDF, which this can't read automatically yet"
        : isJsRenderIssue
        ? ". Based on how this site is built, it can't be read automatically"
        : termsError
        ? `: ${escapeHtml(termsError)}`
        : ""
    }.</p>`;
    if (isPdfIssue) {
      html += `<p class="sentinel-recommend">👉 Worth opening <a class="sentinel-doc-link" href="${escapeHtml(
        url
      )}" target="_blank" rel="noopener noreferrer">the PDF itself</a> and giving it a read, this one has to be checked by eye for now.</p>`;
    }
    // The most common reason this fetch fails (real report, hellopeter.com):
    // the page only fills in its real text once it's actually open in a
    // tab, and a background fetch never sees that. Real feedback on the
    // first version of this message: don't explain the technical why, and
    // don't tell someone to click a badge that (at that point) just failed
    // and will fail again the same way. Point at the one thing that works:
    // the badge next to this link on the page has turned into an
    // "↗ Open & scan" button, which opens the real page for you.
    if (termsError && /javascript|enough readable text/i.test(termsError)) {
      // Real feedback (hellopeter.com, round two): "next to the link on the
      // page" still isn't direct enough when the panel is covering the
      // bottom of the page the person is looking at. Name the actual link
      // by its own label and say where on the page to look, not just that
      // a badge exists somewhere.
      // Real report (hellopeter.com, round three): this bare <strong> was
      // the only element in the whole panel with no class of its own, so
      // it had no color rule protecting it, it just inherited whatever a
      // HOST PAGE's own global "strong { ... }" selector said, and on
      // hellopeter.com that made it functionally invisible. Every other
      // element we render has a sentinel- class with an explicit color;
      // give this one the same so a site's own styles can never leak in.
      html += `<p class="sentinel-recommend">👉 Scroll to the bottom of this page and click the "↗ Open & scan" badge next to <strong class="sentinel-strong">${escapeHtml(label)}</strong>. It'll open the real page so you can scan it from there.</p>`;
    }
  } else if (!termsResult.flags.length) {
    // Real feedback: showing the URL in a separate line above wasn't
    // enough, "that document" here still read as a vague, unlinked
    // reference. Make the reference itself the clickable link, straight
    // to the exact page that was actually checked.
    html += `<span class="sentinel-clean-pill">✅ Clear</span><p class="sentinel-clean">Nothing flagged in <a class="sentinel-doc-link" href="${escapeHtml(
      url
    )}" target="_blank" rel="noopener noreferrer">that document</a>.</p>`;
  } else {
    html += renderMajorWarning(termsResult.flags) + renderFlagGroup("", termsResult.flags, url);
  }

  return html;
}

// The visible text of the CURRENT page (as opposed to whatever's inside a
// linked Terms/Privacy document) is scanned once per badge click, but it's
// the exact same page text every time, so every entry used to carry an
// identical copy of this result. Shown once, up top, instead of repeated
// once per link.
function renderPageSection(entries) {
  // If we're standing on one of the actual linked documents already, its
  // own result block above IS this page's visible text, word for word
  // (see onThatDocumentAlready in runScan). Showing it again down here
  // would just be the exact same flags printed twice, the same duplicate
  // this section exists to avoid in the first place.
  if (entries.some((e) => e.onThatDocumentAlready)) return "";
  const checked = entries.find((e) => !e.connectionError && e.pageFlags);
  if (!checked) return "";
  const { pageFlags } = checked;
  const body = pageFlags.length
    ? renderMajorWarning(pageFlags) + renderFlagGroup("", pageFlags, window.location.href)
    : `<span class="sentinel-clean-pill">✅ Clear</span><p class="sentinel-clean">Nothing flagged on <a class="sentinel-doc-link" href="${escapeHtml(
        window.location.href
      )}" target="_blank" rel="noopener noreferrer">the visible page</a>.</p>`;
  // Real feedback: the actual point of this extension is the Terms/Privacy
  // DOCUMENTS, which are the thing companies bury and hope nobody reads.
  // Almost nobody hides a red flag in a page's own plain visible text, so
  // this on-page check is a minor bonus, not the headline. It now renders
  // after the real per-document results, not before them, and its heading
  // says plainly that it's the secondary check.
  //
  // Real report: "Also checked: this page's own visible text" left the
  // person asking which page, the one that just opened in a new tab, or
  // this one? Name the actual URL, not just "this page."
  return `<p class="sentinel-group-title" style="margin-top:14px">Also checked: <span class="sentinel-source-url-inline" title="${escapeHtml(
    window.location.href
  )}">${escapeHtml(shortUrlForDisplay(window.location.href))}</span> (its own visible text)</p>${body}`;
}

// The point of flagging a vague clause (a "Feedback" license that never
// actually defines Feedback, e.g.) is usually to ask the company about it,
// in writing, not just to worry about it. Rather than making someone leave
// the panel to go hunt for an email address themselves, background.js
// already looked for one on the same page it fetched: a real mailto:
// address first (fastest way to get an answer in writing), or a link whose
// own text says it's the contact/support page, whichever it found. Shown
// nothing if neither exists, no dead-end "couldn't find contact info"
// clutter for the common case where it isn't there.
//
// This used to render once PER scanned link, so scanning both a site's
// Terms and Privacy pages (outsurance.co.za, real report) showed the exact
// same "Contact outsurance.co.za" button twice. It's one company either
// way, so this now runs once for the whole panel: pick the first entry
// (in the already-Terms-first sorted order) that actually found something,
// and render just that one, at the very bottom.
function findContactEntry(sortedEntries) {
  return sortedEntries.find((e) => e.termsResult && e.termsResult.contact && (e.termsResult.contact.email || e.termsResult.contact.contactPageUrl));
}
function renderContactRow(termsResult, url) {
  const contact = termsResult && termsResult.contact;
  if (!contact || (!contact.email && !contact.contactPageUrl)) return "";
  let hostname = url;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, "");
  } catch (err) {
    // keep the raw url as a fallback label
  }
  const href = contact.email ? `mailto:${contact.email}` : contact.contactPageUrl;
  const labelText = contact.email ? `Email ${hostname}` : `Contact ${hostname}`;
  return `
    <div class="sentinel-contact-row">
      <p class="sentinel-contact-lede">Have a question about a clause? Ask them directly, in writing:</p>
      <a class="sentinel-contact-btn" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">✉️ ${escapeHtml(labelText)}</a>
    </div>`;
}

// Real feedback (2026-09-15): on a page with several linked documents
// (Terms, Privacy, and others), the high/medium flags could end up buried
// far down the panel behind a low-severity result that just happened to
// get scanned first, and nobody's going to scroll a long panel to find out
// whether something serious is waiting further down. Two fixes: put Terms
// of Service first, since that's the one most likely to carry the
// consequential stuff (content licenses, arbitration, liability), ahead of
// Privacy and anything else regardless of scan order, AND put one overview
// grid at the very top of everything, so the full picture (how many
// high/medium/low, per category) is visible before scrolling into a single
// result's detail.
const CATEGORY_ORDER = ["Terms", "Privacy", "Other"];
function classifyEntryCategory(entry) {
  const text = `${entry.label || ""} ${entry.url || ""}`.toLowerCase();
  if (/\bterms\b|conditions of use|user agreement/.test(text)) return "Terms";
  if (/privacy/.test(text)) return "Privacy";
  return "Other";
}
function entryAllFlags(entry) {
  if (entry.connectionError) return [];
  // Real bug (imgur.com, 2026-09-16): pageFlags come from scanning the
  // CURRENT page's visible text, which is the exact same text no matter
  // which linked document (Terms, Privacy, ...) a given entry is for. Used
  // to get folded into every category's count here, so the same visible-
  // page flags got double-counted into both the Terms card AND the Privacy
  // card, inflating both with something that belongs to neither document
  // specifically. A category card should only reflect that category's own
  // linked document.
  return entry.termsResult ? entry.termsResult.flags : [];
}

// Real bug (helloperter.com, 2026-09-16): this used to show a green
// "Clear" card for a category whose linked page actually failed to fetch
// (JS-rendered, nothing readable in the raw HTML), because "0 flags" was
// treated as the same thing as "0 flags AND we actually checked." Those
// are not the same claim, and the whole point of the per-result sections
// below is that unchecked never gets to look like clear, the overview grid
// was quietly breaking that rule at the summary level. Now it tracks
// whether anything in a category came back unchecked, separately from
// whether anything was flagged, and never shows the green "Clear" state
// unless every entry in that category was actually, successfully read.
function renderOverviewGrid(entries) {
  if (entries.length < 2) return ""; // one result IS the detail, a summary of itself adds nothing
  const byCategory = new Map(); // category -> { flags: [], anyUnchecked: bool }
  entries.forEach((entry) => {
    const cat = classifyEntryCategory(entry);
    if (!byCategory.has(cat)) byCategory.set(cat, { flags: [], anyUnchecked: false });
    const bucket = byCategory.get(cat);
    bucket.flags.push(...entryAllFlags(entry));
    if (entry.connectionError || !entry.termsResult) bucket.anyUnchecked = true;
  });
  const cards = CATEGORY_ORDER.filter((cat) => byCategory.has(cat))
    .map((cat) => {
      const { flags, anyUnchecked } = byCategory.get(cat);
      let body;
      if (flags.length) {
        body = severitySummary(flags) + (anyUnchecked ? `<span class="sentinel-overview-unchecked">⚠️ + part unchecked</span>` : "");
      } else if (anyUnchecked) {
        body = `<span class="sentinel-overview-unchecked">⚠️ Unchecked</span>`;
      } else {
        body = `<span class="sentinel-overview-clear">✅ Clear</span>`;
      }
      return `<div class="sentinel-overview-card"><div class="sentinel-overview-title">${escapeHtml(cat)}</div>${body}</div>`;
    })
    .join("");
  return `<div class="sentinel-overview-grid">${cards}</div>`;
}

function renderAllResults(url) {
  const p = ensurePanel();
  const body = p.querySelector(".sentinel-panel-body");

  // Rebuild from EVERY scan result gathered on this page so far, not just
  // the one that was just clicked. A page with a separate Terms badge and
  // Privacy badge used to lose whichever one was scanned first the moment
  // the second one finished, since the panel only ever showed its latest
  // scan. Each link now keeps its own section. Sorted by category (Terms,
  // then Privacy, then anything else) rather than scan order, per the
  // above; Array.prototype.sort is stable in Chromium, so within the same
  // category results still stay in the order they were actually scanned.
  const entries = Array.from(scanResults.values());
  const sorted = [...entries].sort(
    (a, b) => CATEGORY_ORDER.indexOf(classifyEntryCategory(a)) - CATEGORY_ORDER.indexOf(classifyEntryCategory(b))
  );
  const overview = renderOverviewGrid(entries);
  const pageSection = renderPageSection(sorted);
  const blocks = sorted.map((entry) => `<div class="sentinel-result-block">${renderOneResult(entry)}</div>`).join(`<hr class="sentinel-divider">`);
  const contactEntry = findContactEntry(sorted);
  const contactRow = contactEntry ? renderContactRow(contactEntry.termsResult, contactEntry.url) : "";

  // The linked Terms/Privacy DOCUMENTS are the actual point (that's the
  // fine print companies bury on purpose); the current page's own visible
  // text is a minor bonus check almost nothing ever trips, so it now comes
  // last, after the real results, not first.
  body.innerHTML =
    overview +
    blocks +
    (pageSection ? `<hr class="sentinel-divider">${pageSection}` : "") +
    contactRow +
    `<p class="sentinel-footnote">Suggestions from simple word/phrase matching, not AI, not legal advice. It will miss things and occasionally over-flag. Use your own judgment.</p>`;
  p.querySelector(".sentinel-panel-title").textContent = `Fine Print Sentinel: ${new URL(url).hostname}`;
  p.classList.add("sentinel-open");
  // A fresh scan should always actually be visible, not silently update
  // behind a still-minimized header.
  p.classList.remove("sentinel-minimized");
  hideOverlappingBadges();
  updateLauncher();
  try {
    chrome.runtime.sendMessage({ type: "SENTINEL_UPDATE_BADGE", count: computeHighFlagTotal() });
  } catch (err) {
    // extension context can go away mid-navigation, nothing to do about it
  }
}

function sendMessage(msg) {
  // Two failure modes here won't show up as a normal error: (1) the
  // extension was reloaded/updated in brave://extensions while this page
  // was still open, which invalidates this content script's connection to
  // the background script and throws synchronously on some Chromium
  // versions, and (2) chrome.runtime.sendMessage can also just never call
  // its callback in that same situation. Both used to leave the badge
  // stuck on "..." forever with no feedback. Guard against both.
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timeoutId = setTimeout(() => {
      finish({ ok: false, error: "No response from the extension. It may have been updated, try reloading this page." });
    }, 12000);
    try {
      chrome.runtime.sendMessage(msg, (response) => {
        clearTimeout(timeoutId);
        if (chrome.runtime.lastError) {
          finish({ ok: false, error: "Lost connection to the extension. Try reloading this page." });
          return;
        }
        finish(response);
      });
    } catch (err) {
      clearTimeout(timeoutId);
      finish({ ok: false, error: "Lost connection to the extension. Try reloading this page." });
    }
  });
}

function overallSeverity(allFlags) {
  if (!allFlags.length) return "green";
  if (allFlags.some((f) => f.severity === "high")) return "red";
  return "orange";
}

function setBadgeState(badge, state, labelText) {
  badge.classList.remove("sentinel-green", "sentinel-orange", "sentinel-red");
  if (state) badge.classList.add(`sentinel-${state}`);
  badge.querySelector(".sentinel-label").textContent = labelText;
}

function getPageTextExcludingSentinelUI() {
  if (!document.body) return "";
  // On a rescan, Sentinel's own badges are already sitting in the page.
  // Reading document.body.innerText would then include OUR OWN output
  // (labels like "MEDIUM") as if it were the site's text, and a rule could
  // match itself. Hide them for the moment it takes to read the text, then
  // restore them. The results panel itself no longer needs the same
  // treatment: now that it lives inside a shadow root (see
  // ensureShadowRoot), document.body.innerText never reaches into it at
  // all, shadow DOM content is invisible to a light-DOM text read by
  // design, so there's nothing left to hide there.
  const ownElements = document.querySelectorAll(".sentinel-badge");
  const previousDisplay = [];
  ownElements.forEach((el) => {
    previousDisplay.push(el.style.display);
    el.style.display = "none";
  });
  const text = document.body.innerText.slice(0, 20000);
  ownElements.forEach((el, i) => {
    el.style.display = previousDisplay[i];
  });
  return text;
}

// Real report (hellopeter.com): clicking "↗ Open & scan" opens the real
// page in a new tab, exactly as promised, but scanning from THAT page
// still showed "Unchecked", because the badge for that same linked
// document still ran a background fetch of its URL, which fails for a
// JS-rendered page NO MATTER WHO'S looking at it or from where, a fetch
// never runs the page's JavaScript. The fix isn't in background.js at
// all: when the badge the person is clicking points at the very page
// they're already standing on, we don't need to fetch anything, the
// browser has already rendered it right here, so use that.
function normalizeUrlForComparison(href) {
  try {
    const u = new URL(href, window.location.href);
    return `${u.origin}${u.pathname.replace(/\/$/, "")}`;
  } catch (err) {
    return href;
  }
}

async function runScan(url, badge, linkLabel) {
  badge.disabled = true;
  setBadgeState(badge, null, "…");

  // Scan the visible text of THIS page too (catches things like "by
  // creating an account you agree..." consent language that lives on the
  // signup page itself, not inside the linked terms document).
  const pageTextResp = await sendMessage({
    type: "SENTINEL_SCAN_PAGE_TEXT",
    text: getPageTextExcludingSentinelUI()
  });
  const pageFlags = pageTextResp && pageTextResp.ok ? pageTextResp.result.flags : [];

  const termsResp = await sendMessage({ type: "SENTINEL_SCAN", url });
  let termsResult = termsResp && termsResp.ok ? termsResp.result : null;
  let termsErrorForDisplay = termsResp?.error;

  // We're already standing on the exact page this badge links to: use
  // what's actually rendered in front of us instead of a background fetch
  // that can never see it. Keep any contact info the fetch happened to
  // find; only the flags/error need replacing, and there's no error left
  // to show once we have a real result.
  const onThatDocumentAlready = normalizeUrlForComparison(url) === normalizeUrlForComparison(window.location.href);
  if (onThatDocumentAlready && pageTextResp?.ok) {
    termsResult = {
      url,
      flags: pageFlags,
      scannedAt: Date.now(),
      textLength: (pageTextResp.result && pageTextResp.result.textLength) || undefined,
      contact: termsResult ? termsResult.contact : null
    };
    termsErrorForDisplay = undefined;
  }

  badge.disabled = false;

  // If BOTH calls failed and neither even reached the extension (as
  // opposed to "terms page just didn't load"), don't show a falsely
  // reassuring green "Clear" badge, show the connection error instead.
  if (!pageTextResp?.ok && !termsResp?.ok) {
    setBadgeState(badge, "red", "Error");
    scanResults.set(url, {
      label: linkLabel,
      url,
      connectionError: pageTextResp?.error || termsResp?.error || "Something went wrong scanning this page."
    });
    renderAllResults(url);
    return;
  }

  const allFlags = pageFlags.concat(termsResult ? termsResult.flags : []);
  // Don't badge this "Clear" (green) if the linked terms document never
  // actually got checked, even if nothing on the visible page matched.
  // A green "Clear" badge here used to be flat-out wrong: it looked
  // identical to a real clean scan, with no way to tell the difference
  // from the badge alone.
  const termsUnchecked = !termsResult;
  const termsError = termsErrorForDisplay;
  // A page that needs JavaScript to render its real content will fail this
  // exact same way every single time we fetch it in the background, no
  // matter how many times the badge is clicked. Real user report: clicking
  // "Check" again in that situation just silently re-runs the same doomed
  // fetch. Once we know that's why it failed, stop offering a re-check and
  // turn the badge into what actually works: opening the real page so the
  // person can scan it once it's genuinely loaded in front of them.
  const needsManualOpen = termsUnchecked && termsError && /javascript|enough readable text/i.test(termsError);
  badge.dataset.sentinelNeedsManualOpen = needsManualOpen ? "1" : "0";
  const sev = termsUnchecked && !allFlags.length ? "orange" : overallSeverity(allFlags);
  const label = needsManualOpen
    ? "↗ Open & scan"
    : termsUnchecked && !allFlags.length
    ? "Check"
    : sev === "green"
    ? "Clear"
    : sev === "orange"
    ? "Check"
    : "Review";
  setBadgeState(badge, sev, label);
  badge.title = needsManualOpen
    ? "This page loads its text after you open it. Click to open it, then scan from within the page."
    : "";
  scanResults.set(url, {
    label: linkLabel,
    url,
    pageFlags,
    termsResult,
    termsError,
    // When this is true, "on this page" and "that linked document" are the
    // literal same content, they'll always agree. renderPageSection uses
    // this to skip showing that duplicate second copy of the same result.
    onThatDocumentAlready
  });
  renderAllResults(url);
}

scanPage();

// Real bug found via a live report (2026-09-15): on a busy, constantly-
// redrawing page like github.com, this observer's callback was firing on
// EVERY tiny DOM mutation anywhere in the whole document, completely
// unthrottled, each time running a full document.querySelectorAll("a[href]")
// sweep synchronously on the main thread. GitHub's own JS mutates the DOM
// continuously (live nav state, syntax highlighting, etc.), so this could
// fire dozens of times a second, which is exactly what "Page Unresponsive"
// looks like. scanPage() itself was never the expensive part, calling it
// hundreds of times a second was.
//
// Coalesce instead: any mutation schedules ONE scan ~400ms out, and any
// further mutations that land before it fires are absorbed into that same
// pending scan rather than each queuing their own. This caps scanPage() to
// roughly 2-3 calls per second even on the chattiest page, while still
// catching a React-style re-render within well under half a second, fast
// enough that a badge reappearing is not something you'd notice waiting for.
let scanScheduled = false;
function scheduleScan() {
  if (scanScheduled) return;
  scanScheduled = true;
  setTimeout(() => {
    scanScheduled = false;
    scanPage();
  }, 400);
}

// MutationObserver catches most DOM churn from React-style re-renders, but
// some sites redraw this section on a timer or after a delayed hydration
// step that can slip past a single observer callback. A short-lived polling
// fallback for the first few seconds after load catches those without
// needing to chase each site's specific render timing.
//
// None of this (observer, poll timer) is worth setting up at all on a
// non-webpage document (see sentinelIsRealWebpage above); document.body can
// also legitimately not exist yet this early on a real page, so wait for it
// rather than skipping outright.
if (sentinelIsRealWebpage && document.documentElement) {
  const observer = new MutationObserver(() => scheduleScan());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  let pollCount = 0;
  const pollTimer = setInterval(() => {
    scanPage();
    pollCount += 1;
    if (pollCount > 20) clearInterval(pollTimer); // ~20s of polling, then rely on the observer alone
  }, 1000);
}
