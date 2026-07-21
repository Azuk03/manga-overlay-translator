# Port userscript sang Chrome/Edge Extension (Manifest V3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển `manga-overlay-translator.user.js` (Tampermonkey userscript) thành 1 Chrome/Edge Extension chuẩn (Manifest V3), giữ nguyên backend Docker hiện có (chỉ thêm 1 endpoint relay nhỏ).

**Architecture:** 2 file JS thuần (không build tooling) — `content-script/content.js` (gần như bê nguyên logic DOM/Queue/OverlayRenderer từ userscript) và `background/background.js` (service worker, lớp trung gian mạng duy nhất: gọi backend, tải ảnh, tự fallback relay khi bị chặn hotlink). Backend thêm 1 route `/fetch-image` (patch `server/main.py`) để tải ảnh hộ kèm `Referer` khi trình duyệt không tự đặt được.

**Tech Stack:** JavaScript thuần (ES2020+, không TypeScript/bundler), Manifest V3 (`chrome.*` API), Python/FastAPI (backend, đã có sẵn `httpx` trong image).

## Global Constraints

- Chỉ Chrome/Edge/Cốc Cốc (Chromium) — không hỗ trợ Firefox.
- Không dùng TypeScript/Vite/bất kỳ bundler nào — file JS thuần, tham chiếu thẳng trong `manifest.json`.
- Không thêm popup UI cấu hình — sửa hằng số `CFG` trong code như hiện tại.
- Không đổi backend pipeline dịch/inpaint, không đổi model — chỉ thêm 1 route hoàn toàn tách biệt.
- Không đăng Chrome Web Store — chỉ phân phối qua GitHub Releases + "Load unpacked" (nằm ngoài phạm vi plan này, không có task đóng gói release).
- `manga-overlay-translator.user.js` giữ nguyên trong repo, không xoá, không sửa thêm sau khi extension ổn định.
- Spec đầy đủ: `docs/superpowers/specs/2026-07-21-browser-extension-port-design.md` — đọc trước khi bắt đầu bất kỳ task nào, đặc biệt mục 5 (luồng dữ liệu) và mục 10 (rủi ro đã biết).
- Không có Playwright/pytest cho phần này — xác minh bằng tay trên Chrome/Edge thật (đã quyết định trong spec mục 11), khớp với cách dự án đã làm cho các phần GUI/Docker khác (xem `docs/superpowers/plans/2026-07-19-distribution-installer-plan.md` Task 5).
- Nguồn logic cần port: `manga-overlay-translator.user.js` (bản hiện tại tại root `manga/`, ~1330 dòng) — copy verbatim đúng như chỉ dẫn từng task, không viết lại từ đầu.

---

### Task 1: Backend — thêm route `/fetch-image` (relay tải ảnh kèm Referer)

**Files:**
- Create: `patches/main.py` (bản ghi đè `/app/server/main.py`, dựa trên bản gốc hiện tại + thêm route mới)
- Modify: `Dockerfile:6-10` (thêm 1 dòng `COPY`)

**Interfaces:**
- Consumes: không phụ thuộc task nào khác.
- Produces: endpoint `POST http://127.0.0.1:5003/fetch-image` nhận JSON `{"url": string, "referer": string | null}`, trả về bytes ảnh thật với `Content-Type` đúng định dạng (hoặc lỗi HTTP 400/502 kèm `detail` là chuỗi mô tả lỗi). Task 3 (background.js) gọi endpoint này.

- [ ] **Step 1: Xác nhận nội dung `server/main.py` hiện tại khớp bản đã khảo sát**

Container backend phải đang chạy (`docker ps` thấy `manga_translator`). Chạy:
```powershell
docker exec manga_translator wc -l /app/server/main.py
```
Kỳ vọng: `401 /app/server/main.py`. Nếu số dòng khác, dừng lại — dump lại toàn bộ file (`docker exec manga_translator cat /app/server/main.py`) và dùng đúng bản thật đó làm nền thay vì bản dưới đây.

- [ ] **Step 2: Tạo `patches/main.py`**

Copy toàn bộ nội dung hiện tại của `/app/server/main.py` (dump được ở Step 1), rồi áp 3 thay đổi sau (không đổi gì khác):

1. Thêm vào khối import ở đầu file (ngay dưới `import asyncio`):
```python
import httpx
from pydantic import BaseModel
```

2. Thêm `Response` vào dòng import fastapi đã có sẵn — đổi dòng:
```python
from fastapi import FastAPI, Request, HTTPException, Header, UploadFile, File, Form
```
thành:
```python
from fastapi import FastAPI, Request, HTTPException, Header, UploadFile, File, Form, Response
```

3. Thêm đoạn sau vào cuối file, ngay TRƯỚC dòng `#todo: restart if crash`:
```python
class FetchImageRequest(BaseModel):
    """Request cho extension: tai ho 1 anh kem header Referer (trinh duyet
    khong tu dat duoc Referer tuy y trong Manifest V3, xem
    docs/superpowers/specs/2026-07-21-browser-extension-port-design.md muc 2/6)."""
    url: str
    referer: str | None = None

@app.post("/fetch-image", tags=["internal-api"])
async def fetch_image(data: FetchImageRequest) -> Response:
    headers = {"Referer": data.referer} if data.referer else {}
    async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
        try:
            resp = await client.get(data.url, headers=headers)
        except httpx.HTTPError as e:
            raise HTTPException(502, detail=f"Khong tai duoc anh: {e}")
    if resp.status_code >= 400:
        raise HTTPException(resp.status_code, detail=f"CDN tra ve loi HTTP {resp.status_code}")
    content_type = resp.headers.get("content-type", "application/octet-stream")
    return Response(content=resp.content, media_type=content_type)

```

File hoàn chỉnh phải có đúng 401 + số dòng thêm vào (khoảng 420 dòng), không thiếu/thừa phần nào khác của bản gốc.

- [ ] **Step 3: Cập nhật `Dockerfile`**

