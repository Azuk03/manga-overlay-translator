# Split-Phase Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overlap each page's GPT translation (3-5 s of pure network wait, GPU idle) with the next page's detect/OCR/inpaint, taking eager-mode throughput from `A + B` to `max(A, B)`.

**Architecture:** Split one backend call per page into a GPU phase and a network phase. Phase A is the *existing* `/translate/json/stream` with `translator: 'none'` and the real inpainter — no new backend code. Phase B is a new endpoint that translates strings only, runs in the server process, and never takes the executor lock because it never touches the GPU. The extension runs an A-worker and a B-worker over a bounded hand-off buffer; B stays strictly sequential because the dialogue window makes page N's translation an input to page N+1's prompt.

**Tech Stack:** FastAPI + Pydantic (`patches/main.py`), vanilla JS content scripts + MV3 service worker, Node's built-in test runner, Pester, Docker.

**Spec:** `docs/superpowers/specs/2026-09-05-pipeline-split-and-detection-findings-design.md`

## Global Constraints

- `DETECTION_SIZE` stays **2400**. Multi-scale was measured and rejected (+1.4 pts for +83 % detect time).
- `CONCURRENCY` stays **1**. VRAM measured at 3800/4096 MiB — a second executor does not fit.
- Phase B **must not** touch GPU state or the executor lock. It calls the translator and nothing else.
- Phase B **must** stay sequential in reading order. Making it concurrent breaks pronoun consistency silently — it produces no error.
- Cache keying is **unchanged** (image hash + target lang + engine). No `CACHE_VERSION` bump — that would discard ~270 MB of still-good translations.
- Node is v14 by default on this machine; `node --test` needs v18+. Use `"$APPDATA/nvm/v22.18.0/node.exe"` and pass files explicitly: `node --test tests/*.test.js` (`node --test tests/` resolves `tests` as a module and fails).
- Any `.ps1` containing accented characters must keep its UTF-8 BOM.
- Backend changes require `docker build -t manga-translator-patched:local .` and a container restart. `.dockerignore` keeps the context ~3.7 MB.
- After changing `patches/`, update `%LOCALAPPDATA%\MangaTranslator\patches\` too, and rewrite `.docker-image-hash` with `Get-SourceHash`, or the next `setup.ps1` rebuilds the 16 GB image.

---

### Task 1: Phase B endpoint — translate strings without the executor

**Files:**
- Modify: `patches/main.py` (add request model + endpoint near `/fetch-image`, around line 419)
- Test: `tests/test_translate_texts.py` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `POST /translate/texts`
  - request `{"texts": [str], "translator": str = "chatgpt", "target_lang": str = "VIN", "source_lang": str = "auto", "gpt_config": str | null, "context": [str] | null}`
  - response `{"translations": [str]}` — same length and order as `texts`.

**Verified API notes (do not substitute):**
- `get_translator(Translator("chatgpt"))` returns `OpenAITranslator`. It has **no** `set_gpt_config`.
- The real hook is `translator.parse_args(cfg)`, which does `self.config = args.chatgpt_config` (`patches/chatgpt.py:96-98`). `cfg` is a `TranslatorConfig`; its `chatgpt_config` property lazily `OmegaConf.load`s the YAML path.
- `CommonTranslator.translate(from_lang, to_lang, queries, use_mtpe=False) -> List[str]` is a coroutine.
- `manga_translator.translators.chatgpt.REQUEST_CONTEXT` is a module-level list read while building the prompt.

- [ ] **Step 1: Write the failing test**

Create `tests/test_translate_texts.py`:

```python
# tests/test_translate_texts.py
#
# Chay (can container manga_translator DANG CHAY):
#   docker exec -i manga_translator python - < tests/test_translate_texts.py
#
# Pha B: dich CHUOI, khong dung GPU, KHONG giu khoa executor. Diem quan trong
# nhat cua test nay khong phai "dich co dung khong" (GPT khong tat dinh) ma la
# "goi pha B co lam ket executor khong" - vi ca thiet ke dua tren viec no khong
# cham vao khoa do.

import json
import sys
import urllib.error
import urllib.request

SERVER = "http://127.0.0.1:5003"
EXECUTOR = "http://127.0.0.1:5004"


def post(url, payload, timeout=180):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:300]


def is_locked():
    with urllib.request.urlopen(EXECUTOR + "/is_locked", timeout=5) as r:
        return json.load(r)["locked"]


