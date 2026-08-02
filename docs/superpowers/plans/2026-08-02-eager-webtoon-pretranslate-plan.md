# Eager Webtoon Pre-translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in "eager translate" toggle that, when enabled, translates every image currently in a webtoon page's DOM immediately (instead of gating by scroll proximity), and shows a completion toast when the queue drains.

**Architecture:** A new `mot_eager_translate` boolean setting (chrome.storage.local) is added to the popup. In content.js, `startAutoMode()` branches on this setting: OFF preserves the existing `IntersectionObserver` + `PREFETCH_MARGIN` + `Queue.cancel()` path unchanged; ON enqueues every already-registered image directly and skips creating an `IntersectionObserver` entirely. `registerImage()`'s registration closure gets the same branch for images discovered after auto mode starts. A toast element is shown whenever the Queue's internal `_pending`/`_active` counters both reach zero while eager mode is active.

**Tech Stack:** Vanilla JS (Manifest V3 content script + popup), `chrome.storage.local`, no build step, no test framework (manual browser verification only).

## Global Constraints

- Toggle OFF must be provably zero-behavior-change: the non-eager code path must be textually identical to what exists today, only reachable via a new `else` branch — a reviewer must be able to confirm no existing line was altered, only new branches added around it.
- Do not delete the existing `IntersectionObserver` / `CFG.PREFETCH_MARGIN` / `Queue.cancel()` machinery — it must remain fully intact and functioning for the default (OFF) path.
- No shared module system in this codebase — `popup.js` and `content.js` each read `chrome.storage.local` independently. Do not introduce a build step or shared import.
- No automated test suite exists for the extension (pure DOM/browser code). Verification is manual: toggle eager mode on, load a long webtoon page, confirm all currently-DOM-present images enqueue immediately, confirm the toast appears with the correct count when the queue drains, confirm it re-fires if new lazy-loaded images appear and finish later, then toggle off and confirm behavior reverts exactly to today's.
- This plan is scoped ONLY to same-page eager translation for webtoon-style pages. Cross-page pagination prefetch is explicitly out of scope (deferred to a future spec).
- Design source of truth: `docs/superpowers/specs/2026-08-02-eager-webtoon-pretranslate-design.md`.

---

## File Map

- Modify: `extension/popup/popup.html` — add the eager-translate checkbox.
- Modify: `extension/popup/popup.js` — read/write `mot_eager_translate`.
- Modify: `extension/content-script/content.js` — read the setting, branch `startAutoMode()`/`registerImage()`, add the completion toast (CSS + trigger).

---

### Task 1: Popup checkbox for `mot_eager_translate`

**Files:**
- Modify: `extension/popup/popup.html:64-67` (insert new block between the existing `#lang-warning` div and the `<hr>`)
- Modify: `extension/popup/popup.js` (append a new block after the existing "Khoi 6: Translator engine" block, which currently ends at line 99)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `chrome.storage.local` key `mot_eager_translate` (boolean, default `false` when unset). Task 2 and Task 3 read this key from `content.js` via a new `getEagerTranslate()` helper they will define themselves (popup.js and content.js do not share code — this is the established pattern for every other setting in this codebase).

- [ ] **Step 1: Add the checkbox markup to `popup.html`**

Current content around lines 63-68:
```html
  <div id="lang-warning" class="status" style="display: none; color: #b45309;">
    ⚠️ Prompt La-tinh hoá tên riêng chỉ áp dụng cho ChatGPT/Gemini/DeepSeek + tiếng Việt — tổ hợp hiện tại dùng prompt mặc định của backend.
  </div>

  <hr>
```

Replace with (adds the checkbox between the warning div and the `<hr>`):
```html
  <div id="lang-warning" class="status" style="display: none; color: #b45309;">
    ⚠️ Prompt La-tinh hoá tên riêng chỉ áp dụng cho ChatGPT/Gemini/DeepSeek + tiếng Việt — tổ hợp hiện tại dùng prompt mặc định của backend.
  </div>

  <label style="display: block; margin: 8px 0 0 0; font-size: 13px;">
    <input type="checkbox" id="eager-translate"> Dịch trước toàn bộ ảnh (không đợi cuộn tới)
  </label>

  <hr>
```

