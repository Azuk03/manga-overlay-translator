# Eager Webtoon Pre-translation — Design

## 1. Problem

Trên site webtoon (1 trang dài, nhiều `<img>`), extension hiện chỉ dịch ảnh
khi nó lọt vào vùng `IntersectionObserver` (`PREFETCH_MARGIN: '200% 0px'`) —
tức chỉ dịch trước tối đa 2 màn hình so với vị trí cuộn. Nếu người dùng cuộn
nhanh hơn tốc độ dịch (backend xử lý tuần tự, `CONCURRENCY: 1`), ảnh phía
dưới chưa kịp dịch khi người dùng cuộn tới.

Người dùng muốn 1 chế độ tùy chọn: dịch trước TOÀN BỘ ảnh hiện có trong
trang ngay khi kích hoạt, không chờ cuộn tới gần, để trải nghiệm đọc mượt
hơn với các trang dài. Đây là tính năng bổ sung (opt-in), không thay đổi
hành vi mặc định hiện tại.

**Ngoài phạm vi:** prefetch/dịch trước trang kế tiếp cho site phân trang
(mỗi trang = 1 URL riêng) — cần cách tiếp cận kỹ thuật khác hẳn (fetch HTML
site khác domain, site SPA không có ảnh trong HTML gốc, heuristic phát hiện
link "trang kế"...), sẽ brainstorm riêng ở 1 spec khác sau.

## 2. Setting mới: `mot_eager_translate`

- Boolean, lưu `chrome.storage.local`, mặc định `false`.
- Thêm checkbox trong `popup.html`, dưới mục "Translator engine":
  ```html
  <label><input type="checkbox" id="eager-translate"> Dịch trước toàn bộ ảnh (không đợi cuộn tới)</label>
  ```
- `popup.js` đọc/ghi giống pattern `engineSelect`/`langSelect` hiện có
  (load giá trị lúc mở popup, lưu ngay khi user đổi checkbox).
- `content.js` đọc setting 1 lần lúc `startAutoMode()` chạy (không cần phản
  ứng động nếu user đổi setting giữa chừng trong cùng 1 phiên dịch — giống
  cách `TARGET_LANG`/`TRANSLATOR_ENGINE` hiện tại chỉ áp dụng cho lần dịch
  mới, không đổi giữa chừng).

## 3. Kiến trúc: rẽ nhánh theo toggle, không xóa cơ chế cũ

**Toggle OFF (mặc định):** giữ nguyên 100% hành vi hiện tại —
`IntersectionObserver` + `CFG.PREFETCH_MARGIN` + `Queue.cancel()` không đổi.

**Toggle ON:**
- `startAutoMode()`: thay vì tạo `IntersectionObserver` và observe toàn bộ
  `registeredImages`, duyệt qua `registeredImages` và gọi
  `Queue.enqueue(img)` trực tiếp cho từng ảnh.
- `registerImage()`: trong `tryRegister()`, nếu `autoStarted === true` VÀ
  eager mode đang bật cho phiên này, gọi `Queue.enqueue(img)` ngay thay vì
  `intersectionObserver.observe(img)` (biến `intersectionObserver` sẽ là
  `null` khi eager mode bật, dùng làm cờ rẽ nhánh).
- Không gọi `Queue.cancel()` ở nhánh eager (không có sự kiện
  "ra khỏi viewport" để trigger nó).
- Vì `Queue._pending` đã sort theo vị trí Y tuyệt đối trước mỗi lần dequeue
  (tính năng boundary-stitching trước đó), thứ tự xử lý vẫn ưu tiên ảnh gần
  vị trí đọc hiện tại trước, dù tất cả đã được enqueue cùng lúc.
- Ảnh lazy-load thật sự (site chỉ chèn `<img>` vào DOM khi gần tới, kiểu
  infinite-scroll) chỉ được enqueue khi nó THỰC SỰ xuất hiện trong DOM —
  giới hạn vật lý không vượt qua được. `MutationObserver` hiện có
  (`watchImages()`) vẫn bắt ảnh mới và gọi `registerImage()` như cũ; nhánh
  eager trong `registerImage()` sẽ enqueue ngay khi ảnh đó xuất hiện.

## 4. Toast hoàn thành (chỉ khi eager mode ON)

- Tạo `<div class="mot-toast">` append vào `<body>` khi cần hiện, style cố
  định góc dưới bên phải màn hình, `z-index: 2147483647` (đồng bộ với
  `.mot-layer`), tự động fade-out (CSS transition opacity) rồi remove khỏi
  DOM sau 3 giây.
- Nội dung: `Đã dịch xong {state.done}/{state.total} ảnh` — nếu
  `state.errors > 0`, thêm `(N lỗi)` vào cuối.
- Trigger: trong `finally` block xử lý xong 1 job của `Queue` (nơi hiện có
  `_active--; this._drain();`), ngay sau đó kiểm tra: nếu eager mode đang
  bật CHO PHIÊN NÀY và `this._pending.length === 0 && this._active === 0`,
  hiện toast. Vì `CONCURRENCY: 1` nên jobs hoàn tất tuần tự, mỗi lần chạm
  điều kiện rỗng là đúng 1 sự kiện "vừa xong" tự nhiên — không cần thêm cờ
  debounce.
- Infinite-scroll có thể thêm ảnh mới sau khi đã "xong" — toast sẽ hiện lại
  mỗi lần hàng đợi rỗng trở lại (không giới hạn 1 lần).

## 5. Error handling

- Không đổi hành vi lỗi hiện có: ảnh dịch lỗi vẫn được ghi vào `errorLog`,
  `state.errors` tăng, và người dùng vẫn có thể xem chi tiết qua nút dịch
  (khi đã `autoStarted`, bấm lại hiện `showErrorSummary()` nếu có lỗi).
- Toast không thay thế `showErrorSummary()` — chỉ báo tổng số, không liệt
  kê chi tiết lỗi từng ảnh.

## 6. Testing

Không có test suite tự động cho extension (thuần DOM/browser). Xác minh
thủ công: bật eager mode trong popup, mở 1 trang webtoon dài (nhiều ảnh),
kích hoạt dịch, xác nhận:
- Console log cho thấy TẤT CẢ ảnh hiện có trong DOM được enqueue ngay (không
  chờ cuộn tới).
- Toast hiện đúng số lượng khi hàng đợi rỗng lần đầu.
- Cuộn xuống để trigger thêm ảnh lazy-load mới (nếu site có) → xác nhận ảnh
  mới cũng tự enqueue, và toast hiện lại lần 2 khi xong đợt mới.
- Tắt eager mode, xác nhận hành vi quay lại y hệt trước đây (chỉ dịch ảnh
  gần viewport).
