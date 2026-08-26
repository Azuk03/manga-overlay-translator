# English Pronoun Context Window — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gửi kèm mỗi lượt dịch một cửa sổ 8 câu thoại đã dịch gần nhất, chỉ cho nguồn tiếng Anh, để GPT giữ nguyên ngôi xưng giữa các trang.

**Architecture:** Client (`content.js`) giữ cửa sổ trong bộ nhớ tab và đính vào body request dưới khoá `context`. Backend khai báo field đó ở `TranslateRequest`, `main.py` gắn nó lên `config` bằng underscore-attr (đúng mẫu `_response_format` đang chạy), `share.py` đặt vào một biến module của `chatgpt` **bên trong khoá độc quyền của executor**, và `chatgpt.py` chèn nó thành một system message.

**Tech Stack:** JS thuần (extension MV3, không có build step), Python 3.11 + pydantic v2 + FastAPI trong container, `node --test`, `pytest`, Pester.

**Spec:** `docs/superpowers/specs/2026-08-26-english-pronoun-context-window-design.md`

## Global Constraints

- **Chỉ nguồn tiếng Anh.** Vùng có `src` chứa ký tự ngoài `\u0020-\u024F` không bao giờ được nạp vào cửa sổ (cùng biểu thức với `content.js:1510`). Truyện CJK phải giữ nguyên hành vi và chi phí hiện tại.
- **Backend không giữ state xuyên request.** Ngữ cảnh đến từ request hiện tại rồi bị xoá trong `finally`.
- **Tối đa 8 mục** trong cửa sổ (`MOT_CONTEXT_MAX = 8`).
- **Không đổi `CFG.CACHE_VERSION`** — thay đổi này không làm bản dịch đã cache sai đi.
- File JS mới phải nạp **trước** `content.js` trong `manifest.json`, theo đúng mẫu `url-cache-key.js` và `image-format.js`.
- File Python mới trong `patches/` phải được `COPY` trong `Dockerfile`, nếu không nó không tồn tại trong image.
- Toàn bộ phải xanh: `node --test tests/`, `python -m pytest tests/`, `Invoke-Pester -Path tests`.

---

### Task 1: Module cửa sổ thoại (thuần, chưa nối dây)

**Files:**
- Create: `extension/content-script/dialogue-context.js`
- Test: `tests/dialogue-context.test.js`

**Interfaces:**
- Consumes: không có.
- Produces: `MOT_CONTEXT_MAX` (bằng 8), `motIsLatinText(s) -> bool`, `motShouldKeepForContext(src, dst) -> bool`, `motPushContext(win, src, dst) -> win` (sửa mảng tại chỗ, cắt còn 8 mục mới nhất), `motContextPayload(win) -> string[]`.

- [ ] **Step 1: Viết test đỏ**

Tạo `tests/dialogue-context.test.js` với đúng nội dung sau:

```javascript
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
```

- [ ] **Step 2: Chạy test để chắc chắn nó ĐỎ**

Run: `node --test tests/dialogue-context.test.js`
Expected: FAIL — `ENOENT ... dialogue-context.js`

- [ ] **Step 3: Viết module**

Tạo `extension/content-script/dialogue-context.js` với đúng nội dung sau:

```javascript
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
// ngay trong cau goc (です/ます, 요/습니다) nen so lieu tren KHONG suy ra duoc,
// va suy dien kieu do chinh la thu da lam hong ban truoc (xem commit 7725ebc).
//
// Tach file rieng khoi content.js (von la 1 IIFE khong export gi) de test duoc
// bang node that. Manifest nap file nay TRUOC content.js.

const MOT_CONTEXT_MAX = 8;

// Cung bieu thuc voi bo loc SFX da co trong content.js - ky tu ngoai dai Latin
// mo rong nghia la nguon CJK/Hangul.
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
```

- [ ] **Step 4: Chạy test để chắc chắn nó XANH**

Run: `node --test tests/dialogue-context.test.js`
Expected: PASS, 13 test.

- [ ] **Step 5: Chạy toàn bộ test JS**

Run: `node --test tests/`
Expected: PASS, 49 test (36 cũ + 13 mới), 0 fail.

- [ ] **Step 6: Commit**

```bash
git add extension/content-script/dialogue-context.js tests/dialogue-context.test.js
git commit -m "Add the dialogue context window module, English source only"
```

---

### Task 2: Nối cửa sổ vào content.js

