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
  h.push('trang1'); h.push('trang2');
  assert.strictEqual(h.take(), 'trang1');
  assert.strictEqual(h.take(), 'trang2');
});

test('take() tra null khi rong', () => {
  assert.strictEqual(motCreateHandoff(2).take(), null);
});

test('bao day khi cham chan tren', () => {
  const h = motCreateHandoff(2);
  h.push('a'); h.push('b');
  assert.strictEqual(h.isFull(), true);
});

test('push khi day thi nem loi - buoc goi phai cho truoc', () => {
  const h = motCreateHandoff(1);
  h.push('a');
  assert.throws(() => h.push('b'));
});

test('waitForSpace giai phong khi co cho trong', async () => {
  const h = motCreateHandoff(1);
  h.push('a');
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
  h.push('a');
  await cho;
  assert.strictEqual(thongQua, true);
});

test('close() go moi ben dang cho - khong de worker treo', async () => {
  const h = motCreateHandoff(1);
  h.push('a');
  const cho = Promise.all([h.waitForSpace(), h.waitForItem()]);
  h.close();
  await cho;
});
