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
        } else {
          // Both axes overlap: genuine overlap, constrain to no horizontal growth
          maxLeft = Math.min(maxLeft, 0);
          maxRight = Math.min(maxRight, 0);
        }
      }
      if (overlapsX) {
        if (other.y >= r.y + r.h) {
          const mid = (r.y + r.h + other.y) / 2;
          maxDown = Math.min(maxDown, mid - cy - MARGIN);
        } else if (r.y >= other.y + other.h) {
          const mid = (other.y + other.h + r.y) / 2;
          maxUp = Math.min(maxUp, cy - mid - MARGIN);
        } else {
          // Both axes overlap: genuine overlap, constrain to no vertical growth
          maxUp = Math.min(maxUp, 0);
          maxDown = Math.min(maxDown, 0);
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
