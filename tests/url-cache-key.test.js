// Test cho motNormalizeUrlForCacheKey() - chuan hoa URL truoc khi dung lam khoa
// chi muc URL->hash (Cache._urlKey).
//
// LY DO TON TAI (do duoc 2026-08-18): URL anh cua hitomi nhung 1 doan unix
// timestamp quay vong (~28h). Cung 1 trang, doc cach nhau qua 1 moc la URL da
// khac -> khoa khac -> fast path miss -> phai tai lai anh + bam (~2-3.4s) du
// ban dich VAN CON trong cache. Do that: 1963 khoa urlhash tan ra hon 10 moc
// timestamp, moc moi nhat chi chiem 32.7% => chi muc gan nhu chi-ghi-khong-doc.
//
// RUI RO PHAI CAN BANG: chuan hoa qua tay se lam 2 anh KHAC NHAU tro thanh
// cung 1 khoa -> ve ban dich cua anh khac len anh nay, im lang, khong co cach
// nao phat hien. Vi vay quy tac phai HEP: chi bo doan nhin ro la epoch
// timestamp (9-11 chu so, trong khoang nam 2001-2096) VA khong phai doan cuoi
// (doan cuoi la thu dinh danh file). So ngan nhu so chuong (/chapter/12/) phai
// duoc giu nguyen.
//
// Chay: node --test tests/
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

// Nap file that (khong copy code) - file la 1 script thuong khai bao ham o
// pham vi top-level, dung y het luc chay trong content script.
const SRC_PATH = path.join(__dirname, '..', 'extension', 'content-script', 'url-cache-key.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');
const api = new Function(
  `${src}\nreturn { motNormalizeUrlForCacheKey, motMigrateUrlHashKeys, motIsUrlFullyCached };`
)();
const normalize = api.motNormalizeUrlForCacheKey;
const migrate = api.motMigrateUrlHashKeys;

const PREFIX = 'mot_urlhash_v24_';
const FLAG = 'mot_urlhash_normalized_v24';

// Storage gia mo phong be mat chrome.storage.local ma migration dung.
function fakeStorage(initial, opts = {}) {
  const data = { ...initial };
  return {
    data,
    removeCalls: [],
    async getKeys() {
      if (opts.noGetKeys) throw new Error('khong duoc goi getKeys');
      return Object.keys(data);
    },
    async get(k) {
      const keys = typeof k === 'string' ? [k] : k;
      const out = {};
      for (const key of keys) if (key in data) out[key] = data[key];
      return out;
    },
    async set(obj) {
      if (opts.setThrows) throw new Error('storage day');
      Object.assign(data, obj);
    },
    async remove(keys) {
      this.removeCalls.push(keys);
      for (const key of [].concat(keys)) delete data[key];
    },
  };
}

const EPOCH_A = 'https://a1.gold-usergeneratedcontent.net/1786881600/1049/703ee0779ac553015747fa7e5efe343029396c04efa3.avif';
const EPOCH_B = 'https://a1.gold-usergeneratedcontent.net/1786982400/1049/703ee0779ac553015747fa7e5efe343029396c04efa3.avif';

test('hai URL chi khac doan epoch timestamp cho ra cung mot khoa', () => {
  assert.strictEqual(normalize(EPOCH_A), normalize(EPOCH_B));
});

test('subdomain khac nhau KHONG duoc gop chung khoa', () => {
  const a2 = EPOCH_A.replace('//a1.', '//a2.');
  assert.notStrictEqual(normalize(EPOCH_A), normalize(a2));
});

test('file hash khac nhau KHONG duoc gop chung khoa', () => {
  const other = EPOCH_A.replace('703ee0779ac553015747fa7e5efe343029396c04efa3', 'eb7bb784907e9328958759899ef5df63068b0dfe7364');
  assert.notStrictEqual(normalize(EPOCH_A), normalize(other));
});

