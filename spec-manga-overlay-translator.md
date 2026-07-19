# SPEC: Userscript dịch truyện tranh overlay (MVP cá nhân)

> Spec để đưa cho coding agent. Đọc hết Phần 0 trước khi viết bất kỳ dòng code nào.
> Bản v2 — đã rà soát, sửa 12 lỗi so với bản nháp.

---

## 0. ĐỌC TRƯỚC KHI CODE

### 0.1 KHÔNG được đoán schema API — và KHÔNG được đoán cả PORT

**Đã xác minh trực tiếp trên README chính thức (nhánh `main`, ghi "Last Updated: 2025/05/10"):**

README của manga-image-translator **không tài liệu hóa bất kỳ endpoint nào**. Không schema request. Không schema response. Không ví dụ curl. Toàn bộ tài liệu API của dự án gồm đúng một câu:

> "Read the openapi documentation at: `127.0.0.1:8000/docs`"

**Nguồn chân lý duy nhất là instance đang chạy của chính bạn.**

**README tự mâu thuẫn về PORT:**

| Mục trong README | Port |
|---|---|
| Run Web Server (Docker) | lệnh dùng `--port=5003`, câu ngay dưới ghi "Web Server starts on port **8000** by default" |
| Web Mode | "web demo service address is `http://127.0.0.1:8000`" |
| **API Mode** | **cùng lệnh y hệt Web Mode** → "The API service address is `http://127.0.0.1:8001`" |
| API Mode Options (`shared`) | `--port` mặc định **5003** |

Nghi vấn: `--nonce` được mô tả là *"secure **internal** API server communication"*. Chữ **internal** gợi ý `shared`/5003 là kênh nội bộ giữa web server và translator worker, KHÔNG phải API công khai. Cờ `--start-instance` củng cố giả thuyết đó.

→ **Giai đoạn B là bước đầu tiên và bắt buộc.** Không viết `ApiAdapter` hay `OverlayRenderer` trước khi B xong. Nếu định parse response dựa trên phỏng đoán → **dừng, báo lại người dùng.**

### 0.2 Thứ tự thực hiện là bắt buộc

```
A (backend chạy) → B (chốt schema) → C1 (dịch 1 ảnh) → C2 (overlay) → C3 (auto+cuộn) → C4 (UI)
```

Mỗi giai đoạn phải chạy được và **người dùng xác nhận bằng mắt** trước khi sang bước sau. Không viết cả 4 rồi mới test.

### 0.3 Đây là userscript, KHÔNG phải extension

Không `manifest.json`. Không service worker. Không build step, bundler, npm, TypeScript.

**Deliverable: đúng 1 file `.user.js`**, paste vào Tampermonkey là chạy. Lý do: `GM_xmlhttpRequest` bỏ qua CORS và mixed-content, xóa sổ toàn bộ lớp phức tạp của MV3. **Đừng "cải tiến" thành extension.**

---

## 1. Mục tiêu & phạm vi

**Mục tiêu:** Đọc truyện raw (Nhật/Hàn/Trung) trên website, bản dịch tiếng Việt đè lên bóng thoại khi cuộn.

**Trong phạm vi:**
- Ảnh truyện trên web (`<img>` trong DOM)
- Cả trang rời (manga) và dải dọc dài (webtoon)
- Backend tự host, chạy local
- 1 người dùng duy nhất (chính là dev)

**NGOÀI phạm vi — không làm, không đề xuất:**
- Desktop app / overlay màn hình
- Đọc file local CBZ/PDF/ZIP (backend đã có web UI riêng cho việc này)
- Tài khoản, thanh toán, credit
- Deploy backend lên cloud
- Panel settings, i18n, dark mode
- Nhiều ngôn ngữ đích (chỉ tiếng Việt)

---

## 2. Kiến trúc

```
Trang web (HTTPS)
  └── Userscript (Tampermonkey)
        ├── ImageFinder      — tìm <img> là trang truyện
        ├── Queue            — giới hạn job song song
        ├── ApiAdapter       — GM_xmlhttpRequest → backend
        │                      ⬅ NƠI DUY NHẤT BIẾT SCHEMA
        ├── Cache            — GM_setValue, key = hash bytes ảnh
        ├── OverlayRenderer  — dựng <div> đè lên <img>, render chữ bằng CSS
        └── UI               — nút nổi + hotkey

Docker (local, PORT chưa xác định — xem Giai đoạn B)
  └── manga-image-translator
        detector → OCR → translator → trả JSON (bbox + text)
```

**Nguyên tắc kiến trúc số 1:** chỉ `ApiAdapter` biết schema backend. Nó nhận `Blob`, trả **cấu trúc nội bộ chuẩn hóa** (5.4). Backend đổi schema → sửa đúng 1 hàm.

**Nguyên tắc kiến trúc số 2 — QUAN TRỌNG, quyết định nhiều thứ:**
**Backend KHÔNG render chữ. Trình duyệt render chữ bằng CSS.**

Ta chỉ lấy **bbox + text dịch** từ backend, rồi tự vẽ bằng HTML/CSS. Hệ quả:
- Không cần cấu hình font ở backend (font là chuyện của CSS)
- Không cần inpaint ở backend cho MVP → **nhanh hơn nhiều**
- Đặt `render.renderer: "none"` và `inpainter.inpainter: "none"` nếu backend vẫn trả text (**xác minh ở B**)
- Chữ dịch chọn/copy được, đổi font tức thì

---

## 3. GIAI ĐOẠN A — Dựng backend

