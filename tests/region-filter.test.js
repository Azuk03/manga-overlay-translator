// Test cho motShouldRenderRegion() - quyet dinh mot vung da dich co duoc ve
// overlay hay khong.
//
// LY DO TON TAI: logic nay truoc day nam trong IIFE cua content.js nen khong ai
// test duoc, va mot loi o day da lot qua BA luot review. Sau khi tach pha A/B,
// bo loc "dst trung src" cua backend khong con chay duoc (pha A dung
// translator='none', ma nhanh do return truoc ca khoi loc), nen ban cu - von chi
// bo khi nguon PHI-Latin - de moi vung trung o trang chu Latin loc qua: SFX ke
// tay, ten rieng, watermark bi inpaint xoa net goc roi ve lai bang font overlay.
//
// Chay: node --test tests/*.test.js   (node >= 18)
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const SRC = path.join(__dirname, '..', 'extension', 'content-script', 'region-filter.js');
const { motShouldRenderRegion } = new Function(
  `${fs.readFileSync(SRC, 'utf8')}\nreturn { motShouldRenderRegion };`
)();

test('ve khi co ban dich that su', () => {
  assert.strictEqual(motShouldRenderRegion('HELLO', 'XIN CHAO'), true);
});

test('bo khi dst rong', () => {
  assert.strictEqual(motShouldRenderRegion('HELLO', ''), false);
});

test('bo khi dst chi co khoang trang', () => {
  assert.strictEqual(motShouldRenderRegion('HELLO', '   '), false);
});

// Ba chuoi duoi day lay TU CHINH phep do 2026-09-05 - chung la nhung dong ma
// duong cu bo di con duong moi ve ra.
test('bo SFX ke tay Latin khi model tra ve nguyen xi', () => {
  assert.strictEqual(motShouldRenderRegion('RUMBLE', 'RUMBLE'), false);
});

test('bo ten rieng Latin khi model tra ve nguyen xi', () => {
  assert.strictEqual(motShouldRenderRegion('KAORU MISOGIYA', 'KAORU MISOGIYA'), false);
});

test('bo watermark khi model tra ve nguyen xi', () => {
  assert.strictEqual(motShouldRenderRegion('TENMACOMCSS', 'TENMACOMCSS'), false);
});

test('bo khi trung nhung khac hoa/thuong', () => {
  assert.strictEqual(motShouldRenderRegion('Rumble', 'RUMBLE'), false);
});

test('bo khi trung nhung lech khoang trang hai dau', () => {
  assert.strictEqual(motShouldRenderRegion('  RUMBLE  ', 'RUMBLE'), false);
});

test('van bo SFX CJK trung nhu truoc (khong lam hoi quy hanh vi cu)', () => {
  assert.strictEqual(motShouldRenderRegion('ゴゴゴ', 'ゴゴゴ'), false);
});

test('ve khi ban dich chi khac mot phan', () => {
  assert.strictEqual(motShouldRenderRegion('RUMBLE RUMBLE', 'RUMBLE ARM ARM'), true);
});

test('src rong ma dst co chu thi van ve', () => {
  assert.strictEqual(motShouldRenderRegion('', 'XIN CHAO'), true);
});