**Files:**
- Modify: `extension/manifest.json`
- Modify: `extension/content-script/content.js` (3 chỗ)

**Interfaces:**
- Consumes: `motPushContext`, `motContextPayload` từ Task 1.
- Produces: body request có thể mang thêm khoá `context` là `string[]`. Backend chưa đọc — Task 3 mới đọc. Bước này an toàn vì pydantic mặc định bỏ qua field lạ.

- [ ] **Step 1: Nạp module mới trong manifest**

Trong `extension/manifest.json`, đổi mảng `content_scripts[0].js` thành:

```json
      "js": [
        "content-script/url-cache-key.js",
        "content-script/image-format.js",
        "content-script/dialogue-context.js",
        "content-script/content.js"
      ],
```

- [ ] **Step 2: Khai báo cửa sổ trong content.js**

Trong `extension/content-script/content.js`, ngay TRƯỚC dòng `// ===== ApiAdapter — NOI DUY NHAT BIET SCHEMA BACKEND =====`, chèn:

```javascript
  // Cua so thoai gan nhat cua RIENG tab nay. Giu o client (khong phai backend)
  // vi do that cho thay tron ngu canh giua cac truyen la tai hoa AM THAM: diem
  // nhat quan van dep nhung toan bo register bi sai (mot canh tiem thuoc hien
  // dai bi dich bang giong cung dinh ta-nguoi). Nguoi dung chay toi 10 tab dong
  // thoi nen state dung chung o backend la dung kich ban do.
  const dialogueWindow = [];
```

- [ ] **Step 3: Đính cửa sổ vào body request**

Trong `ApiAdapter.translateImage`, thay khối:

```javascript
      const send = async (b) => {
        const body = JSON.stringify({ image: await this.blobToDataURL(b), config });
        return await sendMessageAsync({ type: 'TRANSLATE', body });
      };
```

bằng:

```javascript
      const send = async (b) => {
        const payload = { image: await this.blobToDataURL(b), config };
        // detectOnly chay translator 'none' (khong goi GPT) nen ngu canh vo nghia.
        if (!detectOnly) {
          const ctx = motContextPayload(dialogueWindow);
          if (ctx.length) payload.context = ctx;
        }
        return await sendMessageAsync({ type: 'TRANSLATE', body: JSON.stringify(payload) });
      };
```

- [ ] **Step 4: Thu hoạch thoại vào cửa sổ sau mỗi trang**

Trong `translateAndRenderImage`, ngay SAU dấu đóng của khối `result.regions = result.regions.filter((r) => { ... });` và ngay TRƯỚC dòng `const busyFlags = await computeRegionComplexity(result.regions);`, chèn:

```javascript
      // Nap thoai cua trang nay vao cua so cho trang sau. Dat SAU bo loc de
      // khong nap nham vung da bi loai, va chay ca khi trung cache - nho vay
      // trang da cache khong lam thung cua so.
      for (const r of result.regions) {
        motPushContext(dialogueWindow, r.src, r.dst);
      }
```

- [ ] **Step 5: Kiểm tra cú pháp, manifest và test**

```bash
node --check extension/content-script/content.js
python -c "import json;json.load(open('extension/manifest.json'));print('manifest OK')"
node --test tests/
```
Expected: cú pháp OK, `manifest OK`, 49 test PASS.

- [ ] **Step 6: Chứng minh cổng chặn CJK hoạt động**

```bash
node -e "
const fs=require('fs');
const api=new Function(fs.readFileSync('extension/content-script/dialogue-context.js','utf8')+'\nreturn {motPushContext,motContextPayload};')();
const w=[];
api.motPushContext(w,'この薬草はとても高いですよ','Thao duoc nay dat lam day');
api.motPushContext(w,'이 약초는 아주 비싸요','Thao duoc nay dat lam');
if(api.motContextPayload(w).length!==0) throw new Error('CONG CHAN CJK HONG');
console.log('OK: nguon CJK khong bao gio vao cua so');
"
```
Expected: `OK: nguon CJK khong bao gio vao cua so`

- [ ] **Step 7: Commit**

```bash
git add extension/manifest.json extension/content-script/content.js
git commit -m "Send the dialogue window with each English-source translate request"
```

---

### Task 3: Backend nhận field `context`

**Files:**
- Create: `patches/request_extraction.py` (full override của `/app/server/request_extraction.py`)
- Modify: `patches/main.py` (hàm `stream_json`)
- Modify: `Dockerfile`

