# Cross-Image Boundary Stitching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix speech bubbles/sentences that a webtoon site's own image-slicing cuts across two adjacent `<img>` elements, by borrowing a strip from the next sibling image before sending each image to the backend for detection+translation.

**Architecture:** Before every backend translate call, find the next `<img>` on the page (by absolute page Y position), download its full bytes via the existing `ApiAdapter.downloadImageBlob()` (required — reading pixels directly from a cross-origin `<img>` via canvas produces a tainted canvas), slice its top `BOUNDARY_BORROW_HEIGHT` px, and append that strip below the current image's own canvas before sending. Rendering reuses the existing percentage-of-own-`naturalHeight` math unchanged (no clamping to 100%), so any detected region extending past the current image's own bounds naturally overflows into the next image's visual space via CSS (no `overflow:hidden` on `.mot-layer`, and adjacent images share the same displayed width). A dedup registry prevents the next image, when it processes on its own, from re-rendering content already drawn by the current image's borrowed strip.

**Tech Stack:** Plain JavaScript, `extension/content-script/content.js` only — no build step, no new files.

## Global Constraints

- Áp dụng ghép-biên cho **mọi ảnh** tự động (không cần bật/tắt riêng) — không thêm heuristic phát hiện cắt (đã cân nhắc và loại bỏ trong brainstorm — không đáng tin cậy 100%).
- **Không đọc pixel trực tiếp từ `<img>` cross-origin qua canvas** — phải luôn đi qua `ApiAdapter.downloadImageBlob()` đã có (tránh tainted canvas). Chỉ cắt canvas cục bộ SAU KHI đã có `Blob` thuần (không còn là `<img>` sống).
- Cache vẫn hash theo blob ảnh GỐC (`Cache.hashBlob(blob)` trước khi ghép) — không đổi kiến trúc cache hiện tại.
- Overlay dùng lại đúng công thức % hiện tại (theo `naturalHeight` GỐC của ảnh hiện tại, không phải canvas đã ghép) — không thêm giới hạn chặn ở 100%, không sửa `OverlayRenderer.render()`/`positionLayer()`.
- Chỉ **lát CUỐI CÙNG** của 1 ảnh đã bị tiling nội bộ (`CFG.TILE_MAX_H`) mới ghép-biên với ảnh kế tiếp thật — các lát trước giữ nguyên cơ chế `TILE_OVERLAP` đã có, không đổi.
- Không có test tự động cho phần extension — xác minh thủ công trên Chrome/Edge thật + backend Docker thật (khớp mọi plan trước của dự án này).
- Spec đầy đủ: `docs/superpowers/specs/2026-07-23-cross-image-boundary-stitching-design.md` — đọc trước khi bắt đầu, đặc biệt mục 3 (lý do bắt buộc dùng `downloadImageBlob`, không đọc DOM trực tiếp) và mục 8 (tương tác với tiling).

---

### Task 1: Ghép biên ảnh liền kề trước khi gửi backend

**Files:**
- Modify: `extension/content-script/content.js:46-47` (thêm `CFG.BOUNDARY_BORROW_HEIGHT`)
- Modify: `extension/content-script/content.js:708-716` (thêm khối hàm mới trước `translateAndRenderImage`)
- Modify: `extension/content-script/content.js:727-734` (nhánh Cache MISS trong `translateAndRenderImage`)
- Modify: `extension/content-script/content.js:347-364` (`ApiAdapter.translateImageTiled`)

**Interfaces:**
- Consumes: `ApiAdapter.downloadImageBlob(img)` (đã có, không đổi), `registeredImages` (Set, đã có, khai báo ở dòng 814 — tham chiếu tới nó từ hàm khai báo TRƯỚC đó trong file là hợp lệ trong JS, vì thân hàm chỉ được đánh giá lúc GỌI, không phải lúc khai báo — không sửa gì ở `registeredImages`/`registerImage()`).
- Produces: `findNextSiblingImage(img)`, `getStripFromNextImage(nextImg, stripHeightPx)`, `buildStitchedBlob(img, blob)` — Task 2 dùng lại các hàm này không đổi.

- [ ] **Step 1: Thêm `CFG.BOUNDARY_BORROW_HEIGHT`**

Đọc lại đúng nội dung hiện tại (dòng 46-47):
```javascript
    TILE_MAX_H: 4000,
    TILE_OVERLAP: 200,
```

