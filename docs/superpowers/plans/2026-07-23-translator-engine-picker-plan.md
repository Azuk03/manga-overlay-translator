# Translator Engine Picker (Gemini + DeepL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a translator-engine dropdown (ChatGPT/Gemini/DeepL) to the extension popup, with Gemini/DeepL API keys configured via `.env` (server-side, same architecture as the existing OpenAI key) and a small backend patch so DeepL can translate to Vietnamese.

**Architecture:** Backend gains 2 optional `.env` keys (`GEMINI_API_KEY`/`GEMINI_MODEL`, `DEEPL_AUTH_KEY`) conditionally passed to the Docker container by `run-backend.ps1`, plus a new full-file-override patch (`patches/deepl.py`) adding the missing Vietnamese language-code mapping. The extension's `content.js` reads the chosen engine from `chrome.storage.local` on every translate call (same live-read pattern as `getBackendUrl()`/`getTargetLang()`), includes it in the cache key so switching engines can't return another engine's stale cached result, and only attaches the Vietnamese-romanization `gpt_config` prompt for GPT-family engines (chatgpt/gemini — DeepL has no such mechanism). The popup gains a 3rd dropdown, and the existing VIN-only warning becomes a joint function of both the language and engine dropdowns.

**Tech Stack:** JavaScript thuần (popup/content-script, không build tool), PowerShell (`run-backend.ps1`), Python (backend patch, full-file override — no local Python interpreter available on the host, verified only by direct text comparison + later real container rebuild).

## Global Constraints

- Không thêm ô nhập API key trong popup — key Gemini/DeepL đi qua `.env`, giống kiến trúc OpenAI hiện tại (spec mục 1, mục 8).
- Không xây hạ tầng cho engine dùng model offline (`nllb`, `m2m100`, `qwen2`, `mbart50`, `sugoi`/`jparacrawl`) hay các engine khác trong nhóm "cần key riêng" ngoài Gemini/DeepL (spec mục 8) — ngoài phạm vi plan này.
- Không dùng build tool/TypeScript/framework cho phần extension — JS thuần.
- Cấu hình engine áp dụng **ngay lập tức** — `content.js` đọc lại `chrome.storage.local` ở mỗi lần gọi (`getTranslatorEngine()`), không cache vào biến cố định (spec mục 6, nhất quán với `getBackendUrl()`/`getTargetLang()` đã có).
- Cache key phải bao gồm engine (`Cache._key(hash, targetLang, engine)`) — đổi engine trên cùng ảnh/cùng ngôn ngữ phải là `Cache MISS`, không được trả nhầm kết quả engine khác (spec mục 6).
- `gpt_config` (prompt La-tinh hoá tên riêng) chỉ gắn khi `targetLang === 'VIN' && engine !== 'deepl'` — Gemini dùng chung cơ chế `gpt_config` với ChatGPT (cả 2 kế thừa `CommonGPTTranslator` bên backend), DeepL thì không có cơ chế này (spec mục 3, mục 6).
- Không kiểm tra "engine đã có key chưa" trong popup (không network round-trip) — lỗi thiếu key hiện qua thông báo backend đã có sẵn (`MissingAPIKeyException`), đi qua cơ chế bọc lỗi chung hiện tại (spec mục 9).
- Không có Playwright/pytest cho phần extension — xác minh bằng tay trên Chrome/Edge thật + backend Docker thật (khớp quyết định đã có từ các plan trước). Không có Python interpreter trên máy host ngoài Docker — patch Python chỉ soát bằng so sánh văn bản, xác nhận cú pháp/chạy thật do con người làm ở bước cuối.
- Spec đầy đủ: `docs/superpowers/specs/2026-07-23-translator-engine-picker-design.md` — đọc trước khi bắt đầu, đặc biệt mục 3 (phát hiện DeepL thiếu mã tiếng Việt) và mục 8 (lý do loại các engine khác).

