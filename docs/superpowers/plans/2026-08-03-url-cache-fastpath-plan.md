# URL Cache Fast-path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Skip the ~3.4s image re-download+hash on cache hits by adding a URL→content-hash index, so pre-translated/cached pages render near-instantly on navigation.

**Architecture:** Add a lightweight `URL → content-hash` mapping to `Cache` (chrome.storage.local). `translateAndRenderImage` looks up the hash by URL first and, on a hit, fetches the cached result and renders WITHOUT downloading the image. The existing content-hash cache remains the fallback and is what actually stores the translation result; the URL map is just an index that lets us skip the expensive download when we already know the hash.

**Tech Stack:** Vanilla JS (MV3 content script), chrome.storage.local, no build step, no test framework (manual verification).

## Global Constraints

- The content-hash `Cache` (get/set/hashBlob/_key) and the backend path stay unchanged; the URL map is additive.
- Fast-path result MUST still respect targetLang/engine: URL→hash gives the content hash (language-independent), then `Cache.get(hash, targetLang, engine)` applies lang/engine. On a lang/engine the result isn't cached for, the fast path yields null and correctly falls through to the slow path.
- Skip the URL fast-path for `blob:`/`data:` URLs (unstable) — behave exactly as today for those.
- `CACHE_VERSION` is embedded in the URL-map key so a version bump invalidates stale mappings.
- Vanilla JS, no build step, no shared module system, no new permissions.
- No automated test suite (pure DOM/browser). Verification is MANUAL on hitomi + a webtoon site.
- `node --check` must pass on content.js.
- Design source of truth: `docs/superpowers/specs/2026-08-03-url-cache-fastpath-design.md`.

---

## File Map

- Modify: `extension/content-script/content.js` — add 3 members to `Cache`; refactor `translateAndRenderImage`'s cache lookup to a URL fast-path + download slow-path; add one `setUrlHash` call in `prefetchHitomiGallery`.

---

### Task 1: URL→hash index + fast-path lookup

**Files:**
- Modify: `extension/content-script/content.js` — the `Cache` object (currently ends near line 140), `translateAndRenderImage` (currently ~line 902), and `prefetchHitomiGallery` (added by the hitomi-prefetch feature).

**Interfaces:**
- Consumes: existing `Cache.hashBlob/_key/get/set`, `CFG.CACHE_VERSION`, `ApiAdapter.downloadImageBlob/translateImage/translateImageTiled`, `buildStitchedBlob`, `getTargetLang/getTranslatorEngine`.
- Produces: `Cache.getHashByUrl(url) → string|null` and `Cache.setUrlHash(url, hash) → Promise<void>`.

- [ ] **Step 1: Add `_urlKey` / `getHashByUrl` / `setUrlHash` to `Cache`**

Find the end of the `Cache` object:
```javascript
    async set(hash, targetLang, engine, value) {
      const key = this._key(hash, targetLang, engine);
      await chrome.storage.local.set({ [key]: JSON.stringify(value) });
    },
  };
```

Replace with (adds the three members before the closing `};`):
```javascript
    async set(hash, targetLang, engine, value) {
      const key = this._key(hash, targetLang, engine);
      await chrome.storage.local.set({ [key]: JSON.stringify(value) });
    },

    // Chi muc URL anh -> hash NOI DUNG (khong kem lang/engine vi hash la hash
    // noi dung anh, doc lap ngon ngu). Cho phep tra cache MA KHONG phai tai +
    // hash lai anh (~3.4s) khi da biet hash tu lan truoc (xem spec
    // 2026-08-03-url-cache-fastpath-design.md).
    _urlKey(url) {
      return `mot_urlhash_v${CFG.CACHE_VERSION}_${url}`;
    },
    async getHashByUrl(url) {
      const key = this._urlKey(url);
      const result = await chrome.storage.local.get(key);
      return result[key] || null;
    },
    async setUrlHash(url, hash) {
      await chrome.storage.local.set({ [this._urlKey(url)]: hash });
    },
  };
```

- [ ] **Step 2: Refactor `translateAndRenderImage`'s cache lookup into URL fast-path + download slow-path**

Find (currently ~line 902-920):
```javascript
  async function translateAndRenderImage(img) {
    if (imgLayers.has(img)) return;
    const tStart = performance.now();
    try {
      const blob = await ApiAdapter.downloadImageBlob(img);
      const hash = await Cache.hashBlob(blob);
      const targetLang = await getTargetLang();
      const engine = await getTranslatorEngine();
      let result = await Cache.get(hash, targetLang, engine);
      if (result) {
        log('Cache HIT:', hash, targetLang, engine, img.currentSrc || img.src);
      } else {
        log('Cache MISS, goi backend:', hash, targetLang, engine, img.currentSrc || img.src);
        result =
          img.naturalHeight > CFG.TILE_MAX_H
            ? await ApiAdapter.translateImageTiled(blob, img.naturalWidth, img.naturalHeight, img)
            : await ApiAdapter.translateImage(await buildStitchedBlob(img, blob));
        await Cache.set(hash, targetLang, engine, result);
      }
```

