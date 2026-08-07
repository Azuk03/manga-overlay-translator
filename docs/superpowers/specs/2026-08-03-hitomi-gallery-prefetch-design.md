# Hitomi Gallery Background Pre-translate — Design

## 1. Problem

hitomi.la là reader **chuyển trang** (`hitomi.la/reader/<id>.html#N`, hash = số
trang), chỉ giữ ~trang hiện tại trong DOM. Tính năng eager (force-load nhiều
`<img>` như webtoon) KHÔNG dùng được ở đây. Người dùng muốn dịch **cả gallery**
(vd id 4009730, 69 trang) mà không phải bấm next từng trang, và **không muốn
màn hình tự nhảy** qua từng trang.

**Đã xác nhận thực tế trên hitomi (Console main-world của trang reader):**
- `galleryinfo.id = 4009730`, `galleryinfo.files` = 69 phần tử; mỗi file có
  `{hash, name, hasavif, haswebp?, width, height}`.
- Hàm dựng URL của chính hitomi tồn tại: `url_from_url_from_hash(id, file, ext)`
  trả về URL ảnh thật, vd
  `https://a1.gold-usergeneratedcontent.net/1786089602/3487/<hash>.avif`.
- Điều hướng hash (#33→#34) nạp ảnh nội dung mới, và pipeline dịch sẵn có ĐÃ tự
  dịch nó (xác nhận qua log `Cache MISS` sau khi lật).

Vì cache khóa theo **hash của blob ảnh** (không phải URL), ảnh dịch nền và ảnh
reader nạp khi lật là **cùng file → cùng hash → cache HIT** → overlay hiện tức
thì khi lật tới.

## 2. Approach: dịch nền cả gallery, không di chuyển màn hình

Khi eager mode bật và trang là reader hitomi:
1. Lấy đủ danh sách URL ảnh của gallery bằng cách **chạy 1 hàm nhỏ ở MAIN
   world** (qua `chrome.scripting.executeScript({world:'MAIN'})` từ background),
   đọc `galleryinfo` và gọi `url_from_url_from_hash` của chính hitomi cho từng
   file. Dùng lại hàm của hitomi nên bền với việc họ đổi `gg.js`.
2. Content script **dịch nền tuần tự** từng URL vào cache (tải qua background →
   hash → nếu chưa cache thì dịch → lưu). **Không chạm tới màn hình/điều hướng.**
3. Người dùng đọc bình thường; lật tới trang nào, reader nạp ảnh đó → pipeline
   sẵn có → cache HIT → overlay tức thì. (Phần này KHÔNG đổi.)

### 2.1 Vì sao chạy ở MAIN world qua `chrome.scripting.executeScript`

Content script chạy ở world CÔ LẬP, không đọc được biến/hàm của trang
(`galleryinfo`, `url_from_url_from_hash`). `chrome.scripting.executeScript` với
`world: 'MAIN'` chạy hàm trong world của trang (thấy các global đó) và **trả
thẳng giá trị về** (mảng URL) — sạch hơn tiêm `<script>` (không vướng CSP của
trang, không cần `web_accessible_resources`). Phải gọi từ **background service
worker** (không gọi được từ content script), nên content script gửi message
nhờ background chạy.

## 3. Components

### 3.1 manifest.json
Thêm `"scripting"` vào `permissions` (hiện có `storage`, `unlimitedStorage`).
`host_permissions: ["<all_urls>"]` đã đủ để executeScript vào tab.

### 3.2 background/background.js — handler mới
`chrome.runtime.onMessage` xử lý `type: 'HITOMI_GALLERY_URLS'`:
gọi `chrome.scripting.executeScript({ target:{tabId: sender.tab.id},
world:'MAIN', func })`. `func` (chạy trong trang):
- Nếu `typeof galleryinfo === 'undefined'` hoặc thiếu `galleryinfo.files` hoặc
  `typeof url_from_url_from_hash !== 'function'` → trả `{ ok:false }`.
- Ngược lại: `urls = galleryinfo.files.map(f => url_from_url_from_hash(
  galleryinfo.id, f, f.hasavif ? 'avif' : (f.haswebp ? 'webp' : 'avif')))`,
  trả `{ ok:true, urls }`.
- Bọc try/catch, lỗi → `{ ok:false, reason }`.
`sendResponse` mảng urls (hoặc `{ok:false}`). `return true` giữ kênh mở.

### 3.3 content-script/content.js
- `isHitomiReader()`: `hostname` khớp `hitomi.la` (chính hoặc subdomain) VÀ
  `pathname` khớp `/reader/<số>.html`.
- `getHitomiGalleryUrls()`: `sendMessageAsync({type:'HITOMI_GALLERY_URLS'})`,
  trả `urls` (mảng) hoặc `null` nếu `{ok:false}`/lỗi.
- `downloadBlobFromUrl(url)`: mirror đúng nhánh non-blob của
  `ApiAdapter.downloadImageBlob` — `sendMessageAsync({type:'DOWNLOAD_IMAGE',
  url})` → `base64ToBlob` → `reencodeToPng`. Đảm bảo hash KHỚP hash lúc điều
  hướng.
- `prefetchHitomiGallery(urls)`: đọc `targetLang`/`engine` 1 lần; lặp tuần tự
  từng url: `downloadBlobFromUrl` → `Cache.hashBlob` → `Cache.get`; nếu chưa có
  → `ApiAdapter.translateImage(blob)` → `Cache.set`. Lỗi 1 trang → bỏ qua,
  tiếp tục. Cập nhật toast tiến trình sau mỗi trang; toast hoàn tất khi xong.
- Móc vào nhánh eager của `startAutoMode()`: nếu `isHitomiReader()` → gọi
  `getHitomiGalleryUrls().then(urls => { if (urls?.length)
  prefetchHitomiGallery(urls); })` (fire-and-forget, chạy nền song song với
  eager thường). Không phải hitomi hoặc `urls` null → không làm gì đặc biệt
  (fallback: vẫn dịch-khi-lật qua pipeline sẵn có).

### 3.4 Toast tiến trình
Toast riêng, cập nhật text "Đang dịch nền gallery: K/69"; khi K==tổng đổi thành
"Đã dịch xong gallery 69/69" rồi tự ẩn. Tái dùng style `.mot-toast` sẵn có
(1 element cố định, cập nhật `textContent` thay vì tạo mới mỗi lần).

## 4. Data flow

```
startAutoMode() [eager, isHitomiReader]
  -> content: sendMessage HITOMI_GALLERY_URLS
  -> background: executeScript(world:MAIN) doc galleryinfo + url_from_url_from_hash
  -> tra ve [69 URL]
  -> content: prefetchHitomiGallery: moi URL -> downloadBlobFromUrl -> hash
       -> Cache.get? -> translateImage -> Cache.set   (tuan tu, nen)
  (song song) nguoi dung lat trang -> reader nap <img> -> pipeline san co
       -> downloadImageBlob -> hash -> Cache.get HIT -> render overlay
```

## 5. Error handling / fallback

- executeScript fail / `galleryinfo` không có / hàm đổi tên → `getHitomiGalleryUrls`
  trả null → không prefetch; vẫn dịch-khi-lật như hiện tại (không vỡ gì).
- 1 URL tải/dịch lỗi → bỏ qua trang đó, tiếp tục các trang khác.
- Prefetch tuần tự (backend `CONCURRENCY:1`), không tăng tải backend. Nếu người
  dùng lật tới 1 trang chưa prefetch xong, pipeline sẵn có tự dịch on-demand
  (cache MISS) — có thể trùng công 1 trang với prefetch (hiếm, vô hại vì cả 2
  đều check cache trước).

## 6. Giới hạn

- Riêng hitomi (dựa `galleryinfo` + `url_from_url_from_hash`). Hitomi đổi tên
  nội bộ → prefetch fail → tự fallback. Cần cập nhật nếu vỡ.
- Thêm quyền `"scripting"` (main-world execute). Không thêm host mới
  (`<all_urls>` đã có).
- hitomi là site người lớn — chỉ xử lý cấu trúc kỹ thuật cho công cụ dịch cá
  nhân; không tải/hiển thị ảnh nội dung ở phía phát triển.

## 7. Testing

Không có test tự động (thuần DOM/browser). Xác minh thủ công trên
`https://hitomi.la/reader/4009730.html`:
- Bật checkbox eager, mở reader, bấm dịch.
- Console: thấy prefetch chạy nền, lần lượt `Cache MISS`/dịch cho tới ~69 trang,
  toast tiến trình tăng dần tới 69; **màn hình KHÔNG tự nhảy trang**.
- Lật qua các trang: mỗi trang hiện overlay **tức thì** (`Cache HIT`), kể cả
  trang chưa từng xem.
- Lật tới trang prefetch chưa xong: dịch on-demand bình thường (không vỡ).
- Tắt eager: không prefetch; hành vi như cũ (chỉ dịch trang đang xem khi lật).
- Không hồi quy trên webtoon/site khác: `isHitomiReader()` false → không đụng
  luồng hitomi.
