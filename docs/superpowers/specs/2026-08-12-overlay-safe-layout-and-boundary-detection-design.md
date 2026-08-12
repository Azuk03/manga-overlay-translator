# Overlay safe-layout + decoupled boundary detection

Status: approved for planning (brainstormed 2026-08-12)

## Problem

Two related rendering-quality issues, both rooted in the same pattern: code that
expands or reshapes a detected text region **without knowing the safe limit** of
that expansion.

### A. CJK vertical-text overlay collision

Japanese/Chinese/Korean source text is frequently vertical (narrow, tall
columns, several sitting close together). `OverlayRenderer._reshapeForHorizontalText`
widens any region taller than `1.3×` its width into a horizontal box (up to
3.5× the original width) so Vietnamese text can be laid out normally. This
reshape is computed **per region, independently, centered on that region's own
center** — with no awareness of neighboring regions. When source columns sit
close together (the common case for CJK dialogue), the widened boxes overlap
and the rendered Vietnamese text is drawn on top of / obscured by adjacent
translated text.

A second, related symptom: the inpainted background image (`.mot-bg`) is only
drawn at the original (narrow) bbox. The widened text box extends beyond it,
so the extended portion has no covering background — raw source text/art can
show through around the translated text.

Font sizing (`_fitFontSize`, binary search in `[FONT_MIN, FONT_DEFAULT]`) is
already generic over box dimensions and does not need to change — it just
needs to be fed a box that is actually safe to use.

### B. Webtoon/manga boundary-stitch tradeoff

`buildStitchedBlob` (toggle `mot_boundary_stitch`, default off) borrows a fixed
`BOUNDARY_BORROW_HEIGHT = 500px` strip from the next sibling image and
concatenates it onto the bottom of the current image before sending **one**
combined image to the backend. This was measured directly (real logs from the
user's own two translate runs of the same webtoon page, one with the toggle on
and one off — see `docs.md`/session record for the captured data):

| | Stitch ON | Stitch OFF |
|---|---|---|
| Detection resolution (main image) | 1280×2560 | 1536×2560 |
| Images with zero detected text | 50/135 | 63/135 |
| Total OCR lines across the page | 377 | 260 |

Root cause: `detection_size` caps the image's *longest* side. Concatenating an
extra 500px onto the bottom makes every stitched image taller, so the same
`detection_size` budget yields a **narrower effective width** (1280 vs 1536,
-17%) for the *entire* image, not just the borrowed strip — this is why bubbles
render smaller/more cramped when stitching is on.

Separately, diffing the OCR text between the two runs showed near-duplicate
fragments cut at different points each run (e.g. `ATALL..` vs `ATALL...`,
`...MY TIM` vs `...MYTIME`) — the blind, fixed 500px cut point interacts with
the *shrunk, run-to-run-varying* detection scale (detection is already known
to be nondeterministic — see the earlier `DETECTION_SIZE` investigation this
session), so the same physical bubble gets split at a different pixel offset
each run.

Toggling off avoids the resolution loss but reintroduces the original problem
the toggle was built for: text that genuinely spans the seam between two
`<img>` elements is invisible to both images' independent detection calls and
is never translated at all (63 empty images vs 50, 260 OCR lines vs 377).

## Goals

- CJK vertical-source pages render without overlapping/obscured text.
- Any region whose rendered box extends beyond its actual inpainted area gets
  a covering background, regardless of the existing "busy" flag.
- Boundary-spanning text (manga read as separate `<img>` tiles, or long
  webtoon strips) is caught **without** shrinking detection resolution for
  the rest of the image.
- Works uniformly for manga (discrete pages) and webtoon (continuous strips)
  — no site-specific branches.

## Non-goals

- Unifying with the existing tall-image tiling pipeline (`TILE_MAX_H`) into
  one virtual-canvas mechanism for multi-`<img>` webtoons. Considered
  (Option D during brainstorming) and rejected for now: correct long-term
  direction, but a large cache/queue-model rework with real regression risk.
  Revisit only if the fix below proves insufficient in practice.
