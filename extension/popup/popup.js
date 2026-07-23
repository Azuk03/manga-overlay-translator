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
  // Cat dau '/' cuoi - spec muc 4 yeu cau URL luu khong co dau '/' o cuoi
  // (tranh double-slash khi background.js noi them "/translate/json/stream").
  const value = urlInput.value.trim().replace(/\/+$/, '');
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

// ===== Khoi 5b: Ngon ngu dich =====
const DEFAULT_TARGET_LANG = 'VIN';
const langSelect = document.getElementById('target-lang');
const langWarning = document.getElementById('lang-warning');

function updateLangWarning() {
  langWarning.style.display = langSelect.value === 'VIN' ? 'none' : 'block';
}

chrome.storage.local.get('mot_target_lang', (result) => {
  langSelect.value = result.mot_target_lang || DEFAULT_TARGET_LANG;
  updateLangWarning();
});

langSelect.addEventListener('change', () => {
  chrome.storage.local.set({ mot_target_lang: langSelect.value });
  updateLangWarning();
});
