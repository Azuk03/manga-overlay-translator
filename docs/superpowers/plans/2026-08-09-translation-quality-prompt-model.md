# Translation Quality: Prompt + Model Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make translations noticeably less mechanical — better Vietnamese pronouns/forms-of-address, natural manga register, multi-source-language (JP/KR/CN/EN) — by upgrading the model to `gpt-4o` and rewriting the `gpt_config` system prompt.

**Architecture:** Two backend-config changes baked into the Docker image + one mandatory client cache bump. (1) `.env` `OPENAI_MODEL` → `gpt-4o`. (2) rewrite `patches/gpt_config-vi.yaml`'s `chat_system_template`. (3) bump `CFG.CACHE_VERSION` so old cached translations don't mask the new output. No pipeline/architecture change.

**Tech Stack:** OpenAI `gpt-4o` via `CommonGPTTranslator`; YAML `gpt_config` loaded by OmegaConf; Docker rebuild + `run-backend.ps1`; extension `chrome.storage.local` cache.

## Global Constraints

- The new `chat_system_template` MUST keep the INPUT/OUTPUT FORMAT + Example blocks that instruct the model to preserve `<|n|>` markers verbatim. Dropping them breaks the backend regex parser → "Found indices count (0) does not match expected count (N)" → translations dropped (empty overlay).
- MUST keep the proper-noun romanization rule (personal names, titles, place names → Latin, never raw script).
- Exact prompt text = the `chat_system_template` block in the spec §3.3 — copy it verbatim.
- `.env` is gitignored (holds the API key) — edit it locally, do NOT commit it. Document the model choice in `.env.example` (committed).
- Backend-config lives in the image → apply = edit `patches/*` / `.env` → `docker build` → `run-backend.ps1` (recreate). `docker restart` does NOT re-read env vars or a rebuilt image.
- Cache key is `mot_cache_v{CACHE_VERSION}_{engine}_{lang}_{hash}` (no model/prompt in the key) → the ONLY way the new translations show is to bump `CFG.CACHE_VERSION`.
- Executor (port 5004) comes up a few seconds AFTER server (5003) returns 200 on `/`; a translate fired too early returns a code-2 "Translation service is starting up" frame — retry the translate, don't just poll `/`.
- Test harness in session scratchpad: `body.json` (self-contained PNG request) + `parse_resp.py` (unframes stream, extracts code-0 JSON).

---

### Task 1: Rewrite the system prompt

**Files:**
- Modify: `patches/gpt_config-vi.yaml` — replace the `chat_system_template` value

- [ ] **Step 1: Replace the `chat_system_template` block** with the verbatim text from spec §3.3 (keep the leading `chat_system_template: >` folded-scalar key and the explanatory `#` comments above it; keep 2-space indentation for the folded body).

- [ ] **Step 2: Validate YAML parses and the key/markers survive**

Run:
```bash
cd e:/Working/ForFun/manga
python -c "import yaml,sys; d=yaml.safe_load(open('patches/gpt_config-vi.yaml',encoding='utf-8')); t=d['chat_system_template']; assert '<|1|>' in t and '<|2|>' in t, 'markers missing'; assert 'EXACT SAME tag' in t, 'format rule missing'; assert '{to_lang}' in t, 'to_lang var missing'; print('YAML OK, len',len(t))"
```
Expected: `YAML OK, len <N>` (no assertion error).

- [ ] **Step 3: Commit**

```bash
git add patches/gpt_config-vi.yaml
git commit -m "backend: richer VI translation prompt (pronouns, honorifics, JP/KR/CN/EN sources)"
```

---

### Task 2: Model + cache bump

**Files:**
- Modify: `.env` (local, not committed) — `OPENAI_MODEL`
- Modify: `.env.example` (committed) — document `gpt-4o`
- Modify: `extension/content-script/content.js:35` — `CACHE_VERSION` 5 → 6

- [ ] **Step 1: Set the model in `.env`**

Change `OPENAI_MODEL=gpt-4o-mini` → `OPENAI_MODEL=gpt-4o`.

Run to confirm: `grep OPENAI_MODEL .env` → expect `OPENAI_MODEL=gpt-4o`.

- [ ] **Step 2: Document in `.env.example`**

Ensure `.env.example` shows `OPENAI_MODEL=gpt-4o` (with a short comment that mini is cheaper/faster but lower quality). If the key isn't present, add it near the other OPENAI_* lines.

- [ ] **Step 3: Bump `CACHE_VERSION`** in `extension/content-script/content.js` line 35:

```javascript
    CACHE_VERSION: 6, // gpt-4o + prompt moi (xung ho/giong/da ngon ngu) - buoc dich lai, bo cache cu
```

- [ ] **Step 4: Syntax-check the extension file**

Run: `node --check extension/content-script/content.js` → expect no output (OK).

- [ ] **Step 5: Commit (client + example only; NOT .env)**

