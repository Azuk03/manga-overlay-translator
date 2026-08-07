# Eager Force-load Lazy Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When eager mode is on, force-load every lazy image whose real URL is stashed in a data-attribute (e.g. webtoons `data-url`) so the whole chapter gets translated without the user scrolling.

**Architecture:** Add two small functions to `content.js` — `getLazyUrl(img)` (returns the real image URL from a data-attribute, or null) and `forceLoadLazyImages()` (copies that URL into `img.src` for every img on the page). Call the latter inside `startAutoMode()`'s existing eager branch. Setting `src` makes the browser load the real image; the existing `load` listener (attached to every img by `registerImage()`) then re-runs registration → the img passes `isCandidate()` → gets eager-enqueued and translated. No new download or translation path.

**Tech Stack:** Vanilla JS (Manifest V3 content script), no build step, no test framework (manual browser verification only).

## Global Constraints

- Runs ONLY when eager mode is on (`eagerModeActive === true`); the default eager-off path must be provably unchanged.
- No new download/translate path — reuse the existing `registerImage`/`load`-listener/eager-enqueue plumbing.
- Vanilla JS, no build step, no shared module system, no imports.
- No automated test suite exists (pure DOM/browser). Verification is MANUAL on the real episode: `https://www.webtoons.com/en/fantasy/the-patron-of-villains/episode-33/viewer?title_no=9321&episode_no=33`.
- `node --check extension/content-script/content.js` must pass.
- Design source of truth: `docs/superpowers/specs/2026-08-03-eager-force-load-lazy-images-design.md`.

---

## File Map

- Modify: `extension/content-script/content.js` — add `getLazyUrl()` and `forceLoadLazyImages()` near `watchImages()`/`startAutoMode()`, and call `forceLoadLazyImages()` in `startAutoMode()`'s eager branch.

---

### Task 1: Force-load lazy images in eager mode

**Files:**
- Modify: `extension/content-script/content.js` — insert two functions immediately before `async function startAutoMode()` (currently at line 1086), and add one call inside its eager branch (currently lines 1089-1096).

**Interfaces:**
- Consumes: existing module-level `eagerModeActive` flag (set at the top of `startAutoMode()`); existing `registerImage()` behavior (attaches a `'load'` listener to every img via `watchImages()`); existing eager-enqueue in `registerImage()`'s `tryRegister()` (`if (autoStarted && eagerModeActive) Queue.enqueue(img)`).
- Produces: `getLazyUrl(img)` → string|null; `forceLoadLazyImages()` → void. Nothing else in the codebase consumes these.

- [ ] **Step 1: Add `getLazyUrl()` and `forceLoadLazyImages()` before `startAutoMode()`**

Find this line (currently line 1086):
```javascript
  async function startAutoMode() {
```

Insert immediately BEFORE it:
```javascript
  // Tra ve URL anh THAT giau trong data-attribute (lazy-load), hoac null.
  // Thu theo thu tu: data-url (webtoon), data-src, data-original,
  // data-lazy-src. Chi nhan URL http(s) tuyet doi. Luu y: data-lazy-src ->
  // dataset.lazySrc (dataset tu camelCase hoa).
  function getLazyUrl(img) {
    const candidates = [
      img.dataset.url,
      img.dataset.src,
      img.dataset.original,
      img.dataset.lazySrc,
    ];
    for (const v of candidates) {
      if (v && (v.startsWith('http://') || v.startsWith('https://'))) return v;
    }
    return null;
  }

  // Ep tai truoc moi anh lazy-load: nhieu site (webtoon...) de <img> chua
  // cuon toi mang src placeholder, con URL that giau trong data-*. Copy URL
  // do vao src de trinh duyet tai ngay, khong can cuon. Anh tai xong -> 'load'
  // listener (da gan trong registerImage) chay lai tryRegister -> isCandidate
  // qua (co kich thuoc that) -> registerImage + eager enqueue. Xem spec
  // 2026-08-03-eager-force-load-lazy-images-design.md.
  function forceLoadLazyImages() {
    document.querySelectorAll('img').forEach((img) => {
      const u = getLazyUrl(img);
      if (u && img.src !== u) img.src = u;
    });
  }

```