Đọc `Dockerfile` hiện tại (4 dòng COPY: `to_json.py`, `gpt_config-vi.yaml`). Thêm 1 dòng mới vào cuối file:
```dockerfile
# Them route /fetch-image: extension khong tu dat duoc header Referer trong
# Manifest V3 (xem docs/superpowers/specs/2026-07-21-browser-extension-port-design.md
# muc 2/6) - route nay de backend tu tai anh ho kem Referer dung.
COPY patches/main.py /app/server/main.py
```

- [ ] **Step 4: Rebuild image và restart container**

```powershell
docker build -t manga-translator-patched:local .
docker stop manga_translator
```
Sau đó chạy lại `.\run-backend.ps1` (hoặc double-click shortcut) để tạo container mới từ image vừa build (container cũ dùng `--rm`, tự bị xoá khi dừng).

- [ ] **Step 5: Xác minh route hoạt động bằng curl thật**

Dùng đúng 1 ảnh hotlink-protected thật để test Referer có tác dụng — tái sử dụng domain đã biết từ `docs.md`/changelog (`a2.gold-usergeneratedcontent.net`, CDN của hitomi.la, chặn khi không có Referer đúng). Nếu domain đó không còn truy cập được lúc chạy plan, thay bằng bất kỳ URL ảnh hotlink-protected nào còn hoạt động, miễn giữ đúng cấu trúc lệnh dưới:

```powershell
$body = @{ url = "https://a2.gold-usergeneratedcontent.net/PATH_ANH_THAT.avif"; referer = "https://hitomi.la/" } | ConvertTo-Json
Invoke-WebRequest -Uri "http://127.0.0.1:5003/fetch-image" -Method Post -Body $body -ContentType "application/json" -OutFile "$env:TEMP\fetch-image-test.avif"
Get-Item "$env:TEMP\fetch-image-test.avif" | Select-Object Length
```

Kỳ vọng: file tải về có kích thước hợp lý cho 1 ảnh thật (không phải vài trăm byte của trang lỗi). Test đối chứng — bỏ `referer` khỏi `$body` rồi gọi lại, kỳ vọng: HTTP lỗi (400/403/502 tuỳ CDN) vì thiếu Referer đúng, xác nhận route thực sự dùng Referer chứ không phải luôn thành công.

- [ ] **Step 6: Commit**

```bash
git add patches/main.py Dockerfile
git commit -m "Add /fetch-image backend relay endpoint for extension's Referer workaround"
```

---

### Task 2: Extension scaffold — manifest, icon, stub 2 file, xác nhận message-passing qua CSP

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/icons/icon16.png`, `extension/icons/icon32.png`, `extension/icons/icon48.png`, `extension/icons/icon128.png`
- Create: `extension/background/background.js` (stub)
- Create: `extension/content-script/content.js` (stub)

**Interfaces:**
- Consumes: không phụ thuộc task nào khác.
- Produces: khung extension load được, background/content-script đã thông với nhau qua message — Task 3-10 sẽ điền logic thật vào 2 file này.

- [ ] **Step 1: Tạo 4 icon placeholder**

Không cần thiết kế — dùng `System.Drawing` có sẵn trong Windows PowerShell (không cần cài Python/thư viện gì thêm — máy làm việc hiện tại không có Python trên host, chỉ có trong container Docker) để sinh 4 ô vuông màu đặc đơn giản. Chạy trong `manga/` (đảm bảo thư mục `extension/icons/` đã tồn tại trước, tạo bằng `New-Item -ItemType Directory -Force extension/icons` nếu chưa có):

```powershell
Add-Type -AssemblyName System.Drawing
foreach ($size in 16, 32, 48, 128) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::FromArgb(255, 66, 133, 244))
    $g.Dispose()
    $bmp.Save("extension/icons/icon$size.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}
```

Kỳ vọng: 4 file `extension/icons/icon16.png`, `icon32.png`, `icon48.png`, `icon128.png` được tạo, mỗi file là 1 ô vuông đặc màu xanh — nội dung hình ảnh không quan trọng ở bước này (chỉ cần Chrome load được, không lỗi "icon not found").

- [ ] **Step 2: Tạo `extension/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Manga Overlay Translator",
  "version": "1.0.0",
  "description": "Dich chu trong anh manga/webtoon truc tiep tren trang, dung backend AI cuc bo.",
  "icons": {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "permissions": ["storage", "unlimitedStorage"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background/background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content-script/content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png"
    },
    "default_title": "Dich trang nay (Alt+D)"
  }
}
```

- [ ] **Step 3: Tạo stub `extension/background/background.js`**

```javascript
console.log('[MOT-BG] Service worker da khoi dong.');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    console.log('[MOT-BG] Nhan PING tu content-script, tab:', sender.tab && sender.tab.url);
    sendResponse({ type: 'PONG' });
    return true;
  }
});
```

- [ ] **Step 4: Tạo stub `extension/content-script/content.js`**

```javascript
(function () {
  'use strict';
  console.log('[MOT] Content script da nap, dang test message-passing...');
  chrome.runtime.sendMessage({ type: 'PING' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[MOT] Loi message-passing:', chrome.runtime.lastError.message);
      return;
    }
    console.log('[MOT] Nhan phan hoi tu background:', response);
  });
})();
```

- [ ] **Step 5: Load unpacked và xác minh — bao gồm kiểm chứng giả định CSP (mục 10 spec)**

1. Mở `chrome://extensions/`, bật Developer mode, **Load unpacked**, chọn thư mục `extension/`.
2. Mở **1 trang bình thường** (vd `https://example.com`), mở Console (F12) — kỳ vọng thấy `[MOT] Content script da nap...` rồi `[MOT] Nhan phan hoi tu background: {type: 'PONG'}`.
3. Bấm link "service worker" trên card extension trong `chrome://extensions/` để mở Console riêng của background — kỳ vọng thấy `[MOT-BG] Service worker da khoi dong.` và `[MOT-BG] Nhan PING tu content-script, tab: https://example.com/`.
4. **Quan trọng — xác minh giả định CSP:** mở 1 trang có CSP nghiêm ngặt thật (vd `https://mail.google.com` hoặc bất kỳ trang ngân hàng/dịch vụ lớn nào), lặp lại bước 2. Nếu KHÔNG thấy `PONG` (hoặc thấy lỗi `chrome.runtime.lastError`), giả định ở mục 10 của spec sai — dừng plan tại đây, quay lại brainstorm hướng khắc phục trước khi làm tiếp Task 3 trở đi (toàn bộ kiến trúc message-passing phụ thuộc giả định này).

