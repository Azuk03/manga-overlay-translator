// Quyet dinh mot vung chu da dich co duoc VE overlay hay khong.
//
// Tach ra khoi content.js (nam trong IIFE, khong test duoc) - chinh vi khong
// test duoc ma mot loi o day da lot qua ba luot review, xem ghi chu ben duoi.

// dst == src nghia la overlay KHONG mang them thong tin nao ma nguoi doc chua
// doc duoc tren art goc. Ve no ra chi co mot tac dung: xoa net chu goc (vung da
// bi inpaint) roi ve lai dung chuoi do bang font overlay. Voi SFX ke tay, ten
// rieng co kieu chu, hay watermark cua hoa si thi day la mat mat thuan tuy.
//
// LICH SU - doc ky truoc khi doi:
//
// 1. Duong CU (mot lan goi, translator='chatgpt') co bo loc "Translation
//    identical to original" o BACKEND, va no chay TRUOC buoc mask + inpaint.
//    Vung bi loai o do khong bao gio bi inpaint, nen art goc con nguyen ven va
//    vung khong bao gio ve toi client.
//
// 2. Duong MOI tach pha: pha A dung translator='none', ma nhanh 'none' return
//    som TRUOC ca khoi loc do -> bo loc backend KHONG THE chay. Moi vung deu bi
//    inpaint va deu ve toi client. Do duoc 2026-09-05: chi 3/12 trang khop voi
//    duong cu, pha A luon la tap CHA.
//
// 3. Ban cu cua ham nay chi bo khi nguon la PHI-Latin, kem ghi chu: "KHONG bo
//    khi src la Latin (tranh xoa nham tu hop le/ten rieng model tra trung - da
//    tung lam sot tu)". Ngoai le do sinh ra khi bo loc backend con chay, tuc no
//    chi con gap cac cap trung ma backend da bo sot. Gio backend khong loc nua
//    thi ngoai le nay bien moi trang chu Latin thanh trang bi xoa SFX/ten rieng.
//
//    Vi sao bo ngoai le KHONG lam "sot tu" tro lai: vung bi loai o day khong
//    duoc ve, ma anh nen inpaint cua no cung chi duoc ve TRONG luc render vung
//    do - bo vung thi anh nen khong bao gio duoc dat len, nen art goc hien
//    nguyen. Nguoi doc van doc duoc dung chuoi ay tren art goc.
//
//    NEU sau nay thay chu BIEN MAT tren trang tieng Anh (khong phai bi ve de
//    xau, ma mat han), day la dong dau tien can xem lai.
function motShouldRenderRegion(src, dst) {
  const _src = (src || '').trim();
  const _dst = (dst || '').trim();
  if (!_dst) return false;
  if (_dst.toLowerCase() === _src.toLowerCase()) return false;
  return true;
}