> **Môi trường đích: Windows + NVIDIA RTX 3050 Ti Laptop GPU.**
>
> **VRAM thật: 4GB GDDR6** (die GA107, 128-bit, 2560 CUDA core). Kiến trúc **Ampere** → `bf16` chạy được, giữ nguyên `inpainting_precision`.
>
> **⚠️ CẢNH BÁO — đừng tin Task Manager.** Windows Task Manager hiển thị "GPU Memory" = **Dedicated (4GB thật) + Shared (~8GB mượn RAM hệ thống)** ≈ 12GB. **Shared memory là RAM đi qua PCIe — PyTorch CUDA KHÔNG dùng được cho inference.** Ngân sách thật là **4GB**, và PyTorch sẽ OOM ở mốc đó. Kiểm tra số thật bằng `nvidia-smi` (cột Memory-Usage), không phải Task Manager.
>
> **Ngân sách VRAM thực dụng: ~3–3.5GB.** GPU còn phải chia sẻ với desktop/Chrome nếu laptop không ở chế độ hybrid (Optimus). Chrome mở webtoon dài chiếm vài trăm MB.
>
> **⚠️ TGP dao động 35–80W.** Đây là laptop GPU — cùng tên nhưng bản 35W chậm hơn bản 80W rất nhiều (boost 1035 MHz so với 1695 MHz). Kiểm tra TGP máy bạn; nếu là bản 35–45W, hạ kỳ vọng tốc độ xuống.
>
> **⚠️ Throttle nhiệt.** Đọc cả chương = tải liên tục → laptop nóng → TGP tụt → chậm dần. Trang thứ 30 sẽ chậm hơn trang đầu.

### A.0 Kiểm tra GPU passthrough TRƯỚC KHI tải 15GB

Đây là bước 2 phút giúp tránh mất 1 tiếng tải image rồi mới phát hiện GPU không thông.

**Yêu cầu trên Windows:**
- Windows 10 21H2+ hoặc Windows 11
- Driver NVIDIA cài trên **Windows** (không phải trong WSL)
- Docker Desktop bật **"Use WSL 2 based engine"** trong Settings → General
- Docker 19.03+ (README yêu cầu)

**Test bằng image tí hon (~200MB thay vì 15GB):**

```powershell
docker run --rm --gpus all nvidia/cuda:12.3.1-base-ubuntu22.04 nvidia-smi
```

- **In ra bảng thông tin GPU** → passthrough OK, đi tiếp A.2. **Ghi lại tên card ở dòng đầu.**
- **Lỗi `could not select device driver`** → GPU chưa thông. Kiểm tra WSL2 backend + driver NVIDIA trên Windows. **Đừng tải image 15GB cho tới khi bước này pass.**

**Dung lượng đĩa:** image 15GB + model tải lúc chạy. Trên Windows, WSL2 lưu trong file `.vhdx` (thường ở ổ C:). **Cần dư ~30GB.**

### A.1 Font — CHỈ CẦN CHO BƯỚC TEST A.3

> **Đọc kỹ:** Font chỉ cần cho việc test bằng web UI ở A.3. **Sản phẩm cuối KHÔNG dùng font của backend** — trình duyệt render bằng CSS (xem Nguyên tắc kiến trúc số 2). Đừng tốn thời gian ở đây.

Font mặc định của backend là `fonts/anime_ace_3.ttf` — **không có dấu tiếng Việt**.

**⚠️ Lưu ý kỹ thuật:** `--font-path` là **CLI flag**, **KHÔNG có trong config JSON schema**. Nghĩa là **không set được font theo từng request qua API** — phải truyền vào lệnh khởi động server. Đây là lý do nữa để không dựa vào backend render chữ.

Nếu vẫn muốn test A.3 có dấu: tải font có Vietnamese subset (`Be Vietnam Pro`, `Nunito`, `Roboto Condensed`) vào `./fonts`, rồi thêm `--font-path fonts/<tên>.ttf` vào lệnh docker.

Chuỗi test dấu: `Ưu tiên: Nguyễn Đệ Tứ Kỵ Sĩ ườ ỡ ậ ề`

### A.2 Chạy Docker (bản GPU)

Image `zyddnys/manga-image-translator:main` — **~15GB**, tải lần đầu lâu.

> **⚠️ LỖI CÚ PHÁP THƯỜNG GẶP TRÊN WINDOWS.** Lệnh trong README dùng cú pháp **bash**: `\` để xuống dòng và `$(pwd)` để lấy thư mục hiện tại. **Cả hai đều vỡ trong PowerShell** — PowerShell dùng backtick `` ` `` để xuống dòng và `${PWD}`. Chép nguyên lệnh README vào PowerShell sẽ lỗi khó hiểu.

**Khuyến nghị: chạy từ shell WSL2 (Ubuntu), KHÔNG phải PowerShell.**
Lý do: (a) cú pháp bash chạy đúng, không phải dịch; (b) **I/O nhanh hơn nhiều** — nếu để file trên ổ Windows và mount qua `/mnt/c/...`, tốc độ đọc ghi rất chậm. Giữ thư mục làm việc **trong** filesystem của WSL2 (ví dụ `~/manga`).

Docker Desktop tự forward port từ container ra `localhost` của Windows → Chrome trên Windows vẫn gọi được `127.0.0.1`.

**Bản WSL2 / bash (khuyến nghị):**

```bash
docker run \
  --name manga_translator \
  -p 5003:5003 \
  -p 8000:8000 \
  -p 8001:8001 \
  --ipc=host \
  --gpus all \
  --entrypoint python \
  --rm \
  -v $(pwd)/result:/app/result \
  -v $(pwd)/fonts:/app/fonts \
  -e OPENAI_API_KEY='<key>' \
  -e OPENAI_MODEL='<model>' \
  -e OPENAI_API_BASE='<base-url>' \
  zyddnys/manga-image-translator:main \
  server/main.py --verbose --start-instance --host=0.0.0.0 --port=5003 \
  --use-gpu --models-ttl 0
```