Thay bằng:
```javascript
    TILE_MAX_H: 4000,
    TILE_OVERLAP: 200,
    // Ghep bien anh lien ke: muon them BOUNDARY_BORROW_HEIGHT px dau cua anh
    // KE TIEP truoc khi gui detect, de bong bong/cau van bi site tu cat
    // ngang giua 2 file anh van duoc nhin thay du. 500px du cho hau het bong
    // bong thuc te da quan sat (cao nhat ~300-400px). Xem spec
    // 2026-07-23-cross-image-boundary-stitching-design.md.
    BOUNDARY_BORROW_HEIGHT: 500,
```

- [ ] **Step 2: Thêm khối hàm ghép-biên trước `translateAndRenderImage`**

Đọc lại đúng nội dung hiện tại:
```javascript
  console.log('[MOT] OverlayRenderer/CSS da nap xong (Task 8).');

  // ===== Job — tai + dich + ve overlay cho 1 anh (dung chung cho Queue) =====
  const state = { total: 0, done: 0, errors: 0 };
```

Thay bằng (chèn khối mới giữa 2 phần, giữ nguyên phần sau):
```javascript
  console.log('[MOT] OverlayRenderer/CSS da nap xong (Task 8).');

  // ===== Ghep bien anh lien ke =====
  // Tim anh "ke tiep" theo toa do Y TUYET DOI tren trang (khong dua vao cau
  // truc DOM - moi site long <img> khac nhau). Dung de muon 1 dai bien phia
  // tren cua no, giup detector nhin thay tron ven noi dung bi site cat ngang
  // giua 2 file anh (xem spec 2026-07-23-cross-image-boundary-stitching-design.md).
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

  // Lay BOUNDARY_BORROW_HEIGHT px dau cua anh ke tiep. PHAI di qua
  // ApiAdapter.downloadImageBlob() (khong doc truc tiep pixel qua canvas tu
  // <img> song) - anh CDN cross-origin (khong co CORS header) se lam
  // TAINTED canvas ngay khi ve, giong ly do downloadImageBlob() da phai
  // relay qua background.js cho moi URL khong phai blob:/data:. Sau khi co
  // Blob thuan (khong con la <img> song), cat bang canvas moi an toan.
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

  // Ghep canvas anh hien tai + dai bien cua anh ke tiep (neu co/tai duoc).
  // Khong co anh ke tiep, hoac tai loi (mang, site chan...) -> tra ve blob
  // GOC khong doi, khong chan tien do dich anh hien tai.
  async function buildStitchedBlob(img, blob) {
    const nextImg = findNextSiblingImage(img);
    if (!nextImg) return blob;

    let stripBlob;
    try {
      stripBlob = await getStripFromNextImage(nextImg, CFG.BOUNDARY_BORROW_HEIGHT);
    } catch (err) {
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

  // ===== Job — tai + dich + ve overlay cho 1 anh (dung chung cho Queue) =====
  const state = { total: 0, done: 0, errors: 0 };
```

- [ ] **Step 3: Dùng `buildStitchedBlob()` trong nhánh Cache MISS**

Đọc lại đúng nội dung hiện tại (trong `translateAndRenderImage`, sau khi Step 2 đã chèn thêm dòng ở trên nên số dòng đã lệch — tìm bằng nội dung):
```javascript
      } else {
        log('Cache MISS, goi backend:', hash, targetLang, engine, img.currentSrc || img.src);
        result =
          img.naturalHeight > CFG.TILE_MAX_H
            ? await ApiAdapter.translateImageTiled(blob, img.naturalWidth, img.naturalHeight)
            : await ApiAdapter.translateImage(blob);
        await Cache.set(hash, targetLang, engine, result);
      }
```

Thay bằng:
```javascript
      } else {
        log('Cache MISS, goi backend:', hash, targetLang, engine, img.currentSrc || img.src);
        result =
          img.naturalHeight > CFG.TILE_MAX_H
            ? await ApiAdapter.translateImageTiled(blob, img.naturalWidth, img.naturalHeight, img)
            : await ApiAdapter.translateImage(await buildStitchedBlob(img, blob));
        await Cache.set(hash, targetLang, engine, result);
      }
```

- [ ] **Step 4: Sửa `ApiAdapter.translateImageTiled()` — chỉ ghép-biên lát cuối cùng**

Đọc lại đúng nội dung hiện tại:
```javascript
    async translateImageTiled(blob, naturalW, naturalH) {
      const tiles = await sliceImageIntoTiles(blob, naturalW, naturalH);
      log(
        'Webtoon dai (' + naturalH + 'px > TILE_MAX_H ' + CFG.TILE_MAX_H + 'px) - cat thanh',
        tiles.length,
        'lat, chong lan',
        CFG.TILE_OVERLAP,
        'px.'
      );
      const allRegions = [];
      for (const tile of tiles) {
        const result = await this.translateImage(tile.blob);
        for (const r of result.regions) {
          allRegions.push({ ...r, y: r.y + tile.yOffset });
        }
      }
      return { regions: dedupeRegions(allRegions) };
    },
```

