# Vietnamese pronoun/register consistency + model-cost resilience

Status: approved for planning (brainstormed 2026-08-12)

## Problem

Vietnamese output is inconsistent in forms-of-address (ngôi xưng) even on the
current model (gpt-4o) — not just a concern about degrading further on a
cheaper model. Root-caused from real GPT prompt/response pairs pulled from
the backend's own logs (`docker logs manga_translator`), not guesswork.

**Concrete proof of cross-call inconsistency** — the same English source
line, sent in separate translate calls (different images/pages, same
underlying characters), came back with completely different address pairs:

| Source | Call A | Call B |
|---|---|---|
| "I RECKON IT COULD SWALLOW ALL YOUR LITTLE FRIENDS..." | "**TA** nghĩ... của **NGƯƠI**" (archaic/authority) | "**TAO** nghĩ... của **MÀY**" (rough/hostile) |
| "...YOU NEEDNT TROUBLE YOURSELF WITH ANY RITUAL ON MY ACCOUNT." | "**NGƯƠI**... vì **TA**" | "**BẠN**... vì **TÔI**" (neutral stranger) |
| "ID RATHER NOT SAY." (same character) | "**TÔI** thà..." | "**Mình** không muốn..." |

Three root causes identified, all verifiable in the current code/config:

1. **`temperature` defaults to 0.5** (`config_gpt.py:352`, `_config_get('temperature', default=0.5)`) and has never been overridden by this project's `gpt_config-vi.yaml`. Identical input at nonzero temperature legitimately samples different completions call to call — directly explains same-input-different-output.
2. **No memory between calls.** Each image is an independent translate call; many calls carry only 1-2 short OCR lines (confirmed in the log sample — e.g. a lone "YES.", a lone "WHY IS THAT?"), too little standalone context to infer speaker/listener/relationship. The only persistent grounding today is the optional per-series CHARACTER CONTEXT sheet (Option C), and its own prompt language explicitly tells the model to defer to "the current scene" when in doubt — which for a 1-line call is *always* in doubt, so the sheet gets talked out of applying.
3. **The prompt teaches by abstract rule (~40 lines, one generic example)**, not by pattern. Prompting research (see Approaches) consistently finds models — especially smaller/cheaper ones — are better pattern-matchers than rule-followers; a rich worked-example set outperforms a longer rule list for this exact class of task (style/register control).

A secondary, related finding: Vietnamese output capitalization mirrors the
source OCR's casing inconsistently (sometimes ALL CAPS, sometimes sentence
case, for near-identical inputs) — not itself a pronoun bug, but the same
"doesn't read like a considered human translation" symptom, and cheap to
fix alongside the rest.

## Goals

- Forms-of-address stay consistent for the same character/relationship
  across separate translate calls, not just within one call.
- The prompt teaches the model the *pattern* (worked examples), not just
  the rule, so smaller/cheaper models (gpt-4o-mini and future models of
  unknown strength) have a better chance of holding it — narrowing, not
  claiming to fully close, the capability gap already measured this
  session between gpt-4o and gpt-4o-mini.
- Vietnamese-only scope — no attempt to generalize this to other target
  languages.
- No new recurring GPT API calls added (the user is actively trying to
  *reduce* cost by moving to a cheaper model; a fix that adds calls would
  cut against the stated goal).
- Isolated, thin-context translate calls (a lone short line, no named
  speaker) get real narrative continuity to infer from, not just static
  character metadata.

## Non-goals