- [ ] **Step 6: Commit**

```bash
git add extension/
git commit -m "Scaffold Manifest V3 extension: manifest, icons, background/content-script stubs"
```

---

### Task 3: `background.js` — tải ảnh (direct fetch + auto-fallback relay)

**Files:**
- Modify: `extension/background/background.js` (thay stub Task 2 bằng bản đầy đủ, giữ nguyên phần PING/PONG để không phá Task 2's test)

**Interfaces:**
- Consumes: endpoint `/fetch-image` (Task 1).
- Produces: message handler `{type: 'DOWNLOAD_IMAGE', url}` → trả về qua `sendResponse({ok: true, arrayBuffer, contentType})` hoặc `{ok: false, error}`. Task 7 (content-script ApiAdapter) gọi message này.

- [ ] **Step 1: Viết đầy đủ `background.js` (thêm handler tải ảnh, giữ PING/PONG)**

```javascript
console.log('[MOT-BG] Service worker da khoi dong.');

const BACKEND_API = 'http://127.0.0.1:5003';

// Ham dung chung: doc arrayBuffer + content-type tu 1 Response, dong goi
// thanh dang truyen qua chrome.runtime message duoc (arrayBuffer serialize
// duoc qua structured clone, khong can chuyen base64 tay).
async function responseToPayload(res) {
  const contentType = res.headers.get('content-type') || '';
  const arrayBuffer = await res.arrayBuffer();
  return { contentType, arrayBuffer };
}

// v0.35 (userscript cu) da xac nhan: CDN chan hotlink tra ve HTML loi thay
// vi anh that khi thieu Referer dung - kiem tra Content-Type de phat hien,
// giu nguyen dieu kien da co trong ApiAdapter.downloadImageBlob() cu.
async function downloadImage(url, refererUrl) {
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error('Khong tai duoc anh goc (fetch loi mang): ' + url);
  }
  if (res.ok) {
    const payload = await responseToPayload(res);
    if (payload.contentType.startsWith('image/')) {
      return payload;
    }
    console.log('[MOT-BG] Fetch thang tra ve khong phai anh (Content-Type:', payload.contentType, ') - thu relay qua backend voi Referer.');
  } else {
    console.log('[MOT-BG] Fetch thang tra ve HTTP', res.status, '- thu relay qua backend voi Referer.');
  }

  // Fallback: backend tu tai kem Referer (xem patches/main.py, Task 1).
  const relayRes = await fetch(`${BACKEND_API}/fetch-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, referer: refererUrl }),
  });
  if (!relayRes.ok) {
    const detail = await relayRes.text();
    throw new Error(`CDN tra ve khong phai anh, ca fetch thang lan relay qua backend deu that bai: ${detail}`);
  }
  return responseToPayload(relayRes);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ type: 'PONG' });
    return true;
  }

  if (message.type === 'DOWNLOAD_IMAGE') {
    const refererUrl = sender.tab ? sender.tab.url : '';
    downloadImage(message.url, refererUrl)
      .then((payload) => sendResponse({ ok: true, contentType: payload.contentType, arrayBuffer: payload.arrayBuffer }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // giu message channel mo cho sendResponse bat dong bo
  }
});
```

- [ ] **Step 2: Reload extension, test thủ công đường fetch thẳng (site bình thường)**

Trong `chrome://extensions/`, bấm nút reload (vòng tròn) trên card extension để nạp lại `background.js` mới. Mở Console của service worker (link "service worker"), dán và chạy trực tiếp (giả lập content-script gửi message — cách nhanh để test background mà chưa cần Task 7):

```javascript
chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
  chrome.runtime.sendMessage({type: 'DOWNLOAD_IMAGE', url: 'https://picsum.photos/400/300'}, (res) => {
    console.log('Ket qua:', res.ok, res.contentType, res.arrayBuffer && res.arrayBuffer.byteLength);
  });
});
```

Kỳ vọng: `Ket qua: true image/jpeg <so byte > 0>`.

- [ ] **Step 3: Test đường fallback relay (site hotlink-protected)**

Đảm bảo backend đã build lại với Task 1 (route `/fetch-image` tồn tại). Trong cùng Console đó, thử URL ảnh hotlink-protected thật (dùng lại domain đã test ở Task 1 Step 5):

```javascript
chrome.runtime.sendMessage({type: 'DOWNLOAD_IMAGE', url: 'https://a2.gold-usergeneratedcontent.net/PATH_ANH_THAT.avif'}, (res) => {
  console.log('Ket qua:', res.ok, res.contentType, res.arrayBuffer && res.arrayBuffer.byteLength);
});
```

Kỳ vọng: log trước đó trong console phải thấy dòng `[MOT-BG] Fetch thang tra ve khong phai anh...` (xác nhận fallback được kích hoạt), rồi `Ket qua: true` với `arrayBuffer.byteLength` hợp lý (không phải vài trăm byte của trang lỗi).

- [ ] **Step 4: Commit**

```bash
git add extension/background/background.js
git commit -m "Add image-download relay to background.js (direct fetch + auto-fallback to backend)"
```

---

### Task 4: `background.js` — gọi backend dịch (`TRANSLATE`)

**Files:**
- Modify: `extension/background/background.js`

**Interfaces:**
- Consumes: `POST http://127.0.0.1:5003/translate/json/stream` (đã có sẵn, không đổi).
- Produces: message handler `{type: 'TRANSLATE', body}` → `{ok: true, regions}` hoặc `{ok: false, error}`. Task 7 gọi message này.

