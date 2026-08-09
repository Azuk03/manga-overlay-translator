# Per-Series Character Context (Option C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Fix cross-page pronoun inconsistency by building a per-series character sheet once (via one GPT call) and injecting it into every subsequent translate call through a per-series `gpt_config` file.

**Architecture:** Backend gains two routes in `patches/main.py`: `/build-series-context` (GPT-extract a character sheet from early-page text + write a per-series gpt_config YAML) and `/set-series-context` (re-write that YAML from a client-stored sheet, no GPT). The per-series YAML = base `gpt_config-vi.yaml` with a "CHARACTER CONTEXT" block appended to `chat_system_template`. The client derives a series id, accumulates OCR `src` text over the first few pages, triggers the build, stores the sheet+path in `chrome.storage.local`, and passes `gpt_config = <per-series path>` on later translate calls. No core backend files vendored.

**Tech Stack:** FastAPI (`patches/main.py`), `openai==1.63.0` (AsyncOpenAI), OmegaConf-loaded YAML gpt_config, extension JS (`content.js`, `background.js`, `popup`), `chrome.storage.local`.

## Global Constraints

- Reuse the existing `gpt_config` path mechanism — do NOT vendor `config.py` or `common_gpt.py`.
- The per-series YAML MUST inherit the base template verbatim (keeps `<|n|>` format rules + romanization) and only APPEND a CHARACTER CONTEXT block.
- Backend GPT call uses `openai.AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])` + model `os.environ.get("OPENAI_MODEL","gpt-4o")` (v1 API: `await client.chat.completions.create(...)`).
- Sanitize `series_id` to `[A-Za-z0-9_-]` before using it in a filename (path-traversal guard). Files under `/app/series-ctx/`.
- Feature is opt-out via popup toggle `mot_character_context` (default ON). Toggle off ⇒ behaviour identical to today. Unidentifiable series ⇒ old flow.
- No re-translation of already-cached pages; bump `CFG.CACHE_VERSION` 6 → 7 once for rollout. Do NOT add a context hash to the cache key.
- Failures never block reading: any context error ⇒ fall back to the default `gpt_config` and translate normally.
- Backend changes need `docker build` + `run-backend.ps1` (recreate). Executor (5004) is ready a few seconds after server (5003) returns 200 on `/`.
- Constants: `CTX_MIN_PAGES=3`, `CTX_MIN_CHARS=200`, server dir `/app/series-ctx/`.

---

### Task 1: Backend — build/set series-context endpoints

**Files:** Modify `patches/main.py` (add routes + helpers near the other `@app.post` routes; add `import os`/`re`/`openai` if missing at top — check first).

**Interfaces produced:**
- `POST /build-series-context` body `{series_id:str, text:str, target_lang:str}` → `{sheet:str, gpt_config_path:str|None}`
- `POST /set-series-context` body `{series_id:str, sheet:str}` → `{gpt_config_path:str|None}`

- [ ] **Step 1: Confirm imports present in `patches/main.py`**

Run: `grep -nE "^import |^from |BaseModel" patches/main.py | head -30`
Expected: note whether `os`, `re`, `openai`, `Path`, `BaseModel` are imported (add the missing ones in Step 2). `Path` and `BaseModel` already are; `os` already is; add `re` and `import openai` if absent.

- [ ] **Step 2: Add the helper + models + routes** to `patches/main.py` (place after the `fetch_image` route, before the `if __name__` block):

