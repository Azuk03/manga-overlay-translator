# Overlay Safe-Layout + Decoupled Boundary Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two rendering-quality bugs in the manga overlay extension: (1) CJK vertical-text overlays colliding when reshaped horizontal because the reshape has no notion of a neighbor-safe limit, and (2) the boundary-stitch toggle's tradeoff (shrinks detection resolution for the whole image when on, misses boundary-spanning text when off).

**Architecture:** Component 1 adds a `_computeSafeBounds(regions)` pass in `OverlayRenderer` that clamps each region's horizontal-reshape target against the midpoint between it and its real neighbors' original bboxes, so two reshaped boxes can never cross into each other regardless of how each individually wants to grow. Component 2 replaces "concatenate a borrowed strip onto the main image before detecting" with two independent backend calls: the main image at its own natural size (no resolution loss), plus a small standalone crop of the seam (last 500px of current + first 500px of next) detected on its own — its regions are coordinate-translated back and merged, reusing the existing cross-image dedup registry unchanged.

**Tech Stack:** Plain JavaScript, `extension/content-script/content.js` only — no build step, no new production files. Test fixtures added under `fixtures/`.

## Global Constraints

- Không có test tự động cho phần extension (không build step, không test runner) — xác minh bằng `node --check` (cú pháp) + 1 script Node độc lập (thuật toán, xem Task 1) + xác minh thủ công trên Chrome/Edge thật + backend Docker thật, khớp quy ước mọi plan trước của dự án này.
- Backend Docker (`manga_translator`) phải đang chạy thật khi xác minh thủ công — kiểm tra bằng `docker ps`.
- Không sửa `_fitFontSize`/`_fitTextboxFont`/`_measureWrappedHeight` — các hàm này đã tổng quát theo kích thước khung được truyền vào, không cần đổi.
- Component 1 (an toàn layout) hoàn toàn client-side, KHÔNG cần bump `CFG.CACHE_VERSION` — dữ liệu cache (`result.regions` từ backend) không đổi, chỉ cách RENDER thay đổi, áp dụng ngay cho cache cũ khi vẽ lại.
- Component 2 (ghép biên) làm thay đổi tập region được cache cho ảnh có stitch bật → PHẢI bump `CFG.CACHE_VERSION` (xem Task 3).
- Spec đầy đủ: `docs/superpowers/specs/2026-08-12-overlay-safe-layout-and-boundary-detection-design.md` — đọc trước khi bắt đầu. Đặc biệt: Component 1 dùng **midpoint giữa 2 mép GỐC** làm ranh giới chung (không phải khoảng cách 1 chiều tới mép hàng xóm — cách đó đã bị chứng minh SAI, xem spec mục "An earlier version...").
- Test fixture CJK: `fixtures/cjk_vertical_test.png`/`.html` (ảnh tổng hợp, KHÔNG lấy từ site thật — tránh vấn đề bản quyền, xem spec). `fixtures/cjk_vertical_test_detect.txt` là kết quả detect THẬT đã xác nhận (5 vùng) — dùng làm input cho Task 1's automated check.
- Test webtoon thật: `https://www.webtoons.com/en/action/the-stellar-swordmaster/s2-episode-121/viewer?title_no=5988&episode_no=121` (đúng trang user đã lấy 2 lần dịch so sánh — xem spec mục "Problem B", có sẵn số liệu mốc: bật-cũ = detect rộng 1280px/377 dòng OCR; tắt = detect rộng 1536px/260 dòng OCR).

---

### Task 1: Safe-bounds collision clamp

**Files:**
- Modify: `extension/content-script/content.js:685-706` (`_reshapeForHorizontalText` — thêm `_computeSafeBounds` ngay trước, sửa signature)
- Modify: `extension/content-script/content.js:771-773` (vòng lặp PASS 2 trong `render()` — gọi `_computeSafeBounds` 1 lần, truyền bounds theo index)
- Create: `fixtures/verify_safe_bounds.js` (script Node độc lập xác minh thuật toán bằng dữ liệu detect thật)

**Interfaces:**
- Consumes: không có (thuần dùng lại `r.x/y/w/h` đã có trên mỗi region).
- Produces: `OverlayRenderer._computeSafeBounds(regions)` → mảng `{maxHalfW, maxHalfH}` song song với `regions` theo index; `OverlayRenderer._reshapeForHorizontalText(r, bounds)` — Task 2 dùng lại đúng 2 hàm này, không đổi thêm.

- [ ] **Step 1: Viết `fixtures/verify_safe_bounds.js`**

