/**
 * AI 聊天站点配置表
 * 
 * 每个站点定义如何找到聊天内容容器、消息列表、以及需要剔除的无关元素。
 * 支持精确选择器和智能降级策略。
 * 
 * ⚠️ 重要：选择器按优先级排列，越靠前越精确。
 *    当精确选择器找不到时，会自动降级到通用检测。
 */
/**
 * 求两个元素的最浅公共祖先（含自身）
 */
function nearestCommonAncestor(a, b) {
  if (!a || !b) return null;
  if (a.contains(b)) return a;
  if (b.contains(a)) return b;
  let el = a.parentElement;
  while (el) {
    if (el.contains(b)) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * 纯文本转义为 HTML（用于提取用户提问等纯文本消息）
 */
function escapeHtmlText(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Google AI 模式：找到会话滚动容器（从消息锚点向上找真正滚动的元素）
 * 校验：容器必须同时包含第一条和最后一条响应轮次（即整个会话），
 * 否则可能误中某个内部小滚动区，此时回退为整页滚动。
 */
function findGoogleAiScroller() {
  const responses = document.querySelectorAll('[data-subtree="aimc"]');
  const anchor = responses[0] || document.querySelector('h2.iMqumd');
  const lastResponse = responses[responses.length - 1];
  let p = anchor && anchor.parentElement;
  while (p && p !== document.body) {
    if (p.scrollHeight - p.clientHeight > 50 && p.clientHeight > 200) {
      if (!lastResponse || p.contains(lastResponse)) return p;
    }
    p = p.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

// ==================== Google AI 模式：滚动收集 ====================
// AI 模式懒加载且会卸载视口外内容：只滚到底再提取会丢失顶部内容。
// 必须在从顶滚到底的过程中逐段收集到缓存，最后合并去重。
const googleAiCache = { items: [], seen: new Set() };

function resetGoogleAiCache() {
  googleAiCache.items.length = 0;
  googleAiCache.seen.clear();
}

function googleAiPromptEls() {
  let els = Array.from(document.querySelectorAll('h2.iMqumd'))
    .map(h2 => h2.closest('.ilZyRc, .Ax52xb') || h2);
  if (els.length === 0) {
    els = Array.from(document.querySelectorAll('.ilZyRc, .tonYlb, .Ax52xb'))
      .filter(el => el.querySelector('h2'));
  }
  return els;
}

function googleAiSanitizeUser(el) {
  const h2 = el.querySelector('h2');
  let text = (h2 ? h2.textContent : el.textContent) || '';
  // 去掉本地化前缀："You said:" / "你说：" / "您说："
  text = text.replace(/^\s*(?:You said\s*[:：]|你[说問]\s*[:：]?)\s*/i, '').trim();
  return text ? escapeHtmlText(text) : '';
}

function googleAiSanitizeAssistant(el) {
  const clone = el.cloneNode(true);
  // 剔除 UI：按钮、输入框、引用胶囊、追问建议、画布等
  clone.querySelectorAll(
    'button, textarea, input, script, style, [role="button"], [role="listbox"], ' +
    '[data-xid="pJN44d"], .Eltaeb, .WBgIic, [data-rl]'
  ).forEach(n => n.remove());

  // 移除复制/分享等带 aria-label 或 data-tooltip 的 UI 残留
  clone.querySelectorAll('[aria-label], [data-tooltip]').forEach(n => {
    const label = (n.getAttribute('aria-label') || '') + ' ' + (n.getAttribute('data-tooltip') || '');
    if (/复制|拷贝|cop(y|ied)|couldn.?t copy|paste|分享|share|答得好|答得不好|喜欢|不喜欢|Good|Bad|lik(e|ed)|dislik/i.test(label)) n.remove();
  });

  // 移除操作栏的 SVG 图标（如复制成功的"打勾"）。
  // 特征：Material 图标 path 坐标为图标网格（如 M382-240，0-1000 数值段），
  // 且不含 <text>；这类 SVG 无尺寸约束时会放大占满整页，必须删掉。
  clone.querySelectorAll('svg').forEach(svg => {
    const cls = svg.getAttribute('class') || '';
    const paths = svg.querySelectorAll('path');
    let d = '';
    paths.forEach(p => { d += ' ' + (p.getAttribute('d') || ''); });
    const isIcon = /material|icon/i.test(cls) ||
      /(^|\s)M\d{2,4}[-,\s]/.test(d);
    const hasText = svg.querySelector('text') !== null;
    if (isIcon && !hasText) svg.remove();
  });

  // 移除操作栏残留的短文字（复制/剪贴板/点赞反馈等标签，
  // 如"未能复制到剪贴板。请稍后重试。" / "Failed to copy to clipboard. Try again later."）。
  // 仅限较短文本，避免误删正文。
  Array.from(clone.querySelectorAll('*')).forEach(n => {
    if (n.childElementCount === 0) {
      const t = (n.textContent || '').trim();
      if (t && t.length <= 60 &&
          /复制|剪贴板|请稍后重试|答得好|答复不好|分享|cop(y|ied)|couldn.?t copy|failed to copy|try again later|clipboard|paste|share|lik(e|ed)|dislik|good (re)?sponse|bad (re)?sponse|feedback/i.test(t) &&
          !/<|>/.test(t)) {
        n.remove();
      }
    }
  });

  // 优先取正文块，避免整轮 UI 包裹
  let html = '';
  const body = clone.querySelector('[data-xid="VpUvz"], [jsname="KFl8ub"]');
  html = body ? body.innerHTML : clone.innerHTML;
  // 去掉事件处理器属性
  html = html.replace(/\son\w+="[^"]*"/gi, '').trim();
  // 纯文本为空则视为无效
  if (!html || !html.replace(/<[^>]*>/g, '').trim()) return '';
  return html;
}

/**
 * 扫描当前 DOM，返回按文档顺序排好的 {role, html, key} 列表
 */
function googleAiScanDocOrder() {
  const els = [
    ...googleAiPromptEls().map(el => ({ el, role: 'user' })),
    ...Array.from(document.querySelectorAll('[data-subtree="aimc"]')).map(el => ({ el, role: 'assistant' }))
  ].sort((a, b) => {
    return a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });

  const out = [];
  for (const { el, role } of els) {
    if (role === 'user') {
      const html = googleAiSanitizeUser(el);
      if (html) out.push({ role, html, key: 'u:' + html.slice(0, 120) });
    } else {
      const html = googleAiSanitizeAssistant(el);
      if (html) out.push({ role, html, key: 'a:' + html.replace(/<[^>]*>/g, '').slice(0, 120) });
    }
  }
  return out;
}

function googleAiCollectCurrent() {
  for (const item of googleAiScanDocOrder()) {
    if (!googleAiCache.seen.has(item.key)) {
      googleAiCache.seen.add(item.key);
      googleAiCache.items.push({ role: item.role, html: item.html });
    }
  }
}

const CHAT_SITES = [
  // ==================== ChatGPT ====================
  {
    name: 'ChatGPT',
    hostnames: ['chat.openai.com', 'chatgpt.com'],
    containerSelector: [
      '.react-scroll-to-bottom',
      '[data-testid^="conversation-turn-1"]',
      'main > div > div > div',
      'main'
    ],
    messageSelector: 'article[data-testid^="conversation-turn"], [data-message-author-role]',
    stripSelectors: [
      'button', 'svg', '[role="button"]', '[role="menuitem"]',
      'nav', 'form', 'textarea', 'input',
      '[data-testid="copy-turn-action-button"]',
      '[data-testid="feedback-thumbs"]',
      '[data-testid="conversation-turn-actions"]',
      '.pointer-events-none', '.group\\/action', '.text-xs'
    ],
    roleSelector: (el) => el.getAttribute('data-message-author-role') || 'assistant'
  },

  // ==================== Claude ====================
  {
    name: 'Claude',
    hostnames: ['claude.ai'],
    containerSelector: [
      '[data-testid="chat-messages"]',
      '.font-claude-message',
      'main section',
      'main'
    ],
    messageSelector: '.font-claude-message, [data-testid="user-message"], [data-testid="assistant-message"], [class*="message"]',
    stripSelectors: [
      'button', 'svg', '[role="button"]',
      'nav', 'form', 'textarea', 'input',
      '[class*="action"]', '[class*="toolbar"]',
      'footer', 'header'
    ],
    roleSelector: (el) => {
      if (el.matches('[data-testid="user-message"]') || el.closest('[data-testid="user-message"]')) return 'user';
      return 'assistant';
    }
  },

  // (Google AI Mode 支持已移除：Google AI Mode 已自行优化聊天打印功能)

  // ==================== Kimi ====================
  {
    name: 'Kimi',
    hostnames: ['kimi.moonshot.cn'],
    containerSelector: [
      '.chat-container',
      '.conversation-list',
      '[class*="message-list"]',
      'main'
    ],
    messageSelector: '[class*="message"], [class*="chat-item"], [class*="msg-item"]',
    stripSelectors: [
      'button', 'svg', '[role="button"]',
      'nav', 'form', 'textarea', 'input',
      'header', 'footer', 'aside'
    ],
    roleSelector: (el) => el.matches('[class*="user"], [class*="self"]') ? 'user' : 'assistant'
  },

  // ==================== 通义千问 ====================
  {
    name: '通义千问',
    hostnames: ['tongyi.aliyun.com'],
    containerSelector: [
      '.chat-content',
      '.conversation-area',
      '[class*="chat-list"]',
      'main'
    ],
    messageSelector: '[class*="message"], [class*="chat-msg"], [class*="conversation-item"]',
    stripSelectors: [
      'button', 'svg', '[role="button"]',
      'nav', 'form', 'textarea', 'input',
      'header', 'footer', 'aside'
    ],
    roleSelector: (el) => el.matches('[class*="user"], [class*="self"], [class*="right"]') ? 'user' : 'assistant'
  },

  // ==================== 文心一言 ====================
  {
    name: '文心一言',
    hostnames: ['yiyan.baidu.com'],
    containerSelector: [
      '.chat-records',
      '.conversation-main',
      '[class*="chat-content"]',
      'main'
    ],
    messageSelector: '[class*="message"], [class*="chat-item"], [class*="qa-item"]',
    stripSelectors: [
      'button', 'svg', '[role="button"]',
      'nav', 'form', 'textarea', 'input',
      'header', 'footer', 'aside'
    ],
    roleSelector: (el) => el.matches('[class*="user"], [class*="self"]') ? 'user' : 'assistant'
  },

  // ==================== Gemini ====================
  {
    name: 'Gemini',
    hostnames: ['gemini.google.com'],
    containerSelector: [
      '.conversation-container',
      '.conversation-turn-container',
      '[role="main"]'
    ],
    messageSelector: '.message-content, [class*="message"], [class*="turn"]',
    stripSelectors: [
      'button', 'svg', '[role="button"]',
      'nav', 'form', 'textarea', 'input',
      'header', 'footer', 'aside'
    ],
    roleSelector: (el) => el.matches('[class*="user"], [class*="self"]') ? 'user' : 'assistant'
  },

  // ==================== 豆包 ====================
  {
    name: '豆包',
    hostnames: ['doubao.com', 'www.doubao.com'],
    containerSelector: [
      '.chat-area',
      '.conversation-main',
      '[class*="message-area"]',
      'main'
    ],
    messageSelector: '[class*="message"], [class*="chat-item"]',
    stripSelectors: [
      'button', 'svg', '[role="button"]',
      'nav', 'form', 'textarea', 'input',
      'header', 'footer', 'aside'
    ],
    roleSelector: (el) => el.matches('[class*="user"], [class*="self"]') ? 'user' : 'assistant'
  },

  // ==================== Microsoft Copilot ====================
  {
    name: 'Microsoft Copilot',
    hostnames: ['copilot.microsoft.com', 'bing.com/chat'],
    containerSelector: [
      '#chatArea',
      '[class*="chat"]',
      'main'
    ],
    messageSelector: '[class*="message"], [class*="reply"], [class*="response"]',
    stripSelectors: [
      'button', 'svg', '[role="button"]',
      'nav', 'form', 'textarea', 'input',
      'header', 'footer', 'aside'
    ],
    roleSelector: (el) => el.matches('[class*="user"], [class*="self"]') ? 'user' : 'assistant'
  },

  // ==================== Google 搜索 AI 模式 (udm=50) ====================
  // 仅当页面存在 AI 模式响应轮次容器 [data-subtree="aimc"] 时才生效；
  // 普通谷歌搜索结果页不含该元素，会自动降级到通用检测，互不干扰。
  // 用户提问块：h2.iMqumd（含 "You said:"/"你说：" 前缀，已本地化），
  //   外层容器 .ilZyRc（经典布局）/ .Ax52xb（混合内容布局）。
  // AI 回复：每轮在 [data-subtree="aimc"] 中，正文块为
  //   [data-xid="VpUvz"] / [jsname="KFl8ub"] / .Y3BBE。
  {
    name: 'Google AI search',
    hostnames: ['www.google.com'],
    containerSelector: ['[data-subtree="aimc"]'],
    customContainerFinder: function () {
      const responses = document.querySelectorAll('[data-subtree="aimc"]');
      if (responses.length === 0) return null; // 非 AI 模式页面

      // 求所有响应轮次的最浅公共祖先
      let root = responses[0];
      for (let i = 1; i < responses.length; i++) {
        root = nearestCommonAncestor(root, responses[i]);
        if (!root) return null;
      }

      // 向上扩展以包含用户提问块（提问在第一轮响应之前）
      let el = root;
      while (el && el !== document.body) {
        if (el.querySelector('.ilZyRc, .Ax52xb, h2.iMqumd')) return el;
        el = el.parentElement;
      }
      return root;
    },
    // AI 模式懒加载且会卸载视口外内容：从顶部逐步滚到底，
    // 每一步都把已挂载的消息收集进缓存，直到内容高度稳定
    hydrate: function () {
      return new Promise((resolve) => {
        resetGoogleAiCache();
        googleAiCollectCurrent(); // 收集当前视口内容

        const scroller = findGoogleAiScroller();
        if (!scroller) { resolve(); return; }
        const origTop = scroller.scrollTop;
        scroller.scrollTop = 0; // 从顶部开始

        let stable = 0, steps = 0;
        const MAX_STEPS = 80, STEP_MS = 400;
        const timer = setInterval(() => {
          const before = scroller.scrollHeight;
          scroller.scrollBy(0, Math.max(300, Math.floor(scroller.clientHeight * 0.75)));
          steps++;
          setTimeout(() => {
            googleAiCollectCurrent();
            const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 5;
            if (scroller.scrollHeight === before && atBottom) {
              stable++;
            } else {
              stable = 0;
            }
            if (stable >= 3 || steps >= MAX_STEPS) {
              clearInterval(timer);
              scroller.scrollTop = origTop; // 恢复原位置
              console.log('[AI打印助手] 滚动收集完成, 共收集', googleAiCache.items.length, '条消息');
              resolve();
            }
          }, 100);
        }, STEP_MS);
      });
    },
    stripSelectors: [
      'button', 'svg', '[role="button"]',
      'textarea', 'input', 'form',
      'header', 'footer', 'aside', 'nav'
    ],
    customExtract: function () {
      // 以滚动收集缓存为基础（包含滚动过程中被卸载的视口外内容）
      const messages = googleAiCache.items.map(m => ({ role: m.role, html: m.html }));

      // 再并入当前 DOM 中缓存里没有的消息（补漏）
      for (const item of googleAiScanDocOrder()) {
        if (!googleAiCache.seen.has(item.key)) {
          googleAiCache.seen.add(item.key);
          messages.push({ role: item.role, html: item.html });
        }
      }

      return messages;
    }
  },

  // ==================== Grok ====================
  {
    name: 'Grok',
    hostnames: ['grok.com', 'x.ai'],
    containerSelector: [
      '[class*="chat"]',
      '[class*="conversation"]',
      'main'
    ],
    messageSelector: '[class*="message"], [class*="chat-item"]',
    stripSelectors: [
      'button', 'svg', '[role="button"]',
      'nav', 'form', 'textarea', 'input',
      'header', 'footer', 'aside'
    ],
    roleSelector: (el) => el.matches('[class*="user"], [class*="self"]') ? 'user' : 'assistant'
  }
];

/**
 * 根据当前页面 hostname 查找匹配的站点配置
 */
function findSiteConfig(hostname) {
  return CHAT_SITES.find(site =>
    site.hostnames.some(h => hostname.includes(h))
  );
}

/**
 * 从容器中智能提取消息列表
 *
 * 策略（按优先级）：
 *   1. 如果站点配置有 customExtract 函数，直接使用它
 *   2. 使用站点配置的消息选择器
 *   3. 使用通用降级策略
 */
function extractMessagesFromContainer(container, siteConfig) {
  if (!container) return [];

  // 策略0: 使用站点自定义提取器
  if (siteConfig && typeof siteConfig.customExtract === 'function') {
    try {
      const results = siteConfig.customExtract(container);
      if (Array.isArray(results) && results.length > 0) {
        return results;
      }
    } catch (e) {
      console.warn('[AI打印助手] 自定义提取器失败:', e);
    }
  }

  const messages = [];

  // 策略1: 使用站点配置的消息选择器
  if (siteConfig && siteConfig.messageSelector) {
    const selectors = siteConfig.messageSelector.split(',').map(s => s.trim()).filter(s => s);
    for (const sel of selectors) {
      try {
        const elements = container.querySelectorAll(sel);
        if (elements.length >= 1) {
          // 过滤：每个消息块需要有足够的文本内容
          const validElements = Array.from(elements).filter(el => {
            const text = el.textContent.trim();
            // 跳过太短的元素（可能是按钮、标签等）
            if (text.length < 10) return false;
            // 跳过导航、工具栏等
            if (el.closest('nav, header, footer, aside, button, form')) return false;
            const cls = (el.className || '') + (el.id || '');
            if (/nav|sidebar|toolbar|action|button|footer|header/i.test(cls)) return false;
            return true;
          });

          if (validElements.length >= 2) {
            messages.push(...validElements);
            break; // 找到有效的选择器后停止
          }
        }
      } catch (e) {
        // 选择器可能不合法，跳过
        console.warn('[AI打印助手] 选择器错误:', sel, e);
      }
    }
  }

  // 如果策略1没找到，使用降级策略
  if (messages.length < 2) {
    messages.length = 0; // 清空
    const items = extractMessagesGeneric(container);
    messages.push(...items);
  }

  // 去重（基于文本内容前100字符）
  const seen = new Set();
  return messages.filter(el => {
    const key = el.textContent.trim().substring(0, 100);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 通用降级策略：当已知站点配置不匹配时，自动检测页面上的聊天区域
 * 
 * 策略：
 *   1. 找最常见的内容标签 main/article/section
 *   2. 找包含大量文本且不是 nav/aside/footer 的最大区域
 *   3. 使用启发式评分
 */
function detectChatContainerGeneric() {
  // 优先找主内容区域
  const mainContent = document.querySelector('main, article, [role="main"]');
  if (mainContent && mainContent.textContent.trim().length > 200) {
    return mainContent;
  }

  // 找文本量最大的非导航区域
  const candidates = document.querySelectorAll(
    'div[class*="content"], div[class*="chat"], div[class*="conversation"], ' +
    'div[class*="message"], div[class*="dialog"], section, ' +
    'div[class*="main"], div[class*="body"]'
  );

  let best = null;
  let bestScore = 0;

  for (const el of candidates) {
    // 跳过导航/侧栏/页脚
    const cls = (el.className || '') + (el.id || '');
    if (/nav|sidebar|footer|header|menu|toolbar|input/i.test(cls)) continue;
    if (el.closest('nav, header, footer, aside')) continue;

    const textLen = el.textContent.trim().length;
    const childCount = el.children.length;
    const score = textLen + childCount * 50;

    if (score > bestScore && textLen > 100) {
      bestScore = score;
      best = el;
    }
  }

  return best;
}

/**
 * 通用降级：从容器中提取消息列表（启发式）
 * 寻找文本量大、有结构的子元素作为消息块
 */
function extractMessagesGeneric(container) {
  if (!container) return [];

  // 策略1: 直接子元素中文本量较大的
  let items = Array.from(container.children).filter(el => {
    const text = el.textContent.trim();
    const tag = el.tagName.toLowerCase();
    // 跳过导航、表单、脚本等
    if (['nav','header','footer','aside','form','script','style','button'].includes(tag)) return false;
    return text.length > 20;
  });

  // 策略2: 如果子元素太少，尝试孙子辈
  if (items.length < 2) {
    items = Array.from(container.querySelectorAll(':scope > div > div, :scope > section, :scope > article'))
      .filter(el => el.textContent.trim().length > 20);
  }

  // 策略3: 如果还没有，尝试所有包含大量文本的块级元素
  if (items.length < 2) {
    items = Array.from(container.querySelectorAll('p, pre, blockquote, div'))
      .filter(el => {
        const text = el.textContent.trim();
        return text.length > 50 && !el.closest('nav, header, footer, aside, button, form');
      });
  }

  // 去重
  const seen = new Set();
  return items.filter(el => {
    const key = el.textContent.trim().substring(0, 100);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
