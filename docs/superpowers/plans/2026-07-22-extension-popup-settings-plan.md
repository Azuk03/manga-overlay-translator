# Popup cấu hình cho extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm popup cho extension `manga-overlay-translator` (Manifest V3) cho phép cấu hình URL backend + ngôn ngữ đích, và kích hoạt dịch trang qua nút bấm (thay thế cơ chế "bấm icon = dịch ngay" cũ).

**Architecture:** 2 file mới (`extension/popup/popup.html`, `extension/popup/popup.js`, JS thuần không build tool) cộng thêm sửa nhỏ ở 3 file đã có (`manifest.json` thêm `default_popup`, `background.js` đổi URL backend từ hằng số cố định sang đọc `chrome.storage.local` mỗi lần gọi, `content.js` tương tự cho ngôn ngữ đích + sửa cache key theo ngôn ngữ).

**Tech Stack:** JavaScript thuần (không TypeScript/bundler), Manifest V3 (`chrome.storage.local`, `chrome.tabs`, `chrome.runtime`).

## Global Constraints

- Không thêm ô nhập API key — key OpenAI vẫn nằm trong `.env` backend, không đi qua popup (xem spec mục 1).
- Không thêm chọn translator engine — `CFG.TRANSLATOR` giữ cố định `'chatgpt'` (xem spec mục 12, đã tra thật 25 engine backend hỗ trợ, 22/25 không dùng được với `.env` hiện tại).
- Không hiện trạng thái online/offline tự động khi mở popup — chỉ có nút "Test kết nối" bấm thủ công.
- Không dùng build tool/TypeScript/framework — JS thuần, không bước build.
- Sau khi có popup, bấm icon **luôn mở popup**, không còn dịch ngay — đây là thay đổi hành vi đã được xác nhận (spec mục 3), không phải lỗi.
- Cấu hình (URL backend, ngôn ngữ đích) áp dụng **ngay lập tức** — đọc lại `chrome.storage.local` ở mỗi lần gọi, không cache vào biến cố định.
- Không có Playwright/pytest cho phần này — xác minh bằng tay trên Chrome/Edge thật (khớp quyết định đã có từ lần port extension).
- Spec đầy đủ: `docs/superpowers/specs/2026-07-22-extension-popup-settings-design.md` — đọc trước khi bắt đầu, đặc biệt mục 8 (lý do kỹ thuật sửa cache key) và mục 12 (lý do hoãn chọn engine).

---

### Task 1: `background.js` — URL backend đọc từ storage, xoá `chrome.action.onClicked`

**Files:**
- Modify: `extension/background/background.js:3` (khai báo `BACKEND_API`)
- Modify: `extension/background/background.js:54` (dùng trong `downloadImage()`)
- Modify: `extension/background/background.js:123` (dùng trong `translate()`)
- Modify: `extension/background/background.js:167-174` (xoá khối `chrome.action.onClicked`)

**Interfaces:**
- Consumes: không phụ thuộc task nào khác.
- Produces: `getBackendUrl()` (hàm async, trả về chuỗi URL từ `chrome.storage.local` key `mot_backend_url`, fallback `http://127.0.0.1:5003`). Task 4 (popup) sẽ ghi vào đúng key này.

- [ ] **Step 1: Đổi khai báo `BACKEND_API` thành hàm `getBackendUrl()`**

Đọc file hiện tại để xác nhận dòng 3 vẫn đúng là:
```javascript
const BACKEND_API = 'http://127.0.0.1:5003';
```

Thay bằng:
```javascript
const DEFAULT_BACKEND_URL = 'http://127.0.0.1:5003';

// Doc URL backend tu chrome.storage.local moi lan goi (khong cache vao bien
// co dinh) de doi URL trong popup (Task 4) co tac dung ngay lap tuc, khong
// can cho service worker khoi dong lai (xem spec muc 4).
async function getBackendUrl() {
  const result = await chrome.storage.local.get('mot_backend_url');
  return result.mot_backend_url || DEFAULT_BACKEND_URL;
}
```

- [ ] **Step 2: Sửa 2 chỗ đang dùng `BACKEND_API`**

Trong `downloadImage()`, đổi:
```javascript
    relayRes = await fetch(`${BACKEND_API}/fetch-image`, {
```
thành:
```javascript
    relayRes = await fetch(`${await getBackendUrl()}/fetch-image`, {
```