---

### Task 1: Backend — `.env`/`run-backend.ps1`/`Dockerfile` + patch `deepl.py`

**Files:**
- Modify: `.env.example`
- Modify: `run-backend.ps1:46-52` (chèn thêm sau khối `OPENAI_API_BASE` hiện có)
- Modify: `Dockerfile` (thêm 1 dòng `COPY` sau các dòng đã có)
- Create: `patches/deepl.py`

**Interfaces:**
- Consumes: không phụ thuộc task nào khác.
- Produces: backend Docker image (sau khi rebuild) chấp nhận `translator: "gemini"` (nếu `GEMINI_API_KEY` được set) và `translator: "deepl"` với `target_lang: "VIN"` hoạt động đúng (sau patch). Task 2/3 không phụ thuộc trực tiếp vào việc backend đã rebuild hay chưa (chỉ gửi đúng field `translator`/`target_lang` — xác minh thật cần con người rebuild + test cuối plan).

- [ ] **Step 1: Thêm biến vào `.env.example`**

Đọc lại đúng nội dung hiện tại của `.env.example` (22 dòng, phần cuối là):
```
# ============ Backend Docker ============
# Port thật của REST API — ĐỂ TRỐNG cho tới khi xong Giai đoạn B (dò thực nghiệm).
# README chính thức mâu thuẫn giữa 5003/8000/8001, không được đoán.
BACKEND_PORT=

# Container name (không phải secret, chỉ để tiện quản lý)
CONTAINER_NAME=manga_translator
```

Chèn khối mới **trước** dòng `# ============ Backend Docker ============`:

```
# ============ Translator (Gemini) - TUY CHON ============
# Can de dung engine "gemini" trong popup extension. De trong = khong the
# chon Gemini (chon vao se bao loi ro rang tu backend).
GEMINI_API_KEY=

# Model Gemini dung de dich. Mac dinh khop voi default cua backend
# (khong bat buoc set - chi can neu muon doi model khac).
GEMINI_MODEL=gemini-1.5-flash-002

# ============ Translator (DeepL) - TUY CHON ============
# Can de dung engine "deepl" trong popup extension. De trong = khong the
# chon DeepL (chon vao se bao loi ro rang tu backend).
DEEPL_AUTH_KEY=

```

File `.env.example` sau khi sửa (toàn bộ, để đối chiếu):

```
# Copy file này thành .env rồi điền giá trị thật. KHÔNG commit .env.
# Xem GIAI ĐOẠN A / B trong spec-manga-overlay-translator.md để biết chi tiết.

# ============ Translator (OpenAI) ============
# API key OpenAI thật (sk-...). Bắt buộc.
OPENAI_API_KEY=

# Model dùng để dịch. Mặc định khuyến nghị: gpt-4o-mini (rẻ, đủ tốt cho dịch thuật).
OPENAI_MODEL=gpt-4o-mini

# Base URL của API. Để trống = dùng mặc định của OpenAI (api.openai.com).
# Chỉ set nếu dùng proxy hoặc endpoint OpenAI-compatible khác (DeepSeek, OpenRouter...).
OPENAI_API_BASE=

# ============ Translator (Gemini) - TUY CHON ============
# Can de dung engine "gemini" trong popup extension. De trong = khong the
# chon Gemini (chon vao se bao loi ro rang tu backend).
GEMINI_API_KEY=

# Model Gemini dung de dich. Mac dinh khop voi default cua backend
# (khong bat buoc set - chi can neu muon doi model khac).
GEMINI_MODEL=gemini-1.5-flash-002

# ============ Translator (DeepL) - TUY CHON ============
# Can de dung engine "deepl" trong popup extension. De trong = khong the
# chon DeepL (chon vao se bao loi ro rang tu backend).
DEEPL_AUTH_KEY=

# ============ Backend Docker ============
# Port thật của REST API — ĐỂ TRỐNG cho tới khi xong Giai đoạn B (dò thực nghiệm).
# README chính thức mâu thuẫn giữa 5003/8000/8001, không được đoán.
BACKEND_PORT=

# Container name (không phải secret, chỉ để tiện quản lý)
CONTAINER_NAME=manga_translator
```

