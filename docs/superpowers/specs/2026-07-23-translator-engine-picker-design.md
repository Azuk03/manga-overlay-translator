# Chọn translator engine trong popup — Design

## 1. Bối cảnh & mục tiêu

Khi brainstorm popup settings (2026-07-22), việc thêm dropdown chọn translator engine đã bị hoãn có chủ đích: 22/25 engine backend hỗ trợ sẽ lỗi ngay nếu chọn vào (thiếu API key riêng hoặc thiếu model tải về), xem `docs/superpowers/specs/2026-07-22-extension-popup-settings-design.md` mục 12.

Spec này giải quyết đúng gap đó: thêm 2 engine thực sự dùng được (Gemini, DeepL) bên cạnh ChatGPT hiện có, cộng thêm 1 patch backend nhỏ để DeepL dịch được tiếng Việt. Không đụng tới nhóm engine cần model offline (xem mục 8 — hoãn sang đợt riêng).

**Mục tiêu:** Popup có dropdown chọn engine (ChatGPT/Gemini/DeepL), key API cấu hình qua `.env` (nhất quán với kiến trúc OpenAI key hiện tại — không có ô nhập key trong popup), cache tách theo engine để tránh trả nhầm kết quả.

## 2. Vì sao chọn Gemini + DeepL (không phải nhóm khác)

Backend hỗ trợ 25 engine, chia 3 nhóm (nhắc lại từ spec trước):
1. Cần API key riêng: `deepl`, `papago`, `youdao`, `baidu`, `caiyun`, `deepseek`, `groq`, `gemini`, `custom_openai`.
2. Cần model offline tải về máy: `nllb(_big)`, `sugoi`, `jparacrawl(_big)`, `m2m100(_big)`, `mbart50`, `qwen2(_big)`.
3. Dùng được ngay: `chatgpt`.

Trong nhóm 1, chọn **Gemini** (LLM tổng quát, hỗ trợ tiếng Việt đầy đủ qua prompt giống ChatGPT, có free tier) và **DeepL** (dịch chuyên dụng, chất lượng cao, đã hỗ trợ tiếng Việt từ tháng 6/2025 — xác nhận qua tra cứu thực tế, không phải giả định). Các engine còn lại trong nhóm 1 (deepseek, groq, papago, youdao, baidu, caiyun, custom_openai) để sau nếu có nhu cầu cụ thể.

## 3. Phát hiện kỹ thuật quan trọng: `deepl.py` trong backend thiếu mã tiếng Việt

Tra trực tiếp source backend (`/app/manga_translator/translators/deepl.py`, `_LANGUAGE_CODE_MAP`): **không có entry cho `VIN`**, dù DeepL API thật đã hỗ trợ tiếng Việt (`target_lang=VI`) từ 6/2025. Đây là gap của code `zyddnys/manga-image-translator` chưa cập nhật theo API DeepL mới, không phải giới hạn thật của DeepL.

**Giải quyết:** thêm `patches/deepl.py` (ghi đè toàn file, theo đúng pattern `patches/to_json.py`/`patches/main.py` đã dùng) — copy nguyên file gốc, chỉ thêm `'VIN': 'VI'` vào `_LANGUAGE_CODE_MAP`.

`gemini.py` không có giới hạn tương tự — bảng ngôn ngữ trong file (`_LANGUAGE_CODE_MAP` ở dòng ~40) thực chất nằm trong docstring (comment), không phải code chạy thật; Gemini xử lý ngôn ngữ đích bằng cách đưa thẳng tên ngôn ngữ vào prompt (LLM, không giới hạn bảng mã cứng) — tiếng Việt (`'vi': 'Vietnamese'`) đã có trong danh sách chính thức của Google, dùng được ngay không cần patch.

## 4. Thay đổi backend

- `.env.example` (và `.env` của người dùng) thêm 3 biến **tùy chọn** (không bắt buộc, không set thì engine đó đơn giản là không chọn được/lỗi rõ nếu cố chọn):
  ```
  # Tuy chon - can de dung engine Gemini trong popup
  GEMINI_API_KEY=
  GEMINI_MODEL=gemini-1.5-flash-002

  # Tuy chon - can de dung engine DeepL trong popup
  DEEPL_AUTH_KEY=
  ```
