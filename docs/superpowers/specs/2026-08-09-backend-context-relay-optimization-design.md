# Backend Context-Relay Optimization — Design

**Ngày:** 2026-08-09
**Trạng thái:** Đã duyệt thiết kế, chờ plan + implement.

## 1. Vấn đề (đã xác nhận bằng số đo)

Trên ảnh thật, khoảng "backend báo dịch xong (`Running rendering`) → overlay hiện trên
UI" mất **~11–14 giây**, dù GPT chỉ ~2s, encode JSON 6ms, client vẽ 15ms.

Điều tra (instrument container + curl trực tiếp, **không** concurrency, mode C3, ảnh
2036×2880, 4 vùng) cho ba mốc:

- `Running rendering` `10:18:21.329`
- `[MOT-PICKLE] pickle.dumps=0.175s total_bytes=108.5MB` — executor pickle **toàn bộ
  `Context`** (img_rgb, img_inpainted, upscaled, các mask full-res)
- `[MOT-PERF] to_translation=0.001s model_dump_json=0.005s size=108KB` `10:18:32.450`
  — transform JSON chỉ 6ms, response chỉ 108KB

→ **~10.9s là truyền khối 108.5MB executor(5004)→server(5003) qua HTTP + `pickle.loads`**,
bị khuếch đại bởi vòng lặp `buffer += chunk` **O(n²)** ở `server/sent_data_internal.py`.

**Nguồn gốc kiến trúc:** executor chạy pipeline rồi `pickle.dumps(ctx)` gửi **cả Context**
về server; server mới chạy `to_translation(ctx)` + `model_dump_json()`. Client chỉ cần
108KB JSON cuối, không cần bất kỳ ảnh trung gian nào.

## 2. Mục tiêu / Phi mục tiêu

**Mục tiêu:**
- Giảm khoảng `Running rendering` → client vẽ từ ~14s xuống **< 1s** cho ảnh Cache-MISS.
- Output **y hệt** trước fix: cùng số vùng, cùng toạ độ, cùng nền per-vùng, cùng bản dịch.
- **Không đổi client** (extension): vẫn nhận code-0 + đúng JSON như cũ.

**Phi mục tiêu (YAGNI):**
- Không đụng endpoint `bytes`/`image` (project không dùng; giữ nguyên hành vi cũ).
- Không đổi giao thức stream nhìn từ phía client.
- Không tối ưu GPT/detect/inpaint (đã biết không phải nút thắt).

## 3. Thiết kế

### 3.1 Chuyển `to_translation` sang chạy trên executor (Option A)

Executor đã có sẵn `ctx.img_inpainted` cục bộ — nên **cắt nền + đóng gói tại chỗ**, chỉ
truyền `TranslationResponse` nhỏ (chỉ các mẩu nền theo bubble, ~1–3MB) sang server; server
chỉ còn `.model_dump_json()` (6ms).

**Cờ điều khiển (dùng đúng pattern có sẵn):** server đặt `config._response_format = "json"`
trong `stream_json` trước khi dispatch. Executor đọc qua `getattr(config, "_response_format",
None)` — giống hệt cách `config._web_frontend_optimized` đang chảy tới executor. Không có cờ
→ giữ nguyên hành vi cũ (pickle cả ctx).

### 3.2 Bẫy numpy view (BẮT BUỘC)

`inpaint[minY:maxY, minX:maxX]` trong `to_json.py` là **numpy view** — pickle view sẽ kéo
theo **cả mảng gốc 17.6MB**. Trong luồng cũ điều này vô hại (transform chạy trên server,
view được encode PNG ngay, không pickle). Trong luồng mới ta **pickle `TranslationResponse`**
nên phải `.copy()` từng mẩu cắt để tách khỏi mảng gốc:

```python
background=inpaint[minY:maxY, minX:maxX].copy()
```

### 3.3 Sửa O(n²) buffer (Option C — phòng thủ)

`server/sent_data_internal.py` `process_stream`/`handle_buffer` tích luỹ bằng `buffer +=
chunk` (bytes bất biến) → mỗi chunk copy lại toàn bộ buffer → O(n²). Đổi sang `bytearray`
+ offset tiêu thụ (amortized O(n)). Sau Option A payload đã nhỏ nên đây là defense-in-depth,
nhưng rẻ và đúng.

## 4. Các file thay đổi

| File | Thay đổi | Ghi chú patch |
|---|---|---|
| `patches/to_json.py` | (a) `.copy()` mẩu nền; (b) `to_translation` trả về như cũ, KHÔNG đổi chữ ký — vẫn nhận `Context` | đã là patch |
| `patches/main.py` | (a) `stream_json` đặt `config._response_format="json"`; (b) `transform_to_json` nhận cả `TranslationResponse` (đã dựng sẵn) → chỉ `.model_dump_json()`; nếu nhận `Context` (fallback) → chạy `to_translation` như cũ | đã là patch |
| `patches/share.py` **(mới)** | trong `run_method`, nhánh không-placeholder: nếu `config._response_format=="json"` → `from server.to_json import to_translation; payload=to_translation(result)` rồi `pickle.dumps(payload)`; ngược lại giữ `pickle.dumps(result)` | copy từ image gốc `manga_translator/mode/share.py`, sửa tối thiểu; thêm `COPY` vào Dockerfile |
| `patches/sent_data_internal.py` **(mới)** | thay `buffer += chunk` O(n²) bằng `bytearray` | copy từ image gốc `server/sent_data_internal.py`; thêm `COPY` vào Dockerfile |
| `Dockerfile` | thêm 2 dòng `COPY patches/share.py /app/manga_translator/mode/share.py` và `COPY patches/sent_data_internal.py /app/server/sent_data_internal.py` | |

**Xử lý lỗi:** nếu `to_translation` trên executor ném lỗi, nhánh `except` sẵn có trong
`run_method` gửi code-2 (error) về client như cũ — không thêm đường lỗi mới.

## 5. Test & nghiệm thu

- **Tiêu chí đạt:** khoảng `Running rendering` → client vẽ **< 1s** (từ ~14s); output y
  hệt (cùng số vùng/nền/bản dịch trên cùng 1 ảnh).
- **Đo tự động trước:** curl trực tiếp `/translate/json/stream` với `body.json` đã có +
  instrument tạm (đo `Running rendering`→transform), so trước/sau trên cùng ảnh; gỡ
  instrument sau khi chốt.
- **Nghiệm thu cuối (người):** dịch 1 trang hitomi mới trên Cốc Cốc — overlay hiện gần như
  tức thì sau khi terminal báo xong; nội dung đúng như trước.
- **Quy trình build:** sửa `patches/*` → `docker build` lại image → `run-backend.ps1`
  (recreate, KHÔNG phải `docker restart`).

## 6. Rủi ro

- **Layering:** executor (`manga_translator`) import `server.to_json`. Chấp nhận được —
  `to_json.py` vốn đã import `manga_translator`, cả hai cùng nằm dưới `/app` trên sys.path.
- **`.copy()` sót chỗ:** nếu quên `.copy()`, payload lại phình về 108MB — test đo kích
  thước pickle sẽ bắt được ngay.
- **Patch trôi theo upstream:** `share.py`/`sent_data_internal.py` giờ là bản full-override
  bake trong image; nếu base image đổi, cần đồng bộ lại (giống các patch hiện có).