- [ ] **Step 2: Call `forceLoadLazyImages()` in the eager branch of `startAutoMode()`**

Find this block (currently lines 1089-1096):
```javascript
    if (eagerModeActive) {
      // Bo qua IntersectionObserver hoan toan - enqueue truc tiep TOAN BO
      // anh da biet, dua vao Queue._pending sort theo vi tri Y (xem
      // Queue._drain()) de van xu ly theo dung thu tu doc dau tien.
      registeredImages.forEach((img) => Queue.enqueue(img));
      log('Auto mode (eager) da bat dau. Dang dich toan bo anh hien co, khong doi cuon toi...');
      return;
    }
```

Replace with:
```javascript
    if (eagerModeActive) {
      // Ep tai truoc moi anh lazy-load co URL that trong data-* (webtoon...)
      // de bat duoc CA CHUONG ma khong can nguoi dung cuon. Anh tai xong se
      // tu register + enqueue qua 'load' listener (xem forceLoadLazyImages()).
      forceLoadLazyImages();
      // Bo qua IntersectionObserver hoan toan - enqueue truc tiep TOAN BO
      // anh da biet, dua vao Queue._pending sort theo vi tri Y (xem
      // Queue._drain()) de van xu ly theo dung thu tu doc dau tien.
      registeredImages.forEach((img) => Queue.enqueue(img));
      log('Auto mode (eager) da bat dau. Dang ep tai + dich toan bo anh ca chuong, khong doi cuon toi...');
      return;
    }
```

- [ ] **Step 3: Verify no syntax errors**

Run: `node --check extension/content-script/content.js`
Expected: no output (exit code 0).

- [ ] **Step 4: Static self-check (no browser available to the implementer)**

Confirm by reading the diff:
- `forceLoadLazyImages()` is called ONLY inside the `if (eagerModeActive)` branch — the non-eager path (the `IntersectionObserver` construction below it) is untouched, so eager-off behavior is unchanged.
- `getLazyUrl()` only returns `http://`/`https://` strings, else null; `forceLoadLazyImages()` only assigns `img.src` when the URL differs from the current `src` (so already-loaded imgs are skipped and no reload storm on re-run).
- No new `fetch`/download/translate code was added — the change only sets `img.src` and relies on the existing pipeline.
State in the report that Step 5 (live browser verification) is deferred to the human — you cannot run a browser.

- [ ] **Step 5: Manual browser verification (HUMAN — deferred, document in report)**

On `https://www.webtoons.com/en/fantasy/the-patron-of-villains/episode-33/viewer?title_no=9321&episode_no=33`:
1. Reload the extension, F5 the page.
2. Open the popup, ENABLE the "Dịch trước toàn bộ ảnh" checkbox.
3. Immediately (without scrolling) click "Dịch trang này".
4. Confirm in the console that all ~164 images get enqueued and translated top-to-bottom WITHOUT any scrolling, and the completion toast shows the full count.
5. Toggle the checkbox OFF, F5, translate again — confirm behavior reverts to viewport-gated (only nearby images translate as you scroll; no mass force-load).
6. Confirm no regression on a normal (non-lazy, real-`src`) page — still translates as before.

- [ ] **Step 6: Commit**

```bash
git add extension/content-script/content.js
git commit -m "Eager mode: force-load lazy images via data-url to translate whole chapter"
```

---

## Self-Review

- **Spec coverage:** §2 approach (force-load via data-attr) → Steps 1-2. §2.1 data-attribute list/order → `getLazyUrl()` in Step 1. §2.2 copy condition (`src !== u`) → Step 1. §2.3 hook point (eager branch of `startAutoMode()`, before the enqueue loop) → Step 2. §4 limitations are inherent to the approach (no code needed). §5 testing → Steps 3-5.
- **Placeholder scan:** none — all code is literal.
- **Type consistency:** `getLazyUrl` returns string|null; `forceLoadLazyImages` void; both names used consistently between Steps 1 and 2.
