# The Count: one number a month

On the first review of each month, the user writes one whole number: how many of a named set of calls, already in the log, will come true. At the next month's first review, the reveal shows those calls and then three numbers side by side. The next Count is asked in the same message.

**Why it works:**
- **It counts calls that came true, not "good decisions".** Whether a prediction came true can be checked against its falsifier; whether a decision was good cannot.
- **The bet can't steer the calls.** Every call in the set had its confidence locked before the Count existed.
- **It shows direction without presuming one.** A Count below the calls' own sum is a bet that they run hot; above it, a bet that they run cold. The outcomes settle it.

## The set (fixed when asked)

A call is in the set when all of these hold:
- it is a MADE or PROMISED record with `status: decided`, a prediction, a confidence and a review date;
- its review date is more than 2 days after this review and before next month's first review.

Rules:
- **Exclude deferred records.**
- **Minimum 4 calls.** With fewer, ask nothing and say nothing. A thin month is not a shortfall.
- **Freeze the IDs and each confidence into the Count record at the ask.** Later edits don't change it. For a band, freeze the band and use its midpoint in the sums, saying so.
- **The Count stays open until the first call in the set is reviewed.** A call already reviewed when the reply arrives is removed, and the record says so.

## The ask (one question, first review of the month only)

> **October count: one number.** These 7 calls come due before your first review in November:
> D-050 Mobile beta in TestFlight (20 Oct) · D-052 Onboarding call lifts activation (31 Oct) · …
> How many will come true? Reply with a number from 0 to 7, or "skip".

- Show **titles and due dates only.** Never show the confidences or their sum. Never suggest a number, and never show last month's result as an anchor.
- Accept "skip" silently. Nothing is marked missed, and nothing carries over.
- Between reveals, the weekly note carries one neutral line: "October count: 4 of 7, placed 2 Oct. Reveal at your first review in November." There is no running tally and no "on track".

## The reveal (outcomes, then numbers, then one reading)

1. **The calls,** under *Came true*, *Didn't* or *Not back yet*. Each line shows its confidence, one clause on what happened, and falsifier status. If the user marked a call true but a falsifier fired, say so plainly.
2. **Three numbers:** "Your count · Your calls, added up · What happened", for example "4 of 7 · 5.3 of 7 · 3 of the 6 back".
3. **One reading about the calls, never the person:** the tilt ("You set your count below your calls: a bet they'd run hot. They did."), which number sat closer to what happened, and one clause on what the misses share. Use symmetric words (above/below, closer/further), never beat, won or lost.
4. **Sample size:** "6 calls back: one call either way moves the rate by 17 points. Read the direction, not the decimal."
5. **Coverage:** in the count, back (yes and no), unclear, not back yet, and dropped.
6. **After 3 or more Counts,** one running line, direction only.
7. **The next Count.**

Calls not back at the reveal stay in their own Count, and appear as a late result in a later reveal.

## Computation (from the log)

For a Count with frozen set S (m calls), frozen confidences c_i, and bet b:
- **R** is the calls in S that resolved yes or no: n of them, k of them yes.
- **Shown:** "b of m"; Σc_i "of m", to one decimal; "k of the n back".
- **Compared over R only:**
  - happened h = k/n;
  - count rate q = b/m;
  - calls rate p̄ = the mean of c_i over R.
- **Closer** is whichever of |q − h| and |p̄ − h| is smaller.
- **Tilt** is the sign of (q − the mean of c_i over S). If |b − Σc_i| < 0.5, say "You set your count at your calls' own number" and make no tilt claim.
- **Too few back:** if n < 4, list the calls with "too few back to read yet" and fold them into the next reveal.

## Never

- **No points, badges, streaks, "right in a row"** or comparison with other people.
- **Kept apart:** the Count stays out of the weekly metrics and the calibration score.
- **No claims:** don't presume a direction of miscalibration, and don't claim the Count improves calibration.
