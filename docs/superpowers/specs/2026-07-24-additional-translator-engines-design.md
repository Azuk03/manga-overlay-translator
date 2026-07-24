# Thêm 5 translator engine còn lại (DeepSeek/Groq/Youdao/Baidu/Caiyun) — Design

## 1. Bối cảnh & mục tiêu

Spec `2026-07-23-translator-engine-picker-design.md` đã thêm Gemini + DeepL bên cạnh ChatGPT, nhưng còn lại 5 engine trong nhóm "cần API key riêng" (mục 12 spec `2026-07-22-extension-popup-settings-design.md`) chưa xử lý: `deepseek`, `groq`, `papago`, `youdao`, `baidu`, `caiyun`, `custom_openai`.

**Mục tiêu:** thêm `deepseek`, `groq`, `youdao`, `baidu`, `caiyun` (5/7) vào popup + backend, theo đúng pattern đã có từ đợt Gemini/DeepL. `papago` và `custom_openai` bị loại khỏi đợt này (xem mục 2).

Đây là bước CHUẨN BỊ cho việc re-scope installer (`setup.bat`) sang hỗ trợ nhiều engine hơn — installer re-scope sẽ là 1 spec/plan RIÊNG, làm SAU khi đợt này xong (xem mục 8).

## 2. Vì sao loại `papago` và `custom_openai`

**`papago` — loại vì dùng cách không chính thức.** Đọc trực tiếp source (`papago.py`): không dùng biến môi trường/API key nào cả — tự tính chữ ký HMAC giả lập request của trình duyệt để gọi thẳng `https://papago.naver.com/apis/n2mt/translate`, một endpoint nội bộ của trang dịch miễn phí Naver, KHÔNG PHẢI Papago Developer API chính thức (API đó cần đăng ký `NAVER_CLIENT_ID`/`SECRET` qua Naver Cloud Platform — khác hoàn toàn). Rủi ro thật: Naver đổi cấu trúc trang bất kỳ lúc nào sẽ làm gãy không báo trước, và đây là cách truy cập không được cho phép công khai — không phù hợp để đóng gói trong 1 sản phẩm định chia sẻ cho người khác dùng.

**`custom_openai` — hoãn vì yêu cầu tiền đề quá cao.** Dùng cho Ollama/model tự host tại máy (`CUSTOM_OPENAI_API_BASE` mặc định `http://localhost:11434/v1`) — người dùng phải tự cài Ollama + tự tải về đúng model trước khi dùng được, phức tạp hơn hẳn so với chỉ dán 1 API key như các engine khác. Không khớp mục tiêu "đơn giản cho người dùng không rành kỹ thuật" của đợt này — để lại làm riêng sau nếu có nhu cầu cụ thể (VD muốn dịch hoàn toàn offline, không cần internet/API trả phí).

## 3. 5 engine được chọn — key cần, hỗ trợ tiếng Việt (đã tra thật trong backend)

Tra trực tiếp `/app/manga_translator/translators/keys.py` và từng file translator trong container đang chạy:

| Engine | Biến `.env` cần | Kế thừa | Có sẵn `'VIN'`? |
|---|---|---|---|
| `deepseek` | `DEEPSEEK_API_KEY` (bắt buộc), `DEEPSEEK_API_BASE`/`DEEPSEEK_MODEL` (tùy chọn) | `CommonGPTTranslator` (họ GPT) | Không cần map — dùng prompt (LLM), giống chatgpt/gemini |
| `groq` | `GROQ_API_KEY` (bắt buộc), `GROQ_MODEL` (tùy chọn) | `CommonTranslator` (API dịch riêng) | Có sẵn `'VIN': 'Vietnamese'` |
| `youdao` | `YOUDAO_APP_KEY` + `YOUDAO_SECRET_KEY` (cả 2 bắt buộc) | `CommonTranslator` | Có sẵn `'VIN': 'vi'` |
| `baidu` | `BAIDU_APP_ID` + `BAIDU_SECRET_KEY` (cả 2 bắt buộc) | `CommonTranslator` | Có sẵn `'VIN': 'vie'` |
| `caiyun` | `CAIYUN_TOKEN` (bắt buộc) | `CommonTranslator` | Có sẵn `'VIN': 'vi'` |

