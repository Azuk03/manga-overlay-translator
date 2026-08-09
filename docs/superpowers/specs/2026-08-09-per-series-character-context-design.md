# Per-Series Character Context (Option C) — Design

**Ngày:** 2026-08-09
**Trạng thái:** Đã chốt hướng (approach B), tiến hành plan + implement (người dùng miễn cổng duyệt).

## 1. Vấn đề

Sau khi lên `gpt-4o` + prompt mới, dịch tự nhiên hơn nhưng **đại từ/xưng hô vẫn sai ở các đoạn cần ngữ cảnh liên trang** (vd "HE FINALLY LEFT" → "anh ấy" trong khi "he" là nhạc phụ ⇒ phải "ông ấy/cha"). Nguyên nhân: backend dịch **từng trang, không có trí nhớ** về nhân vật/quan hệ đã xuất hiện ở trang trước.

## 2. Giải pháp (approach B — không vendor file core)

Dựng **hồ sơ nhân vật cố định per-truyện** (1 lần) rồi **nhét vào system prompt** của mọi call dịch sau — bằng cách tái dùng cơ chế `gpt_config` sẵn có (một **file YAML path** mà backend `OmegaConf.load`), thay vì sửa schema config lõi.

**Luồng:**
1. Client dịch vài trang đầu của truyện **như bình thường** (chưa có ngữ cảnh), gom `src` (chữ gốc OCR mà backend trả về mỗi vùng).
2. Khi gom đủ (≥ `CTX_MIN_PAGES` trang có chữ), client gọi **`POST /build-series-context`** với text đó → backend chạy **1 call GPT** (prompt trích xuất) → trả **hồ sơ nhân vật** (text gọn) + ghi file `gpt_config` per-truyện → trả `path`.
3. Client **lưu hồ sơ + path** vào `chrome.storage.local` (nguồn chân lý, sống qua recreate).
4. Từ đó, mọi call dịch của truyện này gửi `config.translator.gpt_config = <path per-truyện>` → backend nạp system prompt đã kèm hồ sơ → chọn đại từ nhất quán.
5. Khi container bị recreate (file server mất), client gọi **`POST /set-series-context`** (không GPT) đẩy lại hồ sơ đã lưu → tái tạo file.

## 3. Phạm vi

**Trong phạm vi (v1):**
- 2 endpoint backend trong `patches/main.py` (đã vendored): `/build-series-context` (GPT trích + ghi file), `/set-series-context` (ghi file từ hồ sơ có sẵn, không GPT).
- Trích hồ sơ: gọi OpenAI **trực tiếp** trong endpoint (thư viện `openai` + `OPENAI_API_KEY`/`OPENAI_MODEL` từ env đã có), KHÔNG đụng nội bộ translator.
- Client: `getSeriesId()`, gom `src` per-truyện, trigger build, tiêm `gpt_config` per-truyện, toggle bật/tắt, ensure-file-on-session-start.
- File gpt_config per-truyện = **base `gpt_config-vi.yaml`** + chèn khối "CHARACTER CONTEXT" vào `chat_system_template`.

**Ngoài phạm vi (v1):**
- Tóm tắt cốt truyện chạy dần / cập nhật hồ sơ mỗi trang (nặng, để sau).
- Không **re-dịch** các trang đã cache trước khi có hồ sơ (chấp nhận vài trang đầu thiếu ngữ cảnh; đa số trang sau có). Không đưa context-hash vào cache key ⇒ tránh re-dịch tốn kém. Chỉ **bump `CACHE_VERSION` 1 lần** khi rollout.
- Không sửa file core (`config.py`, `common_gpt.py`).

## 4. Định danh truyện — `getSeriesId()`

- **hitomi:** dùng gallery id (đã có qua `getHitomiGalleryUrls`/`galleryinfo.id`). Series id = `hitomi-<galleryId>`.
- **Khác:** `host + pathname` rút gọn (bỏ query/hash + số trang cuối nếu nhận ra). Fallback: `location.host + first-2-path-segments`.
- Dùng làm khóa `chrome.storage.local` (`mot_series_ctx_v{VER}_{seriesId}`) và tên file server (sanitize).

## 5. Backend

### 5.1 `POST /build-series-context`
Request: `{ "series_id": str, "text": str, "target_lang": str }`
Hành động:
1. Gọi OpenAI (`openai` lib, `OPENAI_API_KEY`/`OPENAI_MODEL` env) với **prompt trích xuất** (mục 5.3) trên `text` → nhận `sheet` (text gọn mô tả nhân vật + xưng hô tiếng Việt).
2. Ghi file gpt_config per-truyện (mục 5.4) từ `sheet`.
3. Trả `{ "sheet": str, "gpt_config_path": str }`.
Lỗi (OpenAI fail): trả 200 với `{ "sheet": "", "gpt_config_path": null }` — client bỏ qua ngữ cảnh, dịch thường (không chặn đọc).

### 5.2 `POST /set-series-context`
Request: `{ "series_id": str, "sheet": str }`
Hành động: chỉ **ghi file** gpt_config per-truyện từ `sheet` (không GPT) → trả `{ "gpt_config_path": str }`. Dùng để tái tạo file sau recreate.