test('so ngan nhu so chuong duoc giu nguyen (khong duoc gop)', () => {
  const c12 = 'https://truyen.example/chapter/12/page/3.jpg';
  const c13 = 'https://truyen.example/chapter/13/page/3.jpg';
  assert.notStrictEqual(normalize(c12), normalize(c13));
});

test('doan cuoi thuan so (ten file khong duoi) duoc giu nguyen', () => {
  const a = 'https://cdn.example/img/1786881600';
  const b = 'https://cdn.example/img/1786982400';
  assert.notStrictEqual(normalize(a), normalize(b));
});

test('so 10 chu so NGOAI khoang epoch hop le duoc giu nguyen', () => {
  const a = 'https://cdn.example/9999999999/x/f.jpg'; // nam 2286, ngoai khoang
  const b = 'https://cdn.example/9999999998/x/f.jpg';
  assert.notStrictEqual(normalize(a), normalize(b));
});

test('URL khong co doan epoch thi giu nguyen y nghia (on dinh, idempotent)', () => {
  const u = 'https://cdn.example/a/b/c.png';
  assert.strictEqual(normalize(u), normalize(u));
  assert.ok(normalize(u).includes('c.png'));
  assert.ok(normalize(u).includes('cdn.example'));
});

test('query string duoc giu (khac query => khac khoa)', () => {
  const a = 'https://cdn.example/a/f.jpg?v=1';
  const b = 'https://cdn.example/a/f.jpg?v=2';
  assert.notStrictEqual(normalize(a), normalize(b));
});

test('chuoi khong phai URL tra ve nguyen ban, khong nem loi', () => {
  assert.strictEqual(normalize('khong-phai-url'), 'khong-phai-url');
  assert.strictEqual(normalize(''), '');
});

// Migration doc lai cac khoa cu (dang URL tho) roi ghi lai duoi dang chuan
// hoa, dung CHUNG tien to voi khoa moi -> khong phan biet duoc cu/moi. Vi vay
// chay lai migration phai vo hai: normalize(normalize(x)) === normalize(x).
test('idempotent: chuan hoa lai chuoi da chuan hoa thi khong doi', () => {
  for (const u of [EPOCH_A, 'https://cdn.example/a/b/c.png', 'https://cdn.example/a/f.jpg?v=1']) {
    const once = normalize(u);
    assert.strictEqual(normalize(once), once, `khong idempotent voi: ${u}`);
  }
});

test('blob: va data: tra ve nguyen ban', () => {
  const blob = 'blob:https://hitomi.la/9f1c-4d2e';
  assert.strictEqual(normalize(blob), blob);
});

// ===== migration chi muc URL->hash =====
// Day la doan XOA khoa that cua nguoi dung (1963 khoa do duoc tren may thuc
// te), nen phai duoc test ky hon phan con lai.

test('migration: khoa cu theo URL tho duoc ghi lai duoi khoa chuan hoa, khoa cu bi xoa', async () => {
  const s = fakeStorage({ [PREFIX + EPOCH_A]: 'hash-abc' });
  await migrate(s, PREFIX, FLAG);
  const newKey = PREFIX + normalize(EPOCH_A);
  assert.strictEqual(s.data[newKey], 'hash-abc');
  assert.ok(!(PREFIX + EPOCH_A in s.data), 'khoa cu phai bi xoa');
});

test('migration: hai khoa cu khac timestamp gop lai thanh mot khoa', async () => {
  const s = fakeStorage({
    [PREFIX + EPOCH_A]: 'hash-abc',
    [PREFIX + EPOCH_B]: 'hash-abc',
  });
  await migrate(s, PREFIX, FLAG);
  const urlKeys = Object.keys(s.data).filter((k) => k.startsWith(PREFIX));
  assert.strictEqual(urlKeys.length, 1, 'hai URL cua cung 1 trang phai gop lai');
  assert.strictEqual(s.data[urlKeys[0]], 'hash-abc');
});