**Không cần patch ngôn ngữ nào** (khác với DeepL trước đây) — cả 5 engine đã hỗ trợ tiếng Việt sẵn trong code gốc.

## 4. Phát hiện kiến trúc: điều kiện `gpt_config` phải đổi từ "loại trừ" sang "cho phép"

Điều kiện hiện tại trong `content.js` (`ApiAdapter.translateImage()`):
```javascript
if (targetLang === 'VIN' && engine !== 'deepl') {
  translatorConfig.gpt_config = CFG.GPT_CONFIG_PATH;
}
```

Đây là **danh sách loại trừ** (chỉ đúng khi 2/3 engine hiện có thuộc họ GPT). Với 5 engine mới, chỉ `deepseek` thuộc họ GPT (`CommonGPTTranslator`, giống chatgpt/gemini) — `groq`/`youdao`/`baidu`/`caiyun` đều là API dịch chuyên dụng riêng (`CommonTranslator`), không đọc `gpt_config` (gửi thừa không lỗi, nhưng vô nghĩa và làm code khó hiểu). Tiếp tục loại trừ từng cái một (`engine !== 'deepl' && engine !== 'groq' && ...`) sẽ càng rối khi thêm engine sau này.

**Đổi thành danh sách cho phép rõ ràng:**
```javascript
// Chi engine thuoc ho GPT (ke thua CommonGPTTranslator ben backend) moi doc
// duoc gpt_config - cac engine dich chuyen dung (groq/youdao/baidu/caiyun/
// deepl...) co kien truc rieng, khong dung field nay. Danh sach CHO PHEP
// (khong phai loai tru) de de mo rong dung khi them engine moi - xem spec
// 2026-07-24-additional-translator-engines-design.md muc 4.
const GPT_FAMILY_ENGINES = ['chatgpt', 'gemini', 'deepseek'];

// ...trong translateImage():
if (targetLang === 'VIN' && GPT_FAMILY_ENGINES.includes(engine)) {
  translatorConfig.gpt_config = CFG.GPT_CONFIG_PATH;
}
```

`deepseek` được thêm vào danh sách cho phép (kế thừa `CommonGPTTranslator` giống chatgpt/gemini, dùng chung cơ chế prompt).

Cảnh báo trong popup (`updateLangWarning()`) cũng phải đổi theo — hiện tại: `engineSelect.value !== 'deepl'`. `popup.js` và `content.js` là 2 file/ngữ cảnh tách biệt (không có build tool/import chung), nên `popup.js` cần khai báo RIÊNG một bản sao `GPT_FAMILY_ENGINES` giống hệt (cùng pattern đã có với `DEFAULT_BACKEND_URL`/`DEFAULT_TARGET_LANG` — mỗi context tự giữ 1 bản, không phải tham chiếu dùng chung), rồi đổi điều kiện thành `GPT_FAMILY_ENGINES.includes(engineSelect.value)`.

## 5. Thay đổi backend

`.env.example` thêm (tất cả tùy chọn, không set = không chọn được engine đó, chọn vào báo lỗi rõ ràng từ `MissingAPIKeyException` có sẵn):
```
# ============ Translator (DeepSeek) - TUY CHON ============
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-chat

# ============ Translator (Groq) - TUY CHON ============
GROQ_API_KEY=
GROQ_MODEL=mixtral-8x7b-32768

# ============ Translator (Youdao) - TUY CHON ============
YOUDAO_APP_KEY=
YOUDAO_SECRET_KEY=

# ============ Translator (Baidu) - TUY CHON ============
BAIDU_APP_ID=
BAIDU_SECRET_KEY=

# ============ Translator (Caiyun) - TUY CHON ============
CAIYUN_TOKEN=
```

`run-backend.ps1` thêm 7 khối `if ($vars.ContainsKey(...))` tương ứng (đúng pattern đã có với `OPENAI_MODEL`/`GEMINI_API_KEY`/...).