Trong `translate()`, đổi:
```javascript
    res = await fetch(`${BACKEND_API}/translate/json/stream`, {
```
thành:
```javascript
    res = await fetch(`${await getBackendUrl()}/translate/json/stream`, {
```

- [ ] **Step 3: Xoá `chrome.action.onClicked`**

Xoá hẳn khối này ở cuối file (sẽ được thay bằng nút "Dịch trang này" trong popup ở Task 3):
```javascript
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_TRANSLATE' }, () => {
    if (chrome.runtime.lastError) {
      console.log('[MOT-BG] Khong gui duoc TRIGGER_TRANSLATE (content-script chua nap?):', chrome.runtime.lastError.message);
    }
  });
});
```

- [ ] **Step 4: Kiểm tra cú pháp**

Run: `node --check extension/background/background.js`
Expected: không lỗi.

- [ ] **Step 5: Xác minh thủ công (chưa có popup — dùng cách giả lập)**

Chưa có popup ở bước này nên chưa ghi được `mot_backend_url` qua UI thật — xác minh bằng cách giả lập:
1. Reload extension trong `chrome://extensions/`.
2. Mở 1 trang manga thật, bấm `Alt+D` (vẫn còn hoạt động vì `content.js`/`onKeyDown` chưa đổi) — xác nhận vẫn dịch được bình thường (dùng đúng URL mặc định vì chưa lưu gì trong storage).
3. Mở Console của **tab đó** (context "top" bình thường, không cần đổi sang context content-script vì `chrome.storage` gọi được từ bất kỳ context extension nào có quyền — nhưng để chắc chắn, đổi dropdown Console sang context "Manga Overlay Translator" như đã làm trước đây), chạy:
   ```javascript
   chrome.storage.local.set({mot_backend_url: 'http://127.0.0.1:9999'});
   ```
4. Thử dịch lại (Alt+D) — kỳ vọng: lỗi "Backend chua bat? Kiem tra docker ps" (vì port 9999 không có gì chạy) — xác nhận `getBackendUrl()` đã đọc đúng giá trị mới thay vì vẫn dùng URL cũ.
5. Dọn lại: `chrome.storage.local.remove('mot_backend_url');` để không ảnh hưởng test sau.
6. Xác nhận bấm icon extension trên toolbar **vẫn dịch ngay như cũ** ở bước này (vì `default_popup` chưa được khai báo tới Task 3) — đây là hành vi đúng tạm thời, sẽ đổi ở Task 3.

- [ ] **Step 6: Commit**

```bash
git add extension/background/background.js
git commit -m "Read backend URL from chrome.storage.local instead of hardcoded constant"
```

---

### Task 2: `content.js` — ngôn ngữ đích đọc từ storage, sửa cache key

**Files:**
- Modify: `extension/content-script/content.js:5-8` (xoá `CFG.API`, xoá `CFG.TARGET_LANG`)
- Modify: `extension/content-script/content.js:99-130` (Cache — thêm tham số `targetLang`)
- Modify: `extension/content-script/content.js:253-266` (thêm `getTargetLang()` cạnh `sendMessageAsync`)
- Modify: `extension/content-script/content.js:296-316` (`ApiAdapter.translateImage()`)
- Modify: `extension/content-script/content.js:681-708` (`translateAndRenderImage()`)

**Interfaces:**
- Consumes: không phụ thuộc task nào khác.
- Produces: `getTargetLang()` (hàm async, đọc `chrome.storage.local` key `mot_target_lang`, fallback `'VIN'`). Task 5 (popup) ghi vào đúng key này. `Cache.get(hash, targetLang)`/`Cache.set(hash, targetLang, value)` — chữ ký mới, khác bản cũ (không còn `Cache.get(hash)`/`Cache.set(hash, value)`).

- [ ] **Step 1: Xoá `CFG.API` và `CFG.TARGET_LANG`**

Đọc đầu file để xác nhận đúng nội dung hiện tại (dòng 4-9):
```javascript
  const CFG = {
    // Endpoint dung /translate/json/stream, KHONG PHAI /translate/json
    // (endpoint khong-stream bi crash 500 - xem README.md muc "Bug da tim ra + va").
    API: 'http://127.0.0.1:5003/translate/json/stream',
    TARGET_LANG: 'VIN',
    TRANSLATOR: 'chatgpt', // da xac nhan hoat dong o Giai doan B
```