- [ ] **Step 2: Thêm truyền biến vào `run-backend.ps1`**

Đọc lại đúng đoạn hiện tại (dòng 47-52):
```powershell
if ($vars.ContainsKey("OPENAI_MODEL")) {
    $dockerArgs += "-e"; $dockerArgs += "OPENAI_MODEL=$($vars['OPENAI_MODEL'])"
}
if ($vars.ContainsKey("OPENAI_API_BASE")) {
    $dockerArgs += "-e"; $dockerArgs += "OPENAI_API_BASE=$($vars['OPENAI_API_BASE'])"
}
```

Thay bằng (thêm 3 khối mới ngay sau, giữ nguyên 2 khối cũ):
```powershell
if ($vars.ContainsKey("OPENAI_MODEL")) {
    $dockerArgs += "-e"; $dockerArgs += "OPENAI_MODEL=$($vars['OPENAI_MODEL'])"
}
if ($vars.ContainsKey("OPENAI_API_BASE")) {
    $dockerArgs += "-e"; $dockerArgs += "OPENAI_API_BASE=$($vars['OPENAI_API_BASE'])"
}
if ($vars.ContainsKey("GEMINI_API_KEY")) {
    $dockerArgs += "-e"; $dockerArgs += "GEMINI_API_KEY=$($vars['GEMINI_API_KEY'])"
}
if ($vars.ContainsKey("GEMINI_MODEL")) {
    $dockerArgs += "-e"; $dockerArgs += "GEMINI_MODEL=$($vars['GEMINI_MODEL'])"
}
if ($vars.ContainsKey("DEEPL_AUTH_KEY")) {
    $dockerArgs += "-e"; $dockerArgs += "DEEPL_AUTH_KEY=$($vars['DEEPL_AUTH_KEY'])"
}
```

- [ ] **Step 3: Kiểm tra cú pháp PowerShell**

Run (không thực thi script, chỉ parse cú pháp — script này gọi `docker run` thật nếu chạy trực tiếp, không phù hợp cho subagent không có Docker):
```powershell
powershell -NoProfile -Command "$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'run-backend.ps1'), [ref]$null, [ref]$errors); if ($errors.Count -gt 0) { $errors } else { Write-Output 'OK' }"
```
Expected: in ra `OK`, không có lỗi cú pháp nào được liệt kê.

- [ ] **Step 4: Thêm dòng `COPY` vào `Dockerfile`**

Đọc lại đúng nội dung hiện tại (4 dòng cuối):
```dockerfile
# Them route /fetch-image: extension khong tu dat duoc header Referer trong
# Manifest V3 (xem docs/superpowers/specs/2026-07-21-browser-extension-port-design.md
# muc 2/6) - route nay de backend tu tai anh ho kem Referer dung.
COPY patches/main.py /app/server/main.py
```

Thêm vào cuối file:
```dockerfile

# Va bug: _LANGUAGE_CODE_MAP trong deepl.py chua co entry 'VIN' du DeepL API
# that da ho tro tieng Viet tu 6/2025 (code backend chua cap nhat theo) - xem
# docs/superpowers/specs/2026-07-23-translator-engine-picker-design.md muc 3.
COPY patches/deepl.py /app/manga_translator/translators/deepl.py
```

- [ ] **Step 5: Tạo `patches/deepl.py`**

Nội dung đầy đủ (copy nguyên file gốc từ backend, chỉ thêm 1 dòng `'VIN': 'VI',` vào `_LANGUAGE_CODE_MAP`, đã xác nhận bằng cách đọc trực tiếp file trong container đang chạy):