Không cần patch Python nào (`patches/`) — không engine nào trong 5 cái này thiếu hỗ trợ tiếng Việt.

## 6. Popup UI

Thêm 5 `<option>` vào dropdown `#translator-engine` đã có (giữ dạng phẳng, không dùng `<optgroup>` — 8 lựa chọn vẫn đủ ngắn để hiển thị tốt, không cần thêm UI phức tạp cho số lượng nhỏ như vậy):
```html
<option value="deepseek">DeepSeek</option>
<option value="groq">Groq</option>
<option value="youdao">Youdao (有道)</option>
<option value="baidu">Baidu (百度)</option>
<option value="caiyun">Caiyun (彩云小译)</option>
```

`popup.js` không cần thêm logic gì khác — dropdown vẫn ghi cùng 1 key `mot_translator_engine` như hiện tại, chỉ cần đổi điều kiện cảnh báo theo mục 4.

## 7. Không đổi Cache/dedup/xử lý lỗi

- Cache key đã tách theo `engine` từ đợt Gemini/DeepL (`mot_cache_v{N}_{engine}_{lang}_{hash}`) — tự động hoạt động đúng cho engine mới, không cần sửa gì.
- Lỗi thiếu key (VD chọn `youdao` khi chưa set `YOUDAO_APP_KEY`) đã có `MissingAPIKeyException` + cơ chế bọc lỗi chung (`myqueue.py`) từ trước — không cần xử lý riêng.
- `youdao`/`baidu` cần ĐỦ 2 biến mới hoạt động — nếu chỉ set 1 trong 2, backend vẫn báo lỗi rõ ràng (đã xác nhận qua code: cả 2 file đều check đủ cả 2 biến trước khi dùng).

## 8. Ngoài phạm vi (out of scope)

- `papago`, `custom_openai` — xem mục 2.
- **Re-scope installer (`setup.bat`) để hỗ trợ nhập/sửa key cho tất cả engine** — đây là 1 spec/plan RIÊNG, làm SAU khi đợt này xong. Thiết kế sơ bộ đã thống nhất (chưa viết spec chi tiết): installer giữ nguyên đơn giản (chỉ bắt buộc nhập `OPENAI_API_KEY` như hiện tại), tách riêng 1 "công cụ quản lý key" (script/shortcut chạy lại được bất kỳ lúc nào, không chỉ lúc cài đặt) cho phép thêm/sửa key của bất kỳ engine nào trong tổng số hiện có.

## 9. Kiểm thử (thủ công — dự án không có test tự động cho phần này)

1. Với mỗi engine trong 5 engine mới, cấu hình key thật vào `.env`, dịch thử 1 ảnh — xác nhận dịch ra tiếng Việt đúng.
2. Chọn `youdao` (hoặc `baidu`) nhưng chỉ set 1 trong 2 biến bắt buộc — xác nhận lỗi rõ ràng, không crash im lặng.
3. Xác nhận `gpt_config` chỉ gắn khi engine là `chatgpt`/`gemini`/`deepseek` VÀ ngôn ngữ là `VIN` — kiểm tra qua log backend (GPT Prompt có include glossary/system prompt riêng hay dùng mặc định).
4. Xác nhận cảnh báo trong popup hiện/ẩn đúng theo đúng 8 tổ hợp (engine × VIN-hay-không).
5. Đổi engine trên cùng ảnh/cùng ngôn ngữ — xác nhận `Cache MISS` (không lẫn cache giữa các engine mới với engine cũ).

## 10. Cấu trúc file thay đổi

```
manga/
├── .env.example                              (sua - them 5 khoi bien tuy chon)
├── run-backend.ps1                           (sua - truyen 7 bien tuy chon)
└── extension/
    ├── content-script/content.js             (sua - GPT_FAMILY_ENGINES thay cho dieu kien loai tru)
    └── popup/
        ├── popup.html                        (sua - them 5 option dropdown)
        └── popup.js                          (sua - dieu kien canh bao dung GPT_FAMILY_ENGINES)
```
