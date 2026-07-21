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
