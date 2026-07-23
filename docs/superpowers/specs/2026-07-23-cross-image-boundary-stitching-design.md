# Ghép biên ảnh liền kề (cross-image boundary stitching) — Design

## 1. Bối cảnh & mục tiêu

Xác nhận trong phiên này (2 ví dụ thật, webtoons.com "The Stellar Swordmaster" ep. 121): trên các site đọc dạng cuộn dọc liên tục, tranh gốc thường bị site tự cắt thành nhiều file `<img>` riêng biệt, và ranh giới cắt **không tôn trọng ranh giới bong bóng thoại/câu văn**.

- Ca 1: bong bóng "I SEE." nằm vắt giữa 2 ảnh (`0025`/`0026`) — không ảnh nào detect được (0 vùng chữ cho bong bóng này ở cả 2 phía).
- Ca 2: bong bóng "TAKE YOUR TIME." — "TAKE" nằm trọn trong ảnh `0029` (detect+dịch đúng thành "LẤY"), "TIME." nằm trọn trong ảnh `0030` (dịch đúng), nhưng "YOUR" nằm đúng ngay điểm cắt — không đủ pixel nguyên vẹn ở bên nào để OCR nhận diện, nên **không bao giờ được dịch**, hiện nguyên tiếng Anh xen giữa 2 từ đã dịch.

Vì extension xử lý từng `<img>` hoàn toàn độc lập (không có khái niệm "ảnh liền kề"), bất kỳ nội dung nào rơi đúng vào điểm cắt sẽ bị bỏ sót vĩnh viễn. Đây không phải lỗi OCR/GPT — là giới hạn kiến trúc: detector không bao giờ được nhìn thấy đủ ngữ cảnh để tìm ra vùng chữ đó.

**Mục tiêu:** trước khi gửi backend, ghép thêm 1 dải biên phía trên của ảnh kế tiếp vào cuối ảnh hiện tại, để detector luôn có đủ ngữ cảnh nhìn thấy trọn vẹn nội dung bị cắt — áp dụng tự động cho **mọi ảnh**, không cần cấu hình/bật tắt riêng.

## 2. Xác định "ảnh kế tiếp"

Không dựa cấu trúc DOM (mỗi site lồng `<img>` trong cấu trúc khác nhau). Thay vào đó: trong số các `<img>` đã đăng ký (`registeredImages`), sắp xếp theo **toạ độ Y tuyệt đối trên trang** (`img.getBoundingClientRect().top + window.scrollY`), ảnh có Y lớn hơn gần nhất (nhưng đã load xong, có `naturalWidth`) là "ảnh kế tiếp".

```javascript
function findNextSiblingImage(img) {
  const myTop = img.getBoundingClientRect().top + window.scrollY;
  let best = null;
  let bestTop = Infinity;
  for (const candidate of registeredImages) {
    if (candidate === img) continue;
    if (!candidate.naturalWidth) continue; // chua load xong, bo qua
    const top = candidate.getBoundingClientRect().top + window.scrollY;
    if (top > myTop && top < bestTop) {
      best = candidate;
      bestTop = top;
    }
  }
  return best;
}
```

Không tìm thấy ảnh kế tiếp (ảnh cuối trang, hoặc ảnh kế tiếp chưa load xong tại thời điểm này) → bỏ qua việc ghép, xử lý như hiện tại (không chặn/chờ đợi).

## 3. Lấy dải biên của ảnh kế tiếp — PHẢI qua relay `downloadImageBlob`, không đọc trực tiếp DOM

**Sửa lại sau khi tự phát hiện sai lầm lúc viết plan:** ban đầu spec này định đọc trực tiếp pixel từ `<img>` kế tiếp qua canvas (tưởng nhầm là tránh được tải mạng thêm). Nhưng đọc lại code hiện có mới thấy: `imageElementToBlob()` (đọc pixel qua canvas) chỉ an toàn với ảnh `blob:`/`data:` URL — ảnh CDN cross-origin bình thường (mọi ảnh test thực tế trong dự án này đều thuộc loại này, vd `webtoon-phinf.pstatic.net`) sẽ làm **tainted canvas**, khiến `canvas.toBlob()` thất bại. Đây chính là lý do `ApiAdapter.downloadImageBlob()` hiện tại phải relay qua `background.js` (dùng `fetch()` ở tầng network, không đụng DOM/canvas) cho mọi URL không phải `blob:`/`data:`.

