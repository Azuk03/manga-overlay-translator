# Hitomi Gallery Background Pre-translate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When eager mode is on and the page is a hitomi.la reader, pre-translate the whole gallery in the background (into cache) without moving the view, so every page shows its translation instantly when the user navigates to it.

**Architecture:** Background service worker gains a `HITOMI_GALLERY_URLS` message that runs a MAIN-world function (via `chrome.scripting.executeScript`) reading the page's own `galleryinfo` + `url_from_url_from_hash` to build all image URLs. The content script, when eager mode starts on a hitomi reader, requests that URL list and sequentially downloads+hashes+translates each into the existing Cache. The existing per-image pipeline then renders each page from cache (HIT) on navigation — unchanged.

**Tech Stack:** Vanilla JS, Manifest V3 (service worker + content script), `chrome.scripting` (world:MAIN), no build step, no test framework (manual browser verification only).

## Global Constraints

- Only runs when eager mode is on AND `isHitomiReader()` is true; every other site/path must be provably unaffected.
- Reuse the existing Cache and the existing download+re-encode path so pre-translated blobs hash IDENTICALLY to navigation-time blobs (cache HIT). Do NOT invent a second hashing/encoding path.
- No new host permissions (`<all_urls>` already present); add only the `"scripting"` permission.
- The MAIN-world `func` may reference ONLY page globals (`galleryinfo`, `url_from_url_from_hash`) and its own locals — it is serialized and injected, so it cannot close over extension variables.
- Vanilla JS, no build step, no shared module system.
- No automated test suite exists (pure DOM/browser). Verification is MANUAL on `https://hitomi.la/reader/4009730.html` (69-page gallery).
- `node --check` must pass on both edited JS files.
- Design source of truth: `docs/superpowers/specs/2026-08-03-hitomi-gallery-prefetch-design.md`.

---

## File Map

- Modify: `extension/manifest.json` — add `"scripting"` to `permissions`.
- Modify: `extension/background/background.js` — add a `HITOMI_GALLERY_URLS` handler that executeScripts a MAIN-world URL builder.
- Modify: `extension/content-script/content.js` — add `isHitomiReader()`, `getHitomiGalleryUrls()`, `downloadBlobFromUrl()`, `prefetchHitomiGallery()`, `updatePrefetchToast()`, and hook the prefetch into `startAutoMode()`'s eager branch.

---

### Task 1: Background URL extraction + manifest permission

**Files:**
- Modify: `extension/manifest.json:12` (the `permissions` array).
- Modify: `extension/background/background.js` (add a handler inside the existing `chrome.runtime.onMessage.addListener`, after the `TRANSLATE` block).

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: a `chrome.runtime` message `{ type: 'HITOMI_GALLERY_URLS' }` that resolves (via `sendResponse`) to `{ ok: true, urls: string[] }` when the tab is a hitomi reader with `galleryinfo`, else `{ ok: false }`. Task 2 consumes this exact shape.

- [ ] **Step 1: Add the `"scripting"` permission**

In `extension/manifest.json`, change line 12 from:
```json
  "permissions": ["storage", "unlimitedStorage"],
```
to:
```json
  "permissions": ["storage", "unlimitedStorage", "scripting"],
```

- [ ] **Step 2: Add the `HITOMI_GALLERY_URLS` handler in background.js**

Find the end of the `TRANSLATE` block inside `chrome.runtime.onMessage.addListener` (currently):
```javascript
  if (message.type === 'TRANSLATE') {
    translate(message.body)
      .then((result) => sendResponse({ ok: true, regions: result.regions }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
```

Insert a new block BEFORE the closing `});` (so it sits alongside the other handlers):
```javascript
  if (message.type === 'HITOMI_GALLERY_URLS') {
    if (!sender.tab || sender.tab.id == null) {
      sendResponse({ ok: false, error: 'no tab' });
      return true;
    }
    // Chay o MAIN world de doc galleryinfo + goi ham build URL cua chinh
    // hitomi (url_from_url_from_hash). func nay bi serialize + tiem vao trang,
    // nen CHI duoc dung global cua trang (galleryinfo, url_from_url_from_hash)
    // va bien cuc bo cua no - khong dong bao bien ngoai.
    chrome.scripting
      .executeScript({
        target: { tabId: sender.tab.id },
        world: 'MAIN',
        func: () => {
          try {
            if (
              typeof galleryinfo === 'undefined' ||
              !galleryinfo.files ||
              typeof url_from_url_from_hash !== 'function'
            ) {
              return { ok: false, reason: 'no-galleryinfo' };
            }
            const id = galleryinfo.id;
            const urls = galleryinfo.files.map((f) =>
              url_from_url_from_hash(id, f, f.hasavif ? 'avif' : f.haswebp ? 'webp' : 'avif')
            );
            return { ok: true, urls };
          } catch (e) {
            return { ok: false, reason: String((e && e.message) || e) };
          }
        },
      })
      .then((results) => {
        const r = results && results[0] && results[0].result;
        sendResponse(r && r.ok ? { ok: true, urls: r.urls } : { ok: false });
      })
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
```

