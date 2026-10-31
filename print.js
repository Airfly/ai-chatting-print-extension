/**
 * AI 聊天内容打印助手 - 扩展打印页脚本
 *
 * 从 background 获取打印 HTML 并渲染到本页。
 * 使用 DOMParser + adoptNode 方式注入，不执行任何内联脚本，
 * 因此不受扩展页面 CSP 限制，打印事件用 addEventListener 挂接。
 */

chrome.runtime.sendMessage({ action: 'getPrintHtml' }, (resp) => {
  if (chrome.runtime.lastError || !resp || !resp.success || !resp.html) {
    document.body.textContent = '未获取到打印内容，请回到聊天页重新点击打印。';
    return;
  }

  const parsed = new DOMParser().parseFromString(resp.html, 'text/html');

  // 注入样式
  parsed.querySelectorAll('head style').forEach(style => {
    document.head.appendChild(document.adoptNode(style));
  });

  // 标题
  if (parsed.title) document.title = parsed.title;

  // 注入正文
  document.body.innerHTML = '';
  Array.from(parsed.body.childNodes).forEach(node => {
    document.body.appendChild(document.adoptNode(node));
  });

  // 挂接打印事件（无内联脚本，不受 CSP 限制）
  const btn = document.querySelector('.btn-print');
  if (btn) {
    btn.addEventListener('click', () => window.print());
  }

  // 清理辅助属性，避免 Chrome 的 aria-hidden 焦点告警：
  // 提取的聊天片段里可能带有 aria-hidden 元素，注入后若其内部
  // 保留了焦点，Chrome 会在控制台报
  // "Blocked aria-hidden on an element because its descendant retained focus"。
  // 打印页是纯静态内容，直接移除 aria-hidden 并释放焦点即可消除告警。
  document.querySelectorAll('[aria-hidden]').forEach(el => el.removeAttribute('aria-hidden'));
  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.blur();
  }
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      window.print();
    }
  });
});
