# Backend Degradation Investigation Plan

**Mục tiêu:** Tìm CHÍNH XÁC vì sao backend dịch chậm dần theo thời gian chạy
(tươi ~9s/trang → sau nhiều giờ ~30s/trang), rồi **sửa triệt để** để tốc độ
không suy giảm — không phải cứ restart tay.

## Đã biết chắc (từ điều tra trước)

- **Tươi (vừa restart):** 1 trang dày ~9s; khoảng "Running rendering → 200 OK"
  chỉ **~6ms** (đo bằng mốc [PERF] chèn vào executor).
- **Suy giảm (uptime ~5h, hàng trăm lượt dịch):** cùng ảnh ~30s; khoảng đó phình
  lên **~14s**.
- Các bước AI KHÔNG phải nguồn suy giảm: inpaint 0.5s, GPT ~2-6s, detect/OCR ~2s,
  dump_image 6ms. Suy giảm nằm ở **cửa sổ sau tính toán** (rendering→response)
  và/hoặc chậm chung toàn cục.
- **Kiến trúc:** server (PID 1, cổng 5003) đẩy việc sang executor (PID 38, cổng
  5004, `--use-gpu`). `--models-ttl 0` = preload MỌI model mỗi lượt dịch, không
  bao giờ unload. Thư mục `/app/result` **bind-mount** sang `E:\...\result`
  (Windows filesystem qua Docker Desktop — I/O file nhỏ rất chậm).
- `torch.cuda.empty_cache()` + `gc.collect()` có mặt trong code (dòng ~711,
  1500-1537).
- **Restart khôi phục hoàn toàn tốc độ** → suy giảm là trạng thái tích luỹ, xoá
  được bằng khởi động lại tiến trình.

## Ràng buộc kỹ thuật

- Code backend **bake trong image** (chỉ `/app/result` được mount). Cách đo/sửa:
  (a) sửa file TRONG container + `docker restart` (writable layer giữ qua restart
  — đã dùng được), hoặc (b) sửa `patches/*.py` + **rebuild image** cho fix vĩnh
  viễn.
- py-spy bị chặn (không có `CAP_SYS_PTRACE`). Dùng: docker logs timestamps,
  nvidia-smi, docker stats, đếm file `/app/result`, và chèn mốc `time.time()`
  vào code executor.
- Mình (agent) tự chạy được phần lớn Phase 1-2 qua docker + curl.

---

## Phase 1 — Tái hiện suy giảm + đo XU HƯỚNG theo số lượt dịch

**Ý tưởng:** thay vì đợi 5h, ép suy giảm nhanh bằng cách dịch liên tục N lượt
(vd 150-300) cùng 1 ảnh, đo tốc độ theo số lượt để thấy đường cong + tương quan
với từng tài nguyên.

- [ ] **1.1** Restart backend fresh. Ghi mốc t0.
- [ ] **1.2** Vòng lặp curl dịch cùng 1 ảnh N lượt (renderer=none, giống client).
  Với mỗi lượt ghi: `time_total` (client) + khoảng "Running rendering → 200 OK"
  (từ `docker logs -t`, tính hiệu timestamp).
- [ ] **1.3** Song song, mỗi ~20-30s lấy mẫu:
  - GPU: `nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv`
  - Executor RSS: `docker stats --no-stream` hoặc `ps -o rss` cho PID 38.
  - Thư mục result: số file + tổng dung lượng `/app/result` (đếm trong container).
- [ ] **1.4** Lập bảng: lượt# | total(s) | render-gap(s) | GPU-mem | RSS | result-files.
  → Xác định **tài nguyên nào tăng đồng biến với độ chậm** (đây là bước then chốt
  để chọn giả thuyết đúng, không đoán).

**Kết quả mong đợi:** một trong các đường sau tăng cùng độ chậm → khoanh vùng:
- result-files tăng đều → nghi thư mục result / bind-mount I/O.
- GPU-mem tăng/phân mảnh → nghi CUDA fragmentation.
- RSS tăng đều → nghi rò rỉ bộ nhớ Python/torch.
- Không cái nào tăng nhưng vẫn chậm → nghi trạng thái nội bộ model/allocator.

---

## Phase 2 — Giả thuyết (xếp hạng) + cách xác nhận/bác bỏ TỪNG cái

### GT1 (nghi hàng đầu): Thư mục `/app/result` phình + I/O bind-mount Windows chậm
Mỗi lượt dịch có thể lưu ảnh trung gian/final.png vào `/app/result` (mount sang
Windows). Qua hàng giờ → hàng nghìn file; ghi + thao tác thư mục chậm dần, và
mỗi lần ghi qua bind-mount Windows vốn chậm.
- **Xác nhận:** result-files có tăng mỗi lượt không (Phase 1)? Tương quan với độ
  chậm?
- **Test cô lập:** (a) tắt lưu result (verbose off / không có progress_hooks lưu
  final.png), HOẶC (b) trỏ result sang thư mục TRONG container (tmpfs, không
  bind-mount) → dịch N lượt → suy giảm còn không? Nếu HẾT → chính là GT1.
- **Fix nếu đúng:** không lưu ảnh result (client không dùng chúng — chỉ cần JSON
  region + background từng vùng), hoặc lưu vào volume nhanh (không bind-mount
  Windows), hoặc tự dọn định kỳ.

### GT2: Phân mảnh bộ nhớ GPU / CUDA cache phình
Sau nhiều inference, allocator phân mảnh → cấp phát chậm, `empty_cache()` lâu dần.
- **Xác nhận:** GPU-mem trend (Phase 1). Chèn mốc đo thời gian quanh
  `torch.cuda.empty_cache()`/`gc.collect()` → có phình theo lượt không?
