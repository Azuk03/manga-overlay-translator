# Thiết kế: Port userscript (Tampermonkey) sang Chrome/Edge Extension chuẩn (Manifest V3)

> Ngày: 2026-07-21. Trạng thái: đã thống nhất với người dùng qua brainstorming (bao gồm 1 spike thực nghiệm xác nhận giới hạn kỹ thuật), sẵn sàng chuyển sang viết implementation plan.

## 1. Bối cảnh & mục tiêu

Dự án hiện có `manga-overlay-translator.user.js` — 1 file Tampermonkey userscript duy nhất, dùng các API đặc quyền `GM_*` (xem `docs.md`) để: gọi backend cục bộ qua CORS, tự đặt header `Referer` khi tải ảnh (né chặn hotlink CDN), lưu cache qua `GM_setValue`/`GM_getValue`, và kích hoạt dịch qua menu Tampermonkey/hotkey.

Người dùng tìm thấy 1 dự án tham khảo cùng ý tưởng (`github.com/lehuyqq/Manga-Translator-Extension`) đóng gói dưới dạng Chrome Extension chuẩn thay vì userscript. Nghiên cứu cho thấy dự án đó **không** đăng lên Chrome Web Store — chỉ đóng gói `.zip` lên GitHub Releases, người dùng tự "Load unpacked". Quy mô của họ lớn hơn nhiều (tự viết backend FastAPI riêng, đóng gói Python runtime portable) — không phải điều cần rập khuôn.

**Mục tiêu:** chuyển đúng phần **frontend** (userscript) hiện tại sang 1 Chrome/Edge Extension chuẩn (Manifest V3), giữ nguyên **backend Docker/`manga-image-translator`** hiện có gần như không đổi (chỉ thêm 1 endpoint nhỏ, xem mục 5). Extension **thay thế hoàn toàn** userscript — không bảo trì song song 2 codebase.

**Ngoài phạm vi (không làm):**
- Đăng lên Chrome Web Store / Firefox Add-ons (chỉ phân phối qua GitHub Releases + "Load unpacked", giống dự án tham khảo).
- Hỗ trợ Firefox (chỉ Chrome/Edge/Cốc Cốc — nền Chromium).
- Thêm popup UI cấu hình (API key, chọn model dịch...) — vẫn sửa hằng số `CFG` trong code như hiện tại.
- Viết lại backend, đổi sang model dịch/inpaint khác, hay bất kỳ tính năng mới nào ngoài việc port 1-1.
- Dùng TypeScript/Vite hay bất kỳ bundler nào — giữ JS thuần, không bước build.
- Cập nhật lại `setup.bat`/`setup.ps1` (dự án đóng gói cài đặt, đang tạm dừng trên nhánh `worktree-feature+setup-installer`) — việc đó để 1 đợt riêng sau khi extension đã xong và ổn định.

## 2. Rủi ro kỹ thuật đã xác nhận bằng thực nghiệm

Đã build 1 extension thử nghiệm dùng `declarativeNetRequest` (`modifyHeaders`, operation `set` trên header `Referer`) và test thật trên Chrome (trang trung lập `example.com`, so sánh bật/tắt extension, gọi `fetch()` tới `httpbin.org/headers` để soi giá trị Referer thật sự được gửi đi). **Kết quả: hoàn toàn không có tác dụng** — Referer nhận được luôn là giá trị tự nhiên của trang, bất kể extension bật hay tắt.

**Kết luận:** Manifest V3 (extension chuẩn, không phải Tampermonkey) không có cách nào giả `Referer` tùy ý — đây là giới hạn nền tảng của trình duyệt, khớp với tài liệu Chromium (Referer bị coi là header nhạy cảm, không cho `declarativeNetRequest` sửa đáng tin cậy). Cách khắc phục: xem mục 5 (backend tự tải ảnh hộ).