Thay bằng:
```javascript
    async translateImageTiled(blob, naturalW, naturalH, img) {
      const tiles = await sliceImageIntoTiles(blob, naturalW, naturalH);
      log(
        'Webtoon dai (' + naturalH + 'px > TILE_MAX_H ' + CFG.TILE_MAX_H + 'px) - cat thanh',
        tiles.length,
        'lat, chong lan',
        CFG.TILE_OVERLAP,
        'px.'
      );
      const allRegions = [];
      for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i];
        // Chi lat CUOI CUNG moi thuc su giap ranh gioi voi anh ke tiep tren
        // trang - cac lat truoc da co TILE_OVERLAP xu ly rieng (xem spec
        // 2026-07-23-cross-image-boundary-stitching-design.md muc 8).
        const tileBlob = i === tiles.length - 1 ? await buildStitchedBlob(img, tile.blob) : tile.blob;
        const result = await this.translateImage(tileBlob);
        for (const r of result.regions) {
          allRegions.push({ ...r, y: r.y + tile.yOffset });
        }
      }
      return { regions: dedupeRegions(allRegions) };
    },
```

- [ ] **Step 5: Kiểm tra cú pháp**

Run: `node --check extension/content-script/content.js`
Expected: không lỗi.

- [ ] **Step 6: Xác minh thủ công**

Backend Docker phải đang chạy thật (`docker ps` xác nhận `manga_translator` Up).

1. Reload extension trong `chrome://extensions/`. Mở trang webtoons.com, episode 121 "The Stellar Swordmaster" (URL: `https://www.webtoons.com/en/action/the-stellar-swordmaster/s2-episode-121/viewer?title_no=5988&episode_no=121`), F5 để dịch lại từ đầu.
2. Cuộn tới đúng vị trí bong bóng "I SEE." (ảnh `0025`/`0026`) — xác nhận giờ hiện chữ Việt đầy đủ (trước đây hoàn toàn không dịch).
3. Cuộn tới đúng vị trí bong bóng "TAKE YOUR TIME." (ảnh `0029`/`0030`) — xác nhận cả 3 từ đều được dịch (trước đây "YOUR" hiện nguyên tiếng Anh xen giữa 2 từ tiếng Việt). **Ở bước này CÓ THỂ thấy chữ dịch bị vẽ 2 lần chồng lên nhau tại đúng ranh giới ảnh** — đây là hiện tượng ĐÃ BIẾT TRƯỚC, do Task 1 chưa có phần chống trùng (Task 2 xử lý việc này) — không phải lỗi mới, không cần điều tra thêm ở task này.
4. Kiểm tra Console — xác nhận không có lỗi JS nào (`Uncaught`/`TypeError`) khi cuộn qua các ảnh, kể cả ảnh cuối cùng của episode (không có ảnh kế tiếp — `findNextSiblingImage()` phải trả về `null` êm xuôi, không throw).
5. Dịch thử 1 ảnh không có bong bóng bị cắt (bất kỳ ảnh nào khác trong cùng episode) — xác nhận vẫn dịch đúng, không bị ảnh hưởng.

- [ ] **Step 7: Commit**

```bash
git add extension/content-script/content.js
git commit -m "Borrow next sibling image's top strip before translating, so bubbles split across site image tiles are fully detected"
```

---

### Task 2: Chống vẽ trùng khi ảnh kế tiếp tự phát hiện lại nội dung đã mượn

**Files:**
- Modify: `extension/content-script/content.js` (khối hàm ghép-biên đã thêm ở Task 1 — thêm registry + hàm dedup ngay sau)
- Modify: `extension/content-script/content.js` (`translateAndRenderImage` — lọc `result.regions` trước khi vẽ)

**Interfaces:**
- Consumes: `iou(a, b)` (đã có, không đổi — nhận 2 object `{x,y,w,h}` bất kỳ, không chỉ trong cùng 1 ảnh).
- Produces: không có gì task khác phụ thuộc thêm (đây là task cuối của plan).

- [ ] **Step 1: Thêm registry + hàm dedup**

