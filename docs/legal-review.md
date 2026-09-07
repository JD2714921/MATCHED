# Legal review — inventory of what needs professional advice

**This document makes no legal determinations.** It is not legal advice and was
not written by a lawyer. It is an inventory, assembled by the people who built
the software, of the questions a qualified adviser should be asked before this
product is offered to anyone in the United Kingdom. Where it describes what the
software does, that is a statement of fact about the code. Where it describes
what the law requires, treat it as a question to put to counsel, not an answer.

Nothing below should be read as a conclusion that any particular activity is or
is not permitted.

---

## 1. Gambling Commission licensing scope

**The question:** does operating MATCHED require an operating licence under the
Gambling Act 2005, and if not, what keeps it outside scope?

**What the software actually does, as facts for an adviser:**

- It does not accept, hold or return customer funds. There is no payment
  integration; the safety lint fails the build if one is added.
- It does not accept, place, transmit or settle bets. There is no
  bet-placement code; the Betfair client refuses `placeOrders`, `cancelOrders`,
  `replaceOrders` and `updateOrders` by whitelist before any network call, and
  a runtime test asserts no bet-shaped method exists on any provider.
- It does not hold credentials for, or access, any customer's account with any
  operator. The schema has no field capable of storing one, enforced by lint.
- It reads publicly available promotional terms, interprets them, reads market
  data from an exchange's API, performs arithmetic, and displays the result.
- The customer opens their own accounts and places every bet themselves.

**Questions to put:**

- Does any of the above amount to "providing facilities for gambling", or to
  acting as an intermediary, under s.5 and s.33 of the Act?
- Does presenting a specific selection, stake and price to a customer who then
  places that bet constitute inviting or facilitating a bet?
- Does the affiliate-style relationship implied by
  `PromotionSource.collectionMethod = OPERATOR_AFFILIATE_FEED` engage any
  licensing or disclosure requirement, and would revenue share change the
  analysis?
- Is there any exposure under the advertising provisions (s.330–s.333) as a
  party who publicises operators' promotions?

## 2. Advertising: CAP and BCAP codes

**The question:** what may and may not be said, given that this product
describes gambling promotions.

**Relevant areas:** CAP Code section 16 (gambling), the rules on socially
responsible advertising, the prohibition on presenting gambling as a solution
to financial concerns or a way to achieve financial security, rules on appeal to
under-18s, and the requirement that significant conditions be made clear.

**What the software already enforces** (`scripts/lint-copy.ts`, build-failing,
verified by planting deliberate violations):

- No claim of guaranteed profit, guaranteed return, or an assured/certain/sure
  profit.
- No "risk-free", "no risk", "without risk", "zero risk".
- No "cannot lose", "never lose", "always win".
- No income claims — neither "make £X a month" patterns nor "second income",
  "replace your salary", "quit your job", "financial freedom", "get rich",
  "easy money", "free money".
- No language shading into evading operator restrictions (avoiding detection,
  staying under the radar, mug betting to disguise activity).
- No language describing multi-accounting or gnoming.

**Approved vocabulary in use:** calculated locked return; outcome-neutral
matched position; calculated return across outcomes; matched-betting
opportunity; qualifying loss.

**Questions to put:**

- Is the approved vocabulary itself compliant, particularly "calculated locked
  return"? The word "locked" may carry more assurance than the calculation
  supports.
- Are the age and responsible-gambling statements in the footer sufficient in
  placement and prominence?
- Does describing a promotion's terms constitute advertising that promotion, and
  if so, does that engage the operator's own compliance obligations?
- Is the "sample operator" labelling of invented brands adequate to prevent any
  impression of a real commercial relationship?

## 3. UK GDPR and data protection

**The question:** what is the lawful basis for each processing activity, and is
a Data Protection Impact Assessment required?

**What is processed today:**

| Data | Where | Note |
| --- | --- | --- |
| Email address, display name | `User` | Identifies the account |
| Password | `User.passwordHash` | scrypt, salted; the plaintext is never stored |
| Session token | `UserSession.tokenHash` | SHA-256 only; the token itself is never stored |
| User agent | `UserSession.userAgent` | For session management |
| Which operators a customer holds accounts with, and their state | `UserOperatorAccount` | Self-reported; no credentials |
| Self-reported balances | `BankrollAccount` | Financial information |
| Betting activity: selections, stakes, prices, outcomes, realised results | `BetPlan`, `BetLeg`, `LedgerEntry` | Detailed record of an individual's gambling |
| Actions taken by administrators | `AuditLog` | Includes actor identity |