(Note: verify the exact current text of `#lang-warning` in the live file before editing — it may differ slightly from the snippet above depending on prior commits; match on the div's `id="lang-warning"` and the following `<hr>` rather than the exact wording.)

- [ ] **Step 2: Add the read/write logic to `popup.js`**

The file currently ends (after the "Khoi 6: Translator engine" block) with:
```javascript
engineSelect.addEventListener('change', () => {
  chrome.storage.local.set({ mot_translator_engine: engineSelect.value });
  updateLangWarning();
});
```

Append after that:
```javascript

// ===== Khoi 7: Dich truoc toan bo (eager mode) =====
const DEFAULT_EAGER_TRANSLATE = false;
const eagerCheckbox = document.getElementById('eager-translate');

chrome.storage.local.get('mot_eager_translate', (result) => {
  eagerCheckbox.checked =
    result.mot_eager_translate === undefined
      ? DEFAULT_EAGER_TRANSLATE
      : result.mot_eager_translate;
});

eagerCheckbox.addEventListener('change', () => {
  chrome.storage.local.set({ mot_eager_translate: eagerCheckbox.checked });
});
```

- [ ] **Step 3: Manually verify persistence**

There is no test framework for this extension. Verify by hand:
1. Load the extension unpacked (`chrome://extensions` or `coccoc://extensions`, Developer mode, Load unpacked, point at `extension/`).
2. Open the popup, confirm the new checkbox appears unchecked by default, below the language warning and above the `<hr>`.
3. Check it, close the popup, reopen it — confirm it stays checked.
4. Uncheck it, close, reopen — confirm it stays unchecked.
5. Open the extension's storage in DevTools (`chrome://extensions` → the extension's "service worker"/background inspect view → Application tab → Storage → Extension Storage, or run `chrome.storage.local.get(console.log)` in the popup's own DevTools console) and confirm the key `mot_eager_translate` reflects the checkbox state.

- [ ] **Step 4: Commit**

```bash
git add extension/popup/popup.html extension/popup/popup.js
git commit -m "Add eager-translate checkbox setting to popup"
```

---

### Task 2: Eager enqueue branch in `content.js`

**Files:**
- Modify: `extension/content-script/content.js:283-291` (add a new `getEagerTranslate()` helper next to the existing `getTargetLang()`/`getTranslatorEngine()` helpers)
- Modify: `extension/content-script/content.js:970-1036` (the "Tu dong phat hien anh..." section: `registeredImages`, `registerImage()`, `startAutoMode()`)
- Modify: `extension/content-script/content.js:1038` (the `let autoStarted = false;` line — add a sibling `eagerModeActive` flag next to it)

**Interfaces:**
- Consumes: `chrome.storage.local` key `mot_eager_translate` written by Task 1.
- Produces: module-level `let eagerModeActive = false;` flag (readable inside the `Queue` object's `_drain()` method, which is defined textually earlier in the file at line ~897 — this is safe because `_drain()` only reads `eagerModeActive` when it executes at runtime, well after this declaration has run during the synchronous IIFE startup; the existing `autoStarted` flag already relies on the identical pattern, referenced by functions defined before its declaration). Task 3 reads this same flag to decide whether to show the completion toast.

- [ ] **Step 1: Add `getEagerTranslate()` helper**

Current code at lines 283-291:
```javascript
  const DEFAULT_TRANSLATOR_ENGINE = 'chatgpt';

  // Doc engine dich tu chrome.storage.local moi lan goi (khong cache vao
  // hang so co dinh) de doi engine trong popup co tac dung ngay lap tuc cho
  // lan dich tiep theo (xem spec 2026-07-23-translator-engine-picker-design.md).
  async function getTranslatorEngine() {
    const result = await chrome.storage.local.get('mot_translator_engine');
    return result.mot_translator_engine || DEFAULT_TRANSLATOR_ENGINE;
  }
```

Insert immediately after (before the `// ===== ApiAdapter` comment on line 293):
```javascript

  const DEFAULT_EAGER_TRANSLATE = false;

  // Doc setting "dich truoc toan bo" tu chrome.storage.local - chi doc 1
  // lan luc startAutoMode() chay (xem CFG eager branch ben duoi), khong
  // phan ung dong neu doi giua chung 1 phien dich (giong TARGET_LANG/
  // TRANSLATOR_ENGINE - xem spec 2026-08-02-eager-webtoon-pretranslate-design.md).
  async function getEagerTranslate() {
    const result = await chrome.storage.local.get('mot_eager_translate');
    return result.mot_eager_translate === undefined
      ? DEFAULT_EAGER_TRANSLATE
      : result.mot_eager_translate;
  }
```

- [ ] **Step 2: Add the `eagerModeActive` flag**

Current code around line 1038:
```javascript
  let autoStarted = false;
```

Replace with:
```javascript
  let autoStarted = false;
  let eagerModeActive = false; // set boi startAutoMode() - true neu Task 1
  // checkbox dang bat LUC bam nut dich; quyet dinh registerImage() enqueue
  // truc tiep hay giao cho IntersectionObserver (xem startAutoMode() ben duoi).
```

- [ ] **Step 3: Branch `registerImage()`'s `tryRegister()` closure**

Current code (lines 977-996):
```javascript
  function registerImage(img) {
    if (registeredImages.has(img)) return;
    const tryRegister = () => {
      if (registeredImages.has(img)) return;
      if (!ImageFinder.isCandidate(img)) return;
      registeredImages.add(img);
      state.total++;
      // Neu auto mode da chay roi (da kich hoat dich roi, anh nay moi xuat
      // hien sau, vd lazy-load) thi theo doi ngay; neu chua kich hoat thi
      // chi dang ky, se duoc observe hang loat luc kich hoat (xem startAutoMode()).
      if (intersectionObserver) intersectionObserver.observe(img);
    };
    tryRegister(); // thu ngay - co the anh da tai xong that su tu dau
    // 'load' bat MOI LAN src doi va tai xong xong, KHONG CHI lan dau
    // ({ once: true } cu se bo lo lan site thay placeholder bang URL
    // that). isCandidate() da loai data: URI (xem ImageFinder), nen lan
    // dau thuong bi tu choi boi placeholder, phai doi 'load' lan tiep
    // theo (khi site gan src that vao) moi dang ky duoc.
    img.addEventListener('load', tryRegister);
  }
```

Replace the body of `tryRegister` with (only the block from the comment down changes — everything else in the function is untouched):
```javascript
  function registerImage(img) {
    if (registeredImages.has(img)) return;
    const tryRegister = () => {
      if (registeredImages.has(img)) return;
      if (!ImageFinder.isCandidate(img)) return;
      registeredImages.add(img);
      state.total++;
      // Eager mode: bo qua IntersectionObserver, enqueue ngay lap tuc (xem
      // spec 2026-08-02-eager-webtoon-pretranslate-design.md muc 3). Nhanh
      // nay CHI kich hoat khi eagerModeActive true - nhanh else giu NGUYEN
      // hanh vi cu 100% (khong doi gi khi toggle OFF).
      if (autoStarted && eagerModeActive) {
        Queue.enqueue(img);
      } else if (intersectionObserver) {
        // Neu auto mode da chay roi (da kich hoat dich roi, anh nay moi xuat
        // hien sau, vd lazy-load) thi theo doi ngay; neu chua kich hoat thi
        // chi dang ky, se duoc observe hang loat luc kich hoat (xem startAutoMode()).
        intersectionObserver.observe(img);
      }
    };
    tryRegister(); // thu ngay - co the anh da tai xong that su tu dau
    // 'load' bat MOI LAN src doi va tai xong xong, KHONG CHI lan dau
    // ({ once: true } cu se bo lo lan site thay placeholder bang URL
    // that). isCandidate() da loai data: URI (xem ImageFinder), nen lan
    // dau thuong bi tu choi boi placeholder, phai doi 'load' lan tiep
    // theo (khi site gan src that vao) moi dang ky duoc.
    img.addEventListener('load', tryRegister);
  }
```

- [ ] **Step 4: Branch `startAutoMode()`**

Current code (lines 1016-1036):
```javascript
  function startAutoMode() {
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            Queue.enqueue(entry.target);
          } else {
            Queue.cancel(entry.target);
          }
        }
      },
      { rootMargin: CFG.PREFETCH_MARGIN }
    );

    // Cac anh da tim thay TRUOC khi bam nut (tu watchImages()) - observe
    // hang loat ngay bay gio. Anh tim thay SAU se tu observe trong
    // registerImage() (vi luc do intersectionObserver da ton tai).
    registeredImages.forEach((img) => intersectionObserver.observe(img));

    log('Auto mode (C3) da bat dau. Dang theo doi anh moi + cuon trang...');
  }
```

Replace with:
```javascript
  async function startAutoMode() {
    eagerModeActive = await getEagerTranslate();

    if (eagerModeActive) {
      // Bo qua IntersectionObserver hoan toan - enqueue truc tiep TOAN BO
      // anh da biet, dua vao Queue._pending sort theo vi tri Y (xem
      // Queue._drain()) de van xu ly theo dung thu tu doc dau tien.
      registeredImages.forEach((img) => Queue.enqueue(img));
      log('Auto mode (eager) da bat dau. Dang dich toan bo anh hien co, khong doi cuon toi...');
      return;
    }

    intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            Queue.enqueue(entry.target);
          } else {
            Queue.cancel(entry.target);
          }
        }
      },
      { rootMargin: CFG.PREFETCH_MARGIN }
    );

    // Cac anh da tim thay TRUOC khi bam nut (tu watchImages()) - observe
    // hang loat ngay bay gio. Anh tim thay SAU se tu observe trong
    // registerImage() (vi luc do intersectionObserver da ton tai).
    registeredImages.forEach((img) => intersectionObserver.observe(img));

    log('Auto mode (C3) da bat dau. Dang theo doi anh moi + cuon trang...');
  }
```

Note: `startAutoMode()` is called (not awaited) from `onTriggerTranslate()` — this is intentional and requires no change there, since the log message right after that call in `onTriggerTranslate()` doesn't depend on `eagerModeActive`'s value.

- [ ] **Step 5: Verify no syntax errors**

Run: `node --check extension/content-script/content.js`
Expected: no output (exit code 0).

- [ ] **Step 6: Manual verification — eager branch enqueues, non-eager branch unchanged**

1. In the popup, leave the eager checkbox UNCHECKED. Load a long webtoon-style page with several images below the fold. Open the page's DevTools console, activate translation (extension icon → "Dịch trang này" or Alt+D).
2. Confirm the console log still reads `Auto mode (C3) da bat dau...` and only images within ~2 screens of the current scroll position get queued (check via the existing `DEBUG queue: ...` log lines) — i.e., confirm this is byte-for-byte the same behavior as before this task.
3. Reload the page, check the eager checkbox in the popup, activate translation again.
4. Confirm the console log now reads `Auto mode (eager) da bat dau...` and ALL images currently in the DOM get queued immediately (look for a `DEBUG queue: ...` log line for every image already on the page, not just the ones near the top).

- [ ] **Step 7: Commit**

```bash
git add extension/content-script/content.js
git commit -m "Add eager-translate branch: enqueue all known images immediately when enabled"
```

---

### Task 3: Completion toast

**Files:**
- Modify: `extension/content-script/content.js:682-716` (the `styleEl.textContent` template literal — append the `.mot-toast` CSS rules)
- Modify: `extension/content-script/content.js` (add a `showCompletionToast()` function near `showErrorSummary()`, currently at lines 1043-1048)
- Modify: `extension/content-script/content.js:960-966` (the `Queue._drain()` try/finally block)

**Interfaces:**
- Consumes: `state` object (`{ total, done, errors }`, defined at line 850) and `eagerModeActive` flag produced by Task 2.
- Produces: `showCompletionToast()` function, called only from `Queue._drain()`. No other task depends on this function.

- [ ] **Step 1: Add `.mot-toast` CSS to the existing style block**

Current code at the end of the `styleEl.textContent` template literal (lines 714-716):
```javascript
    .mot-overflow { outline: 2px solid red; }
  `;
  document.head.appendChild(styleEl);
```

Replace with:
```javascript
    .mot-overflow { outline: 2px solid red; }

    .mot-toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483647;
      background: rgba(0, 0, 0, 0.85);
      color: #fff;
      padding: 10px 16px;
      border-radius: 6px;
      font-family: sans-serif;
      font-size: 14px;
      opacity: 1;
      transition: opacity 0.3s ease;
    }
    .mot-toast-hide { opacity: 0; }
  `;
  document.head.appendChild(styleEl);
```

(CSS text does NOT support `//` comments — only `/* */` — a prior bug in this file was caused by a `//` comment breaking the whole rule. Do not add any `//` comment inside this template literal.)

- [ ] **Step 2: Add `showCompletionToast()`**

Current code around lines 1040-1048:
```javascript
  // Gop thong diep loi than thien theo nguyen nhan (backend tat, timeout...
  // da phan loai san trong ApiAdapter.translateImage), hien qua alert() vi
  // day la userscript don gian, khong co UI panel rieng.
  function showErrorSummary() {
    const lines = errorLog.map((e) => `- ${e.src}\n  ${e.message}`);
    alert(
      `Dịch xong nhưng có ${errorLog.length} ảnh lỗi:\n\n${lines.join('\n')}`
    );
  }
```

Insert immediately before that block:
```javascript
  // Toast goc duoi-phai, tu bien mat sau 3s - chi goi tu Queue._drain() khi
  // eager mode dang bat VA hang doi vua rong (xem spec muc 4). Khong thay
  // the showErrorSummary() - chi bao tong so, khong liet ke tung loi.
  function showCompletionToast() {
    const errSuffix = state.errors > 0 ? ` (${state.errors} lỗi)` : '';
    const toast = document.createElement('div');
    toast.className = 'mot-toast';
    toast.textContent = `Đã dịch xong ${state.done}/${state.total} ảnh${errSuffix}`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('mot-toast-hide');
      setTimeout(() => toast.remove(), 300); // khop voi transition 0.3s trong CSS
    }, 3000);
  }

```

- [ ] **Step 3: Trigger the toast from `Queue._drain()`**

Current code (lines 960-966):
```javascript
      try {
        await translateAndRenderImage(img);
      } finally {
        this._queued.delete(img);
        this._active--;
        this._drain(); // xu ly tiep job ke tiep trong hang doi (neu co)
      }
```

Replace with:
```javascript
      try {
        await translateAndRenderImage(img);
      } finally {
        this._queued.delete(img);
        this._active--;
        // Hang doi vua rong VA eager mode dang bat -> bao hoan tat. Kiem tra
        // TRUOC khi goi _drain() lai (ben duoi) de tranh doc nham trang thai
        // sau khi _drain() co the da lay job moi ra khoi _pending.
        if (eagerModeActive && this._pending.length === 0 && this._active === 0) {
          showCompletionToast();
        }
        this._drain(); // xu ly tiep job ke tiep trong hang doi (neu co)
      }
```

- [ ] **Step 4: Verify no syntax errors**

Run: `node --check extension/content-script/content.js`
Expected: no output (exit code 0).

- [ ] **Step 5: Manual verification — toast appears and re-fires**

1. With the eager checkbox CHECKED, load a long webtoon page and activate translation.
2. Wait for all currently-known images to finish. Confirm a toast appears bottom-right reading `Đã dịch xong N/N ảnh` (matching the final `state.done`/`state.total` values from the console logs), and that it fades out and is removed from the DOM after ~3.3 seconds (inspect via DevTools Elements panel — no leftover `.mot-toast` node should remain).
3. If the site lazy-loads more images as you scroll further, scroll to trigger a new batch, and confirm the toast appears again once that new batch finishes (do not need a fresh page load for this — same session).
4. Force at least one translation error (e.g., temporarily stop the Docker backend mid-run) and confirm the toast text includes ` (N lỗi)` when `state.errors > 0`.
5. With the eager checkbox UNCHECKED, repeat step 1 on the same page and confirm NO toast ever appears (this path never calls `showCompletionToast()` since `eagerModeActive` stays `false`).

- [ ] **Step 6: Commit**

```bash
git add extension/content-script/content.js
git commit -m "Add completion toast for eager-translate mode"
```

---

## Final Integration Check

After all 3 tasks are complete, do one end-to-end manual pass in a real browser (Cốc Cốc or Chrome, per this project's established manual-verification convention — there is no automated suite):

1. Toggle eager mode OFF. Load a long webtoon page, translate. Confirm behavior is indistinguishable from before this plan (scroll-gated translation, no toast).
2. Toggle eager mode ON. Load the same page fresh. Confirm all images enqueue immediately and a toast appears when done.
3. Confirm `grep -n "PREFETCH_MARGIN\|IntersectionObserver\|Queue.cancel" extension/content-script/content.js` still shows the original machinery present and reachable (non-eager path).
