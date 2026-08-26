// Cua so thoai gan nhat - gui kem moi luot dich de GPT giu nguyen ngoi xung
// giua cac trang.
//
// VI SAO CAN: quy tac 5 trong gpt_config-vi.yaml da yeu cau "reuse the same pair
// every time", nhung moi trang la MOT loi goi API doc lap khong co tri nho, nen
// model khong the biet trang truoc da dung cap nao. Do la loi CAU TRUC, khong
// phai loi dien dat prompt - viet them chi dan se khong sua duoc.
//
// DO DUOC (2026-08-26, 3 lan chay moi dieu kien, tren chuoi trang THAT co du
// bia/credits/SFX): khong ngu canh -> 5.3 lan doi dai tu; cua so KHONG loc ->
// 2.0 lan doi nhung chot vao dai tu khac nhau giua cac lan chay; cua so CO loc
// -> 1.0 lan doi va ra y het ca 3 lan. Xem spec 2026-08-26.
//
// CHI CHO NGUON TIENG ANH. Tieng Anh chi co mot chu "you" nen model buoc phai
// doan ngoi xung - dung cho cua so giup duoc. Nhat/Han ma hoa san muc lich su
// ngay trong cau goc (desu/masu, yo/seumnida) nen so lieu tren KHONG suy ra
// duoc, va suy dien kieu do chinh la thu da lam hong ban truoc (commit 7725ebc).
//
// Tach file rieng khoi content.js (von la 1 IIFE khong export gi) de test duoc
// bang node that. Manifest nap file nay TRUOC content.js.

const MOT_CONTEXT_MAX = 8;

// Cung bieu thuc voi bo loc SFX da co trong content.js:1510 - ky tu ngoai dai
// Latin mo rong nghia la nguon CJK/Hangul.
const MOT_CTX_NONLATIN = /[^\u0020-\u024F\s\d\p{P}]/u;

// Tieng dong. Khong phai thoai, va lam loang cua so.
const MOT_CTX_SFX = /^(huff|haa|hmph|stink|ding|argh+|badum|grumble|yell|pull|squeeze|flinch|creek|haha|gasp|sigh|tsk|ugh|thud|crash|bang|clang|whoosh|rustle|nl)[.!?]*$/i;

// Credits/ten studio o dau va cuoi chuong - chinh la thu da dau doc ban truoc.
const MOT_CTX_CREDIT = /tappytoon|studio|art\s*&\s*story|webtoon|naver|kakao|©|colorist|letterer/i;

function motIsLatinText(s) {
  if (typeof s !== 'string') return false;
  if (!s.trim()) return false;
  return !MOT_CTX_NONLATIN.test(s);
}

// Loc theo TUNG DONG, khong theo trang: trong log that co trang thoai that su
// nhung lan mot vung OCR kem (minprob 0.39), loc ca trang se vut nham.
function motShouldKeepForContext(src, dst) {
  const s = typeof src === 'string' ? src.trim() : '';
  const d = typeof dst === 'string' ? dst.trim() : '';
  if (!s || !d) return false;
  if (!motIsLatinText(s)) return false;
  if (MOT_CTX_SFX.test(s)) return false;
  if (MOT_CTX_CREDIT.test(s)) return false;
  if (s.split(/\s+/).length < 3) return false;
  if (d.toLowerCase() === s.toLowerCase()) return false;
  return true;
}

function motPushContext(win, src, dst) {
  if (!Array.isArray(win)) return win;
  if (!motShouldKeepForContext(src, dst)) return win;
  win.push(String(src).trim() + ' -> ' + String(dst).trim());
  if (win.length > MOT_CONTEXT_MAX) win.splice(0, win.length - MOT_CONTEXT_MAX);
  return win;
}

function motContextPayload(win) {
  if (!Array.isArray(win)) return [];
  return win.slice(-MOT_CONTEXT_MAX);
}
