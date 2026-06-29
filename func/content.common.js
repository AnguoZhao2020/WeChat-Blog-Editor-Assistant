function getCmEditor() {
  const cmWrapper = document.querySelector('.CodeMirror');
  return cmWrapper ? cmWrapper.CodeMirror : null;
}
window.getCmEditor=getCmEditor;

function getreplaceDropdown() {
  const overlay = document.querySelector('.wx-replace-dropdown');
  return overlay;
}
window.getreplaceDropdown=getreplaceDropdown;

function getOriginalEditor() {
  // 从 storage 同步获取选择器（可缓存，但简单起见每次都读 storage）
  return new Promise((resolve) => {
    chrome.storage.sync.get({ editorSelector: 'div.rich_media_content div.ProseMirror[contenteditable="true"]' }, (data) => {
      const el = document.querySelector(data.editorSelector);
      resolve(el);
    });
  });
}
window.getOriginalEditor=getOriginalEditor;

// 等待原生编辑器出现
function waitForOriginalEditor() {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get({ editorSelector: 'div.rich_media_content div.ProseMirror[contenteditable="true"]' }, (data) => {
      const selector = data.editorSelector;
      const target = document.querySelector(selector);
      if (target) {
        resolve(target);
        return;
      }
      const observer = new MutationObserver((_, obs) => {
        const el = document.querySelector(selector);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      // 可选：设置超时，避免无限等待
      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`未找到元素: ${selector}`));
      }, 10000);
    });
  });
}
window.waitForOriginalEditor=waitForOriginalEditor;

