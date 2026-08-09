# Backend Context-Relay Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the ~14s "backend done → overlay drawn" gap to <1s by running `to_translation` on the executor so only the small (~108KB) JSON crosses the executor→server process boundary instead of the full 108.5MB pickled `Context`.

**Architecture:** Pure backend change to the self-hosted Docker image. The executor process (`manga_translator shared`, port 5004) currently `pickle.dumps(ctx)` the entire Context and streams it to the server process (port 5003), which then runs `to_translation` + `model_dump_json`. We move `to_translation` onto the executor (gated by a `config._response_format` flag the server sets), so the executor transfers only a small `TranslationResponse`. We also fix an O(n²) buffer accumulation on the server's stream reader. No extension/client change — the client still receives the same code-0 JSON.

**Tech Stack:** Python 3.11, FastAPI, aiohttp, pydantic v2, numpy, pickle; Docker (`manga-translator-patched:local` built from `zyddnys/manga-image-translator:main` + `patches/*` COPYs); PowerShell `run-backend.ps1`; measured via `docker logs -t` + `curl`.

## Global Constraints

- **Backend-only.** Do NOT modify `extension/` or any client code. The stream protocol seen by the client is unchanged (code-0 = final JSON, same shape).
- **Output must stay equivalent:** same region count, same region coords (`minX/minY/maxX/maxY`), same per-region `background` base64 for the same input image. (`src`/`dst` text is GPT-nondeterministic and is NOT part of equivalence.)
- **Permanent fixes live in `patches/*` + `Dockerfile` COPY** (backend code is baked into the image; only `/app/result` is bind-mounted). Applying a fix = edit `patches/*` → `docker build` → `run-backend.ps1` (recreate). `docker restart` does NOT pick up a new image.
- **`docker restart` preserves in-container edits; `run-backend.ps1` (docker rm+run) wipes them.** Any temporary in-container instrumentation must be re-applied after a recreate.
- Only touch the `json` response path. Leave `bytes`/`image` endpoints behaviorally unchanged (unused by this project).
- Do NOT push to origin. Local commits only.
- Baseline gap is already measured (investigation `docs/2026-08-08-...` + this session): `Running rendering` → transform ≈ **14s**, pickled Context = **108.5 MB**, final JSON = **108 KB**, transform itself = **6 ms**. Success = same measurement showing **<1s**.

**Test image / harness (reused across tasks):** scratchpad `body.json` (a real hitomi page, PNG data URL, config `{translator:{translator:chatgpt,target_lang:VIN}, render:{renderer:none}, inpainter:{inpainter:lama_mpe,inpainting_size:1024}}`). Backend at `http://127.0.0.1:5003`. If the token/image is stale, re-fetch via `POST /fetch-image` then convert AVIF→PNG with host `python -c "from PIL import Image; Image.open('img.avif').convert('RGB').save('img.png')"`.

**Frame parser (reused):** the stream response is concatenated frames `status(1 byte) + len(4 bytes big-endian) + data`. The `status==0` frame's `data` is the final JSON. Save this helper as scratchpad `parse_resp.py`:

```python
import sys, json
buf = open(sys.argv[1], "rb").read()
i = 0
while i + 5 <= len(buf):
    status = buf[i]
    n = int.from_bytes(buf[i+1:i+5], "big")
    data = buf[i+5:i+5+n]
    i += 5 + n
    if status == 0:
        obj = json.loads(data)
        regs = obj["translations"]
        slim = [{"c": [r["minX"], r["minY"], r["maxX"], r["maxY"]], "bg": r["background"][:64], "bglen": len(r["background"])} for r in regs]
        print(json.dumps({"count": len(regs), "regions": slim}, ensure_ascii=False, indent=1))
        break
```

(Compares region count, coords, and background prefix+length — deterministic given the same image — while ignoring GPT-variable text.)

---

### Task 1: Establish override plumbing (no behavior change) + baseline output

Extract the two upstream files unmodified into `patches/`, wire them into the `Dockerfile`, rebuild, and prove the image behaves identically. This isolates "did the COPY plumbing break anything" from later logic changes. Also capture the baseline JSON output for the equivalence check.