```python
import deepl

from .common import CommonTranslator, MissingAPIKeyException
from .keys import DEEPL_AUTH_KEY

class DeeplTranslator(CommonTranslator):
    _LANGUAGE_CODE_MAP = {
        'VIN': 'VI',
        'CHS': 'ZH-HANS',
        'CHT': 'ZH-HANT',
        'JPN': 'JA',
        'ENG': 'EN-US',
        'CSY': 'CS',
        'NLD': 'NL',
        'FRA': 'FR',
        'DEU': 'DE',
        'HUN': 'HU',
        'ITA': 'IT',
        'POL': 'PL',
        'PTB': 'PT-BR',
        'ROM': 'RO',
        'RUS': 'RU',
        'ESP': 'ES',
        'IND': 'ID',
        'ARA': 'AR',
        'BGR': 'BG',
        'BUL': 'BG',
        'DAN': 'DA',
        'ELL': 'EL',
        'EST': 'ET',
        'FIN': 'FI',
        'KOR': 'KO',
        'LTH': 'LT',
        'LIT': 'LT',
        'LAV': 'LV',
        'NOB': 'NB',
        'SVK': 'SK',
        'SLO': 'SK',
        'SLV': 'SL',
        'SWE': 'SV',
        'TRK': 'TR',
        'TUR': 'TR',
        'UKR': 'UK'
    }

    def __init__(self):
        super().__init__()
        if not DEEPL_AUTH_KEY:
            raise MissingAPIKeyException('Please set the DEEPL_AUTH_KEY environment variable before using the deepl translator.')
        self.translator = deepl.Translator(DEEPL_AUTH_KEY)

    async def _translate(self, from_lang, to_lang, queries):
        return self.translator.translate_text('\n'.join(queries), target_lang = to_lang).text.split('\n')
```

- [ ] **Step 6: Xác minh không có gì khác bị lỡ tay đổi**

Run:
```bash
git diff .env.example run-backend.ps1 Dockerfile
```
Expected: chỉ thấy các dòng thêm mới đúng như Step 1/2/4 mô tả — không có dòng nào trong nội dung gốc (OPENAI_*, BACKEND_PORT, CONTAINER_NAME, các COPY cũ) bị xoá hay sửa.

**⚠️ Không thể xác minh từ agent session (không có Docker/Python trên host):** rebuild image thật (`docker build -t manga-translator-patched:local .`), chạy `run-backend.ps1` thật với `GEMINI_API_KEY`/`DEEPL_AUTH_KEY` thật, và xác nhận `translator: "deepl"` + `target_lang: "VIN"` dịch ra tiếng Việt đúng — con người làm ở bước kiểm thử cuối plan (xem "Final integration check").

- [ ] **Step 7: Commit**

```bash
git add .env.example run-backend.ps1 Dockerfile patches/deepl.py
git commit -m "Add optional Gemini/DeepL config and patch deepl.py for Vietnamese support"
```

---

### Task 2: `content.js` — dùng engine đã chọn, sửa cache key

**Files:**
- Modify: `extension/content-script/content.js:4-5` (xoá `CFG.TRANSLATOR`)
- Modify: `extension/content-script/content.js:119-130` (`Cache` — thêm tham số `engine`)
- Modify: `extension/content-script/content.js:269-277` (thêm `getTranslatorEngine()` cạnh `getTargetLang()`)
- Modify: `extension/content-script/content.js:307-336` (`ApiAdapter.translateImage()`)
- Modify: `extension/content-script/content.js:707-737` (`translateAndRenderImage()`)

