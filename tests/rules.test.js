// Regression tests for rules.js. Run with: node tests/rules.test.js
//
// Why this exists: every bug found in this extension so far during real
// use (the builderstable.net false positive, the imgur.com clause it
// should have caught) was a rule matching text it shouldn't have, or
// missing text it should have caught. Those only ever surfaced because a
// real person hit them on a real site and reported back. This file locks
// in each real case as a permanent check, plus one sane positive/negative
// pair per rule, so a future change to rules.js gets checked against every
// known past mistake before it ships, not after someone finds it again.
//
// Add a case here every time a real false positive or false negative is
// found and fixed, the same way the two cases below came from the actual
// bug reports on 2026-09-15.

const SENTINEL_RULES = require("../rules.js");

function matches(rule, text) {
  if (rule.test) return !!rule.test(text);
  return rule.pattern.test(text);
}

const cases = [
  // --- Real bugs found in production use: these must never regress. ---
  {
    ruleId: "sensitive-data-collection",
    text: "We may collect health information, sexual orientation, and religious beliefs as part of your account profile.",
    shouldMatch: true,
    note: "a real sensitive-data clause, should match"
  },
  {
    ruleId: "sensitive-data-collection",
    text: "This hackathon may be cancelled due to public health emergencies, utility failures, or other circumstances beyond our control.",
    shouldMatch: false,
    note: "REGRESSION CASE (0.4.3): the builderstable.net force-majeure clause this rule used to false-positive on, matching only on the bare word 'health'"
  },
  {
    ruleId: "arbitration-class-waiver",
    text: "You agree to resolve any dispute through binding arbitration and you waive your right to a jury trial or to participate in a class action.",
    shouldMatch: true,
    note: "the imgur.com Terms clause Fine Print Sentinel should catch"
  },

  // --- One sane positive + negative per rule, so a future edit to any
  // rule's regex gets checked against the others too, not just the one
  // that broke last. ---
  {
    ruleId: "irrevocable-license",
    text: "You grant us an irrevocable, worldwide, royalty-free, sublicensable license to use, modify, and distribute your content.",
    shouldMatch: true,
    note: "classic broad content-license grab (the Suno-style clause)"
  },
  {
    ruleId: "irrevocable-license",
    text: "This offer is irrevocable once accepted and remains valid for 30 days from the date of this letter.",
    shouldMatch: false,
    note: "'irrevocable' used in an unrelated everyday sense, no license grant nearby"
  },
  {
    ruleId: "moral-rights-waiver",
    text: "To the extent permitted by law, you waive any moral rights you may have in the content you submit.",
    shouldMatch: true
  },
  {
    ruleId: "moral-rights-waiver",
    text: "We respect your moral rights as a creator and will always credit you appropriately.",
    shouldMatch: false,
    note: "mentions moral rights but there's no waive language"
  },
  {
    ruleId: "content-ownership-transfer",
    text: "You hereby assign all right, title, and interest in the ownership of your submissions to us.",
    shouldMatch: true
  },
  {
    ruleId: "content-ownership-transfer",
    text: "Assign ownership for regulatory and operational updates to the right person on your team in just a few clicks.",
    shouldMatch: false,
    note: "real false positive (onetrust.com): task/workflow ownership, nothing to do with anyone's content or IP"
  },
  {
    ruleId: "data-broker-resale",
    text: "We may sell your personal information to data brokers for resale to third parties.",
    shouldMatch: true
  },
  {
    ruleId: "third-party-sharing-broad",
    text: "We may share your personal information with our affiliates, partners, and other third parties.",
    shouldMatch: true
  },
  {
    ruleId: "unilateral-changes-no-notice",
    text: "We may modify these terms at any time in our sole discretion, without notice to you.",
    shouldMatch: true
  },
  {
    ruleId: "indefinite-retention",
    text: "We will retain your data for as long as necessary to fulfill the purposes described in this policy.",
    shouldMatch: true
  },
  {
    ruleId: "auto-renewal",
    text: "Your subscription will automatically renew each year unless you cancel before the renewal date.",
    shouldMatch: true
  },
  {
    ruleId: "sole-discretion-termination",
    text: "We may terminate or suspend your account and access at our sole discretion, without explanation.",
    shouldMatch: true
  },
  {
    ruleId: "no-liability",
    text: "In no event will we be liable for any indirect, incidental, consequential, or punitive damages.",
    shouldMatch: true
  },
  {
    ruleId: "implied-consent-no-optin",
    text: "By creating an account, you agree to these terms and our privacy policy.",
    shouldMatch: true
  },
  {
    ruleId: "cross-device-fingerprinting",
    text: "We use device fingerprinting to track and identify you across your devices and browsers.",
    shouldMatch: true
  },

  // --- REGRESSION CASES (0.5.5): reverse word order. Found on 2026-09-15
  // by testing every ordered-chain rule against its own mirror image, not
  // from a user bug report. Every one of these seven used to be MISSED
  // because the old rules were fixed-order regex chains; rewritten as
  // order-independent proximity checks (makeProximityTest). These must
  // never regress back to order-dependence. ---
  {
    ruleId: "content-ownership-transfer",
    text: "All ownership rights in your submissions are hereby assigned to us.",
    shouldMatch: true,
    note: "reverse order: ownership word before the assign/transfer phrase"
  },
  {
    ruleId: "unilateral-changes-no-notice",
    text: "These terms may, at any time and without notice, be modified or changed by us.",
    shouldMatch: true,
    note: "reverse order: timing phrase before the modify/change word"
  },
  {
    ruleId: "indefinite-retention",
    text: "For as long as necessary, we will keep your data on file.",
    shouldMatch: true,
    note: "reverse order: duration phrase before the retain/keep/store word"
  },
  {
    ruleId: "no-liability",
    text: "Indirect, incidental, consequential, or punitive damages will in no event be a basis for liability on our part.",
    shouldMatch: true,
    note: "reverse order: damage-type words before 'in no event'"
  },
  {
    ruleId: "implied-consent-no-optin",
    text: "You agree to these terms by registering for an account.",
    shouldMatch: true,
    note: "reverse order: 'you agree' before the 'by registering for an account' phrase"
  },
  {
    ruleId: "cross-device-fingerprinting",
    text: "To recognize and track you, we use fingerprinting across your devices.",
    shouldMatch: true,
    note: "reverse order: track/recognize word before 'fingerprinting'"
  },
  {
    ruleId: "moral-rights-waiver",
    text: "Any moral right or droit moral you may hold is hereby waived.",
    shouldMatch: true,
    note: "reverse order: 'moral right' before 'waive'"
  }
];

let failures = 0;
for (const c of cases) {
  const rule = SENTINEL_RULES.find((r) => r.id === c.ruleId);
  if (!rule) {
    console.log(`FAIL  unknown rule id "${c.ruleId}"`);
    failures++;
    continue;
  }
  const got = matches(rule, c.text);
  const ok = got === c.shouldMatch;
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${c.ruleId.padEnd(28)} expected=${c.shouldMatch}  got=${got}${
      c.note ? `  — ${c.note}` : ""
    }`
  );
}

console.log(`\n${cases.length - failures}/${cases.length} passed`);
if (failures > 0) {
  console.log(`\n${failures} FAILURE(S). Do not ship this rules.js change until these pass.`);
  process.exit(1);
} else {
  console.log("All good.");
}