**Files:**
- Create: `patches/share.py` (verbatim copy of container `/app/manga_translator/mode/share.py`)
- Create: `patches/sent_data_internal.py` (verbatim copy of container `/app/server/sent_data_internal.py`)
- Modify: `Dockerfile` (add two `COPY` lines)
- Create (scratchpad, not committed): `parse_resp.py`, `baseline.json`

**Interfaces:**
- Produces: `patches/share.py` containing `class MangaShare` with `async def run_method(self, method, **attributes)` (the method Task 3 edits) and `/execute/{method_name}` route. `patches/sent_data_internal.py` containing `async def process_stream(response, sender)` and `def handle_buffer(buffer, sender)` (edited in Task 2).

- [ ] **Step 1: Extract the two originals verbatim from the running container**

```bash
cd e:/Working/ForFun/manga
docker cp manga_translator:/app/manga_translator/mode/share.py patches/share.py
docker cp manga_translator:/app/server/sent_data_internal.py patches/sent_data_internal.py
```

- [ ] **Step 2: Add COPY lines to `Dockerfile`** (append after the existing `deepl.py` COPY)

```dockerfile
# Toi uu: chuyen to_translation sang chay tren executor de chi truyen JSON nho
# (~108KB) thay vi pickle ca Context (~108MB) qua ranh gioi tien trinh. Xem
# docs/superpowers/specs/2026-08-09-backend-context-relay-optimization-design.md
COPY patches/share.py /app/manga_translator/mode/share.py
COPY patches/sent_data_internal.py /app/server/sent_data_internal.py
```

- [ ] **Step 3: Sanity-compile the extracted files**

Run: `python -c "import ast; ast.parse(open('patches/share.py',encoding='utf-8').read()); ast.parse(open('patches/sent_data_internal.py',encoding='utf-8').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 4: Rebuild the image**

Run: `docker build -t manga-translator-patched:local .`
Expected: build succeeds; the two new COPY layers appear.

- [ ] **Step 5: Recreate the backend and wait for ready**

Run: `pwsh -File run-backend.ps1` (in the background), then poll `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5003/` until `200`.
Expected: server up (identical startup logs to before).

- [ ] **Step 6: Capture baseline output + confirm it still works**

```bash
cd C:/Users/ACER/AppData/Local/Temp/claude/.../scratchpad   # session scratchpad
curl -s -X POST http://127.0.0.1:5003/translate/json/stream -H "Content-Type: application/json" \
  --data-binary @body.json -o resp_baseline.bin -w "http=%{http_code} time=%{time_total}s\n"
python parse_resp.py resp_baseline.bin > baseline.json
cat baseline.json
```

Expected: `http=200`; `baseline.json` shows a region count > 0 with coords and background lengths. (Gap is still ~14s here — plumbing task does not fix perf yet.)

- [ ] **Step 7: Commit**

```bash
cd e:/Working/ForFun/manga
git add patches/share.py patches/sent_data_internal.py Dockerfile
git commit -m "backend: vendor share.py + sent_data_internal.py as patches (no behavior change)"
```

---

### Task 2: Fix the O(n²) stream buffer (Option C)

Replace the `buffer += chunk` bytes-concatenation loop (O(n²) on large payloads) with an amortized-O(n) `bytearray` + consume offset in `patches/sent_data_internal.py`.

**Files:**
- Modify: `patches/sent_data_internal.py` — `process_stream` and `handle_buffer`

**Interfaces:**
- Consumes: `patches/sent_data_internal.py` from Task 1.
- Produces: same `process_stream(response, sender)` / same framing semantics; `sender(status, data)` still called once per complete frame with `data` as `bytes`.

- [ ] **Step 1: Replace `process_stream` + `handle_buffer`** with the bytearray version

Current:

```python
async def process_stream(response, sender: NotifyType):
    buffer = b''
    async for chunk in response.content.iter_any():
        if chunk:
            buffer += chunk
            buffer = handle_buffer(buffer, sender)

def handle_buffer(buffer, sender: NotifyType):
    while len(buffer) >= 5:
        status, expected_size = extract_header(buffer)
        if len(buffer) >= 5 + expected_size:
            data = buffer[5:5 + expected_size]
            sender(status, data)
            buffer = buffer[5 + expected_size:]
        else:
            break
    return buffer