```python
import re as _re

SERIES_CTX_DIR = (BASE_DIR / "series-ctx").resolve() if False else Path("/app/series-ctx")

_CTX_EXTRACT_SYSTEM = (
    "You build a compact CHARACTER SHEET for a manga/manhwa/manhua/comic to help a "
    "translator pick consistent Vietnamese pronouns/forms of address. Read the "
    "dialogue/narration below (it may be Japanese, Korean, Chinese or English). "
    "Output ONLY a short Vietnamese sheet (<=200 words) listing each identifiable "
    "character: romanized name, gender, age/seniority, role, key relationships, and "
    "the Vietnamese pronouns/terms of address they should use and be addressed by "
    "(e.g. 'nhac phu -> nguoi ke goi la \"cha/ong ay\"; ong ay goi nguoi ke la "
    "\"con\"'). Do NOT invent characters without evidence; write 'chua ro' when "
    "unknown. Do NOT translate the passage; output the sheet only."
)

def _sanitize_series_id(series_id: str) -> str:
    s = _re.sub(r"[^A-Za-z0-9_-]", "_", series_id or "")[:120]
    return s or "unknown"

def _write_series_gpt_config(series_id: str, sheet: str) -> str:
    """Write a per-series gpt_config YAML = base template + CHARACTER CONTEXT block.
    Returns the file path."""
    base_path = Path("/app/gpt_config-vi.yaml")
    from omegaconf import OmegaConf
    base = OmegaConf.load(str(base_path))
    template = str(base.get("chat_system_template", ""))
    block = (
        "\n\nCHARACTER CONTEXT (use to pick consistent Vietnamese pronouns/forms of "
        "address for THIS story; keep each character's address consistent across the "
        "whole work):\n" + sheet.strip() + "\n"
    )
    merged = OmegaConf.create({"chat_system_template": template + block})
    # copy any other keys from base (e.g. chat_sample) unchanged
    for k, v in base.items():
        if k != "chat_system_template":
            merged[k] = v
    SERIES_CTX_DIR.mkdir(parents=True, exist_ok=True)
    out = SERIES_CTX_DIR / (_sanitize_series_id(series_id) + ".yaml")
    OmegaConf.save(merged, str(out))
    return str(out)

class BuildSeriesContextRequest(BaseModel):
    series_id: str
    text: str
    target_lang: str = "VIN"

class SetSeriesContextRequest(BaseModel):
    series_id: str
    sheet: str

@app.post("/build-series-context", tags=["internal-api"])
async def build_series_context(data: BuildSeriesContextRequest):
    text = (data.text or "").strip()
    if len(text) < 50:
        return {"sheet": "", "gpt_config_path": None}
    try:
        client = openai.AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
        model = os.environ.get("OPENAI_MODEL", "gpt-4o")
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _CTX_EXTRACT_SYSTEM},
                {"role": "user", "content": text[:8000]},
            ],
            max_tokens=500,
            temperature=0.2,
        )
        sheet = (resp.choices[0].message.content or "").strip()
    except Exception as e:
        print(f"[series-context] build failed: {e}", flush=True)
        return {"sheet": "", "gpt_config_path": None}
    if not sheet:
        return {"sheet": "", "gpt_config_path": None}
    try:
        path = _write_series_gpt_config(data.series_id, sheet)
    except Exception as e:
        print(f"[series-context] write failed: {e}", flush=True)
        return {"sheet": sheet, "gpt_config_path": None}
    return {"sheet": sheet, "gpt_config_path": path}

@app.post("/set-series-context", tags=["internal-api"])
async def set_series_context(data: SetSeriesContextRequest):
    sheet = (data.sheet or "").strip()
    if not sheet:
        return {"gpt_config_path": None}
    try:
        path = _write_series_gpt_config(data.series_id, sheet)
    except Exception as e:
        print(f"[series-context] write failed: {e}", flush=True)
        return {"gpt_config_path": None}
    return {"gpt_config_path": path}
```

- [ ] **Step 3: Ensure `import openai` and `import os` at top of `patches/main.py`**

If Step 1 showed them missing, add `import os` (already present per earlier read) and `import openai` to the import block. Verify: `grep -nE "^import openai|^import os" patches/main.py`.

- [ ] **Step 4: Compile-check**

