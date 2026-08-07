# URL Cache Fast-path — Design

## 1. Problem (đã xác nhận bằng đo thực tế)

Overlay hiện trễ ~3.4s mỗi trang kể cả khi bản dịch ĐÃ có trong cache. Đo trên
hitomi (eager tắt, không nhiễu prefetch):

```
download=3603ms | hash=6ms | cacheGet=1ms
  trong đó: fetch+base64(bg)=3361ms | reencodePng=242ms
computeRegionComplexity=7ms | render=2ms
```

Root cause: `Cache` khóa theo **hash nội dung ảnh**, nên `translateAndRenderImage`
phải **tải + hash ảnh trước (~3.4s, chủ yếu là service worker fetch lại ảnh từ
CDN + base64 qua message channel)** rồi mới tra được cache — chạy trên MỌI trang,
kể cả khi kết quả đã sẵn sàng. Việc vẽ overlay thật sự chỉ ~13ms. Đây là lý do
prefetch/cache "đã xong" mà lật tới trang vẫn trễ.

## 2. Approach: tra cache theo URL trước khi tải

Thêm 1 ánh xạ **URL ảnh → hash nội dung** (nhẹ, chỉ 1 chuỗi hash mỗi URL) trong
`chrome.storage.local`. `translateAndRenderImage` tra theo URL TRƯỚC:

1. Lấy `url = img.currentSrc || img.src` (bỏ qua nếu `blob:`/`data:`).
2. `hash = Cache.getHashByUrl(url)`; nếu có → `result = Cache.get(hash, lang,
   engine)`. Có result → **đi thẳng tới vẽ overlay, BỎ hẳn tải+hash (~3.4s)**.
3. Không có (URL lạ / cache khác lang-engine) → đường cũ: `downloadImageBlob` →
   `hashBlob` → `Cache.get(hash)`; nếu vẫn chưa có thì dịch backend →
   `Cache.set`. Cuối đường này **lưu `Cache.setUrlHash(url, hash)`** để lần sau
   URL đó tra nhanh.
4. Prefetch hitomi (`prefetchHitomiGallery`) và eager webtoon: sau khi dịch xong
   1 ảnh, lưu luôn `setUrlHash(url, hash)` → lật tới trang đã prefetch là hiện
   TỨC THÌ (~15ms).

`Cache` khóa-hash giữ nguyên làm lớp dự phòng (cùng nội dung ở URL khác vẫn trúng
qua đường tải+hash; và url→hash chỉ là chỉ mục, không thay thế).

## 3. Chi tiết

### 3.1 Cache thêm 3 thành viên
- `_urlKey(url)`: `mot_urlhash_v${CFG.CACHE_VERSION}_${url}`. KHÔNG kèm
  lang/engine vì hash là hash NỘI DUNG ảnh (độc lập ngôn ngữ); lang/engine đã
  nằm trong khóa của `Cache.get(hash, lang, engine)`.
- `getHashByUrl(url)`: đọc `_urlKey(url)` → chuỗi hash | null.
- `setUrlHash(url, hash)`: ghi `{ [_urlKey(url)]: hash }`.

### 3.2 translateAndRenderImage
Đọc `targetLang`/`engine` sớm (đầu hàm). Thêm nhánh fast-path theo URL trước
`downloadImageBlob`. Đường MISS gọi `setUrlHash(url, hash)` sau khi có hash. Toàn
bộ phần sau (lọc dedup, computeRegionComplexity, render) DÙNG CHUNG cho cả 2
đường — chỉ khác việc `result` tới từ đâu. Fast-path KHÔNG có `blob` (không tải),
nên các bước sau chỉ được dùng `img` + `result.regions` (đã đúng: render/dedup/
complexity đều chỉ cần `img` và `result.regions`, không cần `blob`).

### 3.3 prefetchHitomiGallery
Sau `Cache.set(hash, ...)`, thêm `Cache.setUrlHash(url, hash)` (đã có sẵn `url`
và `hash` trong vòng lặp).

## 4. Giới hạn / đánh đổi

- URL hitomi có token đổi theo phiên (`.../1786093202/...`). CÙNG phiên (prefetch
  xong đọc ngay) → URL khớp → tức thì. KHÁC phiên → URL đổi → fast-path trượt →
  rơi về đường tải+hash (mất ~3.4s nhưng KHÔNG dịch lại vì hash-cache vẫn trúng).
  Chấp nhận được; khóa theo phần hash trong tên file để bền xuyên phiên là cải
  tiến sau (site-specific, YAGNI).
- `blob:`/`data:` URL: bỏ qua fast-path (URL không ổn định) → đường cũ như hiện
  tại.
- Không đổi hành vi lỗi; không đụng backend; không thêm quyền.
- CACHE_VERSION đã nằm trong `_urlKey` → bump version tự vô hiệu url→hash cũ.

## 5. Testing

Không có test tự động. Xác minh thủ công trên hitomi
(`https://hitomi.la/reader/4009730.html`) và 1 site webtoon:
- Bật eager, dịch; đợi vài trang prefetch xong (hoặc dịch 1 trang).
- Lật tới trang ĐÃ dịch → overlay hiện **gần như tức thì** (không còn khựng
  ~3.4s). Có thể tạm thêm log đo lại để xác nhận `download` bị bỏ qua ở fast-path.
- Lật tới trang CHƯA dịch → đường cũ (tải + backend) hoạt động bình thường.
- Đổi ngôn ngữ đích trong popup → dịch lại: fast-path theo URL vẫn tra đúng
  lang/engine (vì `result = Cache.get(hash, lang, engine)` sau khi lấy hash) →
  không trả nhầm bản dịch ngôn ngữ cũ.
- Không hồi quy site thường (ảnh src thật, không prefetch): lần đầu tải+dịch, lần
  sau URL-cache giúp nhanh.