- [ ] **Step 1: Thêm hàm parse frame nhị phân + handler TRANSLATE vào `background.js`**

Thêm vào cuối file (giữ nguyên toàn bộ nội dung Task 3):

```javascript
const TRANSLATE_TIMEOUT_MS = 90000; // khop CFG.TIMEOUT_MS ben content-script

// Port nguyen van tu ApiAdapter.normalizeResponse() cua userscript cu
// (manga-overlay-translator.user.js dong 641-690) - giao thuc frame nhi
// phan cua /translate/json/stream: [1 byte status][4 byte length big-endian][N byte payload].
function normalizeResponse(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  let offset = 0;
  let finalPayload = null;
  let errorPayload = null;

  while (offset < arrayBuffer.byteLength) {
    const status = view.getUint8(offset);
    const length = view.getUint32(offset + 1, false);
    const payloadStart = offset + 5;
    const payload = arrayBuffer.slice(payloadStart, payloadStart + length);

    if (status === 0) {
      finalPayload = payload;
      break;
    }
    if (status === 2) {
      errorPayload = payload;
      break;
    }
    offset = payloadStart + length;
  }

  if (errorPayload) {
    throw new Error('Backend tra loi: ' + new TextDecoder('utf-8').decode(errorPayload));
  }
  if (!finalPayload) {
    throw new Error('Stream ket thuc som, khong co ket qua cuoi');
  }

  const json = JSON.parse(new TextDecoder('utf-8').decode(finalPayload));
  const regions = json.translations.map((t) => ({
    x: t.minX,
    y: t.minY,
    w: t.maxX - t.minX,
    h: t.maxY - t.minY,
    src: t.text.src || '',
    dst: t.text.dst || t.text.src || '',
    background: t.background || null,
  }));

  return { regions };
}

async function translate(body) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${BACKEND_API}/translate/json/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Timeout khi goi backend');
    }
    throw new Error('Backend chua bat? Kiem tra docker ps');
  } finally {
    clearTimeout(timeoutId);
  }
  if (res.status >= 400) {
    throw new Error('HTTP ' + res.status);
  }
  const arrayBuffer = await res.arrayBuffer();
  return normalizeResponse(arrayBuffer);
}
```

- [ ] **Step 2: Đăng ký handler `TRANSLATE` trong listener đã có**

Sửa listener trong `background.js` (thêm nhánh mới, giữ nguyên 2 nhánh `PING`/`DOWNLOAD_IMAGE` đã có ở Task 2/3):

```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ type: 'PONG' });
    return true;
  }

  if (message.type === 'DOWNLOAD_IMAGE') {
    const refererUrl = sender.tab ? sender.tab.url : '';
    downloadImage(message.url, refererUrl)
      .then((payload) => sendResponse({ ok: true, contentType: payload.contentType, arrayBuffer: payload.arrayBuffer }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'TRANSLATE') {
    translate(message.body)
      .then((result) => sendResponse({ ok: true, regions: result.regions }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
```

- [ ] **Step 3: Test thủ công qua Console của service worker**

Đảm bảo backend đang chạy. Trong Console service worker (reload extension trước), dán 1 request dịch thật tối giản (dùng 1 ảnh test nhỏ tự vẽ base64 — dùng đúng payload mẫu ảnh 1x1 trắng để test nhanh kết nối, không cần ảnh manga thật ở bước này):

```javascript
const testBody = JSON.stringify({
  image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  config: { translator: { translator: 'none' }, render: { renderer: 'none' }, inpainter: { inpainter: 'none' } },
});
chrome.runtime.sendMessage({type: 'TRANSLATE', body: testBody}, (res) => {
  console.log('Ket qua dich:', res);
});
```

Kỳ vọng: `res.ok === true`, `res.regions` là mảng (rỗng là hợp lý vì ảnh test 1x1 không có chữ). Nếu `res.ok === false`, đọc `res.error` để chẩn đoán (backend chưa bật? sai định dạng request?) trước khi qua Step 4.

- [ ] **Step 4: Commit**

```bash
git add extension/background/background.js
git commit -m "Add translate-request relay + binary frame parsing to background.js"
```

---

### Task 5: `background.js` — kích hoạt qua icon toolbar

**Files:**
- Modify: `extension/background/background.js`

**Interfaces:**
- Consumes: không phụ thuộc thêm.
- Produces: khi bấm icon extension, gửi message `{type: 'TRIGGER_TRANSLATE'}` cho content-script của tab đang active. Task 10 (content-script) lắng nghe message này.

- [ ] **Step 1: Thêm handler `chrome.action.onClicked` vào `background.js`**

Thêm vào cuối file:

```javascript
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_TRANSLATE' }, () => {
    if (chrome.runtime.lastError) {
      console.log('[MOT-BG] Khong gui duoc TRIGGER_TRANSLATE (content-script chua nap?):', chrome.runtime.lastError.message);
    }
  });
});
```

- [ ] **Step 2: Test thủ công (chưa có content-script lắng nghe — chỉ xác nhận không lỗi)**

Reload extension. Mở 1 trang bất kỳ, bấm icon extension trên toolbar. Mở Console của service worker — kỳ vọng thấy dòng `[MOT-BG] Khong gui duoc TRIGGER_TRANSLATE...` (vì content-script thật của Task 10 chưa tồn tại, chỉ có stub PING ở Task 2) — đây là kết quả ĐÚNG mong đợi ở bước này, xác nhận `chrome.action.onClicked` bắn đúng sự kiện. Sẽ hết log lỗi này sau khi hoàn thành Task 10.

- [ ] **Step 3: Commit**

```bash
git add extension/background/background.js
git commit -m "Add toolbar icon click handler to background.js"
```

---

### Task 6: `content.js` — CFG, ImageFinder, Cache (`chrome.storage.local`), hàm thuần tuý

**Files:**
- Modify: `extension/content-script/content.js` (thay stub Task 2)