Run: `python -c "import ast; ast.parse(open('patches/main.py',encoding='utf-8-sig').read()); print('OK')"`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add patches/main.py
git commit -m "backend: /build-series-context + /set-series-context (per-series gpt_config)"
```

---

### Task 2: Rebuild + backend end-to-end verification (curl)

**Files:** none.

- [ ] **Step 1: Rebuild + recreate**

Run: `docker build -t manga-translator-patched:local . && docker rm -f manga_translator; ` then `run-backend.ps1` (background); poll `/` for 200.

- [ ] **Step 2: Build a context from sample Korean text**

```bash
cd <scratchpad>
curl -s -X POST http://127.0.0.1:5003/build-series-context -H "Content-Type: application/json" \
  -d '{"series_id":"test-kendo","target_lang":"VIN","text":"선배!! / 이 도장을 물려받을 사람은 너야! / 내 자식인데 한심하구나... / 히비키는 벌써 검사의 경지에... / 그가 마침내 떠났다... / 그의 이름은 고다 켄이치, 내 약혼자다."}' | python -c "import sys,json;d=json.load(sys.stdin);print('PATH:',d['gpt_config_path']);print('SHEET:\n'+d['sheet'])"
```
Expected: a non-null `gpt_config_path` under `/app/series-ctx/test-kendo.yaml` and a Vietnamese character sheet mentioning pronouns (e.g. nhạc phụ→cha/ông ấy, con; vị hôn phu→anh).

- [ ] **Step 3: Confirm the per-series YAML is valid + inherits base rules**

```bash
docker exec manga_translator sh -c 'python -c "from omegaconf import OmegaConf; c=OmegaConf.load(\"/app/series-ctx/test-kendo.yaml\"); t=str(c.chat_system_template); print(\"has_marker\", \"<|1|>\" in t); print(\"has_ctx\", \"CHARACTER CONTEXT\" in t); print(\"len\", len(t))"'
```
Expected: `has_marker True`, `has_ctx True`.

- [ ] **Step 4: Translate one page WITH the per-series gpt_config and confirm no format break**

Reuse `body.json` but point gpt_config at the new file: build a variant body and translate; confirm `http=200`, regions parse, no "does not match expected count" in logs.
```bash
python -c "
import json
b=json.load(open('body.json'))
b['config']['translator']['gpt_config']='/app/series-ctx/test-kendo.yaml'
json.dump(b,open('body_ctx.json','w'))
"
# retry until executor ready
for i in $(seq 1 25); do
  curl -s -X POST http://127.0.0.1:5003/translate/json/stream -H "Content-Type: application/json" \
    --data-binary @body_ctx.json -o resp_ctx.bin -w "attempt $i http=%{http_code}\n"
  python -c "
import sys;buf=open('resp_ctx.bin','rb').read();i=0;ok=False;st2=False
while i+5<=len(buf):
 st=buf[i];n=int.from_bytes(buf[i+1:i+5],'big');d=buf[i+5:i+5+n];i+=5+n
 if st==0:ok=True
 if st==2 and b'starting up' in d:st2=True
sys.exit(0 if ok else (2 if st2 else 1))
" && break || { [ $? -eq 2 ] && sleep 3 || break; }
done
python parse_resp.py resp_ctx.bin
docker logs --tail 30 manga_translator 2>&1 | grep -iE "does not match expected count|translated OK" | tail -3
```
Expected: regions parse, "translated OK", no count-mismatch error.

- [ ] **Step 5: Verify `/set-series-context` re-writes without GPT**

```bash
curl -s -X POST http://127.0.0.1:5003/set-series-context -H "Content-Type: application/json" \
  -d '{"series_id":"test-kendo","sheet":"Ken (nam, vi hon phu) -> nguoi ke goi \"anh\"."}' | python -c "import sys,json;print('PATH:',json.load(sys.stdin)['gpt_config_path'])"
