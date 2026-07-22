# Thiết kế: Popup cấu hình cho extension (URL backend + ngôn ngữ đích + kích hoạt dịch)

> Ngày: 2026-07-22. Trạng thái: đã thống nhất với người dùng qua brainstorming, sẵn sàng chuyển sang viết implementation plan.

## 1. Bối cảnh & mục tiêu

Extension Manifest V3 (`extension/`, đã merge vào `main`) hiện không có popup UI — cấu hình (URL backend, v.v.) đang hard-code trong `content.js`/`background.js`, người dùng khác muốn đổi phải tự sửa code nguồn. Đây là 1 phần của mục tiêu lớn hơn "hoàn thiện extension để người dùng khác dùng được" — người dùng đã chọn ưu tiên thêm popup UI cấu hình trước, thay vì chỉ sửa installer hay dọn cosmetic.

**Khác biệt quan trọng với dự án tham khảo** (`github.com/lehuyqq/Manga-Translator-Extension`, đã tham khảo ở lần port trước): dự án đó có ô nhập API key trong popup vì backend của họ nhận key qua từng request HTTP. Backend của dự án này **không nhận API key qua HTTP** — key OpenAI nằm hẳn trong `.env` của container Docker, cấu hình 1 lần lúc cài đặt (`run-backend.ps1`/`setup.bat`). Vì vậy popup lần này **không có ô nhập API key**.

**Mục tiêu:** thêm popup cho phép:
1. Cấu hình URL backend (hiện hard-code `http://127.0.0.1:5003`).
2. Cấu hình ngôn ngữ đích (hiện hard-code `TARGET_LANG: 'VIN'`), chọn từ danh sách rút gọn (mục 5b).
3. Kích hoạt dịch trang đang xem (thay thế cơ chế "bấm icon = dịch ngay" cũ, vì thêm popup sẽ chiếm quyền click icon — xem mục 3).

**Ngoài phạm vi (không làm):**
- **Ô nhập API key.** Không chỉ vì backend không nhận key qua HTTP (lý do kỹ thuật ở trên) — mà vì popup này **không giải quyết được** vấn đề "người dùng ít rành kỹ thuật nhập key thế nào" dù có ô nhập hay không, một khi backend vẫn đọc key từ `.env` trên đĩa (browser extension không có quyền ghi file hệ thống). Vấn đề này đã có lời giải sẵn ở dự án `setup.bat`/`setup.ps1` (đang tạm dừng) — hộp thoại WinForms `Show-ApiKeyPrompt` đã tự ghi key vào `.env` giúp người dùng. Việc cần làm là **sửa lại bước cuối của installer đó để trỏ sang "Load unpacked" extension thay vì Tampermonkey**, không phải mở rộng popup này. Đã thống nhất: làm popup xong trước, quay lại sửa installer ở 1 đợt riêng sau.
- **Chọn translator engine** (`CFG.TRANSLATOR`, hiện cứng `'chatgpt'`) — backend hỗ trợ nhiều engine khác (Google, DeepL, Youdao, Baidu, model offline...) nhưng dự án chỉ test/dùng `chatgpt` (đi kèm prompt tuỳ chỉnh riêng), đổi engine ngoài phạm vi lần này.
- Bất kỳ hằng số CFG nào khác ngoài URL backend + ngôn ngữ đích (vd `INPAINTER`, `INPAINTING_SIZE`, các hằng số tinh chỉnh hiệu năng/render) — người dùng đã xác nhận chỉ cần 2 mục này.
- Hiển thị trạng thái backend online/offline tự động khi mở popup — thay vào đó dùng nút "Test kết nối" bấm thủ công (xem mục 5a).
- Build tool/TypeScript/framework — giữ JS thuần như phần extension đã có.
- Sửa `setup.bat`/`setup.ps1` (project đó đang tạm dừng, ngoài phạm vi lần này).

## 2. Phát hiện quan trọng lúc brainstorm: `CFG.API` trong `content.js` đã chết

Kiểm tra thực tế: `grep -n "CFG.API\b" extension/content-script/content.js` không có kết quả nào ngoài chính khai báo — trường này **không được dùng ở đâu cả**. Nơi duy nhất thực sự cầm URL backend là hằng số `BACKEND_API` trong `background.js` (dùng ở 2 chỗ: gọi `/fetch-image` và `/translate/json/stream`). Vì vậy chỉ cần sửa `background.js`; `content.js`'s `CFG.API` sẽ được xoá luôn (dọn dẹp, tránh gây nhầm "URL thật nằm ở đây").