**Interfaces:**
- Consumes: không phụ thuộc task nào khác trong content-script.
- Produces: `CFG` (hằng số dùng chung toàn file), `ImageFinder.findCandidates()`/`isCandidate(img)`, `Cache.hashBlob(blob)` (async, không đổi), `Cache.get(hash)`/`Cache.set(hash, value)` (**đổi thành async**, dùng `chrome.storage.local`), `computeRegionComplexity(regions)`, `imageElementToBlob(img)`, `reencodeToPng(blob)`. Task 7-9 dùng các hàm/hằng số này.

- [ ] **Step 1: Viết `content.js` — mở đầu IIFE + CFG + log() + ImageFinder**

Copy nguyên văn từ `manga-overlay-translator.user.js` dòng 244-341 (mở đầu `(function () { 'use strict'; const CFG = {...}` tới hết `ImageFinder`), **bỏ dòng `DEBUG: true,`** trong `CFG` — giữ lại, không đổi gì khác trong khối này. Dán đúng nguyên văn các dòng đó vào đầu `content.js` (thay hoàn toàn nội dung stub cũ).

- [ ] **Step 2: Viết `Cache` — đổi sang `chrome.storage.local` bất đồng bộ**

Thêm ngay sau khối `ImageFinder` (thay thế hoàn toàn bản `GM_getValue`/`GM_setValue` gốc ở dòng 344-373 của userscript cũ — đây là phần DUY NHẤT trong Task này thực sự đổi logic, không phải copy verbatim):

```javascript
  // ===== Cache (hash bytes anh, khong theo URL) =====
  // Khac ban userscript goc: GM_getValue/GM_setValue la dong bo, con
  // chrome.storage.local la bat dong bo - Cache.get()/set() gio la async,
  // moi noi goi chung (translateAndRenderImage, Task 9) phai await.
  const Cache = {
    async hashBlob(blob) {
      const buf = await blob.arrayBuffer();
      if (crypto?.subtle) {
        const h = await crypto.subtle.digest('SHA-256', buf);
        return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
      }
      const u8 = new Uint8Array(buf);
      let h = 0x811c9dc5;
      for (let i = 0; i < u8.length; i++) {
        h ^= u8[i];
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return 'fnv' + h.toString(16) + '_' + u8.length;
    },
    _key(hash) {
      return `mot_cache_v${CFG.CACHE_VERSION}_${hash}`;
    },
    async get(hash) {
      const key = this._key(hash);
      const result = await chrome.storage.local.get(key);
      return result[key] ? JSON.parse(result[key]) : null;
    },
    async set(hash, value) {
      const key = this._key(hash);
      await chrome.storage.local.set({ [key]: JSON.stringify(value) });
    },
  };
```

- [ ] **Step 3: Copy `computeRegionComplexity`, `imageElementToBlob`, `reencodeToPng`**

Copy nguyên văn từ userscript cũ dòng 399-501 (từ `async function computeRegionComplexity(regions) {` tới hết `reencodeToPng`), dán tiếp sau khối `Cache`. Không đổi gì trong 3 hàm này — đều là hàm thuần tuý dùng Canvas/Image API, hoạt động y hệt trong content-script của extension.

- [ ] **Step 4: Đóng file tạm để test được (thêm dòng đóng IIFE tạm thời)**

Thêm tạm 2 dòng cuối file (sẽ bị xoá/thay ở Task 10 khi có `init()` thật):
```javascript
  console.log('[MOT] CFG/ImageFinder/Cache/helpers da nap xong (Task 6).');
})();
```

- [ ] **Step 5: Test thủ công — xác nhận không lỗi cú pháp + Cache hoạt động**

Reload extension trong `chrome://extensions/`. Mở 1 trang bất kỳ, F12 → Console — kỳ vọng thấy `[MOT] CFG/ImageFinder/Cache/helpers da nap xong (Task 6).`, không có lỗi đỏ nào. Test riêng `Cache` (dán trực tiếp vào Console của TAB đó, không phải console của service worker — content-script chạy trong ngữ cảnh trang):

```javascript
// Chay tay de test - khong phai code chinh thuc
(async () => {
  await chrome.storage.local.set({'mot_test_key': 'hello'});
  const r = await chrome.storage.local.get('mot_test_key');
  console.log('Cache storage test:', r.mot_test_key === 'hello' ? 'OK' : 'FAIL');
  await chrome.storage.local.remove('mot_test_key');
})();
```

Kỳ vọng: `Cache storage test: OK`.

- [ ] **Step 6: Commit**

```bash
git add extension/content-script/content.js
git commit -m "Port CFG, ImageFinder, and pure helpers to content.js; migrate Cache to chrome.storage.local"
```

---

### Task 7: `content.js` — `ApiAdapter` qua message-passing

**Files:**
- Modify: `extension/content-script/content.js`

**Interfaces:**
- Consumes: message `DOWNLOAD_IMAGE` (Task 3), message `TRANSLATE` (Task 4).
- Produces: `ApiAdapter.downloadImageBlob(img)`, `ApiAdapter.blobToDataURL(blob)`, `ApiAdapter.translateImage(blob)`, `ApiAdapter.translateImageTiled(blob, naturalW, naturalH)`, `sliceImageIntoTiles`, `iou`, `dedupeRegions`. Task 9 (`translateAndRenderImage`) dùng `ApiAdapter`.

- [ ] **Step 1: Thêm hàm gửi message dạng Promise (helper dùng chung)**

Thêm ngay trước khối `ApiAdapter` (sau các hàm Task 6):

```javascript
  // Boc chrome.runtime.sendMessage (callback-style) thanh Promise, kiem tra
  // chrome.runtime.lastError - tranh loi im lang khi service worker bi tat
  // giua chung (xem docs/superpowers/specs/2026-07-21-browser-extension-port-design.md muc 8).
  function sendMessageAsync(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }
```

- [ ] **Step 2: Viết `ApiAdapter.downloadImageBlob` (thay đường GM_xmlhttpRequest bằng message)**

Thêm khối `ApiAdapter` mới:

