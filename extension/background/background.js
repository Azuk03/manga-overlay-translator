console.log('[MOT-BG] Service worker da khoi dong.');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    console.log('[MOT-BG] Nhan PING tu content-script, tab:', sender.tab && sender.tab.url);
    sendResponse({ type: 'PONG' });
    return true;
  }
});