- A dedicated "pre-scan to find the real bubble boundary before deciding how
  much to borrow" step. Analysis below shows this is unnecessary — see
  Component 2.
- Changing `_fitFontSize`/`_fitTextboxFont` — they already operate generically
  on whatever box they're given.

## Component 1 — Region safe-layout pass (content.js, `OverlayRenderer`)

**New pure function `_computeSafeBounds(regions)`**, called once per image
before the existing reshape/draw loop:

- For every pair of regions that face each other on one axis (their original,
  un-reshaped bboxes overlap on the *other* axis — i.e. genuine left/right or
  up/down neighbors, not diagonal), the safe boundary between them is the
  **midpoint between their original facing edges**, each side clamped to stay
  within `MARGIN` (default 4px, natural-image space) of that midpoint.
  Critically, the midpoint is computed the same way from either region's
  side — region A's max-rightward-reach and region B's max-leftward-reach
  are derived from the *same* shared line, so the two clamped boxes can
  never cross each other no matter how large either region's own ideal
  reshape wants to be. (An earlier version of this design computed each
  region's limit independently as "distance to the neighbor's edge" — that
  version was verified against the real detector output below and found
  broken: both sides can independently believe they own the *entire* gap,
  so both grow into it and still collide. The midpoint version was
  re-verified against the same data with zero overlap.)
- Using the *original* bboxes (not reshaped candidates) as the reference
  makes the computation order-independent and symmetric — no region's clamp
  depends on the order regions happen to be processed in.

**`_reshapeForHorizontalText(r, bounds)`** (existing function, extended):
keeps its current "ideal" target-aspect-ratio logic, then clamps the result
against `bounds[r]` on both axes before returning. If clamping the width
leaves the text with less room than the ideal box, the box is allowed to grow
taller instead (also clamped against vertical neighbors) rather than
overlapping a horizontal neighbor.

The clamped box feeds into the existing `_fitTextboxFont` unchanged — text
that still doesn't fit shrinks font / wraps more lines / gets the existing
`.mot-overflow` treatment, exactly as today, just against a box that can no
longer collide with a neighbor.

**Background coverage:** PASS 1 (`.mot-bg`) is unchanged (still draws exactly
at the real inpainted bbox). PASS 2 (`.mot-textbox`) currently only applies
the translucent white backing (`.mot-busy` styling) when the backend flagged
the region `busy`. Change: apply that same backing to **any** region whose
clamped box has more than 10% of its own area lying **outside the original
bbox** (intersection-based, not a raw area-ratio comparison — see erratum
below), independent of the `busy` flag — this is reusing existing CSS, not
adding new classes.

**Erratum (found in final review, corrected before merge):** the box first
written here — "clamped box area exceeds its original bbox area by more
than 10%" — is a no-op by construction and never fires. `_reshapeForHorizontalText`
is exactly area-preserving (`w = min(sqrt(area*1.3), r.w*3.5)`, `h = area/w`,
so `w*h` stays equal to the original `r.w*r.h`), and the safe-bounds clamp
only ever shrinks that area further — so the clamped box's area can never
exceed the original's. What actually needs measuring is spatial coverage,
not area: does the box's rectangle extend outside the original rectangle's
footprint, regardless of whether total area grew or shrank. Corrected rule:
compute the intersection between the clamped box and the original bbox,
and flag `(clampedArea - intersectionArea) / clampedArea > 0.1` — i.e. more
than 10% of the rendered box's own footprint sits outside the original
detected area. Confirmed against the real CJK fixture regions: all 5 have
45-67% of their clamped box outside the original bbox, and the corrected
rule fires `true` for all of them (the original, wrong rule fired `false`
for all 5).

## Component 2 — Decoupled boundary detection (content.js + background.js)