Xoá 2 dòng `API:` (+ 2 dòng comment phía trên nó) và dòng `TARGET_LANG:`, còn lại:
```javascript
  const CFG = {
    TRANSLATOR: 'chatgpt', // da xac nhan hoat dong o Giai doan B
```

(Cả 2 field đều dead code sau task này — `API` không được dùng ở đâu cả từ trước, `TARGET_LANG` sẽ được thay bằng `getTargetLang()` đọc động ở Step 3 — xem spec mục 2/8.)

- [ ] **Step 2: Sửa `Cache` — thêm tham số `targetLang` vào key**

Đọc lại đúng nội dung `Cache` hiện tại trước khi sửa (dòng 99-130 theo số dòng gốc, có thể lệch vài dòng sau Step 1 — tìm bằng nội dung, không chỉ số dòng):
```javascript
    _key(hash) {
      return `mot_cache_v${CFG.CACHE_VERSION}_${hash}`;
    },
    async get(hash) {
      const key = this._key(hash);
      const result = await chrome.storage.local.get(key);
      return result[key] ? JSON.parse(result[key]) : null;
    },
    async set(hash, value) {
      const key = this._key(hash);
      await chrome.storage.local.set({ [key]: JSON.stringify(value) });
    },
```

Thay bằng:
```javascript
    // targetLang duoc dua vao key vi ngon ngu dich gio doi duoc ngay luc dung
    // (qua popup, Task 5) - khong the con ngam dinh "1 ngon ngu co dinh" nhu
    // truoc (luc do doi CFG.TARGET_LANG bat buoc di kem bump CACHE_VERSION
    // thu cong). Thieu targetLang trong key se tra nham ket qua ngon ngu cu
    // tu cache (xem spec 2026-07-22-extension-popup-settings-design.md muc 8).
    _key(hash, targetLang) {
      return `mot_cache_v${CFG.CACHE_VERSION}_${targetLang}_${hash}`;
    },
    async get(hash, targetLang) {
      const key = this._key(hash, targetLang);
      const result = await chrome.storage.local.get(key);
      return result[key] ? JSON.parse(result[key]) : null;
    },
    async set(hash, targetLang, value) {
      const key = this._key(hash, targetLang);
      await chrome.storage.local.set({ [key]: JSON.stringify(value) });
    },
```

- [ ] **Step 3: Thêm `getTargetLang()` cạnh `sendMessageAsync`**

Tìm đúng vị trí hàm `sendMessageAsync` (ngay trước `const ApiAdapter = {`), thêm hàm mới ngay sau nó (trước dòng `// ===== ApiAdapter`):
```javascript
  const DEFAULT_TARGET_LANG = 'VIN';

  // Doc ngon ngu dich tu chrome.storage.local moi lan goi (khong cache vao
  // hang so co dinh) de doi ngon ngu trong popup (Task 5) co tac dung ngay
  // lap tuc cho lan dich tiep theo.
  async function getTargetLang() {
    const result = await chrome.storage.local.get('mot_target_lang');
    return result.mot_target_lang || DEFAULT_TARGET_LANG;
  }
```

- [ ] **Step 4: Sửa `ApiAdapter.translateImage()`**

Đọc lại đúng nội dung hiện tại trước khi sửa:
```javascript
    async translateImage(blob) {
      const dataUrl = await this.blobToDataURL(blob);
      const body = JSON.stringify({
        image: dataUrl,
        config: {
          translator: {
            translator: CFG.TRANSLATOR,
            target_lang: CFG.TARGET_LANG,
            gpt_config: CFG.GPT_CONFIG_PATH,
          },
          render: { renderer: 'none' },
          inpainter: { inpainter: CFG.INPAINTER, inpainting_size: CFG.INPAINTING_SIZE },
        },
      });

      const res = await sendMessageAsync({ type: 'TRANSLATE', body });
      if (!res || !res.ok) {
        throw new Error((res && res.error) || 'Loi khong xac dinh khi goi backend');
      }
      return { regions: res.regions };
    },
```