**Đã kiểm chứng riêng: CORS khi background gọi backend cục bộ.** Giả định nền tảng của toàn bộ kiến trúc (mục 3) là background service worker, nhờ `host_permissions`, gọi được thẳng `http://127.0.0.1:5003` mà không bị CORS chặn — khác hẳn vụ Referer ở trên (2 cơ chế bảo mật độc lập của trình duyệt, không suy luận từ cái này ra cái kia được). Đã build 1 extension thử nghiệm khác (background service worker, `host_permissions: ["http://127.0.0.1:5003/*"]`), gọi `fetch('http://127.0.0.1:5003/openapi.json')` thật khi backend đang chạy. **Kết quả: thành công, HTTP 200, nhận đủ response** — xác nhận giả định đúng, không bị CORS chặn.

## 3. Kiến trúc tổng thể

```
extension/
├── manifest.json
├── icons/                    (16/32/48/128px — placeholder đơn giản)
├── background/
│   └── background.js         (service worker — lớp trung gian mạng duy nhất)
└── content-script/
    └── content.js            (gần như bê nguyên logic hiện tại của .user.js)
```

Không có bước build (`npm run build`) — 2 file JS thuần, tham chiếu thẳng trong `manifest.json`. Đóng gói bằng cách copy thư mục `extension/` thành `.zip`, không cần Node/npm.

**`manifest.json`** (Manifest V3):
- `permissions`: `storage`, `unlimitedStorage` (cache ảnh nền base64 có thể nặng).
- `host_permissions`: `["<all_urls>"]` — cần để `background.js` gọi được cả site truyện lẫn `http://127.0.0.1:5003`.
- `background.service_worker`: `background/background.js`, `type: module`.
- `content_scripts`: match `<all_urls>`, `run_at: document_idle` (tương đương `@run-at document-idle` hiện tại), file `content-script/content.js`.
- `action`: có icon trên toolbar, **không có** `default_popup` — bấm icon kích hoạt dịch trực tiếp (xem mục 4).

**Lý do tách content-script / background:** content-script chạy trong ngữ cảnh trang, các lệnh gọi mạng cross-origin từ đó vẫn bị ràng buộc CORS của chính trang — chỉ background service worker mới tận dụng được `host_permissions` để gọi thẳng ra ngoài (backend cục bộ, ảnh CDN). Đây là ràng buộc kỹ thuật thật của MV3, không phải lựa chọn tùy ý.

## 4. Kích hoạt dịch

Thay thế hoàn toàn `GM_registerMenuCommand`:
- Bấm icon extension trên toolbar (`chrome.action.onClicked`) → background gửi message cho content-script của tab đang active → tương đương bấm Alt+D trước đây.
- Giữ nguyên `Alt+D` (kích hoạt dịch) và `Alt+T` (bật/tắt overlay so sánh gốc/dịch) làm phím tắt trong `content-script.js`, y hệt logic `onKeyDown()` hiện tại (không cần `chrome.commands` API — vẫn là `document.addEventListener('keydown', ...)` bình thường trong content-script, không mất khả năng này).

## 5. Luồng dữ liệu khi dịch 1 ảnh

**5a. Tải ảnh gốc** (thay `ApiAdapter.downloadImageBlob()`):

1. Ảnh `blob:`/`data:` URL → **không đổi**: vẫn đọc pixel trực tiếp từ `<img>` đã hiển thị qua canvas (`imageElementToBlob()`), y hệt hiện tại — đây là trường hợp không thể relay qua backend (dữ liệu chỉ tồn tại tạm thời phía trình duyệt, không có trên mạng).
2. Ảnh `http(s)://` URL → content-script gửi message `{type: 'DOWNLOAD_IMAGE', url}` cho background.
   - Background `fetch()` thẳng URL đó (không có Referer đặc biệt — đủ cho đa số site).
   - Kiểm tra `Content-Type` trả về (tái dùng nguyên văn điều kiện đã có: `!contentType.startsWith('image/')` → coi là bị chặn hotlink).
   - Nếu bị chặn: background tự động gọi **endpoint relay mới ở backend** (mục 6) kèm `{url, referer}` — `referer` lấy từ `sender.tab.url` (Chrome tự cung cấp cho mọi listener `chrome.runtime.onMessage`, không cần content-script gửi kèm field riêng).
   - Trả bytes ảnh (thật) về content-script qua response của message.