**Interfaces:**
- Consumes: khoá `context` trong body request từ Task 2.
- Produces: `config._mot_context` kiểu `list[str]` trên đối tượng `Config`, đi qua pickle sang executor. Task 4 đọc bằng `getattr(config, "_mot_context", None)`.

- [ ] **Step 1: Lấy file gốc ra làm nền**

```bash
docker run --rm --entrypoint cat manga-translator-patched:local /app/server/request_extraction.py > patches/request_extraction.py
wc -l patches/request_extraction.py
```
Expected: 86 dòng.

- [ ] **Step 2: Thêm field `context`**

Trong `patches/request_extraction.py`, đổi dòng:

```python
from typing import Union
```

thành:

```python
from typing import List, Optional, Union
```

Rồi đổi khối:

```python
class TranslateRequest(BaseModel):
    """This request can be a multipart or a json request"""
    image: bytes|str
    """can be a url, base64 encoded image or a multipart image"""
    config: Config = Config()
    """in case it is a multipart this needs to be a string(json.stringify)"""
```

thành:

```python
class TranslateRequest(BaseModel):
    """This request can be a multipart or a json request"""
    image: bytes|str
    """can be a url, base64 encoded image or a multipart image"""
    config: Config = Config()
    """in case it is a multipart this needs to be a string(json.stringify)"""
    context: Optional[List[str]] = None
    """Cac cau da dich gan nhat cua CHINH truyen dang doc, dang "src -> dst",
    theo thu tu doc. Client giu va gui kem moi luot; backend KHONG luu lai gi.
    Chi co voi nguon tieng Anh - xem extension/content-script/dialogue-context.js
    va docs/superpowers/specs/2026-08-26-english-pronoun-context-window-design.md.
    PHAI khai bao o day: pydantic v2 mac dinh extra='ignore', field khong khai
    bao se bi bo AM THAM chu khong bao loi."""
```

- [ ] **Step 3: Gắn lên config trong `stream_json`**

Trong `patches/main.py`, đổi:

```python
    data.config._response_format = "json"
    return await while_streaming(req, transform_to_json, data.config, data.image)
```

thành:

```python
    data.config._response_format = "json"
    # Cung mau underscore-attr: server gan, executor doc bang getattr. Config di
    # qua ranh gioi tien trinh bang pickle nen thuoc tinh nay theo sang executor.
    data.config._mot_context = list(data.context or [])
    return await while_streaming(req, transform_to_json, data.config, data.image)
```

- [ ] **Step 4: COPY file mới trong Dockerfile**

Trong `Dockerfile`, ngay TRƯỚC dòng `COPY patches/gpt_response_parse.py ...`, chèn:

```dockerfile
# Them field `context` vao TranslateRequest. Pydantic v2 mac dinh extra='ignore'
# nen field khong khai bao se bi bo AM THAM - client gui len cung vo ich.
COPY patches/request_extraction.py /app/server/request_extraction.py
```

- [ ] **Step 5: Build lại image**

```bash
docker build -t manga-translator-patched:local .
```
Expected: build thành công.

- [ ] **Step 6: Chứng minh field đi tới nơi và sống sót qua pickle**

```bash
docker run --rm -i -w /app --entrypoint python manga-translator-patched:local - <<'PY'
import sys, pickle
sys.path.insert(0,'/app'); sys.path.insert(0,'/app/server')
from server.request_extraction import TranslateRequest

r = TranslateRequest(**{"image":"data:image/png;base64,AA==","config":{},
                        "context":["A REAL LINE -> Mot dong that"]})
assert r.context == ["A REAL LINE -> Mot dong that"], r.context
print("1. TranslateRequest.context parse OK:", r.context)

r2 = TranslateRequest(**{"image":"data:image/png;base64,AA==","config":{}})
assert r2.context is None
print("2. thieu context -> None, OK")

r.config._mot_context = list(r.context)
back = pickle.loads(pickle.dumps(r.config))
got = getattr(back, "_mot_context", None)
assert got == ["A REAL LINE -> Mot dong that"], got
print("3. underscore-attr song sot qua pickle OK:", got)
PY
```
Expected: đủ 3 dòng OK, không AssertionError.

**Nếu bước 3 thất bại thì DỪNG LẠI và báo cáo** — cả thiết kế dựa vào việc thuộc tính này đi được sang executor. Đừng đi tiếp rồi vá tạm.

- [ ] **Step 7: Commit**

