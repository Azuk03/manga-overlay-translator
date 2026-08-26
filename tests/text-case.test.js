// Chuan hoa chu HOA/thuong cua ban dich theo dung chu goc.
//
// VAN DE (do tren truyen that): nguon OCR gan nhu luon la ALL-CAPS (chu trong
// truyen tranh von viet hoa), nhung ban dich tra ve luc HOA luc thuong - 85%
// ALL-CAPS lan 15% viet thuong ngay trong cung mot chuong. Chinh su LAN LON do
// moi choi mat, chu khong phai viec viet hoa.
//
// Cua so ngu canh con KHUECH DAI no: no chep chu HOA cua trang truoc sang trang
// sau (do duoc: 66% -> 84% sau khi bat tinh nang).
//
// Day KHONG phai viec cua LLM. Prompt da co quy tac chuan hoa viet hoa tu lau
// va model van khong tuan thu on dinh. Bam theo chu goc thi xac dinh hoan toan,
// khong ton token, va khong the "truot".
//
// VI SAO KHONG dung .capitalize()/sentence-case: ca nguon lan dich deu ALL-CAPS
// nen khong the phan biet ten rieng bang may - "ERKIN" giua cau se thanh
// "erkin". Viet HOA thi khong bao gio lam hong ten rieng.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const SRC = path.join(__dirname, '..', 'extension', 'content-script', 'text-case.js');
const api = new Function(
  `${fs.readFileSync(SRC, 'utf8')}\nreturn { motIsAllCaps, motMatchSourceCase };`
)();
const { motIsAllCaps, motMatchSourceCase } = api;

test('nhan dien chu HOA toan bo', () => {
  assert.equal(motIsAllCaps('YOU DID NOT STORE THE HERBS'), true);
  assert.equal(motIsAllCaps('WHAT?!'), true);
  assert.equal(motIsAllCaps("I CAN'T HELP YOU"), true);
  assert.equal(motIsAllCaps('Hey, did you hear?'), false);
  assert.equal(motIsAllCaps('Mr. Jenkins'), false);
});

test('chuoi khong co chu cai thi khong tinh la HOA', () => {
  assert.equal(motIsAllCaps('...'), false);
  assert.equal(motIsAllCaps('?!'), false);
  assert.equal(motIsAllCaps('123'), false);
  assert.equal(motIsAllCaps(''), false);
  assert.equal(motIsAllCaps(null), false);
});

test('goc HOA -> ban dich chuyen thanh HOA', () => {
  assert.equal(
    motMatchSourceCase('YOU DID NOT STORE THE HERBS', 'Ông không bảo quản thảo dược'),
    'ÔNG KHÔNG BẢO QUẢN THẢO DƯỢC');
});

test('dau tieng Viet len HOA dung', () => {
  assert.equal(motMatchSourceCase('TEST LINE HERE', 'Cậu đã ở đâu thế?'), 'CẬU ĐÃ Ở ĐÂU THẾ?');
  assert.equal(motMatchSourceCase('TEST LINE HERE', 'đừng quấy rối nữa'), 'ĐỪNG QUẤY RỐI NỮA');
});

test('ten rieng KHONG bi hong khi len HOA', () => {
  assert.equal(motMatchSourceCase('THANKS FOR THE HELP, ANNETTA.', 'Cảm ơn vì đã giúp, Annetta.'),
    'CẢM ƠN VÌ ĐÃ GIÚP, ANNETTA.');
});

test('goc viet thuong -> giu NGUYEN ban dich', () => {
  const dst = 'Này, cậu có nghe tin gì không?';
  assert.equal(motMatchSourceCase('Hey, did you hear the news?', dst), dst);
});

test('goc khong co chu cai -> giu nguyen', () => {
  assert.equal(motMatchSourceCase('...!', 'Ôi trời'), 'Ôi trời');
});

test('goc HOA nhung dich da HOA san -> khong doi gi', () => {
  assert.equal(motMatchSourceCase('WHAT?!', 'CÁI GÌ?!'), 'CÁI GÌ?!');
});

test('dau vao rong/thieu -> tra ve an toan', () => {
  assert.equal(motMatchSourceCase('ABC DEF GHI', ''), '');
  assert.equal(motMatchSourceCase('', 'giữ nguyên'), 'giữ nguyên');
  assert.equal(motMatchSourceCase(null, 'giữ nguyên'), 'giữ nguyên');
  assert.equal(motMatchSourceCase('ABC', null), null);
});
