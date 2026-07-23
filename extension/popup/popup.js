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
