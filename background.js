// Background service worker: fetches a Terms/Privacy page and scans it,
// so the scan isn't limited by the page's own CSP/CORS rules the way a
// content-script fetch would be.

importScripts("rules.js");

// Real bug (onetrust.com): a copy-paste of the "quoted wording" in one
// result showed raw, garbled markup - things like
// &lt;span class=\&#34;body3-v2\&#34;&gt; - sitting right in what's meant
// to be plain legal prose. Some pages (this one included, likely from a
// CMS baking rich text into a JSON blob for client-side hydration)
// HTML-escape their own markup a SECOND time, so "<span>" is stored as the
// literal text "&lt;span&gt;" rather than a real tag. The old decoder only
// handled a handful of named entities (&nbsp; &amp; &#39; &quot;), so
// &lt;/&gt;/&#34; and anything else survived as literal escaped text
// instead of becoming readable. Broadened to a proper decode pass, ordered
// so &amp; is decoded LAST (decoding it earlier could turn an intentionally
// double-escaped "&amp;lt;" into "&lt;" and then wrongly decode that too).
function decodeHtmlEntities(str) {
  return str
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&#34;|&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "...")
    // Generic numeric entities (&#123; decimal, &#x7B; hex) catch anything
    // the named list above doesn't.
    .replace(/&#(\d+);/g, (m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/gi, (m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, "&");
}

function htmlToText(html) {
  // Strip script/style blocks, then tags, then decode entities.
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
  text = decodeHtmlEntities(text);
  // Decoding &lt;/&gt; above can reveal a SECOND layer of markup that was
  // hiding underneath the escaping (exactly the onetrust.com case), so
  // strip tags again now that they're visible as real "<...>" text, rather
  // than showing raw-looking code in what's supposed to be a plain-English
  // snippet.
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

function scanText(text) {
  const flags = [];
  for (const rule of SENTINEL_RULES) {
    let hit = null;
    if (rule.test) {
      hit = rule.test(text); // {index, length} or null
    } else {
      const match = text.match(rule.pattern);
      if (match) hit = { index: match.index || 0, length: match[0].length };
    }
    if (hit) {
      const start = Math.max(0, hit.index - 80);
      const end = Math.min(text.length, hit.index + hit.length + 80);
      const snippet = text.slice(start, end).trim();
      // Same match, calmer wording: a "Feedback" clause (product suggestions,
      // bug reports) uses the identical perpetual/irrevocable/royalty-free
      // legal shape as a real content-license grab, but is near-universal
      // SaaS boilerplate, not a claim on anyone's creative work or likeness.
      const useFeedbackVariant = rule.feedbackVariant && /\bfeedback\b/i.test(snippet);
      const variant = useFeedbackVariant ? rule.feedbackVariant : null;
      flags.push({
        id: rule.id,
        label: variant ? variant.label : rule.label,
        severity: useFeedbackVariant ? "low" : rule.severity,
        explanation: variant ? variant.explanation : rule.explanation,
        snippet
      });
    }
  }
  // High severity first; within a severity, rules with an explicit
  // `priority` (lower = more important) lead, since a couple of these
  // matter more than the rest to Jax specifically as a creator, not just
  // whichever pattern happened to match first in the text.
  const sevOrder = { high: 0, medium: 1, low: 2 };
  const priorityOf = (flag) => {
    const rule = SENTINEL_RULES.find((r) => r.id === flag.id);
    return rule && typeof rule.priority === "number" ? rule.priority : 99;
  };
  flags.sort((a, b) => {
    const sevDiff = sevOrder[a.severity] - sevOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return priorityOf(a) - priorityOf(b);
  });
  return flags;
}

// A real user need, not a hypothetical: when a clause is genuinely
// ambiguous (a "Feedback" license that doesn't define what counts as
// Feedback, e.g.), the useful next step is asking the company directly,
// in writing. Finding their contact info by hand means leaving the page
// to hunt for it, exactly the friction this whole extension exists to
// remove. So look for it on the same fetch we already made: prefer a real
// mailto: address (gets you something in writing fastest), fall back to a
// link whose own text says it's the contact/support page.
// Same normalization idea as content.js's onThatDocumentAlready: strip the
// hash and trailing slash so "this page" and "this page#contact-us" read
// as the same page.
function sameDocument(hrefA, hrefB) {
  try {
    const a = new URL(hrefA);
    const b = new URL(hrefB);
    return `${a.origin}${a.pathname.replace(/\/$/, "")}` === `${b.origin}${b.pathname.replace(/\/$/, "")}`;
  } catch (err) {
    return false;
  }
}

function findContactInfo(html, baseUrl) {
  const mailtoMatch = html.match(/href=["']mailto:([^"'?>\s]+)/i);
  const email = mailtoMatch ? mailtoMatch[1].trim() : null;

  let contactPageUrl = null;
  if (!email) {
    const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = anchorRegex.exec(html))) {
      const href = m[1];
      if (/^mailto:|^javascript:/i.test(href)) continue;
      const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (/\bcontact( us)?\b|\bsupport\b|\bhelp center\b|\bget in touch\b/i.test(text)) {
        let resolved;
        try {
          resolved = new URL(href, baseUrl).toString();
        } catch (err) {
          continue;
        }
        // Real report (fnb.co.za): a legal/Terms hub page can have its own
        // in-page "Contact us" jump link that just scrolls down to a
        // section on that SAME page (href="#contact-us"), not an actual
        // separate contact page. That used to get picked up as-is, so the
        // "Contact" button just reopened the Terms page the person was
        // already reading. Skip a candidate that resolves to the very
        // page we're already on and keep looking for a real one.
        if (sameDocument(resolved, baseUrl)) continue;
        contactPageUrl = resolved;
        break;
      }
    }
  }
  if (!email && !contactPageUrl) return null;
  return { email, contactPageUrl };
}

async function fetchAndScan(url) {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) {
    throw new Error(`Could not load that page (status ${res.status}).`);
  }
  const contentType = res.headers.get("content-type") || "";
  const html = await res.text();
  // Real bug (vumatel.co.za): several real Terms/Privacy/Code-of-Conduct
  // links point straight at a PDF file, not an HTML page. Fetched as text
  // and run through htmlToText, a PDF's compressed binary content turns
  // into mostly garbage bytes that no rule will ever match, an outcome
  // that used to be completely indistinguishable from "read it and it was
  // genuinely clean." "Clear" can only ever mean checked and found
  // nothing, exactly like the earlier name.com "Registration Agreement"
  // bug, so a PDF now explicitly can't be scanned yet rather than silently
  // reported as fine. Checked two ways since a server can mislabel the
  // content type: the header (fast, usually right) and the file's own
  // magic-byte signature (still works when a server serves a PDF as
  // octet-stream or even mislabeled as text/html).
  const looksLikePdf = contentType.includes("application/pdf") || html.startsWith("%PDF-");
  if (looksLikePdf) {
    throw new Error("PDF_DOCUMENT");
  }
  const text = htmlToText(html);
  if (text.length < 200) {
    throw new Error("That page didn't have enough readable text to scan (it may load its content with JavaScript).");
  }
  const flags = scanText(text);
  const contact = findContactInfo(html, url);
  return { url, flags, scannedAt: Date.now(), textLength: text.length, contact };
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  }
});