test('migration: chay lan hai khong xoa them gi (co danh dau)', async () => {
  const s = fakeStorage({ [PREFIX + EPOCH_A]: 'hash-abc' });
  await migrate(s, PREFIX, FLAG);
  const after1 = { ...s.data };
  s.removeCalls.length = 0;
  await migrate(s, PREFIX, FLAG);
  assert.deepStrictEqual(s.data, after1, 'lan hai khong duoc doi gi');
  assert.strictEqual(s.removeCalls.length, 0, 'lan hai khong duoc goi remove');
});

test('migration: khong dung toi khoa cua muc dich khac', async () => {
  const s = fakeStorage({
    [PREFIX + EPOCH_A]: 'hash-abc',
    'mot_cache_v24_chatgpt_VIN_deadbeef': '{"regions":[]}',
    'mot_target_lang': 'VIN',
  });
  await migrate(s, PREFIX, FLAG);
  assert.strictEqual(s.data['mot_cache_v24_chatgpt_VIN_deadbeef'], '{"regions":[]}');
  assert.strictEqual(s.data['mot_target_lang'], 'VIN');
});

test('migration: browser khong co getKeys thi bo qua, khong nem loi', async () => {
  const s = fakeStorage({ [PREFIX + EPOCH_A]: 'hash-abc' }, { noGetKeys: true });
  delete s.getKeys;
  await migrate(s, PREFIX, FLAG);
  assert.strictEqual(s.data[PREFIX + EPOCH_A], 'hash-abc', 'du lieu phai con nguyen');
});

test('migration: ghi that bai thi KHONG duoc xoa khoa cu', async () => {
  const s = fakeStorage({ [PREFIX + EPOCH_A]: 'hash-abc' }, { setThrows: true });
  await assert.rejects(() => migrate(s, PREFIX, FLAG));
  assert.strictEqual(s.removeCalls.length, 0, 'khong duoc xoa khi chua ghi duoc');
  assert.strictEqual(s.data[PREFIX + EPOCH_A], 'hash-abc');
});

// ===== tra cuu "URL nay da cache day du chua" =====
// Dung cho prefetch: truoc khi TAI anh ve de bam hash, hoi chi muc xem da
// biet hash chua VA hash do da co ban dich chua. Truoc day prefetch khong he
// hoi -> mo lai 1 gallery da dich xong 100% van tai lai tung anh mot (qua
// duong 404->relay cham), tranh mang voi chinh trang dang xem.

const cacheKeyOf = (h) => `mot_cache_v24_chatgpt_VIN_${h}`;
const urlKeyOf = (u) => PREFIX + normalize(u);

test('da cache day du: co hash trong chi muc VA co ban dich -> true', async () => {
  const s = fakeStorage({
    [urlKeyOf(EPOCH_A)]: 'hash-abc',
    [cacheKeyOf('hash-abc')]: '{"regions":[]}',
  });
  assert.strictEqual(await api.motIsUrlFullyCached(s, EPOCH_A, urlKeyOf, cacheKeyOf), true);
});

test('URL chua co trong chi muc -> false', async () => {
  const s = fakeStorage({});
  assert.strictEqual(await api.motIsUrlFullyCached(s, EPOCH_A, urlKeyOf, cacheKeyOf), false);
});

test('co hash nhung ban dich da bi xoa -> false (phai tai lai that)', async () => {
  const s = fakeStorage({ [urlKeyOf(EPOCH_A)]: 'hash-abc' });
  assert.strictEqual(await api.motIsUrlFullyCached(s, EPOCH_A, urlKeyOf, cacheKeyOf), false);
});

test('URL khac timestamp van tra ve true (dung chung khoa chuan hoa)', async () => {
  const s = fakeStorage({
    [urlKeyOf(EPOCH_A)]: 'hash-abc',
    [cacheKeyOf('hash-abc')]: '{"regions":[]}',
  });
  assert.strictEqual(await api.motIsUrlFullyCached(s, EPOCH_B, urlKeyOf, cacheKeyOf), true);
});