```
Expected: non-null path (same file), fast (no GPT latency).

---

### Task 3: Client plumbing — settings, series id, gpt_config passthrough, cache bump

**Files:**
- Modify: `extension/content-script/content.js` — `CFG` (CACHE_VERSION, new consts), `getCharacterContext()`, `getSeriesId()`, `ApiAdapter.translateImage(blob, gptConfigPath)`
- Modify: `extension/popup/popup.html` + `extension/popup/popup.js` — checkbox `mot_character_context`

**Interfaces produced:**
- `getCharacterContext(): Promise<boolean>` (reads `mot_character_context`, default true)
- `getSeriesId(): string|null`
- `ApiAdapter.translateImage(blob, gptConfigPath?)` — when `gptConfigPath` set, uses it instead of `CFG.GPT_CONFIG_PATH`.
- Backend base URL helper for context calls (reuse existing `getBackendUrl()` via background, or a `sendMessageAsync` message type).

- [ ] **Step 1: Bump `CACHE_VERSION` 6 → 7 + add constants** in `content.js` `CFG`:

```javascript
    CACHE_VERSION: 7, // Option C: character-context rollout - buoc dich lai
```
And add near other CFG consts:
```javascript
    CTX_MIN_PAGES: 3,
    CTX_MIN_CHARS: 200,
```

- [ ] **Step 2: Add `getCharacterContext()`** next to `getTargetLang()`/`getTranslatorEngine()` (same live-read pattern):

```javascript
  async function getCharacterContext() {
    try {
      const { mot_character_context } = await chrome.storage.local.get('mot_character_context');
      return mot_character_context !== false; // default ON
    } catch { return true; }
  }
```

- [ ] **Step 3: Add `getSeriesId()`** (near `isHitomiReader()`):

```javascript
  function getSeriesId() {
    try {
      const h = location.hostname.replace(/^www\./, '');
      if (h.includes('hitomi.la')) {
        const m = location.pathname.match(/(\d+)\.html/) || location.href.match(/-(\d+)\.html/);
        if (m) return 'hitomi-' + m[1];
      }
      const seg = location.pathname.split('/').filter(Boolean).slice(0, 2).join('-');
      return (h + (seg ? '-' + seg : '')).slice(0, 120) || null;
    } catch { return null; }
  }
```
(hitomi reader url is `/reader/<id>.html#page` — the `\d+.html` match yields the gallery id.)

- [ ] **Step 4: Thread `gptConfigPath` through `ApiAdapter.translateImage`** — change the signature and the `gpt_config` assignment at [content.js ~356-378]:

```javascript
    async translateImage(blob, gptConfigPath) {
      const dataUrl = await this.blobToDataURL(blob);
      const targetLang = await getTargetLang();
      const engine = await getTranslatorEngine();
      const translatorConfig = { translator: engine, target_lang: targetLang };
      if (targetLang === 'VIN' && engine !== 'deepl') {
        translatorConfig.gpt_config = gptConfigPath || CFG.GPT_CONFIG_PATH;
      }
      // ...unchanged body/stream...
    }
```
And update the tiled path `translateImageTiled(blob, w, h, img, gptConfigPath)` similarly to forward it into its internal `translateImage`/request calls.

- [ ] **Step 5: Add the popup checkbox** — in `popup.html` add (near the eager checkbox):

```html
<label class="row"><input type="checkbox" id="charContext"> Ngữ cảnh nhân vật (đại từ nhất quán theo truyện)</label>
```
In `popup.js` load+save it (mirror the existing `mot_eager_translate` handling):
```javascript
const cc = document.getElementById('charContext');
chrome.storage.local.get('mot_character_context').then(({mot_character_context}) => { cc.checked = mot_character_context !== false; });
cc.addEventListener('change', () => chrome.storage.local.set({ mot_character_context: cc.checked }));
```

- [ ] **Step 6: Syntax check + commit**

Run: `node --check extension/content-script/content.js && node --check extension/popup/popup.js`
```bash
git add extension/content-script/content.js extension/popup/popup.html extension/popup/popup.js
git commit -m "extension: character-context plumbing (toggle, series id, gpt_config passthrough, cache v7)"
```

---

### Task 4: Client orchestration — accumulate, build, inject, ensure