def test_empty_input_returns_empty_without_calling_gpt():
    status, body = post(SERVER + "/translate/texts", {"texts": []})
    assert status == 200, (status, body)
    assert body["translations"] == [], body


def test_translates_and_preserves_order_and_length():
    texts = ["HELLO", "GOOD MORNING", "THANK YOU"]
    status, body = post(SERVER + "/translate/texts",
                        {"texts": texts, "target_lang": "VIN",
                         "gpt_config": "/app/gpt_config-vi.yaml"})
    assert status == 200, (status, body)
    out = body["translations"]
    assert len(out) == len(texts), out
    assert all(isinstance(s, str) for s in out), out


def test_does_not_take_the_executor_lock():
    """Ca thiet ke chong len viec nay: pha B chay song song voi pha A duoc."""
    assert not is_locked(), "executor da ket TRUOC khi test chay"
    post(SERVER + "/translate/texts",
         {"texts": ["HELLO"], "target_lang": "VIN",
          "gpt_config": "/app/gpt_config-vi.yaml"})
    assert not is_locked(), "pha B da giu khoa executor - pha zA/B se khong chong lan duoc"


failed = 0
for test in (test_empty_input_returns_empty_without_calling_gpt,
             test_translates_and_preserves_order_and_length,
             test_does_not_take_the_executor_lock):
    try:
        test()
    except Exception as e:
        print("FAIL  " + test.__name__ + ": " + type(e).__name__ + ": " + str(e))
        failed += 1
        continue
    print("PASS  " + test.__name__)

if failed:
    sys.exit(1)
print("TAT CA TEST PASS")
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker exec -i manga_translator python - < tests/test_translate_texts.py
```

Expected: all three FAIL with HTTP 404 — `/translate/texts` does not exist yet.

- [ ] **Step 3: Add the endpoint**

In `patches/main.py`, directly above the `class FetchImageRequest(BaseModel):` block (~line 419), insert:

```python
class TranslateTextsRequest(BaseModel):
    """Pha B: dich CHUOI, khong co anh.

    Diem cot loi: endpoint nay chay trong TIEN TRINH SERVER va KHONG di qua
    executor, nen khong giu khoa GPU. Nho vay pha A cua trang sau chay chong
    len pha B cua trang truoc - GPU von nam khong 3-5s moi trang trong luc doi
    GPT (do 2026-09-05). Vi cung ly do do, endpoint nay TUYET DOI khong duoc
    dung toi GPU hay state cua MangaTranslator.
    """
    texts: list[str]
    translator: str = "chatgpt"
    target_lang: str = "VIN"
    source_lang: str = "auto"
    gpt_config: str | None = None
    context: list[str] | None = None


@app.post("/translate/texts", tags=["internal-api"])
async def translate_texts(data: TranslateTextsRequest):
    if not data.texts:
        return {"translations": []}

    from manga_translator.config import Translator as TranslatorEnum, TranslatorConfig
    from manga_translator.translators import get_translator
    from manga_translator.translators import chatgpt as _mot_chatgpt

    key = TranslatorEnum(data.translator)
    tr = get_translator(key)
    # parse_args() moi la duong ap gpt_config that su: no gan
    # self.config = args.chatgpt_config (patches/chatgpt.py:96-98). KHONG co
    # set_gpt_config() - da kiem chung tren image that.
    tr.parse_args(TranslatorConfig(translator=key, target_lang=data.target_lang,
                                   gpt_config=data.gpt_config))

    # Cung co che ma share.py dung cho duong cu. An toan vi pha B tuan tu theo
    # dung thu tu doc (mot writer duy nhat) - xem Global Constraints.
    _mot_chatgpt.REQUEST_CONTEXT = list(data.context or [])
    try:
        out = await tr.translate(data.source_lang, data.target_lang, list(data.texts))
    finally:
        _mot_chatgpt.REQUEST_CONTEXT = []

    return {"translations": [("" if s is None else str(s)) for s in out]}