### 5.3 Prompt trích xuất (system, gửi kèm text các trang đầu)
Yêu cầu GPT đọc hội thoại (JP/KR/CN/EN) và xuất **một khối tiếng Việt gọn** liệt kê nhân vật: tên (La-tinh hóa), giới, tuổi/vai vế, quan hệ, và **đại từ/xưng hô tiếng Việt nên dùng** cho từng người (A gọi B là gì, tự xưng gì). Ràng buộc: ≤ ~200 từ, không bịa nhân vật không có bằng chứng, ghi "chưa rõ" khi thiếu thông tin, KHÔNG dịch toàn bộ — chỉ hồ sơ.

### 5.4 File gpt_config per-truyện
Đọc base `/app/gpt_config-vi.yaml`, chèn vào cuối `chat_system_template` một khối:
```
CHARACTER CONTEXT (dùng để chọn đại từ/xưng hô nhất quán cho truyện này):
<sheet>
Áp dụng bảng nhân vật trên khi chọn đại từ; giữ nhất quán toàn truyện.
```
Ghi ra `/app/series-ctx/<sanitized_series_id>.yaml`. Tạo thư mục nếu chưa có. Giữ mọi quy tắc format `<|n|>` + La-tinh hóa của base (vì kế thừa base template).

## 6. Client (extension)

### 6.1 Toggle
Popup thêm checkbox `mot_character_context` (mặc định **BẬT**). `getCharacterContext()` đọc `chrome.storage.local` (live-read như các setting khác). Tắt ⇒ hành vi y như hiện tại.

### 6.2 Trạng thái per-truyện (`chrome.storage.local`)
Key `mot_series_ctx_v{CACHE_VERSION}_{seriesId}` = `{ sheet, gpt_config_path, srcAccum: [..], pages: n, built: bool }`.

### 6.3 Orchestration (trong `translateAndRenderImage`/queue)
- Xác định `seriesId`. Nếu toggle tắt hoặc không có seriesId ⇒ luồng cũ.
- Nếu `built`:
  - Đảm bảo file server tồn tại: gọi `/set-series-context` 1 lần/phiên (cache cờ in-memory) → lấy `gpt_config_path`.
  - Dịch với `gpt_config = gpt_config_path`.
- Nếu chưa `built`:
  - Dịch trang **không ngữ cảnh** (gpt_config mặc định). Gom `src` (các chuỗi `region.src`) vào `srcAccum`, tăng `pages`.
  - Khi `pages >= CTX_MIN_PAGES` (mặc định 3) và `srcAccum` đủ dài: gọi `/build-series-context` (một lần, có khóa chống gọi trùng) → lưu `sheet`/`path`/`built=true`. Các trang SAU dùng ngữ cảnh.

### 6.4 Truyền `gpt_config` per-truyện
`ApiAdapter.translateImage` nhận thêm tham số `gptConfigPath` tùy chọn; nếu có, đặt `translatorConfig.gpt_config = gptConfigPath` thay cho `CFG.GPT_CONFIG_PATH`. (Vẫn chỉ áp khi `targetLang==='VIN' && engine!=='deepl'` như hiện tại.)

### 6.5 Cache
Bump `CFG.CACHE_VERSION` 6 → **7** (rollout). KHÔNG thêm context-hash vào key (trang đã cache giữ nguyên; trang mới sau khi có hồ sơ được dịch kèm ngữ cảnh). Ghi rõ đánh đổi: vài trang đầu (trước khi built) thiếu ngữ cảnh.

## 7. Hằng số
- `CTX_MIN_PAGES = 3` (số trang gom trước khi dựng hồ sơ).
- `CTX_MIN_CHARS = 200` (độ dài text tối thiểu để dựng, tránh dựng từ trang gần trống).
- Thư mục server: `/app/series-ctx/`.

## 8. Kiểm chứng
- **Backend (curl):** POST `/build-series-context` với text tiếng Hàn/Anh mẫu → nhận `sheet` hợp lý + file tạo ra; dịch 1 trang với `gpt_config=path` → xưng hô đổi theo hồ sơ; POST `/set-series-context` tái tạo file OK.
- **Client:** không có test tự động; **người dùng nghiệm thu trên Cốc Cốc**: đọc 1 truyện, sau vài trang thấy đại từ nhất quán hơn (vd "ông ấy/cha" cho trưởng bối thay vì "anh ấy").
- **Regression:** tắt toggle ⇒ y hệt hiện tại; không lỗi parser `<|n|>`; truyện không định danh được ⇒ luồng cũ.

## 9. Rủi ro
- **File server mất khi recreate** ⇒ đã có `/set-series-context` tái tạo; client ensure mỗi phiên. Nếu translate lỗi do gpt_config thiếu ⇒ client fallback gpt_config mặc định + re-ensure.
- **Hồ sơ sai sớm "nhiễm độc"** cả truyện ⇒ v1 chấp nhận; tương lai cho sửa tay/rebuild.
- **+1 call GPT/truyện** (build) + prompt dài hơn mỗi call (thêm hồ sơ ~200 từ) ⇒ latency/cost nhẹ, prefetch che.
- **Path traversal:** sanitize `series_id` khi tạo tên file (chỉ `[a-zA-Z0-9_-]`).
- **Rác file series-ctx:** chấp nhận v1 (mất khi recreate); tương lai thêm dọn.