- `run-backend.ps1`: thêm 2 khối `if ($vars.ContainsKey(...))` cho `GEMINI_API_KEY`/`GEMINI_MODEL`/`DEEPL_AUTH_KEY`, theo đúng pattern đã có với `OPENAI_MODEL`/`OPENAI_API_BASE` (chỉ truyền `-e` khi biến thực sự có giá trị — lý do tương tự: biến rỗng bị Docker set thành chuỗi rỗng thay vì "không set", có thể ghi đè default của app).
- `Dockerfile`: thêm `COPY patches/deepl.py /app/manga_translator/translators/deepl.py`.
- `patches/deepl.py`: file mới, full override, thêm `'VIN': 'VI'` vào `_LANGUAGE_CODE_MAP`.

**Không cần đổi gì trong `patches/main.py`/`to_json.py`** — request/response schema (`TranslatorConfig.translator`, `.target_lang`, `.gpt_config`) đã đủ tổng quát cho mọi engine, không cần field mới.

## 5. Popup UI — dropdown chọn engine

Thêm vào `popup.html`, giữa khối ngôn ngữ đích (Task 5 cũ) và `<hr>` cuối:

```html
<label for="translator-engine">Translator engine:</label>
<select id="translator-engine">
  <option value="chatgpt">ChatGPT (OpenAI)</option>
  <option value="gemini">Gemini (Google)</option>
  <option value="deepl">DeepL</option>
</select>
```

`popup.js` thêm khối tương ứng (đọc/ghi `chrome.storage.local` key `mot_translator_engine`, mặc định `'chatgpt'`), theo đúng pattern khối ngôn ngữ đích đã có:

```javascript
const DEFAULT_TRANSLATOR_ENGINE = 'chatgpt';
const engineSelect = document.getElementById('translator-engine');

chrome.storage.local.get('mot_translator_engine', (result) => {
  engineSelect.value = result.mot_translator_engine || DEFAULT_TRANSLATOR_ENGINE;
  updateLangWarning();
});

engineSelect.addEventListener('change', () => {
  chrome.storage.local.set({ mot_translator_engine: engineSelect.value });
  updateLangWarning();
});
```

Không kiểm tra "engine này đã có key chưa" trong popup (không thêm round-trip mạng/độ phức tạp) — chọn engine chưa cấu hình key sẽ lỗi rõ ràng từ backend khi dịch thử (xem mục 9).

## 6. `content.js` — dùng engine đã chọn

Thêm `getTranslatorEngine()` cạnh `getBackendUrl()`/`getTargetLang()` đã có (cùng pattern: đọc `chrome.storage.local` mỗi lần gọi, không cache vào biến cố định):

```javascript
const DEFAULT_TRANSLATOR_ENGINE = 'chatgpt';
async function getTranslatorEngine() {
  const result = await chrome.storage.local.get('mot_translator_engine');
  return result.mot_translator_engine || DEFAULT_TRANSLATOR_ENGINE;
}
```

Xóa `CFG.TRANSLATOR` cố định. Sửa `ApiAdapter.translateImage()`:

