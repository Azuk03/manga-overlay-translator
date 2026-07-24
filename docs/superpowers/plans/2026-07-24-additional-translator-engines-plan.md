# Additional Translator Engines (DeepSeek/Groq/Youdao/Baidu/Caiyun) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 more translator engines (`deepseek`, `groq`, `youdao`, `baidu`, `caiyun`) to the extension popup and backend config, following the exact pattern already established for Gemini/DeepL.

**Architecture:** Backend gains 7 more optional `.env` keys (conditionally passed to Docker by `run-backend.ps1`, same conditional-pass pattern already used). No backend Python patch needed — all 5 engines already support Vietnamese natively (confirmed by reading each translator's `_LANGUAGE_CODE_MAP` in the running container). `content.js`'s `gpt_config` attachment condition changes from a denylist (`engine !== 'deepl'`) to an explicit allowlist (`GPT_FAMILY_ENGINES`), since most of the 5 new engines are dedicated translation APIs (not GPT-family) and would silently receive a meaningless field under the old denylist logic. The popup gains 5 more `<option>`s in the existing engine dropdown.

**Tech Stack:** JavaScript thuần (extension, không build tool), PowerShell (`run-backend.ps1`).

## Global Constraints

- Chỉ 5 engine này: `deepseek`, `groq`, `youdao`, `baidu`, `caiyun` — không thêm `papago` (dùng endpoint không chính thức, đã xác nhận qua source) hay `custom_openai` (cần Ollama tự cài, để đợt sau) (spec mục 2).
- Không cần patch Python nào trong `patches/` — cả 5 engine đã có sẵn `'VIN'` trong bảng ngôn ngữ của chính chúng (spec mục 3, đã tra thật trong container).
- `gpt_config` chỉ gắn khi `targetLang === 'VIN' && GPT_FAMILY_ENGINES.includes(engine)`, với `GPT_FAMILY_ENGINES = ['chatgpt', 'gemini', 'deepseek']` — đây là DANH SÁCH CHO PHÉP (không phải loại trừ), vì `groq`/`youdao`/`baidu`/`caiyun` là API dịch chuyên dụng (`CommonTranslator`), không đọc field này (spec mục 4).
- `popup.js` phải khai báo RIÊNG một bản sao `GPT_FAMILY_ENGINES` giống hệt `content.js` (2 file/ngữ cảnh tách biệt, không có build tool/import chung — cùng pattern đã có với `DEFAULT_BACKEND_URL`/`DEFAULT_TARGET_LANG`).
- Không xây "công cụ quản lý key" hay re-scope installer trong plan này — đó là 1 plan riêng, làm sau (spec mục 8).
- Không dùng build tool/TypeScript/framework — JS thuần.
- Không có Playwright/pytest — xác minh bằng tay trên Chrome/Edge thật + backend Docker thật.
- Spec đầy đủ: `docs/superpowers/specs/2026-07-24-additional-translator-engines-design.md` — đọc trước khi bắt đầu.

---

### Task 1: Backend — `.env.example`/`run-backend.ps1`

**Files:**
- Modify: `.env.example`
- Modify: `run-backend.ps1:53-61` (chèn thêm sau khối `DEEPL_AUTH_KEY` hiện có)

**Interfaces:**
- Consumes: không phụ thuộc task nào khác.
- Produces: backend Docker container (sau khi chạy lại) chấp nhận `translator: "deepseek"|"groq"|"youdao"|"baidu"|"caiyun"` nếu key tương ứng được set. Task 2/3 không phụ thuộc trực tiếp việc container đã chạy lại hay chưa (chỉ gửi đúng field `translator` — xác minh thật cần con người chạy lại container ở bước kiểm thử cuối plan).

- [ ] **Step 1: Thêm biến vào `.env.example`**

Đọc lại đúng nội dung hiện tại (36 dòng), phần cuối:
```
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

Chèn khối mới **trước** dòng `# ============ Backend Docker ============`:

```
# ============ Translator (DeepSeek) - TUY CHON ============
# Can de dung engine "deepseek" trong popup extension. De trong = khong the
# chon DeepSeek (chon vao se bao loi ro rang tu backend).
DEEPSEEK_API_KEY=

# Model DeepSeek dung de dich. Mac dinh khop voi default cua backend
# (khong bat buoc set - chi can neu muon doi model khac).
DEEPSEEK_MODEL=deepseek-chat

# ============ Translator (Groq) - TUY CHON ============
# Can de dung engine "groq" trong popup extension. De trong = khong the
# chon Groq (chon vao se bao loi ro rang tu backend).
GROQ_API_KEY=

# Model Groq dung de dich. Mac dinh khop voi default cua backend
# (khong bat buoc set - chi can neu muon doi model khac).
GROQ_MODEL=mixtral-8x7b-32768

# ============ Translator (Youdao) - TUY CHON ============
# Can CA 2 bien de dung engine "youdao" trong popup extension. Thieu 1
# trong 2 se bao loi ro rang tu backend.
YOUDAO_APP_KEY=
YOUDAO_SECRET_KEY=

# ============ Translator (Baidu) - TUY CHON ============
# Can CA 2 bien de dung engine "baidu" trong popup extension. Thieu 1
# trong 2 se bao loi ro rang tu backend.
BAIDU_APP_ID=
BAIDU_SECRET_KEY=

# ============ Translator (Caiyun) - TUY CHON ============
# Can de dung engine "caiyun" trong popup extension. De trong = khong the
# chon Caiyun (chon vao se bao loi ro rang tu backend).
CAIYUN_TOKEN=

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

# ============ Translator (DeepSeek) - TUY CHON ============
# Can de dung engine "deepseek" trong popup extension. De trong = khong the
# chon DeepSeek (chon vao se bao loi ro rang tu backend).
DEEPSEEK_API_KEY=

# Model DeepSeek dung de dich. Mac dinh khop voi default cua backend
# (khong bat buoc set - chi can neu muon doi model khac).
DEEPSEEK_MODEL=deepseek-chat

# ============ Translator (Groq) - TUY CHON ============
# Can de dung engine "groq" trong popup extension. De trong = khong the
# chon Groq (chon vao se bao loi ro rang tu backend).
GROQ_API_KEY=

# Model Groq dung de dich. Mac dinh khop voi default cua backend
# (khong bat buoc set - chi can neu muon doi model khac).
GROQ_MODEL=mixtral-8x7b-32768

# ============ Translator (Youdao) - TUY CHON ============
# Can CA 2 bien de dung engine "youdao" trong popup extension. Thieu 1
# trong 2 se bao loi ro rang tu backend.
YOUDAO_APP_KEY=
YOUDAO_SECRET_KEY=

# ============ Translator (Baidu) - TUY CHON ============
# Can CA 2 bien de dung engine "baidu" trong popup extension. Thieu 1
# trong 2 se bao loi ro rang tu backend.
BAIDU_APP_ID=
BAIDU_SECRET_KEY=

# ============ Translator (Caiyun) - TUY CHON ============
# Can de dung engine "caiyun" trong popup extension. De trong = khong the
# chon Caiyun (chon vao se bao loi ro rang tu backend).
CAIYUN_TOKEN=

# ============ Backend Docker ============
# Port thật của REST API — ĐỂ TRỐNG cho tới khi xong Giai đoạn B (dò thực nghiệm).
# README chính thức mâu thuẫn giữa 5003/8000/8001, không được đoán.
BACKEND_PORT=

# Container name (không phải secret, chỉ để tiện quản lý)
CONTAINER_NAME=manga_translator
```

- [ ] **Step 2: Thêm truyền biến vào `run-backend.ps1`**

Đọc lại đúng đoạn hiện tại:
```powershell
if ($vars.ContainsKey("DEEPL_AUTH_KEY")) {
    $dockerArgs += "-e"; $dockerArgs += "DEEPL_AUTH_KEY=$($vars['DEEPL_AUTH_KEY'])"
}
```

Thay bằng (giữ nguyên khối `DEEPL_AUTH_KEY`, thêm 8 khối mới ngay sau):
```powershell
if ($vars.ContainsKey("DEEPL_AUTH_KEY")) {
    $dockerArgs += "-e"; $dockerArgs += "DEEPL_AUTH_KEY=$($vars['DEEPL_AUTH_KEY'])"
}
if ($vars.ContainsKey("DEEPSEEK_API_KEY")) {
    $dockerArgs += "-e"; $dockerArgs += "DEEPSEEK_API_KEY=$($vars['DEEPSEEK_API_KEY'])"
}
if ($vars.ContainsKey("DEEPSEEK_MODEL")) {
    $dockerArgs += "-e"; $dockerArgs += "DEEPSEEK_MODEL=$($vars['DEEPSEEK_MODEL'])"
}
if ($vars.ContainsKey("GROQ_API_KEY")) {
    $dockerArgs += "-e"; $dockerArgs += "GROQ_API_KEY=$($vars['GROQ_API_KEY'])"
}
if ($vars.ContainsKey("GROQ_MODEL")) {
    $dockerArgs += "-e"; $dockerArgs += "GROQ_MODEL=$($vars['GROQ_MODEL'])"
}
if ($vars.ContainsKey("YOUDAO_APP_KEY")) {
    $dockerArgs += "-e"; $dockerArgs += "YOUDAO_APP_KEY=$($vars['YOUDAO_APP_KEY'])"
}
if ($vars.ContainsKey("YOUDAO_SECRET_KEY")) {
    $dockerArgs += "-e"; $dockerArgs += "YOUDAO_SECRET_KEY=$($vars['YOUDAO_SECRET_KEY'])"
}
if ($vars.ContainsKey("BAIDU_APP_ID")) {
    $dockerArgs += "-e"; $dockerArgs += "BAIDU_APP_ID=$($vars['BAIDU_APP_ID'])"
}
if ($vars.ContainsKey("BAIDU_SECRET_KEY")) {
    $dockerArgs += "-e"; $dockerArgs += "BAIDU_SECRET_KEY=$($vars['BAIDU_SECRET_KEY'])"
}
if ($vars.ContainsKey("CAIYUN_TOKEN")) {
    $dockerArgs += "-e"; $dockerArgs += "CAIYUN_TOKEN=$($vars['CAIYUN_TOKEN'])"
}
```

- [ ] **Step 3: Kiểm tra cú pháp PowerShell**

Run (không thực thi script thật, chỉ parse cú pháp):
```powershell
powershell -NoProfile -Command '$errs=$null; [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path "run-backend.ps1"), [ref]$null, [ref]$errs); if ($errs.Count -gt 0) { $errs } else { "PS1 OK" }'
```
Expected: in ra `PS1 OK`, không có lỗi cú pháp nào được liệt kê.

- [ ] **Step 4: Xác minh không có gì khác bị lỡ tay đổi**

Run:
```bash
git diff .env.example run-backend.ps1
```
Expected: chỉ thấy các dòng thêm mới đúng như Step 1/2 mô tả — không có dòng nào trong nội dung gốc (OPENAI_*/GEMINI_*/DEEPL_AUTH_KEY/BACKEND_PORT/CONTAINER_NAME) bị xoá hay sửa.

**⚠️ Không thể xác minh từ agent session (không có Docker trên host):** chạy lại `run-backend.ps1` thật với ít nhất 1 trong 5 key mới điền thật, và xác nhận engine đó dịch được — con người làm ở bước kiểm thử cuối plan.

- [ ] **Step 5: Commit**

```bash
git add .env.example run-backend.ps1
git commit -m "Add optional .env keys for DeepSeek/Groq/Youdao/Baidu/Caiyun translators"
```

---

### Task 2: `content.js` — đổi điều kiện `gpt_config` thành danh sách cho phép

**Files:**
- Modify: `extension/content-script/content.js:283` (thêm `GPT_FAMILY_ENGINES`)
- Modify: `extension/content-script/content.js:334` (điều kiện gắn `gpt_config`)

**Interfaces:**
- Consumes: không phụ thuộc Task 1.
- Produces: `GPT_FAMILY_ENGINES` (mảng hằng số `['chatgpt', 'gemini', 'deepseek']`). Task 3 (popup) khai báo một bản sao giống hệt của mảng này (không import chung — 2 ngữ cảnh JS tách biệt).

- [ ] **Step 1: Thêm `GPT_FAMILY_ENGINES`**

Đọc lại đúng nội dung hiện tại:
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

Thay bằng (thêm hằng số mới ngay sau, trước dòng `// ===== ApiAdapter`):
```javascript
  const DEFAULT_TRANSLATOR_ENGINE = 'chatgpt';

  // Doc engine dich tu chrome.storage.local moi lan goi (khong cache vao
  // hang so co dinh) de doi engine trong popup co tac dung ngay lap tuc cho
  // lan dich tiep theo (xem spec 2026-07-23-translator-engine-picker-design.md).
  async function getTranslatorEngine() {
    const result = await chrome.storage.local.get('mot_translator_engine');
    return result.mot_translator_engine || DEFAULT_TRANSLATOR_ENGINE;
  }

  // Chi engine thuoc ho GPT (ke thua CommonGPTTranslator ben backend) moi
  // doc duoc gpt_config - cac engine dich chuyen dung (groq/youdao/baidu/
  // caiyun/deepl...) co kien truc rieng, khong dung field nay. Danh sach
  // CHO PHEP (khong phai loai tru) de de mo rong dung khi them engine moi -
  // xem spec 2026-07-24-additional-translator-engines-design.md muc 4.
  const GPT_FAMILY_ENGINES = ['chatgpt', 'gemini', 'deepseek'];
```

- [ ] **Step 2: Sửa điều kiện gắn `gpt_config`**

Đọc lại đúng nội dung hiện tại (trong `ApiAdapter.translateImage()`):
```javascript
      // gpt_config (prompt La-tinh hoa ten rieng) chi co tac dung voi engine
      // ho GPT (chatgpt/gemini - ca 2 deu ke thua CommonGPTTranslator ben
      // backend, doc chung 1 co che prompt qua field gpt_config), KHONG co
      // tac dung voi deepl (kien truc khac han, khong doc gpt_config - xem
      // spec 2026-07-23-translator-engine-picker-design.md muc 3/6).
      if (targetLang === 'VIN' && engine !== 'deepl') {
        translatorConfig.gpt_config = CFG.GPT_CONFIG_PATH;
      }
```

Thay bằng:
```javascript
      // gpt_config (prompt La-tinh hoa ten rieng) chi co tac dung voi engine
      // thuoc GPT_FAMILY_ENGINES (xem khai bao o tren) - cac engine dich
      // chuyen dung khac khong doc field nay.
      if (targetLang === 'VIN' && GPT_FAMILY_ENGINES.includes(engine)) {
        translatorConfig.gpt_config = CFG.GPT_CONFIG_PATH;
      }
```

- [ ] **Step 3: Kiểm tra cú pháp + không còn điều kiện cũ**

Run: `node --check extension/content-script/content.js`
Expected: không lỗi.

Run: `grep -n "engine !== 'deepl'" extension/content-script/content.js`
Expected: không có kết quả nào (xác nhận điều kiện loại trừ cũ đã được thay hoàn toàn bằng danh sách cho phép).

- [ ] **Step 4: Commit**

```bash
git add extension/content-script/content.js
git commit -m "Change gpt_config condition from a denylist to an explicit GPT-family allowlist"
```

---

### Task 3: Popup — thêm 5 engine vào dropdown

**Files:**
- Modify: `extension/popup/popup.html:57-62` (thêm 5 `<option>`)
- Modify: `extension/popup/popup.js:64-76` (thêm `GPT_FAMILY_ENGINES`, sửa `updateLangWarning`)

**Interfaces:**
- Consumes: không phụ thuộc Task 1/2 để implement (chỉ cần ghi đúng key `mot_translator_engine` đã có sẵn từ trước — có thể implement song song, nhưng xác minh thủ công cuối cùng cần Task 1/2 đã xong).
- Produces: không có gì task khác phụ thuộc thêm (đây là task cuối của plan).

- [ ] **Step 1: Thêm 5 `<option>` vào dropdown engine**

Đọc lại đúng nội dung hiện tại:
```html
  <label for="translator-engine">Translator engine:</label>
  <select id="translator-engine" style="width: 100%; margin: 4px 0 6px 0;">
    <option value="chatgpt">ChatGPT (OpenAI)</option>
    <option value="gemini">Gemini (Google)</option>
    <option value="deepl">DeepL</option>
  </select>
```

Thay bằng:
```html
  <label for="translator-engine">Translator engine:</label>
  <select id="translator-engine" style="width: 100%; margin: 4px 0 6px 0;">
    <option value="chatgpt">ChatGPT (OpenAI)</option>
    <option value="gemini">Gemini (Google)</option>
    <option value="deepl">DeepL</option>
    <option value="deepseek">DeepSeek</option>
    <option value="groq">Groq</option>
    <option value="youdao">Youdao (有道)</option>
    <option value="baidu">Baidu (百度)</option>
    <option value="caiyun">Caiyun (彩云小译)</option>
  </select>
```

- [ ] **Step 2: Thêm `GPT_FAMILY_ENGINES` + sửa `updateLangWarning` trong `popup.js`**

Đọc lại đúng nội dung hiện tại:
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
```

Thay bằng:
```javascript
// ===== Khoi 5b: Ngon ngu dich =====
const DEFAULT_TARGET_LANG = 'VIN';
const langSelect = document.getElementById('target-lang');
const langWarning = document.getElementById('lang-warning');
const engineSelect = document.getElementById('translator-engine');

// Ban sao GIONG HET GPT_FAMILY_ENGINES trong content.js - 2 file/ngu canh
// tach biet, khong co build tool/import chung (cung pattern voi
// DEFAULT_BACKEND_URL/DEFAULT_TARGET_LANG). Neu doi 1 ben PHAI doi ca 2 -
// xem spec 2026-07-24-additional-translator-engines-design.md muc 4.
const GPT_FAMILY_ENGINES = ['chatgpt', 'gemini', 'deepseek'];

// usesGptConfig phai khop CHINH XAC dieu kien gan gpt_config ben content.js
// (ApiAdapter.translateImage): targetLang === 'VIN' &&
// GPT_FAMILY_ENGINES.includes(engine).
function updateLangWarning() {
  const usesGptConfig = langSelect.value === 'VIN' && GPT_FAMILY_ENGINES.includes(engineSelect.value);
  langWarning.style.display = usesGptConfig ? 'none' : 'block';
}
```

- [ ] **Step 3: Kiểm tra cú pháp**

Run: `node --check extension/popup/popup.js`
Expected: không lỗi.

Xác nhận `popup.html` là HTML hợp lệ bằng mắt (file nhỏ, dễ soát) — đúng 8 `<option>` trong dropdown engine, không có option nào bị trùng `value`.

- [ ] **Step 4: Xác minh thủ công**

1. Reload extension, mở popup — xác nhận dropdown "Translator engine" hiện đủ 8 lựa chọn (ChatGPT/Gemini/DeepL/DeepSeek/Groq/Youdao/Baidu/Caiyun).
2. Chọn "DeepSeek" + "Tiếng Việt" — xác nhận **không** hiện cảnh báo (DeepSeek thuộc `GPT_FAMILY_ENGINES`).
3. Chọn "Groq" + "Tiếng Việt" — xác nhận **có** hiện cảnh báo (Groq không thuộc họ GPT).
4. Chọn "Youdao"/"Baidu"/"Caiyun" + "Tiếng Việt" — xác nhận đều **có** hiện cảnh báo.
5. Đổi engine về lại "ChatGPT" trước khi kết thúc (khôi phục mặc định cho các bước test sau).

- [ ] **Step 5: Commit**

```bash
git add extension/popup/popup.html extension/popup/popup.js
git commit -m "Add DeepSeek/Groq/Youdao/Baidu/Caiyun to popup engine dropdown"
```

---

## Final integration check (sau khi xong cả 3 task — cần con người, không thể tự động hoá)

- [ ] Điền key thật cho ít nhất 2-3 trong 5 engine mới vào `.env`, chạy lại `run-backend.ps1` (container mới, không phải `docker restart`).
- [ ] Dịch thử cùng 1 ảnh bằng từng engine đã điền key — xác nhận dịch ra tiếng Việt đúng.
- [ ] Chọn `youdao` hoặc `baidu` nhưng chỉ điền 1 trong 2 biến bắt buộc — xác nhận lỗi rõ ràng từ backend, không crash im lặng.
- [ ] Đổi engine trên cùng ảnh/cùng ngôn ngữ giữa 1 engine mới và 1 engine cũ (VD groq ↔ chatgpt) — xác nhận `Cache MISS` (không lẫn cache).
- [ ] Chạy lại `grep -rn "engine !== 'deepl'" extension/` — xác nhận không còn kết quả nào.
- [ ] `git log --oneline` từ commit đầu plan tới cuối — đối chiếu đúng 3 commit (1 cho mỗi task).