**Files:**
- Modify: `extension/content-script/content.js` — series-context state + orchestration in `translateAndRenderImage`
- Modify: `extension/background/background.js` — message handlers `BUILD_SERIES_CONTEXT` / `SET_SERIES_CONTEXT` (network calls must run in the service worker)

**Interfaces consumed:** `getSeriesId`, `getCharacterContext`, `ApiAdapter.translateImage(blob, gptConfigPath)`, backend `/build-series-context` + `/set-series-context`.

- [ ] **Step 1: Background handlers** in `background.js` (mirror existing `TRANSLATE`/`fetch` handlers; use `getBackendUrl()`):

```javascript
  if (msg.type === 'BUILD_SERIES_CONTEXT') {
    (async () => {
      try {
        const base = await getBackendUrl();
        const r = await fetch(base + '/build-series-context', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(msg.payload),
        });
        sendResponse({ ok: r.ok, data: r.ok ? await r.json() : null });
      } catch (e) { sendResponse({ ok: false, error: String(e) }); }
    })();
    return true; // async
  }
  if (msg.type === 'SET_SERIES_CONTEXT') {
    (async () => {
      try {
        const base = await getBackendUrl();
        const r = await fetch(base + '/set-series-context', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(msg.payload),
        });
        sendResponse({ ok: r.ok, data: r.ok ? await r.json() : null });
      } catch (e) { sendResponse({ ok: false, error: String(e) }); }
    })();
    return true;
  }
```

- [ ] **Step 2: Series-context state module** in `content.js` (near the top-level state, above `translateAndRenderImage`):

```javascript
  // Option C: ngu canh nhan vat per-truyen. Trang thai in-memory + chrome.storage.local.
  const SeriesCtx = {
    _mem: null,            // { seriesId, sheet, path, srcAccum:[], pages, built }
    _ensuredThisSession: false,
    _building: false,
    _storeKey(seriesId) { return `mot_series_ctx_v${CFG.CACHE_VERSION}_${seriesId}`; },
    async load(seriesId) {
      if (this._mem && this._mem.seriesId === seriesId) return this._mem;
      const key = this._storeKey(seriesId);
      const got = (await chrome.storage.local.get(key))[key];
      this._mem = got || { seriesId, sheet: '', path: null, srcAccum: [], pages: 0, built: false };
      this._mem.seriesId = seriesId;
      return this._mem;
    },
    async save() {
      if (!this._mem) return;
      await chrome.storage.local.set({ [this._storeKey(this._mem.seriesId)]: this._mem });
    },
  };
```

- [ ] **Step 3: Orchestration inside `translateAndRenderImage`** — before calling the backend for a cache-MISS page, resolve the per-series gpt_config path; after translating, accumulate text and maybe trigger a build. Insert this logic where the code currently calls `ApiAdapter.translateImage(...)` on cache miss:

```javascript
      // ---- Option C: per-series character context ----
      let gptConfigPath = null;
      const ctxOn = await getCharacterContext();
      const seriesId = ctxOn ? getSeriesId() : null;
      let st = null;
      if (seriesId) {
        st = await SeriesCtx.load(seriesId);
        if (st.built && st.sheet) {
          if (!SeriesCtx._ensuredThisSession) {
            SeriesCtx._ensuredThisSession = true;
            const res = await sendMessageAsync({ type: 'SET_SERIES_CONTEXT', payload: { series_id: seriesId, sheet: st.sheet } }).catch(() => null);
            if (res && res.ok && res.data && res.data.gpt_config_path) { st.path = res.data.gpt_config_path; await SeriesCtx.save(); }
          }
          gptConfigPath = st.path;
        }
      }
      // ...existing translate call, now passing gptConfigPath:
      result = img.naturalHeight > CFG.TILE_MAX_H
        ? await ApiAdapter.translateImageTiled(blob, img.naturalWidth, img.naturalHeight, img, gptConfigPath)
        : await ApiAdapter.translateImage(await buildStitchedBlob(img, blob), gptConfigPath);
      // ...after result + Cache.set:
      if (seriesId && st && !st.built) {
        const srcs = (result.regions || []).map((r) => r.src).filter(Boolean);
        if (srcs.length) { st.srcAccum.push(...srcs); st.pages += 1; await SeriesCtx.save(); }
        const joined = st.srcAccum.join('\n');
        if (!SeriesCtx._building && st.pages >= CFG.CTX_MIN_PAGES && joined.length >= CFG.CTX_MIN_CHARS) {
          SeriesCtx._building = true;
          const res = await sendMessageAsync({ type: 'BUILD_SERIES_CONTEXT', payload: { series_id: seriesId, text: joined, target_lang: await getTargetLang() } }).catch(() => null);
          if (res && res.ok && res.data && res.data.sheet) {
            st.sheet = res.data.sheet; st.path = res.data.gpt_config_path; st.built = true; await SeriesCtx.save();
            log('Da dung ho so nhan vat cho truyen', seriesId, '-', st.sheet.length, 'ky tu');
          }
          SeriesCtx._building = false;
        }
      }
```
(Keep the existing `Cache.set`/`Cache.setUrlHash` calls. `sendMessageAsync` already exists in content.js.)