- [ ] **Step 3: Verify no syntax errors**

Run: `node --check extension/background/background.js`
Expected: no output (exit code 0).

- [ ] **Step 4: Static self-check (no browser available to the implementer)**

Confirm by reading the diff: the `func` references only `galleryinfo` / `url_from_url_from_hash` (page globals) and its own locals; the handler returns `true` to keep the channel open; manifest `permissions` now includes `"scripting"`. State in the report that live verification (that the message actually returns 69 URLs on the real hitomi page) is deferred to the human.

- [ ] **Step 5: Commit**

```bash
git add extension/manifest.json extension/background/background.js
git commit -m "Add HITOMI_GALLERY_URLS background handler (MAIN-world url_from_url_from_hash)"
```

---

### Task 2: Content-script gallery prefetch + eager hook

**Files:**
- Modify: `extension/content-script/content.js` — add 5 functions near `startAutoMode()` and one call inside its eager branch.

**Interfaces:**
- Consumes: the `HITOMI_GALLERY_URLS` message from Task 1 (`{ ok, urls }`); existing helpers `sendMessageAsync()` (line ~267), `base64ToBlob()` (line ~255), `reencodeToPng()` (used in `ApiAdapter.downloadImageBlob`), `Cache.hashBlob/get/set`, `ApiAdapter.translateImage(blob)`, `getTargetLang()`, `getTranslatorEngine()`, and the existing `.mot-toast`/`.mot-toast-hide` CSS classes.
- Produces: nothing consumed by other tasks (final task).

- [ ] **Step 1: Add the five helper functions immediately before `async function startAutoMode()`**

