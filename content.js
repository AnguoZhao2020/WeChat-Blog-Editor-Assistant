(() => {
  let isOpen = false;
  let originalEditor = null;
  let overlay = null;
  let cmEditor = null;
  let isDarkTheme = false;
  // console.log(`Browser color theme is dark: ${isDarkTheme}`)
  let replaceDropdown = null;
  let notificationTimeout = null;

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

  /**
   * 将 HTML 字符串中的 $latex$ 和 $$latex$$ 转换为 SVG
   * @param {string} html 原始 HTML
   * @returns {Promise<string>} 处理后的 HTML
   */
  async function convertLatexToSVG(html) {
    await waitForMathJax();

    // 辅助：渲染单个公式，返回对应的 HTML 字符串
    async function renderLatex(latex, display) {
      const node = await MathJax.tex2svgPromise(latex, { display: true });
      const svg = node.querySelector('svg');
      if (!svg) throw new Error('MathJax 返回的节点不包含 SVG');
      svg.style.width = 'auto';
      svg.style.height = 'auto';
      svg.setAttribute('data-latex', latex);
      const svgString = svg.outerHTML;
      if (display) {
        // 块级公式：居中显示
        return `<section style="text-align: center; margin: 1em 0;">${svgString}</section>`;
      } else {
        // 行内公式：内联显示
        return `<span style="display: inline-block; vertical-align: middle; margin: 0 0.1em;">${svgString}</span>`;
      }
    }

    // 1. 收集所有公式匹配
    const blockRegex = /\$\$([\s\S]+?)\$\$/g;
    const inlineRegex = /\$([^\$].*?)\$/g;
    let matches = [];
    let match;

    while ((match = blockRegex.exec(html)) !== null) {
      matches.push({ latex: match[1], display: true, start: match.index, end: match.index + match[0].length });
    }
    while ((match = inlineRegex.exec(html)) !== null) {
      matches.push({ latex: match[1], display: false, start: match.index, end: match.index + match[0].length });
    }
    // 按起始位置排序，并去除重叠（理论上不会重叠，但安全起见）
    matches.sort((a, b) => a.start - b.start);
    const unique = [];
    let lastEnd = -1;
    for (const m of matches) {
      if (m.start >= lastEnd) {
        unique.push(m);
        lastEnd = m.end;
      }
    }
    matches = unique;

    if (matches.length === 0) return html;

    // 2. 并行渲染所有公式
    const replacements = await Promise.all(matches.map(m => renderLatex(m.latex, m.display)));

    // 3. 从后往前替换原字符串
    let result = html;
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      result = result.slice(0, m.start) + replacements[i] + result.slice(m.end);
    }

    // 4. 后处理：将 <span> 内的块级元素（如 <section>）拆分为平级
    const parser = new DOMParser();
    const doc = parser.parseFromString(result, 'text/html');
    const body = doc.body;

    const spans = Array.from(body.querySelectorAll('span'));
    for (const span of spans) {
      const children = Array.from(span.childNodes);
      const hasBlockChild = children.some(child => 
        child.nodeType === 1 && (child.tagName === 'SECTION' || child.tagName === 'DIV' || child.tagName === 'P')
      );
      if (hasBlockChild) {
        const parent = span.parentNode;
        const spanStyle = span.getAttribute('style') || '';
        const spanClass = span.getAttribute('class') || '';
        const fragment = doc.createDocumentFragment();
        for (const child of children) {
          if (child.nodeType === 3) { // 文本节点
            const text = child.textContent;
            if (text.trim()) {
              const newSpan = doc.createElement('span');
              if (spanStyle) newSpan.setAttribute('style', spanStyle);
              if (spanClass) newSpan.setAttribute('class', spanClass);
              newSpan.textContent = text;
              fragment.appendChild(newSpan);
            }
          } else {
            fragment.appendChild(child.cloneNode(true));
          }
        }
        parent.replaceChild(fragment, span);
      }
    }

    return body.innerHTML;
  }

  // 通知 background 更新图标
  function notifyState() {
    chrome.runtime.sendMessage({ type: 'updateState', isOpen: isOpen }).catch(e => console.debug(e));
  }

  // 等待原生编辑器出现
  function waitForOriginalEditor() {
    return new Promise((resolve) => {
      const target = document.querySelector('div.rich_media_content div.ProseMirror[contenteditable="true"]');
      if (target) {
        resolve(target);
        return;
      }
      const observer = new MutationObserver((_, obs) => {
        const el = document.querySelector('div.rich_media_content div.ProseMirror[contenteditable="true"]');
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
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

    processNode(body);
    return body.innerHTML;
  }

  // 美化 HTML
  function formatHTML(html) {
    html = flattenSpanNesting(html);   // 先处理嵌套 span
    let cleaned = html.replace(/&nbsp;|&#160;/g, ' ');
    let formatted = '';
    let indent = 0;
    const tokens = cleaned.split(/(<[^>]+>)/g);
    for (let token of tokens) {
      if (token.match(/^<[^>]+>$/)) {
        if (token.match(/^<\//)) {
          indent = Math.max(0, indent - 1);
          formatted += '  '.repeat(indent) + token + '\n';
        } else if (token.match(/\/>$/)) {
          formatted += '  '.repeat(indent) + token + '\n';
        } else {
          formatted += '  '.repeat(indent) + token + '\n';
          indent++;
        }
      } else {
        const lines = token.split(/\r?\n/);
        for (let line of lines) {
          if (line.trim() === '') continue;
          formatted += line + '\n';
        }
      }
    }
    return formatted.trim();
  }

  // 压缩 HTML（写回时使用）
  function minifyHTML(html) {
    // let minify = html.replace(/>\s+</g, '><').trim();
    // minify = minify.replace(/>\s+/g, '>');
    // minify = minify.replace(/\s+</g, '<');
    // return minify;
    const lines = html.split(/\r?\n/);
    let minify = "";
    for (let line of lines) {
      if (line.match(/^\s+<[^>]+>$/)) line = line.trim();
      minify += line;
    }
    return minify;
  }

  function applyTheme() {
    if (!cmEditor) return;
    const themeName = isDarkTheme ? 'material-darker' : 'eclipse';
    cmEditor.setOption('theme', themeName);
    // loadThemeCSS(themeName);
    if (overlay) {
      overlay.style.backgroundColor = isDarkTheme ? '#1e1e1e' : '#f5f5f5';
    }
    const toolbar = document.querySelector('.wx-fullscreen-toolbar');
    if (toolbar) {
      toolbar.style.backgroundColor = isDarkTheme ? '#2d2d2d' : '#e0e0e0';
      const buttons = toolbar.querySelectorAll('button:not(.wx-exit-btn)');
      buttons.forEach(btn => {
        btn.style.backgroundColor = isDarkTheme ? '#555' : '#f0f0f0';
        btn.style.color = isDarkTheme ? 'white' : 'black';
      });
      const themeLabel = toolbar.querySelector('span#themeDesc');
      if (themeLabel) {
        themeLabel.style.color = isDarkTheme ? 'white' : 'black';
      }
      const themeSwitch = toolbar.querySelector('#theme-toggle');
      if (themeSwitch) themeSwitch.checked = !isDarkTheme;
    }
    // 退出按钮保持固定红色背景、白色文字（已内联样式，无需额外处理）
  }

  // 预设替换规则下拉菜单
  function showReplaceDropdown(anchorElement) {
    if (replaceDropdown) replaceDropdown.remove();
    replaceDropdown = document.createElement('div');
    replaceDropdown.className = 'wx-replace-dropdown';
    replaceDropdown.style.cssText = `
      position: fixed;
      background: white;
      border: 1px solid #ccc;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      z-index: 2147483647;
      min-width: 200px;
    `;
    const rect = anchorElement.getBoundingClientRect();
    replaceDropdown.style.top = `${rect.bottom + 4}px`;
    replaceDropdown.style.right = `${window.innerWidth - rect.right}px`;

    chrome.storage.sync.get({ replaceRules: [] }, (data) => {
      const rules = data.replaceRules;
      const container = document.createElement('div');
      
      if (rules.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.textContent = '暂无规则，请添加';
        emptyMsg.style.padding = '8px';
        emptyMsg.style.color = '#999';
        container.appendChild(emptyMsg);
      } else {
        const list = document.createElement('ul');
        list.style.margin = '0';
        list.style.padding = '4px 0';
        list.style.listStyle = 'none';
        rules.forEach(rule => {
          const item = document.createElement('li');
          item.textContent = rule.name;
          item.style.padding = '6px 12px';
          item.style.cursor = 'pointer';
          item.style.fontSize = '12px';
          item.onmouseover = () => item.style.backgroundColor = '#f0f0f0';
          item.onmouseout = () => item.style.backgroundColor = 'transparent';
          item.onclick = () => {
            applyReplaceRule(rule);
            replaceDropdown.remove();
            replaceDropdown = null;
          };
          list.appendChild(item);
        });
        container.appendChild(list);
      }
      
      const hr = document.createElement('hr');
      hr.style.margin = '4px 0';
      container.appendChild(hr);
      
      const manageBtn = document.createElement('div');
      manageBtn.textContent = '⚙️ 管理规则';
      manageBtn.style.padding = '8px 12px';
      manageBtn.style.cursor = 'pointer';
      manageBtn.style.fontSize = '12px';
      manageBtn.style.borderTop = '1px solid #eee';
      manageBtn.onmouseover = () => manageBtn.style.backgroundColor = '#f0f0f0';
      manageBtn.onmouseout = () => manageBtn.style.backgroundColor = 'transparent';
      manageBtn.onclick = () => {
        chrome.runtime.sendMessage({ type: 'openOptionsPage' });
        replaceDropdown.remove();
        replaceDropdown = null;
        document.removeEventListener('click', closeDropdown);
      };
      container.appendChild(manageBtn);
        
      replaceDropdown.appendChild(container);
      document.body.appendChild(replaceDropdown);
      // 新增：点击其他区域关闭
      function closeDropdown(e) {
        if (!replaceDropdown) return;                       // 关键：已关闭则直接返回
        if (!replaceDropdown.contains(e.target) && e.target !== anchorElement) {
          replaceDropdown.remove();
          replaceDropdown = null;
          document.removeEventListener('click', closeDropdown);
        }
      }
      // 确保先移除旧的监听，避免重复
      document.removeEventListener('click', closeDropdown);
      setTimeout(() => {
        document.addEventListener('click', closeDropdown);
      }, 0);
    });
  }

  function applyReplaceRule(rule) {
    if (!cmEditor) return;
    let regex;
    try {
      regex = new RegExp(rule.regex, 'g');
    } catch (e) {
      alert(`正则表达式错误: ${rule.regex}`);
      return;
    }
    const text = cmEditor.getValue();
    // 计算匹配数量（使用 match 方法）
    let matchCount = 0;
    const matches = text.match(regex);
    if (matches) matchCount = matches.length;
    if (matchCount === 0) {
      showNotification(`没有找到匹配项: ${rule.regex}`, 1500);
      return;
    }
    // 执行替换（支持 $1, $& 等）
    const newText = text.replace(regex, rule.replacement);
    cmEditor.setValue(newText);
    showNotification(`已替换 ${matchCount} 处匹配`, 2000);
  }

  // 创建全屏编辑器
  function createFullscreenEditor(initialHTML) {
    overlay = document.createElement('div');
    overlay.className = 'wx-fullscreen-cm';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 2147483647;
      background-color: ${isDarkTheme ? '#E9E9E9' : '#f5f5f5'};
      display: flex;
      flex-direction: column;
      overflow: hidden;
    `;

    const toolbar = document.createElement('div');
    toolbar.className = 'wx-fullscreen-toolbar';
    toolbar.style.cssText = `background:#e0e0e0;padding: 8px 16px; text-align: right; flex-shrink: 0;`;
    
    toolbar.innerHTML = `
      <div class="theme-switch-wrapper" style="display:inline-flex;vertical-align: middle;align-items:center;padding:6px 12px;">
        <label class="theme-switch" for="theme-toggle">
          <input type="checkbox" id="theme-toggle" ${isDarkTheme ? '' : 'checked'}>
          <span class="slider round"></span>
        </label>
        <span id="themeDesc" style="margin-left:6px;">亮色</span>
      </div>
      <button hidden class="wx-prettify-btn" title="美化HTML" style="background:#f0f0f0;border:none;padding:6px 12px;margin-left:8px;border-radius:4px;cursor:pointer;">格式化...</button>
      <button hidden class="wx-svg-btn" title="处理SVG" style="background:#f0f0f0;border:none;padding:6px 12px;margin-left:8px;border-radius:4px;cursor:pointer;">处理 SVG...</button>
      <button class="wx-latex-btn" title="渲染LaTeX公式" style="background:#f0f0f0;border:none;padding:6px 12px;margin-left:8px;border-radius:4px;cursor:pointer;">LaTeX2SVG...</button>
      <button class="wx-replace-btn" title="预设替换规则" style="background:#f0f0f0;border:none;padding:6px 12px;margin-left:8px;border-radius:4px;cursor:pointer;">正则替换...</button>
      <button class="wx-exit-btn" title="退出编辑" style="background:#f44336;color:white;border:none;padding:6px 12px;margin-left:8px;border-radius:4px;cursor:pointer;">✕</button>
    `;
    overlay.appendChild(toolbar);

    const cmContainer = document.createElement('div');
    cmContainer.style.flex = '1';
    cmContainer.style.overflow = 'auto';
    overlay.appendChild(cmContainer);
    document.body.appendChild(overlay);

    cmEditor = CodeMirror(cmContainer, {
      value: initialHTML,
      mode: 'htmlmixed',
      theme: isDarkTheme ? 'material-darker' : 'eclipse',
      lineNumbers: true,
      lineWrapping: true,
      indentUnit: 2,
      autoCloseTags: true,
      matchBrackets: true,
      viewportMargin: Infinity
    });
    cmEditor.setSize('100%', '100%');
    setTimeout(() => cmEditor.refresh(), 0);

    toolbar.querySelector('.wx-prettify-btn').onclick = () => {
      cmEditor.setValue(formatHTML(cmEditor.getValue()));
    };
    // toolbar.querySelector('.wx-svg-btn').onclick = processSVGInHTML;
    // toolbar.querySelector('.wx-theme-btn').onclick = toggleTheme;
    toolbar.querySelector('.wx-replace-btn').onclick = (e) => showReplaceDropdown(e.target);
    toolbar.querySelector('.wx-exit-btn').onclick = () => toggleEditor();
    const themeSwitch = toolbar.querySelector('#theme-toggle');
    if (themeSwitch) {
      themeSwitch.addEventListener('change', (e) => {
        setTimeout(() => {
          isDarkTheme = !e.target.checked;
          applyTheme();
          // if (themeLabel) themeLabel.textContent = isDarkTheme ? '暗色' : '亮色';
        }, 0);
      });
      toolbar.querySelector('.wx-latex-btn').onclick = async () => {
        if (!cmEditor) return;
        const currentHTML = cmEditor.getValue();
        showNotification('正在渲染 LaTeX...', 1000);
        try {
          const newHTML = await convertLatexToSVG(currentHTML);
          cmEditor.setValue(newHTML);
          showNotification('LaTeX 渲染完成', 1500);
        } catch (err) {
          console.error(err);
          showNotification('渲染失败，请检查 MathJax 是否加载', 2000);
        }
      };
    }
    return overlay;
  }

  async function toggleEditor() {
    if (!originalEditor) {
      originalEditor = await waitForOriginalEditor();
      if (!originalEditor) return;
    }
    const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    isDarkTheme = darkModeQuery.matches;
    if (!isOpen) {
      const currentHTML = originalEditor.innerHTML;
      if (!overlay) {
        createFullscreenEditor(currentHTML);
      } else {
        cmEditor.setValue(currentHTML);
        overlay.style.display = 'flex';
      }
      applyTheme();
      cmEditor.setValue(formatHTML(currentHTML));
      originalEditor.style.display = 'none';
      isOpen = true;
      notifyState();
    } else {
      const newHtml = await processSVGInHTML(cmEditor.getValue());
      const compactHTML = minifyHTML(newHtml);
      originalEditor.innerHTML = compactHTML;
      originalEditor.dispatchEvent(new Event('input', { bubbles: true }));
      originalEditor.style.display = '';
      overlay.style.display = 'none';
      if (replaceDropdown) replaceDropdown.remove();
      isOpen = false;
      notifyState();
    }
  }

  // 在微信编辑器工具栏中插入“HTML”按钮
  // ==================== 新增：LaTex 按钮 ====================
  function addFloatingButtons() {
    // 避免重复添加
    if (document.getElementById('wx-custom-html-btn')) return;

    // 创建 HTML 按钮（原有逻辑）
    const target = document.querySelector('div#ai_layout_container > div');
    if (!target) {
      setTimeout(addFloatingButtons, 500);
      return;
    }

    const htmlBtn = document.createElement('button');
    htmlBtn.id = 'wx-custom-html-btn';
    htmlBtn.textContent = 'HTML';
    htmlBtn.style.cssText = `
      position: fixed;
      width: 106px;
      height: 36px;
      background: #2f8532;
      color: white;
      border: none;
      border-radius: 36px;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      z-index: 2147483647;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      transition: all 0.2s;
    `;
    htmlBtn.onmouseover = () => htmlBtn.style.background = '#05a50d';
    htmlBtn.onmouseout = () => htmlBtn.style.background = '#2f8532';
    htmlBtn.onclick = () => toggleEditor(); // 全局切换全屏编辑器

    document.body.appendChild(htmlBtn);

    // 创建 LaTex 按钮（位于 HTML 按钮上方 44px）
    const latexBtn = document.createElement('button');
    latexBtn.id = 'wx-latex-btn';
    latexBtn.textContent = 'LaTex';
    latexBtn.style.cssText = htmlBtn.style.cssText;
    latexBtn.onmouseover = () => latexBtn.style.background = '#05a50d';
    latexBtn.onmouseout = () => latexBtn.style.background = '#2f8532';
    latexBtn.onclick = () => processMathInOriginalEditor();

    document.body.appendChild(latexBtn);

    function updateButtonPositions() {
      const rect = target.getBoundingClientRect();
      if (rect.top > 0) {
        const topPos = rect.top - 60;
        htmlBtn.style.top = `${topPos}px`;
        latexBtn.style.top = `${topPos - 44}px`;
      } else {
        htmlBtn.style.top = '10px';
        latexBtn.style.top = '10px';
      }
      const leftPos = `${rect.left + (rect.width / 2) - 53}px`;
      htmlBtn.style.left = leftPos;
      latexBtn.style.left = leftPos;
    }

    window.addEventListener('scroll', updateButtonPositions);
    window.addEventListener('resize', updateButtonPositions);
    updateButtonPositions();
  }

  // ==================== 公式处理核心 ====================
  async function processMathInOriginalEditor() {
    if (!originalEditor) {
      originalEditor = await waitForOriginalEditor();
      if (!originalEditor) return;
    }
    showNotification('正在处理 LaTeX 公式...', 1000);
    const html = originalEditor.innerHTML;
    try {
      const converted = await convertLatexInHTML(html);
      const final = await processSVGInHTML(converted); // 优化 SVG
      originalEditor.innerHTML = final;
      originalEditor.dispatchEvent(new Event('input', { bubbles: true }));
      showNotification('LaTeX 公式处理完成', 2000);
    } catch (err) {
      console.error(err);
      showNotification('处理失败，请查看控制台', 3000);
    }
  }

  async function convertLatexInHTML(html) {
    await waitForMathJax();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const body = doc.body;

    // 获取最末级段落（内部无 section/p）
    function getLeafParagraphs(root) {
      const result = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
        acceptNode: (node) => {
          if (node.tagName === 'SECTION' || node.tagName === 'P') {
            const hasChildBlock = Array.from(node.querySelectorAll('section, p')).some(child => child !== node);
            if (!hasChildBlock) return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        }
      });
      while (walker.nextNode()) result.push(walker.currentNode);
      return result;
    }

    async function renderLatexToSVGString(latex) {
      const node = await MathJax.tex2svgPromise(latex, { display: true });
      const svg = node.querySelector('svg');
      if (!svg) throw new Error('MathJax 未返回 SVG');
      svg.style.width = 'auto';
      svg.style.height = 'auto';
      svg.setAttribute('data-latex', latex);
      const svgString = svg.outerHTML;
      return svgString;
    }

    // 处理行内公式（在段落 HTML 字符串内替换）
    async function processInlineLatexInElement(htmlString) {
      const inlineRegex = /\$([^\$].*?)\$/g;
      let matches = [];
      let match;
      while ((match = inlineRegex.exec(htmlString)) !== null) {
        matches.push({ latex: match[1], start: match.index, end: match.index + match[0].length });
      }
      if (matches.length === 0) return htmlString;
      const replacements = await Promise.all(matches.map(m => renderLatexToSVGString(m.latex)));
      let result = htmlString;
      for (let i = matches.length - 1; i >= 0; i--) {
        const m = matches[i];
        result = result.slice(0, m.start) + replacements[i] + result.slice(m.end);
      }
      return result;
    }

    // 从一组段落中提取完整的 LaTeX（基于 textContent，忽略内联标签）
    function extractLatexFromParagraphs(paragraphs) {
      const texts = paragraphs.map(p => p.textContent.trim());
      let combined = texts.join(' ');
      combined = combined.trim();
      if (combined.startsWith('$$') && combined.endsWith('$$')) {
        return combined.slice(2, -2).trim();
      }
      const first = texts[0];
      const last = texts[texts.length - 1];
      if (first.startsWith('$$') && last.endsWith('$$')) {
        let inner = first.slice(2) + ' ' + texts.slice(1, -1).join(' ') + ' ' + last.slice(0, -2);
        return inner.trim();
      }
      return null;
    }

    // 获取所有最末级段落
    const leafParas = getLeafParagraphs(body);
    
    // 构建段落组：基于 textContent 判断是否为块级公式的开头或结尾
    const groups = [];
    let currentGroup = [];
    for (const para of leafParas) {
      const text = para.textContent.trim();
      if (currentGroup.length===0 && text.startsWith('$$')) {
        currentGroup.push(para);
        // console.log(text);
        if (text.length>2 && text.endsWith('$$')) {
          groups.push(currentGroup);
          currentGroup = [];
          // console.log(`group length: 1`);
        }
      } else if (currentGroup.length > 0 && !text.endsWith('$$')) {
        currentGroup.push(para);
        // console.log(text);
      } else if (currentGroup.length > 0 && text.endsWith('$$')){
          currentGroup.push(para);
          groups.push(currentGroup);
          // console.log(`group length: ${currentGroup.length}`);
          currentGroup = [];
      } else {
        const inlineRegex = /\$([^\$].*?)\$/g;
        let match;
        if ((match = inlineRegex.exec(text)) !== null) groups.push([para]);
      }
    }
    if (currentGroup.length) groups.push(currentGroup);

    // 处理每个组
    for (const group of groups) {
      if (group.length === 1) {
        const para = group[0];
        const text = para.textContent.trim();
        if (text.startsWith('$$') && text.endsWith('$$')) {
          const latex = text.slice(2, -2).trim();
          // console.log(`in one line ${latex}`)
          try {
            const svgString = await renderLatexToSVGString(latex);
            const wrapper = doc.createElement('section');
            wrapper.style.textAlign = 'center';
            wrapper.style.margin = '1em 0';
            wrapper.innerHTML = svgString;
            para.parentNode.replaceChild(wrapper, para);
            continue;
          } catch (err) {
            console.warn('块级公式渲染失败，保持原段落', err);
          }
        }
        // 处理行内公式
        const originalHtml = para.outerHTML;
        const newHtml = await processInlineLatexInElement(originalHtml);
        if (newHtml !== originalHtml) {
          const tempDiv = doc.createElement('div');
          tempDiv.innerHTML = flattenSpanNesting(newHtml);
          const newNode = tempDiv.firstChild;
          // console.log(newNode.outerHTML)
          para.parentNode.replaceChild(newNode, para);
        }
      } else {
        const latex = extractLatexFromParagraphs(group);
        // console.log(`in multiple lines: ${latex}`)
        if (latex) {
          try {
            const svgString = await renderLatexToSVGString(latex);
            const wrapper = doc.createElement('section');
            wrapper.style.textAlign = 'center';
            wrapper.style.margin = '1em 0';
            wrapper.innerHTML = svgString;
            const firstPara = group[0];
            const parent = firstPara.parentNode;
            const referenceNode = group[group.length - 1].nextSibling;
            for (const para of group) para.remove();
            parent.insertBefore(wrapper, referenceNode);
            continue;
          } catch (err) {
            console.warn('跨段落块级公式渲染失败，回退到行内处理', err);
          }
        }
        // 回退：分别处理每个段落（行内公式）
        for (const para of group) {
          const originalHtml = para.outerHTML;
          const newHtml = await processInlineLatexInElement(originalHtml);
          if (newHtml !== originalHtml) {
            const tempDiv = doc.createElement('div');
            tempDiv.innerHTML = flattenSpanNesting(newHtml);
            const newNode = tempDiv.firstChild;
            para.parentNode.replaceChild(newNode, para);
          }
        }
      }
    }

    return body.innerHTML;
  }

  // 改造 processSVGInHTML 为接受参数
  async function processSVGInHTML(htmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    const svgs = doc.querySelectorAll('svg');
    if (svgs.length === 0) return htmlString;
    let processedCount = 0;
    for (const svg of svgs) {
      if (svg.getAttribute('data-wx-processed') === 'true') continue;
      try {
        const processedSvgString = processSvg(svg);
        const newSvg = parser.parseFromString(processedSvgString, 'image/svg+xml').documentElement;
        newSvg.setAttribute('data-wx-processed', 'true');
        svg.parentNode.replaceChild(newSvg, svg);
        processedCount++;
      } catch (e) {
        console.warn('处理 SVG 失败:', e);
      }
    }
    return processedCount > 0 ? doc.body.innerHTML : htmlString;
  }

  async function init() {
    await waitForOriginalEditor();
    addFloatingButtons();
    // addToolbarButton();          // 插入工具栏按钮
    // loadThemeCSS('eclipse'); // 预加载浅色主题
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.type === 'toggleFullscreenEditor') {
        toggleEditor();
        sendResponse({ success: true });
      }
    });
  }

  init();
})();