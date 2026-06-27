let mathJaxReady = false;
function waitForMathJax() {
  return new Promise((resolve, reject) => {
    if (window.MathJax && window.MathJax.startup && window.MathJax.startup.promise) {
      window.MathJax.startup.promise.then(() => {
        mathJaxReady = true;
        resolve();
      }).catch(reject);
    } else {
      // 如果 MathJax 尚未定义，等待一小段时间（通常不会发生，因为已顺序注入）
      const check = setInterval(() => {
        if (window.MathJax && window.MathJax.startup && window.MathJax.startup.promise) {
          clearInterval(check);
          window.MathJax.startup.promise.then(() => {
            mathJaxReady = true;
            resolve();
          }).catch(reject);
        }
      }, 100);
    }
  });
}

// 获取最末级段落（内部无 section/p）
function getLeafParagraphs(root, startIndex = 0, maxCount = 0) {
  const paraCollections = ['SECTION','P'];
  const paraQSelector = paraCollections.join(", ").toLowerCase();
  // 判断一个元素是否是最末级段落（即无子段落）
  function isLeafParagraph(node) {
    return (paraCollections.includes(node.tagName)) && 
           !node.querySelector(paraQSelector);
  }

  // 收集节点内所有最末级段落（包括节点本身如果它是段落）
  function collectLeaf(node) {
    const result = [];
    // 如果节点本身是最末级段落，直接加入
    if (isLeafParagraph(node)) {
      result.push(node);
      return result;
    }
    // 否则遍历其子元素
    for (const child of node.children) {
      // 如果子元素是段落但没有子段落，则加入
      if (isLeafParagraph(child)) {
        result.push(child);
      } else {
        // 否则递归深入
        result.push(...collectLeaf(child));
      }
    }
    return result;
  }

  const children = Array.from(root.children);
  if (children.length === 0) return [];

  const start = Math.max(0, startIndex);
  const end = maxCount > 0 ? Math.min(start + maxCount, children.length) : children.length;
  const selected = children.slice(start, end);

  let allLeaf = [];
  for (const child of selected) {
    allLeaf = allLeaf.concat(collectLeaf(child));
  }
  return allLeaf;
}

// 处理单个段落内的行内公式
async function processParagraphInline(para) {
  const clone = para.cloneNode(true);
  // 1. 合并相邻的文本节点，简化处理
  clone.normalize();
  const textNodes = [];
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT, null, false);
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  const replacements = []; // { node, latex, startIndex, endIndex, originalText }

  for (const textNode of textNodes) {
    const text = textNode.nodeValue;
    if (!text) continue;
    const inlineRegex = /\\\((.*?)\\\)/g;
    let match;
    let lastIndex = 0;
    let hasMatch = false;
    const fragments = [];
    while ((match = inlineRegex.exec(text)) !== null) {
      hasMatch = true;
      const before = text.substring(lastIndex, match.index);
      if (before) fragments.push({ type: 'text', content: before });
      fragments.push({ type: 'latex', latex: match[1] });
      lastIndex = match.index + match[0].length;
    }
    if (!hasMatch) continue;
    const after = text.substring(lastIndex);
    if (after) fragments.push({ type: 'text', content: after });

    // 用临时占位符替换文本节点
    const parent = textNode.parentNode;
    const fragment = document.createDocumentFragment();
    for (const frag of fragments) {
      if (frag.type === 'text') {
        fragment.appendChild(document.createTextNode(frag.content));
      } else {
        const span = document.createElement('span');
        span.setAttribute('data-latex-placeholder', frag.latex);
        span.classList.add('latex-placeholder');
        span.textContent = `\\(${frag.latex}\\)`; // 临时显示
        fragment.appendChild(span);
        replacements.push({ span, latex: frag.latex });
      }
    }
    parent.replaceChild(fragment, textNode);
  }

  if (replacements.length === 0) return null; // 无公式

  const tempDiv = document.createElement('div');
  // 4. 再次合并相邻的文本节点（避免多个文本节点相邻）
  clone.normalize();
  tempDiv.innerHTML = flattenSpanNesting(clone.outerHTML);
  const newNode = tempDiv.firstChild;
  return newNode;
}