```javascript
  // ===== ApiAdapter — NOI DUY NHAT BIET SCHEMA BACKEND =====
  const ApiAdapter = {
    async downloadImageBlob(img) {
      const src = img.currentSrc || img.src;
      if (src.startsWith('blob:') || src.startsWith('data:')) {
        // Khong doi: van doc pixel truc tiep tu <img> da hien thi, khong
        // relay qua background duoc vi du lieu chi ton tai tam thoi phia
        // trinh duyet (xem spec muc 5a diem 1).
        return await imageElementToBlob(img);
      }

      const res = await sendMessageAsync({ type: 'DOWNLOAD_IMAGE', url: src });
      if (!res || !res.ok) {
        throw new Error((res && res.error) || 'Khong tai duoc anh goc: ' + src);
      }
      const rawBlob = new Blob([res.arrayBuffer], { type: res.contentType });
      return await reencodeToPng(rawBlob);
    },

    blobToDataURL(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    },

    async translateImage(blob) {
      const dataUrl = await this.blobToDataURL(blob);
      const body = JSON.stringify({
        image: dataUrl,
        config: {
          translator: {
            translator: CFG.TRANSLATOR,
            target_lang: CFG.TARGET_LANG,
            gpt_config: CFG.GPT_CONFIG_PATH,
          },
          render: { renderer: 'none' },
          inpainter: { inpainter: CFG.INPAINTER, inpainting_size: CFG.INPAINTING_SIZE },
        },
      });

      const res = await sendMessageAsync({ type: 'TRANSLATE', body });
      if (!res || !res.ok) {
        throw new Error((res && res.error) || 'Loi khong xac dinh khi goi backend');
      }
      return { regions: res.regions };
    },

    async translateImageTiled(blob, naturalW, naturalH) {
      const tiles = await sliceImageIntoTiles(blob, naturalW, naturalH);
      log(
        'Webtoon dai (' + naturalH + 'px > TILE_MAX_H ' + CFG.TILE_MAX_H + 'px) - cat thanh',
        tiles.length,
        'lat, chong lan',
        CFG.TILE_OVERLAP,
        'px.'
      );
      const allRegions = [];
      for (const tile of tiles) {
        const result = await this.translateImage(tile.blob);
        for (const r of result.regions) {
          allRegions.push({ ...r, y: r.y + tile.yOffset });
        }
      }
      return { regions: dedupeRegions(allRegions) };
    },
  };
```

Lưu ý: `normalizeResponse()` **không cần port vào content-script** — background (Task 4) đã tự parse frame nhị phân và chỉ trả `{regions}` đã chuẩn hoá qua message.

- [ ] **Step 3: Copy `sliceImageIntoTiles`, `iou`, `dedupeRegions`**

Copy nguyên văn từ userscript cũ dòng 726-772, dán sau khối `ApiAdapter`. Không đổi gì (dùng `createImageBitmap`/canvas thuần, không phụ thuộc GM_*).

- [ ] **Step 4: Test thủ công qua Console của tab (không phải service worker)**

Reload extension. Mở 1 trang có ảnh thật bất kỳ (>400x400px, không phải logo/icon — vd 1 trang tin tức có ảnh minh hoạ lớn), F12 → Console, tìm 1 thẻ `<img>` hợp lệ rồi test tay:

```javascript
// Chay tay de test - khong phai code chinh thuc
const img = document.querySelector('img'); // doi selector neu can, chon dung 1 anh to
ApiAdapter.downloadImageBlob(img).then((blob) => {
  console.log('Tai anh OK, kich thuoc blob:', blob.size, 'type:', blob.type);
}).catch((e) => console.error('Loi:', e));
```

Kỳ vọng: in ra `Tai anh OK, kich thuoc blob: <so byte > 0> type: image/png`.

- [ ] **Step 5: Commit**

```bash
git add extension/content-script/content.js
git commit -m "Port ApiAdapter to content.js using message-passing to background"
```

---

### Task 8: `content.js` — `OverlayRenderer`, vị trí layer, CSS (thay `GM_addStyle`)

**Files:**
- Modify: `extension/content-script/content.js`

**Interfaces:**
- Consumes: không phụ thuộc thêm (dùng `CFG` từ Task 6).
- Produces: `imgLayers` (Map), `positionLayer(img, layer)`, `OverlayRenderer.render(img, regions)`. Task 9 dùng các hàm/biến này.

- [ ] **Step 1: Copy `imgLayers`, `positionLayer`, resize listener, `OverlayRenderer`**

Copy nguyên văn từ userscript cũ dòng 774-1017 (từ `const imgLayers = new Map();` tới hết `OverlayRenderer` object, bao gồm `_measureWrappedHeight`, `_fitFontSize`, `_fitTextboxFont`, `_reshapeForHorizontalText`, `render`), dán vào `content.js` sau khối `ApiAdapter`/tiling helpers của Task 7. Không đổi gì — toàn bộ là DOM/CSS/Canvas thuần, không phụ thuộc GM_*.

- [ ] **Step 2: Thay `GM_addStyle` bằng chèn `<style>` trực tiếp**

Copy nguyên văn nội dung CSS bên trong `GM_addStyle(\`...\`)` ở userscript cũ dòng 1220-1265, nhưng đổi cách chèn (content-script không có `GM_addStyle` — tự chèn `<style>` vào `<head>`, tương đương 1:1):

```javascript
  // Thay GM_addStyle (khong ton tai trong extension) bang chen truc tiep
  // 1 the <style> vao <head> - content-script co toan quyen DOM cua
  // trang nen khong can ham tien ich rieng nhu Tampermonkey.
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .mot-layer { position: absolute; pointer-events: none; }

    .mot-bg {
      position: absolute;
      background-size: 100% 100%;
      background-repeat: no-repeat;
      pointer-events: none;
    }

    .mot-textbox {
      position: absolute;
      display: flex; align-items: center; justify-content: center;
      pointer-events: auto;
      box-sizing: border-box;
    }
    .mot-textbox.mot-busy {
      background: rgba(255, 255, 255, 0.85);
      border-radius: 6px;
      box-shadow: 0 1px 5px rgba(0, 0, 0, 0.45);
    }
    .mot-text {
      width: 100%;
      color: #111;
      font-family: ${CFG.FONT};
      line-height: 1.25;
      text-align: center;
      word-break: keep-all;
      overflow-wrap: normal;
      hyphens: none;
      -webkit-text-stroke: 4px #fff;
      paint-order: stroke fill;
    }
    .mot-overflow { outline: 2px solid red; }
  `;
  document.head.appendChild(styleEl);