- [ ] **Step 4: Syntax check + commit**

Run: `node --check extension/content-script/content.js && node --check extension/background/background.js`
```bash
git add extension/content-script/content.js extension/background/background.js
git commit -m "extension: orchestrate per-series character context (accumulate, build, inject, ensure)"
```

---

### Task 5: Full verification + docs

- [ ] **Step 1: Human browser verification (Cốc Cốc)**

Ask the user to: reload the extension (CACHE_VERSION 7), open a manga with clear relationships, read past `CTX_MIN_PAGES` pages, and confirm later pages pick more consistent/appropriate pronouns (e.g. elders as "ông ấy/cha" not "anh ấy"). Also verify: toggle OFF ⇒ behaves like before; console shows "Da dung ho so nhan vat" after a few pages. If quality is off, iterate on the extraction prompt (`_CTX_EXTRACT_SYSTEM`) — rebuild+recreate.

- [ ] **Step 2: After user confirms — update `README.md`** (short note: per-series character context via `/build-series-context` + `/set-series-context` writing a per-series gpt_config; opt-out toggle; CACHE_VERSION 7).

- [ ] **Step 3: After user confirms — update project memory** (`manga_translator_project.md` + `MEMORY.md`): Option C shipped (approach B, per-series gpt_config injection), with the constants and the endpoints.

- [ ] **Step 4: Commit docs**

```bash
git add README.md
git commit -m "docs: record per-series character context (Option C)"
```

---

## Self-Review

**Spec coverage:** §5 backend endpoints → Task 1/2. §4 series id → Task 3 Step 3. §6.1 toggle → Task 3 Step 2/5. §6.3 orchestration → Task 4 Step 3. §6.4 gpt_config passthrough → Task 3 Step 4. §6.5 cache bump → Task 3 Step 1. §5.4 per-series YAML inherits base → Task 1 `_write_series_gpt_config` + Task 2 Step 3 assert. §9 recreate-resilience (`/set-series-context` ensure) → Task 4 Step 3. ✓

**Placeholder scan:** endpoint + orchestration code given in full; extraction prompt inline. No TBD. ✓

**Type consistency:** `translateImage(blob, gptConfigPath)` and `translateImageTiled(..., gptConfigPath)` used consistently (Task 3 Step 4, Task 4 Step 3); message types `BUILD_SERIES_CONTEXT`/`SET_SERIES_CONTEXT` match between content.js and background.js; response shape `{ok, data:{sheet, gpt_config_path}}` consistent. ✓

**Risks to watch during impl:** (a) `openai`/`os` import presence in main.py (Task 1 Step 1 checks). (b) `translateImageTiled` internally calls `translateImage` per tile — must forward `gptConfigPath` (Task 3 Step 4). (c) `sendMessageAsync` returns the raw `sendResponse` object — confirm shape when wiring. (d) hitomi series-id regex vs actual reader URL — verify on real page in Task 5.
