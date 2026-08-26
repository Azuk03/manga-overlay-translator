// Quyet dinh: co phai GIAI MA + NEN LAI anh sang PNG truoc khi gui backend khong?
//
// VAN DE: downloadImageBlob() truoc day nen lai MOI anh sang PNG vo dieu kien.
// Do that tren anh mau cua repo (800x1147): 4.webp 117KB -> PNG 653KB -> data
// URL 871KB, tuc phinh 7,4 lan. Trang hitomi that (2036x2880) lon gap ~6,4 lan
// dien tich do. Cai gia moi trang: mot luot nen PNG anh 6 megapixel, cong SHA-256
// chay tren ban 4MB thay vi ban 500KB, cong chuoi base64 to hon di qua message
// port.
//
// Ma phan lon viec do la thua: da kiem chung tren dung image dang chay
// (manga-translator-patched:local, Pillow 10.2.0) rang backend doc THANG duoc
// JPEG, PNG, WebP; rieng AVIF thi khong - va do la ly do Dockerfile gio cai them
// pillow-avif-plugin (xem patches/main.py: import pillow_avif).
//
// HAI CAI BAY phai tranh khi bo buoc nen lai - day la ly do file nay ton tai
// thay vi mot phep so sanh chuoi mot dong:
//
//  1. HUONG XOAY EXIF. Trinh duyet AP DUNG orientation trong EXIF khi ve <img>
//     (image-orientation: from-image la mac dinh), con Pillow thi KHONG
//     (Image.open bo qua, phai goi ImageOps.exif_transpose moi xoay). Duong cu
//     ve <img> ra canvas nen huong xoay da duoc "nuong" san vao PNG => toa do
//     backend tra ve luon khop voi cai nguoi dung nhin thay. Gui thang byte goc
//     cua mot anh co EXIF orientation != 1 se lam backend thay anh CHUA xoay:
//     naturalWidth/naturalHeight ben trinh duyet bi hoan doi so voi ben backend,
//     va toan bo overlay dat sai cho. Nen o day cu THAY co khoi EXIF la nen lai,
//     khong thu doc gia tri orientation - sai so ve phia an toan, va anh CDN
//     truyen tranh gan nhu luon bi lot sach metadata nen fast path van trung.
//
//  2. BACKEND CU. Nguoi dung co the cap nhat extension ma chua build lai image,
//     luc do backend chua co pillow-avif-plugin va se tra 422 cho AVIF. Cho nen
//     ben content.js con mot buoc thu lai: gui thang that bai -> nen lai PNG ->
//     gui lai mot lan nua (xem passthroughBlobs trong content.js).
//
// Tach file rieng khoi content.js (von la 1 IIFE khong export gi) de test duoc
// bang node that, xem tests/image-format.test.js. Manifest nap file nay TRUOC
// content.js; cac file trong cung mot muc content_scripts dung chung isolated
// world nen ham khai bao o day thay duoc tu content.js.

// Dinh dang Pillow (kem pillow-avif-plugin) doc truc tiep duoc. Da kiem chung
// bang PIL.features.check() + Image.registered_extensions() tren chinh image.
const MOT_BACKEND_READABLE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
]);

// 'image/jpeg; charset=binary' -> 'image/jpeg'
function motNormalizeContentType(contentType) {
  if (typeof contentType !== 'string') return '';
  return contentType.split(';')[0].trim().toLowerCase();
}

function motBackendCanRead(contentType) {
  return MOT_BACKEND_READABLE_TYPES.has(motNormalizeContentType(contentType));
}

// Cac chuoi ASCII danh dau mot khoi EXIF trong tung dinh dang container:
//   'Exif' - JPEG (segment APP1 bat dau bang "Exif\0\0") va AVIF (item 'Exif')
//   'EXIF' - WebP (fourcc cua chunk EXIF trong container RIFF)
//   'eXIf' - PNG (ten chunk eXIf)
const MOT_EXIF_MARKERS = ['Exif', 'EXIF', 'eXIf'].map((s) =>
  Array.from(s, (ch) => ch.charCodeAt(0))
);

function motBytesContainAt(bytes, pattern, at) {
  for (let i = 0; i < pattern.length; i++) {
    if (bytes[at + i] !== pattern[i]) return false;
  }
  return true;
}

function motScanRange(bytes, start, end) {
  for (const pattern of MOT_EXIF_MARKERS) {
    const last = end - pattern.length;
    for (let i = start; i <= last; i++) {
      if (motBytesContainAt(bytes, pattern, i)) return true;
    }
  }
  return false;
}

// Chi quet DAU va CUOI file thay vi toan bo: metadata cua JPEG/PNG/AVIF luon
// nam gan dau, con WebP thi mot so bo ma dat chunk EXIF o cuoi container. Quet
// het mot anh vai MB moi trang la tu chuoc lay dung cai chi phi dang muon bo.
const MOT_EXIF_SCAN_HEAD = 128 * 1024;
const MOT_EXIF_SCAN_TAIL = 32 * 1024;

function motHasExifBlock(bytes) {
  if (!bytes || typeof bytes.length !== 'number') return true; // khong doc duoc -> nen lai cho chac
  const len = bytes.length;
  const headEnd = Math.min(len, MOT_EXIF_SCAN_HEAD);
  if (motScanRange(bytes, 0, headEnd)) return true;
  const tailStart = Math.max(headEnd, len - MOT_EXIF_SCAN_TAIL);
  if (tailStart < len && motScanRange(bytes, tailStart, len)) return true;
  return false;
}

// true  = phai giai ma bang trinh duyet roi nen lai PNG (duong cu, cham).
// false = gui thang byte goc cho backend duoc.
function motShouldReencodeForBackend(contentType, bytes) {
  if (!motBackendCanRead(contentType)) return true;
  return motHasExifBlock(bytes);
}