// ==================== 公式处理核心 ====================
async function processMathInOriginalEditor(block=null) {
  const originalEditor = await getOriginalEditor();
  if (!originalEditor) {
    showNotification('未找到原始编辑器', 2000);
    return;
  }

  // 读取配置
  const config = await new Promise(resolve => {
    chrome.storage.sync.get({
      processScope: 'document',
      maxFormulas: 0
    }, resolve);
  });

  let startFrom = null;
  if (config.processScope === 'cursor') {
    if (!block) {
      showNotification('请将光标放在要编辑的段落内', 3000);
      return;
    }
    startFrom = block;
  } else {
    // 从文档开始：获取第一个最末级段落
    const leafParas = getLeafParagraphs(originalEditor);
    if (leafParas.length > 0) startFrom = leafParas[0];
  }

  const maxCount = config.maxFormulas || 0;
  // console.log(`正在处理 LaTeX 公式（最多 ${maxCount || '不限制'} 个）...`);
  try {
    const html = originalEditor.innerHTML;
    const converted = await convertLatexInHTML(html, startFrom, maxCount);
    const final = await processSVGInHTML(converted);
    originalEditor.innerHTML = final;
    originalEditor.dispatchEvent(new Event('input', { bubbles: true }));
    showNotification('LaTeX 公式处理完成', 2000);
  } catch (err) {
    console.error(err);
    showNotification('处理失败', 3000);
  }
}
window.processMathInOriginalEditor=processMathInOriginalEditor;

async function renderLatexToSVGString(latex, block) {
  // console.log(latex);
  try {
    const node = await MathJax.tex2svgPromise(latex, { display: true });
    const svg = node.querySelector('svg');
    if (!svg) throw new Error('MathJax 未返回 SVG');
    svg.style.width = 'auto';
    svg.style.height = 'auto';
    svg.setAttribute('data-latex', latex);
    svg.classList.add('latex-svg');  // 添加 class
    if (block) {
      const placeholder = document.createElement('section');
      placeholder.style.textAlign = 'center';
      placeholder.style.margin = '1em 0';
      placeholder.setAttribute('data-latex', latex);
      placeholder.appendChild(svg);
      const svgString = placeholder.outerHTML;
      return `${svgString}`;
    } else {
      const svgString = svg.outerHTML;
      return `${svgString}`;
    }
  } catch (err) {
    console.log(`渲染 LaTeX 失败: ${latex}, ${err}`);
    return `<span style="display: inline-block; vertical-align: middle; margin: 0 0.1em;color:red">\\(${latex}\\)</span>`;
  }
}