```bash
git add extension/content-script/content.js .env.example
git commit -m "translate: bump CACHE_VERSION to 6, document gpt-4o in .env.example"
```

---

### Task 3: Rebuild, recreate, smoke test

**Files:** none (build/run/verify only)

- [ ] **Step 1: Rebuild the image**

Run: `docker build -t manga-translator-patched:local .`
Expected: build succeeds (gpt_config layer rebuilt).

- [ ] **Step 2: Recreate the backend**

Run: `docker rm -f manga_translator` (if running), then `run-backend.ps1` in the background; poll `/` for 200.

- [ ] **Step 3: Confirm the model actually took effect**

Run: `docker exec manga_translator printenv OPENAI_MODEL`
Expected: `gpt-4o`.

- [ ] **Step 4: Smoke-translate one page (retry until executor ready), check format + no raw script**

```bash
cd <scratchpad>
for i in $(seq 1 25); do
  curl -s -X POST http://127.0.0.1:5003/translate/json/stream -H "Content-Type: application/json" \
    --data-binary @body.json -o resp_q.bin -w "attempt $i http=%{http_code} time=%{time_total}s\n"
  python -c "
import sys;buf=open('resp_q.bin','rb').read();i=0;ok=False;st2=False
while i+5<=len(buf):
  st=buf[i];n=int.from_bytes(buf[i+1:i+5],'big');d=buf[i+5:i+5+n];i+=5+n
  if st==0:ok=True
  if st==2 and b'starting up' in d:st2=True
sys.exit(0 if ok else (2 if st2 else 1))
" && break || { [ $? -eq 2 ] && sleep 3 || break; }
done
python parse_resp.py resp_q.bin > out_q.json
python -c "
import json,re;o=json.load(open('out_q.json'));print('regions',o['count'])
# pull dst text straight from the raw JSON frame for a sanity read
"
# also dump the translated dst strings from the code-0 frame
python -c "
buf=open('resp_q.bin','rb').read();i=0
import json
while i+5<=len(buf):
  st=buf[i];n=int.from_bytes(buf[i+1:i+5],'big');d=buf[i+5:i+5+n];i+=5+n
  if st==0:
    for t in json.loads(d)['translations']:
      dst=t['text'].get('dst','');print(repr(dst))
    break
"
```
Expected: `http=200`, region count matches the page, `dst` strings are natural Vietnamese, contain NO raw hangul/kana/kanji/hanzi, and NO "Found indices count" error appears in `docker logs`. (Region count/coords should still match `baseline.json` — detection is unchanged.)

- [ ] **Step 5: Check logs for parser errors**

Run: `docker logs --tail 60 manga_translator 2>&1 | grep -iE "does not match expected count|translated OK" | tail -5`
Expected: see "translated OK", NO "does not match expected count".

---

### Task 4: Human browser verification + docs

- [ ] **Step 1: Ask the user to verify quality in Cốc Cốc**

Because `CACHE_VERSION` bumped to 6, all pages re-translate fresh. Ask the user to reload the extension (to pick up `CACHE_VERSION: 6`) + F5 a page they've read before, and compare: are pronouns/forms-of-address more natural, register less mechanical, no raw source characters? Wait for confirmation. If they want tweaks to tone/pronoun defaults, iterate on `patches/gpt_config-vi.yaml` (rebuild+recreate) — this is expected for prompt tuning.

- [ ] **Step 2: After user confirms — update `README.md`**

Add a short note under the `gpt_config` section: model now `gpt-4o`; prompt rewritten for VI pronouns/forms-of-address, honorific conversion, and JP/KR/CN/EN sources; `CACHE_VERSION` bumped to 6.

- [ ] **Step 3: After user confirms — update project memory**

In `manga_translator_project.md`, append a 2026-08-09 note: translation-quality upgrade shipped (gpt-4o + rewritten prompt), Option C (cross-page context) still deferred.

- [ ] **Step 4: Commit docs**

```bash
git add README.md
git commit -m "docs: record translation-quality upgrade (gpt-4o + rewritten VI prompt)"
```

---

## Self-Review

**Spec coverage:** A model change → Task 2/3. B prompt rewrite → Task 1 (verbatim spec §3.3). Multi-source + pronouns + honorifics + tone → in the prompt text. Cache bump → Task 2 Step 3. Verify (rebuild/recreate/smoke/human) → Tasks 3-4. ✓

**Placeholder scan:** prompt text lives verbatim in spec §3.3 (referenced, not duplicated, to avoid drift); all commands concrete. ✓

**Type/consistency:** `CACHE_VERSION` 5→6 matches the cache-key format at content.js:130; `OPENAI_MODEL` env name matches `run-backend.ps1` passthrough; `chat_system_template` key matches OmegaConf/`config_gpt.py` usage. ✓

**Note on testing:** translation quality is subjective — no automated assertion beyond format-integrity (markers preserved, no raw script, no parser error) + region-count equivalence. Quality itself is human-judged in Task 4.