Thay bằng:
```javascript
    async translateImage(blob) {
      const dataUrl = await this.blobToDataURL(blob);
      const targetLang = await getTargetLang();
      // gpt_config la tham so rieng cua engine chatgpt (prompt La-tinh hoa
      // ten rieng), khong phai rieng cua ngon ngu Viet - dieu kien duoi day
      // chi dung vi CFG.TRANSLATOR dang co dinh 'chatgpt' (chua cho chon
      // engine, xem spec muc 12). Neu sau nay them chon engine, sua lai dieu
      // kien nay thanh dua vao CFG.TRANSLATOR thay vi targetLang.
      const translatorConfig = {
        translator: CFG.TRANSLATOR,
        target_lang: targetLang,
      };
      if (targetLang === 'VIN') {
        translatorConfig.gpt_config = CFG.GPT_CONFIG_PATH;
      }
      const body = JSON.stringify({
        image: dataUrl,
        config: {
          translator: translatorConfig,
          render: { renderer: 'none' },
          inpainter: { inpainter: CFG.INPAINTER, inpainting_size: CFG.INPAINTING_SIZE },
        },
      });

      const res = await sendMessageAsync({ type: 'TRANSLATE', body });
      if (!res || !res.ok) {
        throw new Error((res && res.error) || 'Loi khong xac dinh khi goi backend');
      }
      return { regions: res.regions };
    },
```

- [ ] **Step 5: Sửa `translateAndRenderImage()` — truyền `targetLang` vào `Cache.get`/`Cache.set`**

Đọc lại đúng nội dung hiện tại:
```javascript
  async function translateAndRenderImage(img) {
    if (imgLayers.has(img)) return;
    const tStart = performance.now();
    try {
      const blob = await ApiAdapter.downloadImageBlob(img);
      const hash = await Cache.hashBlob(blob);
      let result = await Cache.get(hash); // THEM await - Cache gio la async (Task 6)
      if (result) {
        log('Cache HIT:', hash, img.currentSrc || img.src);
      } else {
        log('Cache MISS, goi backend:', hash, img.currentSrc || img.src);
        result =
          img.naturalHeight > CFG.TILE_MAX_H
            ? await ApiAdapter.translateImageTiled(blob, img.naturalWidth, img.naturalHeight)
            : await ApiAdapter.translateImage(blob);
        await Cache.set(hash, result); // THEM await - Cache gio la async (Task 6)
      }
```

Thay bằng (thêm `const targetLang = await getTargetLang();` ngay sau `hash`, rồi truyền vào cả 2 lời gọi `Cache.get`/`Cache.set`):
```javascript
  async function translateAndRenderImage(img) {
    if (imgLayers.has(img)) return;
    const tStart = performance.now();
    try {
      const blob = await ApiAdapter.downloadImageBlob(img);
      const hash = await Cache.hashBlob(blob);
      const targetLang = await getTargetLang();
      let result = await Cache.get(hash, targetLang);
      if (result) {
        log('Cache HIT:', hash, targetLang, img.currentSrc || img.src);
      } else {
        log('Cache MISS, goi backend:', hash, targetLang, img.currentSrc || img.src);
        result =
          img.naturalHeight > CFG.TILE_MAX_H
            ? await ApiAdapter.translateImageTiled(blob, img.naturalWidth, img.naturalHeight)
            : await ApiAdapter.translateImage(blob);
        await Cache.set(hash, targetLang, result);
      }
```

(Phần còn lại của hàm — `computeRegionComplexity`, `OverlayRenderer.render`, `catch` — giữ nguyên, không đổi.)

- [ ] **Step 6: Kiểm tra cú pháp + không còn tham chiếu chữ ký `Cache` cũ**

Run: `node --check extension/content-script/content.js`
Expected: không lỗi.

Run: `grep -n "Cache.get(hash)\|Cache.set(hash, result)\|CFG.TARGET_LANG\|CFG.API" extension/content-script/content.js`
Expected: không có kết quả nào (xác nhận không còn nơi nào gọi `Cache.get`/`Cache.set` theo chữ ký cũ 1-2 tham số, và không còn tham chiếu 2 field CFG đã xoá).

- [ ] **Step 7: Xác minh thủ công (giả lập storage, giống Task 1 Step 5)**

1. Reload extension. Mở 1 trang manga thật, `Alt+D` dịch 1 ảnh — xác nhận vẫn hoạt động bình thường (mặc định `VIN`, có `gpt_config`).
2. Đổi context Console sang "Manga Overlay Translator", chạy:
   ```javascript
   chrome.storage.local.set({mot_target_lang: 'ENG'});
   ```