Find (currently near line 1108, right after `forceLoadLazyImages()`'s closing brace and before `async function startAutoMode()`):
```javascript
  async function startAutoMode() {
    eagerModeActive = await getEagerTranslate();
```

Insert immediately BEFORE `async function startAutoMode() {`:
```javascript
  // ===== Hitomi: dich nen ca gallery (reader chuyen trang) =====
  // Xem spec 2026-08-03-hitomi-gallery-prefetch-design.md.
  function isHitomiReader() {
    return (
      /(^|\.)hitomi\.la$/.test(location.hostname) &&
      /\/reader\/\d+\.html/.test(location.pathname)
    );
  }

  // Nho background chay ham MAIN-world doc galleryinfo + build URL. Tra ve
  // mang URL, hoac null neu khong phai gallery hitomi / hitomi doi cau truc.
  async function getHitomiGalleryUrls() {
    try {
      const res = await sendMessageAsync({ type: 'HITOMI_GALLERY_URLS' });
      return res && res.ok && Array.isArray(res.urls) ? res.urls : null;
    } catch (e) {
      return null;
    }
  }

  // Tai blob tu URL truc tiep (khong qua <img>). Mirror DUNG nhanh non-blob
  // cua ApiAdapter.downloadImageBlob de hash KHOP hash luc dieu huong (cache
  // HIT khi nguoi dung lat toi trang).
  async function downloadBlobFromUrl(url) {
    const res = await sendMessageAsync({ type: 'DOWNLOAD_IMAGE', url });
    if (!res || !res.ok) {
      throw new Error((res && res.error) || 'Khong tai duoc anh: ' + url);
    }
    const rawBlob = base64ToBlob(res.base64, res.contentType);
    return await reencodeToPng(rawBlob);
  }

  // Toast tien trinh prefetch: 1 element cap nhat textContent, tai dung style
  // .mot-toast. Khi done == total -> doi text "xong" roi tu an sau 3s.
  let _prefetchToastEl = null;
  function updatePrefetchToast(done, total) {
    if (!_prefetchToastEl) {
      _prefetchToastEl = document.createElement('div');
      _prefetchToastEl.className = 'mot-toast';
      document.body.appendChild(_prefetchToastEl);
    }
    if (done < total) {
      _prefetchToastEl.textContent = `Đang dịch nền gallery: ${done}/${total}`;
    } else {
      _prefetchToastEl.textContent = `Đã dịch xong gallery ${done}/${total}`;
      const el = _prefetchToastEl;
      _prefetchToastEl = null;
      setTimeout(() => {
        el.classList.add('mot-toast-hide');
        setTimeout(() => el.remove(), 300);
      }, 3000);
    }
  }

  // Dich nen tuan tu tung URL vao cache (backend CONCURRENCY:1). Khong dung
  // toi man hinh/dieu huong. Loi 1 trang -> bo qua, tiep tuc.
  async function prefetchHitomiGallery(urls) {
    const targetLang = await getTargetLang();
    const engine = await getTranslatorEngine();
    let done = 0;
    for (const url of urls) {
      try {
        const blob = await downloadBlobFromUrl(url);
        const hash = await Cache.hashBlob(blob);
        const cached = await Cache.get(hash, targetLang, engine);
        if (!cached) {
          const result = await ApiAdapter.translateImage(blob);
          await Cache.set(hash, targetLang, engine, result);
        }
      } catch (e) {
        console.warn('[MOT] Prefetch loi 1 trang, bo qua:', url, e.message);
      }
      done++;
      updatePrefetchToast(done, urls.length);
    }
  }

```

- [ ] **Step 2: Hook the prefetch into `startAutoMode()`'s eager branch**

Find (currently):
```javascript
    if (eagerModeActive) {
      // Ep tai truoc moi anh lazy-load co URL that trong data-* (webtoon...)
      // de bat duoc CA CHUONG ma khong can nguoi dung cuon. Anh tai xong se
      // tu register + enqueue qua 'load' listener (xem forceLoadLazyImages()).
      forceLoadLazyImages();
```

Replace with (adds the hitomi prefetch trigger at the top of the eager branch):
```javascript
    if (eagerModeActive) {
      // Reader chuyen trang (hitomi): dich nen CA GALLERY vao cache, khong di
      // chuyen man hinh (xem spec 2026-08-03-hitomi-gallery-prefetch-design.md).
      // Fire-and-forget, chay nen song song voi eager thuong; urls null (khong
      // phai gallery hitomi / hitomi doi cau truc) -> khong lam gi dac biet.
      if (isHitomiReader()) {
        getHitomiGalleryUrls().then((urls) => {
          if (urls && urls.length) prefetchHitomiGallery(urls);
        });
      }
      // Ep tai truoc moi anh lazy-load co URL that trong data-* (webtoon...)
      // de bat duoc CA CHUONG ma khong can nguoi dung cuon. Anh tai xong se
      // tu register + enqueue qua 'load' listener (xem forceLoadLazyImages()).
      forceLoadLazyImages();
```

- [ ] **Step 3: Verify no syntax errors**

Run: `node --check extension/content-script/content.js`
Expected: no output (exit code 0).

- [ ] **Step 4: Static self-check**

Confirm by reading the diff:
- `downloadBlobFromUrl()` uses the SAME `sendMessageAsync({type:'DOWNLOAD_IMAGE'})` → `base64ToBlob` → `reencodeToPng` chain as `ApiAdapter.downloadImageBlob`'s non-blob branch (so cache hashes match navigation-time).
- The prefetch trigger is INSIDE `if (eagerModeActive)` AND gated by `isHitomiReader()` — non-eager and non-hitomi paths are untouched.
- `updatePrefetchToast` reuses existing `.mot-toast`/`.mot-toast-hide` classes (already in the injected `<style>`).
State that live browser verification (Step 5) is deferred to the human.

- [ ] **Step 5: Manual browser verification (HUMAN — deferred, document in report)**

On `https://hitomi.la/reader/4009730.html`:
1. Reload the extension, F5.
2. Popup → enable "Dịch trước toàn bộ ảnh".
3. Click translate. Confirm in console: prefetch runs in the background (sequential `Cache MISS`/translate for up to ~69 pages), a toast shows "Đang dịch nền gallery: K/69" climbing to 69, and the VIEW DOES NOT jump between pages.
4. Navigate through pages — each shows its overlay instantly (`Cache HIT`), including pages never manually viewed.
5. Navigate to a page the prefetch hasn't reached yet — it translates on demand normally (no breakage).
6. Toggle eager off, F5 — no prefetch runs; behavior reverts to translating only the currently-viewed page on navigation.
7. Confirm no regression on webtoons.com / other sites (`isHitomiReader()` is false there).

- [ ] **Step 6: Commit**

```bash
git add extension/content-script/content.js
git commit -m "Content: pre-translate whole hitomi gallery into cache in background"
```

---

## Self-Review

- **Spec coverage:** §3.1 manifest `scripting` → Task 1 Step 1. §3.2 background handler → Task 1 Step 2. §3.3 content functions (isHitomiReader/getHitomiGalleryUrls/downloadBlobFromUrl/prefetchHitomiGallery) + eager hook → Task 2 Steps 1-2. §3.4 progress toast → `updatePrefetchToast` in Task 2 Step 1. §5 error handling (null → no prefetch; per-page try/catch) → in the code. §7 testing → Task 2 Step 5.
- **Placeholder scan:** none — all code literal.
- **Type consistency:** message shape `{ ok, urls }` produced in Task 1 Step 2, consumed in Task 2 Step 1 `getHitomiGalleryUrls`. `downloadBlobFromUrl`/`prefetchHitomiGallery`/`updatePrefetchToast`/`isHitomiReader`/`getHitomiGalleryUrls` names consistent between Steps 1 and 2.
