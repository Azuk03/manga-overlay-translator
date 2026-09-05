// Quyet dinh mot <img> co phai anh truyen dang dich hay khong.
//
// Tach ra khoi content.js (von nam trong IIFE, khong test duoc) theo dung
// khuon cua url-cache-key.js / image-format.js / dialogue-context.js: logic
// thuan, ham o pham vi top-level, nhan vao mot doi tuong duck-typed nen test
// khong can DOM that.

// Nhieu site lazy-load dat src TAM la anh placeholder (thuong la data: URI -
// SVG shimmer/"Loading..." dung dung kich thuoc anh that de tranh layout
// shift) roi moi thay bang URL that khi cuon toi. Placeholder loai nay DE qua
// duoc bo loc kich thuoc (vi co width/height khop voi anh that) nhung gui no
// cho backend se loi 422 - loai tu day, cho src that.
function motIsCandidateImage(img, cfg) {
  const src = img.currentSrc || img.src || '';
  if (src.startsWith('data:')) return false;
  if (!img.naturalWidth || !img.naturalHeight) return false;
  if (img.naturalWidth < cfg.MIN_NW || img.naturalHeight < cfg.MIN_NH) return false;
  if (motIsDisplayedTooNarrow(img, cfg)) return false;
  if (img.closest('header, nav, footer, aside')) return false;
  const idClass = `${img.id} ${img.className}`.toLowerCase();
  if (/logo|avatar|icon|banner|ad|thumb|sprite/.test(idClass)) return false;
  // ratio = cao/rong. Nguong duoi 0.4 (thay vi 0.5) de CHAP NHAN trang DOI nam
  // ngang cua mot so reader (vd MangaPlaza: 1442x688 ~ 0.475, truoc day bi loai
  // nham). Banner/ad thuong rong hon nhieu (ratio < 0.2) nen van bi loai.
  // Nguong tren 100 chan anh soc bat thuong.
  const ratio = img.naturalHeight / img.naturalWidth;
  if (ratio < 0.4 || ratio > 100) return false;
  return true;
}

// Loai banner/quang cao duoc VE RA nhung be xiu so voi be ngang man hinh.
//
// clientWidth === 0 KHONG phai "ve ra qua be" ma la "chua co hop layout" - hai
// chuyen khac han. MangaDex an moi trang khong phai trang hien tai, nen chung
// deu co clientWidth 0 du kich thuoc that van la 1284x1826; cong nay tung hieu
// nham thanh "hep 0.00" va vut het, khien che do dich truoc chi thay dung MOT
// anh (do that 2026-09-05: 3 anh 1284x1826 giong het nhau, 1 nhan 2 loai).
//
// Voi phan tu chua duoc bo tri thi cau hoi "co noi bat tren man hinh khong"
// khong tra loi duoc, nen dung tu choi no o day - cac cong kich thuoc that,
// ty le va id/class con lai van du de loai rac. Anh visa 1024x768 trong cung
// do do bi loai o 0.05 chu KHONG phai 0, tuc no co layout that nen van rot
// dung nhu cu.
function motIsDisplayedTooNarrow(img, cfg) {
  if (!img.clientWidth) return false;
  return img.clientWidth / cfg.viewportWidth < cfg.MIN_DISPLAY_RATIO;
}