3. F5 lại trang, `Alt+D` dịch lại **đúng ảnh vừa dịch ở bước 1** — kỳ vọng: **KHÔNG** phải "Cache HIT" (backend được gọi lại thật, xác nhận cache key đã tính đúng theo ngôn ngữ) — xem log `Cache MISS` trong Console của tab.
4. Dọn lại: `chrome.storage.local.remove('mot_target_lang');`.

- [ ] **Step 8: Commit**

```bash
git add extension/content-script/content.js
git commit -m "Read target language from chrome.storage.local; include it in cache key to avoid stale-language cache hits"
```

---

### Task 3: `manifest.json` + scaffold popup + nút "Dịch trang này"

**Files:**
- Modify: `extension/manifest.json` (thêm `action.default_popup`)
- Create: `extension/popup/popup.html`
- Create: `extension/popup/popup.js`

**Interfaces:**
- Consumes: message `TRIGGER_TRANSLATE` (đã có sẵn, content-script lắng nghe từ trước — không đổi gì ở content-script cho task này).
- Produces: khung popup hoạt động được, nút "Dịch trang này". Task 4/5 sẽ thêm các khối UI còn lại vào đúng 2 file này.

- [ ] **Step 1: Thêm `default_popup` vào `manifest.json`**

Đọc lại đúng khối `action` hiện tại:
```json
  "action": {
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png"
    },
    "default_title": "Dich trang nay (Alt+D)"
  }
```

Thêm `default_popup` (giữ nguyên 2 field còn lại):
```json
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png"
    },
    "default_title": "Dich trang nay (Alt+D)"
  }
```

- [ ] **Step 2: Tạo `extension/popup/popup.html`**

```html
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<title>Manga Overlay Translator</title>
<style>
  body {
    width: 280px;
    font-family: -apple-system, "Segoe UI", sans-serif;
    padding: 12px;
    margin: 0;
  }
  h1 {
    font-size: 14px;
    margin: 0 0 10px 0;
  }
  button {
    width: 100%;
    padding: 8px;
    margin-bottom: 6px;
    cursor: pointer;
  }
  .status {
    font-size: 12px;
    margin-top: 4px;
    min-height: 16px;
  }
  hr {
    border: none;
    border-top: 1px solid #ddd;
    margin: 12px 0;
  }
</style>
</head>
<body>
  <h1>Manga Overlay Translator</h1>

  <button id="btn-translate">Dịch trang này</button>
  <div id="translate-status" class="status"></div>

  <hr>

  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 3: Tạo `extension/popup/popup.js` (chỉ khối "Dịch trang này")**

```javascript
// ===== Khoi 1: Dich trang nay =====
document.getElementById('btn-translate').addEventListener('click', () => {
  const statusEl = document.getElementById('translate-status');
  statusEl.textContent = '';
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) {
      statusEl.textContent = 'Khong tim thay tab dang mo.';
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_TRANSLATE' }, () => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = 'Khong dich duoc trang nay.';
        return;
      }
      statusEl.textContent = 'Da bat dau dich!';
    });
  });
});
```

- [ ] **Step 4: Kiểm tra cú pháp**

Run: `node --check extension/popup/popup.js`
Expected: không lỗi.

Xác nhận `popup.html` là HTML hợp lệ bằng mắt (không cần công cụ riêng — file nhỏ, dễ soát).

- [ ] **Step 5: Xác minh thủ công**

1. Reload extension trong `chrome://extensions/`.
2. Mở 1 trang manga thật, bấm icon extension trên toolbar — kỳ vọng: **mở popup** (không còn dịch ngay như trước Task 1-2).
3. Trong popup, bấm "Dịch trang này" — kỳ vọng: đóng popup lại (hành vi mặc định của Chrome khi click) và trang bắt đầu dịch (kiểm tra bằng cách mở lại popup sau vài giây, hoặc xem trực tiếp trên trang có chữ dịch xuất hiện).
4. Mở popup trên 1 trang `chrome://extensions/` (hoặc trang nội bộ khác), bấm "Dịch trang này" — kỳ vọng: hiện chữ "Khong dich duoc trang nay." trong popup, không lỗi console không bắt được.
5. Xác nhận `Alt+D` trên trang manga vẫn hoạt động bình thường (không bị ảnh hưởng bởi việc thêm popup).

- [ ] **Step 6: Commit**