let notificationTimeout = null;
function showNotification(message, duration = 2000) {
  const existing = document.querySelector('.wx-notification');
  if (existing) existing.remove();
  if (notificationTimeout) clearTimeout(notificationTimeout);
  
  const notif = document.createElement('div');
  notif.className = 'wx-notification';
  notif.textContent = message;
  notif.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(229, 214, 12, 0.91);
    color: black;
    padding: 8px 16px;
    border-radius: 24px;
    font-size: 14px;
    z-index: 2147483647;
    pointer-events: none;
    font-family: system-ui, sans-serif;
    white-space: nowrap;
    backdrop-filter: blur(4px);
  `;
  document.body.appendChild(notif);
  notificationTimeout = setTimeout(() => {
    if (notif.parentNode) notif.remove();
  }, duration);
}
window.showNotification=showNotification;

function formatText(str) {
  // 匹配：(ASCII字符或数字) + (中文或全角字符)
  const reg1 = /([a-zA-Z0-9])([\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef])/g;
  // 匹配：(中文或全角字符) + (ASCII字符或数字)
  const reg2 = /([\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef])([a-zA-Z0-9])/g;

  // 排除中文标点符号（即如果左边或右边是中文标点，则不插入空格）
  // 这里的标点包括：逗号、句号、问号、叹号、冒号、分号、引号、括号等
  const chinesePunctuation = /[\u3002\uff1b\uff0c\uff1a\u201c\u201d\u2018\u2019\uff08\uff09\u300a\u300b\u3001\uff1f\uff01\u2014]/;

  return str
    .replace(reg1, (match, p1, p2) => {
      return chinesePunctuation.test(p2) ? match : `${p1} ${p2}`;
    })
    .replace(reg2, (match, p1, p2) => {
      return chinesePunctuation.test(p1) ? match : `${p1} ${p2}`;
    })
    .replace(/\s+/g, ' '); // 确保多个连续空格合并为一个，同时过滤掉原有的多余空格
}

function applySpacingRules(root) {
  // 1. 对每个 span 内部的直接文本节点应用 formatText
  const spans = root.querySelectorAll('span');
  for (const span of spans) {
    // 收集直接文本子节点
    const textNodes = [];
    for (const child of span.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        textNodes.push(child);
      }
    }
    for (const textNode of textNodes) {
      const newText = formatText(textNode.textContent);
      if (newText !== textNode.textContent) {
        textNode.textContent = newText;
      }
    }
  }

  // 2. 处理相邻 span 之间的中英文混合空格
  const allSpans = Array.from(root.querySelectorAll('span'));
  const isAscii = (c) => /[a-zA-Z0-9]/.test(c);
  const isChinese = (c) => /[\u4e00-\u9fa5]/.test(c);
  const punctuation = /[\u3002\uff1b\uff0c\uff1a\u201c\u201d\u2018\u2019\uff08\uff09\u300a\u300b\u3001\uff1f\uff01\u2014,.;:!?()，。；：！？（）]/;

  for (let i = 0; i < allSpans.length - 1; i++) {
    const prev = allSpans[i];
    const next = allSpans[i+1];
    // 必须是相邻兄弟
    if (prev.nextElementSibling === next) {
      const prevText = prev.textContent.trim();
      const nextText = next.textContent.trim();
      if (prevText && nextText) {
        const lastChar = prevText[prevText.length - 1];
        const firstChar = nextText[0];
        if ((isAscii(lastChar) && isChinese(firstChar)) ||
            (isChinese(lastChar) && isAscii(firstChar))) {
          if (!punctuation.test(lastChar) && !punctuation.test(firstChar)) {
            // 在后一个 span 的开头插入空格（若不存在）
            // 找到第一个文本节点
            let firstTextNode = null;
            for (const child of next.childNodes) {
              if (child.nodeType === Node.TEXT_NODE) {
                firstTextNode = child;
                break;
              }
            }
            if (firstTextNode) {
              if (!firstTextNode.textContent.startsWith(' ')) {
                firstTextNode.textContent = ' ' + firstTextNode.textContent;
              }
            } else {
              // 没有文本节点，创建一个
              const newTextNode = document.createTextNode(' ' + next.textContent);
              next.innerHTML = '';
              next.appendChild(newTextNode);
            }
          }
        }
      }
    }
  }
}

/**
 * 将嵌套的 span 展开为平级 span，合并内联样式（子样式优先）
 * @param {string} html 原始 HTML 字符串
 * @returns {string} 处理后的 HTML 字符串
 */
function flattenSpanNesting(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const body = doc.body;

  // 辅助：样式字符串转对象
  function styleToObj(style) {
    const obj = {};
    if (!style) return obj;
    style.split(';').forEach(decl => {
      const [prop, val] = decl.split(':');
      if (prop && val) obj[prop.trim()] = val.trim();
    });
    return obj;
  }

  // 合并样式（子覆盖父）
  function mergeStyles(parentStyle, childStyle) {
    const parentObj = styleToObj(parentStyle);
    const childObj = styleToObj(childStyle);
    const merged = { ...parentObj, ...childObj };
    return Object.entries(merged).map(([k, v]) => `${k}:${v}`).join(';');
  }

  // 检查元素内部是否有嵌套的 span（直接或间接）
  function hasNestedSpan(node) {
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'SPAN') return true;
    if (node.nodeType === Node.ELEMENT_NODE) {
      for (let child of node.childNodes) {
        if (hasNestedSpan(child)) return true;
      }
    }
    return false;
  }

  // 扁平化单个 span 元素，返回一个由平级 span 组成的数组
  function flattenSpanElement(spanEl) {
    if (!hasNestedSpan(spanEl)) return [spanEl.cloneNode(true)];
    const parentStyle = spanEl.getAttribute('style') || '';
    const result = [];
    const children = Array.from(spanEl.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) {
        // 文本节点：创建新 span 继承父样式
        const newSpan = doc.createElement('span');
        if (parentStyle) newSpan.setAttribute('style', parentStyle);
        newSpan.appendChild(child.cloneNode(true));
        result.push(newSpan);
      } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'SPAN') {
        // 子 span：先递归展开，然后合并样式
        const subSpans = flattenSpanElement(child);
        for (const sub of subSpans) {
          const subStyle = sub.getAttribute('style') || '';
          const mergedStyle = mergeStyles(parentStyle, subStyle);
          const newSpan = doc.createElement('span');
          if (mergedStyle) newSpan.setAttribute('style', mergedStyle);
          // 复制其他属性（如 class）
          for (const attr of sub.attributes) {
            if (attr.name !== 'style') newSpan.setAttribute(attr.name, attr.value);
          }
          // 复制子节点
          for (const subChild of sub.childNodes) {
            newSpan.appendChild(subChild.cloneNode(true));
          }
          result.push(newSpan);
        }
      } else {
        // 其他元素（如 div、p 等）：递归处理其内部可能存在的 span
        const clone = child.cloneNode(false);
        for (const grandChild of child.childNodes) {
          if (grandChild.nodeType === Node.ELEMENT_NODE && grandChild.tagName === 'SPAN') {
            const subSpans = flattenSpanElement(grandChild);
            for (const sub of subSpans) {
              clone.appendChild(sub);
            }
          } else {
            clone.appendChild(grandChild.cloneNode(true));
          }
        }
        result.push(clone);
      }
    }
    return result;
  }

  // 深度优先处理所有 span 元素（后序遍历，避免动态影响）
  function processNode(node) {
    // 先处理子节点
    for (const child of Array.from(node.childNodes)) {
      processNode(child);
    }
    // 如果当前节点是 span 且有嵌套，则替换它
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'SPAN' && hasNestedSpan(node)) {
      const flattened = flattenSpanElement(node);
      const parent = node.parentNode;
      for (const newSpan of flattened) {
        parent.insertBefore(newSpan, node);
      }
      parent.removeChild(node);
    }
  }

    // ---------- 间距调整 ----------
  function adjustSpacing() {
    const punctuationRegex = /[\s，。！？、：；""''（）《》…—·~！@#￥%……&*（）——+{}|：“”‘’《》？。，、；：！\.,;:!?()\[\]{}"']/;

    function i_processNode(parent) {
      const svg = parent.querySelector(':scope > svg');
      if (!svg) return;
      const children = Array.from(parent.childNodes);
      for (let i = 0; i < children.length - 1; i++) {
        const node = children[i];
        console.log(node.outerHTML);
        const nextNode = children[i+1];
        console.log(nextNode.outerHTML);
        if (node.nodeType === Node.ELEMENT_NODE && nextNode.nodeType === Node.ELEMENT_NODE) {
          console.log(`${node.tagName}-${nextNode.tagName}`);
          // 情况1: span 后紧跟 svg
          if (node.tagName === 'SPAN' && nextNode.tagName === 'svg') {
            // 确保 span 只有一个文本子节点
            if (node.childNodes.length === 1 && node.firstChild.nodeType === Node.TEXT_NODE) {
              const textNode = node.firstChild;
              let text = textNode.textContent;
              if (!punctuationRegex.test(text[text.length - 1])) {
                textNode.textContent = text + ' ';
              }
            }
          }
          // 情况2: svg 后紧跟 span
          if (node.tagName === 'svg' && nextNode.tagName === 'SPAN') {
            if (nextNode.childNodes.length === 1 && nextNode.firstChild.nodeType === Node.TEXT_NODE) {
              const textNode = nextNode.firstChild;
              let text = textNode.textContent;
              if (!punctuationRegex.test(text[0])) {
                textNode.textContent = ' ' + text;
              }
            }
          }
        }
      }
    }

    // 遍历所有元素节点作为父节点
    const allElements = body.querySelectorAll('*');
    for (const el of allElements) {
      i_processNode(el);
    }
    i_processNode(body);
  }
  processNode(body);
  adjustSpacing();
  applySpacingRules(body);
  
  return body.innerHTML;
}
window.flattenSpanNesting=flattenSpanNesting;

// 美化 HTML
function formatHTML(html) {
  html = flattenSpanNesting(html);   // 先处理嵌套 span
  // 替换 &nbsp; 为普通空格
  let cleaned = html.replace(/&nbsp;|&#160;/g, ' ');

  // 分割标签和文本（含注释）
  const tokenRegex = /(<!--[\s\S]*?-->|<[^>]+>|[^<]+)/g;
  const tokens = cleaned.match(tokenRegex) || [];

  const stack = [];          // 打开的标签名栈
  let result = '';
  let indent = 0;
  const indentUnit = '  ';

  function getTagName(tag) {
    const match = tag.match(/^<\/?([a-zA-Z0-9-]+)/);
    return match ? match[1] : null;
  }

  function isClosingTag(tag) {
    return /^<\//.test(tag);
  }

  function isComment(tag) {
    return tag.startsWith('<!--');
  }

  function getIndent(level) {
    return indentUnit.repeat(level);
  }

  for (const token of tokens) {
    if (isComment(token)) {
      result += token + '\n';
      continue;
    }

    if (token.match(/^<[^>]+>$/)) {
      if (isClosingTag(token)) {
        const tagName = getTagName(token);
        if (!tagName) {
          result += token + '\n';
          continue;
        }
        // 从栈中弹出直到匹配
        let matched = false;
        while (stack.length > 0) {
          const top = stack.pop();
          if (top === tagName) {
            matched = true;
            break;
          }
          // 不匹配则忽略（已弹出）
        }
        if (matched) {
          result += getIndent(stack.length) + token + '\n';
          indent = stack.length;
        } else {
          result += token + '\n';
        }
      } else {
        // 开始标签（包括自闭合标签）
        const tagName = getTagName(token);
        if (tagName) {
          stack.push(tagName);
          result += getIndent(indent) + token + '\n';
          indent = stack.length;
        } else {
          result += token + '\n';
        }
      }
    } else {
      const text = token;
      if (text) {
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
          if (line.trim() === '') continue;
          result += line + '\n';
        }
      }
    }
  }

  return result.trim();
}
window.formatHTML=formatHTML;

// 压缩 HTML（写回时使用）
function minifyHTML(html) {
  const lines = html.split(/\r?\n/);
  let minify = "";
  for (let line of lines) {
    if (line.match(/^\s+<[^>]+>$/)) line = line.trim();
    minify += line;
  }
  return minify;
}
window.minifyHTML=minifyHTML;

// 宽松解析：先尝试标准 JSON，失败则尝试 JS 对象字面量
function tryParseLooseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    // 尝试作为 JavaScript 对象字面量解析（注意 CSP 可能会限制 new Function）
    try {
      const fn = new Function('return ' + text);
      const result = fn();
      // 验证是否为对象
      console.log(result);
      if (result && typeof result === 'object') {
        return result;
      }
      throw new Error('不是有效对象');
    } catch (e2) {
      throw new Error('无法解析为 JSON 或 JavaScript 对象');
    }
  }
}
window.tryParseLooseJSON=tryParseLooseJSON;

function parseObjectLiteral(text) {
  // 去除首尾空白，确保最外层有 {}
  text = text.trim();
  const lines = text.split('\n');
  const processedLines = [];
  let insideObject = false; // 用于判断是否在嵌套对象内，但此处简化处理

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    line = line.replace(/([^\:\}\{]+)/g, '"$1"');
    line = line.replace(/\"\:\"\/\//,'://');
    processedLines.push(line);
  }

  // 重新构建 JSON 字符串
  let jsonString = '';
  let depth = 0;
  for (let i = 0; i < processedLines.length; i++) {
    const line = processedLines[i];
    if (line.endsWith('}') || line.endsWith('{')) {
      jsonString += line + '\n';
    } else {
      jsonString += line + ',\n';
    }
  }
  if (!(jsonString.startsWith('{') && jsonString.endsWith('}'))) {
    jsonString = '{' + jsonString + '}';
    jsonString = jsonString.replace(/\,\n\}/,'}');
  }

  try {
    console.log(jsonString);
    return JSON.parse(jsonString);
  } catch (e) {
    throw new Error('无法解析输入的文本为有效的对象：' + e.message);
  }
}
window.parseObjectLiteral=parseObjectLiteral;