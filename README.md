# Manga Overlay Translator — Backend (Giai đoạn A + B)

Backend tự host `manga-image-translator`, đã dò schema thật + vá 1 bug, sẵn sàng cho Giai đoạn C (viết userscript).

## Cài đặt (khuyến nghị: Extension)

1. Mở `chrome://extensions/` (hoặc `edge://extensions/`), bật **Developer mode**.
2. Bấm **Load unpacked**, chọn thư mục `extension/` trong repo này.
3. Bấm icon extension trên toolbar (hoặc Alt+D) để bắt đầu dịch trang đang xem, Alt+T để bật/tắt so sánh gốc/dịch.

**Nếu trước đây đã cài `manga-overlay-translator.user.js` qua Tampermonkey: tắt hoặc gỡ script đó đi** trước khi dùng extension — để cả 2 cùng bật trên 1 trang sẽ khiến cả userscript lẫn extension tự tìm ảnh và dịch song song, tạo ra 2 lớp overlay chồng nhau/dịch trùng.

### Cài đặt cũ qua Tampermonkey (không còn khuyến nghị, giữ lại tham khảo)

File `manga-overlay-translator.user.js` vẫn khả dụng để tham khảo, nhưng **không còn được khuyến nghị**. Để sử dụng nó (không khuyến khích):
1. Cài đặt extension [Tampermonkey](https://www.tampermonkey.net/)
2. Tạo script mới, dán nội dung của `manga-overlay-translator.user.js`
3. Lưu và kích hoạt

Ưu điểm userscript cũ: không cần developer mode. Nhược điểm: không còn được bảo trì, extension mới là phiên bản chính thức.

## Chạy backend

1. Copy `.env.example` → `.env`, điền `OPENAI_API_KEY`
2. Build image đã vá (chỉ cần 1 lần, hoặc khi cần rebuild):
   ```powershell
   docker build -t manga-translator-patched:local .
   ```
3. Chạy: `.\run-backend.ps1`
4. Kiểm tra: `http://127.0.0.1:5003/docs`

## Port thật

README gốc của `manga-image-translator` mâu thuẫn giữa 5003/8000/8001. Đã xác nhận thực nghiệm:

- **REST API + Web UI: port `5003`** (chạy `server/main.py --start-instance --port=5003`)
- Port 8000/8001: không mở gì trong cấu hình này (README chỉ áp dụng nếu chạy Web Mode/API Mode tách riêng)
- Port 5004: worker nội bộ (`shared` mode), giao tiếp qua `--nonce`, không cần expose

## Bug đã tìm ra + vá

### 1. `/translate/json` (không stream) → crash 500

FastAPI serialize trực tiếp response object, không áp dụng đúng custom JSON encoder cho field `background` (kiểu `numpy.ndarray`) → lỗi `'utf-8' codec can't decode byte 0x80...`.

**Cách né:** dùng `/translate/json/stream` thay vì `/translate/json`. Endpoint stream dùng `transform_to_json()` (gọi `.model_dump_json()` đúng cách), không dính bug này.

### 2. Bản dịch không xuất hiện trong JSON response

`to_translation()` (trong `server/to_json.py`) đọc từ `ctx.translations` (dict luôn rỗng/không tồn tại trong pipeline hiện tại) thay vì `text_region.translation` (nơi bản dịch thật sự được lưu, dùng bởi renderer). Kết quả: JSON chỉ có chữ gốc, không có chữ dịch — dù ảnh render ra vẫn đúng.

**Đã vá:** `patches/to_json.py` — đọc đúng `text_region.translation`, xuất `text.src` (gốc) + `text.dst` (dịch). Đóng gói vào image riêng `manga-translator-patched:local` qua `Dockerfile` (không đụng vào image gốc, không mất khi container bị tạo lại).

> Nếu `zyddnys/manga-image-translator:main` có bản cập nhật vá bug này, kiểm tra lại xem còn cần patch không trước khi rebuild.

## Endpoint dùng cho `ApiAdapter`

**`POST /translate/json/stream`** — request body giống `/translate/json` (xem `fixtures/openapi.json` → `TranslateRequest`), nhưng response là **binary stream**, không phải JSON thuần:

```
Mỗi frame: [1 byte status][4 byte length, big-endian][N byte payload]
status: 0 = kết quả cuối (payload = JSON UTF-8)  |  2 = lỗi (payload = text lỗi)
        1 = tiến độ (payload = tên bước, vd "detection", "translating"...)
        3 = vị trí hàng đợi  |  4 = chờ instance
Dừng đọc khi gặp status 0 hoặc 2.
```

Đọc toàn bộ response bằng `responseType: 'arraybuffer'` (GM_xmlhttpRequest), parse frame tuần tự, lấy payload của frame status=0, `JSON.parse()`.

## Schema response (đã xác nhận thật, sau khi vá)

```jsonc
{
  "translations": [
    {
      "minX": 459, "minY": 44, "maxX": 474, "maxY": 306,  // px tuyệt đối, KHÔNG chuẩn hóa, KHÔNG polygon
      "text": {
        "src": "現代では「古事記」を「こじき」と読むのか",  // chữ gốc — SAU KHI VÁ
        "dst": "Ngày nay, \"Cổ Sự Ký\" được đọc là..."       // chữ dịch — SAU KHI VÁ
      },
      "is_bulleted_list": false,
      "angle": 0.0,
      "prob": 0.956,
      "text_color": {"fg": [4,5,3], "bg": [4,5,3]},
      "background": "data:image/png;base64,..."  // luôn có kể cả khi inpainter=none — KHÔNG CẦN DÙNG
    }
  ],
  "debug_folder": "1784193500344-41242c07-2048-VIN-chatgpt"
}
```

**Không có field `vertical`** — bỏ hẳn khỏi thiết kế `ApiAdapter` (đúng như dự phòng trong spec).

## Config dùng cho request (đã test, hoạt động đúng — bản C2 trở đi)

```json
{
  "translator": {
    "translator": "chatgpt",
    "target_lang": "VIN",
    "gpt_config": "/app/gpt_config-vi.yaml"
  },
  "render": { "renderer": "none" },
  "inpainter": { "inpainter": "lama_mpe", "inpainting_size": 1024 }
}
```

Các field khác giữ mặc định (xem `fixtures/openapi.json` → `TranslateRequest.config.default` để biết toàn bộ giá trị mặc định thật).

**Lưu ý:** enum `translator` thật sự **có cả `gemini`** (không chỉ `chatgpt` như spec suy đoán ban đầu) — xem `fixtures/openapi.json` → `components.schemas.Translator.enum`.

**`translator: "none"` — detect-only, không tốn GPT (xác nhận 2026-08-13).** Đặt `translator.translator = "none"` chạy đúng detect + OCR rồi dừng: response vẫn có đầy đủ `minX/minY/maxX/maxY` + `text.src` (chữ gốc OCR), nhưng `text.dst` rỗng và **không có lượt gọi GPT/OpenAI nào** (không tốn tiền, không tốn thời gian chờ API ngoài — chỉ model local). Trước đây có ghi chú sai là "translator:none trả translations rỗng" — không đúng với build hiện tại, đã kiểm chứng lại bằng request thật. Dùng cho gate "detect-first" của tính năng ghép biên webtoon (xem `docs.md` mục 5.7): probe rẻ trước, chỉ trả tiền dịch thật khi thực sự cần.

### `gpt_config` — chỉnh prompt dịch (La-tinh hóa tên riêng/thuật ngữ)

Field `gpt_config` **chỉ nhận đường dẫn file YAML có sẵn trên server** (`OmegaConf.load(self.gpt_config)`), **không nhận nội dung YAML trực tiếp** qua API — gửi thẳng nội dung sẽ lỗi `[Errno 36] File name too long` vì code cố `open()` chuỗi đó như 1 filename.

**Cách làm đúng:** đóng gói file YAML tùy chỉnh vào image đã vá (`patches/gpt_config-vi.yaml`, copy vào `/app/gpt_config-vi.yaml` qua `Dockerfile`), rồi truyền path đó trong request. Nội dung hiện tại yêu cầu model dịch/La-tinh hóa tên riêng và thuật ngữ trong ngoặc kép thay vì giữ nguyên chữ Nhật — đã test hoạt động (`やまとことは` → `Yamatokotoba`, `本居宣長` → `Motonori Norinaga`...).

Muốn đổi giọng dịch/quy tắc khác: sửa `patches/gpt_config-vi.yaml` → build lại image (`docker build -t manga-translator-patched:local .`) → restart container.

### Bug #4 — `chat_system_template` tùy chỉnh làm hỏng việc tách kết quả dịch (đã vá)

`chat_system_template` tùy chỉnh **thay thế hoàn toàn** `_CHAT_SYSTEM_TEMPLATE` mặc định trong `manga_translator/translators/config_gpt.py`. Prompt mặc định có 1 dòng bắt buộc: *"Output each segment with its prefix (`<|number|>` format exactly)"* — vì backend ghép nhiều dòng OCR vào 1 request kiểu `<|1|>dòng một\n<|2|>dòng hai` (`CommonGPTTranslator._assemble_prompts` trong `common_gpt.py`) rồi dùng regex `<\|\d+\|>` để tách lại từng dòng dịch từ câu trả lời GPT.

Bản `gpt_config-vi.yaml` đầu tiên bỏ sót dòng chỉ dẫn này → GPT trả lời tự nhiên không có marker → parser báo `Found indices count (0) does not match expected count (N)` → dịch thất bại, bị lọc bỏ (rỗng hoặc giữ nguyên tiếng Nhật). Vì `target_lang=VIN` không khớp `chat_sample` (few-shot ví dụ) có sẵn của backend (chỉ có tiếng Trung/Anh/Hàn) nên GPT **không có ví dụ minh họa nào** để tự suy ra định dạng — càng dễ xảy ra lỗi này.

**Đã vá:** thêm lại chỉ dẫn giữ nguyên marker `<|N|>` + 1 ví dụ input/output cụ thể ngay trong prompt tùy chỉnh. **Cần rebuild image + restart container** để áp dụng (đây là thay đổi phía backend, không phải userscript) — và bump `CACHE_VERSION` trong `CFG` (userscript) vì các kết quả dịch rỗng/sai đã bị cache lại.

### Bug #5 — landmine tự gây ra (2026-08-13): nội dung tiêm động vào prompt phải brace-escape

Tính năng ngữ cảnh nhân vật/hội thoại (mục "Endpoint mở rộng" bên dưới) tiêm nội dung ĐỘNG (hồ sơ nhân vật do GPT tự sinh, cửa sổ hội thoại gần nhất lấy trực tiếp từ text OCR thật) vào `chat_system_template` của file `gpt_config` riêng từng truyện. Backend chạy `chat_system_template` qua Python `str.format(to_lang=...)` — bất kỳ ký tự `{` hoặc `}` literal nào lọt vào nội dung tiêm (rất dễ xảy ra: tên nhân vật/lời thoại thật đôi khi chứa ngoặc nhọn) sẽ ném `KeyError`/`ValueError` ngay khi backend nạp file. Vì khối lỗi được **lưu lại** vào file yaml riêng của truyện đó, nó **brick mọi lượt dịch tiếp theo của đúng truyện đó** cho tới khi bị ghi đè bởi 1 lượt cập nhật hồ sơ/hội thoại mới — tái hiện được thật trong container (không phải giả thuyết).

**Đã vá:** `patches/main.py` hàm `_write_series_gpt_config` chạy `_esc_braces()` (`s.replace("{","{{").replace("}","}}")`) lên nội dung tiêm động **TRƯỚC KHI** ghép vào template — áp dụng đúng cho phần tiêm, **không bao giờ** áp dụng cho `{to_lang}` thật của chính template (nếu escape luôn cả `{to_lang}`, `str.format` sẽ không thay thế được nó nữa). Bài học cho bất kỳ code tiêm nội dung động vào prompt sau này: **luôn brace-escape nội dung tiêm trước khi ghép**, không escape phần khung template.

### `inpainter` — xóa chữ gốc thật (không chỉ che bằng màu)

Bật `inpainter` để backend **thực sự xóa chữ** bằng AI thay vì chỉ trả bbox. Kết quả: field `background` trong response giờ là ảnh đã xóa chữ (không phải ảnh gốc/placeholder), dùng làm `background-image` cho overlay thay vì tự sample 1 màu phẳng.

**So sánh `lama_mpe` vs `lama_large`:** dựng montage 13 vùng cạnh nhau từ response backend thô — `lama_large` có vẻ xóa sạch hơn ở vài vùng. Nhưng **khi test thực tế qua userscript (render trên trang), không thấy khác biệt rõ rệt** — đã quay lại `lama_mpe` theo xác nhận trực tiếp của người dùng. Bài học: so sánh ảnh JSON thô ở backend không thay thế được việc xem kết quả render thật trên trang.

Vùng chữ chồng lên chi tiết tranh vẽ (bài toán mơ hồ ngay từ đầu — model không phân biệt được đâu là chữ, đâu là nét vẽ) thì **cả 2 model đều không xử lý được** — giới hạn cố hữu của model, không sửa được bằng code backend.

**Xử lý phía userscript (v0.29):** thay vì cố sửa chất lượng inpaint (ngoài khả năng), `computeRegionComplexity()` đo độ lệch chuẩn độ sáng trong bbox **ảnh gốc** (trước inpaint) để đoán vùng nào "khó" (nhiều màu/chi tiết, ví dụ webtoon màu — tóc, gradient) — vùng vượt ngưỡng `CFG.BUSY_STD_THRESHOLD` thì **bỏ hẳn lớp nền inpaint**, chỉ còn chữ dịch viền trắng dày đè trực tiếp lên tranh gốc. Tránh được vệt mờ xấu, đánh đổi là chữ gốc có thể còn lộ mờ phía sau ở vùng đó. Xem chi tiết ở `docs.md` mục "OverlayRenderer".

**Đã test VRAM:** `lama_mpe` ~3.4GB/4GB, `lama_large` ~3.7GB/4GB — cả hai test với ảnh nhỏ (541×801). Ảnh manga thật lớn hơn nhiều (thường 1000-3000px chiều cao) **có rủi ro OOM cao hơn đáng kể**. Nếu OOM:
1. Giảm `inpainting_size` trước (1024 → 768 → 512)
2. Đang dùng `lama_mpe` (nhẹ hơn, an toàn VRAM hơn) — không cần đổi thêm
3. Bỏ `--models-ttl 0` trong `run-backend.ps1` để giải phóng VRAM giữa các lần dịch (đổi lại chậm hơn vì phải load lại model)

## Endpoint mở rộng riêng của bản patch (không có ở backend gốc)

Tất cả 4 endpoint dưới đây nằm trong `patches/main.py` (full-override `server/main.py`, không phải patch từng dòng).

### `POST /fetch-image` — relay tải ảnh kèm `Referer` đúng

Extension MV3 (`background.js`) **không tự đặt được header `Referer`** khi `fetch()` (khác `GM_xmlhttpRequest` cũ của userscript, vốn có đặc quyền đặt header này). Một số CDN ảnh chặn hotlink khi thiếu `Referer` hợp lệ. `background.js` fetch thẳng trước; nếu HTTP lỗi hoặc Content-Type không phải ảnh, relay request này sang backend kèm `{url, referer}` — backend dùng client HTTP Python thật (không giới hạn header) tải kèm `Referer` đúng rồi trả lại bytes ảnh.

### `POST /build-series-context` — dựng hồ sơ nhân vật 1 lần/truyện

Body: `{series_id, text, target_lang}` (`text` = text gốc OCR gom từ vài trang đầu). Gọi GPT 1 lần để tự sinh 1 đoạn hồ sơ ngắn (tên, giới tính, tuổi/vai vế, quan hệ, đại từ tiếng Việt tương ứng), ghi thành 1 file `gpt_config` riêng cho `series_id` (dựa trên `gpt_config-vi.yaml` gốc + thêm khối "CHARACTER CONTEXT"), trả về `{sheet, gpt_config_path}`. Dùng cho tính năng ngữ cảnh dịch xuyên-trang (`docs.md` mục 5.9).

### `POST /set-series-context` / `POST /set-recent-dialogue` — cập nhật độc lập 2 khối của file riêng đó

`_write_series_gpt_config(series_id, sheet=None, recent=None)` giữ **2 khối độc lập, cập nhật riêng biệt** trong cùng 1 file `gpt_config` per-truyện: khối "CHARACTER CONTEXT" (hồ sơ nhân vật tĩnh, cập nhật qua `/set-series-context`, thường chỉ 1 lần) và khối "RECENT DIALOGUE" (cửa sổ hội thoại gần nhất, cập nhật qua `/set-recent-dialogue` sau MỖI trang). Gọi 1 trong 2 endpoint chỉ ghi đè đúng khối tương ứng, khối còn lại giữ nguyên (đọc lại từ file cũ trước khi ghi). Cả 2 đều trả `{gpt_config_path}`. Nội dung tiêm vào cả 2 khối đều đi qua `_esc_braces()` (xem Bug #5 ở trên) trước khi ghi.

## Concurrency

Đã test gửi 2 request đồng thời cùng lúc → **backend xử lý tuần tự** (request 2 đợi request 1 gần xong mới bắt đầu detection). Xác nhận: `CONCURRENCY: 1` là lựa chọn đúng, tăng lên không có lợi ích với setup 1 instance này.

## Tối ưu relay giữa 2 tiến trình (2026-08-09) — gap ~14s → <0.1s

**Triệu chứng:** trên ảnh thật, sau khi log backend đã báo `Running rendering` (dịch + inpaint xong), overlay mãi ~10–14s sau mới hiện trên UI, dù GPT chỉ ~2s và client vẽ ~15ms.

**Nguyên nhân gốc (đo bằng instrument + curl, KHÔNG concurrency):** kiến trúc 2 tiến trình — executor (`manga_translator shared`, cổng 5004) chạy pipeline rồi `pickle.dumps(ctx)` **toàn bộ `Context` ~108.5MB** (mọi ảnh trung gian full-res) truyền HTTP sang server (cổng 5003); server mới chạy `to_translation` + `model_dump_json`. Client chỉ cần **~108KB JSON** cuối. Riêng khối 108.5MB đó tốn ~11–14s để truyền + `pickle.loads`, bị khuếch đại bởi vòng lặp `buffer += chunk` **O(n²)** ở `sent_data_internal.py`.

**Fix (thuần backend, không đổi client):**
- **`patches/share.py`** (full-override `manga_translator/mode/share.py`): khi server đặt cờ `config._response_format="json"` (trong `stream_json`), executor **dựng sẵn `TranslationResponse` ngay tại chỗ** (nơi đã có `ctx.img_inpainted`) rồi chỉ pickle cái đó (~108KB) — thay vì pickle cả `Context`.
- **`patches/to_json.py`**: `.copy()` từng mẩu nền cắt (`inpaint[y0:y1, x0:x1].copy()`) — nếu để numpy **view**, pickle mẩu nhỏ vẫn kéo theo cả ảnh inpaint gốc.
- **`patches/main.py`**: `transform_to_json` nhận cả `TranslationResponse` đã dựng sẵn (bỏ qua `to_translation`); `stream_json` đặt cờ `_response_format`.
- **`patches/sent_data_internal.py`** (full-override): thay `buffer += chunk` O(n²) bằng `bytearray` + offset (amortized O(n)).

**Đo được:** gap `Running rendering` → response **14.3s → 0.078s** (~180×), output **byte-identical** (cùng số vùng, toạ độ, ảnh nền). Endpoint `bytes`/`image` giữ nguyên hành vi cũ. Spec/plan: `docs/superpowers/{specs,plans}/2026-08-09-backend-context-relay-optimization*`.

## File trong thư mục này

| File | Vai trò |
|---|---|
| `.env` / `.env.example` | Config bí mật (API key, model, port) |
| `Dockerfile` + `patches/to_json.py` | Image đã vá bug #2 ở trên (+ `.copy()` mẩu nền cho fast-path json) |
| `patches/gpt_config-vi.yaml` | Prompt dịch tùy chỉnh (La-tinh hóa tên riêng + ngữ cảnh ngôi xưng) — xem mục `gpt_config` |
| `patches/main.py` | Full-override `server/main.py`: `/fetch-image`, `/build-series-context`, `/set-series-context`, `/set-recent-dialogue` — xem mục "Endpoint mở rộng riêng của bản patch" |
| `patches/share.py` + `patches/sent_data_internal.py` | Tối ưu relay 108.5MB → 108KB + buffer O(n) — xem mục "Tối ưu relay giữa 2 tiến trình" |
| `patches/deepl.py` | Engine DeepL + `VIN` (⚠️ chưa test thật với API key thật — xem `docs.md` mục 8) |
| `run-backend.ps1` | Script chạy container, đọc `.env` |
| `fixtures/openapi.json` | OpenAPI spec thật, dò ở Giai đoạn B |
| `fixtures/response-that.json` | Response thật (sau khi vá) — nguồn chân lý cho `normalizeResponse()` |
| `fixtures/config-info.json` | Dump `config-help` — toàn bộ tham số config hợp lệ |
| `result/` | Ảnh debug backend lưu ra (gitignore) |

## Giai đoạn C — Userscript (lịch sử, đã deprecated) → Extension (hiện tại)

Giai đoạn C ban đầu viết **userscript** (`manga-overlay-translator.user.js`, C1–C4: dịch 1 ảnh → `OverlayRenderer` vẽ CSS → tự động dò ảnh/hàng đợi theo cuộn → UI hotkey `Alt+D`/`Alt+T` qua menu Tampermonkey, kể cả webtoon tiling `sliceImageIntoTiles`/`dedupeRegions`). Toàn bộ phần này **đã deprecated từ 2026-07-21/22**, thay bằng **extension MV3** (`extension/`) — cùng nguyên lý (`ApiAdapter`/`OverlayRenderer`/`Queue`/webtoon tiling vẫn tồn tại y hệt, chỉ khác cách gọi mạng: `GM_xmlhttpRequest` → `background.js` fetch qua `host_permissions`; xem `docs.md` mục 2.1/2.3).

**Mọi tính năng ship SAU khi port sang extension** (ghép biên webtoon, eager mode, hitomi prefetch, URL-cache, tối ưu relay backend, ngữ cảnh nhân vật/hội thoại, overlay safe-layout cho chữ CJK dọc) **được tài liệu hoá đầy đủ trong `docs.md`, không lặp lại ở đây** — README này tập trung vào backend (bug đã vá, schema, endpoint). Xem `docs.md` mục 5 (module walkthrough), mục 8 (trạng thái hiện tại từng tính năng), mục 11 (danh sách spec/plan theo ngày).
