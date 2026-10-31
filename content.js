/**
 * AI 聊天内容打印助手 - 内容脚本
 * 
 * 功能：
 *   1. 自动检测当前页面是否为已知 AI 聊天站点
 *   2. 注入悬浮打印按钮
 *   3. 提取聊天内容，构建打印用 HTML
 *   4. 直接在新窗口打开打印预览（绕过 Service Worker 的 blob/data URI 限制）
 */
(function () {
  'use strict';

  // ==================== 状态管理 ====================
  let isInitialized = false;
  let floatBtn = null;
  let siteConfig = null;
  let retryCount = 0;
  const MAX_RETRIES = 5;

  // ==================== i18n 快捷函数 ====================
  function i18n(key, ...args) {
    try {
      const msg = chrome.i18n.getMessage(key, args);
      return msg || key;
    } catch (e) {
      return key;
    }
  }

  // ==================== 初始化 ====================
  function init() {
    if (isInitialized) return;

    try {
      const hostname = window.location.hostname;
      siteConfig = findSiteConfig(hostname);

      console.log('[AI打印助手] 初始化, 站点:', siteConfig ? siteConfig.name : '未知(使用通用检测)');

      injectFloatButton();

      if (!siteConfig) {
        scheduleRetry();
      }

      isInitialized = true;

      // 监听 URL 变化（SPA 导航）
      let lastUrl = location.href;
      new MutationObserver(() => {
        if (location.href !== lastUrl) {
          lastUrl = location.href;
          retryCount = 0;
          setTimeout(() => {
            siteConfig = findSiteConfig(window.location.hostname);
          }, 1500);
        }
      }).observe(document, { subtree: true, childList: true });
    } catch (err) {
      console.error('[AI打印助手] 初始化失败:', err);
    }
  }

  function scheduleRetry() {
    if (retryCount >= MAX_RETRIES) return;
    retryCount++;
    setTimeout(() => {
      siteConfig = findSiteConfig(window.location.hostname);
      if (!siteConfig) {
        scheduleRetry();
      }
    }, retryCount * 2000);
  }

  // ==================== 注入悬浮按钮 ====================
  function injectFloatButton() {
    if (document.getElementById('ai-print-float-btn')) return;

    floatBtn = document.createElement('div');
    floatBtn.id = 'ai-print-float-btn';
    floatBtn.title = i18n('floatBtnTooltip');
    floatBtn.innerHTML = '🖨️';
    floatBtn.style.cssText = `
      position: fixed !important;
      bottom: 24px !important;
      right: 24px !important;
      z-index: 2147483647 !important;
      width: 52px !important;
      height: 52px !important;
      border-radius: 50% !important;
      background: #1a73e8 !important;
      color: #fff !important;
      font-size: 22px !important;
      line-height: 52px !important;
      text-align: center !important;
      cursor: pointer !important;
      box-shadow: 0 4px 14px rgba(26, 115, 232, 0.4) !important;
      border: none !important;
      user-select: none !important;
      transition: transform 0.2s, box-shadow 0.2s !important;
      font-family: system-ui, -apple-system, sans-serif !important;
    `;

    floatBtn.addEventListener('mouseenter', () => {
      floatBtn.style.transform = 'scale(1.1)';
      floatBtn.style.boxShadow = '0 6px 20px rgba(26, 115, 232, 0.5)';
    });
    floatBtn.addEventListener('mouseleave', () => {
      floatBtn.style.transform = 'scale(1)';
      floatBtn.style.boxShadow = '0 4px 14px rgba(26, 115, 232, 0.4)';
    });

    floatBtn.addEventListener('click', onPrintClick);

    document.body.appendChild(floatBtn);

    // Tooltip
    const tooltip = document.createElement('div');
    tooltip.id = 'ai-print-tooltip';
    tooltip.textContent = i18n('floatBtnTooltip');
    tooltip.style.cssText = `
      position: fixed !important;
      bottom: 80px !important;
      right: 24px !important;
      z-index: 2147483647 !important;
      background: rgba(0,0,0,0.8) !important;
      color: #fff !important;
      padding: 6px 12px !important;
      border-radius: 6px !important;
      font-size: 13px !important;
      opacity: 0 !important;
      transition: opacity 0.3s !important;
      pointer-events: none !important;
      font-family: system-ui, -apple-system, sans-serif !important;
      white-space: nowrap !important;
    `;
    document.body.appendChild(tooltip);

    floatBtn.addEventListener('mouseenter', () => {
      const t = document.getElementById('ai-print-tooltip');
      if (t) t.style.opacity = '1';
    });
    floatBtn.addEventListener('mouseleave', () => {
      const t = document.getElementById('ai-print-tooltip');
      if (t) t.style.opacity = '0';
    });
  }

  // ==================== 点击打印按钮（核心逻辑） ====================
  async function onPrintClick() {
    // 显示加载状态
    floatBtn.textContent = '⏳';
    floatBtn.style.pointerEvents = 'none';

    try {
      const html = await extractAndBuildHtml();
      openPrintWindow(html);
    } catch (err) {
      if (err && err.message === 'NO_CONTENT') {
        console.warn('[AI打印助手] 未检测到聊天内容');
        showMessage(i18n('noContentDetected'));
      } else {
        console.error('[AI打印助手] 提取内容失败:', err);
        showMessage(i18n('extractError', err.message));
      }
    } finally {
      floatBtn.textContent = '🖨️';
      floatBtn.style.pointerEvents = 'auto';
    }
  }

  /**
   * 提取聊天内容并构建打印 HTML
   * 抛出 message === 'NO_CONTENT' 的错误表示未检测到聊天内容
   */
  async function extractAndBuildHtml() {
    // 等待动态内容渲染（SPA 页面）
    await waitForContent();

    const config = siteConfig || findSiteConfig(window.location.hostname);
    console.log('[AI打印助手] 开始提取, 站点:', config ? config.name : '通用检测');

    // 懒加载站点（如 Google AI 模式）：先滚动加载完整会话再提取
    if (config && typeof config.hydrate === 'function') {
      try {
        await config.hydrate();
      } catch (e) {
        console.warn('[AI打印助手] 滚动加载失败，按当前已加载内容提取:', e);
      }
    }

    const result = config
      ? extractChatContentKnown(config)
      : extractChatContentGeneric();

    if (!result || result.messages.length === 0) {
      const err = new Error('NO_CONTENT');
      err.message = 'NO_CONTENT';
      throw err;
    }

    console.log('[AI打印助手] 提取到 ' + result.messages.length + ' 条消息');
    return buildPrintHtml(result);
  }

  // ==================== 消息接口（供 popup 调用） ====================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return;
    if (message.action === 'extractChat') {
      // popup 有用户手势，由 popup 自己打开打印窗口更可靠
      extractAndBuildHtml()
        .then(html => sendResponse({ success: true, html: html }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true; // 异步响应
    }
    if (message.action === 'printNow') {
      onPrintClick();
      sendResponse({ success: true });
    }
  });

  /**
   * 在新窗口打开打印内容
   * 使用 window.open + document.write 方案
   * 优点：
   *   - 不依赖 Service Worker（避免 blob URL 限制）
   *   - 无消息大小限制（直接写入 DOM）
   *   - 无 data URI 长度限制
   *   - 用户点击触发，不会被弹窗拦截
   */
  /**
   * 打开打印预览
   * 统一交给 background 在新标签页打开扩展打印页（print.html）：
   *   - 不受聊天页 CSP 限制（document.write 内联内容会被拦截）
   *   - 不受弹窗拦截影响
   */
  function openPrintWindow(htmlContent) {
    try {
      chrome.runtime.sendMessage({ action: 'openPrintView', html: htmlContent }, () => {
        if (chrome.runtime.lastError) {
          console.error('[AI打印助手] 打开预览失败:', chrome.runtime.lastError.message);
          showMessage('打开打印预览失败，请重试');
        }
      });
    } catch (e) {
      console.error('[AI打印助手] 打开预览失败:', e);
      showMessage('打开打印预览失败: ' + e.message);
    }
  }

  // ==================== 等待页面内容加载 ====================
  function waitForContent() {
    return new Promise((resolve) => {
      const bodyText = document.body?.textContent || '';
      if (bodyText.trim().length > 500) {
        resolve();
        return;
      }
      let waited = 0;
      const interval = setInterval(() => {
        waited += 500;
        const text = document.body?.textContent || '';
        if (text.trim().length > 500 || waited >= 5000) {
          clearInterval(interval);
          resolve();
        }
      }, 500);
    });
  }

  // ==================== 已知站点内容提取 ====================
  function extractChatContentKnown(config) {
    let container = null;
    const selectors = config.containerSelector || [];

    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim().length > 50) {
          container = el;
          console.log('[AI打印助手] 容器选择器命中:', sel.substring(0, 50));
          break;
        }
      } catch (e) {
        // 选择器可能不合法
      }
    }

    if (!container) {
      // 检查是否有 customContainerFinder
      if (typeof config.customContainerFinder === 'function') {
        console.log('[AI打印助手] 使用 customContainerFinder');
        container = config.customContainerFinder();
      }
    }

    if (!container) {
      console.log('[AI打印助手] 使用通用降级检测容器');
      container = detectChatContainerGeneric();
    }

    if (!container) {
      console.warn('[AI打印助手] 未找到聊天容器');
      return { siteName: config.name, messages: [] };
    }

    const messageElements = extractMessagesFromContainer(container, config);

    let messages = [];
    if (messageElements.length > 0) {
      // 判断返回的是 DOM 元素还是 {role, html} 对象（customExtract 返回对象）
      const isCustom = typeof messageElements[0] === 'object' &&
                       'role' in messageElements[0] &&
                       'html' in messageElements[0];

      if (isCustom) {
        // customExtract 已经返回了处理好的 {role, html}
        messages = messageElements;
      } else {
        // 普通提取：从 DOM 元素中提取
        messages = messageElements.map(el => ({
          role: config.roleSelector ? config.roleSelector(el) : 'unknown',
          html: sanitizeMessageHtml(el, config.stripSelectors)
        }));
      }
    }

    console.log('[AI打印助手] 提取完成:', config.name, messages.length, '条消息');
    return { siteName: config.name, messages: messages };
  }

  // ==================== 通用降级内容提取 ====================
  function extractChatContentGeneric() {
    const container = detectChatContainerGeneric();
    if (!container) {
      return { siteName: i18n('otherSitesLabel'), messages: [] };
    }

    const items = extractMessagesGeneric(container);
    const messages = items.map(el => ({
      role: 'unknown',
      html: sanitizeMessageHtml(el, [
        'button', 'svg', '[role="button"]',
        'nav', 'form', 'textarea', 'input',
        'header', 'footer', 'aside'
      ])
    }));

    return { siteName: i18n('otherSitesLabel'), messages: messages };
  }

  // ==================== HTML 清洗 ====================
  function sanitizeMessageHtml(element, stripSelectors) {
    const clone = element.cloneNode(true);

    if (stripSelectors && stripSelectors.length > 0) {
      for (const sel of stripSelectors) {
        try {
          clone.querySelectorAll(sel).forEach(el => {
            const tag = el.tagName.toLowerCase();
            if (['img', 'br', 'hr', 'wbr'].includes(tag)) return;
            el.remove();
          });
        } catch (e) {
          // 忽略无效选择器
        }
      }
    }

    clone.querySelectorAll('[hidden], [aria-hidden="true"]').forEach(el => el.remove());
    clone.querySelectorAll('[style*="display:none"], [style*="display: none"]').forEach(el => el.remove());

    clone.querySelectorAll('*').forEach(el => {
      for (const attr of Array.from(el.attributes)) {
        if (/^on/i.test(attr.name)) {
          el.removeAttribute(attr.name);
        }
      }
    });

    return clone.innerHTML;
  }

  // ==================== 构建打印 HTML ====================
  function buildPrintHtml(result) {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const roleUser = i18n('roleUser');
    const roleAssistant = i18n('roleAssistant');
    const roleMessage = i18n('roleMessage');
    const msgCount = i18n('msgCount', String(result.messages.length));
    const btnPrintDoc = i18n('btnPrintDoc');
    const previewTitle = i18n('previewTitle');
    const printFooter = i18n('printFooter', dateStr);

    const messagesHtml = result.messages.map((msg, i) => {
      let roleLabel = msg.role === 'user' ? roleUser : msg.role === 'assistant' ? roleAssistant : roleMessage;
      return `
        <div class="message ${msg.role}">
          <div class="message-header">
            <span class="message-role ${msg.role}">${roleLabel}</span>
            <span class="message-index">#${i + 1}</span>
          </div>
          <div class="message-body">${msg.html}</div>
        </div>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${previewTitle} - ${result.siteName}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", sans-serif;
      background: #f5f5f5; color: #1a1a1a; line-height: 1.7; font-size: 14px;
    }
    .print-toolbar {
      position: sticky; top: 0; z-index: 100;
      background: #fff; border-bottom: 1px solid #e0e0e0;
      padding: 12px 24px;
      display: flex; align-items: center; justify-content: space-between;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }
    .print-toolbar .info { font-size: 13px; color: #666; }
    .print-toolbar .info strong { color: #1a73e8; }
    .btn-print {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 10px 24px; background: #1a73e8; color: #fff;
      border: none; border-radius: 8px; font-size: 15px; font-weight: 500;
      cursor: pointer; transition: background 0.2s;
    }
    .btn-print:hover { background: #1557b0; }
    .chat-container { max-width: 860px; margin: 24px auto; padding: 0 24px; }
    .message {
      background: #fff; border-radius: 12px; padding: 20px 24px;
      margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      page-break-inside: avoid;
    }
    .message.user { border-left: 4px solid #1a73e8; }
    .message.assistant { border-left: 4px solid #34a853; }
    .message.unknown { border-left: 4px solid #9e9e9e; }
    .message-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #f0f0f0;
    }
    .message-role {
      font-weight: 600; font-size: 13px; padding: 2px 10px; border-radius: 4px;
    }
    .message-role.user { color: #1a73e8; background: #e8f0fe; }
    .message-role.assistant { color: #1e7e34; background: #e6f4ea; }
    .message-role.unknown { color: #616161; background: #f5f5f5; }
    .message-index { font-size: 11px; color: #bdbdbd; }
    .message-body { font-size: 14px; color: #333; }
    .message-body p { margin-bottom: 8px; }
    .message-body p:last-child { margin-bottom: 0; }
    .message-body pre {
      background: #f8f9fa; border: 1px solid #e8e8e8; border-radius: 8px;
      padding: 16px; margin: 12px 0; overflow-x: auto;
      font-family: "SF Mono", "Fira Code", "Fira Mono", "Roboto Mono", "Consolas", monospace;
      font-size: 13px; line-height: 1.5; page-break-inside: avoid;
      white-space: pre-wrap; word-break: break-all;
    }
    .message-body code {
      font-family: "SF Mono", "Fira Code", "Roboto Mono", "Consolas", monospace;
      font-size: 13px; background: #f0f0f0; padding: 2px 6px; border-radius: 4px;
    }
    .message-body pre code { background: none; padding: 0; border-radius: 0; }
    .message-body table { border-collapse: collapse; width: 100%; margin: 12px 0; page-break-inside: avoid; }
    .message-body th, .message-body td { border: 1px solid #e0e0e0; padding: 8px 12px; text-align: left; }
    .message-body th { background: #f5f5f5; font-weight: 600; }
    .message-body ul, .message-body ol { padding-left: 24px; margin: 8px 0; }
    .message-body li { margin-bottom: 4px; }
    .message-body blockquote {
      border-left: 3px solid #1a73e8; padding: 8px 16px; margin: 12px 0;
      background: #f8f9fa; border-radius: 0 8px 8px 0; color: #555;
    }
    .message-body img { max-width: 100%; height: auto; border-radius: 8px; margin: 8px 0; page-break-inside: avoid; }
    .print-footer { text-align: center; padding: 24px; color: #9e9e9e; font-size: 12px; }

    @media print {
      body { background: #fff; }
      .print-toolbar { display: none !important; }
      .chat-container { max-width: 100%; margin: 0; padding: 0; }
      .message {
        background: #fff; box-shadow: none; border: none;
        border-left: 4px solid #1a73e8 !important;
        padding: 12px 16px; margin-bottom: 12px; border-radius: 0;
      }
      .message pre { background: #f5f5f5 !important; border: 1px solid #ddd !important; }
      .message pre, .message code {
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }
      .message-header .message-index { display: none; }
      .print-footer { display: none; }
      @page { margin: 1.5cm 1.8cm; }
    }
  </style>
</head>
<body>
  <div class="print-toolbar">
    <div class="info">
      🌐 <strong>${result.siteName}</strong> · ${dateStr} ${timeStr} · ${msgCount}
    </div>
    <button class="btn-print" type="button">${btnPrintDoc}</button>
  </div>
  <div class="chat-container">${messagesHtml}</div>
  <div class="print-footer">${printFooter}</div>
</body>
</html>`;
  }

  /**
   * 给打印窗口挂接打印事件（备用：仅当内容经 window.open 写入时使用；
   * 当前统一走扩展打印页，事件在 print.js 中挂接）
   */
  function attachPrintHandlers(win) {
    try {
      const doc = win.document;
      const btn = doc.querySelector('.btn-print');
      if (btn) {
        btn.addEventListener('click', () => win.print());
      }
      doc.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
          e.preventDefault();
          win.print();
        }
      });
    } catch (e) {
      // 跨域等场景下无法挂接，忽略（浏览器 Ctrl+P 仍可用）
    }
  }

  // ==================== 提示消息 ====================
  function showMessage(text) {
    const old = document.getElementById('ai-print-message');
    if (old) old.remove();

    const msg = document.createElement('div');
    msg.id = 'ai-print-message';
    msg.textContent = text;
    msg.style.cssText = `
      position: fixed !important;
      bottom: 90px !important;
      right: 24px !important;
      z-index: 2147483647 !important;
      background: #fff3cd !important;
      color: #856404 !important;
      padding: 12px 20px !important;
      border-radius: 8px !important;
      font-size: 14px !important;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
      border: 1px solid #ffeeba !important;
      font-family: system-ui, -apple-system, sans-serif !important;
      max-width: 420px !important;
      word-break: break-word !important;
    `;
    document.body.appendChild(msg);
    setTimeout(() => { if (msg.parentNode) msg.remove(); }, 5000);
  }

  // ==================== 启动 ====================
  if (document.readyState === 'complete') {
    setTimeout(init, 500);
  } else {
    window.addEventListener('load', () => setTimeout(init, 500));
  }
  setTimeout(() => {
    if (!isInitialized) init();
  }, 3000);
})();