```javascript
// Xac minh DOC LAP thuat toan _computeSafeBounds/_reshapeForHorizontalText
// (ban sao chinh xac tu content.js OverlayRenderer - GIU DONG BO thu cong
// neu sua thuat toan that trong content.js) bang du lieu detect THAT tu
// backend (xem fixtures/cjk_vertical_test_detect.txt). Chay: node fixtures/verify_safe_bounds.js
'use strict';

const regions = [
  { x: 766, y: 198, w: 46, h: 236 },
  { x: 678, y: 98, w: 43, h: 283 },
  { x: 679, y: 435, w: 41, h: 282 },
  { x: 237, y: 148, w: 44, h: 281 },
  { x: 129, y: 99, w: 43, h: 425 },
];

function computeSafeBounds(regions) {
  const MARGIN = 4;
  return regions.map((r, i) => {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    let maxLeft = Infinity;
    let maxRight = Infinity;
    let maxUp = Infinity;
    let maxDown = Infinity;
    regions.forEach((other, j) => {
      if (i === j) return;
      const overlapsY = other.y < r.y + r.h && other.y + other.h > r.y;
      const overlapsX = other.x < r.x + r.w && other.x + other.w > r.x;
      if (overlapsY) {
        if (other.x >= r.x + r.w) {
          const mid = (r.x + r.w + other.x) / 2;
          maxRight = Math.min(maxRight, mid - cx - MARGIN);
        } else if (r.x >= other.x + other.w) {
          const mid = (other.x + other.w + r.x) / 2;
          maxLeft = Math.min(maxLeft, cx - mid - MARGIN);
        }
      }
      if (overlapsX) {
        if (other.y >= r.y + r.h) {
          const mid = (r.y + r.h + other.y) / 2;
          maxDown = Math.min(maxDown, mid - cy - MARGIN);
        } else if (r.y >= other.y + other.h) {
          const mid = (other.y + other.h + r.y) / 2;
          maxUp = Math.min(maxUp, cy - mid - MARGIN);
        }
      }
    });
    return {
      maxHalfW: Math.max(r.w / 2, Math.min(maxLeft, maxRight)),
      maxHalfH: Math.max(r.h / 2, Math.min(maxUp, maxDown)),
    };
  });
}

function reshapeForHorizontalText(r, bounds) {
  const centerX = r.x + r.w / 2;
  const centerY = r.y + r.h / 2;
  let w = r.w;
  let h = r.h;
  if (h > w * 1.3) {
    const area = w * h;
    const TARGET_ASPECT = 1.3;
    w = Math.min(Math.sqrt(area * TARGET_ASPECT), r.w * 3.5);
    h = area / w;
  }
  if (bounds) {
    const maxW = bounds.maxHalfW * 2;
    const maxH = bounds.maxHalfH * 2;
    if (w > maxW) {
      h = Math.min((w * h) / maxW, maxH);
      w = maxW;
    } else if (h > maxH) {
      w = Math.min((w * h) / maxH, maxW);
      h = maxH;
    }
  }
  return { x: centerX - w / 2, y: centerY - h / 2, w, h };
}

function overlapArea(a, b) {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ox * oy;
}

const bounds = computeSafeBounds(regions);
const boxes = regions.map((r, i) => reshapeForHorizontalText(r, bounds[i]));

let failed = false;
for (let i = 0; i < boxes.length; i++) {
  for (let j = i + 1; j < boxes.length; j++) {
    const ov = overlapArea(boxes[i], boxes[j]);
    if (ov > 0) {
      console.error(`FAIL: region ${i} and ${j} overlap by ${ov.toFixed(0)}px^2`);
      failed = true;
    }
  }
}

if (failed) {
  console.error('FAILED: clamped boxes still overlap.');
  process.exit(1);
} else {
  console.log('PASS: all', boxes.length, 'clamped boxes are collision-free.');
  boxes.forEach((b, i) =>
    console.log(`  region ${i}: x=${b.x.toFixed(1)} y=${b.y.toFixed(1)} w=${b.w.toFixed(1)} h=${b.h.toFixed(1)}`)
  );
}
```

- [ ] **Step 2: Chạy script, xác nhận FAIL (thuật toán clamp chưa tồn tại trong content.js — nhưng script này ĐỘC LẬP với content.js, nên thực ra sẽ PASS ngay vì đã chứa sẵn bản đúng)**

Run: `node fixtures/verify_safe_bounds.js`
Expected: `PASS: all 5 clamped boxes are collision-free.` (script đã tự chứa cả 2 hàm — đây là bước xác nhận THUẬT TOÁN đúng trước khi chép vào content.js, không phải red-green cổ điển vì không có cách import content.js làm module).

Nếu KHÔNG pass, dừng lại — thuật toán sai, không tiếp tục Step 3.

- [ ] **Step 3: Chép đúng thuật toán đã xác minh vào `content.js`**

