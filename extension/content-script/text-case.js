// Chuan hoa chu HOA/thuong cua ban dich theo dung chu goc.
//
// VAN DE (do tren truyen that): nguon OCR gan nhu luon la ALL-CAPS (chu trong
// truyen tranh von duoc viet hoa), nhung ban dich tra ve luc HOA luc thuong -
// 85% ALL-CAPS lan 15% viet thuong ngay trong cung mot chuong. Chinh su LAN LON
// do moi choi mat, chu khong phai viec viet hoa.
//
// Cua so ngu canh con KHUECH DAI no: no chep chu HOA cua trang truoc sang trang
// sau (do duoc 66% -> 84% ngay sau khi bat tinh nang do).
//
// Day KHONG phai viec cua LLM. gpt_config-vi.yaml da co quy tac chuan hoa viet
// hoa tu lau va model van khong tuan thu on dinh - prompt la xu huong, khong
// phai bao dam. Bam theo chu goc thi xac dinh hoan toan, khong ton token, va
// khong the "truot".
//
// VI SAO KHONG dung sentence-case: ca nguon lan dich deu ALL-CAPS nen KHONG the
// phan biet ten rieng bang may - "ERKIN" giua cau se thanh "erkin". Viet HOA
// thi khong bao gio lam hong ten rieng, nen do la chieu an toan duy nhat.
//
// Chi doi luc HIEN THI. Cache van giu nguyen van model tra ve, nen doi y sau
// nay khong phai xoa cache.
//
// Tach file rieng de test duoc bang node that. Manifest nap TRUOC content.js.

function motIsAllCaps(s) {
  if (typeof s !== 'string') return false;
  let hasLetter = false;
  for (const ch of s) {
    if (ch.toLowerCase() !== ch.toUpperCase()) {
      hasLetter = true;
      if (ch !== ch.toUpperCase()) return false;
    }
  }
  return hasLetter;
}

// src ALL-CAPS -> dua dst len HOA. Nguoc lai giu nguyen dst.
function motMatchSourceCase(src, dst) {
  if (typeof dst !== 'string' || !dst) return dst;
  if (!motIsAllCaps(src)) return dst;
  return dst.toUpperCase();
}