**A DPIA is likely to be required.** The betting activity record is a detailed
history of an identified individual's gambling behaviour alongside
self-reported financial information. That combination is plausibly "data
concerning a person's financial situation" processed on a significant scale, and
gambling behaviour may be considered sensitive in effect even where it is not
special-category data under Article 9.

**Questions to put:**

- Is a DPIA mandatory here under Article 35 and the ICO's own list of
  high-risk processing?
- What is the lawful basis for each activity — contract for the core service,
  and what for retention of settled betting history?
- What retention period is defensible for `BetPlan`, `BetLeg` and `LedgerEntry`,
  and what is the deletion mechanism? **Not currently implemented.**
- Are subject access, rectification, erasure and portability mechanisms
  required at launch? **Not currently implemented.**
- Does profiling occur? `lib/scoring` ranks opportunities using the customer's
  own account states and balances. It is deterministic, fully explained, and
  makes no decision about the customer — but the analysis should be done
  properly.
- International transfers: none today with the fixture provider; Betfair and
  Anthropic both need assessing before either is enabled.
- Where an AI provider is used, promotional terms are sent to a third party.
  Customer data is not — but this should be confirmed as a matter of design and
  documented.

## 4. Copyright in operators' terms

**The question:** may promotional terms be stored, displayed and interpreted?

**What the software does:**

- `RawPromotionCapture` stores promotional text **verbatim** and displays it in
  the admin interface beside the interpretation. This is a deliberate design
  decision for auditability: a reviewer must be able to compare the reading to
  the source.
- **All seed data is invented.** Every operator (Northgate Bet, Kestrel Sports,
  Halyard Bet, Copperline Sports, Example Bookmaker) is fictional and flagged
  `isFictional`, and every word of every set of terms was written for this
  project. No real operator's terms are reproduced anywhere in this repository.

**Questions to put:**

- Are promotional terms a literary work attracting copyright, and does storing
  them verbatim infringe even where they are not shown to customers?
- Does displaying them to an internal reviewer differ from displaying them to
  customers?
- Does any exception apply — fair dealing for criticism or review, or quotation
  under s.30 CDPA?
- Is a derived interpretation (structured fields plus a quoted source phrase) a
  substantial taking?
- Should the customer-facing product link to the operator's terms rather than
  reproduce them? The schema supports this via `Promotion.termsUrl`.

## 5. Betfair developer terms

**The question:** does this use comply with Betfair's developer agreement?

**Facts:** the integration is read-only by construction; it uses the documented
JSON-RPC and certificate-login endpoints; it enforces the documented request
weight limit; it is **currently unverified against the live service** (see
`docs/betfair-integration.md`).

**Questions to put:**

- Does displaying Betfair prices to third-party customers require a commercial
  licence rather than a personal application key?
- Are there restrictions on displaying prices alongside a competitor's, or
  alongside bookmaker promotions?
- What are the attribution requirements, and are they met?
- Does the delayed-key restriction permit commercial display at all?
- Is caching or storing price data (`MarketPriceQuote`, retained for audit)
  permitted, and for how long?

## 6. Consumer law

**Questions to put:**

- Under the Consumer Protection from Unfair Trading Regulations 2008 and the
  Digital Markets, Competition and Consumers Act 2024, could any calculated
  figure be a misleading action or omission if a customer's real result differs?
  The product shows every outcome and computes realised results from what the
  customer actually got, but the analysis should be done.
- Are the limitations adequately disclosed — that interpretations may be wrong,
  that prices move, that lays may not match, that operators apply terms at their
  discretion and may restrict accounts?
- If the service is ever paid for, what are the obligations under the Consumer
  Rights Act 2015 for digital content, and what cancellation rights apply?
- Are terms of service and a privacy notice required at launch? **Neither is
  currently written.**

## 7. Gambling harm

Not principally a legal question, but it belongs in the same review.

**What exists:** a persistent footer stating that MATCHED is not a bookmaker,
holds no funds and places no bets, that figures are calculations rather than
predictions, and pointing to BeGambleAware. The Learn page states the age
requirement and names GamCare.

**Questions to put:**

- Is signposting sufficient, or are affordability and self-exclusion mechanisms
  expected of a product of this kind?
- Should the product respond to a customer whose recorded losses grow, and would
  doing so create obligations it does not otherwise have?
- Does presenting matched betting as low-risk arithmetic risk understating that
  the customer is opening gambling accounts and placing real bets?

---

## Summary of gaps, as facts

Not conclusions about what is required — statements of what does not exist yet:

- No terms of service.
- No privacy notice.
- No DPIA.
- No data retention policy or deletion mechanism.
- No subject-access or erasure mechanism.
- No age verification.
- No affordability or self-exclusion features.
- The Betfair integration is unverified against the live service.
- No legal review of any kind has been carried out.
