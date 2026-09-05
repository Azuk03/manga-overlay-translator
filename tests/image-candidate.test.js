// Test cho motIsCandidateImage() - bo loc quyet dinh <img> nao dang dich.
//
// Logic nay truoc day nam trong IIFE cua content.js nen khong test duoc. Da
// tach ra image-candidate.js theo dung khuon cua image-format.js.
//
// Chay: node --test tests/
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const SRC_PATH = path.join(__dirname, '..', 'extension', 'content-script', 'image-candidate.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');
const { motIsCandidateImage } = new Function(
  `${src}\nreturn { motIsCandidateImage };`
)();

// Gia tri that trong CFG cua content.js.
const CFG = { MIN_NW: 400, MIN_NH: 400, MIN_DISPLAY_RATIO: 0.3, viewportWidth: 1600 };

// Mac dinh la mot trang MangaDex that: 1284x1826, class that do lay tu bang
// chan doan chay tren may nguoi dung 2026-09-05.
function fakeImg(over = {}) {
  return {
    currentSrc: '',
    src: 'blob:https://mangadex.org/e2b5e0c9-6cdf-4374-a2fc-ff5f6638ac76',
    naturalWidth: 1284,
    naturalHeight: 1826,
    clientWidth: 800,
    id: '',
    className: 'img sp limit-width limit-height mx-auto',
    closest: () => null,
    ...over,
  };
}

test('nhan mot trang truyen binh thuong', () => {
  assert.strictEqual(motIsCandidateImage(fakeImg(), CFG), true);
});

test('loai placeholder data: URI', () => {
  const img = fakeImg({ src: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' });
  assert.strictEqual(motIsCandidateImage(img, CFG), false);
});

test('loai anh chua tai xong (naturalWidth 0)', () => {
  assert.strictEqual(motIsCandidateImage(fakeImg({ naturalWidth: 0 }), CFG), false);
});

test('loai anh nho hon nguong kich thuoc that', () => {
  const img = fakeImg({ naturalWidth: 300, naturalHeight: 300 });
  assert.strictEqual(motIsCandidateImage(img, CFG), false);
});

test('loai banner duoc ve ra nhung be xiu so voi man hinh', () => {
  // 40/1600 = 0.025 < 0.3
  assert.strictEqual(motIsCandidateImage(fakeImg({ clientWidth: 40 }), CFG), false);
});

test('loai anh nam trong header/nav/footer/aside', () => {
  const img = fakeImg({ closest: (sel) => (sel.includes('header') ? {} : null) });
  assert.strictEqual(motIsCandidateImage(img, CFG), false);
});

test('loai anh co id/class kieu logo, avatar, banner...', () => {
  const img = fakeImg({ className: 'site-logo mx-auto' });
  assert.strictEqual(motIsCandidateImage(img, CFG), false);
});

test('loai anh qua bet (ty le duoi 0.4)', () => {
  const img = fakeImg({ naturalWidth: 1600, naturalHeight: 400 }); // 0.25
  assert.strictEqual(motIsCandidateImage(img, CFG), false);
});

test('van nhan trang doi nam ngang cua MangaPlaza (1442x688, ty le 0.475)', () => {
  const img = fakeImg({ naturalWidth: 1442, naturalHeight: 688 });
  assert.strictEqual(motIsCandidateImage(img, CFG), true);
});

// MangaDex an moi trang khong phai trang hien tai, nen chung co clientWidth 0
// du kich thuoc that van la 1284x1826. Do that tren may nguoi dung 2026-09-05:
// ba anh 1284x1826 GIONG HET nhau, chi anh dang hien duoc nhan, hai anh kia bi
// loai o dung cong nay - nen che do dich truoc chi thay 1 anh.
test('nhan trang bi an (clientWidth 0) khi kich thuoc that van lon', () => {
  const img = fakeImg({ clientWidth: 0 });
  assert.strictEqual(motIsCandidateImage(img, CFG), true);
});

// Cong nay van phai lam dung viec cua no: banh CO hop layout ma be xiu thi
// van loai. Neu bo han cong di thi test nay do.
test('van loai banner be xiu khi no THUC SU duoc ve ra', () => {
  const img = fakeImg({ clientWidth: 40 });
  assert.strictEqual(motIsCandidateImage(img, CFG), false);
});