**Giải quyết:** tái dùng đúng `ApiAdapter.downloadImageBlob(nextImg)` đã có (đã xử lý đúng mọi trường hợp URL) để tải TRỌN ảnh kế tiếp, rồi cắt lấy dải biên bằng canvas cục bộ — an toàn ở bước này vì lúc đó chỉ còn là 1 `Blob` thuần trong bộ nhớ (không còn là tham chiếu tới `<img>` cross-origin sống), không bị tainted:

```javascript
async function getStripFromNextImage(nextImg, stripHeightPx) {
  const fullBlob = await ApiAdapter.downloadImageBlob(nextImg);
  const bitmap = await createImageBitmap(fullBlob);
  const h = Math.min(stripHeightPx, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, bitmap.width, h, 0, 0, bitmap.width, h);
  bitmap.close?.();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
```

Không còn cần kiểm tra `nextImg.complete` — `downloadImageBlob()` tự tải qua mạng bất kể ảnh đã hiển thị trong DOM hay chưa, miễn `nextImg` đã có `src`/`currentSrc` thật (đảm bảo vì `findNextSiblingImage()` chỉ xét ảnh trong `registeredImages`, tức đã qua `ImageFinder.isCandidate()` — không phải placeholder `data:`). Nếu `downloadImageBlob()` ném lỗi (mạng lỗi, site chặn...) — bắt lỗi, bỏ qua ghép cho lần đó, không chặn tiến độ dịch ảnh hiện tại.

**Hệ quả:** không còn "tối ưu đọc DOM miễn phí" — mọi lần ghép đều tốn 1 lần tải mạng thêm cho ảnh kế tiếp (xem lại mục 10).

## 4. Ghép canvas + gửi backend

`CFG.BOUNDARY_BORROW_HEIGHT = 500` (px) — đủ rộng cho hầu hết bong bóng thoại thực tế (dựa trên các ví dụ đã quan sát, bong bóng cao nhất gặp được khoảng 300-400px).

Trước khi gọi `ApiAdapter.translateImage()`, ghép canvas ảnh hiện tại + dải biên (nếu có):

```javascript
async function buildStitchedBlob(img, blob) {
  const nextImg = findNextSiblingImage(img);
  if (!nextImg) return blob;

  let stripBlob;
  try {
    stripBlob = await getStripFromNextImage(nextImg, CFG.BOUNDARY_BORROW_HEIGHT);
  } catch (err) {
    // Khong tai duoc anh ke tiep (loi mang, site chan...) - bo qua ghep,
    // KHONG chan tien do dich anh hien tai.
    return blob;
  }

  const [currentBitmap, stripBitmap] = await Promise.all([
    createImageBitmap(blob),
    createImageBitmap(stripBlob),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = currentBitmap.width;
  canvas.height = currentBitmap.height + stripBitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(currentBitmap, 0, 0);
  ctx.drawImage(stripBitmap, 0, currentBitmap.height);
  currentBitmap.close?.();
  stripBitmap.close?.();

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
```

Ảnh gửi backend giờ cao hơn `naturalHeight` gốc (nếu ghép được). Toạ độ vùng chữ trả về (`r.y`, `r.h`) tính theo canvas ĐÃ GHÉP — nhưng mục 5 dùng `naturalHeight` GỐC (không đổi) làm mẫu số khi tính %, nên không cần biết đã ghép thêm bao nhiêu px — vùng chữ vượt quá giới hạn ảnh gốc tự động có `% > 100`, tạo hiệu ứng tràn mong muốn mà không cần truyền riêng giá trị đã mượn.

## 5. Vẽ overlay — tận dụng tràn tự nhiên, không cần tính toạ độ 2 ảnh

`.mot-layer` không có `overflow: hidden`, và các ảnh liền kề trong 1 dải cuộn luôn cùng chiều rộng hiển thị (giả định đã quan sát đúng ở mọi site test). Vì vậy: **giữ nguyên công thức % hiện tại** (tính theo `naturalHeight` GỐC của ảnh hiện tại, không phải canvas đã ghép), **không chặn ở 100%** — vùng chữ có `top% + height% > 100%` sẽ tự nhiên tràn xuống đúng vị trí ảnh kế tiếp trên trang, không cần biết rect của ảnh đó.