**Bản PowerShell (nếu buộc phải dùng):**

```powershell
docker run `
  --name manga_translator `
  -p 5003:5003 `
  -p 8000:8000 `
  -p 8001:8001 `
  --ipc=host `
  --gpus all `
  --entrypoint python `
  --rm `
  -v ${PWD}/result:/app/result `
  -v ${PWD}/fonts:/app/fonts `
  -e OPENAI_API_KEY='<key>' `
  -e OPENAI_MODEL='<model>' `
  -e OPENAI_API_BASE='<base-url>' `
  zyddnys/manga-image-translator:main `
  server/main.py --verbose --start-instance --host=0.0.0.0 --port=5003 `
  --use-gpu --models-ttl 0
```

Ghi chú:
- `--gpus all` + `--use-gpu` là **cặp bắt buộc** — thiếu một trong hai là chạy CPU âm thầm, chậm gấp 10–20 lần mà **không báo lỗi**. Kiểm tra bằng `nvidia-smi` lúc dịch: GPU 0% → chưa vào GPU.
- `--models-ttl 0` = *"0 means forever"* → giữ model trong VRAM mãi, trang đầu sau mỗi lần nghỉ không bị load lại. **Với 4GB VRAM: bật được vì MVP không load inpainter (chỉ detector + OCR, ~1–2GB). Nếu OOM → bỏ cờ này trước tiên.**
- **Không dùng `--use-gpu-limited`.** Cờ đó chỉ loại *offline translator* khỏi GPU. Ta dùng `chatgpt` (dịch qua mạng) nên không có offline translator nào để loại.
- **Theo dõi VRAM ở lần chạy đầu:** mở terminal thứ hai, chạy `nvidia-smi -l 1` trong lúc dịch trang đầu. Ghi lại đỉnh VRAM. Đây là con số quyết định `CONCURRENCY` và có bật được inpaint sau này không.
- **Lệnh gốc README có 2 volume mount lạ:** `-v /demo/doc/../../server/main.py:/app/server/main.py` (và `instance.py`). Đường dẫn rút gọn thành `/server/main.py` — chỉ đúng khi chạy từ thư mục repo. Spec bỏ chúng để dùng code trong image. Nếu lỗi lạ → clone repo và mount theo README.
- Model tải về `./models` lúc chạy lần đầu → **lần đầu rất chậm, không phải treo.**

### A.2b Lựa chọn thay thế: cài bằng pip thay vì Docker

README ghi **"Using Pip/venv (Recommended)"** cho Local Setup — pip là đường được khuyến nghị, Docker chỉ là lựa chọn.

**Chỉ dùng nếu A.0 fail và không sửa được WSL2.** Pip né hoàn toàn WSL2, nhưng đổi lại phải tự lo Python và CUDA.

Yêu cầu:
- Python **3.10+** — README cảnh báo: *"The very latest version of Python might not be compatible with some PyTorch libraries yet"* → **đừng cài Python mới nhất**
- **Microsoft C++ Build Tools** phải cài *trước* `pip install` (một số dependency cần compile trên Windows)
- PyTorch phải **khớp CUDA version** — cài theo pytorch.org, đừng để pip tự chọn (nó sẽ lấy bản CPU)

```
git clone https://github.com/zyddnys/manga-image-translator.git
python -m venv venv
venv\Scripts\activate
# CÀI PYTORCH CUDA TRƯỚC theo pytorch.org, RỒI mới:
pip install -r requirements.txt
cd server
python main.py --use-gpu --models-ttl 0
```

**Thứ tự thử:** Docker trước (sạch, không đụng Python hệ thống). Vật lộn WSL2 quá 1 tiếng → chuyển pip.

### A.3 Nghiệm thu Giai đoạn A
- [ ] `docker ps` thấy container chạy
- [ ] **Dò port nào mở được UI:** thử `http://127.0.0.1:8000`, `:8001`, `:5003`. **Ghi lại.**
- [ ] Upload 1 trang raw, target `VIN` → ra bản dịch tiếng Việt (dấu có thể lỗi nếu chưa set font — **không sao**, xem A.1)

---

## 4. GIAI ĐOẠN B — Chốt hợp đồng API (BẮT BUỘC)

### B.1 Dump JSON schema của config

```bash
docker exec manga_translator python -m manga_translator config-help > config-info.json
```

Xem thêm `example/config-example.json` trong repo.

### B.2 Dò PORT và lấy OpenAPI spec

```bash
curl -s -o /dev/null -w "%{http_code} 8000\n" http://127.0.0.1:8000/docs
curl -s -o /dev/null -w "%{http_code} 8001\n" http://127.0.0.1:8001/docs
curl -s -o /dev/null -w "%{http_code} 5003\n" http://127.0.0.1:5003/docs

curl http://127.0.0.1:<PORT>/openapi.json > fixtures/openapi.json
```

Từ `openapi.json`, trích ra:
- Danh sách endpoint. **`/translate/json` suy ra từ mã nguồn `server/main.py`, KHÔNG từ tài liệu** — phải xác nhận có thật.
- `TranslateRequest` gồm field gì (dự kiến `config` + `image`).
- **Response schema chính xác.**

### B.3 Bắn thử và LƯU response thật

Theo mã nguồn `server/request_extraction.py`, field `image` nhận 3 dạng: bytes, chuỗi khớp `^data:image/.+;base64,`, hoặc **URL** (backend tự `requests.get`).