```bash
git add extension/manifest.json extension/popup/popup.html extension/popup/popup.js
git commit -m "Add popup with default_popup manifest entry and Dich trang nay button"
```

---

### Task 4: popup — URL backend (ô nhập + Lưu) + Test kết nối

**Files:**
- Modify: `extension/popup/popup.html`
- Modify: `extension/popup/popup.js`

**Interfaces:**
- Consumes: `chrome.storage.local` key `mot_backend_url` (Task 1 đã đọc, task này ghi).
- Produces: không có gì task khác phụ thuộc thêm.

- [ ] **Step 1: Thêm khối UI vào `popup.html`**

Chèn vào giữa nút "Dịch trang này" và thẻ `<hr>` cuối cùng (giữ nguyên `<script src="popup.js">` ở cuối):

```html
  <label for="backend-url">URL backend:</label>
  <input type="text" id="backend-url" style="width: 100%; box-sizing: border-box; margin: 4px 0 6px 0;">
  <button id="btn-save-url">Lưu</button>
  <button id="btn-test-connection">Test kết nối</button>
  <div id="connection-status" class="status"></div>

  <hr>
```

- [ ] **Step 2: Thêm logic vào `popup.js`**

Thêm vào cuối file (sau khối Task 3):

```javascript
// ===== Khoi 2 + 3: URL backend + Test ket noi =====
const DEFAULT_BACKEND_URL = 'http://127.0.0.1:5003';
const urlInput = document.getElementById('backend-url');

chrome.storage.local.get('mot_backend_url', (result) => {
  urlInput.value = result.mot_backend_url || DEFAULT_BACKEND_URL;
});

document.getElementById('btn-save-url').addEventListener('click', () => {
  const value = urlInput.value.trim();
  if (!value) return;
  chrome.storage.local.set({ mot_backend_url: value }, () => {
    document.getElementById('connection-status').textContent = 'Da luu.';
  });
});

document.getElementById('btn-test-connection').addEventListener('click', async () => {
  const statusEl = document.getElementById('connection-status');
  const value = urlInput.value.trim();
  if (!value) {
    statusEl.textContent = 'Chua nhap URL.';
    return;
  }
  statusEl.textContent = 'Dang kiem tra...';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${value}/openapi.json`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      statusEl.textContent = '✅ Ket noi OK';
    } else {
      statusEl.textContent = `❌ Khong ket noi duoc: HTTP ${res.status}`;
    }
  } catch (err) {
    clearTimeout(timeoutId);
    const reason = err.name === 'AbortError' ? 'timeout (5s)' : err.message;
    statusEl.textContent = `❌ Khong ket noi duoc: ${reason}`;
  }
});
```

- [ ] **Step 3: Kiểm tra cú pháp**

Run: `node --check extension/popup/popup.js`
Expected: không lỗi.

- [ ] **Step 4: Xác minh thủ công**

Đảm bảo backend đang chạy đúng port mặc định.
1. Reload extension, mở popup lần đầu (chưa lưu gì) — kỳ vọng: ô URL hiện đúng `http://127.0.0.1:5003`.
2. Bấm "Test kết nối" ngay (không đổi gì) — kỳ vọng: "✅ Ket noi OK".
3. Sửa ô URL thành `http://127.0.0.1:9999` (chưa bấm Lưu), bấm "Test kết nối" — kỳ vọng: "❌ Khong ket noi duoc: ..." (network error hoặc timeout).
4. Bấm "Lưu", đóng popup, mở lại — kỳ vọng: ô URL vẫn giữ `http://127.0.0.1:9999` (xác nhận đã lưu đúng).
5. Sửa lại về `http://127.0.0.1:5003`, bấm "Lưu" (khôi phục trạng thái bình thường cho các bước test sau).
6. Dịch thử 1 trang manga (Alt+D) — xác nhận vẫn dịch được bình thường sau khi khôi phục đúng URL.

- [ ] **Step 5: Commit**

```bash
git add extension/popup/popup.html extension/popup/popup.js
git commit -m "Add backend URL input, save button, and test-connection button to popup"
```

---

### Task 5: popup — dropdown ngôn ngữ đích + cảnh báo

**Files:**
- Modify: `extension/popup/popup.html`
- Modify: `extension/popup/popup.js`

**Interfaces:**
- Consumes: `chrome.storage.local` key `mot_target_lang` (Task 2 đã đọc, task này ghi).
- Produces: không có gì task khác phụ thuộc thêm.

