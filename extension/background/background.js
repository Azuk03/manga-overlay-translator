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