```bash
git add patches/request_extraction.py patches/main.py Dockerfile
git commit -m "Accept a per-request dialogue context field on the translate endpoint"
```

---

### Task 4: Executor dùng ngữ cảnh

**Files:**
- Modify: `patches/chatgpt.py` (biến module + `_request_translation`)
- Modify: `patches/share.py` (hàm `run_method`)

**Interfaces:**
- Consumes: `config._mot_context` từ Task 3.
- Produces: một system message thứ hai trong request gửi OpenAI. Không có API mới.

- [ ] **Step 1: Thêm biến module trong chatgpt.py**

Trong `patches/chatgpt.py`, ngay SAU dòng `from .keys import OPENAI_API_KEY, OPENAI_HTTP_PROXY, OPENAI_API_BASE, OPENAI_MODEL, OPENAI_GLOSSARY_PATH`, chèn:

```python

# Ngu canh thoai cua RIENG luot dich dang chay. share.py dat truoc khi goi va
# xoa sau khi xong, LUON nam trong khoa doc quyen cua executor (check_lock() tra
# HTTP 429 neu dang ban), nen khong the co hai luot ghi de nhau.
# Bien MODULE chu khong phai thuoc tinh instance: translator duoc dung lai giua
# cac luot, de sot lai ngu canh trang truoc thi luot sau se lay nham.
REQUEST_CONTEXT = []
```

- [ ] **Step 2: Dùng nó trong `_request_translation`**

Trong `patches/chatgpt.py`, đổi:

```python
        # 如果有上文，添加到系统消息中 / If there is a previous context, add it to the system message        
        if self.prev_context:
            messages.append({'role': 'system', 'content': self.prev_context})            
```

thành:

```python
        # 如果有上文，添加到系统消息中 / If there is a previous context, add it to the system message        
        if self.prev_context:
            messages.append({'role': 'system', 'content': self.prev_context})            
        elif REQUEST_CONTEXT:
            # Cua so thoai client gui kem (chi nguon tieng Anh). Cau chu nay da
            # duoc do thuc nghiem 2026-08-26 - doi chu se lam so do do duoc
            # khong con ap dung, xem spec truoc khi sua.
            messages.append({'role': 'system', 'content':
                "Previously translated lines from this same series, in reading order. "
                "Keep the SAME Vietnamese address pair and register for the same characters:\n"
                + "\n".join(REQUEST_CONTEXT)})
            self.logger.info(f"Dialogue context: {len(REQUEST_CONTEXT)} lines from client.")
```

- [ ] **Step 3: Đặt và dọn biến trong share.py**

Trong `patches/share.py`, đổi phần đầu `run_method`:

```python
    async def run_method(self, method, **attributes):
        try:
            if asyncio.iscoroutinefunction(method):
                result = await method(**attributes)
            else:
                result = method(**attributes)
```

thành:

```python
    async def run_method(self, method, **attributes):
        try:
            # Ngu canh thoai client gui kem, chi song trong dung luot nay.
            # An toan vi check_lock() da gianh khoa doc quyen truoc khi toi day
            # (luot thu hai bi tra HTTP 429), nen khong the co hai luot chen nhau.
            from manga_translator.translators import chatgpt as _mot_chatgpt
            _mot_chatgpt.REQUEST_CONTEXT = list(
                getattr(attributes.get("config", None), "_mot_context", None) or [])

            if asyncio.iscoroutinefunction(method):
                result = await method(**attributes)
            else:
                result = method(**attributes)
```

Và trong khối `finally` của cùng hàm, đổi:

```python
        finally:
            self.lock.release()
```

thành:

```python
        finally:
            # Xoa NGAY: de sot lai thi luot sau (co the la truyen khac, tab khac)
            # se lay nham ngu canh - dung tai hoa AM THAM ma spec canh bao.
            try:
                from manga_translator.translators import chatgpt as _mot_chatgpt
                _mot_chatgpt.REQUEST_CONTEXT = []
            except Exception:
                pass
            self.lock.release()
```

- [ ] **Step 4: Build lại image**

```bash
docker build -t manga-translator-patched:local .
```
Expected: build thành công.

- [ ] **Step 5: Chứng minh ngữ cảnh thật sự tới được OpenAI**