When `mot_boundary_stitch` is on, replace "concatenate 500px onto the main
image" with two independent operations per adjacent image pair:

1. **Main image**: sent to the backend at its own natural size — identical to
   the stitch-off path. No resolution loss, ever.
2. **Boundary crop**: a small standalone image built from the last 500px of
   the current image + the first 500px of the next sibling (same slicing
   helper as today's `getStripFromNextImage`, just not concatenated onto the
   main blob), sent as its own translate call. Small image → cheap, and
   frequently empty (matches the many "No text regions" calls already
   observed in the logs).
3. Regions returned by the boundary call are coordinate-translated back into
   the current image's space (reusing the existing offset math) and merged
   into the current image's region list. A region may extend past the
   current image's own height into the next image's visual space — already
   supported by the renderer (no clamping to 100%, per the original
   cross-image-boundary-stitching design).
4. Cross-image dedup (`renderedPageBBoxes` / `overlapRatio`) is unchanged and
   already prevents the next image's own independent detection from
   re-drawing the same content.

**Why no separate "smart cut point" mechanism is needed:** the run-to-run
inconsistent cut position seen in the captured data is a *consequence* of the
boundary content being analyzed inside a scale that shifts with the main
image (taller stitched image → different downscale factor → detection lands
differently each run). Once the boundary crop is analyzed as its own small,
fixed-size (500+500px), independently-scaled image, that source of variance
is gone — the crop's own detection is as stable as any other single-image
detection call. A bubble larger than 500px on one side is a rare residual
edge case, and is strictly better than today (which loses text or shrinks
resolution on *every* stitched page, not just this edge case).

**Cache:** no structural change. The existing cache key already encodes the
stitch toggle state (`..._s1_hash` / `..._s0_hash`). What's stored under the
`s1` key changes from "one concatenated image's regions" to "main image's
regions + boundary crop's regions, merged" — same key shape, different
payload.

**Error handling:** if the next sibling is unavailable (already handled
today — `findNextSiblingImage` can return null) or the boundary call
times out/errors, skip it silently; the main image still renders normally
(equivalent to stitch-off for that one seam, not a hard failure).

**Cost tradeoff:** one extra backend call per adjacent-image pair when
stitching is on. Backend is single-concurrency by design, so stitched pages
take longer to fully translate. Accepted: the boundary call is on a small
image and frequently short-circuits to "no text regions" quickly.

## Testing / verification plan

Reuses test cases from both threads of this design, since both aim at the
same goal ("works with any manga/webtoon"):

| Case | Verifies | Source |
|---|---|---|
| English manga pages (p005/p007/p008/p012) | Font fit + background coverage (Component 1) | Already downloaded this session |
| CJK vertical-text fixture | Collision avoidance (Component 1) | `fixtures/cjk_vertical_test.png` + `.html` (synthetic — a real public source could not be used: JP/CN/KR sites found are either DRM-protected (MangaPlaza, GigaViewer/ShonenJump+, see earlier investigation) or unauthorized distributors, and the fetch tool declined the latter on copyright grounds. Generated with PIL + the system's MS Gothic font, generic greeting phrases only. **Confirmed against the real backend detector**: 5 regions, `fixtures/cjk_vertical_test_detect.txt` (w≈43-46px, h≈236-425px, two pairs only ~45-65px apart) — their *ideal* reshaped boxes overlap by ~30px without this fix, verified to reach zero overlap with it (see Component 1 for the algorithm this was verified against)) |
| `https://www.webtoons.com/en/action/the-stellar-swordmaster/s2-episode-121/viewer?title_no=5988&episode_no=121` (2 real runs already captured — see Problem B table) | Component 2: main-image resolution must stay ~1536 wide (not regress to 1280), total OCR lines must be ≥ 377 (no coverage loss vs. old stitch-on) | User-provided |

Both components are browser-verified per this project's standing convention
(code review is necessary but not sufficient) before merge.