Đọc lại đúng nội dung hiện tại (dòng 685-706):
```javascript
    // Chu Nhat goc thuong la cot doc HEP (vd rong 14px, cao 339px). Chu dich
    // tieng Viet luon ve NGANG (khong co field "vertical" trong API - xem
    // README.md), neu giu nguyen ti le hep-cao nay thi chu Viet bi nhoi vao
    // cot hep ~1 ky tu/dong, khong doc noi. Fix: "dinh hinh lai" thanh khung
    // rong hon CHI DE DAT CHU (khung nay TRONG SUOT, khong dung de che chu
    // goc - viec che chu la cua anh inpaint, xem render()). Han che do
    // "phinh ngang" (TARGET_ASPECT thap + gioi han max width) de giam
    // chong lan sang cot ben canh khi trang qua day dac.
    _reshapeForHorizontalText(r) {
      const centerX = r.x + r.w / 2;
      const centerY = r.y + r.h / 2;
      let w = r.w;
      let h = r.h;
      if (h > w * 1.3) {
        const area = w * h;
        const TARGET_ASPECT = 1.3;
        w = Math.min(Math.sqrt(area * TARGET_ASPECT), r.w * 3.5);
        h = area / w;
      }
      return { x: centerX - w / 2, y: centerY - h / 2, w, h };
    },
```

Thay bằng:
```javascript
    // Gioi han an toan de nong khung: voi moi CAP vung "doi dien" nhau (bbox
    // GOC chong lan theo TRUC KIA - tuc la hang xom that su ben canh/tren-
    // duoi, khong phai o goc xa), ranh gioi dung chung la DIEM GIUA 2 mep
    // GOC doi dien - ca 2 phia deu tinh ra CUNG 1 duong ranh gioi nay (du
    // tinh tu vung nao truoc), nen 2 khung da kep KHONG BAO GIO cheo nhau,
    // bat ke vung kia muon nong to den dau. (Ban dau tung thu cach tinh
    // "khoang cach toi mep hang xom" tu MOT PHIA - SAI: ca 2 vung co the
    // doc lap tin rang chung duoc chiem TRON khoang trong giua, van de len
    // nhau - da kiem chung that bang du lieu detect that, xem
    // fixtures/verify_safe_bounds.js va spec 2026-08-12.)
    _computeSafeBounds(regions) {
      const MARGIN = 4; // px trong khong gian anh goc (naturalWidth/Height)
      return regions.map((r, i) => {
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        let maxLeft = Infinity;
        let maxRight = Infinity;
        let maxUp = Infinity;
        let maxDown = Infinity;
        regions.forEach((other, j) => {
          if (i === j) return;
          const overlapsY = other.y < r.y + r.h && other.y + other.h > r.y;
          const overlapsX = other.x < r.x + r.w && other.x + other.w > r.x;
          if (overlapsY) {
            if (other.x >= r.x + r.w) {
              const mid = (r.x + r.w + other.x) / 2;
              maxRight = Math.min(maxRight, mid - cx - MARGIN);
            } else if (r.x >= other.x + other.w) {
              const mid = (other.x + other.w + r.x) / 2;
              maxLeft = Math.min(maxLeft, cx - mid - MARGIN);
            }
          }
          if (overlapsX) {
            if (other.y >= r.y + r.h) {
              const mid = (r.y + r.h + other.y) / 2;
              maxDown = Math.min(maxDown, mid - cy - MARGIN);
            } else if (r.y >= other.y + other.h) {
              const mid = (other.y + other.h + r.y) / 2;
              maxUp = Math.min(maxUp, cy - mid - MARGIN);
            }
          }
        });
        return {
          maxHalfW: Math.max(r.w / 2, Math.min(maxLeft, maxRight)),
          maxHalfH: Math.max(r.h / 2, Math.min(maxUp, maxDown)),
        };
      });
    },

    // Chu Nhat goc thuong la cot doc HEP (vd rong 14px, cao 339px). Chu dich
    // tieng Viet luon ve NGANG (khong co field "vertical" trong API - xem
    // README.md), neu giu nguyen ti le hep-cao nay thi chu Viet bi nhoi vao
    // cot hep ~1 ky tu/dong, khong doc noi. Fix: "dinh hinh lai" thanh khung
    // rong hon CHI DE DAT CHU (khung nay TRONG SUOT, khong dung de che chu
    // goc - viec che chu la cua anh inpaint, xem render()). Han che do
    // "phinh ngang" (TARGET_ASPECT thap + gioi han max width) de giam
    // chong lan sang cot ben canh khi trang qua day dac. `bounds` (tu
    // _computeSafeBounds, optional) kep them theo hang xom that - khong
    // bao gio nong vuot qua gioi han nay du TARGET_ASPECT/3.5x muon nhieu
    // hon. Khi bi kep hep lai theo be rong, chieu cao duoc tinh lai theo
    // DIEN TICH da dinh hinh (khong phai dien tich bbox goc) de tan dung
    // toi da khong gian con lai, roi moi kep tiep theo chieu cao neu can.
    _reshapeForHorizontalText(r, bounds) {
      const centerX = r.x + r.w / 2;
      const centerY = r.y + r.h / 2;
      let w = r.w;
      let h = r.h;
      if (h > w * 1.3) {
        const area = w * h;
        const TARGET_ASPECT = 1.3;
        w = Math.min(Math.sqrt(area * TARGET_ASPECT), r.w * 3.5);
        h = area / w;
      }
      if (bounds) {
        const maxW = bounds.maxHalfW * 2;
        const maxH = bounds.maxHalfH * 2;
        if (w > maxW) {
          h = Math.min((w * h) / maxW, maxH);
          w = maxW;
        } else if (h > maxH) {
          w = Math.min((w * h) / maxH, maxW);
          h = maxH;
        }
      }
      return { x: centerX - w / 2, y: centerY - h / 2, w, h };
    },
```

