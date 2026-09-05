# Split-phase pipeline + what "missed text" actually is

Status: approved for planning (brainstormed 2026-09-05)

## Problem

Three complaints, raised together after eager mode started working on MangaDex:

1. Pre-translation cannot keep ahead of reading. A page that *is* already
   translated renders instantly (cache hit measured at **252 ms**), but the
   queue produces pages at 8-14 s each, so the reader catches up with it.
2. Text is missed during detect/OCR.
3. The extension should work on most manga sites.

The three were assumed to be in tension — more accuracy costs time, and the
backend is already too slow. **Measurement showed that tension does not
exist.** This spec records what was measured, what it rules out, and the one
architectural change worth making.

## What was measured

All numbers below come from real page images pulled through the backend's own
`/fetch-image` (same bytes the extension receives), on the project machine
(RTX 3050 Ti Laptop, 4 GB).

### Time budget for one page

| Stage | Time | Resource |
|---|---|---|
| detect | 1.4-2.1 s | GPU |
| OCR | 0.6-1.3 s | GPU |
| mask + inpaint | ~0.4 s | GPU |
| stream + post | 0.2-0.3 s | - |
| **GPT translate** | **3.0-5.0 s** | **network - GPU idle** |
| boundary-stitch probe | ~2.5 s | GPU, only when a next sibling image exists |

**The GPU is idle for 3-5 s of every page**, matching the 30-40 % estimate
already recorded in `docs.md` §8.

### The 2.1 s post-render mystery is not the backend

`docs.md` §8 records "2.1 s per page after `Running rendering`, cause unknown,
28 % of executor time (122 s/428 s)", and names the next step: *a clean request
that does not go through the extension*. That request was run. The gap outside
the logged stages is **203-287 ms**, repeatable. The backend is not responsible;
the remaining suspect is the client path (base64 relay through the service
worker), which is where the original measurement was taken.

### Detection scale: 2400 is already right

10 real story pages x 4 detection sizes x 3 runs (120 runs, all successful).
Recall is measured against the union of every line any configuration found,
after dropping reference lines under 4 characters.

| detection_size | recall | worst page | run-to-run spread | time |
|---|---|---|---|---|
| 1536 | 92.1 % | 50.0 % | 0.0 % | 3410 ms |
| 2048 | 89.0 % | 50.0 % | 0.0 % | 3572 ms |
| **2400** | **98.6 %** | 85.7 % | 0.0 % | **4094 ms** |
| 3072 | 92.6 % | 71.4 % | 0.0 % | 6981 ms |

Simulated 2-pass (union of two single-scale runs, one run each):

| combination | recall | vs 2400 alone | time |
|---|---|---|---|
| 1536 + 2400 | 100.0 % | **+1.4 pts** | 7504 ms |
| 1536 + 3072 | 100.0 % | +1.4 pts | 10391 ms |
| 2048 + 2400 | 98.6 % | +0.0 | 7667 ms |
| 2400 + 3072 | 98.6 % | +0.0 | 11075 ms |

**Multi-scale detection is rejected.** It buys 1.4 points for +83 % detect
time, and it does not touch the text that is actually being missed (below).
`DETECTION_SIZE = 2400` stays. This independently confirms the choice made in
`1283988`.

### What is actually missed: hand-drawn SFX

The recall metric above is *relative* — it cannot see text that no
configuration finds. Reading a story page by eye and comparing against the
detector output showed the gap: dialogue boxes, caption boxes and stacked
name columns were all found at every scale, while roughly five hand-painted
Japanese onomatopoeia strokes on the same page were found by **none** of them.

That is the missed text. It is not a `detection_size` problem, and no
combination of scales addresses it.

### OCR quality is scale-dependent in the other direction

On the same page, 2400 produced a truncated line, a line with a run of junk
commas, and a proper name missing characters, where 1536 read the same regions
cleanly. So 2400 localises best but does not always *read* best. Sample size is
**one page** — not enough to act on, enough to justify measuring.