3. Từ đây trở đi (hash, tra cache, `reencodeToPng()`...) — **không đổi gì** so với hiện tại.

**5b. Gọi backend dịch** (thay `ApiAdapter.translateImage()`):

- content-script gửi message `{type: 'TRANSLATE', body}` (body JSON y hệt hiện tại) cho background.
- Background `fetch()` `POST http://127.0.0.1:5003/translate/json/stream`, đợi nhận **trọn vẹn** response (không relay từng frame tiến độ qua message-passing — phần log tiến độ `onprogress`/`firstByteAt` trong `v0.39` chỉ là chẩn đoán tạm, đã hoàn thành nhiệm vụ theo changelog, không cần port).
- Background tự parse frame nhị phân (tái dùng nguyên logic `normalizeResponse()`, chuyển vào `background.js`), trả `{regions}` hoặc ném lỗi (message `{error: "..."}`) về content-script.
- content-script nhận kết quả, render overlay — **không đổi** so với hiện tại.

## 6. Thay đổi backend (nhỏ, tách biệt, không đụng pipeline dịch)

Thêm 1 endpoint mới, ví dụ `POST /fetch-image`, nhận `{url, referer}`:

- Dùng thư viện HTTP phía Python (không bị giới hạn "forbidden header" như trình duyệt) tải ảnh kèm header `Referer` đúng như trang gốc sẽ gửi.
- Trả về bytes ảnh thật (`Content-Type` đúng định dạng) cho background của extension.

**Lưu ý khác `to_json.py`/`gpt_config-vi.yaml`:** 2 patch đó ghi đè trọn vẹn 1 file đã được `server/main.py` import sẵn, nên chỉ cần `COPY` là đủ. Endpoint mới thì **không tồn tại sẵn** — cần patch thêm vào chính `server/main.py` (hoặc router nó import) để đăng ký route, chứ không thể chỉ thả 1 file rời rồi mong nó tự chạy. Vì vậy patch lần này là 1 file override `server/main.py` (dựa trên bản gốc hiện có + thêm route mới), theo đúng cách `to_json.py` đã ghi đè `/app/server/to_json.py`. Route mới hoàn toàn tách biệt, không đụng vào logic dịch/inpaint hiện có trong `main.py`.

## 7. Lưu trữ (Cache)

`GM_getValue`/`GM_setValue` → `chrome.storage.local` (bất đồng bộ, khác `GM_*` vốn đồng bộ — cần đổi `Cache.get()`/`Cache.set()` sang `async`/`await`, kéo theo vài chỗ gọi chúng cũng cần `await`). Giữ nguyên quy ước key `mot_cache_v${CFG.CACHE_VERSION}_${hash}` và toàn bộ cơ chế versioning hiện có.

## 8. Xử lý lỗi

Giữ nguyên triết lý hiện tại: lỗi từng ảnh gộp vào `errorLog`, hiện `alert()` tóm tắt khi bấm dịch lại lúc đang lỗi (`showErrorSummary()`). Riêng lỗi **message-passing** (vd background service worker bị trình duyệt tắt giữa chừng do nhàn rỗi, message không tới nơi) cần bọc thêm 1 lớp: kiểm tra `chrome.runtime.lastError` sau mỗi `sendMessage`, coi là lỗi ảnh đó (đẩy vào `errorLog` như lỗi mạng bình thường) thay vì để trang treo im lặng.

## 9. Số phận file cũ

`manga-overlay-translator.user.js` giữ nguyên trong repo (không xóa, giữ lịch sử/tham khảo) nhưng **ngừng cập nhật** kể từ khi extension hoạt động ổn định. `docs.md`/`README.md` cần cập nhật lại để trỏ người dùng mới tới extension thay vì Tampermonkey, **và hướng dẫn rõ phải tắt/gỡ script cũ trong Tampermonkey** khi chuyển qua — nếu để cả 2 cùng bật trên 1 trang, cả userscript lẫn extension sẽ tự tìm ảnh + dịch song song, tạo ra 2 lớp overlay chồng nhau/dịch trùng.

## 10. Rủi ro & đánh đổi đã biết