```

Replace with (keep `extract_header` unchanged):

```python
async def process_stream(response, sender: NotifyType):
    buffer = bytearray()
    async for chunk in response.content.iter_any():
        if chunk:
            buffer.extend(chunk)
            _drain_buffer(buffer, sender)

def _drain_buffer(buffer: bytearray, sender: NotifyType):
    """Consume every complete frame from the front of `buffer` in place.
    Frame = status(1) + size(4, big-endian) + data. Amortized O(n): we
    delete a contiguous run of consumed frames once, not per-frame."""
    consumed = 0
    total = len(buffer)
    while total - consumed >= 5:
        status = buffer[consumed]
        expected_size = int.from_bytes(buffer[consumed + 1:consumed + 5], "big")
        if total - consumed >= 5 + expected_size:
            data = bytes(buffer[consumed + 5:consumed + 5 + expected_size])
            sender(status, data)
            consumed += 5 + expected_size
        else:
            break
    if consumed:
        del buffer[:consumed]
```

(`handle_buffer` is removed; nothing else references it — verify with grep in Step 2.)

- [ ] **Step 2: Verify no other reference to `handle_buffer` and file compiles**

Run: `grep -rn "handle_buffer" patches/ && echo "FOUND (fix)" || echo "none"` then `python -c "import ast; ast.parse(open('patches/sent_data_internal.py',encoding='utf-8').read()); print('OK')"`
Expected: `none` and `OK`.

- [ ] **Step 3: Rebuild + recreate**

Run: `docker build -t manga-translator-patched:local . && pwsh -File run-backend.ps1` (background), poll `/` for 200.
Expected: up.

- [ ] **Step 4: Verify output still equivalent**

```bash
curl -s -X POST http://127.0.0.1:5003/translate/json/stream -H "Content-Type: application/json" \
  --data-binary @body.json -o resp_c.bin -w "http=%{http_code} time=%{time_total}s\n"
python parse_resp.py resp_c.bin > out_c.json
python -c "import json;a=json.load(open('baseline.json'));b=json.load(open('out_c.json'));print('count',a['count']==b['count']);print('coords',[r['c'] for r in a['regions']]==[r['c'] for r in b['regions']]);print('bg',[r['bglen'] for r in a['regions']]==[r['bglen'] for r in b['regions']])"
```

Expected: `http=200`; `count True`, `coords True`, `bg True`. (Gap still ~large — payload is still 108MB until Task 3; C alone just removes the O(n²) amplifier.)

- [ ] **Step 5: Commit**

```bash
cd e:/Working/ForFun/manga
git add patches/sent_data_internal.py
git commit -m "backend: O(n^2) -> O(n) stream buffer in sent_data_internal (Option C)"
```

---

### Task 3: Run `to_translation` on the executor (Option A) — the fix

Executor builds the small `TranslationResponse` locally (where `img_inpainted` lives) and pickles only that. Requires `.copy()` on the background crops (a numpy view would drag the full base array back into the pickle), a `config._response_format` flag set by the server, and `transform_to_json` accepting an already-built `TranslationResponse`.

**Files:**
- Modify: `patches/to_json.py:104` — `.copy()` the background crop
- Modify: `patches/share.py` — `run_method` applies `to_translation` when flag set
- Modify: `patches/main.py` — `stream_json` sets flag; `transform_to_json` accepts `TranslationResponse`

**Interfaces:**
- Consumes: `to_translation(ctx) -> TranslationResponse` (from `patches/to_json.py`, unchanged signature); `MangaShare.run_method` (Task 1); `config` object reaching the executor carries arbitrary `_underscore` attrs (proven: executor already reads `config._web_frontend_optimized`).
- Produces: for the `json` path, the executor sends `pickle.dumps(TranslationResponse)`; the server's `transform_to_json` returns `bytes` of the JSON regardless of whether it received a `Context` or a `TranslationResponse`.

- [ ] **Step 1: `.copy()` the background crop in `patches/to_json.py`**

Change line 104 from:

```python
                    background=inpaint[minY:maxY, minX:maxX],