Tìm đúng vị trí `buildStitchedBlob` đã thêm ở Task 1 (kết thúc bằng dòng `}` đóng hàm, ngay trước comment `// ===== Job — tai + dich + ve overlay...`). Đọc lại đúng đoạn cuối của `buildStitchedBlob` để xác nhận vị trí:
```javascript
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  // ===== Job — tai + dich + ve overlay cho 1 anh (dung chung cho Queue) =====
  const state = { total: 0, done: 0, errors: 0 };
```

Thay bằng (chèn thêm registry + 2 hàm mới ngay sau `buildStitchedBlob`, trước phần "Job"):
```javascript
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  // Registry toan cuc: moi vung chu da duoc VE THAT SU (khong phai chi
  // detect duoc) - luu toa do TUYET DOI tren trang, dung de tranh ve trung
  // khi anh ke tiep tu phat hien lai dung noi dung da bi anh truoc muon.
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

  function registerRenderedRegion(img, region) {
    renderedPageBBoxes.push(toPageBBox(img, region));
  }

  // ===== Job — tai + dich + ve overlay cho 1 anh (dung chung cho Queue) =====
  const state = { total: 0, done: 0, errors: 0 };
```

- [ ] **Step 2: Lọc vùng chữ trùng trước khi vẽ trong `translateAndRenderImage`**

Đọc lại đúng nội dung hiện tại:
```javascript
      const busyFlags = await computeRegionComplexity(result.regions);
      result.regions.forEach((r, i) => {
        r.busy = busyFlags[i];
      });
      await OverlayRenderer.render(img, result.regions);
```

Thay bằng (thêm bước lọc NGAY TRƯỚC dòng tính `busyFlags`, áp dụng cho CẢ cache HIT lẫn MISS vì `result.regions` tới đây đã hợp nhất từ cả 2 nguồn):
```javascript
      // Loc bo vung chu da duoc anh TRUOC ve roi (qua ghep-bien muon dai
      // tren cua anh nay) - tranh ve trung 2 lan cung 1 noi dung (xem spec
      // 2026-07-23-cross-image-boundary-stitching-design.md muc 6).
      result.regions = result.regions.filter((r) => {
        if (isDuplicateOfRendered(img, r)) return false;
        registerRenderedRegion(img, r);
        return true;
      });
      const busyFlags = await computeRegionComplexity(result.regions);
      result.regions.forEach((r, i) => {
        r.busy = busyFlags[i];
      });
      await OverlayRenderer.render(img, result.regions);
```

- [ ] **Step 3: Kiểm tra cú pháp**

Run: `node --check extension/content-script/content.js`
Expected: không lỗi.

- [ ] **Step 4: Xác minh thủ công**

Backend Docker phải đang chạy thật.

1. Reload extension, F5 lại trang webtoons.com episode 121, dịch lại từ đầu.
2. Cuộn tới bong bóng "I SEE." (`0025`/`0026`) — xác nhận dịch đầy đủ, đúng 1 lớp chữ (không chồng 2 lần như Task 1 có thể đã thấy).
3. Cuộn tới bong bóng "TAKE YOUR TIME." (`0029`/`0030`) — xác nhận cả câu dịch đúng 1 lớp, không còn hiện tượng vẽ chồng đã thấy ở Task 1 Step 6.
4. Cuộn qua vài chục ảnh liên tục (nhiều bong bóng khác nhau, cả bị cắt lẫn không bị cắt) — xác nhận không thấy overlay nào bị vẽ 2 lần chồng lên nhau ở bất kỳ đâu.
5. Cuộn lên lại (test cache HIT cho các ảnh đã dịch) — xác nhận không lỗi, không xuất hiện trùng lặp mới khi tải lại từ cache.

- [ ] **Step 5: Commit**

```bash
git add extension/content-script/content.js
git commit -m "Deduplicate rendered regions across adjacent images to avoid double-drawing borrowed boundary content"
```

---

## Final integration check (sau khi xong cả 2 task — cần con người, không thể tự động hoá)

- [ ] Chạy lại toàn bộ 5 bước kiểm thử ở spec mục 11 một lượt cuối, sau khi cả 2 task đã commit.
- [ ] Dịch thử 1 trang KHÁC (site/manga khác, không phải "The Stellar Swordmaster") để xác nhận tính năng không chỉ hoạt động đúng cho 2 case đã biết mà tổng quát cho site khác cùng kiểu cuộn dọc liên tục.
- [ ] `git log --oneline` từ commit đầu plan tới cuối — đối chiếu đúng 2 commit (1 cho mỗi task).
- [ ] Xác nhận không có lỗi Console mới xuất hiện so với trước khi có tính năng này (dịch 1 trang dài, cuộn từ đầu tới cuối, theo dõi Console liên tục).