- **Test cô lập:** thêm `torch.cuda.empty_cache()` + `torch.cuda.reset_peak_memory_stats()`
  định kỳ (hoặc `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`) → tốc độ có
  hồi mà không cần restart không?
- **Fix nếu đúng:** đặt `PYTORCH_CUDA_ALLOC_CONF`, hoặc reset allocator định kỳ.

### GT3: Rò rỉ bộ nhớ Python/torch (RSS tăng)
Tensor/đối tượng tích luỹ không được giải phóng → áp lực gc, chậm dần.
- **Xác nhận:** RSS executor tăng đều (Phase 1)? Nếu leo tuyến tính → rò rỉ.
- **Test:** `tracemalloc` snapshot sớm vs muộn (chèn endpoint debug), tìm nơi cấp
  phát tăng.
- **Fix nếu đúng:** giải phóng ctx/tensor sau mỗi lượt (del + empty_cache), sửa
  nơi giữ tham chiếu.

### GT4: `--models-ttl 0` preload mỗi lượt tích luỹ
Preload MỌI model mỗi lượt (dòng 403-412) — nếu `prepare_*` cấp phát lại mỗi lần
→ tích luỹ.
- **Xác nhận:** đo thời gian bước "Loading models" theo lượt — có phình không?
- **Test:** đổi `--models-ttl` sang lớn (vd 86400) trong `run-backend.ps1` →
  recreate container → dịch N lượt → suy giảm còn không?
- **Fix nếu đúng:** đặt `models-ttl` lớn (giữ model, bỏ preload lặp).

---

## Phase 3 — Chốt 1 nguyên nhân
Từ tương quan Phase 1 (tài nguyên nào bám theo độ chậm) + test cô lập Phase 2
(tắt/đổi cái gì thì HẾT suy giảm), xác định đúng 1 nguyên nhân. KHÔNG sửa trước
khi có 1 test cô lập cho thấy "tắt X → hết chậm".

## Phase 4 — Sửa triệt để + kiểm chứng
- [ ] Áp fix cho nguyên nhân đã chốt (sửa `patches/*.py` + rebuild image cho vĩnh
  viễn, hoặc đổi arg trong `run-backend.ps1`).
- [ ] Chạy lại stress test Phase 1 (N lượt) → **tốc độ phẳng** theo số lượt.
- **Tiêu chí đạt:** sau 200+ lượt dịch, thời gian/trang vẫn trong ~1.2x so với
  tươi (không còn phình ~3x). Không cần restart tay để giữ nhanh.

## Ghi chú
- Nếu Phase 1 cho thấy NHIỀU tài nguyên cùng tăng, ưu tiên test cô lập cái rẻ
  nhất trước (GT4 đổi 1 arg; GT1 trỏ result đi chỗ khác).
- Toàn bộ sửa nằm ở BACKEND (patches + rebuild image), không đụng extension.

---

## KẾT QUẢ (2026-08-08) — giả thuyết "suy giảm" bị BÁC BỎ

Chạy stress 130 lượt cùng ảnh trên backend tươi, đo đầy đủ:

| Chỉ số | Kết quả | Kết luận |
|---|---|---|
| detect+OCR (local GPU) | 2-3s, phẳng suốt 130 lượt | Không suy giảm |
| inpaint (local GPU) | 0-1s, phẳng | Không suy giảm |
| render→200 (không concurrency) | ~0-1s | "14s gap" trước = CONCURRENCY, không phải bước xử lý |
| số region detect | **24 CHÍNH XÁC cả 71/71 lượt** | Detection ổn định, KHÔNG sót |
| RSS executor | 1853→1828 MB (còn giảm) | Không rò rỉ RAM |
| GPU mem | 3382-3783 MB (dao động) | Không phình/phân mảnh tích luỹ |
| result-files | 7450 không đổi | Không phình thư mục |
| GPU nhiệt sau 18' | 45°C idle | Không throttle nhiệt (trong test) |
| time_total | 7s → vọt 18s (lượt 31-60) → **hồi về 7s** (lượt 121-130) | Dao động, KHÔNG chậm dần đều |

**Kết luận:** KHÔNG có suy giảm backend theo số lượt. Loại bỏ: rò rỉ RAM, phân
mảnh GPU, phình thư mục result, `models-ttl`, suy giảm detection. Phần dao
động/"vọt" của tổng thời gian là **ĐỘ TRỄ API GPT (OpenAI)** — bên ngoài, thất
thường. "Restart 30s→9s" trước đây nhiều khả năng trùng hợp với lúc GPT chậm /
lúc extension đang tải đồng thời, KHÔNG phải sửa lỗi local.

**Sàn thực tế mỗi trang (đã hết concurrency nhờ A+B):** ~10-12s =
local GPU ~5s (detect+ocr+inpaint) + GPT ~2-3s + tải ảnh ~3s (relay hitomi).
Cộng biến động GPT khi API chậm.

**Đòn bẩy giảm tốc còn lại (không có "bug" để sửa):**
1. Tải ảnh ~3s (relay hitomi) — có thể tối ưu (pipeline/relay), thật.
2. GPT ~2-3s + vọt — bên ngoài; đổi model/engine nhanh hơn (đánh đổi chất lượng).
3. Local GPU ~5s — hạ độ phân giải detect (đánh đổi: dễ sót text).
4. Prefetch-ahead (ĐÃ có) — giấu độ trễ: trang đã prefetch = tức thì.
5. Thermal sau nhiều giờ — phần cứng (tản nhiệt/nghỉ), không phải code.
