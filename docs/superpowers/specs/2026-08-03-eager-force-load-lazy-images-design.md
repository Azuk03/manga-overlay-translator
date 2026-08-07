# Eager Mode: Force-load Lazy Images — Design

## 1. Problem

Tính năng eager (`mot_eager_translate`, đã merge) hứa "dịch trước toàn bộ ảnh
không đợi cuộn tới", nhưng thực tế chỉ dịch được các ảnh ĐANG có nội dung
thật trong DOM. Site webtoon lazy-load: `<img>` chưa cuộn tới chỉ mang `src`
placeholder (trong suốt, kích thước nhỏ) nên KHÔNG qua `ImageFinder.isCandidate`
(đòi `naturalWidth >= MIN_NW`) → không được `registerImage` → không dịch. Kết
quả: eager chỉ bắt được đoạn ảnh đã cuộn qua, không phải cả chương.

**Đã xác nhận thực tế trên webtoons.com** (episode the-patron-of-villains ep33,
lấy HTML thô bằng curl):
- `<div id="_imageList">` chứa đúng **164** `<img class="_images">` — toàn bộ
  trang của tập.
- **164/164** ảnh mang `data-url` = URL ảnh THẬT ngay trong HTML gốc (vd
  `..._Episode_33_0001.jpg?type=q90`), `src` chỉ là placeholder
  `bg_transparency.png`. Webtoons tự copy `data-url`→`src` khi cuộn tới.
- **Không ảnh nào** có `loading="lazy"` → chỉ cần gán `src` là trình duyệt
  tải ảnh thật ngay, kể cả ngoài màn hình.

## 2. Approach: "Force-load lazy images"

Khi eager mode đang bật (trong `startAutoMode()`), quét mọi `<img>` có URL ảnh
thật giấu trong data-attribute mà `src` chưa trỏ tới URL đó, rồi **copy URL đó
vào `src`** để ép trình duyệt tải ngay. Sau khi ảnh tải xong, pipeline SẴN CÓ
tự lo phần còn lại: `load` event → `registerImage`/`tryRegister` (giờ
`isCandidate` qua vì ảnh đã có kích thước thật) → eager enqueue → dịch → vẽ
overlay. **Không cần đường tải/dịch mới.**

Đây là bản chất y hệt việc webtoons tự làm khi cuộn, nhưng làm cho TẤT CẢ ảnh
cùng lúc, không cần cuộn.

### 2.1 Data-attribute nào

Thử theo thứ tự ưu tiên, lấy giá trị đầu tiên là URL `http(s)`:
`data-url`, `data-src`, `data-original`, `data-lazy-src`.

### 2.2 Điều kiện copy

Với mỗi `<img>`: `const u = getLazyUrl(img)`. Nếu `u` tồn tại VÀ `img.src !== u`
→ `img.src = u`.
- Trên webtoon: `src` = placeholder ≠ `data-url` → gán (ép tải).
- Ảnh đã cuộn qua (webtoons đã tự gán `src` = `data-url`): `src === u` → bỏ
  qua, không tải lại.

### 2.3 Điểm móc vào code

Thêm hàm `forceLoadLazyImages()` trong `content.js`. Gọi trong nhánh eager của
`startAutoMode()` (khi `eagerModeActive === true`), TRƯỚC vòng
`registeredImages.forEach(enqueue)` hiện có. Ảnh mới tải xong sẽ tự enqueue qua
`load` listener mà `registerImage` đã gắn cho mọi `<img>` từ `watchImages()`.

Chỉ chạy khi eager bật — **không** đụng hành vi mặc định (eager tắt = y nguyên).

## 3. Vì sao tốt hơn auto-scroll (phương án từng cân nhắc)

- Không cuộn, không nhảy trang; lấy đủ 100% ảnh tức thì vì URL có sẵn.
- Tái dùng toàn bộ pipeline; code mới rất nhỏ.
- Chạy với mọi site dùng lazy-load kiểu data-attribute (rất phổ biến), không
  riêng webtoons.
- Không cần lưu/khôi phục vị trí cuộn, không cần cơ chế hủy sweep.

## 4. Giới hạn / đánh đổi

- **Site lazy-load thuần JS không có data-attribute** (URL chỉ sinh sau khi JS
  chạy lúc cuộn): hàm này không tìm thấy URL → không ép tải được các ảnh đó.
  Số này hiếm. Auto-scroll để dành làm fallback TƯƠNG LAI, ngoài phạm vi lần
  này.
- **Nạp nhiều ảnh cùng lúc** (webtoon ~150-170 ảnh): nặng mạng/bộ nhớ. Trình
  duyệt tự giới hạn số kết nối đồng thời (~6/host) và xếp hàng phần còn lại;
  việc DỊCH vẫn tuần tự qua Queue (`CONCURRENCY: 1`) nên không tăng tải backend.
  Chấp nhận được; chia lô để sau nếu cần (YAGNI).
- **Ảnh thêm vào DOM SAU** thời điểm bấm dịch (không phải trường hợp webtoons —
  toàn bộ ảnh có sẵn từ đầu): lần này chỉ ép tải các `<img>` có mặt lúc chạy
  `startAutoMode()`. Đủ cho webtoons; mở rộng sau nếu gặp site cần.
- **False positive** (data-attr không phải URL ảnh): chỉ copy URL `http(s)`;
  `isCandidate` (`naturalWidth >= MIN_NW`) lọc tiếp ảnh không phải nội dung
  truyện. Chấp nhận được.
- Rủi ro nhỏ: JS lazy-load riêng của site có thể gán lại `src`. Ít khả năng
  (các script này thường bỏ qua ảnh đã có `src`). Xác minh khi test.

## 5. Testing

Không có test tự động cho extension (thuần DOM/browser). Xác minh thủ công trên
chính episode đã khảo sát:
`https://www.webtoons.com/en/fantasy/the-patron-of-villains/episode-33/viewer?title_no=9321&episode_no=33`
- Bật checkbox eager, bấm dịch NGAY khi mới mở trang (chưa cuộn).
- Xác nhận (Console): tất cả ~164 ảnh lần lượt được enqueue + dịch mà KHÔNG cần
  cuộn; Queue xử lý theo thứ tự Y từ trên xuống.
- Toast cuối cùng hiện tổng ~164 ảnh.
- Tắt checkbox eager → xác nhận hành vi quay lại như cũ (chỉ dịch ảnh gần
  viewport, không ép tải).
- Kiểm tra không hồi quy trên trang không lazy-load (ảnh src thật sẵn) — vẫn
  dịch bình thường.
