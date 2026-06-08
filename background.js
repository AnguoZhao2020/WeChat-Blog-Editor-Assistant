let currentState = false;

function setIcon(isHtmlMode) {
  const iconPath = isHtmlMode ? 'icons/editor_on.png' : 'icons/editor_off.png';
  chrome.action.setIcon({ path: { 16: iconPath } });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'updateState') {
    currentState = message.isOpen;
    setIcon(currentState);
    sendResponse({ success: true });
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.url && tab.url.includes('mp.weixin.qq.com/cgi-bin/appmsg')) {
    chrome.tabs.sendMessage(tab.id, { type: 'toggleFullscreenEditor' });
  }
});

setIcon(false);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'updateState') {
    currentState = message.isOpen;
    setIcon(currentState);
    sendResponse({ success: true });
  }
  // 新增：打开选项页
  if (message.type === 'openOptionsPage') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    sendResponse({ success: true });
  }
});