```bash
docker run --rm -i -e OPENAI_API_KEY=sk-test --entrypoint python manga-translator-patched:local - <<'PY'
import sys, asyncio, logging
sys.path.insert(0,'/app'); logging.disable(logging.CRITICAL)
from manga_translator.translators import chatgpt as cg

class FakeCompletions:
    def __init__(self): self.seen = None
    async def create(self, **kw):
        self.seen = kw["messages"]
        class M: content = "<|1|>xin chao"
        class C: message = M()
        class U: prompt_tokens = 1; completion_tokens = 1
        class R: choices = [C()]; usage = U()
        return R()

def make():
    t = cg.OpenAITranslator()
    fc = FakeCompletions()
    class Chat: completions = fc
    class Client: chat = Chat()
    t.client = Client()
    return t, fc

cg.REQUEST_CONTEXT = ["HELLO THERE FRIEND -> Chao cau"]
t, fc = make()
asyncio.new_event_loop().run_until_complete(t._request_translation("VIN", "<|1|>Hello"))
joined = "\n".join(m["content"] for m in fc.seen if m["role"] == "system")
assert "HELLO THERE FRIEND -> Chao cau" in joined, fc.seen
print("1. co ngu canh -> da chen vao system message")

cg.REQUEST_CONTEXT = []
t2, fc2 = make()
asyncio.new_event_loop().run_until_complete(t2._request_translation("VIN", "<|1|>Hello"))
joined2 = "\n".join(m["content"] for m in fc2.seen if m["role"] == "system")
assert "Previously translated lines" not in joined2
print("2. khong ngu canh -> khong chen gi")
print("KET LUAN: duong truyen client -> OpenAI thong suot.")
PY
```
Expected: 2 dòng OK và `KET LUAN: duong truyen client -> OpenAI thong suot.`

- [ ] **Step 6: Chứng minh biến được dọn giữa hai lượt**

```bash
docker run --rm -i --entrypoint python manga-translator-patched:local - <<'PY'
import sys, inspect
sys.path.insert(0,'/app')
from manga_translator.mode import share
src = inspect.getsource(share.MangaShare.run_method)
assert "REQUEST_CONTEXT = list(" in src, "chua dat ngu canh"
assert "REQUEST_CONTEXT = []" in src, "chua don ngu canh"
assert src.index("REQUEST_CONTEXT = list(") < src.index("finally:"), "phai dat TRUOC finally"
print("run_method: dat truoc khi chay va don trong finally - OK")
PY
```
Expected: `run_method: dat truoc khi chay va don trong finally - OK`

- [ ] **Step 7: Chứng minh executor không thể xử lý hai lượt chồng nhau**

Đây là điều kiện an toàn của cả thiết kế: biến module chỉ an toàn nếu executor
độc quyền một lượt tại một thời điểm.

```bash
docker run --rm -i --entrypoint python manga-translator-patched:local - <<'PY'
import sys, inspect
sys.path.insert(0,'/app')
from manga_translator.mode import share
src = inspect.getsource(share.MangaShare.check_lock)
assert "acquire(blocking=False)" in src, src
assert "429" in src, src
print("check_lock: gianh khoa khong-chan, tra 429 neu dang ban - OK")
listen = inspect.getsource(share.MangaShare.listen)
assert "check_lock" in listen, "route khong goi check_lock"
print("route co goi check_lock truoc khi chay - OK")
print("KET LUAN: khong the co hai luot dich chen nhau tren executor.")
PY
```
Expected: 3 dòng OK.

**Nếu bước này thất bại thì DỪNG LẠI** — không được dùng biến module nữa, phải
đổi sang truyền ngữ cảnh xuống tận translator theo từng lượt.

- [ ] **Step 8: Commit**

```bash
git add patches/chatgpt.py patches/share.py
git commit -m "Feed the request dialogue context into the GPT system prompt"
```

---

### Task 5: Đo hiệu quả thật và cập nhật tài liệu

**Files:**
- Modify: `docs.md` (mục 5.5 và bảng mục 8)
- Modify: `README.md` (mục "Endpoint mở rộng riêng của bản patch")

**Interfaces:**
- Consumes: Task 1–4.
- Produces: không có API mới.

- [ ] **Step 1: Chạy toàn bộ test**

```bash
node --test tests/
python -m pytest tests/ -q
```
Expected: 49 test JS PASS, 15 test pytest PASS.

Trong PowerShell:
```powershell
Invoke-Pester -Path tests -Output Minimal
```
Expected: 97 PASS, 0 Failed.

- [ ] **Step 2: Khởi động lại backend từ image mới**