- Verifying whether non-English (JP/KR/CN) source produces different
  error patterns than English source — raised as a hypothesis but
  unverifiable from available logs (only one non-English sample existed,
  from this session's own synthetic test fixture). Left open; revisit
  with real non-English reading-session logs if the hypothesis resurfaces.
- Bigger-batch translation (merging several images' OCR into one GPT call
  to maximize per-call context) — considered as Approach 2 for the
  thin-context problem and rejected for now: requires decoupling
  detect/OCR from translation in the backend pipeline (currently one
  bundled call), and risks mixing unrelated scenes into one batch at
  chapter/scene boundaries. May be revisited if Component 3 below proves
  insufficient in practice.
- Reducing `CTX_MIN_PAGES` (the page-count threshold before the character
  sheet is built) — Component 3's rolling dialogue window covers the gap
  during those early pages without the accuracy risk of building the
  character sheet from less source text.

## Component 1 — Prompt-level fixes (`patches/gpt_config-vi.yaml`)

Three independent, additive changes to the existing file, no other files
touched:

**Temperature.** Add a top-level key `temperature: 0.15` (siblings with
the existing `chat_system_template` key). `_write_series_gpt_config`
(`patches/main.py`) already copies every non-`chat_system_template` key
from the base file into each per-series generated config verbatim — this
key requires no additional plumbing. 0.15, not 0: keeps some natural
phrasing variance while sharply cutting the register-flipping randomness
demonstrated above (temperature is the direct, measured cause of the
same-input-different-output cases).

**Few-shot examples replacing rule-heavy prose.** The current `FORMS OF
ADDRESS` section is ~40 lines of enumerated abstract rules with exactly
one generic worked example (a greeting exchange, which doesn't even
exercise the address-pair logic). Add 5-6 short worked input→output pairs
immediately after the existing format example, one per major register
this project's content actually needs: peer/friend (tớ-cậu), inner
monologue (mình), hostile/rough (tao-mày), authority/archaic (ta-ngươi),
elder/family (cháu-ông/bà or con-bố/mẹ). Keep the procedural rules (they
are not wrong, just insufficient alone) but tighten them — the examples
should carry more of the instructional weight, matching the finding that
models pattern-match better than they rule-follow for this task class.

**Capitalization normalization.** Add one rule to `TRANSLATION RULES`:
always output Vietnamese in normal sentence case (capitalize the first
letter and proper nouns only), regardless of the source OCR's casing —
source case is an artifact of hand-lettering/OCR convention, not a
meaningful signal to preserve.

## Component 2 — Character sheet becomes default-binding, not soft reference

`patches/main.py`, `_write_series_gpt_config`'s injected CHARACTER CONTEXT
block currently reads (paraphrased): *reference data only, if the current
scene seems to conflict, follow the current scene.* For a call with only
1-2 lines of local context, "seems to conflict" is true by default (there
is no scene detail to confirm OR deny it), so the model routinely talks
itself out of using the sheet.

Reword to: the sheet's pair is the **default for every line involving
this character**, to be used unless the segment being translated right
now contains **unambiguous textual evidence of a state change** (a fight
breaking out, a reveal, a confession) — brevity or lack of surrounding
detail in a short segment is explicitly **not** evidence to deviate; short
or ambiguous segments must fall back to the sheet's default, not to a
fresh guess. The existing monologue-override reminder (a character still
uses "mình" in monologue even if their dialogue sheet pair uses "tớ")
stays unchanged — this component only reweights *when* the sheet applies,
not the monologue exception.

## Component 3 — Rolling recent-dialogue window

The component that actually addresses "a lone short line has nothing to
infer from." New, reuses the existing per-series gpt_config file
infrastructure (Option C) rather than introducing a parallel mechanism.

**Client (`extension/content-script/content.js`):** a `RecentDialogue`
module holds an array of `{src, dst}`, capped at 20 entries, appended in
reading order every time `translateAndRenderImage` finishes computing
`result.regions` for an image. After each image, the buffer is sent to
the backend (`await`ed before moving on — the added latency is one small
file write, not an LLM call) via a new endpoint.

Gating: **only requires the existing "Ngữ cảnh nhân vật" toggle
(`getCharacterContext()`) to be on** — unlike the static character sheet,
this does **not** wait for `CTX_MIN_PAGES`. It starts accumulating from
the first translated image, covering exactly the gap that exists before
the character sheet has enough source text to build.

**Backend (`patches/main.py`):** new endpoint `/set-recent-dialogue`,
modeled on the existing `/set-series-context`. Writes into a **separate
block** in the per-series gpt_config file, distinct from the CHARACTER
CONTEXT block, so refreshing recent dialogue never requires re-running the
character-extraction LLM call. Capped at ~20 lines / ~600 characters to
keep the added per-call token cost small. Framed explicitly in the prompt
as *dialogue that just happened, for continuity only — do not re-translate
it, do not include it in your output*.

**No new recurring GPT calls**: this is a plain text dump of already-
translated lines, not a summarization or extraction step — satisfies the
"no added API cost" goal directly (the only cost is a small increase in
each real translate call's input token count).

## Cache invalidation

Components 1 and 2 change what the backend produces for already-cached
pages (different temperature, different prompt text, different character-
sheet framing) — per this project's established convention, `extension/
content-script/content.js`'s `CFG.CACHE_VERSION` must be bumped so
previously-cached translations are treated as stale and re-translated,
consistent with every prior prompt/config-affecting change this session
(e.g. the DETECTION_SIZE and boundary-stitch changes each bumped it).
Component 3 (recent-dialogue) does not by itself require a bump beyond
that — it's addressed by the same bump since it ships in the same change.

## Data flow

Every translate call's system prompt now stacks three layers: (1) static
rules + few-shot examples (Component 1, same for every series), (2) the
per-series default character sheet (Component 2, built once, present once
`CTX_MIN_PAGES` is reached), (3) the per-series rolling recent-dialogue
window (Component 3, present from the first image, refreshed continuously).
Low temperature (Component 1) makes the model's reading of these three
layers stable across repeated calls instead of noisy.

## Testing / verification plan

- Re-run the three concrete duplicate-input cases that proved the bug
  (`"I RECKON IT COULD SWALLOW..."`, `"...RITUAL ON MY ACCOUNT"`, `"ID
  RATHER NOT SAY."`) multiple times each post-fix, confirm the address
  pair is now stable across repeats.
- Re-run `compare_models.py` (already built this session) gpt-4o vs
  gpt-4o-mini comparison with the updated prompt, to measure whether the
  gap narrows relative to the baseline comparison already on record this
  session.
- Manual read-through of a real chapter with the character-context toggle
  on, checking address consistency for at least one recurring
  character-pair across multiple images/pages — the class of bug that
  motivated this whole design.
- No automated test runner exists for either the backend patches or the
  extension (established constraint, unchanged) — verification is
  targeted script-based re-testing (as above) plus manual review, per this
  project's standing convention.
