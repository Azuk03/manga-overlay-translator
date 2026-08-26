// Cua so thoai gan nhat, gui kem moi luot dich de GPT giu nguyen ngoi xung.
// Do duoc 2026-08-26 (3 lan chay moi dieu kien, tren chuoi trang THAT co du
// bia/credits/SFX): khong loc thi ban dich chot vao dai tu KHAC NHAU giua cac
// lan chay (ong/cau/ong); co loc thi 3/3 lan deu ra 'ong'. Xem spec.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const SRC = path.join(__dirname, '..', 'extension', 'content-script', 'dialogue-context.js');
const api = new Function(
  `${fs.readFileSync(SRC, 'utf8')}\nreturn { MOT_CONTEXT_MAX, motIsLatinText, motShouldKeepForContext, motPushContext, motContextPayload };`
)();
const { MOT_CONTEXT_MAX, motIsLatinText, motShouldKeepForContext, motPushContext, motContextPayload } = api;

test('nhan dien chu Latin', () => {
  assert.equal(motIsLatinText('I CANT HELP YOU'), true);
  assert.equal(motIsLatinText('おはようございます'), false);
  assert.equal(motIsLatinText('안녕하세요'), false);
  assert.equal(motIsLatinText('你好世界'), false);
  assert.equal(motIsLatinText(''), false);
});

test('giu lai thoai that', () => {
  assert.equal(motShouldKeepForContext(
    'YOU DID NOT STORE THE HERBS PROPERLY', 'ÔNG ĐÃ KHÔNG BẢO QUẢN THẢO DƯỢC ĐÚNG CÁCH'), true);
});

test('bo SFX', () => {
  for (const s of ['HUFF', 'HAA', 'ARGHH', 'DING', 'GRUMBLE', 'FLINCH', 'STINK']) {
    assert.equal(motShouldKeepForContext(s, 'HỰC'), false, s);
  }
});

test('bo credits va ten studio', () => {
  assert.equal(motShouldKeepForContext('Art&Story by MURO', 'Câu chuyện bởi MURO'), false);
  assert.equal(motShouldKeepForContext('8 tappytoon', '8 tappytoon'), false);
  assert.equal(motShouldKeepForContext('kidarl STUDIO', 'kidarl STUDIO'), false);
});

test('bo dong duoi 3 tu', () => {
  assert.equal(motShouldKeepForContext('WHAT?!', 'CÁI GÌ?!'), false);
  assert.equal(motShouldKeepForContext('LINDEMANN STORE', 'CỬA HÀNG LINDEMANN'), false);
});

test('bo khi dich ra y het ban goc (SFX hoac ten rieng)', () => {
  assert.equal(motShouldKeepForContext('MR JENKINS SIR', 'MR JENKINS SIR'), false);
});

test('bo nguon KHONG phai Latin - day la cong chan CJK', () => {
  assert.equal(motShouldKeepForContext('この薬草はとても高いですよ', 'Thảo dược này đắt lắm đấy'), false);
  assert.equal(motShouldKeepForContext('이 약초는 아주 비싸요', 'Thảo dược này đắt lắm'), false);
});

test('bo khi thieu src hoac dst', () => {
  assert.equal(motShouldKeepForContext('', 'gì đó'), false);
  assert.equal(motShouldKeepForContext('SOME REAL LINE HERE', ''), false);
  assert.equal(motShouldKeepForContext(null, undefined), false);
});

test('push tao dung dinh dang "src -> dst"', () => {
  const w = [];
  motPushContext(w, 'I TOLD YOU THE HERBS COME FROM THE NORTH', 'Tôi đã nói với ông rồi');
  assert.deepEqual(w, ['I TOLD YOU THE HERBS COME FROM THE NORTH -> Tôi đã nói với ông rồi']);
});

test('push bo qua muc bi loc', () => {
  const w = [];
  motPushContext(w, 'HUFF', 'HỰC');
  assert.deepEqual(w, []);
});

test('cua so khong bao gio vuot 8 muc, giu cac muc MOI nhat', () => {
  const w = [];
  for (let i = 1; i <= 12; i++) motPushContext(w, `LINE NUMBER ${i} HERE`, `Dòng số ${i}`);
  assert.equal(w.length, MOT_CONTEXT_MAX);
  assert.ok(w[w.length - 1].includes('LINE NUMBER 12'));
  assert.ok(!w.some((x) => x.includes('LINE NUMBER 1 HERE')));
});

test('payload tra ban sao, khong lo mang goc ra ngoai', () => {
  const w = [];
  motPushContext(w, 'A REAL DIALOGUE LINE', 'Một câu thoại thật');
  const p = motContextPayload(w);
  p.push('rác');
  assert.equal(w.length, 1);
});

test('payload cua cua so rong la mang rong', () => {
  assert.deepEqual(motContextPayload([]), []);
  assert.deepEqual(motContextPayload(null), []);
});

// ===== Khong cho dai tu "bang phang" tu nhan ban qua cua so =====
// Do duoc tren truyen that: cua so KHONG lam ban dich dung, no lam ban dich
// NHAT QUAN voi lua chon dau tien. Trang dau chuong chua co cua so nen model
// dung mac dinh cua no la "ban" - chinh dang ma gpt_config cam ("never a flat
// toi/ban") - roi "ban" vao cua so va moi trang sau chep theo. Do 3 lan: cua so
// chua 'ban' -> 3/3 lan ra 'ban'; cua so chua 'ong' -> 3/3 ra 'ong'; khong cua
// so -> 'cau'. Chan tu goc: dong dung "ban" khong duoc lam mau tham chieu.

test('KHONG nap dong dung dai tu bang phang "ban" vao cua so', () => {
  assert.equal(motShouldKeepForContext(
    'AND HOW DO I KNOW YOU DIDNT GIVE ME A BAD BATCH',
    'VÀ LÀM SAO TÔI BIẾT BẠN KHÔNG ĐƯA TÔI LÔ HÀNG KÉM'), false);
  assert.equal(motShouldKeepForContext(
    'HOW DARE YOU SPEAK TO ERKIN THAT WAY',
    'CÁI GÌ?! BẠN DÁM NÓI VỚI ERKIN NHƯ THẾ?!'), false);
});

test('van nap dong dung dai tu dung', () => {
  assert.equal(motShouldKeepForContext(
    'I TOLD YOU THE HERBS COME FROM THE NORTH',
    'TÔI ĐÃ NÓI VỚI CẬU RỒI, THẢO DƯỢC ĐẾN TỪ PHƯƠNG BẮC'), true);
  assert.equal(motShouldKeepForContext(
    'YOU DID NOT STORE THE HERBS PROPERLY',
    'ÔNG ĐÃ KHÔNG BẢO QUẢN THẢO DƯỢC ĐÚNG CÁCH'), true);
});

test('"ban be" la danh tu, khong phai dai tu - van duoc nap', () => {
  assert.equal(motShouldKeepForContext(
    'WE HAVE BEEN FRIENDS FOR YEARS',
    'CHÚNG TA ĐÃ LÀ BẠN BÈ NHIỀU NĂM RỒI'), true);
});
