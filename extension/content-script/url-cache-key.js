// Chuan hoa URL anh truoc khi dung lam khoa chi muc URL->hash (Cache._urlKey).
//
// VAN DE (do duoc 2026-08-18): URL anh cua hitomi nhung 1 doan unix timestamp
// quay vong khoang moi 28 gio, vi du 2 URL cua CUNG 1 trang:
//   https://a1.gold-usergeneratedcontent.net/1786881600/1049/<filehash>.avif
//   https://a1.gold-usergeneratedcontent.net/1786982400/1049/<filehash>.avif
// (subdomain va <filehash> giong het nhau, chi doan so o dau doi). Vi
// Cache._urlKey khoa theo URL THO, sau moi lan quay vong toan bo chi muc chet
// -> fast path miss -> phai tai lai anh + bam (~2-3.4s) du ban dich VAN CON
// trong cache. Do that tren may nguoi dung: 1963 khoa urlhash tan ra hon 10
// moc timestamp, moc moi nhat chi chiem 32.7%.
//
// QUY TAC PHAI HEP - day la diem danh doi quan trong: neu chuan hoa qua tay,
// hai anh KHAC NHAU se cho ra cung 1 khoa va ta se ve ban dich cua anh khac
// len anh nay, IM LANG, khong co cach nao phat hien (fast path co y bo qua
// buoc tai + bam noi dung, nen khong con gi de doi chieu). Vi vay chi bo doan
// nao nhin ro la epoch timestamp:
//   - thuan chu so, dai 9-11 ky tu, gia tri trong khoang nam 2001..2096
//   - VA khong phai doan cuoi (doan cuoi la thu dinh danh file)
// So ngan nhu so chuong (/chapter/12/) hay ten file thuan so (/img/12345)
// deu duoc giu nguyen.
//
// Host duoc giu NGUYEN VEN ke ca subdomain: du lieu do duoc cho thay subdomain
// (a1) on dinh giua cac lan quay vong, nen khong co co so de bo no - ma bo
// nham thi hau qua dung bang truong hop tren.
//
// File nay tach rieng khoi content.js (von la 1 IIFE khong export gi) de test
// duoc bang node that su, xem tests/url-cache-key.test.js. Manifest nap file
// nay TRUOC content.js; cac file trong cung mot muc content_scripts dung chung
// isolated world nen ham khai bao o day thay duoc tu content.js.

function motLooksLikeEpochSegment(seg) {
  if (!/^[0-9]+$/.test(seg)) return false;
  if (seg.length < 9 || seg.length > 11) return false;
  const n = Number(seg);
  return n >= 1000000000 && n <= 4000000000;
}

function motNormalizeUrlForCacheKey(url) {
  if (typeof url !== 'string' || !url) return url;
  // blob:/data: khong on dinh giua cac lan tai trang - nguoi goi da loai chung
  // ra khoi dien cacheable, giu nguyen o day cho an toan.
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;

  let u;
  try {
    u = new URL(url);
  } catch (e) {
    return url;
  }

  const segs = u.pathname.split('/').filter((s) => s.length > 0);
  const kept = segs.filter((s, i) => i === segs.length - 1 || !motLooksLikeEpochSegment(s));
  // Bo protocol (http vs https cung 1 tai nguyen), giu host + path + query.
  return u.host + '/' + kept.join('/') + u.search;
}

// Hoi chi muc: URL nay da co san ban dich chua? Tra true chi khi BIET hash cua
// URL VA hash do that su con ban dich trong cache.
//
// Sinh ra cho prefetch. Truoc day vong lap prefetch chi GHI chi muc URL->hash
// (sau khi da tai + bam) ma khong bao gio DOC no, nen mo lai mot gallery da
// dich xong 100% van tai lai tung anh mot - qua dung duong 404->relay cham -
// chi de tinh lai cai hash da ghi san. Viec do chay nen, tranh mang voi chinh
// trang nguoi dung dang xem.
//
// Ham dung hai ham dung-khoa TIEM VAO thay vi tu ghep chuoi, de dinh dang khoa
// chi ton tai o mot noi duy nhat (Cache._urlKey / Cache._key trong content.js).
async function motIsUrlFullyCached(storage, url, urlKeyFn, cacheKeyFn) {
  const urlKey = urlKeyFn(url);
  const gotUrl = await storage.get(urlKey);
  const hash = gotUrl[urlKey];
  if (!hash) return false;
  const cacheKey = cacheKeyFn(hash);
  const gotCache = await storage.get(cacheKey);
  return !!gotCache[cacheKey];
}

// Chuyen chi muc URL->hash cu (khoa theo URL THO) sang dang chuan hoa.
// KHONG chi la don dep: vi chuan hoa bo dung doan timestamp da lam chung chet,
// moi khoa cu duoc HOI SINH thanh 1 khoa dung -> ca kho anh da dich tu truoc
// lai vao duoc fast path ma khong phai tai lai byte nao.
//
// storage duoc TIEM VAO (khong goi thang chrome.storage.local) de test duoc
// bang storage gia - day la doan XOA du lieu that cua nguoi dung nen khong
// duoc phep chi dua vao doc code. Xem tests/url-cache-key.test.js.
// Tra ve so khoa da chuyen.
async function motMigrateUrlHashKeys(storage, prefix, flagKey, log) {
  // getKeys() chi co tu Chrome 130. Thieu thi BO QUA han, KHONG duoc thay bang
  // get(null): kho do duoc 270MB tren may that, nap het vao RAM chi de doc ten
  // khoa la cai gia qua dat. Chi muc se tu dung lai dan nhu cu.
  if (typeof storage.getKeys !== 'function') return 0;

  const flag = await storage.get(flagKey);
  if (flag[flagKey]) return 0;

  const keys = (await storage.getKeys()).filter((k) => k.startsWith(prefix));
  let moved = 0;
  for (let i = 0; i < keys.length; i += 200) {
    const chunk = keys.slice(i, i + 200);
    const store = await storage.get(chunk);
    const writes = {};
    const removes = [];
    for (const oldKey of chunk) {
      const hash = store[oldKey];
      if (!hash) continue;
      const newKey = prefix + motNormalizeUrlForCacheKey(oldKey.slice(prefix.length));
      // Khoa cu va khoa moi dung chung tien to nen khong phan biet duoc; dieu
      // kien nay la thu bo qua khoa da chuan hoa tu lan chay truoc.
      if (newKey === oldKey) continue;
      writes[newKey] = hash;
      removes.push(oldKey);
    }
    if (removes.length) {
      // GHI TRUOC ROI MOI XOA: neu dut giua chung (het dung luong, dong tab)
      // thi mat mat toi da la vai khoa trung lap, khong bao gio mat chi muc.
      await storage.set(writes);
      await storage.remove(removes);
      moved += removes.length;
    }
  }
  await storage.set({ [flagKey]: Date.now() });
  if (moved && typeof log === 'function') {
    log('Da chuan hoa', moved, 'khoa chi muc URL - anh da dich tu truoc vao lai duoc fast path.');
  }
  return moved;
}
