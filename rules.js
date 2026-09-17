// Fine Print Sentinel red-flag rules.
// Each rule is checked against the plain-text body of a Terms of Service /
// Privacy Policy page, with a plain-English explanation of why a match is
// worth a second look. This is a heuristic pass, not legal advice, and it
// will miss things and occasionally over-flag.

// PROXIMITY MATCHING, NOT FIXED WORD ORDER.
//
// Every rule here is built with makeProximityTest: anchor on one distinctive
// word or phrase, then require the rest of what the rule is looking for
// within a window of text around that anchor, in EITHER direction.
//
// This replaced an earlier design (kept as plain regex chains like
// /A[^.]{0,100}B[^.]{0,100}C/i) that assumed real contracts always phrase
// things in exactly one order. They don't. A run of adversarial test cases
// added 2026-09-15 (tests/rules.test.js) found that seven of these rules
// silently missed the equally common reverse phrasing:
//   - "we may terminate your account at our sole discretion" (action
//     before the "sole discretion" phrase) was missed by a rule that only
//     matched "at our sole discretion, we may terminate your account."
//   - "you agree to these terms by registering for an account" was missed
//     by a rule that only matched "by registering for an account, you
//     agree."
//   - five more of the same shape (content-ownership-transfer,
//     unilateral-changes-no-notice, indefinite-retention, no-liability,
//     cross-device-fingerprinting, moral-rights-waiver).
// None of these were reported bugs, they were found by testing the
// rules against phrasing nobody had happened to hit yet. Proximity
// matching, checked in both directions from one anchor, is immune to this
// whole class of miss by construction: it never assumes an order.
function makeProximityTest(anchorPattern, checkPatterns, window = 150) {
  const anchorRegex = new RegExp(
    anchorPattern.source,
    anchorPattern.flags.includes("g") ? anchorPattern.flags : anchorPattern.flags + "g"
  );
  return function (text) {
    // anchorRegex is created ONCE per rule (above, in the closure) and
    // reused across every call to this test() function, one per page
    // scanned. A global-flag regex remembers its lastIndex between calls,
    // so without resetting it here, a rule that already matched something
    // near the end of one page's text would start its NEXT scan (a
    // different page, possibly shorter) partway through instead of from
    // the beginning, silently missing matches. Found via the test suite
    // itself behaving inconsistently between runs before this reset was
    // added, not from a live bug report.
    anchorRegex.lastIndex = 0;
    let m;
    while ((m = anchorRegex.exec(text))) {
      const start = Math.max(0, m.index - window);
      const end = Math.min(text.length, m.index + m[0].length + window);
      const slice = text.slice(start, end);
      if (checkPatterns.every((p) => p.test(slice))) {
        return { index: m.index, length: m[0].length };
      }
      if (m[0].length === 0) anchorRegex.lastIndex++; // avoid an infinite loop on a zero-length match
    }
    return null;
  };
}