## 3. Xung đột hành vi: `default_popup` chiếm quyền click icon

Đã xác nhận với người dùng: khai báo `action.default_popup` trong Manifest V3 khiến **bấm icon luôn mở popup**, `chrome.action.onClicked` (Task 5 cũ) **không bao giờ bắn nữa**. Người dùng chọn: thêm nút "Dịch trang này" trong popup thay thế, giữ nguyên `Alt+D` làm phím tắt dịch nhanh không cần mở popup.

**Hệ quả:** xoá hẳn `chrome.action.onClicked.addListener(...)` trong `background.js` (dead code sau khi có popup).

## 4. Lưu trữ & thời điểm áp dụng

- `chrome.storage.local`, 2 key:
  - `mot_backend_url` (chuỗi URL, không có dấu `/` ở cuối). Chưa từng lưu → coi như `http://127.0.0.1:5003`.
  - `mot_target_lang` (chuỗi mã ngôn ngữ, vd `'VIN'`). Chưa từng lưu → coi như `'VIN'` (giữ đúng hành vi mặc định hiện tại).
- **Áp dụng ngay lập tức**, không cache: cả `background.js` (URL) lẫn `content.js` (ngôn ngữ đích) đọc lại `chrome.storage.local` ở **mỗi lần gọi** (`getBackendUrl()`/`getTargetLang()` — hàm async nhỏ, không phải biến/hằng số cố định đọc 1 lần lúc nạp file như hiện tại), đảm bảo đổi cấu hình trong popup có tác dụng ngay từ lần dịch tiếp theo.

## 5a. `popup.html`/`popup.js` — 3 khối chức năng

```
extension/popup/
├── popup.html   (form + <style> nội tuyến, không tách file CSS riêng)
└── popup.js
```

**Khối 1 — Dịch trang này** (trên cùng):
- 1 nút bấm → `chrome.tabs.query({active: true, currentWindow: true})` lấy tab đang active → `chrome.tabs.sendMessage(tab.id, {type: 'TRIGGER_TRANSLATE'})`.
- Đây **đúng loại message `content.js` đã lắng nghe sẵn từ Task 10** (`chrome.runtime.onMessage` check `message.type === 'TRIGGER_TRANSLATE'` gọi `onTriggerTranslate()`) — **không cần sửa `content.js`** cho khối này, chỉ cần popup gửi đúng message.
- Bắt `chrome.runtime.lastError` sau `sendMessage` — nếu lỗi (vd trang `chrome://`, `content.js` chưa nạp), hiện dòng chữ thân thiện trong popup (vd "Không dịch được trang này") thay vì im lặng.

**Khối 2 — URL backend:**
- 1 ô nhập text, điền sẵn giá trị đã lưu trong `chrome.storage.local` (hoặc mặc định `http://127.0.0.1:5003` nếu chưa lưu) khi popup mở ra.
- 1 nút **"Lưu"** → ghi giá trị ô nhập vào `chrome.storage.local` key `mot_backend_url`. Không validate định dạng URL phức tạp — chỉ cần không rỗng.