```powershell
docker stop manga_translator
./run-backend.ps1
```

Lưu ý: **phải stop rồi start lại**, `docker restart` sẽ chạy lại đúng image cũ.

- [ ] **Step 3: Xác nhận ngữ cảnh được dùng khi chạy thật**

Dịch một chương **tiếng Anh** trong trình duyệt (nhớ Reload extension trước), rồi:

```bash
docker logs manga_translator 2>&1 | grep -c "Dialogue context:"
```
Expected: lớn hơn 0.

Điều kiện chấp nhận: có dòng `Dialogue context: N lines from client.`, và khi đọc bản dịch thì cùng một nhân vật giữ nguyên một đại từ qua nhiều trang.

- [ ] **Step 4: Xác nhận truyện CJK KHÔNG bị ảnh hưởng**

Dịch một trang truyện Nhật hoặc Hàn, rồi:

```bash
docker logs manga_translator --since 5m 2>&1 | grep -c "Dialogue context:"
```
Expected: `0` — nguồn CJK không bao giờ gửi cửa sổ.

- [ ] **Step 5: Cập nhật docs.md**

Thêm vào cuối mục 5.5 (sau đoạn "Gửi byte gốc thay vì luôn nén lại PNG"):

```markdown
**Cửa sổ ngữ cảnh thoại — chỉ nguồn tiếng Anh (2026-08-26).** Mỗi lượt dịch mang theo tối đa 8 câu đã dịch gần nhất của chính tab đó (`extension/content-script/dialogue-context.js`), gửi trong khoá `context` của body request. Lý do: quy tắc "giữ nguyên cặp xưng hô" trong `gpt_config-vi.yaml` là **bất khả thi** khi mỗi trang là một lời gọi API không có trí nhớ. Đo được (3 lần chạy mỗi điều kiện, trên chuỗi trang thật có đủ bìa/credits/SFX): không ngữ cảnh → 5.3 lần đổi đại từ; cửa sổ không lọc → 2.0 lần nhưng chốt vào đại từ khác nhau giữa các lần chạy; cửa sổ có lọc → 1.0 lần và ra y hệt cả 3 lần. Chi phí +12% token prompt.

Ngữ cảnh giữ ở **client, theo từng tab** — không phải backend. Thí nghiệm tiêm ngữ cảnh từ truyện khác cho thấy đó là tai hoạ **âm thầm**: mọi thước đo nhất quán vẫn đẹp trong khi cả cảnh bị dịch sai register (tiệm thuốc hiện đại thành giọng cung đình `ta-ngươi`). Người dùng chạy tới 10 tab đồng thời nên state dùng chung ở backend là đúng kịch bản đó.

Chỉ tiếng Anh, vì tiếng Anh chỉ có một chữ "you" nên model buộc phải đoán; Nhật/Hàn mã hoá sẵn mức lịch sự trong câu gốc nên số đo trên không suy ra được. Xem spec `2026-08-26-english-pronoun-context-window-design.md`.
```

Và thêm dòng vào bảng mục 8:

```markdown
| Cửa sổ ngữ cảnh thoại (chỉ tiếng Anh) | 2026-08-26 | ✅ Đo 3 lần/điều kiện trên chuỗi thật + verify trình duyệt |
```

- [ ] **Step 6: Cập nhật README.md**

Trong mục "Endpoint mở rộng riêng của bản patch", thêm sau đoạn `/fetch-image`:

```markdown
### Trường `context` trong body của `/translate/json/stream`

Client gửi kèm tối đa 8 câu đã dịch gần nhất, dạng `["src -> dst", ...]`, theo thứ tự đọc. Backend **không lưu lại gì** — giá trị chỉ sống trong đúng lượt dịch đó.

Đường đi: `TranslateRequest.context` (`patches/request_extraction.py`) → `config._mot_context` (`patches/main.py`, cùng mẫu underscore-attr với `_response_format`) → `chatgpt.REQUEST_CONTEXT` (`patches/share.py`, đặt trong khoá độc quyền rồi xoá ở `finally`) → system message thứ hai (`patches/chatgpt.py`).

Phải khai báo `context` ở `TranslateRequest`: pydantic v2 mặc định `extra='ignore'`, field không khai báo sẽ bị bỏ **âm thầm** chứ không báo lỗi.
```

- [ ] **Step 7: Commit**

```bash
git add docs.md README.md
git commit -m "Document the English-only dialogue context window"
```