- [ ] **Step 4: Gọi `_computeSafeBounds` trong `render()`**

Đọc lại đúng nội dung hiện tại (trong `async render(img, regions)`, PASS 2):
```javascript
      const textboxes = [];
      regions.forEach((r) => {
        const eff = this._reshapeForHorizontalText(r);
```

Thay bằng:
```javascript
      const textboxes = [];
      const safeBounds = this._computeSafeBounds(regions);
      regions.forEach((r, i) => {
        const eff = this._reshapeForHorizontalText(r, safeBounds[i]);
```

- [ ] **Step 5: Kiểm tra cú pháp**

Run: `node --check extension/content-script/content.js`
Expected: không lỗi.

- [ ] **Step 6: Xác minh thủ công bằng fixture CJK**

Backend Docker phải đang chạy thật (`docker ps` xác nhận `manga_translator` Up).

1. Mở terminal, `cd fixtures && python -m http.server 8000` (giữ chạy nền).
2. Reload extension trong `chrome://extensions/`.
3. Mở `http://localhost:8000/cjk_vertical_test.html`, bấm dịch (Alt+D hoặc nút popup "Dịch trang này").
4. Đợi dịch xong (ảnh nhỏ, backend thật, GPT dịch vài từ tiếng Nhật đơn giản - nhanh). Mở DevTools Console, xác nhận không có lỗi `Uncaught`/`TypeError`.
5. Kiểm tra bằng mắt: 2 cột bên trái ("おはようございます"/"げんきですか" gốc, giờ là 2 khung chữ Việt) KHÔNG được đè/chồng lên nhau; 2 vùng bên phải cũng vậy — trước đây (chưa có Task 1) các khung nong ngang sẽ đè lên nhau tại đây.
6. Mở DevTools Console, chạy đoạn kiểm tra nhanh để xác nhận bằng số liệu (không chỉ bằng mắt):
```javascript
const boxes = [...document.querySelectorAll('.mot-textbox')].map((el) => el.getBoundingClientRect());
let overlaps = 0;
for (let i = 0; i < boxes.length; i++) {
  for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const ox = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const oy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    if (ox * oy > 0) overlaps++;
  }
}
console.log('overlapping pairs:', overlaps, '(expect 0)');
```
Expected output: `overlapping pairs: 0`.

- [ ] **Step 7: Commit**

```bash
git add extension/content-script/content.js fixtures/verify_safe_bounds.js
git commit -m "Clamp region reshape against real neighbors so CJK vertical overlays never collide"
```

---

### Task 2: Background coverage for grown regions

**Files:**
- Modify: `extension/content-script/content.js:771-786` (vòng lặp PASS 2 — thêm class phủ nền khi khung đã lớn hơn bbox gốc)