- [ ] **Step 1: Thêm khối UI vào `popup.html`**

Chèn ngay sau khối URL backend (trước `<hr>` cuối cùng — nếu Task 4 đã đặt `<hr>` ở đó, di chuyển `<hr>` xuống dưới khối này):

```html
  <label for="target-lang">Ngôn ngữ đích:</label>
  <select id="target-lang" style="width: 100%; margin: 4px 0 6px 0;">
    <option value="VIN">Tiếng Việt</option>
    <option value="ENG">English</option>
    <option value="CHS">中文简体 (Chinese Simplified)</option>
    <option value="CHT">中文繁體 (Chinese Traditional)</option>
    <option value="JPN">日本語 (Japanese)</option>
    <option value="KOR">한국어 (Korean)</option>
  </select>
  <div id="lang-warning" class="status" style="display: none; color: #b45309;">
    ⚠️ Prompt La-tinh hoá tên riêng hiện chỉ tối ưu cho tiếng Việt — ngôn ngữ khác dùng prompt mặc định của backend, có thể dịch chưa tối ưu.
  </div>

  <hr>
```

- [ ] **Step 2: Thêm logic vào `popup.js`**

Thêm vào cuối file:

```javascript
// ===== Khoi 5b: Ngon ngu dich =====
const DEFAULT_TARGET_LANG = 'VIN';
const langSelect = document.getElementById('target-lang');
const langWarning = document.getElementById('lang-warning');

function updateLangWarning() {
  langWarning.style.display = langSelect.value === 'VIN' ? 'none' : 'block';
}

chrome.storage.local.get('mot_target_lang', (result) => {
  langSelect.value = result.mot_target_lang || DEFAULT_TARGET_LANG;
  updateLangWarning();
});

langSelect.addEventListener('change', () => {
  chrome.storage.local.set({ mot_target_lang: langSelect.value });
  updateLangWarning();
});
```

- [ ] **Step 3: Kiểm tra cú pháp**

Run: `node --check extension/popup/popup.js`
Expected: không lỗi.

- [ ] **Step 4: Xác minh thủ công**

1. Reload extension, mở popup lần đầu — kỳ vọng: dropdown hiện "Tiếng Việt", không có dòng cảnh báo.
2. Đổi dropdown sang "English" — kỳ vọng: dòng cảnh báo "⚠️ Prompt La-tinh hoá..." hiện ra ngay (không cần đóng/mở lại popup).
3. Đóng popup, mở lại — kỳ vọng: dropdown vẫn giữ "English" (đã lưu), cảnh báo vẫn hiện.
4. Dịch 1 ảnh (Alt+D) trên 1 trang manga (chưa từng dịch ảnh đó) — xác nhận qua Console: log `Cache MISS` có kèm `ENG`, request không có field `gpt_config` (xem Console service worker để kiểm tra body gửi đi nếu muốn chắc chắn — có thể tạm thêm `console.log(body)` để soát rồi xoá lại).
5. Dịch lại đúng ảnh đó lần 2 (vẫn "English") — kỳ vọng: `Cache HIT` (cache theo ngôn ngữ hoạt động đúng).
6. Đổi dropdown về "Tiếng Việt", dịch lại đúng ảnh đó — kỳ vọng: `Cache MISS` (không bị lẫn với cache tiếng Anh), request có `gpt_config`.
7. Đổi dropdown về "Tiếng Việt" trước khi kết thúc (khôi phục mặc định cho các lần dùng sau).

- [ ] **Step 5: Commit**

```bash
git add extension/popup/popup.html extension/popup/popup.js
git commit -m "Add target language dropdown with Vietnamese-prompt warning to popup"
```

---

## Final integration check (sau khi xong cả 5 task)

- [ ] Chạy lại toàn bộ kịch bản kiểm thử ở spec mục 10 một lượt cuối, sau khi mọi task đã commit — không bỏ sót mục nào.
- [ ] Xác nhận `grep -rn "CFG.API\|CFG.TARGET_LANG\|BACKEND_API\b" extension/` không còn kết quả nào (toàn bộ đã chuyển sang đọc storage động).
- [ ] Xác nhận `chrome.action.onClicked` không còn xuất hiện trong `extension/background/background.js`.
- [ ] `git log --oneline` từ commit đầu plan tới cuối — đối chiếu đúng 5 commit (1 cho mỗi task).