Không cần sửa `OverlayRenderer.render()` hay `positionLayer()` — code hiện tại đã tính % dựa trên `naturalW`/`naturalH` của ảnh hiện tại (không phải canvas ghép); chỉ cần **không thêm giới hạn chặn (`Math.min(..., 100)`) nào** vào công thức đó.

## 6. Tránh vẽ trùng (dedup giữa các ảnh)

Nội dung trong dải biên đã mượn sẽ bị ảnh kế tiếp tự phát hiện lại khi đến lượt nó xử lý (nó không biết là đã bị mượn). Dùng lại `iou()` đã có (viết lại tổng quát hơn để nhận toạ độ tuyệt đối thay vì toạ độ trong 1 ảnh), cộng thêm 1 registry dùng chung:

```javascript
// Registry toan cuc: moi vung chu da duoc VE THAT SU (khong phai chi detect
// duoc) - luu toa do TUYET DOI tren trang, dung de tranh ve trung khi anh
// ke tiep tu phat hien lai dung noi dung da bi anh truoc muon.
const renderedPageBBoxes = [];

function toPageBBox(img, region) {
  const rect = img.getBoundingClientRect();
  const pageTop = rect.top + window.scrollY;
  const scale = rect.height / img.naturalHeight;
  return {
    x: rect.left + region.x * scale,
    y: pageTop + region.y * scale,
    w: region.w * scale,
    h: region.h * scale,
  };
}

function isDuplicateOfRendered(img, region) {
  const candidate = toPageBBox(img, region);
  return renderedPageBBoxes.some((r) => iou(r, candidate) > 0.5);
}
```

Trước khi `OverlayRenderer.render()` vẽ 1 vùng chữ, kiểm tra `isDuplicateOfRendered()` — trùng thì bỏ qua (không vẽ, không tính vào `state.done` region count), không trùng thì vẽ bình thường VÀ thêm bbox tuyệt đối của nó vào `renderedPageBBoxes`.

**Yêu cầu ngầm:** ảnh hiện tại phải được xử lý XONG (đã ghi vào `renderedPageBBoxes`) trước khi ảnh kế tiếp bắt đầu xử lý, để dedup có tác dụng. Vì `CFG.CONCURRENCY: 1` và thứ tự xử lý theo thứ tự cuộn (trên xuống dưới), điều này hầu như luôn đúng trong thực tế — không phải ràng buộc cứng, chỉ là giả định hợp lý (nếu vi phạm hiếm khi xảy ra, hệ quả chỉ là thỉnh thoảng vẽ trùng 1 vùng, không phải lỗi nghiêm trọng).

## 7. Cache

Vẫn hash theo blob ảnh GỐC (`Cache.hashBlob(blob)` trước khi ghép), không phải canvas đã ghép — giữ nguyên kiến trúc cache hiện tại (key theo `hash, targetLang, engine`). Lý do: mục đích cache là tránh dịch lại đúng 1 ảnh khi cuộn qua lại, ghép-biên chỉ là chi tiết triển khai nội bộ của lần dịch đó.

## 8. Tương tác với tiling ảnh dài (`CFG.TILE_MAX_H`)

2 tính năng độc lập, xử lý 2 hướng ngược nhau (tiling: 1 ảnh quá to bị CẮT NHỎ; ghép-biên: nhiều ảnh nhỏ được GHÉP THÊM). Khi 1 ảnh vừa đủ cao để kích hoạt tiling nội bộ (`img.naturalHeight > CFG.TILE_MAX_H`) VÀ có ảnh kế tiếp cần mượn:

- Các lát (tile) không phải lát cuối: giữ nguyên cơ chế chồng lấn nội bộ đã có (`TILE_OVERLAP`), không liên quan gì ảnh khác.
- **Chỉ lát CUỐI CÙNG** của ảnh đó mới thực hiện ghép-biên với ảnh kế tiếp thật sự (bên ngoài ảnh hiện tại) — vì chỉ lát cuối mới thực sự giáp ranh giới với ảnh tiếp theo trên trang.

`translateImageTiled()` sửa: khi xử lý tile cuối cùng trong vòng lặp, gọi `buildStitchedBlob()` cho tile đó trước khi gửi, thay vì gửi tile thô.

## 9. Giới hạn đã biết