**Interfaces:**
- Consumes: không phụ thuộc Task 1 (chỉ cần backend chấp nhận đúng field `translator`/`target_lang` — không phụ thuộc việc image đã rebuild).
- Produces: `getTranslatorEngine()` (hàm async, đọc `chrome.storage.local` key `mot_translator_engine`, fallback `'chatgpt'`). Task 3 (popup) ghi vào đúng key này. `Cache.get(hash, targetLang, engine)`/`Cache.set(hash, targetLang, engine, value)` — chữ ký mới, khác bản cũ (không còn `Cache.get(hash, targetLang)`/`Cache.set(hash, targetLang, value)` 2 tham số).

- [ ] **Step 1: Xoá `CFG.TRANSLATOR`**

Đọc lại đầu file để xác nhận đúng nội dung hiện tại (dòng 4-5):
```javascript
  const CFG = {
    TRANSLATOR: 'chatgpt', // da xac nhan hoat dong o Giai doan B
    // gpt_config chi nhan DUONG DAN file tren SERVER (khong nhan noi dung
```

Xoá dòng `TRANSLATOR:` (giữ nguyên comment `// gpt_config...` phía dưới, đó là comment của field `GPT_CONFIG_PATH` ngay sau), còn lại:
```javascript
  const CFG = {
    // gpt_config chi nhan DUONG DAN file tren SERVER (khong nhan noi dung
```

- [ ] **Step 2: Sửa `Cache` — thêm tham số `engine` vào key**

Đọc lại đúng nội dung `Cache` hiện tại trước khi sửa (có thể lệch vài dòng sau Step 1 — tìm bằng nội dung, không chỉ số dòng):
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

Thay bằng:
```javascript
    // targetLang/engine duoc dua vao key vi ca 2 gio doi duoc ngay luc dung
    // (qua popup) - thieu 1 trong 2 trong key se tra nham ket qua ngon
    // ngu/engine cu tu cache (xem spec 2026-07-22-extension-popup-settings-design.md
    // muc 8 va 2026-07-23-translator-engine-picker-design.md muc 6).
    _key(hash, targetLang, engine) {
      return `mot_cache_v${CFG.CACHE_VERSION}_${engine}_${targetLang}_${hash}`;
    },
    async get(hash, targetLang, engine) {
      const key = this._key(hash, targetLang, engine);
      const result = await chrome.storage.local.get(key);
      return result[key] ? JSON.parse(result[key]) : null;
    },
    async set(hash, targetLang, engine, value) {
      const key = this._key(hash, targetLang, engine);
      await chrome.storage.local.set({ [key]: JSON.stringify(value) });
    },
```

- [ ] **Step 3: Thêm `getTranslatorEngine()` cạnh `getTargetLang()`**

Đọc lại đúng nội dung hiện tại:
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

Thêm hàm mới ngay sau (trước dòng `// ===== ApiAdapter`):
```javascript
  const DEFAULT_TARGET_LANG = 'VIN';

  // Doc ngon ngu dich tu chrome.storage.local moi lan goi (khong cache vao
  // hang so co dinh) de doi ngon ngu trong popup (Task 5) co tac dung ngay
  // lap tuc cho lan dich tiep theo.
  async function getTargetLang() {
    const result = await chrome.storage.local.get('mot_target_lang');
    return result.mot_target_lang || DEFAULT_TARGET_LANG;
  }

  const DEFAULT_TRANSLATOR_ENGINE = 'chatgpt';

  // Doc engine dich tu chrome.storage.local moi lan goi (khong cache vao
  // hang so co dinh) de doi engine trong popup co tac dung ngay lap tuc cho
  // lan dich tiep theo (xem spec 2026-07-23-translator-engine-picker-design.md).
  async function getTranslatorEngine() {
    const result = await chrome.storage.local.get('mot_translator_engine');
    return result.mot_translator_engine || DEFAULT_TRANSLATOR_ENGINE;
  }
```

- [ ] **Step 4: Sửa `ApiAdapter.translateImage()`**

Đọc lại đúng nội dung hiện tại trước khi sửa:
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