**Interfaces:**
- Consumes: `eff` (khung đã kẹp, từ Task 1's `_reshapeForHorizontalText`), `r.busy` (đã có, không đổi).
- Produces: không có gì task khác phụ thuộc thêm.

- [ ] **Step 1: Áp class `.mot-busy` (phủ nền) cho MỌI vùng đã nong vượt quá 10% diện tích bbox gốc, không chỉ vùng `busy`**

Đọc lại đúng nội dung hiện tại (sau khi Task 1 đã sửa, trong `render()` PASS 2 — tìm bằng nội dung, số dòng đã lệch so với bản gốc):
```javascript
      const textboxes = [];
      const safeBounds = this._computeSafeBounds(regions);
      regions.forEach((r, i) => {
        const eff = this._reshapeForHorizontalText(r, safeBounds[i]);
        const padW = eff.w * CFG.TEXTBOX_PAD;
        const padH = eff.h * CFG.TEXTBOX_PAD;
        const tx = Math.max(0, eff.x - padW / 2);
        const ty = Math.max(0, eff.y - padH / 2);
        const tw = Math.min(naturalW - tx, eff.w + padW);
        const th = Math.min(naturalH - ty, eff.h + padH);

        const textbox = document.createElement('div');
        textbox.className = 'mot-textbox' + (r.busy ? ' mot-busy' : '');
```

Thay bằng:
```javascript
      const textboxes = [];
      const safeBounds = this._computeSafeBounds(regions);
      regions.forEach((r, i) => {
        const eff = this._reshapeForHorizontalText(r, safeBounds[i]);
        const padW = eff.w * CFG.TEXTBOX_PAD;
        const padH = eff.h * CFG.TEXTBOX_PAD;
        const tx = Math.max(0, eff.x - padW / 2);
        const ty = Math.max(0, eff.y - padH / 2);
        const tw = Math.min(naturalW - tx, eff.w + padW);
        const th = Math.min(naturalH - ty, eff.h + padH);

        // Phan khung da nong VUOT QUA bbox goc (khong con nam gon trong
        // vung anh da inpaint that - xem PASS 1) khong co nen inpaint che -
        // phu them nen trang mo (giong .mot-busy) bat ke r.busy hay khong,
        // tranh chu/tranh raw lo ra quanh chu dich. Nguong 10%: du nho de
        // cac lan nong nhe (chu khong-CJK) khong tu nhien co nen, du lon de
        // bat dung truong hop CJK doc bi nong ngang manh (xem spec
        // 2026-08-12-overlay-safe-layout-and-boundary-detection-design.md).
        const grew = eff.w * eff.h > r.w * r.h * 1.1;
        const textbox = document.createElement('div');
        textbox.className = 'mot-textbox' + (r.busy || grew ? ' mot-busy' : '');
```

- [ ] **Step 2: Kiểm tra cú pháp**

Run: `node --check extension/content-script/content.js`
Expected: không lỗi.

- [ ] **Step 3: Xác minh thủ công bằng fixture CJK**

Backend Docker phải đang chạy thật, server `python -m http.server 8000` từ Task 1 vẫn đang chạy (thư mục `fixtures/`).

1. Xóa cache dịch trong popup extension ("Xóa cache dịch (dịch lại từ đầu)") để ép dịch lại (Task 1 có thể đã cache kết quả cũ).
2. Mở lại `http://localhost:8000/cjk_vertical_test.html`, dịch lại.
3. Kiểm tra bằng mắt: các khung chữ Việt đã nong rộng hơn cột dọc gốc (44px → có thể hơn 100px) đều có 1 lớp nền trắng-mờ phía sau (khớp style `.mot-busy` sẵn có) — không còn khoảng nào lộ nền trắng thuần (nền trang HTML) xen giữa viền trắng của chữ và cột chữ gốc.
4. Mở DevTools, kiểm tra `document.querySelectorAll('.mot-textbox.mot-busy').length` — kỳ vọng > 0 (ít nhất vài vùng trong 5 vùng của fixture, vì tất cả đều có `h > w*1.3` nên đều bị nong đáng kể).

- [ ] **Step 4: Commit**

```bash
git add extension/content-script/content.js
git commit -m "Cover the extended portion of reshaped regions so raw text/art never shows through"
```

---

### Task 3: Decoupled boundary detection

**Files:**
- Modify: `extension/content-script/content.js:42` (bump `CACHE_VERSION`)
- Modify: `extension/content-script/content.js:60-65` (comment `BOUNDARY_BORROW_HEIGHT`)
- Modify: `extension/content-script/content.js:959-997` (xóa `buildStitchedBlob`, thêm `detectBoundaryRegions`)
- Modify: `extension/content-script/content.js:437-459` (`ApiAdapter.translateImageTiled` — lát cuối dùng `detectBoundaryRegions` thay vì nối blob)
- Modify: `extension/content-script/content.js:1168-1172` (nhánh Cache MISS trong `translateAndRenderImage`)

**Interfaces:**
- Consumes: `findNextSiblingImage(img)`, `getStripFromNextImage(nextImg, stripHeightPx)` (đã có, KHÔNG đổi), `getBoundaryStitch()` (đã có, không đổi), `ApiAdapter.translateImage(blob, gptConfigPath)` (đã có, không đổi), `isDuplicateOfRendered`/`registerRenderedRegion` (đã có ở `translateAndRenderImage`, không đổi — filter đã tồn tại tự động áp dụng cho region nào có `y+h > naturalHeight`, đúng với region từ `detectBoundaryRegions` luôn nằm ở cuối/tràn ảnh).
- Produces: `detectBoundaryRegions(img, blob, gptConfigPath)` → `Promise<Array<region>>` (mảng rỗng nếu tắt/không có ảnh kế/lỗi) — không có task nào khác trong plan này phụ thuộc thêm.
- **Xóa bỏ**: `buildStitchedBlob(img, blob)` — không còn nơi nào gọi hàm này sau task này.

- [ ] **Step 1: Bump `CACHE_VERSION` + sửa comment `BOUNDARY_BORROW_HEIGHT`**

Đọc lại đúng nội dung hiện tại (dòng 42):
```javascript
    CACHE_VERSION: 18, // DETECTION_SIZE 2048->2400 (bat ca chu nho lan chu to) - buoc dich lai
```

Thay bằng:
```javascript
    CACHE_VERSION: 19, // ghep bien tach lam 2 lan detect doc lap thay vi noi anh - doi tap region cache cho anh co bat stitch, buoc dich lai
```

Đọc lại đúng nội dung hiện tại (dòng 60-65):
```javascript
    // Ghep bien anh lien ke: muon them BOUNDARY_BORROW_HEIGHT px dau cua anh
    // KE TIEP truoc khi gui detect, de bong bong/cau van bi site tu cat
    // ngang giua 2 file anh van duoc nhin thay du. 500px du cho hau het bong
    // bong thuc te da quan sat (cao nhat ~300-400px). Xem spec
    // 2026-07-23-cross-image-boundary-stitching-design.md.
    BOUNDARY_BORROW_HEIGHT: 500,
```

Thay bằng:
```javascript
    // Ghep bien anh lien ke: dai BOUNDARY_BORROW_HEIGHT px CUOI anh hien tai
    // + dai cung do DAU anh KE TIEP duoc ghep thanh 1 anh NHO RIENG BIET va
    // detect DOC LAP voi anh chinh (KHONG con noi vao anh chinh truoc khi
    // detect nhu truoc - lam vay se co hep do phan giai CA anh chinh, xem
    // spec 2026-08-12-overlay-safe-layout-and-boundary-detection-design.md).
    // 500px du cho hau het bong bong thuc te da quan sat (cao nhat ~300-
    // 400px). Xem ham detectBoundaryRegions().
    BOUNDARY_BORROW_HEIGHT: 500,
```

- [ ] **Step 2: Thay `buildStitchedBlob` bằng `detectBoundaryRegions`**

Đọc lại đúng nội dung hiện tại (dòng 959-997):
```javascript
  // Ghep canvas anh hien tai + dai bien cua anh ke tiep (neu co/tai duoc).
  // Khong co anh ke tiep, hoac tai loi (mang, site chan...) -> tra ve blob
  // GOC khong doi, khong chan tien do dich anh hien tai.
  async function buildStitchedBlob(img, blob) {
    // Mac dinh TAT (xem getBoundaryStitch): manga trang roi khong can ghep, ghep
    // chi lam co detection -> sot chu. Chi ghep khi nguoi dung bat (doc webtoon dai).
    if (!(await getBoundaryStitch())) return blob;
    const nextImg = findNextSiblingImage(img);
    if (!nextImg) return blob;

    let stripBlob;
    try {
      stripBlob = await getStripFromNextImage(nextImg, CFG.BOUNDARY_BORROW_HEIGHT);
    } catch (err) {
      return blob;
    }

    if (!stripBlob) return blob;

    try {
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

      const stitched = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      return stitched || blob;
    } catch (err) {
      return blob;
    }
  }
```

Thay bằng:
```javascript
  // Detect DOC LAP vung giap ranh: cat rieng [BOUNDARY_BORROW_HEIGHT px CUOI
  // cua anh hien tai] + [BOUNDARY_BORROW_HEIGHT px DAU cua anh ke tiep]
  // thanh 1 anh NHO, gui backend detect+dich RIENG (KHONG con noi vao anh
  // chinh - anh chinh detect o kich thuoc goc, khong bi co do phan giai).
  // Tra ve mang region ĐA quy doi toa do ve khong gian anh hien tai (co the
  // vuot qua naturalHeight cua no - da duoc render() ho tro tu truoc, xem
  // spec 2026-07-23-cross-image-boundary-stitching-design.md muc render
  // khong clamp 100%). Khong bat/khong co anh ke/loi bat ky buoc nao ->
  // tra ve [] êm xuoi, khong chan render anh chinh.
  async function detectBoundaryRegions(img, blob, gptConfigPath) {
    if (!(await getBoundaryStitch())) return [];
    const nextImg = findNextSiblingImage(img);
    if (!nextImg) return [];

    let stripBlob;
    try {
      stripBlob = await getStripFromNextImage(nextImg, CFG.BOUNDARY_BORROW_HEIGHT);
    } catch (err) {
      return [];
    }
    if (!stripBlob) return [];

    let cropBlob;
    let ownStripH;
    try {
      const [currentBitmap, stripBitmap] = await Promise.all([
        createImageBitmap(blob),
        createImageBitmap(stripBlob),
      ]);
      ownStripH = Math.min(CFG.BOUNDARY_BORROW_HEIGHT, currentBitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = currentBitmap.width;
      canvas.height = ownStripH + stripBitmap.height;
      const ctx = canvas.getContext('2d');
      // Dai CUOI cua anh hien tai (khong phai toan bo anh).
      ctx.drawImage(
        currentBitmap,
        0, currentBitmap.height - ownStripH, currentBitmap.width, ownStripH,
        0, 0, currentBitmap.width, ownStripH
      );
      ctx.drawImage(stripBitmap, 0, ownStripH);
      currentBitmap.close?.();
      stripBitmap.close?.();
      cropBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    } catch (err) {
      return [];
    }
    if (!cropBlob) return [];

    let cropResult;
    try {
      cropResult = await ApiAdapter.translateImage(cropBlob, gptConfigPath);
    } catch (err) {
      return [];
    }

    // Toa do tra ve la KHONG GIAN CUA ANH CROP NHO (0..ownStripH+stripH).
    // Diem 0 cua crop tuong ung y = naturalHeight - ownStripH trong anh
    // hien tai - cong offset nay la du, ap dung dung cho ca phan thuoc
    // "duoi anh hien tai" LAN phan thuoc "dau anh ke tiep" (ca 2 deu la
    // tiep noi truc tiep tu diem do trong khong gian anh hien tai).
    const offsetY = img.naturalHeight - ownStripH;
    return (cropResult.regions || []).map((r) => ({ ...r, y: offsetY + r.y }));
  }
```

- [ ] **Step 3: Sửa `ApiAdapter.translateImageTiled` — lát cuối dùng `detectBoundaryRegions`**

Đọc lại đúng nội dung hiện tại (dòng 437-459):
```javascript
    async translateImageTiled(blob, naturalW, naturalH, img, gptConfigPath) {
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
        const result = await this.translateImage(tileBlob, gptConfigPath);
        for (const r of result.regions) {
          allRegions.push({ ...r, y: r.y + tile.yOffset });
        }
      }
      return { regions: dedupeRegions(allRegions) };
    },
```

Thay bằng:
```javascript
    async translateImageTiled(blob, naturalW, naturalH, img, gptConfigPath) {
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
        const result = await this.translateImage(tile.blob, gptConfigPath);
        for (const r of result.regions) {
          allRegions.push({ ...r, y: r.y + tile.yOffset });
        }
        // Chi lat CUOI CUNG moi thuc su giap ranh gioi voi anh ke tiep tren
        // trang - cac lat truoc da co TILE_OVERLAP xu ly rieng (xem spec
        // 2026-07-23-cross-image-boundary-stitching-design.md muc 8). Detect
        // bien RIENG (khong con noi vao blob cua lat) - xem
        // detectBoundaryRegions(); tra ve toa do da o khong gian ANH GOC
        // (dung naturalH thuc, khong phai kich thuoc lat) nen cong thang
        // vao allRegions, khong can + tile.yOffset.
        if (i === tiles.length - 1) {
          const boundaryRegions = await detectBoundaryRegions(img, tile.blob, gptConfigPath);
          allRegions.push(...boundaryRegions);
        }
      }
      return { regions: dedupeRegions(allRegions) };
    },
```

- [ ] **Step 4: Sửa nhánh Cache MISS trong `translateAndRenderImage`**

Đọc lại đúng nội dung hiện tại (dòng 1168-1172):
```javascript
          result =
            img.naturalHeight > CFG.TILE_MAX_H
              ? await ApiAdapter.translateImageTiled(blob, img.naturalWidth, img.naturalHeight, img, gptConfigPath)
              : await ApiAdapter.translateImage(await buildStitchedBlob(img, blob), gptConfigPath);
          await Cache.set(hash, targetLang, engine, result);
```

Thay bằng:
```javascript
          if (img.naturalHeight > CFG.TILE_MAX_H) {
            result = await ApiAdapter.translateImageTiled(blob, img.naturalWidth, img.naturalHeight, img, gptConfigPath);
          } else {
            result = await ApiAdapter.translateImage(blob, gptConfigPath);
            const boundaryRegions = await detectBoundaryRegions(img, blob, gptConfigPath);
            result.regions = result.regions.concat(boundaryRegions);
          }
          await Cache.set(hash, targetLang, engine, result);
```

- [ ] **Step 5: Kiểm tra cú pháp + xác nhận không còn tham chiếu `buildStitchedBlob`**

Run: `node --check extension/content-script/content.js`
Expected: không lỗi.

Run: `grep -c buildStitchedBlob extension/content-script/content.js`
Expected: `0` (đã xóa hoàn toàn, không còn nơi nào gọi tên cũ).

- [ ] **Step 6: Xác minh thủ công trên webtoon thật — so khớp số liệu mốc đã đo**

Backend Docker phải đang chạy thật.

1. Reload extension trong `chrome://extensions/`.
2. Trong popup, BẬT "Ghép biên webtoon dài", bấm "Xóa cache dịch".
3. Mở `https://www.webtoons.com/en/action/the-stellar-swordmaster/s2-episode-121/viewer?title_no=5988&episode_no=121`.
4. Trước khi dịch, ghi lại mốc thời gian bắt đầu: `ts=$(date +%s)` (chạy lệnh này trong terminal ngay trước bước 5, giữ nguyên phiên terminal đó để biến `$ts` còn dùng được ở bước 6).
5. Bật Eager mode (hoặc cuộn hết episode) để dịch toàn bộ.
6. Sau khi dịch xong toàn bộ episode, lọc + phân tích log từ mốc `$ts` (đúng kỹ thuật đã dùng khi root-cause vấn đề này):

```bash
docker logs --since "$ts" manga_translator > /tmp_or_scratchpad_verify_task3.log 2>&1
echo "--- phan bo Detection resolution (anh chinh) ---"
grep -oE 'Detection resolution: [0-9]+x[0-9]+' /tmp_or_scratchpad_verify_task3.log | sort | uniq -c | sort -rn
echo "--- tong so dong OCR ---"
grep -c 'Model48pxOCR. prob:' /tmp_or_scratchpad_verify_task3.log
```

   - Cột rộng nhất trong phần "phân bố Detection resolution" (số lượng ảnh nhiều nhất) phải quay lại quanh mốc **1536** (khớp lúc tắt stitch trước đây, xem Global Constraints), KHÔNG còn co về ~1280 như hành vi cũ.
   - Tổng số dòng OCR in ra ở cuối kỳ vọng **≥ 260** (mốc lúc tắt, không mất coverage so với tắt) và lý tưởng gần/vượt **377** (mốc lúc bật-cũ — tức không mất coverage so với bật-cũ nữa dù ảnh chính không còn bị co).
7. Kiểm tra bằng mắt: cuộn qua vài chục ảnh liên tục — bong bóng không còn nhỏ bất thường so với bản dịch lúc TẮT stitch, và các câu vắt ngang ranh giới 2 ảnh (nếu quan sát được) hiển thị đầy đủ, không bị cắt cụt giữa chừng.
8. Kiểm tra Console — không có lỗi `Uncaught`/`TypeError` nào khi cuộn qua toàn bộ episode, kể cả ảnh cuối cùng (không có ảnh kế tiếp).

- [ ] **Step 7: Commit**

```bash
git add extension/content-script/content.js
git commit -m "Decouple boundary-crop detection from the main image so stitching no longer shrinks its resolution"
```

---

## Final integration check (sau khi xong cả 3 task — cần con người/trình duyệt thật, không thể tự động hoá)

- [ ] Chạy lại `node fixtures/verify_safe_bounds.js` một lượt cuối — vẫn PASS.
- [ ] Chạy lại `node --check extension/content-script/content.js` — không lỗi.
- [ ] Dịch thử 1 trang tiếng Anh bất kỳ trong `fixtures`/session trước (p005/p007/p008/p012 nếu còn giữ) — xác nhận Task 1/2 không ảnh hưởng tiêu cực tới trang không có chữ dọc (không tự nhiên xuất hiện nền `.mot-busy` ở vùng bình thường không cần).
- [ ] Dịch lại webtoon thật (Task 3 Step 6) một lần nữa với stitch TẮT — xác nhận hành vi tắt không đổi so với trước plan này (vẫn đúng như mốc 1536px/260 dòng đã đo).
- [ ] `git log --oneline` từ commit đầu plan tới cuối — đối chiếu đúng 3 commit (1 cho mỗi task).
- [ ] Cập nhật `docs.md`/`README.md` nếu có phần mô tả cơ chế ghép biên cũ (tham chiếu `buildStitchedBlob`) — sửa lại theo cơ chế mới (`detectBoundaryRegions`), tránh tài liệu sai lệch với code thật.
