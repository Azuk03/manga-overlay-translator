// Test cho motShouldReencodeForBackend() - quyet dinh co nen lai anh sang PNG
// truoc khi gui backend hay khong.
//
// LY DO TON TAI: duong cu nen lai MOI anh vo dieu kien, do that tren anh mau
// cua repo la phinh 7,4 lan (117KB webp -> 871KB data URL) cong mot luot nen
// PNG anh 6 megapixel moi trang. Backend that su doc thang duoc JPEG/PNG/WebP
// (va AVIF sau khi Dockerfile them pillow-avif-plugin), nen phan lon viec do
// la thua.
//
// RUI RO PHAI CAN BANG: trinh duyet AP DUNG EXIF orientation khi ve <img>, con
// Pillow thi KHONG. Anh co orientation != 1 ma gui thang byte goc se khien
// backend thay anh chua xoay -> toan bo overlay dat sai cho. Nen quy tac phai
// SAI VE PHIA AN TOAN: thay bat ky dau hieu EXIF nao la nen lai, khong co gang
// doc gia tri orientation.
//
// Chay: node --test tests/
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const SRC_PATH = path.join(__dirname, '..', 'extension', 'content-script', 'image-format.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');
const api = new Function(
  `${src}\nreturn { motShouldReencodeForBackend, motBackendCanRead, motHasExifBlock, motNormalizeContentType };`
)();
const { motShouldReencodeForBackend, motBackendCanRead, motHasExifBlock, motNormalizeContentType } = api;

const fixture = (name) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', name)));

// ===== Kieu MIME =====

test('nhan dung cac dinh dang backend doc thang duoc', () => {
  for (const t of ['image/jpeg', 'image/png', 'image/webp', 'image/avif']) {
    assert.equal(motBackendCanRead(t), true, t);
  }
});

test('tu choi dinh dang Pillow khong doc duoc', () => {
  // image/jxl, image/heic: Pillow 10.2.0 khong co plugin; text/html la trang
  // loi hotlink ma CDN tra ve thay vi anh.
  for (const t of ['image/jxl', 'image/heic', 'image/gif', 'text/html', '', null, undefined]) {
    assert.equal(motBackendCanRead(t), false, String(t));
  }
});

test('bo qua tham so va hoa/thuong trong Content-Type', () => {
  assert.equal(motNormalizeContentType('IMAGE/JPEG; charset=binary'), 'image/jpeg');
  assert.equal(motBackendCanRead('Image/WebP '), true);
  assert.equal(motBackendCanRead('image/png;q=1'), true);
});

// ===== Do EXIF tren anh THAT =====

test('anh JPEG sach -> gui thang, khong nen lai', () => {
  const bytes = fixture('clean.jpg');
  assert.equal(motHasExifBlock(bytes), false);
  assert.equal(motShouldReencodeForBackend('image/jpeg', bytes), false);
});

test('anh JPEG co EXIF Orientation=6 -> BUOC nen lai (neu khong overlay se lech)', () => {
  const bytes = fixture('exif-orientation.jpg');
  assert.equal(motHasExifBlock(bytes), true);
  assert.equal(motShouldReencodeForBackend('image/jpeg', bytes), true);
});

test('anh PNG sach -> gui thang', () => {
  const bytes = fixture('clean.png');
  assert.equal(motShouldReencodeForBackend('image/png', bytes), false);
});

test('anh WebP sach -> gui thang', () => {
  const bytes = fixture('clean-webp.bin');
  assert.equal(motShouldReencodeForBackend('image/webp', bytes), false);
});

// ===== Quet dau/cuoi =====

function withMarker(marker, at, total) {
  const b = new Uint8Array(total);
  for (let i = 0; i < marker.length; i++) b[at + i] = marker.charCodeAt(i);
  return b;
}

test('bat marker EXIF nam o DAU file', () => {
  assert.equal(motHasExifBlock(withMarker('Exif', 6, 300 * 1024)), true);
});

test('bat marker EXIF cua WebP nam o CUOI file (mot so bo ma dat o do)', () => {
  const total = 300 * 1024;
  assert.equal(motHasExifBlock(withMarker('EXIF', total - 1000, total)), true);
});

test('bat marker eXIf cua PNG', () => {
  assert.equal(motHasExifBlock(withMarker('eXIf', 33, 4096)), true);
});

test('file toan byte 0, khong marker -> khong coi la co EXIF', () => {
  assert.equal(motHasExifBlock(new Uint8Array(300 * 1024)), false);
});

test('marker nam giua vung KHONG quet thi bo lot - va do la lua chon co y', () => {
  // Vung giua cua file lon khong duoc quet (de khoi tra gia dung bang cai chi
  // phi dang muon bo). Ghi lai bang test de neu sau nay doi chien luoc quet thi
  // biet minh dang doi cai gi, chu khong phai phat hien bang mot bug overlay lech.
  const total = 1024 * 1024;
  assert.equal(motHasExifBlock(withMarker('Exif', 500 * 1024, total)), false);
});

// ===== Sai ve phia an toan =====

test('khong doc duoc byte -> nen lai cho chac', () => {
  assert.equal(motHasExifBlock(null), true);
  assert.equal(motHasExifBlock(undefined), true);
  assert.equal(motShouldReencodeForBackend('image/jpeg', null), true);
});

test('kieu la + co EXIF: van nen lai (khong can xet toi EXIF)', () => {
  assert.equal(motShouldReencodeForBackend('image/jxl', fixture('clean.jpg')), true);
});

test('file rong', () => {
  assert.equal(motHasExifBlock(new Uint8Array(0)), false);
  assert.equal(motShouldReencodeForBackend('image/png', new Uint8Array(0)), false);
});
