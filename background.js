/**
 * AI 聊天内容打印助手 - Background Service Worker
 *
 * 职责：
 *   1. 接收 content script / popup 发送的打印 HTML
 *   2. 在新标签页打开扩展自己的打印页（print.html），不受页面 CSP 与弹窗拦截影响
 *   3. 打印页通过 getPrintHtml 取回内容并渲染
 */

// 待打印的 HTML（打印页加载后取用）
let pendingPrintHtml = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    sendResponse({ success: false, error: 'Bad message' });
    return true;
  }
  switch (message.action) {
    case 'openPrintView':
      pendingPrintHtml = message.html;
      chrome.tabs.create({
        url: chrome.runtime.getURL('print.html'),
        active: true
      }, (tab) => {
        if (chrome.runtime.lastError) {
          console.error('[AI打印助手] 打开预览失败:', chrome.runtime.lastError.message);
        }
      });
      sendResponse({ success: true });
      break;

    case 'getPrintHtml':
      sendResponse({ success: !!pendingPrintHtml, html: pendingPrintHtml });
      break;

    default:
      sendResponse({ success: false, error: 'Unknown action' });
      break;
  }
  return true;
});

// ==================== 安装事件 ====================
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
  }
});