**Khối 3 — Test kết nối:**
- 1 nút **"Test kết nối"** riêng biệt (không tự động chạy khi mở popup, đúng như người dùng đã chọn).
- `popup.js` tự `fetch(<giá trị đang gõ trong ô nhập, CHƯA CẦN bấm Lưu>/openapi.json)` trực tiếp — popup là 1 trang extension có cùng đặc quyền `host_permissions` như background service worker, không bị CORS chặn, không cần đi vòng qua message-passing cho việc test này.
- **Giới hạn thời gian chờ 5 giây** (dùng `AbortController` + `setTimeout`, cùng kiểu mẫu `background.js`'s `translate()` đã dùng với `CFG.TIMEOUT_MS`) — tránh nút bị treo vô thời hạn nếu URL sai/không có gì phản hồi (khác hẳn timeout dài 90s của việc dịch thật, vì đây chỉ là kiểm tra kết nối nhanh).
- Hiện kết quả ngay dưới nút: "✅ Kết nối OK" (HTTP 200) hoặc "❌ Không kết nối được: <lý do ngắn>" (network error, HTTP lỗi, hoặc timeout).

## 5b. `popup.html`/`popup.js` — chọn ngôn ngữ đích

1 dropdown (`<select>`), điền sẵn giá trị đã lưu (hoặc mặc định `VIN` nếu chưa lưu). Danh sách rút gọn (không phải đủ 24 ngôn ngữ backend hỗ trợ — xem mã nguồn `manga_translator/translators/__init__.py`'s `LANGDETECT_MAP` để đối chiếu nếu cần mở rộng sau này):

| Hiện trong dropdown | Mã gửi backend |
|---|---|
| Tiếng Việt | `VIN` |
| English | `ENG` |
| 中文简体 (Chinese Simplified) | `CHS` |
| 中文繁體 (Chinese Traditional) | `CHT` |
| 日本語 (Japanese) | `JPN` |
| 한국어 (Korean) | `KOR` |

Chọn xong tự lưu ngay vào `chrome.storage.local` key `mot_target_lang` (không cần nút Lưu riêng — khác khối URL backend vì dropdown không có rủi ro gõ sai/rỗng như ô nhập text tự do).

**Cảnh báo hiển thị ngay dưới dropdown khi chọn khác `Tiếng Việt`:** dòng chữ nhỏ "⚠️ Prompt La-tinh hoá tên riêng hiện chỉ tối ưu cho tiếng Việt — ngôn ngữ khác dùng prompt mặc định của backend, có thể dịch chưa tối ưu." (xem mục 8 lý do kỹ thuật).

## 6. Thay đổi `background.js`

- Xoá `const BACKEND_API = 'http://127.0.0.1:5003';`, thay bằng:
  ```javascript
  const DEFAULT_BACKEND_URL = 'http://127.0.0.1:5003';
  async function getBackendUrl() {
    const result = await chrome.storage.local.get('mot_backend_url');
    return result.mot_backend_url || DEFAULT_BACKEND_URL;
  }
  ```
- Ở 2 chỗ đang dùng `BACKEND_API` (hàm `downloadImage()` gọi `/fetch-image`, hàm `translate()` gọi `/translate/json/stream`): thay `${BACKEND_API}/...` bằng `${await getBackendUrl()}/...`.
- Xoá `chrome.action.onClicked.addListener(...)` (mục 3).

## 7. `manifest.json`

Thêm:
```json
"action": {
  "default_popup": "popup/popup.html",
  "default_icon": { "16": "icons/icon16.png", "32": "icons/icon32.png" },
  "default_title": "Dich trang nay (Alt+D)"
}
```
(giữ nguyên `default_icon`/`default_title` đã có, chỉ thêm `default_popup`).

## 8. `content.js`

**Xoá field `API`** trong `CFG` (và comment giải thích đi kèm) — dead code sau khi URL backend chuyển hẳn sang `background.js` đọc từ storage (mục 2).

**Thêm `getTargetLang()`** (helper async nhỏ, tương tự `background.js`'s `getBackendUrl()`):
```javascript
const DEFAULT_TARGET_LANG = 'VIN';
async function getTargetLang() {
  const result = await chrome.storage.local.get('mot_target_lang');
  return result.mot_target_lang || DEFAULT_TARGET_LANG;
}
```

**Sửa `ApiAdapter.translateImage()`** — hiện đang xây `config.translator` dùng thẳng `CFG.TARGET_LANG`/`CFG.GPT_CONFIG_PATH` cố định; đổi thành đọc `targetLang` động, và **chỉ gửi `gpt_config` khi `targetLang === 'VIN'`** (đã thống nhất mục 5b — tránh prompt La-tinh hoá tiếng Việt lẫn vào bản dịch ngôn ngữ khác):
```javascript
const targetLang = await getTargetLang();
const translatorConfig = {
  translator: CFG.TRANSLATOR,
  target_lang: targetLang,
};
if (targetLang === 'VIN') {
  translatorConfig.gpt_config = CFG.GPT_CONFIG_PATH;
}
// dung translatorConfig thay cho object translator cu trong body gui di
```

**Sửa cache key (`Cache._key`) — phát hiện quan trọng lúc brainstorm:** cache hiện tại (`mot_cache_v${CFG.CACHE_VERSION}_${hash}`) chỉ tính theo **bytes ảnh gốc** (`Cache.hashBlob(blob)`), không tính theo ngôn ngữ đích. Vì ngôn ngữ đích giờ đổi được ngay trong lúc dùng (không cần sửa code/rebuild như trước — lúc đó đổi `CFG.TARGET_LANG` bắt buộc đi kèm bump `CACHE_VERSION` thủ công), nếu không sửa key cache: dịch 1 ảnh ra tiếng Việt (cache lại), đổi ngôn ngữ đích sang tiếng Anh, dịch lại đúng ảnh đó → nhận nhầm **kết quả tiếng Việt cũ** từ cache thay vì gọi lại backend. Sửa: thêm `targetLang` vào key:
```javascript
_key(hash, targetLang) {
  return `mot_cache_v${CFG.CACHE_VERSION}_${targetLang}_${hash}`;
}
```
Kéo theo: `Cache.get(hash, targetLang)`/`Cache.set(hash, targetLang, value)` cần thêm tham số `targetLang`, và nơi gọi (`translateAndRenderImage` trong Task 9) cần lấy `targetLang` (gọi `getTargetLang()` 1 lần, dùng lại cho cả việc build cache key lẫn build request dịch) truyền vào đúng 2 chỗ gọi `Cache.get`/`Cache.set`.

Không đổi gì khác trong `content.js` — `TRIGGER_TRANSLATE` đã được xử lý sẵn từ Task 10.

## 9. Xử lý lỗi

- `chrome.storage.local.get`/`.set` trong `background.js`/`popup.js`: đây là API bất đồng bộ nhưng gần như không bao giờ thất bại trong thực tế (khác network) — không cần try/catch phức tạp, nhưng vẫn dùng `await` đúng chuẩn `async`.
- Nút "Dịch trang này" và nút "Test kết nối" đều phải hiện thông báo lỗi rõ ràng trong popup thay vì throw không bắt được (popup không có Console dễ thấy như trang thật, lỗi im lặng sẽ rất khó debug cho người dùng cuối).

## 10. Kiểm thử

Không có Playwright/pytest cho phần này (khớp quyết định đã có từ lần port trước) — xác minh bằng tay trên Chrome/Edge thật:
- Mở popup lần đầu (chưa lưu gì) → ô URL hiện đúng giá trị mặc định `http://127.0.0.1:5003`.
- Đổi URL, bấm "Test kết nối" với backend đang chạy đúng URL đó → hiện ✅.
- Đổi URL sai (vd sai port), bấm "Test kết nối" → hiện ❌.
- Bấm "Lưu", đóng mở lại popup → ô URL vẫn giữ giá trị đã lưu (xác nhận `chrome.storage.local` hoạt động đúng).
- Đổi URL backend, dịch thử ngay (không reload extension) → xác nhận request đi đúng URL mới (kiểm tra qua Console service worker hoặc qua việc dịch thành công/thất bại tương ứng).
- Bấm "Dịch trang này" trên 1 trang manga thật → hoạt động y hệt bấm icon cũ trước đây.
- Bấm "Dịch trang này" trên 1 trang `chrome://extensions/` → hiện thông báo lỗi thân thiện, không im lặng.
- Bấm icon extension trên toolbar → xác nhận mở popup (không còn dịch ngay như trước).
- `Alt+D` vẫn hoạt động bình thường, không cần mở popup.
- Mở popup lần đầu → dropdown ngôn ngữ hiện đúng "Tiếng Việt" (mặc định).
- Đổi dropdown sang "English" → thấy dòng cảnh báo "⚠️ Prompt La-tinh hoá..." hiện ra; đổi lại "Tiếng Việt" → cảnh báo biến mất.
- Dịch 1 ảnh với "Tiếng Việt" (chờ ra kết quả, xác nhận cache), đổi dropdown sang "English", dịch lại **đúng ảnh đó** → xác nhận backend được gọi lại thật (không phải "Cache HIT" trả nhầm bản tiếng Việt cũ), và request gửi đi (xem Console service worker/network) không có field `gpt_config`.
- Dịch lại đúng ảnh đó lần 2 với "English" → lần này mới đúng là "Cache HIT" (cache theo ngôn ngữ đã hoạt động đúng).

## 11. Cấu trúc file thay đổi

```
manga/extension/
├── manifest.json              # + action.default_popup
├── background/background.js   # BACKEND_API -> getBackendUrl(), xoá onClicked
├── content-script/content.js  # xoá CFG.API; them getTargetLang(); sua
│                               # translateImage() + Cache._key/get/set them
│                               # tham so targetLang
└── popup/
    ├── popup.html              # MOI - URL backend, dropdown ngon ngu, nut dich/test
    └── popup.js                # MOI
```
