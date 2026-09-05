// Bo dem chuyen giao giua A-worker (GPU) va B-worker (mang).
//
// Chan tren la 2: ket qua pha A chua anh nen tung vung, do duoc vai MB moi
// trang - de A chay xa tuy y la om het so do trong bo nho.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const SRC = path.join(__dirname, '..', 'extension', 'content-script', 'handoff-buffer.js');
const { motCreateHandoff } = new Function(
  `${fs.readFileSync(SRC, 'utf8')}\nreturn { motCreateHandoff };`
)();

test('giu dung thu tu doc - FIFO', () => {
  const h = motCreateHandoff(3);
  assert.strictEqual(h.push('trang1'), true);
  assert.strictEqual(h.push('trang2'), true);
  assert.strictEqual(h.take(), 'trang1');
  assert.strictEqual(h.take(), 'trang2');
});

test('take() tra null khi rong', () => {
  assert.strictEqual(motCreateHandoff(2).take(), null);
});

test('bao day khi cham chan tren', () => {
  const h = motCreateHandoff(2);
  assert.strictEqual(h.push('a'), true);
  assert.strictEqual(h.push('b'), true);
  assert.strictEqual(h.isFull(), true);
});

test('push khi day thi nem loi - buoc goi phai cho truoc', () => {
  const h = motCreateHandoff(1);
  assert.strictEqual(h.push('a'), true);
  assert.throws(() => h.push('b'));
});

test('waitForSpace giai phong khi co cho trong', async () => {
  const h = motCreateHandoff(1);
  assert.strictEqual(h.push('a'), true);
  let thongQua = false;
  const cho = h.waitForSpace().then(() => { thongQua = true; });
  assert.strictEqual(thongQua, false);
  h.take();
  await cho;
  assert.strictEqual(thongQua, true);
});

test('waitForItem giai phong khi co hang', async () => {
  const h = motCreateHandoff(2);
  let thongQua = false;
  const cho = h.waitForItem().then(() => { thongQua = true; });
  assert.strictEqual(thongQua, false);
  assert.strictEqual(h.push('a'), true);
  await cho;
  assert.strictEqual(thongQua, true);
});

test('close() go moi ben dang cho - khong de worker treo', async () => {
  const h = motCreateHandoff(1);
  assert.strictEqual(h.push('a'), true);
  const cho = Promise.all([h.waitForSpace(), h.waitForItem()]);
  h.close();
  await cho;
  // Bug scenario: waitForSpace() resolved because closed, not because space freed.
  // Producer must not confuse shutdown with "you forgot to await". push() after
  // close() is a no-op returning false, not a thrown error.
  assert.strictEqual(h.push('b'), false);
});

test('push sau close() tra false, khong nem loi', () => {
  const h = motCreateHandoff(2);
  h.close();
  assert.strictEqual(h.push('a'), false);
});

test('limit phai la duong so nguyen - khong co tham so thi nem loi', () => {
  assert.throws(() => motCreateHandoff());
  assert.throws(() => motCreateHandoff(0));
  assert.throws(() => motCreateHandoff(-1));
  assert.throws(() => motCreateHandoff(1.5));
});
