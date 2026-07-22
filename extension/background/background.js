console.log('[MOT-BG] Service worker da khoi dong.');

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:5003';

// Doc URL backend tu chrome.storage.local moi lan goi (khong cache vao bien
// co dinh) de doi URL trong popup (Task 4) co tac dung ngay lap tuc, khong
// can cho service worker khoi dong lai (xem spec muc 4).
async function getBackendUrl() {
  const result = await chrome.storage.local.get('mot_backend_url');
  return result.mot_backend_url || DEFAULT_BACKEND_URL;
}

// Chuyen ArrayBuffer sang chuoi base64, chia nho theo chunk de tranh tran
// call stack cua String.fromCharCode.apply() tren anh lon (anh manga co the
// vai tram KB den vai MB).
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // 32KB moi chunk - tranh "Maximum call stack size exceeded" tren anh lon
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Ham dung chung: doc arrayBuffer + content-type tu 1 Response, dong goi
// thanh dang truyen qua chrome.runtime message duoc. QUAN TRONG: ArrayBuffer
// KHONG duoc bao toan dang tin cay qua chrome.runtime.sendMessage/sendResponse
// trong Manifest V3 (khac window.postMessage dung structured clone day du) -
// da xac nhan bang test that (xem docs/superpowers/sdd/task-10-fix-report.md).
// Vi vay phai chuyen sang chuoi base64 truoc khi gui qua message channel.
async function responseToPayload(res) {
  const contentType = res.headers.get('content-type') || '';
  const arrayBuffer = await res.arrayBuffer();
  const base64 = arrayBufferToBase64(arrayBuffer);
  return { contentType, base64 };
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
  let relayRes;
  try {
    relayRes = await fetch(`${await getBackendUrl()}/fetch-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, referer: refererUrl }),
    });
  } catch (err) {
    throw new Error('Khong goi duoc backend de relay anh (backend chua bat?): ' + url);
  }
  if (!relayRes.ok) {
    const detail = await relayRes.text();
    throw new Error(`CDN tra ve khong phai anh, ca fetch thang lan relay qua backend deu that bai: ${detail}`);
  }
  return responseToPayload(relayRes);
}

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
    res = await fetch(`${await getBackendUrl()}/translate/json/stream`, {
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    console.log('[MOT-BG] Nhan PING tu content-script, tab:', sender.tab && sender.tab.url);
    sendResponse({ type: 'PONG' });
    return true;
  }

  if (message.type === 'DOWNLOAD_IMAGE') {
    const refererUrl = sender.tab ? sender.tab.url : '';
    downloadImage(message.url, refererUrl)
      .then((payload) => sendResponse({ ok: true, contentType: payload.contentType, base64: payload.base64 }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // giu message channel mo cho sendResponse bat dong bo
  }

  if (message.type === 'TRANSLATE') {
    translate(message.body)
      .then((result) => sendResponse({ ok: true, regions: result.regions }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