```

- [ ] **Step 4: Rebuild and restart, then run the test**

```bash
docker build -t manga-translator-patched:local .
```

Then restart the backend (stop the container, re-run `start.ps1` or the shortcut), wait for `GET /` to return 200, and run:

```bash
docker exec -i manga_translator python - < tests/test_translate_texts.py
```

Expected: `TAT CA TEST PASS`.

- [ ] **Step 5: Verify the old path still works**

```bash
docker cp patches/share.py manga_translator:/tmp/share.py
docker exec -i manga_translator python - < tests/test_share_lock.py
```

Expected: `TAT CA TEST PASS` — the AVIF and lock-leak guarantees are untouched.

- [ ] **Step 6: Commit**

```bash
git add patches/main.py tests/test_translate_texts.py
git commit -m "Add a translate-only endpoint that never takes the executor lock"
```

---

### Task 2: Extension — build Phase A and Phase B request bodies

`ApiAdapter.translateImage` currently builds one config inside the `content.js` IIFE, where it cannot be tested. Extract request-body construction into its own content script, following `image-candidate.js` / `image-format.js`.

**Files:**
- Create: `extension/content-script/phase-payload.js`
- Modify: `extension/manifest.json` (register the new script before `content.js`)
- Test: `tests/phase-payload.test.js` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `motPhaseAConfig(cfg)` → the Phase A config object. `cfg` is `{DETECTION_SIZE, INPAINTER, INPAINTING_SIZE, GPT_CONFIG_PATH}`.
  - `motPhaseBBody({texts, targetLang, engine, gptConfigPath, context})` → the `/translate/texts` request body.

- [ ] **Step 1: Write the failing test**

Create `tests/phase-payload.test.js`:

```javascript
// Test cho phan dung request cua pha A / pha B.
//
// Chay: node --test tests/*.test.js   (node >= 18; xem Global Constraints)
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const SRC = path.join(__dirname, '..', 'extension', 'content-script', 'phase-payload.js');
const { motPhaseAConfig, motPhaseBBody } = new Function(
  `${fs.readFileSync(SRC, 'utf8')}\nreturn { motPhaseAConfig, motPhaseBBody };`
)();

const CFG = {
  DETECTION_SIZE: 2400,
  INPAINTER: 'lama_mpe',
  INPAINTING_SIZE: 1024,
  GPT_CONFIG_PATH: '/app/gpt_config-vi.yaml',
};

test('pha A dung translator none - khong duoc goi GPT', () => {
  assert.strictEqual(motPhaseAConfig(CFG).translator.translator, 'none');
});

test('pha A BAT inpaint that - khac han probe detect-only', () => {
  const c = motPhaseAConfig(CFG);
  assert.strictEqual(c.inpainter.inpainter, 'lama_mpe');
  assert.strictEqual(c.inpainter.inpainting_size, 1024);
});

test('pha A giu detection_size 2400', () => {
  assert.strictEqual(motPhaseAConfig(CFG).detector.detection_size, 2400);
});

test('pha A khong tu render - overlay do client ve', () => {
  assert.strictEqual(motPhaseAConfig(CFG).render.renderer, 'none');
});

test('pha B gui dung cac chuoi, dung thu tu', () => {
  const b = motPhaseBBody({ texts: ['A', 'B'], targetLang: 'VIN', engine: 'chatgpt' });
  assert.deepStrictEqual(b.texts, ['A', 'B']);
});

test('pha B gui gpt_config khi engine la chatgpt', () => {
  const b = motPhaseBBody({ texts: ['A'], targetLang: 'VIN', engine: 'chatgpt', gptConfigPath: '/app/gpt_config-vi.yaml' });
  assert.strictEqual(b.gpt_config, '/app/gpt_config-vi.yaml');
});

test('pha B KHONG gui gpt_config cho engine khac chatgpt', () => {
  const b = motPhaseBBody({ texts: ['A'], targetLang: 'VIN', engine: 'deepl', gptConfigPath: '/app/gpt_config-vi.yaml' });
  assert.strictEqual(b.gpt_config, undefined);
});