```

- [ ] **Step 3: Xoá dòng `console.log` tạm của Task 6, thay bằng log tạm mới**

Sửa 2 dòng cuối file (đã thêm tạm ở Task 6 Step 4):
```javascript
  console.log('[MOT] OverlayRenderer/CSS da nap xong (Task 8).');
})();
```

- [ ] **Step 4: Test thủ công — xác nhận CSS được áp dụng**

Reload extension, mở 1 trang bất kỳ, F12 → Elements, kiểm tra `<head>` có thẻ `<style>` mới chứa `.mot-layer { position: absolute...`. Console không có lỗi cú pháp.

- [ ] **Step 5: Commit**

```bash
git add extension/content-script/content.js
git commit -m "Port OverlayRenderer and layer positioning to content.js; replace GM_addStyle with direct style injection"
```

---

### Task 9: `content.js` — `Queue`, `translateAndRenderImage`, phát hiện ảnh tự động

**Files:**
- Modify: `extension/content-script/content.js`

**Interfaces:**
- Consumes: `ApiAdapter` (Task 7), `OverlayRenderer`/`positionLayer` (Task 8), `Cache` (Task 6, giờ async).
- Produces: `Queue.enqueue(img)`, `state`, `errorLog`, `registerImage(img)`, `watchImages()`, `startAutoMode()`. Task 10 gọi `watchImages()`/`startAutoMode()` từ `init()`.

- [ ] **Step 1: Copy `state`/`errorLog`, viết lại `translateAndRenderImage` (thêm `await` cho Cache)**

Copy `const state = {...}` và `const errorLog = [];` nguyên văn từ dòng 1020-1023 của userscript cũ. Sau đó thêm hàm `translateAndRenderImage` — **giống hệt bản gốc dòng 1025-1088, chỉ khác 2 chỗ đã đánh dấu bằng comment** (thêm `await` trước `Cache.get`/`Cache.set` vì giờ là async):

```javascript
  async function translateAndRenderImage(img) {
    if (imgLayers.has(img)) return;
    const tStart = performance.now();
    try {
      const blob = await ApiAdapter.downloadImageBlob(img);
      const hash = await Cache.hashBlob(blob);
      let result = await Cache.get(hash); // THEM await - Cache gio la async (Task 6)
      if (result) {
        log('Cache HIT:', hash, img.currentSrc || img.src);
      } else {
        log('Cache MISS, goi backend:', hash, img.currentSrc || img.src);
        result =
          img.naturalHeight > CFG.TILE_MAX_H
            ? await ApiAdapter.translateImageTiled(blob, img.naturalWidth, img.naturalHeight)
            : await ApiAdapter.translateImage(blob);
        await Cache.set(hash, result); // THEM await - Cache gio la async (Task 6)
      }
      const busyFlags = await computeRegionComplexity(result.regions);
      result.regions.forEach((r, i) => {
        r.busy = busyFlags[i];
      });
      await OverlayRenderer.render(img, result.regions);
      log('Da ve overlay:', result.regions.length, 'vung chu, tong', (performance.now() - tStart).toFixed(0), 'ms');
      state.done++;
    } catch (err) {
      console.error('[MOT] Loi dich anh:', img.currentSrc || img.src, err);
      state.errors++;
      errorLog.push({ src: img.currentSrc || img.src, message: err.message });
    }
  }
```

(Bản này bỏ các dòng log đo thời gian chi tiết từng bước của `v0.38`/`v0.39` trong bản gốc — đã hoàn thành nhiệm vụ chẩn đoán theo changelog, spec mục 5b đã quyết định không port phần log tiến độ chi tiết này.)

- [ ] **Step 2: Copy `Queue` nguyên văn**

Copy nguyên văn từ userscript cũ dòng 1090-1149 (toàn bộ object `Queue`). Không đổi gì — `Queue` chỉ gọi `translateAndRenderImage(img)` (đã async-hoá ở Step 1), tự nó không đụng `Cache`/GM_* trực tiếp.

- [ ] **Step 3: Copy `registeredImages`/`registerImage`/`watchImages`/`startAutoMode` nguyên văn**

Copy nguyên văn từ userscript cũ dòng 1151-1217. Không đổi gì — `MutationObserver`/`IntersectionObserver` là Web API chuẩn, hoạt động y hệt trong content-script.

- [ ] **Step 4: Thay 2 dòng tạm cuối file (đã thêm ở Task 8 Step 3) bằng bản mới**

```javascript
  console.log('[MOT] Queue/detection da nap xong (Task 9). Goi watchImages() de test.');
  watchImages();
})();
```

- [ ] **Step 5: Test thủ công — xác nhận tự phát hiện + dịch ảnh thật**

Đảm bảo backend đang chạy. Reload extension, mở 1 trang manga/webtoon thật đơn giản (site đã biết hoạt động tốt trước đây, không phải site canvas-tainted). F12 → Console. Vì `startAutoMode()` chưa được gọi (chưa có `init()`/kích hoạt ở Task 10), test tay bằng cách tự gọi:

```javascript
// Chay tay de test - khong phai code chinh thuc, Task 10 se noi day vao init()
startAutoMode();
```

Kỳ vọng: thấy log `Auto mode (C3) da bat dau...`, sau đó (nếu trang có ảnh trong khung nhìn) thấy `Cache MISS, goi backend...` rồi `Da ve overlay: N vung chu...` và chữ dịch tiếng Việt thực sự xuất hiện đè lên ảnh trên trang.

- [ ] **Step 6: Commit**

```bash
git add extension/content-script/content.js
git commit -m "Port Queue, translateAndRenderImage, and auto-detection to content.js"
```

---

### Task 10: `content.js` — kích hoạt (Alt+D/Alt+T, message icon-click), hoàn thiện `init()`

**Files:**
- Modify: `extension/content-script/content.js`

**Interfaces:**
- Consumes: message `TRIGGER_TRANSLATE` (Task 5), toàn bộ hàm từ Task 6-9.
- Produces: extension hoạt động đầy đủ, tương đương 1-1 với userscript cũ (trừ các điểm đã ghi trong spec mục 5/8).

- [ ] **Step 1: Copy `showErrorSummary`, `onTriggerTranslate`, `onKeyDown` (đổi tên biến `autoStarted` giữ nguyên)**

Copy nguyên văn từ userscript cũ dòng 1267-1315 (`let autoStarted = false;` tới hết `onKeyDown`). Không đổi gì — các hàm này không phụ thuộc GM_*.

- [ ] **Step 2: Viết `init()` mới — thay `GM_registerMenuCommand` bằng message listener cho icon-click**

Thay hoàn toàn khối `init()` cũ (dòng 1317-1328 userscript gốc, có `GM_registerMenuCommand(...)`) bằng:

```javascript
  function init() {
    document.addEventListener('keydown', onKeyDown);
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'TRIGGER_TRANSLATE') {
        onTriggerTranslate();
      }
    });
    watchImages();
    log('San sang. Bam icon extension hoac Alt+D de dich, Alt+T de bat/tat overlay.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
```

Xoá 2 dòng log tạm còn sót lại từ Task 9 (`console.log('[MOT] Queue/detection da nap xong...')` và lệnh `watchImages();` gọi tay) — `init()` giờ tự gọi `watchImages()` đúng chỗ, không cần gọi tay nữa.

- [ ] **Step 3: Test thủ công toàn bộ kịch bản (đối chiếu spec mục 11)**

Reload extension. Trên 1 site manga/webtoon thật bình thường:
1. Bấm icon extension trên toolbar — kỳ vọng: dịch bắt đầu tự động (log `Bat dau dich tu dong...`), không còn thấy lỗi `Khong gui duoc TRIGGER_TRANSLATE` trong Console của service worker.
2. Bấm `Alt+D` trên bàn phím (mở tab MỚI, chưa bấm icon) — kỳ vọng: hoạt động y hệt bấm icon.
3. Bấm `Alt+T` — kỳ vọng: toàn bộ overlay ẩn/hiện đúng.
4. F5 lại trang, bấm icon lần nữa — kỳ vọng: log `Cache HIT` cho ảnh đã dịch trước đó, không gọi lại backend.
5. Tắt Docker (`docker stop manga_translator`), thử dịch — kỳ vọng: lỗi được bắt gọn (`errorLog` có entry, không lỗi console tràn lan làm treo trang), bấm dịch lại lần 2 hiện đúng `alert()` tóm tắt lỗi.
6. Thử 1 site có Referer đặc biệt (domain đã dùng ở Task 1/3) — xác nhận dịch được, không bị lỗi CDN chặn hotlink.

- [ ] **Step 4: Commit**

```bash
git add extension/content-script/content.js
git commit -m "Wire up activation (icon-click message, Alt+D/Alt+T) and finalize init()"
```

---

### Task 11: Cập nhật tài liệu — trỏ người dùng sang extension, cảnh báo tắt userscript cũ

**Files:**
- Modify: `docs.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: không có.
- Produces: tài liệu phản ánh đúng trạng thái mới (extension là cách dùng chính, userscript cũ vẫn còn nhưng không khuyến khích).

- [ ] **Step 1: Đọc phần hiện tại của `docs.md`/`README.md` nhắc tới cài Tampermonkey**

Tìm đoạn hướng dẫn cài đặt hiện tại (thường ở đầu `docs.md` hoặc `README.md`, mô tả cài `manga-overlay-translator.user.js` vào Tampermonkey).

- [ ] **Step 2: Thêm đoạn hướng dẫn mới, đặt trước đoạn Tampermonkey cũ**

Thêm đoạn (điều chỉnh vị trí chèn cho khớp văn phong xung quanh khi thực hiện thật, giữ đúng nội dung):

```markdown
## Cài đặt (khuyến nghị: Extension)

1. Mở `chrome://extensions/` (hoặc `edge://extensions/`), bật **Developer mode**.
2. Bấm **Load unpacked**, chọn thư mục `extension/` trong repo này.
3. Bấm icon extension trên toolbar (hoặc Alt+D) để bắt đầu dịch trang đang xem, Alt+T để bật/tắt so sánh gốc/dịch.

**Nếu trước đây đã cài `manga-overlay-translator.user.js` qua Tampermonkey: tắt hoặc gỡ script đó đi** trước khi dùng extension — để cả 2 cùng bật trên 1 trang sẽ khiến cả userscript lẫn extension tự tìm ảnh và dịch song song, tạo ra 2 lớp overlay chồng nhau/dịch trùng.

### Cài đặt cũ qua Tampermonkey (không còn khuyến nghị, giữ lại tham khảo)
```

- [ ] **Step 3: Commit**

```bash
git add docs.md README.md
git commit -m "Point installation docs to the new extension, warn about disabling the old userscript"
```

---

## Final integration check (sau khi xong cả 11 task)

- [ ] Chạy lại toàn bộ 6 kịch bản ở Task 10 Step 3 một lượt cuối, sau khi mọi task đã commit.
- [ ] Xác nhận `manga-overlay-translator.user.js` không bị sửa/xoá trong suốt quá trình (chỉ `docs.md`/`README.md` trỏ sang extension).
- [ ] `git log --oneline` từ commit đầu plan tới cuối — đối chiếu đúng 11 commit (1 cho mỗi task), không commit nào bị bỏ sót bước test trước khi commit.