```

to:

```python
                    background=inpaint[minY:maxY, minX:maxX].copy(),  # detach from base array so pickling the crop doesn't drag the full inpaint image
```

- [ ] **Step 2: Make `transform_to_json` accept a prebuilt `TranslationResponse` in `patches/main.py`**

Change:

```python
def transform_to_json(ctx):
    return to_translation(ctx).model_dump_json().encode("utf-8")
```

to:

```python
def transform_to_json(ctx):
    # Executor may have already built the TranslationResponse (json fast-path,
    # see mode/share.py) to avoid pickling the whole Context across processes.
    # Fall back to building it here if we received a raw Context.
    tr = ctx if isinstance(ctx, TranslationResponse) else to_translation(ctx)
    return tr.model_dump_json().encode("utf-8")
```

(`TranslationResponse` is already imported at the top of `patches/main.py`: `from server.to_json import to_translation, TranslationResponse`.)

- [ ] **Step 3: Set the flag in `stream_json` in `patches/main.py`**

Change:

```python
async def stream_json(req: Request, data: TranslateRequest) -> StreamingResponse:
    return await while_streaming(req, transform_to_json, data.config, data.image)
```

to:

```python
async def stream_json(req: Request, data: TranslateRequest) -> StreamingResponse:
    # Ask the executor to build the small TranslationResponse locally and send
    # only that (~108KB) instead of pickling the full ~108MB Context back.
    data.config._response_format = "json"
    return await while_streaming(req, transform_to_json, data.config, data.image)
```

- [ ] **Step 4: Apply `to_translation` on the executor in `patches/share.py`**

In `run_method`, the non-placeholder `else` branch currently is:

```python
            else:
                result_bytes = pickle.dumps(result)
```

Replace with:

```python
            else:
                if getattr(attributes.get("config", None), "_response_format", None) == "json":
                    # Build the small TranslationResponse here (executor has the
                    # full Context locally) so only ~108KB crosses to the server
                    # process instead of the whole ~108MB pickled Context.
                    from server.to_json import to_translation
                    result_bytes = pickle.dumps(to_translation(result))
                else:
                    result_bytes = pickle.dumps(result)
```

Note: `run_method(self, method, **attributes)` receives the same `attributes` dict the executor was called with, which includes `config` (see `/execute/{method_name}`: `attr = restricted_loads(await request.body())` then `run_method(method, **attr)`, where `attr` has keys `image`, `config`). Confirm the key name in Step 5.

- [ ] **Step 5: Verify `config` is reachable in `run_method` + all files compile**

Run: `grep -n "restricted_loads\|run_method\|attr\b\|config" patches/share.py | head -30`
Expected: confirms the `/execute` route does `attr = restricted_loads(...)` and `run_method(method, **attr)`, and that `attr` carries `config` (the request body is `{"image":..., "config":...}` per `fetch_data_stream`). If the key differs, adjust `attributes.get("config")` accordingly.
Then: `python -c "import ast;[ast.parse(open(f,encoding='utf-8').read()) for f in ['patches/to_json.py','patches/main.py','patches/share.py']];print('OK')"`
Expected: `OK`.

- [ ] **Step 6: Rebuild + recreate**

Run: `docker build -t manga-translator-patched:local . && pwsh -File run-backend.ps1` (background), poll `/` for 200.
Expected: up.

- [ ] **Step 7: Measure the gap + verify equivalence**

```bash
curl -s -X POST http://127.0.0.1:5003/translate/json/stream -H "Content-Type: application/json" \
  --data-binary @body.json -o resp_a.bin -w "http=%{http_code} time=%{time_total}s\n"