### Detection nondeterminism: not reproduced

`docs.md` §8 lists run-to-run nondeterminism as an open problem. Across two
independent corpora (20 images x 4 sizes x 3 runs) the spread was **0.0 %** —
identical output every run.

This is recorded as **not reproduced**, not as refuted. The measurement
conditions differ from the original: requests went straight to
`/translate/with-form/json/stream` rather than through the extension, and no
boundary-stitch crop was involved. The original observation may be specific to
the crop path or to the client path.

## Non-goals

- **Multi-scale detection** — rejected on measurement, see above.
- **Translating hand-drawn SFX** — needs a different mechanism entirely
  (an SFX-specific detector). Out of scope; recorded as a known limitation.
- **A second executor instance** — VRAM measured at 3800/4096 MiB in use.
  `CONCURRENCY: 1` is a hardware constraint, not a tunable.
- **Canvas-based readers** (e.g. shonenjumpplus) — tainted canvas blocks all
  pixel access at the browser level. Unfixable, already documented.

## Design: split the page into a GPU phase and a network phase

### The idea

Each page currently makes one backend call that does detect → OCR → GPT →
inpaint, serialised end to end by the executor's exclusive lock. Splitting it:

- **Phase A (GPU)** — detect + OCR + mask + inpaint. Returns region
  coordinates, source text and inpainted backgrounds. Takes the executor lock.
- **Phase B (network)** — translate the source strings. Pure HTTP to the
  translation provider. **Does not touch the GPU and does not take the lock.**

Phase A of page N+1 then overlaps Phase B of page N. Throughput changes from
`A + B` to `max(A, B)`:

```
now      A 3.4 s + B 4 s   ≈ 8-14 s/page
after    max(A 3.4 s, B 4 s) ≈ 4-5 s/page
```

### Phase A needs no new backend code

Phase A is the existing `/translate/json/stream` with `translator: 'none'` and
the real inpainter. `translator: 'none'` already returns coordinates and OCR
text — this is the same call the boundary-stitch probe already makes, only with
inpainting left on. Measured at 2.4-3.4 s.

### Phase B needs one new endpoint

A new endpoint in `patches/main.py` that takes source strings plus dialogue
context and returns translations, calling the translator directly **in the
server process**, never through the executor. For `chatgpt` this is stateless
HTTP, so it needs no GPU and no model load.

`chatgpt.REQUEST_CONTEXT` is a module-level global that `share.py` sets per
request and clears in `finally`. The new endpoint runs in a different process
and must set it the same way — and Phase B stays strictly sequential (below),
so the single-writer assumption that `share.py`'s comment relies on is
preserved.

### Phase B must stay sequential

`content.js:1533` pushes each page's translated `dst` into the dialogue window,
and `content.js:483` reads that window when building the next request. The GPT
phase therefore has a real ordering dependency: page N's translation feeds page
N+1's prompt. Pronoun consistency is built on this.

So Phase B is a single sequential worker in reading order. Only Phase A and
Phase B run concurrently with each other — Phase B is never parallel with
itself. This caps the win at `max(A, B)` rather than something better, and that
is accepted.

### Extension: producer/consumer

Two workers over the existing queue:

- **A-worker** takes the next page in queue order, runs Phase A, pushes the
  result onto a bounded hand-off buffer.
- **B-worker** takes from that buffer in order, runs Phase B, merges `dst` into
  the Phase A regions, renders the overlay, writes the cache entry.

The buffer holds **at most 2** completed Phase A results. The A side must not
run arbitrarily far ahead and pin inpainted backgrounds in memory — measured
Phase A payloads reach several MB per page. Two is enough to keep the B worker
fed while A works on the next page, which is all the overlap needs.

### Interaction with the boundary-stitch probe