Các điểm dưới đây được cân nhắc trong lúc thiết kế nhưng **không sửa/không loại bỏ được** — chấp nhận là đánh đổi hoặc rủi ro đã biết, không phải thiếu sót cần vá:

**Đã kiểm chứng thật (mục 2):**
- Không giả được `Referer` (đã có phương án thay thế: relay qua backend).
- Gọi backend cục bộ từ background không bị CORS chặn.

**Giả định hợp lý nhưng chưa tự kiểm chứng bằng thực nghiệm** (nên xác nhận sớm ở bước đầu implementation, không phải chờ tới cuối):
- `chrome.runtime.sendMessage` (content-script → background) không bị CSP `connect-src` của trang chi phối — đây là hiểu biết chung về mô hình extension, nhưng chưa test thật như đã làm với Referer/CORS.

**Rủi ro không có cách khắc phục, chấp nhận như giới hạn:**
- Site chủ động dò tìm sự hiện diện của extension (hiếm, nhưng có thật ở 1 số site DRM nghiêm ngặt) có thể phản ứng bất lợi (ẩn nội dung, chặn) — tương tự tinh thần "giới hạn cố hữu" đã ghi ở site canvas tainted, nhưng là 1 rủi ro *mới phát sinh riêng cho việc là extension* (Tampermonkey tiêm ít "dấu vết" nhận diện được hơn).

**Đánh đổi hiệu suất (chấp nhận, không phải bug):**
- Mỗi lần tải ảnh + mỗi lần gọi dịch giờ tốn thêm 2 lượt message-passing (content-script ↔ background) so với gọi thẳng như hiện tại — với 1 ảnh đơn lẻ, chi phí thêm chỉ vài ms, không đáng kể.
- Service worker bị trình duyệt tắt khi rảnh (~30s không hoạt động) và phải khởi động lại khi có message mới — gây độ trễ nhỏ (thường dưới vài trăm ms) ở lượt dịch đầu tiên sau khi rảnh tay 1 lúc. Tampermonkey không có vòng đời kiểu này nên đây là hành vi mới, cần người dùng biết trước để không tưởng nhầm là lỗi.

**Trải nghiệm cài đặt (chấp nhận, giống dự án tham khảo):**
- Extension cài qua "Load unpacked" (chế độ Developer) có thể bị Chrome/Edge định kỳ hiện banner nhắc "tắt các extension chế độ Developer" — phiền hơn 1 chút so với Tampermonkey (không bị nhắc kiểu này). Đây là hành vi chuẩn của trình duyệt với mọi extension sideload, không phải lỗi của dự án.

## 11. Kiểm thử

Không có Playwright/test tự động cho phần này trong phạm vi lần port đầu (khác `run-backend.ps1`/lib PowerShell vốn có Pester) — xác minh bằng tay trên Chrome/Edge/Cốc Cốc thật, tối thiểu các kịch bản:
- 1 site bình thường (không cần Referer đặc biệt) — dịch được y hệt userscript cũ.
- 1 site từng cần Referer đặc biệt (hitomi.la, theo changelog v0.35) — xác nhận đường fallback relay qua backend hoạt động.
- Alt+D, Alt+T, bấm icon toolbar — đều kích hoạt/tắt đúng như mong đợi.
- F5 lại trang — cache hit đúng (không gọi lại backend cho ảnh đã dịch).
- Tắt Docker — lỗi thân thiện, không treo trang, không lỗi im lặng qua message-passing.
- 1 site có CSP nghiêm ngặt (vd 1 trang ngân hàng/Google) — xác nhận `chrome.runtime.sendMessage` từ content-script vẫn hoạt động, kiểm chứng giả định ở mục 10.

## 12. Cấu trúc file thêm vào repo

```
manga/
├── extension/
│   ├── manifest.json
│   ├── icons/
│   ├── background/background.js
│   └── content-script/content.js
├── patches/main.py                   # ghi đè server/main.py: thêm route /fetch-image (mục 6)
├── Dockerfile                         # thêm 1 dòng COPY cho file patch mới
└── (giữ nguyên) manga-overlay-translator.user.js, docs.md, README.md, ...
```