python parse_resp.py resp_a.bin > out_a.json
python -c "import json;a=json.load(open('baseline.json'));b=json.load(open('out_a.json'));print('count',a['count']==b['count']);print('coords',[r['c'] for r in a['regions']]==[r['c'] for r in b['regions']]);print('bg',[r['bglen'] for r in a['regions']]==[r['bglen'] for r in b['regions']])"
# gap: compare docker 'Running rendering' timestamp to the request completion
docker logs -t --tail 40 manga_translator 2>&1 | grep -aE "Running rendering|execute/translate" | tail -4
```

Expected: `http=200`, `count/coords/bg` all `True`. The `Running rendering` → response gap is now **<1s** (visible as the `time_total` dropping by ~11-13s vs the baseline curl in Task 1 Step 6 on the same image, and no multi-second silent gap after `Running rendering`).

**If gap is still large:** the crop `.copy()` was likely missed or the flag isn't reaching the executor — re-run Step 5's grep and add a temporary `print(f"[MOT-CHK] fmt={getattr(attributes.get('config',None),'_response_format',None)} bytes={len(result_bytes)}", flush=True)` in `share.py`, rebuild, and confirm `fmt=json` and `bytes` ~1-3MB (not ~108MB). Remove the print before committing.

- [ ] **Step 8: Commit**

```bash
cd e:/Working/ForFun/manga
git add patches/to_json.py patches/main.py patches/share.py
git commit -m "backend: run to_translation on executor, ship 108KB not 108MB Context (Option A)"
```

---

### Task 4: Human browser verification + docs/memory update

Hand off for the mandatory live-browser check (this project's convention: code review is necessary but never sufficient for browser-facing behavior), then record the outcome.

**Files:**
- Modify: `README.md` (backend log — note the relay optimization + new patches)
- Modify: `C:\Users\ACER\.claude\projects\e--Working-ForFun\memory\manga_translator_project.md` (mark the fix as SHIPPED once the user confirms)

- [ ] **Step 1: Confirm no leftover instrumentation**

Run: `grep -rn "MOT-CHK\|MOT-PERF\|MOT-PICKLE\|MOT-GAP" patches/ ; echo done`
Expected: no matches.

- [ ] **Step 2: Ask the user to verify in Cốc Cốc**

Prompt the user to: load the extension (from `extension/`), translate a fresh hitomi page (eager off, Cache-MISS), and confirm the overlay now appears within ~1s of the terminal finishing, with correct content. Wait for their confirmation. If they report a problem, treat it as a new debugging cycle (superpowers:systematic-debugging) — do not mark shipped.

- [ ] **Step 3: After user confirms — update `README.md`**

Add a short entry noting: the executor now builds `TranslationResponse` locally for the `json` path (`config._response_format="json"`), transferring ~108KB instead of a ~108MB pickled Context; `patches/share.py` and `patches/sent_data_internal.py` are new full-override patches; O(n²) stream buffer fixed.

- [ ] **Step 4: After user confirms — update project memory**

In `manga_translator_project.md`, change the 2026-08-09 root-cause entry's "NOT YET BUILT — awaiting user go-ahead" to "SHIPPED (build + browser-verified): gap ~14s → <1s via Option A+C." Update the `MEMORY.md` index line similarly.

- [ ] **Step 5: Commit docs**

```bash
cd e:/Working/ForFun/manga
git add README.md
git commit -m "docs: record backend context-relay optimization (gap 14s -> <1s)"
```

---

## Self-Review

**Spec coverage:**
- §3.1 executor-side `to_translation` + `_response_format` flag → Task 3 Steps 3-4. ✓
- §3.2 numpy-view `.copy()` trap → Task 3 Step 1. ✓
- §3.3 O(n²) buffer → Task 2. ✓
- §4 file table (`to_json.py`, `main.py`, `share.py`, `sent_data_internal.py`, `Dockerfile`) → Tasks 1-3. ✓
- §5 test/acceptance (build + curl + equivalence + <1s + human verify) → Tasks 1-4. ✓
- §6 risks (layering import, `.copy()` miss, patch drift) → Task 3 Step 4 import, Step 7 fallback check, Task 1 vendoring. ✓

**Placeholder scan:** No TBD/TODO; every code step shows the exact before/after. ✓

**Type consistency:** `to_translation(ctx) -> TranslationResponse`, `transform_to_json` returns `bytes`, `TranslationResponse` already imported in `main.py`, `run_method(self, method, **attributes)` with `attributes["config"]` — consistent across Tasks 1-3. ✓

**Note on TDD:** this GPU/Docker backend has no unit-test harness and adding one for the pipeline is out of scope; verification is build + `curl` + output-equivalence + timing, which is the honest test cycle for this codebase. Region-coord + background equivalence (not GPT-variable text) is the correctness gate.