The probe already issues a `translator: 'none'` call per page whenever a next
sibling image exists — the same *kind* of call as Phase A. Once Phase A exists,
the probe and Phase A are two GPU calls per page on webtoon-style sites, which
would put ~2.5 s back into the critical path that the overlap just removed.

Merging them is **not** attempted here. `docs.md` records that gating the crop
on the main image's sliver detection was tried and reverted, because it dropped
whole straddling bubbles. This spec leaves the probe exactly as it is and notes
the redundancy for a later, separately-measured change.

### Cache stays as it is

The cache keeps its current shape: one entry per image hash + target language +
engine, holding the final regions. It is written when Phase B completes. Phase A
output lives in memory only.

This deliberately avoids re-keying the cache: a `CACHE_VERSION` bump discards
roughly 270 MB of translations that are still good, and the URL→hash fast-path
index depends on the current keying.

### Failure handling

- Phase A fails → the page fails as it does today; existing error path.
- Phase B fails → the Phase A result is already in hand. The page is left
  untranslated and logged; no partial cache entry is written, so a retry is
  clean.
- The existing passthrough→PNG retry stays on Phase A, which is the call that
  carries image bytes.

## OCR quality: measure before building

Not a design, a measurement task with a decision gate.

Measure how often 2400 produces damaged OCR (truncation, junk punctuation runs,
dropped characters) across the whole corpus, and how often 1536/3072 read the
same region cleanly. Only if the rate is material does a fix get designed. The
project precedent is the `OCR DAMAGE REPAIR` prompt rule, which moved 8 real
broken lines from 16/24 to 21/24 at zero added cost — a prompt change is the
first thing to try, not a pipeline change.

The gate: if damaged-OCR frequency is below a level worth acting on, this
workstream stops and is recorded.

## Site coverage

Incremental, in the shape of the `clientWidth` fix already shipped in
`fe16bb0`: find the gate in `image-candidate.js` that rejects a real page, fix
that gate, add a case to `tests/image-candidate.test.js`.

Verification is a one-paste console diagnostic per site, reporting per-`<img>`
which gate rejected it. This matches the project's standing decision (recorded
in four consecutive plans) that the extension layer is verified by hand on real
Chrome rather than by Playwright.

## Testing

| Area | How |
|---|---|
| Phase B endpoint | in-container Python test, the `tests/test_share_lock.py` pattern |
| A/B overlap correctness | node tests over the queue/hand-off logic, no DOM |
| Throughput | the corpus harness: wall time per page, before vs after, same pages |
| Output equivalence | same pages through old path and new path — same region count, same coordinates, same source text. Translated text is GPT-nondeterministic and is excluded from equivalence, per the precedent in the 2026-08-09 relay optimisation plan |
| Site coverage | console diagnostic, by hand, per site |

The measurement corpus (real pages from MangaDex and hitomi) stays local and
git-ignored, following the existing precedent for `fixtures/request-test.json`.

## Order of work

Three workstreams, deliberately sequenced so the cheap decision gates run
before the expensive build:

1. **OCR damage measurement.** Cheap, and its result may add a prompt-only fix
   that costs nothing at runtime. Its gate can also close the workstream
   outright.
2. **Split-phase pipeline.** The main build. Independent of (1) and (3).
3. **Site coverage.** Incremental and open-ended; one gate fix per site as
   sites are found. Does not block the others.

(1) and (3) can be dropped without affecting (2).

## Risks

- **Two calls per page instead of one.** Phase A carries the image up and the
  backgrounds down; Phase B carries only text. The extra round trip is small
  next to the 3-5 s it unblocks, but it must be measured, not assumed.
- **The new endpoint bypasses the executor lock by design.** That is safe only
  while it touches no GPU state. It must call the translator and nothing else.
- **Bounded hand-off buffer.** Unbounded, Phase A would run ahead and hold many
  multi-MB backgrounds in memory.
- **Ordering.** If Phase B is ever made concurrent, pronoun consistency breaks
  silently — the failure would not surface as an error.