```javascript
async translateImage(blob) {
  const dataUrl = await this.blobToDataURL(blob);
  const targetLang = await getTargetLang();
  const engine = await getTranslatorEngine();
  const translatorConfig = {
    translator: engine,
    target_lang: targetLang,
  };
  // gpt_config (prompt La-tinh hoa ten rieng) chi co tac dung voi engine ho
  // GPT (chatgpt/gemini - ca 2 deu ke thua CommonGPTTranslator ben backend,
  // doc chung 1 co che prompt), KHONG co tac dung voi deepl (kien truc khac
  // han, khong doc gpt_config - xem spec muc 3).
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

**Cache key thêm engine** (giống lý do đã thêm `targetLang` — xem spec 2026-07-22 mục 8): đổi engine với cùng ảnh/cùng ngôn ngữ phải trả cache MISS, không được trả nhầm kết quả engine cũ.

```javascript
_key(hash, targetLang, engine) {
  return `mot_cache_v${CFG.CACHE_VERSION}_${engine}_${targetLang}_${hash}`;
},
async get(hash, targetLang, engine) { /* ... */ },
async set(hash, targetLang, engine, value) { /* ... */ },
```

`translateAndRenderImage()` gọi thêm `getTranslatorEngine()`, truyền vào cả `Cache.get`/`Cache.set`.

## 7. Cảnh báo prompt — hợp nhất theo cả ngôn ngữ lẫn engine

Cảnh báo hiện tại (spec 2026-07-22 mục 5b) chỉ dựa vào `targetLang !== 'VIN'`. Giờ cần dựa vào tổ hợp cả 2 dropdown, vì DeepL không bao giờ có prompt đặc biệt dù chọn tiếng Việt:

```javascript
function updateLangWarning() {
  const usesGptConfig = langSelect.value === 'VIN' && engineSelect.value !== 'deepl';
  langWarning.style.display = usesGptConfig ? 'none' : 'block';
}
```

Nội dung cảnh báo đổi cho tổng quát hơn: *"⚠️ Prompt La-tinh hoá tên riêng chỉ áp dụng cho ChatGPT/Gemini + tiếng Việt — tổ hợp hiện tại dùng prompt mặc định của backend."*

Cả 2 dropdown (ngôn ngữ, engine) đều gọi `updateLangWarning()` khi `change` VÀ trong callback đọc storage lúc mở popup (gọi 2 lần vô hại, không cần đợi nhau — mỗi lần gọi chỉ đọc lại giá trị hiện tại của cả 2 select).

## 8. Ngoài phạm vi (out of scope)

- **Engine dùng model offline** (`nllb`, `m2m100`, `qwen2`, `mbart50`, `sugoi`/`jparacrawl`): cơ chế tự tải model đã có sẵn trong backend (`huggingface_hub.snapshot_download()` hoặc tải zip từ GitHub releases), nhưng: (a) `sugoi`/`jparacrawl` chỉ dịch JP↔EN, không dùng được cho mục tiêu tiếng Việt của dự án; (b) các bản `_big` (m2m100 12B tham số, nllb 1.3B, qwen2 7B) gần như chắc chắn vượt giới hạn VRAM 4GB đã biết của dự án; (c) ngay cả bản nhỏ (nllb 600M, m2m100 418M, qwen2 1.5B) cũng CHƯA được test có tranh chấp VRAM với pipeline OCR+inpaint đang chạy hay không. Cần 1 đợt brainstorm/test riêng, bắt đầu bằng việc xác nhận thực tế 1 model nhỏ nhất có chạy được trong 4GB không, trước khi quyết định thêm vào popup.
- Các engine còn lại trong nhóm "cần API key riêng" (`deepseek`, `groq`, `papago`, `youdao`, `baidu`, `caiyun`, `custom_openai`) — để sau nếu có nhu cầu cụ thể.
- Ô nhập API key trong popup — giữ nguyên quyết định cũ (key luôn qua `.env`, server-side).

## 9. Xử lý lỗi

Chọn engine chưa cấu hình key (VD `gemini` khi chưa set `GEMINI_API_KEY`) → backend raise `MissingAPIKeyException` với message rõ ràng (VD `"Please set the GEMINI_API_KEY environment variable..."`) → đi qua cơ chế bọc lỗi chung đã có (`myqueue.py`: `error_msg = f"Translation failed: {str(e)}"`) → hiện trong error log của content-script như mọi lỗi dịch khác (không cần xử lý đặc biệt gì thêm — message backend đã đủ rõ để người dùng tự sửa `.env`).

## 10. Kiểm thử (thủ công — dự án không có test tự động cho phần này)

1. Chưa cấu hình `GEMINI_API_KEY`/`DEEPL_AUTH_KEY`: xác nhận hành vi cũ (chỉ `chatgpt`) không đổi.
2. Cấu hình đủ key thật, dịch thử cùng 1 ảnh bằng cả 3 engine — xác nhận cả 3 chạy được.
3. Chọn `deepl` + tiếng Việt — xác nhận dịch ra tiếng Việt đúng (xác nhận patch hoạt động).
4. Đổi engine trên cùng ảnh/cùng ngôn ngữ — xác nhận `Cache MISS` (không lẫn cache giữa engine).
5. Chọn engine chưa cấu hình key — xác nhận lỗi rõ ràng, không crash im lặng.
6. Cảnh báo hiện/ẩn đúng theo tổ hợp: (chatgpt hoặc gemini) + VIN → ẩn; mọi tổ hợp còn lại → hiện.

## 11. Cấu trúc file thay đổi

```
manga/
├── .env.example                              (sua - them 3 bien tuy chon)
├── run-backend.ps1                           (sua - truyen 3 bien tuy chon)
├── Dockerfile                                 (sua - them 1 dong COPY)
├── patches/
│   └── deepl.py                              (MOI - full override)
└── extension/
    ├── content-script/content.js             (sua - Cache key, getTranslatorEngine, gpt_config condition)
    └── popup/
        ├── popup.html                        (sua - them dropdown engine)
        └── popup.js                          (sua - them khoi doc/ghi engine, sua updateLangWarning)
```