// 辅助函数转义 HTML 特殊字符（避免 XSS）
function escapeHtml(str) {
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

// 从一组段落中提取完整的 LaTeX（基于 textContent，忽略内联标签）
function extractLatexFromParagraphs(paragraphs) {
  const texts = paragraphs.map(p => p.textContent.trim());
  let combined = texts.join(' ');
  combined = combined.trim();
  if (combined.startsWith('\\[') && combined.endsWith('\\]')) {
    return combined.slice(2, -2).trim();
  }
  const first = texts[0];
  const last = texts[texts.length - 1];
  if (first.startsWith('\\[') && last.endsWith('\\]')) {
    let inner = first.slice(2) + ' ' + texts.slice(1, -1).join(' ') + ' ' + last.slice(0, -2);
    return inner.trim();
  }
  return null;
}

async function convertLatexInHTML(html, startFrom = null, maxCount = 0) {
  await waitForMathJax();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const body = doc.body;

  // 确定起始索引
  let startIndex = 0;
  if (startFrom) {
    const eRoot = startFrom.parentNode;
    const idx = Array.prototype.indexOf.call(eRoot.children, startFrom);
    if (idx !== -1) startIndex = idx;
  }

  // 获取所有最末级段落
  const leafParas = getLeafParagraphs(body,startIndex);
  // const leafParas = getLeafParagraphs(body);
  if (leafParas.length === 0) return html;

  // 构建段落组（从 startIndex 开始）
  const groups = [];
  let currentGroup = [];
  let cnt = maxCount ? maxCount : leafParas.length;
  for (const para of leafParas) {
    if (cnt){
      const text = para.textContent.trim();
      if (currentGroup.length===0 && text.startsWith('\\[')) {
        currentGroup.push(para);
        if (text.length>2 && text.endsWith('\\]')) {
          groups.push(currentGroup);
          cnt--;
          currentGroup = [];
        }
      } else if (currentGroup.length > 0 && !text.endsWith('\\]')) {
        currentGroup.push(para);
      } else if (currentGroup.length > 0 && text.endsWith('\\]')){
          currentGroup.push(para);
          groups.push(currentGroup);
          cnt--;
          currentGroup = [];
      } else {
        const inlineRegex = /\\\((.*?)\\\)/g;
        let match;
        if ((match = inlineRegex.exec(text)) !== null) {cnt--;groups.push([para]);}
      }
    } else {break;}
  }
  if (currentGroup.length) groups.push(currentGroup);

  // 处理每个组，收集占位符
  const placeholders = []; // { element, latex, display }
  const inlineRegex = /\\\((.*?)\\\)/g;
  let match;

  for (const group of groups) {
    if (group.length === 1) {
      const para = group[0];
      const text = para.textContent.trim();
      if (text.startsWith('\\[') && text.endsWith('\\]')) {
        const latex = text.slice(2, -2).trim();
        const placeholder = doc.createElement('section');
        placeholder.style.textAlign = 'center';
        placeholder.style.margin = '1em 0';
        placeholder.setAttribute('data-latex', latex);
        placeholder.textContent = `\\\[${latex}\\\]`;
        para.parentNode.replaceChild(placeholder, para);
        placeholders.push({ element: placeholder, latex, display: true });
      } else {
        const newClone = await processParagraphInline(para);        
        //段内公式
        if (newClone) {
          para.parentNode.replaceChild(newClone, para);
          // 收集该段落内的占位符
          const spans = newClone.querySelectorAll('span');
          for (const span of spans) {
            while ((match = inlineRegex.exec(span.textContent)) !== null) {
              const latex = match[1];
              placeholders.push({ element: span, latex, display: false });
              // console.log(latex);            
            }
          }
        }        
      }
    } else {
      // 多段落块级公式
      const latex = extractLatexFromParagraphs(group);
      if (latex) {
        const placeholder = doc.createElement('section');
        placeholder.style.textAlign = 'center';
        placeholder.style.margin = '1em 0';
        placeholder.setAttribute('data-latex', latex);
        placeholder.textContent = `\\\[${latex}\\\]`;
        const firstPara = group[0];
        const parent = firstPara.parentNode;
        const referenceNode = group[group.length - 1].nextSibling;
        for (const para of group) para.remove();
        parent.insertBefore(placeholder, referenceNode);
        placeholders.push({ element: placeholder, latex, display: true });
      } else {
        // 回退：分别处理行内
        for (const para of group) {
          const newClone = await processParagraphInline(para);        
          if (newClone) {
            const spans = newClone.querySelectorAll('span');
            for (const span of spans) {
              const spans = newClone.querySelectorAll('span');
              for (const span of spans) {
                while ((match = inlineRegex.exec(span.textContent)) !== null) {
                  const latex = match[1];
                  placeholders.push({ element: span, latex, display: false });
                  // console.log(latex);            
                }
              }
            }
          }
        }
      }
    }
  }

  const renderTasks = placeholders.map(async ({ latex, display, element }) => {
    try {
      const svgString = await renderLatexToSVGString(latex, display);
      const tempDiv = doc.createElement('div');
      tempDiv.innerHTML = svgString;
      const newNode = tempDiv.firstChild;
      const pNode = element.parentNode;
      pNode.replaceChild(newNode, element);
    } catch (err) {
      console.warn(`渲染失败: ${latex}`, err);
      // 保留原始文本
      element.textContent = display ? `\\\[${latex}\\\]` : `\\\(${latex}\\\)`;
    }
  });

  await Promise.all(renderTasks);
  return body.innerHTML;
}
window.convertLatexInHTML=convertLatexInHTML;