Thay bằng:
```javascript
    async translateImage(blob) {
      const dataUrl = await this.blobToDataURL(blob);
      const targetLang = await getTargetLang();
      const engine = await getTranslatorEngine();
      const translatorConfig = {
        translator: engine,
        target_lang: targetLang,
      };
      // gpt_config (prompt La-tinh hoa ten rieng) chi co tac dung voi engine
      // ho GPT (chatgpt/gemini - ca 2 deu ke thua CommonGPTTranslator ben
      // backend, doc chung 1 co che prompt qua field gpt_config), KHONG co
      // tac dung voi deepl (kien truc khac han, khong doc gpt_config - xem
      // spec 2026-07-23-translator-engine-picker-design.md muc 3/6).
      if (targetLang === 'VIN' && engine !== 'deepl') {
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

- [ ] **Step 5: Sửa `translateAndRenderImage()` — truyền `engine` vào `Cache.get`/`Cache.set`**

Đọc lại đúng nội dung hiện tại:
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

Thay bằng (thêm `const engine = await getTranslatorEngine();` ngay sau `targetLang`, truyền vào cả 2 lời gọi `Cache.get`/`Cache.set`, thêm `engine` vào 2 dòng log):
```javascript
  async function translateAndRenderImage(img) {
    if (imgLayers.has(img)) return;
    const tStart = performance.now();
    try {
      const blob = await ApiAdapter.downloadImageBlob(img);
      const hash = await Cache.hashBlob(blob);
      const targetLang = await getTargetLang();
      const engine = await getTranslatorEngine();
      let result = await Cache.get(hash, targetLang, engine);
      if (result) {
        log('Cache HIT:', hash, targetLang, engine, img.currentSrc || img.src);
      } else {
        log('Cache MISS, goi backend:', hash, targetLang, engine, img.currentSrc || img.src);
        result =
          img.naturalHeight > CFG.TILE_MAX_H
            ? await ApiAdapter.translateImageTiled(blob, img.naturalWidth, img.naturalHeight)
            : await ApiAdapter.translateImage(blob);
        await Cache.set(hash, targetLang, engine, result);
      }
```

(Phần còn lại của hàm — `computeRegionComplexity`, `OverlayRenderer.render`, `catch` — giữ nguyên, không đổi.)

- [ ] **Step 6: Kiểm tra cú pháp + không còn tham chiếu chữ ký cũ**

Run: `node --check extension/content-script/content.js`
Expected: không lỗi.

Run: `grep -n "CFG.TRANSLATOR\|Cache.get(hash, targetLang)\|Cache.set(hash, targetLang, result)" extension/content-script/content.js`
Expected: không có kết quả nào (xác nhận không còn nơi nào tham chiếu `CFG.TRANSLATOR` đã xoá, và không còn nơi nào gọi `Cache.get`/`Cache.set` theo chữ ký cũ 2/3 tham số thiếu `engine`).

- [ ] **Step 7: Xác minh thủ công (giả lập storage, giống pattern Task 2 plan trước)**

1. Reload extension. Mở 1 trang manga thật, `Alt+D` dịch 1 ảnh — xác nhận vẫn hoạt động bình thường (mặc định `chatgpt`, có `gpt_config` nếu ngôn ngữ đích là `VIN`).
2. Đổi context Console sang "Manga Overlay Translator", chạy:
   ```javascript
   chrome.storage.local.set({mot_translator_engine: 'deepl'});
   ```
3. F5 lại trang, `Alt+D` dịch lại **đúng ảnh vừa dịch ở bước 1** — kỳ vọng: **KHÔNG** phải "Cache HIT" (backend được gọi lại thật với `translator: "deepl"`, xác nhận cache key đã tính đúng theo engine) — xem log `Cache MISS` trong Console của tab. (Backend thật lúc này có thể chưa cấu hình `DEEPL_AUTH_KEY`/chưa rebuild image từ Task 1 — lỗi "Please set DEEPL_AUTH_KEY..." ở bước này là **dự kiến**, không phải bug; mục đích bước này chỉ là xác nhận field `translator` được gửi đúng và cache tách đúng theo engine, chưa cần xác nhận DeepL dịch thành công — việc đó nằm ở "Final integration check" cuối plan.)
4. Dọn lại: `chrome.storage.local.remove('mot_translator_engine');`.

- [ ] **Step 8: Commit**

```bash
git add extension/content-script/content.js
git commit -m "Read translator engine from chrome.storage.local; include it in cache key and gate gpt_config to GPT-family engines"
```

---

### Task 3: Popup — dropdown chọn engine + hợp nhất cảnh báo

**Files:**
- Modify: `extension/popup/popup.html:47-60` (chèn dropdown engine, di chuyển `<hr>`)
- Modify: `extension/popup/popup.js:64-82` (khối ngôn ngữ đích — sửa `updateLangWarning`, thêm khối engine)

**Interfaces:**
- Consumes: không phụ thuộc Task 1/2 để implement (chỉ ghi đúng key `mot_translator_engine` mà Task 2 đọc — có thể implement song song, nhưng xác minh thủ công cuối cùng cần Task 2 đã xong).
- Produces: không có gì task khác phụ thuộc thêm (đây là task cuối của plan).

- [ ] **Step 1: Thêm dropdown engine vào `popup.html`**

Đọc lại đúng nội dung hiện tại (dòng 47-60):
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

Thay bằng (thêm dropdown engine giữa khối ngôn ngữ và `<hr>`, sửa nội dung cảnh báo cho tổng quát hơn — không đổi `id="lang-warning"`, chỉ đổi text hiển thị):
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

  <label for="translator-engine">Translator engine:</label>
  <select id="translator-engine" style="width: 100%; margin: 4px 0 6px 0;">
    <option value="chatgpt">ChatGPT (OpenAI)</option>
    <option value="gemini">Gemini (Google)</option>
    <option value="deepl">DeepL</option>
  </select>

  <div id="lang-warning" class="status" style="display: none; color: #b45309;">
    ⚠️ Prompt La-tinh hoá tên riêng chỉ áp dụng cho ChatGPT/Gemini + tiếng Việt — tổ hợp hiện tại dùng prompt mặc định của backend.
  </div>

  <hr>
```

- [ ] **Step 2: Sửa `popup.js` — hợp nhất `updateLangWarning`, thêm khối engine**

Đọc lại đúng nội dung hiện tại (khối cuối file):
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

Thay bằng (khai báo `engineSelect` TRƯỚC `updateLangWarning` vì hàm này giờ đọc cả 2 select; thêm khối engine mới ngay sau, gọi `updateLangWarning()` trong cả `change` lẫn callback đọc storage của engine):
```javascript
// ===== Khoi 5b: Ngon ngu dich =====
const DEFAULT_TARGET_LANG = 'VIN';
const langSelect = document.getElementById('target-lang');
const langWarning = document.getElementById('lang-warning');
const engineSelect = document.getElementById('translator-engine');

// usesGptConfig phai khop CHINH XAC dieu kien gan gpt_config ben
// content.js (ApiAdapter.translateImage): targetLang === 'VIN' && engine
// !== 'deepl' - xem spec 2026-07-23-translator-engine-picker-design.md muc 7.
function updateLangWarning() {
  const usesGptConfig = langSelect.value === 'VIN' && engineSelect.value !== 'deepl';
  langWarning.style.display = usesGptConfig ? 'none' : 'block';
}

chrome.storage.local.get('mot_target_lang', (result) => {
  langSelect.value = result.mot_target_lang || DEFAULT_TARGET_LANG;
  updateLangWarning();
});

langSelect.addEventListener('change', () => {
  chrome.storage.local.set({ mot_target_lang: langSelect.value });
  updateLangWarning();
});

// ===== Khoi 6: Translator engine =====
const DEFAULT_TRANSLATOR_ENGINE = 'chatgpt';

chrome.storage.local.get('mot_translator_engine', (result) => {
  engineSelect.value = result.mot_translator_engine || DEFAULT_TRANSLATOR_ENGINE;
  updateLangWarning();
});

engineSelect.addEventListener('change', () => {
  chrome.storage.local.set({ mot_translator_engine: engineSelect.value });
  updateLangWarning();
});
```

- [ ] **Step 3: Kiểm tra cú pháp**

Run: `node --check extension/popup/popup.js`
Expected: không lỗi.

Xác nhận `popup.html` là HTML hợp lệ bằng mắt (file nhỏ, dễ soát) — đặc biệt chỉ có **đúng 1** thẻ `<hr>` trước `<script src="popup.js">` (không bị nhân đôi khi chèn khối mới).

- [ ] **Step 4: Xác minh thủ công**

1. Reload extension, mở popup lần đầu — kỳ vọng: dropdown engine hiện "ChatGPT (OpenAI)", dropdown ngôn ngữ hiện "Tiếng Việt", **không** có dòng cảnh báo (tổ hợp mặc định chatgpt+VIN dùng gpt_config).
2. Đổi dropdown engine sang "DeepL" (ngôn ngữ vẫn "Tiếng Việt") — kỳ vọng: dòng cảnh báo hiện ra ngay lập tức (không cần đóng/mở lại popup) — xác nhận `updateLangWarning()` phản ứng đúng với thay đổi engine, không chỉ ngôn ngữ.
3. Đổi dropdown engine về lại "ChatGPT" — kỳ vọng: cảnh báo ẩn lại ngay.
4. Đổi dropdown ngôn ngữ sang "English" (engine vẫn "ChatGPT") — kỳ vọng: cảnh báo hiện ra (hành vi cũ, xác nhận chưa bị hỏng).
5. Đóng popup, mở lại — kỳ vọng: cả 2 dropdown giữ đúng lựa chọn đã lưu ở bước cuối cùng.
6. Đổi cả 2 dropdown về lại "ChatGPT" + "Tiếng Việt" trước khi kết thúc (khôi phục mặc định cho các bước test sau).

- [ ] **Step 5: Commit**

```bash
git add extension/popup/popup.html extension/popup/popup.js
git commit -m "Add translator engine dropdown to popup; unify VIN-prompt warning across language and engine selection"
```

---

## Final integration check (sau khi xong cả 3 task — cần con người, không thể tự động hoá)

- [ ] Rebuild image backend thật: `docker build -t manga-translator-patched:local .` (áp dụng patch `deepl.py` từ Task 1).
- [ ] Điền `GEMINI_API_KEY` và `DEEPL_AUTH_KEY` thật vào `.env`, chạy lại `run-backend.ps1` (container mới, không phải `docker restart` — restart không áp dụng image mới, xem bài học từ phiên trước).
- [ ] Dịch thử cùng 1 ảnh bằng cả 3 engine (đổi dropdown, dịch lại) — xác nhận cả 3 chạy được, không lỗi.
- [ ] Chọn `deepl` + "Tiếng Việt" — xác nhận dịch ra tiếng Việt thật (xác nhận patch `_LANGUAGE_CODE_MAP` hoạt động, không chỉ field được gửi đúng).
- [ ] Tạm xoá/đổi sai 1 trong 2 key mới trong `.env`, rebuild/restart, chọn đúng engine đó — xác nhận lỗi hiện rõ ràng ("Please set the ... environment variable...") trong error log của content-script, không crash im lặng.
- [ ] Chạy lại `grep -rn "CFG.TRANSLATOR\b" extension/` — xác nhận không còn kết quả nào ngoài comment giải thích (nếu có).
- [ ] `git log --oneline` từ commit đầu plan tới cuối — đối chiếu đúng 3 commit (1 cho mỗi task).