Replace with:
```javascript
  async function translateAndRenderImage(img) {
    if (imgLayers.has(img)) return;
    const tStart = performance.now();
    try {
      const targetLang = await getTargetLang();
      const engine = await getTranslatorEngine();
      const url = img.currentSrc || img.src;
      const urlCacheable = !!url && !url.startsWith('blob:') && !url.startsWith('data:');
      let result = null;

      // FAST PATH: tra cache theo URL -> hash -> ket qua, KHONG tai anh (bo qua
      // ~3.4s tai + hash). Chi trung khi da tung dich URL nay o dung lang/engine.
      if (urlCacheable) {
        const knownHash = await Cache.getHashByUrl(url);
        if (knownHash) {
          result = await Cache.get(knownHash, targetLang, engine);
          if (result) log('Cache HIT (URL, khong tai anh):', targetLang, engine, url);
        }
      }

      // SLOW PATH: tai anh + hash + tra hash-cache + (dich backend). Luu chi muc
      // URL->hash de lan sau vao fast-path.
      if (!result) {
        const blob = await ApiAdapter.downloadImageBlob(img);
        const hash = await Cache.hashBlob(blob);
        result = await Cache.get(hash, targetLang, engine);
        if (result) {
          log('Cache HIT (hash):', hash, targetLang, engine, url);
        } else {
          log('Cache MISS, goi backend:', hash, targetLang, engine, url);
          result =
            img.naturalHeight > CFG.TILE_MAX_H
              ? await ApiAdapter.translateImageTiled(blob, img.naturalWidth, img.naturalHeight, img)
              : await ApiAdapter.translateImage(await buildStitchedBlob(img, blob));
          await Cache.set(hash, targetLang, engine, result);
        }
        if (urlCacheable) await Cache.setUrlHash(url, hash);
      }
```

(Everything after this — the dedup filter, `computeRegionComplexity`, `OverlayRenderer.render` — is UNCHANGED. It uses only `img` and `result.regions`, never `blob`/`hash`, so moving those into the slow-path block is safe. Verify this when editing.)

- [ ] **Step 3: Store URL→hash in `prefetchHitomiGallery`**

Find (in `prefetchHitomiGallery`):
```javascript
        const blob = await downloadBlobFromUrl(url);
        const hash = await Cache.hashBlob(blob);
        const cached = await Cache.get(hash, targetLang, engine);
        if (!cached) {
          const result = await ApiAdapter.translateImage(blob);
          await Cache.set(hash, targetLang, engine, result);
        }
```

Replace with (adds the URL index so navigating to a prefetched page hits the fast-path):
```javascript
        const blob = await downloadBlobFromUrl(url);
        const hash = await Cache.hashBlob(blob);
        const cached = await Cache.get(hash, targetLang, engine);
        if (!cached) {
          const result = await ApiAdapter.translateImage(blob);
          await Cache.set(hash, targetLang, engine, result);
        }
        await Cache.setUrlHash(url, hash);
```

- [ ] **Step 4: Verify no syntax errors**

Run: `node --check extension/content-script/content.js`
Expected: no output (exit code 0).

- [ ] **Step 5: Static self-check**

Confirm by reading the diff: nothing after the cache block references `blob` or `hash` (so scoping them to the slow path is safe); the fast-path uses `Cache.get(hash, targetLang, engine)` so language/engine correctness holds; `blob:`/`data:` URLs skip the URL map. State that live browser verification (Step 6) is deferred to the human.

- [ ] **Step 6: Manual browser verification (HUMAN — deferred, document in report)**

On `https://hitomi.la/reader/4009730.html` and one webtoon site:
1. Reload the extension, F5.
2. Enable eager, translate; let a few pages get translated/prefetched.
3. Navigate to an already-translated page → overlay appears near-instantly (no ~3.4s stall). (Optionally re-add a timing log to confirm the download step is skipped.)
4. Navigate to a not-yet-translated page → the slow path (download + backend) still works.
5. Change target language in the popup, re-translate the same page → confirm it does NOT show the old language (fast path falls through to a fresh translation for the new lang).
6. Confirm no regression on a normal site (first visit downloads+translates; revisit is fast).

- [ ] **Step 7: Commit**

```bash
git add extension/content-script/content.js
git commit -m "Add URL->hash cache index: skip image re-download on cache hit"
```

---

## Self-Review

- **Spec coverage:** §3.1 Cache members → Step 1. §3.2 translateAndRenderImage fast-path → Step 2. §3.3 prefetch setUrlHash → Step 3. §4 limitations (blob/data skip, lang correctness, CACHE_VERSION in key) → in code + constraints. §5 testing → Step 6.
- **Placeholder scan:** none.
- **Type consistency:** `getHashByUrl` returns string|null; `setUrlHash(url, hash)` void; `_urlKey(url)` string. Names consistent across Steps 1-3.