```bash
curl -X POST http://127.0.0.1:<PORT>/translate/json \
  -H "Content-Type: application/json" \
  -d @request-test.json > fixtures/response-that.json
```

**`fixtures/response-that.json` là nguồn chân lý duy nhất cho `ApiAdapter`**, và cho phép test offline.

### B.4 Config — tham số đã xác minh từ README

Nhánh config: `render`, `upscale`, `translator`, `detector`, `colorizer`, `inpainter`, `ocr`, cộng `kernel_size`, `mask_dilation_offset`, `filter_text` ở top-level.

**⚠️ KHÔNG có trong config JSON (chỉ là CLI flag → không set được per-request):**
`--font-path`, `--context-size`, `--pre-dict`, `--post-dict`, `--model-dir`, `--use-gpu`.
→ Muốn dùng phải truyền vào **lệnh khởi động server**, áp dụng cho mọi request.

**Bắt buộc đổi khỏi mặc định:**

| Tham số | Mặc định | Đặt thành | Lý do |
|---|---|---|---|
| `translator.target_lang` | `"CHS"` | `"VIN"` | Mặc định là **tiếng Trung** |
| `translator.translator` | `"sugoi"` | `"chatgpt"` | Sugoi chỉ Nhật→Anh, không ra tiếng Việt |
| `render.renderer` | `"default"` | `"none"` | Ta tự render bằng CSS (xem Kiến trúc #2). **Xác minh backend vẫn trả text khi `none`** |
| `inpainter.inpainter` | `"lama_large"` | `"none"` | MVP không cần inpaint → nhanh hơn nhiều |
| `render.rtl` | `true` | `false` **cho manhwa/manhua** | Thứ tự đọc phải-sang-trái. Đúng manga Nhật, **sai Hàn/Trung** |

**Enum hợp lệ (chép từ README, đừng bịa):**
- `Detector`: `default`, `dbconvnext`, `ctd`, `craft`, `paddle`, `none` — README: *"don't use craft for manga"*
- `Inpainter`: `default`, `lama_large`, `lama_mpe`, `sd`, `none`, `original`
- `Ocr`: `32px`, `48px`, `48px_ctc`, `mocr` — README khuyến nghị **`48px` cho cả Nhật và Hàn**
- `Renderer`: `default`, `manga2eng`, `none`
- `Direction`: `auto`, `horizontal`, `vertical`
- `Translator` (enum): `youdao`, `baidu`, `deepl`, `papago`, `caiyun`, `chatgpt`, `none`, `original`, `sakura`, `deepseek`, `groq`, `custom_openai`, `offline`, `nllb`, `nllb_big`, `sugoi`, `jparacrawl`, `jparacrawl_big`, `m2m100`, `m2m100_big`, `mbart50`, `qwen2`, `qwen2_big`

**⚠️ Mâu thuẫn trong README:** bảng "Translator Reference" liệt kê `openai` và `gemini`, nhưng **enum `Translator` không có hai giá trị đó** — enum ghi `chatgpt`. **Xác minh tên hợp lệ qua `/docs` ở B.2.** Nếu `gemini` không có trong enum, dùng `chatgpt` + `OPENAI_API_BASE` trỏ tới endpoint OpenAI-compatible của Gemini.

**Mặc định đáng chú ý:** `detection_size: 2048`, `box_threshold: 0.75`, `unclip_ratio: 2.3`, `inpainting_size: 2048`, `mask_dilation_offset: 30`, `kernel_size: 3`.

**Tips (chép từ README):**
- `{"detector":{"detector":"ctd"}}` tăng số dòng text phát hiện. Nhưng ghi chú cập nhật: *"default works better with related parameter adjustments in black and white comics"* → **thử cả hai.**
- Tăng `box_threshold` để lọc text rác do OCR nhận nhầm.
- Ảnh phân giải thấp → **giảm** `detection_size`, không sẽ sót câu. Phân giải cao → ngược lại.
- `upscale_ratio: 2` giúp detector bắt chữ tốt hơn ở ảnh nhỏ.

**⚠️ Hạn chế README tự thừa nhận (Future Plans #5):**
> *"The text rendering area is determined by the detected text, not the bubbles."*

**bbox bám vùng CHỮ, KHÔNG bám bóng thoại.** Ảnh hưởng trực tiếp `OverlayRenderer`: nền che sẽ ôm sát chữ chứ không lấp đầy bóng thoại. → Nới bbox ~10–15% khi vẽ nền.

### B.5 Nghiệm thu Giai đoạn B
- [ ] Ghi lại **PORT thật** của REST API
- [ ] Có `fixtures/openapi.json` + `fixtures/response-that.json` là dữ liệu THẬT
- [ ] Viết vào README: đường dẫn chính xác tới **bbox**, **chữ gốc**, **chữ dịch** trong response
- [ ] **bbox dùng hệ tọa độ nào?** px tuyệt đối theo ảnh gốc hay chuẩn hóa 0–1? `[x,y,w,h]` / `[x1,y1,x2,y2]` / polygon 4 điểm? — **xác định bằng thực nghiệm**
- [ ] Response có trả **chữ gốc** không? Nếu không → **bỏ tính năng click-xem-bản-gốc**, báo lại
- [ ] Response có trả **hướng chữ (dọc/ngang)** không? Nếu không → bỏ field `vertical`
- [ ] `renderer: "none"` + `inpainter: "none"` **vẫn trả text chứ?** Nếu không → phải bật lại và chấp nhận chậm
- [ ] `translator` hợp lệ là `chatgpt` hay `gemini` hay cả hai?
- [ ] Gửi 2 request đồng thời → backend xử lý song song hay xếp hàng? **Quyết định `CONCURRENCY`.**

---

## 5. GIAI ĐOẠN C — Userscript

### 5.1 Metadata block

```javascript
// ==UserScript==
// @name         Manga Overlay Translator (local)
// @namespace    local
// @version      0.1
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @connect      localhost
// @connect      127.0.0.1
// @connect      *
// @run-at       document-idle
// ==/UserScript==
```

- `@connect localhost` **bắt buộc**, thiếu là `GM_xmlhttpRequest` bị chặn khi gọi backend.
- `@connect *` cần để tải ảnh gốc từ CDN bất kỳ. Nếu Tampermonkey cảnh báo, đổi thành danh sách domain cụ thể.
- `@match *://*/*` là cố ý — dùng heuristic thay allowlist. Script phải **im lặng tuyệt đối** trên trang không phải truyện.

### 5.2 Config — hardcode đầu file

```javascript
const CFG = {
  // ⚠️ ĐIỀN SAU KHI XONG GIAI ĐOẠN B. README nêu 3 port mâu thuẫn. KHÔNG đoán.
  API: 'http://127.0.0.1:<PORT_TU_B>/translate/json',
  TARGET_LANG: 'VIN',
  TRANSLATOR: '<xac_minh_o_B>',   // 'chatgpt' hoặc 'gemini'
  RTL: false,                      // true cho manga Nhật, false cho manhwa/manhua
  MIN_NW: 400,                     // naturalWidth tối thiểu
  MIN_NH: 400,
  MIN_DISPLAY_RATIO: 0.3,          // clientWidth / viewportWidth
  CONCURRENCY: 1,                  // ⚠️ 4GB VRAM — xem ghi chú dưới. Đừng tăng khi chưa test.
  PREFETCH: 3,
  FONT: '"Be Vietnam Pro", "Nunito", sans-serif',
  BBOX_PAD: 0.12,                  // nới bbox 12% (bbox bám chữ, không bám bóng thoại)
  TILE_MAX_H: 4000,
  TILE_OVERLAP: 200,
  TIMEOUT_MS: 90000,               // GPU laptop + throttle nhiệt → để rộng
  DEBUG: false,
};
```

**Vì sao `CONCURRENCY: 1` chứ không phải 2?**
Về lý thuyết 2 có ích: khâu dịch (`chatgpt`) **chờ mạng, không dùng GPU**, nên trong lúc ảnh A đợi OpenAI (1–3s), ảnh B có thể chiếm GPU. **Nhưng với 4GB VRAM, hai ảnh cùng lúc = hai bộ activation trong VRAM → rủi ro OOM.** GPU cũng xử lý tuần tự nên lợi ích rất mỏng.

→ **Bắt đầu ở 1.** Nếu B cho thấy VRAM còn dư nhiều (`nvidia-smi` lúc dịch < 2GB), thử 2 và theo dõi OOM.

Không làm UI settings. Sửa biến nhanh hơn bấm menu.

### 5.3 Module: ImageFinder

Tìm `<img>` là trang truyện, **không dùng danh sách site**.

Nhận nếu THỎA HẾT:
1. `naturalWidth >= MIN_NW && naturalHeight >= MIN_NH` (kích thước thật)
2. `clientWidth / window.innerWidth >= MIN_DISPLAY_RATIO` (**hiển thị to trên trang** — dùng `clientWidth`, KHÔNG dùng `naturalWidth`, nếu không thumbnail 400px cũng lọt)
3. Không nằm trong `<header>`, `<nav>`, `<footer>`, `<aside>`
4. class/id không khớp `/logo|avatar|icon|banner|ad|thumb|sprite/i`
5. Tỉ lệ `naturalHeight/naturalWidth` trong `[0.5, 100]` (chặn trên rộng để không loại webtoon)

Bổ sung:
- `MutationObserver` để bắt ảnh lazy-load
- Bỏ qua `naturalWidth === 0` (chưa load) → chờ event `load`
- Không tìm thấy ảnh nào → **không hiện nút, thoát im lặng**

### 5.4 Module: ApiAdapter — CÔ LẬP SCHEMA TẠI ĐÂY

**Cấu trúc nội bộ chuẩn hóa** (module khác chỉ dùng cái này):

```javascript
/**
 * @typedef {Object} Region
 * @property {number} x   - px tuyệt đối theo ảnh GỐC, góc trái trên
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {string} dst - chữ đã dịch (BẮT BUỘC)
 * @property {string=} src      - chữ gốc (chỉ nếu B xác nhận có)
 * @property {boolean=} vertical - chữ dọc (chỉ nếu B xác nhận có)
 *
 * @typedef {Object} TranslateResult
 * @property {Region[]} regions
 */
```

```javascript
async function translateImage(blob) { /* gọi backend, trả TranslateResult */ }

// TÁCH RIÊNG, hàm thuần túy, test được offline bằng fixtures:
function normalizeResponse(raw, naturalW, naturalH) {
  // ⚠️ VIẾT DỰA TRÊN fixtures/response-that.json. KHÔNG đoán.
  // Polygon 4 điểm → tính bounding box.
  // Chuẩn hóa 0-1 → nhân naturalW/naturalH.
}
```

Yêu cầu:
- Dùng `GM_xmlhttpRequest`, **không dùng `fetch`** (fetch dính mixed-content trên trang HTTPS)
- `responseType: 'json'`, timeout `CFG.TIMEOUT_MS`
- Retry 1 lần khi lỗi mạng; **không** retry khi 4xx

**Tải ảnh gốc — QUAN TRỌNG:**
1. Lấy `img.currentSrc || img.src`
2. Tải full-res bằng `GM_xmlhttpRequest` + `responseType: 'blob'` (bỏ qua CORS)
3. Nếu `blob:` / `data:` URL → đọc trực tiếp trong page context
4. **Giữ lại Blob này** — `OverlayRenderer` cần nó để lấy mẫu màu (xem 5.7)

**Tối ưu đáng thử:** field `image` nhận cả URL → truyền thẳng URL, backend tự fetch, khỏi tải ảnh. Nhưng: (a) chỉ chạy nếu ảnh public không cần cookie/referer; (b) **mất Blob để lấy mẫu màu**. → Thử, nhưng vẫn cần tải blob cho khâu màu.

### 5.5 Module: Cache

- Key: hash bytes ảnh. **Không dùng URL** — CDN đổi URL mỗi lần load
- Value: `TranslateResult` (JSON nhỏ, không lưu ảnh)
- `GM_setValue` / `GM_getValue`
- Vĩnh viễn, không TTL

**⚠️ `crypto.subtle` chỉ tồn tại trong secure context.** Nhiều site raw vẫn chạy `http://` → `crypto.subtle` là `undefined` → cache **chết im lặng**, không báo lỗi, và mọi trang bị dịch lại mỗi lần F5.

```javascript
async function hashBlob(blob) {
  const buf = await blob.arrayBuffer();
  if (crypto?.subtle) {
    const h = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2,'0')).join('');
  }
  // Fallback cho trang HTTP: FNV-1a trên toàn bộ bytes.
  // Không cần mạnh về mật mã — chỉ cần phân biệt ảnh.
  const u8 = new Uint8Array(buf);
  let h = 0x811c9dc5;
  for (let i = 0; i < u8.length; i++) {
    h ^= u8[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return 'fnv' + h.toString(16) + '_' + u8.length;
}
```
Ghép thêm `u8.length` để giảm va chạm (FNV-1a 32-bit khá yếu với dữ liệu lớn).

### 5.6 Module: Queue

- `CONCURRENCY` từ CFG (**mặc định 1** tới khi B xác minh backend chạy song song được)
- Ưu tiên: ảnh trong viewport > ảnh sắp tới
- Hủy job của ảnh đã cuộn qua xa
- `IntersectionObserver` với `rootMargin: '200% 0px'` để prefetch sớm

### 5.7 Module: OverlayRenderer

**Chiến lược: HTML overlay, KHÔNG thay `img.src`.**
Không dính giới hạn canvas của webtoon dài; chữ chọn/copy được; click xem bản gốc gần như miễn phí.

#### Cấu trúc DOM

```html
<span class="mot-wrap" style="position:relative; display:inline-block">
  <img src="...">  <!-- KHÔNG đụng vào -->
  <div class="mot-layer" style="position:absolute; inset:0; pointer-events:none">
    <div class="mot-bubble" style="position:absolute; left:..%; top:..%; width:..%; height:..%">
      <span class="mot-text">Bản dịch</span>
    </div>
  </div>
</span>
```

**⚠️ Rủi ro: bọc `<img>` bằng `<span>` có thể phá CSS của site** (selector kiểu `.container > img`, flexbox, grid).
**Fallback nếu layout vỡ:** không bọc; thay vào đó chèn `.mot-layer` vào `document.body` với `position:absolute`, tọa độ tính từ `img.getBoundingClientRect()` + `window.scrollY`, và cập nhật lại khi scroll/resize. Tốn hơn nhưng không đụng DOM của site.

Lưu ý:
- `pointer-events:none` ở layer, `auto` ở bubble
- **Không sửa `<img>` gốc.** Bật/tắt = ẩn/hiện `.mot-layer`
- `GM_addStyle`, prefix `mot-` để tránh xung đột CSS

#### Scale tọa độ

Dùng `%` để tự co giãn khi zoom/resize:
```javascript
left  = (r.x / naturalWidth  * 100) + '%'
top   = (r.y / naturalHeight * 100) + '%'
width = (r.w / naturalWidth  * 100) + '%'
```
Nới bbox theo `CFG.BBOX_PAD` (bbox bám chữ, không bám bóng thoại — xem B.4).
Vẫn đăng ký `ResizeObserver` trên `<img>`.

#### Che chữ gốc — CHÚ Ý TAINTED CANVAS

1. **Lấy mẫu màu PHẢI dùng Blob đã tải ở 5.4**, tạo bitmap qua `createImageBitmap(blob)` hoặc `URL.createObjectURL(blob)`.
   **KHÔNG được `drawImage()` trực tiếp từ `<img>` của trang** → cross-origin → canvas bị tainted → `getImageData()` ném `SecurityError`.
2. Đọc pixel ở **4 góc bbox**, lấy **trung vị** (chống nhiễu tốt hơn trung bình)
3. `background: <màu>` cho `.mot-bubble`, `border-radius: 40%` để mềm mép

~90% bóng thoại manga nền trắng trơn → kết quả ổn hơn kỳ vọng.

#### Auto-fit cỡ chữ

Chữ tiếng Việt dài hơn tiếng Nhật ~20–35% → sẽ tràn.

```
binary search font-size trong [8, 40]:
  đo bằng CanvasRenderingContext2D.measureText (tránh layout thrashing)
  vừa bbox → thử lớn hơn; tràn → thử nhỏ hơn
lấy size lớn nhất mà vừa
```
Size tối thiểu vẫn tràn → chấp nhận + class `.mot-overflow` viền cảnh báo (chỉ khi `DEBUG`).

#### Ngắt dòng tiếng Việt

**Chỉ ngắt ở khoảng trắng.** Không hyphenation kiểu Anh — "nghiêng" không được cắt thành "nghi-êng".

```css
.mot-text {
  word-break: keep-all;
  overflow-wrap: normal;
  hyphens: none;
  text-align: center;
}
```

#### Chữ dọc
Bản dịch tiếng Việt **luôn render ngang**. Chỉ cần bbox đúng. Field `vertical` chỉ dùng để debug (nếu B xác nhận có).

#### Webtoon dải dọc

Nếu `naturalHeight > TILE_MAX_H`:
1. Cắt lát cao `TILE_MAX_H`, chồng lấn `TILE_OVERLAP` px
2. Gửi từng lát
3. Cộng offset `y` của lát vào bbox trả về
4. **Dedupe:** bóng thoại vắt qua đường cắt xuất hiện 2 lần → loại nếu IoU > 0.5, giữ bbox lớn hơn

Cắt lát dùng canvas (từ Blob, không tainted). `TILE_MAX_H = 4000` chứ không 16000 để có biên an toàn — **giới hạn tổng diện tích canvas cũng tồn tại**, không chỉ giới hạn chiều.

### 5.8 Module: UI

**1. Nút nổi** — `position:fixed`, góc phải dưới, `z-index: 2147483647`

| State | Hiển thị |
|---|---|
| idle | `Dịch` |
| running | `Đang dịch (3/12)` |
| done | `Xong ✓` (2s rồi về idle) |
| error | `Lỗi — click xem` |

**2. Hotkey `Alt+T`** — bật/tắt `.mot-layer`, so bản gốc/bản dịch tức thì. **Tính năng dùng nhiều nhất, làm cho mượt.**

**3. Click bubble → hiện chữ gốc** — chỉ làm **nếu B xác nhận response có `src`**.

**Lỗi hiển thị:**
- Connection refused → `Backend chưa bật? Kiểm tra docker ps`
- Timeout → `Backend quá chậm, thử lại`
- Không thấy ảnh → không hiện nút

---

## 6. Tiêu chí nghiệm thu

Test tối thiểu 3 loại trang:
1. Manga Nhật (ảnh rời, chữ dọc)
2. Webtoon Hàn (dải dọc > 10.000px)
3. Trang lazy-load ảnh

- [ ] Nút chỉ hiện trên trang có ảnh truyện, im lặng ở Google/YouTube
- [ ] Bấm Dịch → bản dịch tiếng Việt **đủ dấu**, nằm đúng bóng thoại
- [ ] Cuộn xuống → prefetch hoạt động, ảnh dịch xong trước khi tới nơi
- [ ] Alt+T bật/tắt tức thì, không giật
- [ ] Zoom trình duyệt (Ctrl +/-) → overlay vẫn khớp
- [ ] Resize cửa sổ → overlay vẫn khớp
- [ ] F5 → dịch lại **tức thì** (cache hit, không gọi backend)
- [ ] Webtoon dài: không bóng thoại nào bị dịch trùng ở đường cắt
- [ ] **Layout site không vỡ** khi bọc `<img>` (nếu vỡ → dùng fallback 5.7)
- [ ] Tắt docker → bấm Dịch → lỗi thân thiện, không crash trang

---

## 7. Cạm bẫy đã biết

| Cạm bẫy | Xử lý |
|---|---|
| **Task Manager báo ~12GB GPU memory — LÀ ẢO** (4GB thật + 8GB shared RAM qua PCIe) | VRAM thật là **4GB**. Dùng `nvidia-smi`, không dùng Task Manager |
| **`inpainter: lama_large` + `inpainting_size: 2048` → OOM trên 4GB** | MVP đã đặt `inpainter: "none"` → tránh được. Đừng bật lại khi chưa test |
| **`detection_size: 2048` có thể OOM khi kèm OCR** | Hạ 1024 nếu OOM. Đánh đổi: sót câu ở ảnh phân giải cao |
| **Laptop GPU TGP 35–80W — cùng tên, tốc độ chênh gần 2×** | Kiểm tra TGP máy. Bản 35W boost 1035MHz vs bản 80W 1695MHz |
| **Throttle nhiệt — trang 30 chậm hơn trang 1** | Bình thường với laptop. `TIMEOUT_MS` để rộng (90s) |
| **Thiếu `--gpus all` HOẶC `--use-gpu` → chạy CPU âm thầm, chậm 10–20×, KHÔNG báo lỗi** | Kiểm tra `nvidia-smi` lúc dịch. GPU 0% = chưa vào GPU |
| **Lệnh README dùng cú pháp bash (`\`, `$(pwd)`) → VỠ trong PowerShell** | Chạy từ shell WSL2, hoặc dùng bản PowerShell ở A.2 (`` ` ``, `${PWD}`) |
| **Mount file qua `/mnt/c/...` → I/O rất chậm** | Giữ thư mục làm việc **trong** filesystem WSL2 (vd `~/manga`) |
| **Tải 15GB rồi mới phát hiện GPU không thông** | A.0 — test bằng image 200MB trước |
| **`crypto.subtle` là `undefined` trên trang HTTP** → cache chết âm thầm | Fallback hash JS thuần (FNV-1a) — xem 5.5 |
| **README nêu 3 port mâu thuẫn (5003/8000/8001)** | Giai đoạn B — dò thực nghiệm |
| **`target_lang` mặc định `CHS` (tiếng Trung)** | Set `VIN` |
| **`translator` mặc định `sugoi` (chỉ Nhật→Anh)** | Set `chatgpt` |
| **README liệt kê `gemini`/`openai` nhưng enum chỉ có `chatgpt`** | Xác minh qua `/docs` |
| **`render.rtl` mặc định `true`** | Set `false` cho manhwa/manhua |
| **bbox bám vùng CHỮ, không bám BÓNG THOẠI** (README tự thừa nhận) | Nới bbox 12% |
| **`--font-path`, `--context-size`, `--pre-dict` KHÔNG có trong config JSON** | CLI-only → set lúc khởi động server, hoặc bỏ |
| **Lấy mẫu màu từ `<img>` cross-origin → canvas tainted → SecurityError** | Dùng Blob đã tải qua `GM_xmlhttpRequest` |
| **Bọc `<img>` bằng `<span>` có thể phá CSS site** | Fallback: layer ở body + `getBoundingClientRect()` |
| `fetch` bị chặn mixed-content trên HTTPS | `GM_xmlhttpRequest` + `@connect` |
| Canvas giới hạn ~16.384px, webtoon dài fail **âm thầm** (ảnh đen, không lỗi) | Cắt lát 4000px |
| Đọc ảnh từ `<img>` đã resize → OCR kém | Tải full-res qua `GM_xmlhttpRequest` |
| Cache theo URL → miss liên tục | Cache theo hash bytes |
| Chữ tiếng Việt tràn bóng thoại | Binary search auto-fit |
| Ngắt dòng giữa âm tiết | `word-break: keep-all` |
| Bóng thoại vắt đường cắt bị dịch 2 lần | Dedupe IoU > 0.5 |
| Docker lần đầu rất lâu (tải model) | Không phải treo |
| `MIN_DISPLAY_RATIO` dùng nhầm `naturalWidth` → lọt thumbnail | Dùng `clientWidth` |

**⚠️ Bảo mật:** có báo cáo lỗ hổng **SSRF** trong manga-image-translator bản beta-0.3 — gửi URL độc hại khiến server request tùy ý tới tài nguyên nội bộ/bên ngoài. Chạy `127.0.0.1` thì không sao. **Tuyệt đối không mở port ra internet.**

**⚠️ Trạng thái dự án:** chính tác giả ghi trong README: *"This project is still in the early stages of development and has many shortcomings."* Đừng kỳ vọng mọi thứ hoạt động hoàn hảo ngay.

---

## 8. Sau MVP (KHÔNG làm bây giờ)

Đừng động vào cho tới khi Phần 6 xanh hết.

**⚠️ XUNG ĐỘT PHẢI QUYẾT ĐỊNH TRƯỚC:**

README nêu hai ràng buộc loại trừ nhau:
- **Glossary + ngữ cảnh xuyên trang** → *"only applies to openaitranslator"* / *"custom_openai cannot load it"*
- **`json_mode`** → *"Currently, support is limited to: - Gemini"* và nó *"significantly increase the probability of successful translation"*

**Không thể có cả hai.** Khuyến nghị: **chọn openaitranslator** — glossary (nhất quán tên nhân vật) + ngữ cảnh xuyên trang có giá trị hơn json_mode nhiều.

**Tính năng backend đã có (nhưng kiểm tra xem API có gọi được không):**

1. **Glossary** — `OPENAI_GLOSSARY_PATH` (mặc định `./dict/mit_glossary.txt`). Tự động trích entry liên quan → glossary to không giảm chất lượng. **Chỉ openaitranslator.** Đây là **khác biệt chất lượng lớn nhất**: nhất quán tên nhân vật.
2. **Ngữ cảnh xuyên trang** — `--context-size`. **⚠️ CLI flag, KHÔNG có trong config JSON** → có thể không set được per-request qua API. Xác minh ở B.
3. **`gpt_config`** (YAML) — chỉnh `temperature`, `chat_system_template`, `chat_sample`. README có sẵn mẫu CoT template. **Đây là chỗ chỉnh giọng dịch tiếng Việt (xưng hô anh/em/tôi/tao/ngài).** `gpt_config` **CÓ** trong config JSON (`translator.gpt_config`) → dùng được qua API.
4. **`--pre-dict` / `--post-dict`** — sửa lỗi OCR trước dịch / lỗi dịch sau. **⚠️ CLI-only.**

**Vẫn phải tự làm:**

5. **Inpaint thật** — bật lại `inpainter: lama_large`, lấy ảnh đã xóa chữ làm `background-image` của bubble, giữ text HTML ở trên.
   **⚠️ Với 4GB VRAM, đây là mục rủi ro nhất.** README cảnh báo `inpainting_size` *"too large can cause out of memory"*. Nếu muốn thử: hạ `inpainting_size` 2048 → **1024**, và cân nhắc `lama_mpe` (nhẹ hơn `lama_large`). Bỏ `--models-ttl 0` để giải phóng VRAM. **Có thể đơn giản là không vừa — chấp nhận nền màu phẳng.**
6. **Sửa tay** — double-click bubble để sửa bản dịch, lưu cache.
7. **Chuyển sang extension** — **chỉ khi** cần đưa người khác dùng.

---

## 9. Ghi chú cho agent

- **Deliverable:** 1 file `.user.js` + `fixtures/openapi.json` + `fixtures/response-that.json` + `README.md` ngắn (lệnh Docker, port thật, schema đã dò).
- Comment code bằng tiếng Việt.
- Không dependency. Không CDN. Vanilla JS thuần.
- **Nếu phát hiện spec sai — đặc biệt schema API hay port — BÁO LẠI, đừng tự sáng tạo.**
- **Mốc quan trọng nhất là C1:** dịch được 1 ảnh, log JSON ra console. Đạt được nó trước khi làm gì khác.
- Ưu tiên **chạy được rồi mới đẹp**.