test('pha B bo qua context rong thay vi gui mang rong', () => {
  const b = motPhaseBBody({ texts: ['A'], targetLang: 'VIN', engine: 'chatgpt', context: [] });
  assert.strictEqual(b.context, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
"$APPDATA/nvm/v22.18.0/node.exe" --test tests/phase-payload.test.js
```

Expected: FAIL — `phase-payload.js` does not exist (`ENOENT`).

- [ ] **Step 3: Create the module**

Create `extension/content-script/phase-payload.js`:

```javascript
// Dung request cho hai pha cua mot trang.
//
// Pha A (GPU): detect + OCR + mask + inpaint, translator 'none' - KHONG goi
// GPT. Day chinh la endpoint cu, chi doi translator; khong can backend moi.
// Pha B (mang): chi dich chuoi, qua /translate/texts - khong cham GPU.
//
// Tach khoi content.js (nam trong IIFE, khong test duoc) theo dung khuon cua
// image-candidate.js / image-format.js.

function motPhaseAConfig(cfg) {
  return {
    detector: { detection_size: cfg.DETECTION_SIZE },
    // 'none' van tra ve toa do + text OCR. Khong ton GPT.
    translator: { translator: 'none', target_lang: 'VIN' },
    // PHAI ghi ro inpainter: bo trong thi backend dung mac dinh lama_large,
    // ngon VRAM hon lama_mpe (~3,7GB vs ~3,4GB) tren card 4GB.
    inpainter: { inpainter: cfg.INPAINTER, inpainting_size: cfg.INPAINTING_SIZE },
    render: { renderer: 'none' },
  };
}

function motPhaseBBody({ texts, targetLang, engine, gptConfigPath, context }) {
  const body = {
    texts: Array.from(texts),
    translator: engine,
    target_lang: targetLang,
  };
  if (engine === 'chatgpt' && gptConfigPath) body.gpt_config = gptConfigPath;
  if (context && context.length) body.context = Array.from(context);
  return body;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
"$APPDATA/nvm/v22.18.0/node.exe" --test tests/phase-payload.test.js
```

Expected: 8 pass, 0 fail.

- [ ] **Step 5: Register the script**

In `extension/manifest.json`, add `"content-script/phase-payload.js"` to `content_scripts[0].js` immediately before `"content-script/content.js"`.

- [ ] **Step 6: Verify load order and the whole suite**

```bash
"$APPDATA/nvm/v22.18.0/node.exe" -e "const m=require('./extension/manifest.json');const js=m.content_scripts[0].js;const a=js.indexOf('content-script/phase-payload.js'),b=js.indexOf('content-script/content.js');console.log('truoc content.js:', a>=0 && a<b);"
"$APPDATA/nvm/v22.18.0/node.exe" --test tests/*.test.js
```

Expected: `truoc content.js: true`, and the full suite passes (71 tests: 63 existing + 8 new).

- [ ] **Step 7: Commit**

```bash
git add extension/content-script/phase-payload.js extension/manifest.json tests/phase-payload.test.js
git commit -m "Extract phase A and phase B request building so it can be tested"
```

---

### Task 3: Service worker — relay Phase B

**Files:**
- Modify: `extension/background/background.js` (add a message handler beside the existing `TRANSLATE` handler at line ~139)

**Interfaces:**
- Consumes: `motPhaseBBody(...)` output from Task 2 (the content script builds it and sends it as `body`).
- Produces: message `{type: 'TRANSLATE_TEXTS', body: <JSON string>}` → response `{ok: true, translations: [str]}` or `{ok: false, error: str}`.

- [ ] **Step 1: Add the handler**

In `extension/background/background.js`, alongside the existing `TRANSLATE` handler, add:

```javascript
  if (message.type === 'TRANSLATE_TEXTS') {
    (async () => {
      try {
        const res = await fetch(`${await getBackendUrl()}/translate/texts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: message.body,
        });
        if (!res.ok) {
          sendResponse({ ok: false, error: `Backend tra ve HTTP ${res.status}` });
          return;
        }
        const json = await res.json();
        sendResponse({ ok: true, translations: json.translations || [] });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true; // giu cong message mo cho luot tra loi bat dong bo
  }
```

- [ ] **Step 2: Syntax check**

```bash
"$APPDATA/nvm/v22.18.0/node.exe" --check extension/background/background.js
```

Expected: no output (valid).

- [ ] **Step 3: Commit**

```bash
git add extension/background/background.js
git commit -m "Relay phase B translate requests through the service worker"
```

---

### Task 4: Bounded hand-off buffer

Pure logic, so it can be tested without a DOM. The A-worker pushes; the B-worker shifts. Bounded at 2 — Phase A payloads reach several MB per page and must not accumulate.

**Files:**
- Create: `extension/content-script/handoff-buffer.js`
- Modify: `extension/manifest.json`
- Test: `tests/handoff-buffer.test.js` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `motCreateHandoff(limit)` → `{ push(item), take(), size(), isFull(), waitForSpace(), waitForItem(), close() }`.
  - `push(item)` appends; throws if full — callers must await `waitForSpace()` first.
  - `take()` removes and returns the oldest item, or `null` when empty.
  - `waitForSpace()` / `waitForItem()` return promises resolving when the condition holds, or immediately if it already does. Both resolve immediately once `close()` is called.

- [ ] **Step 1: Write the failing test**

Create `tests/handoff-buffer.test.js`:

```javascript
// Bo dem chuyen giao giua A-worker (GPU) va B-worker (mang).
//
// Chan tren la 2: ket qua pha A chua anh nen tung vung, do duoc vai MB moi
// trang - de A chay xa tuy y la om het so do trong bo nho.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const SRC = path.join(__dirname, '..', 'extension', 'content-script', 'handoff-buffer.js');
const { motCreateHandoff } = new Function(
  `${fs.readFileSync(SRC, 'utf8')}\nreturn { motCreateHandoff };`
)();

test('giu dung thu tu doc - FIFO', () => {
  const h = motCreateHandoff(3);
  h.push('trang1'); h.push('trang2');
  assert.strictEqual(h.take(), 'trang1');
  assert.strictEqual(h.take(), 'trang2');
});

test('take() tra null khi rong', () => {
  assert.strictEqual(motCreateHandoff(2).take(), null);
});

test('bao day khi cham chan tren', () => {
  const h = motCreateHandoff(2);
  h.push('a'); h.push('b');
  assert.strictEqual(h.isFull(), true);
});

test('push khi day thi nem loi - buoc goi phai cho truoc', () => {
  const h = motCreateHandoff(1);
  h.push('a');
  assert.throws(() => h.push('b'));
});

test('waitForSpace giai phong khi co cho trong', async () => {
  const h = motCreateHandoff(1);
  h.push('a');
  let thongQua = false;
  const cho = h.waitForSpace().then(() => { thongQua = true; });
  assert.strictEqual(thongQua, false);
  h.take();
  await cho;
  assert.strictEqual(thongQua, true);
});

test('waitForItem giai phong khi co hang', async () => {
  const h = motCreateHandoff(2);
  let thongQua = false;
  const cho = h.waitForItem().then(() => { thongQua = true; });
  assert.strictEqual(thongQua, false);
  h.push('a');
  await cho;
  assert.strictEqual(thongQua, true);
});

test('close() go moi ben dang cho - khong de worker treo', async () => {
  const h = motCreateHandoff(1);
  h.push('a');
  const cho = Promise.all([h.waitForSpace(), h.waitForItem()]);
  h.close();
  await cho;
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
"$APPDATA/nvm/v22.18.0/node.exe" --test tests/handoff-buffer.test.js
```

Expected: FAIL — `handoff-buffer.js` does not exist.

- [ ] **Step 3: Create the module**

Create `extension/content-script/handoff-buffer.js`:

```javascript
// Bo dem chuyen giao giua A-worker (GPU) va B-worker (mang).
//
// Chan tren nho (2) la CO Y: ket qua pha A mang theo anh nen cua tung vung,
// do duoc vai MB moi trang. Khong chan thi A chay xa tuy y va om het trong
// bo nho. Hai la du de B luon co viec trong luc A lam trang ke tiep.

function motCreateHandoff(limit) {
  const items = [];
  let closed = false;
  let spaceWaiters = [];
  let itemWaiters = [];

  const release = (list) => { const w = list.splice(0); w.forEach((fn) => fn()); };

  return {
    size: () => items.length,
    isFull: () => items.length >= limit,
    push(item) {
      if (items.length >= limit) throw new Error('handoff day - phai await waitForSpace() truoc');
      items.push(item);
      release(itemWaiters);
    },
    take() {
      if (!items.length) return null;
      const item = items.shift();
      release(spaceWaiters);
      return item;
    },
    waitForSpace() {
      if (closed || items.length < limit) return Promise.resolve();
      return new Promise((res) => spaceWaiters.push(res));
    },
    waitForItem() {
      if (closed || items.length > 0) return Promise.resolve();
      return new Promise((res) => itemWaiters.push(res));
    },
    // Go moi ben dang cho. Khong co buoc nay thi khi dung giua chung (doi
    // trang, huy hang doi) worker se treo mai o await.
    close() {
      closed = true;
      release(spaceWaiters);
      release(itemWaiters);
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
"$APPDATA/nvm/v22.18.0/node.exe" --test tests/handoff-buffer.test.js
```

Expected: 7 pass, 0 fail.

- [ ] **Step 5: Register and run the whole suite**

Add `"content-script/handoff-buffer.js"` to `extension/manifest.json` before `"content-script/content.js"`, then:

```bash
"$APPDATA/nvm/v22.18.0/node.exe" --test tests/*.test.js
```

Expected: 78 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add extension/content-script/handoff-buffer.js extension/manifest.json tests/handoff-buffer.test.js
git commit -m "Add the bounded buffer that hands pages from the GPU phase to the network phase"
```

---

### Task 5: Wire the two phases into the queue

This is the behavioural change. Everything before it was additive and inert.

**Files:**
- Modify: `extension/content-script/content.js` — `ApiAdapter.translateImage` (~line 454-520), `translateAndRenderImage` (~line 1490-1540), `Queue` (~line 1557-1655)

**Interfaces:**
- Consumes: `motPhaseAConfig`, `motPhaseBBody` (Task 2); `TRANSLATE_TEXTS` message (Task 3); `motCreateHandoff` (Task 4).
- Produces: no new exported names — internal rewiring only.

**Ordering rules that must survive (each has cost a real bug before):**
1. Phase B runs one page at a time, in reading order. Page N's `dst` feeds page N+1's dialogue window (`content.js:1533` → `content.js:483`).
2. Rendering and `registerRenderedRegion` stay inside the B worker. Cross-image dedup assumes the earlier image registers before the later one renders (`content.js:1516`, `content.js:1525`). Phase A renders nothing, so it may run ahead safely.
3. The Y-sort in `_drain()` stays. It is a correctness condition for dedup, not a preference.

- [ ] **Step 1: Add a Phase A / Phase B pair to ApiAdapter**

Keep the existing `translateImage` untouched as the fallback path. Add beside it:

```javascript
    // Pha A: GPU. Tra ve regions co toa do + text nguon + anh nen, CHUA dich.
    async detectAndInpaint(blob) {
      const config = motPhaseAConfig(CFG);
      const payload = { image: await this.blobToDataURL(blob), config };
      let res = await sendMessageAsync({ type: 'TRANSLATE', body: JSON.stringify(payload) });
      if ((!res || !res.ok) && passthroughBlobs.has(blob)) {
        // Cung buoc lui nhu duong cu: byte goc bi tu choi -> nen PNG, thu 1 lan.
        log('Backend tu choi byte goc o pha A, thu lai bang duong nen PNG:', (res && res.error) || '');
        const png = await reencodeToPng(blob);
        res = await sendMessageAsync({
          type: 'TRANSLATE',
          body: JSON.stringify({ image: await this.blobToDataURL(png), config }),
        });
      }
      if (!res || !res.ok) throw new Error((res && res.error) || 'Pha A that bai');
      return res.regions || [];
    },

    // Pha B: mang. Khong cham GPU, khong giu khoa executor.
    async translateTexts(texts, dialogueWindow) {
      if (!texts.length) return [];
      const body = motPhaseBBody({
        texts,
        targetLang: await getTargetLang(),
        engine: await getTranslatorEngine(),
        gptConfigPath: CFG.GPT_CONFIG_PATH,
        context: motContextPayload(dialogueWindow),
      });
      const res = await sendMessageAsync({ type: 'TRANSLATE_TEXTS', body: JSON.stringify(body) });
      if (!res || !res.ok) throw new Error((res && res.error) || 'Pha B that bai');
      return res.translations || [];
    },
```

- [ ] **Step 2: Split `translateAndRenderImage` into an A part and a B part**

Split the existing function so that everything up to and including the backend call becomes `runPhaseA(img)` returning `{img, regions, hash, url, cached}`, and everything from merging translations onward becomes `runPhaseB(job)`.

`runPhaseB(job)` must, in this order: call `ApiAdapter.translateTexts` for the regions' `src` values (skipping the call entirely when `job.cached` is set), write each `dst` back onto its region, render the overlay through the existing renderer, call `registerRenderedRegion` for each drawn region, push each `(src, dst)` pair into `dialogueWindow` via `motPushContext`, and write the cache entry with the existing key.

The cache lookup stays in `runPhaseA`: on a hit, set `cached: true` and carry the cached regions through so `runPhaseB` renders without any network call. This preserves the measured 252 ms cache-hit path.

- [ ] **Step 3: Replace the single worker in `_drain()` with two**

Keep `_drain()`'s Y-sort and its `startPrefetchBlob` call. Replace the `await translateAndRenderImage(img)` body with an A-worker that awaits `handoff.waitForSpace()`, runs `runPhaseA`, and pushes the job. Add a single B-worker loop, started once, that awaits `handoff.waitForItem()`, takes a job, and awaits `runPhaseB(job)`.

The completion toast condition moves to the B worker: the chapter is finished when the pending list is empty, no A job is active, and the handoff is empty.

- [ ] **Step 4: Syntax check and full suite**

```bash
"$APPDATA/nvm/v22.18.0/node.exe" --check extension/content-script/content.js
"$APPDATA/nvm/v22.18.0/node.exe" --test tests/*.test.js
```

Expected: valid, 78 pass.

- [ ] **Step 5: Verify on a real site by hand**

Reload the extension at `chrome://extensions`, open a MangaDex chapter, press Alt+D, and confirm in the console that a page's Phase A log appears **while** the previous page is still in Phase B — that overlap is the entire point. Confirm cache hits still render without a network call.

- [ ] **Step 6: Commit**

```bash
git add extension/content-script/content.js
git commit -m "Overlap the next page's GPU work with the current page's translation"
```

---

### Task 6: Measure throughput and prove output equivalence

**Files:**
- Create: `tools/measure-pipeline.js`

**Interfaces:**
- Consumes: the running backend and the local corpus.
- Produces: a printed before/after table. No code depends on this.

- [ ] **Step 1: Write the measurement tool**

Create `tools/measure-pipeline.js`, modelled on the sweep harness used during the spec work: for each corpus image, call Phase A and record wall time, region count, and the sorted list of region coordinates plus source strings.

- [ ] **Step 2: Prove Phase A matches the old path**

Run the same corpus pages through the old single-call path (`translator: 'chatgpt'`) and through Phase A, and assert the same region count and the same coordinates. Source text must match; **translated text is excluded from equivalence** because GPT is nondeterministic — the same exclusion the 2026-08-09 relay optimisation plan used.

- [ ] **Step 3: Measure end-to-end throughput**

Time a full chapter with eager mode before and after, on the same pages, and record seconds per page in both. Expected: roughly `max(A, B)` instead of `A + B` — about 2x.

- [ ] **Step 4: Record the numbers in docs.md**

Update the open-problem entry "Eager mode dồn cả chương vào 1 hàng đợi tuần tự" with the measured result, and add the split-phase design to the architecture section.

- [ ] **Step 5: Commit**

```bash
git add tools/measure-pipeline.js docs.md
git commit -m "Measure split-phase throughput and record the result"
```

---

## Self-Review

**Spec coverage.** Phase B endpoint → Task 1. Phase A needing no backend change → Task 2 (config only). Sequential Phase B → Task 5, ordering rule 1. Bounded buffer of 2 → Task 4. Cache unchanged → Task 5 step 2. Failure handling → Task 5 step 1 (Phase A retry) and the B-worker's error path. Boundary-stitch left alone → not touched by any task, as the spec requires. Testing table → Tasks 1, 2, 4, 6. **Not covered by this plan, by design:** the OCR-damage measurement and site coverage, which the spec sequences as independent workstreams with their own gates; each gets its own plan.

**Placeholders.** Task 5 steps 2 and 3 and Task 6 step 1 describe restructuring rather than showing final code. This is deliberate: they rewire ~150 lines of existing `content.js` whose surrounding code the executor must read anyway, and pasting a stale copy here would be worse than naming the exact functions, line ranges, call order, and invariants — which they do. Every new file and every new API is given in full.

**Type consistency.** `motPhaseAConfig(cfg)` / `motPhaseBBody({...})` (Task 2) are used with those exact names and shapes in Task 5. `motCreateHandoff(limit)` and its methods (Task 4) match the calls in Task 5 step 3. `TRANSLATE_TEXTS` and its `{ok, translations}` response shape (Task 3) match `ApiAdapter.translateTexts` in Task 5. The endpoint's request field names (Task 1) match what `motPhaseBBody` emits (Task 2): `texts`, `translator`, `target_lang`, `gpt_config`, `context`.
