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

// 移除原来的切换编辑器逻辑，改为打开选项页
chrome.action.onClicked.addListener((tab) => {
  chrome.runtime.openOptionsPage();
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