const SENTINEL_RULES = [
  {
    id: "irrevocable-license",
    label: "They can use your voice, likeness, or work forever, and you can't take it back",
    severity: "high",
    priority: 0,
    // Anchor on "irrevocable"/"perpetual" (rarer, more specific words)
    // rather than on "license" itself: real clauses sometimes say
    // "irrevocable right to..." with the word "license" too far away, or
    // several sentences apart from the qualifier list (worldwide,
    // sublicensable, assignable, etc).
    test: makeProximityTest(
      /irrevocable|perpetual/i,
      [/\bgrant/i, /licen[sc]e|right(s)? to/i, /sub-?licen[sc]e|sublicensable|transfer|assignable|world-?wide|royalty[- ]?free|non-?exclusive/i],
      250
    ),
    explanation:
      "You still technically own what you upload, your voice, your face, your song, your words, but you're handing over a permanent, unlimited license to it: they can use, alter, and re-license it however they want, forever, with no payment and no way to revoke it once it's granted. As a creator, this is the one to actually stop and read in full before continuing.",
    // Found via a real user report (2026-09-15, GoHighLevel): this rule's
    // explanation was written from the Suno case, so it always talks about
    // "your voice, your face, your song" even when what actually matched is
    // a standard "Feedback" clause (near-universal SaaS boilerplate: if you
    // email a company a suggestion, they don't want to owe you payment or
    // credit for building it). Same legal shape, perpetual/irrevocable/
    // royalty-free, but a very different, much lower-stakes thing than a
    // broad license over uploaded creative content. background.js swaps in
    // this calmer variant when the matched snippet itself contains the word
    // "feedback," instead of always showing the creator-content wording.
    feedbackVariant: {
      label: "Standard 'feedback' license clause (common, usually low-risk)",
      explanation:
        "This looks like it's about feedback or suggestions you send them (bug reports, feature requests), not your creative content, voice, or likeness. Almost every SaaS company's terms include a clause shaped exactly like this: perpetual, irrevocable, royalty-free, so they're not obligated to pay or credit you if they build something you suggested. Still worth a skim to confirm 'Feedback' is actually defined narrowly in their terms, but it's a different, much lower-stakes thing than a clause claiming rights over content you upload."
    }
  },
  {
    id: "moral-rights-waiver",
    label: "You give up the right to object to how your work is changed or credited",
    severity: "high",
    priority: 1,
    test: makeProximityTest(/waive/i, [/moral right|droit moral/i], 80),
    explanation:
      "Moral rights normally let a creator object to their work being altered, distorted, or misattributed even after they've licensed it away. Waiving them means you give up that say entirely, on top of whatever license you've already granted."
  },
  {
    id: "content-ownership-transfer",
    label: "Ownership transfer of your content",
    severity: "high",
    test: makeProximityTest(
      // Was anchored on "you (hereby )?(assign|transfer)", which requires
      // that exact active-voice phrasing and missed the equally common
      // passive voice ("...are hereby assigned to us"). Anchor on the verb
      // itself instead, with the "you" requirement dropped.
      /\b(assign|transfer)(ed|s)?\b|all right,? title,? and interest/i,
      [
        /ownership|copyright/i,
        // Real false positive (onetrust.com): "assign" + "ownership" alone
        // matches ordinary product copy about assigning a compliance TASK
        // to a team member ("Assign ownership for regulatory and
        // operational updates"), nothing to do with anyone's content or
        // IP. A real content-ownership clause is always ABOUT something,
        // your content, your work, your submissions, requiring one of
        // those nearby too closes off that whole false-positive shape
        // without needing to guess every way a real clause is worded.
        /\b(content|material|work|submission|upload|deliverable|intellectual property|\bIP\b|creat(ion|ive)s?)s?\b/i
      ],
      150
    ),
    explanation: "This reads like you're signing over ownership of what you create or upload, not just a license to use it."
  },
  {
    id: "data-broker-resale",
    label: "Data sold or transferred to data brokers",
    severity: "high",
    test: makeProximityTest(/data broker/i, [/resale|re-?sale|personal (data|information)|your (data|information)/i], 150),
    explanation: "Your personal data may be handed to third-party data brokers to be resold or reused, sometimes automatically after a period of inactivity."
  },
  {
    id: "third-party-sharing-broad",
    label: "Broad third-party data sharing",
    severity: "medium",
    test: makeProximityTest(
      /third[- ]part(y|ies)|affiliates|partners|clients of our clients/i,
      [/share|disclose|provide/i, /personal (data|information)/i],
      150
    ),
    explanation: "Your data can flow beyond the company itself to an open-ended list of partners, affiliates, or clients' clients."
  },
  {
    id: "arbitration-class-waiver",
    label: "Forced arbitration + class-action waiver",
    severity: "high",
    // Real feedback (2026-09-16): grouped into the top priority cluster
    // with irrevocable-license and moral-rights-waiver. This is the one
    // that removes your ability to take a company to court at all, or join
    // with anyone else who has the same complaint, no matter how bad the
    // conduct is.
    priority: 2,
    // Already order-independent in effect (each phrase alone is enough),
    // so a straightforward alternation stays as a plain pattern.
    pattern: /(class action waiver|waive[^.]{0,40}(class action|jury trial)|binding arbitration)/i,
    explanation: "You may be giving up the right to sue in court or join a class action, agreeing instead to individual arbitration decided outside the normal legal system."
  },
  {
    id: "unilateral-changes-no-notice",
    label: "Terms can change without notice",
    severity: "high",
    // Real feedback (2026-09-16): grouped into the top priority cluster,
    // right behind arbitration-class-waiver, for the same reason it was
    // raised to high in the first place: it removes the ceiling on what
    // every other clause here could turn into later, unilaterally.
    priority: 3,
    // Real feedback (2026-09-16): raised from medium. The risk here isn't
    // this clause alone, it's that it removes any limit on what future
    // clauses could say. Everything else this tool flags is a known,
    // bounded risk you can weigh; this one means the company can add ANY
    // of those other risks later, unilaterally, with continued use alone
    // counting as your agreement, whether or not you ever saw the change.
    test: makeProximityTest(
      /modify|change|alter|update/i,
      [/these terms|this (agreement|policy)/i, /at any time|without notice|in our (sole )?discretion/i],
      130
    ),
    explanation: "The company can rewrite the terms you're agreeing to at any time, with no obligation to tell you, and continuing to use the service counts as accepting whatever they changed it to. It's not just this version of the terms you'd be agreeing to, it's any future version too, sight unseen."
  },
  {
    id: "sensitive-data-collection",
    label: "Sensitive personal data collection",
    severity: "medium",
    // A bare word match on "health" or "biometric" alone used to fire on
    // completely unrelated text, e.g. "public health emergencies" in a
    // force-majeure/event-cancellation clause has nothing to do with a
    // site collecting sensitive personal data, but shared the trigger
    // word. Anchor on the sensitive-category word, then require an actual
    // collection/data verb or noun nearby before calling it a match.
    test: makeProximityTest(
      /health|medical|sexual orientation|political (?:opinion|view|belief)|religious belief|race\/ethnic|biometric|genetic data/i,
      [/\b(collect|process(?:ing)?|gather|obtain)\b/i, /\b(data|information|categor(?:y|ies))\b/i],
      150
    ),
    explanation: "This policy names sensitive categories of data (health, sexual orientation, political or religious views, biometrics) it may collect or process."
  },
  {
    id: "indefinite-retention",
    label: "Vague or indefinite data retention",
    severity: "medium",
    test: makeProximityTest(/retain|keep|store/i, [/indefinitely|as long as necessary|for as long as/i], 150),
    explanation: "Retention periods described this vaguely give the company wide latitude to hold your data long after you'd expect it to be deleted."
  },
  {
    id: "auto-renewal",
    label: "Automatic renewal / hard-to-cancel billing",
    severity: "low",
    test: makeProximityTest(/automatically renew|auto-?renew/i, [/unless|until/i, /cancel/i], 150),
    explanation: "The subscription renews on its own unless you actively cancel; check how easy cancellation actually is."
  },
  {
    id: "sole-discretion-termination",
    label: "Account termination at sole discretion",
    severity: "low",
    // Found and fixed by tests/rules.test.js before ever shipping: the
    // original ordered regex only matched "at our sole discretion, we may
    // terminate your account," and silently missed the equally common
    // "we may terminate your account at our sole discretion."
    test: makeProximityTest(/sole discretion/i, [/\b(terminate|suspend|disable)\b/i, /\b(account|access)\b/i], 120),
    explanation: "The company can end your account and access with no defined process or explanation, at its own discretion."
  },
  {
    id: "no-liability",
    label: "Broad liability disclaimer",
    severity: "low",
    test: makeProximityTest(
      /in no event|no event/i,
      // Was /\bliable\b/i, an exact-word match that missed "liability"
      // (as in "...be a basis for liability"), a common variant of the
      // same idea.
      [/\b(will|shall)\b/i, /liab(le|ility)/i, /indirect|incidental|consequential|punitive/i],
      200
    ),
    explanation: "Standard-ish, but worth knowing: the company disclaims responsibility for most indirect harm, even if their service causes it."
  },
  {
    id: "implied-consent-no-optin",
    label: "Consent bundled into account creation, no separate opt-in",
    severity: "medium",
    test: makeProximityTest(
      /\b(agree|acknowledge|accept)\b/i,
      [/by (creating|signing up for|registering|using)[^.]{0,30}account/i],
      100
    ),
    explanation:
      "There's no separate checkbox or opt-in for this, just continuing counts as agreeing. That's worth noticing especially if the terms include something consequential like an arbitration or class-action waiver, since you're agreeing to it by default rather than choosing to."
  },
  {
    id: "cross-device-fingerprinting",
    label: "Cross-device tracking / fingerprinting",
    severity: "medium",
    test: makeProximityTest(/fingerprint|cross-?device/i, [/track|identif|recogni[sz]e/i], 150),
    explanation: "The service may identify and link you across multiple devices or browsers, beyond a normal cookie."
  }
];

if (typeof module !== "undefined") {
  module.exports = SENTINEL_RULES;
}