// Real feedback: clicking the toolbar icon did nothing at all, no popup was
// ever wired up, so it read as broken rather than just unbuilt. It now
// re-runs the exact same "scan everything" action as the on-page Scan
// button/launcher, the one thing that was otherwise only reachable by
// scrolling back down to find it. No popup is declared in manifest.json, so
// chrome.action.onClicked fires normally here.
chrome.action.onClicked.addListener((tab) => {
  if (!tab || tab.id == null) return;
  chrome.tabs.sendMessage(tab.id, { type: "SENTINEL_TOOLBAR_CLICK" }, () => {
    // No content script on this tab (a chrome:// page, the Web Store,
    // a not-yet-loaded tab, etc.) - nothing to do, and reading
    // chrome.runtime.lastError here is just how you avoid an "unchecked
    // error" console warning for the expected no-listener case.
    void chrome.runtime.lastError;
  });
});

// Real feedback: "it would be interesting to have a little dot" showing how
// many high-severity flags a scan has turned up, the same instinct as a
// password manager's icon badge showing how many logins it has saved for
// this page. content.js sends this after every scan it renders; the count
// is already deduplicated there the same way the panel's own display is
// (using the shared severity math, not a raw flag count), so the badge
// never disagrees with what the panel actually shows.
// Real bug (found via Brave's own extension error console): chrome.action's
// badge methods return a promise in MV3, and by the time one of these
// actually runs, the tab it's meant for can already be gone (closed, or a
// service-worker restart replaying a message for a tab that no longer
// exists) - it's a normal race, not something to prevent, but with nothing
// to catch it, that promise rejects as "No tab with id: N", uncaught, and
// shows up as a real error in the extension's error list even though
// nothing is actually broken. There's genuinely nothing to do when the tab
// is gone, so the catch here is intentionally silent.
function setBadgeSafely(tabId, text) {
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (text) {
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#a5281c" }).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "SENTINEL_UPDATE_BADGE") {
    const tabId = sender.tab && sender.tab.id;
    if (tabId != null) {
      setBadgeSafely(tabId, message.count > 0 ? String(message.count) : "");
    }
  }
});

// Badges are per-scan, not per-page-visit: without this, navigating to a
// brand new page would keep showing yesterday's count from whatever was
// scanned last on the tab, since chrome.action badges persist until
// explicitly changed. Clear it the moment a tab starts loading a new page,
// content.js's own scan (if any) will set a fresh one once it actually runs.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    setBadgeSafely(tabId, "");
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SENTINEL_SCAN") {
    fetchAndScan(message.url)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep the message channel open for the async response
  }
  if (message?.type === "SENTINEL_SCAN_PAGE_TEXT") {
    try {
      const flags = scanText(message.text || "");
      sendResponse({ ok: true, result: { flags } });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
    return true;
  }
});
