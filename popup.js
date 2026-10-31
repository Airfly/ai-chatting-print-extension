/**
 * AI 聊天内容打印助手 - Popup 逻辑
 * 
 * 功能：
 *   1. 检测当前页面是否支持
 *   2. 显示支持状态和站点名称
 *   3. 提供"立即打印"按钮
 * 全部文案使用 chrome.i18n 实现多语言
 */

document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  const printBtn = document.getElementById('printNow');
  const statusEl = document.getElementById('status');
  const siteListEl = document.getElementById('siteList');

  // ==================== 本地化文案 ====================
  function i18n(key, ...args) {
    try {
      const msg = chrome.i18n.getMessage(key, args);
      return msg || key;
    } catch (e) {
      return key;
    }
  }

  // 设置所有静态文本
  document.getElementById('popupTitle').textContent = i18n('popupTitle');
  document.getElementById('popupSubtitle').textContent = i18n('popupSubtitle');
  printBtn.textContent = i18n('printNowBtn');
  document.getElementById('usageTitle').textContent = i18n('usageTitle');
  document.getElementById('supportedSitesTitle').textContent = i18n('supportedSitesTitle');
  document.getElementById('usageStep1').textContent = i18n('usageStep1');
  document.getElementById('usageStep2').textContent = i18n('usageStep2');
  document.getElementById('usageStep3').textContent = i18n('usageStep3');
  document.getElementById('usageStep4').innerHTML = i18n('usageStep4');

  // ==================== 渲染站点列表 ====================
  if (typeof CHAT_SITES !== 'undefined') {
    CHAT_SITES.forEach(site => {
      const tag = document.createElement('span');
      tag.className = 'site-tag';
      tag.textContent = site.name;
      siteListEl.appendChild(tag);
    });
  }

  // 添加"其他站点"标签
  const genericTag = document.createElement('span');
  genericTag.className = 'site-tag generic';
  genericTag.textContent = i18n('otherSitesLabel');
  siteListEl.appendChild(genericTag);

  // ==================== 检测当前页面 ====================
  statusEl.textContent = i18n('statusDetecting');

  async function detectCurrentPage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) {
        statusEl.textContent = i18n('statusSystemPage');
        statusEl.className = 'status not-detected';
        printBtn.disabled = true;
        return;
      }

      const hostname = new URL(tab.url).hostname;

      // 判断是否在已知站点列表
      const matchedSite = CHAT_SITES.find(site =>
        site.hostnames.some(h => hostname.includes(h))
      );

      if (matchedSite) {
        statusEl.innerHTML = i18n('statusDetected', matchedSite.name).replace('\n', '<br>');
        statusEl.className = 'status detected';
        printBtn.disabled = false;
      } else {
        // 检测页面是否有内容
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const bodyText = document.body?.textContent || '';
              return { hasContent: bodyText.length > 500 };
            }
          });

          if (results && results[0]?.result?.hasContent) {
            statusEl.innerHTML = i18n('statusGeneric').replace('\n', '<br>');
            statusEl.className = 'status';
            printBtn.disabled = false;
          } else {
            statusEl.textContent = i18n('statusNotChat');
            statusEl.className = 'status not-detected';
            printBtn.disabled = true;
          }
        } catch (err) {
          statusEl.textContent = i18n('statusCannotAccess');
          statusEl.className = 'status not-detected';
          printBtn.disabled = true;
        }
      }
    } catch (err) {
      statusEl.textContent = i18n('statusDetectionFailed', err.message).replace('\n', '<br>');
      statusEl.className = 'status not-detected';
      printBtn.disabled = true;
    }
  }

  // ==================== 点击"立即打印" ====================

  /**
   * 通过消息通道请求 content script 提取打印 HTML
   * @returns {object|null} 成功返回响应对象，失败返回 null
   */
  async function tryExtractViaMessage(tabId) {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, { action: 'extractChat' });
      return resp || null;
    } catch (e) {
      console.warn('[AI打印助手] 消息通道不可用:', e.message);
      return null;
    }
  }

  /**
   * 处理提取响应：交给 background 打开扩展打印页
   */
  async function handleExtractResponse(resp) {
    if (resp && resp.success && resp.html) {
      await chrome.runtime.sendMessage({ action: 'openPrintView', html: resp.html });
      return true;
    }
    if (resp && !resp.success) {
      console.error('[AI打印助手] 提取失败:', resp.error);
      alert(i18n('extractError', resp.error || ''));
      return true;
    }
    return false;
  }

  printBtn.addEventListener('click', async function () {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        alert(i18n('statusCannotAccess'));
        return;
      }

      // 首选：通过消息通道让 content script 提取 HTML，
      // 由 popup（仍持有用户手势）打开打印窗口，避免弹窗拦截
      let resp = await tryExtractViaMessage(tab.id);
      if (resp && await handleExtractResponse(resp)) return;

      // 消息通道失败（如扩展重载后页面还是旧脚本）：
      // 重新注入 content script 后再试一次
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['sites.js', 'content.js']
        });
        await new Promise(r => setTimeout(r, 300));
        resp = await tryExtractViaMessage(tab.id);
        if (resp && await handleExtractResponse(resp)) return;
      } catch (e) {
        console.warn('[AI打印助手] 重新注入 content script 失败:', e.message);
      }

      // 最终降级：模拟点击 content script 的悬浮按钮
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const btn = document.getElementById('ai-print-float-btn');
            if (btn) { btn.click(); return true; }
            return false;
          }
        });
      } catch (e) {
        // 如果 content script 还没加载
        alert(i18n('noContentDetected'));
      }
    } catch (err) {
      alert(i18n('statusDetectionFailed', err.message));
    }
  });

  // ==================== 启动 ====================
  detectCurrentPage();
});