- Giả định các ảnh liền kề cùng chiều rộng hiển thị, sát khít nhau không khoảng cách — đúng với mọi site đã test trong dự án này (webtoons.com, Naver). Nếu gặp site có margin/khoảng cách giữa ảnh, hoặc ảnh liền kề khác chiều rộng, phần overlay tràn (mục 5) sẽ lệch vị trí mà không báo lỗi — chưa xử lý, cần phát hiện qua test thực tế nếu gặp.
- `CFG.BOUNDARY_BORROW_HEIGHT = 500` là hằng số cố định — bong bóng cao hơn 500px vẫn có thể bị cắt (rất hiếm gặp trong thực tế đã quan sát).
- Không giải quyết trường hợp bong bóng nằm đè lên tranh vẽ nhiều màu (không phải nền trắng) tại điểm cắt — không ảnh hưởng gì thêm so với hiện tại (không làm xấu đi, chỉ đơn giản là detector vẫn xử lý như một ảnh ghép bình thường).

## 10. Ảnh hưởng tốc độ

**Cập nhật sau khi sửa mục 3:** không có cách nào đọc pixel ảnh kế tiếp miễn phí (canvas-tainting với ảnh CDN cross-origin) — mọi lần ghép đều tốn 1 lần tải mạng thêm qua `downloadImageBlob(nextImg)`, cho **mọi ảnh**, không chỉ ảnh bị cắt thật:

- Thêm 1 lần tải + giải mã TRỌN ảnh kế tiếp (dù chỉ dùng 500px đầu) — chi phí tỉ lệ với kích thước đầy đủ của ảnh kế tiếp, không phải chỉ phần thực dùng.
- Backend nhận ảnh cao hơn 500px — tăng nhẹ thời gian inpaint; ít ảnh hưởng bước detect vì detector đã resize về độ phân giải cố định `1280x2048` bất kể kích thước gốc.
- Ảnh kế tiếp tải lỗi (mạng, site chặn) → bắt lỗi, bỏ qua ghép cho lần đó, không chặn tiến độ.
- Đã cân nhắc và **chấp nhận đánh đổi này có chủ đích** (xem hội thoại brainstorm): phương án heuristic phát hiện cắt ở mép để tránh tải thừa được cân nhắc nhưng loại bỏ vì không đáng tin cậy 100% (không phân biệt được viền bong bóng bị cắt với nét vẽ tranh bình thường khi bong bóng đè lên nền nhiều màu) và thêm 1 lớp tham số cần tinh chỉnh riêng. Ưu tiên đơn giản, đúng mọi trường hợp, chấp nhận chậm hơn đôi chút mỗi ảnh.

## 11. Kiểm thử (thủ công — dự án không có test tự động cho phần này)

1. Dịch lại đúng 2 case đã phát hiện (episode 121, ảnh 0025/0026 và 0029/0030) — xác nhận "I SEE." và "YOUR" giờ được dịch đầy đủ, không còn xen tiếng Anh.
2. Dịch 1 trang bình thường không có bong bóng bị cắt — xác nhận không có overlay vẽ trùng/lệch, chất lượng dịch không giảm so với trước.
3. Cuộn qua lại (test cache) — xác nhận `Cache HIT` vẫn hoạt động đúng cho ảnh đã dịch.
4. Tìm 1 ảnh đủ cao kích hoạt tiling nội bộ (nếu có sẵn) VÀ có ảnh kế tiếp — xác nhận lát cuối cùng ghép đúng với ảnh kế tiếp, các lát trước không bị ảnh hưởng.
5. Ảnh cuối cùng của trang/chương (không có ảnh kế tiếp) — xác nhận xử lý bình thường, không lỗi khi `findNextSiblingImage()` trả về `null`.

## 12. Cấu trúc file thay đổi

```
manga/extension/content-script/content.js
  - Them: CFG.BOUNDARY_BORROW_HEIGHT
  - Them: findNextSiblingImage(img)
  - Them: getStripFromNextImage(nextImg, stripHeightPx)
  - Them: buildStitchedBlob(img, blob)
  - Them: renderedPageBBoxes (registry), toPageBBox(img, region), isDuplicateOfRendered(img, region)
  - Sua: ApiAdapter.translateImage() - goi buildStitchedBlob() truoc khi gui, dung blob da ghep
  - Sua: translateImageTiled() - chi ghep bien cho tile CUOI CUNG
  - Sua: OverlayRenderer.render() (hoac noi goi no trong translateAndRenderImage) - kiem tra isDuplicateOfRendered() truoc khi ve moi vung, ghi vao renderedPageBBoxes sau khi ve
```
