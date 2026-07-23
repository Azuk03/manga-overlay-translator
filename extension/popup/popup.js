// ===== Khoi 1: Dich trang nay =====
document.getElementById('btn-translate').addEventListener('click', () => {
  const statusEl = document.getElementById('translate-status');
  statusEl.textContent = '';
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) {
      statusEl.textContent = 'Khong tim thay tab dang mo.';
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_TRANSLATE' }, () => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = 'Khong dich duoc trang nay.';
        return;
      }
      statusEl.textContent = 'Da bat dau dich!';
    });
  });
});

// ===== Khoi 2 + 3: URL backend + Test ket noi =====
const DEFAULT_BACKEND_URL = 'http://127.0.0.1:5003';
const urlInput = document.getElementById('backend-url');

chrome.storage.local.get('mot_backend_url', (result) => {
  urlInput.value = result.mot_backend_url || DEFAULT_BACKEND_URL;
});

document.getElementById('btn-save-url').addEventListener('click', () => {
  const value = urlInput.value.trim();
  if (!value) return;
  chrome.storage.local.set({ mot_backend_url: value }, () => {
    document.getElementById('connection-status').textContent = 'Da luu.';
  });
});

document.getElementById('btn-test-connection').addEventListener('click', async () => {
  const statusEl = document.getElementById('connection-status');
  const value = urlInput.value.trim();
  if (!value) {
    statusEl.textContent = 'Chua nhap URL.';
    return;
  }
  statusEl.textContent = 'Dang kiem tra...';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${value}/openapi.json`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      statusEl.textContent = '✅ Ket noi OK';
    } else {
      statusEl.textContent = `❌ Khong ket noi duoc: HTTP ${res.status}`;
    }
  } catch (err) {
    clearTimeout(timeoutId);
    const reason = err.name === 'AbortError' ? 'timeout (5s)' : err.message;
    statusEl.textContent = `❌ Khong ket noi duoc: ${reason}`;
  }
});
