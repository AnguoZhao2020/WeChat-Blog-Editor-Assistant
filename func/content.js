(() => {
  let isOpen = false;
  window.__IS_OPEN__ = isOpen;
  let overlay = null;
  let isDarkTheme = false;
  let originalEditor = null;
  let cmEditor = null;

  // 通知 background 更新图标
  function notifyState() {
    chrome.runtime.sendMessage({ type: 'updateState', isOpen: isOpen }).catch(e => console.debug(e));
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

  // 辅助函数：实际执行模板替换
  function applyTemplateByKey(rootKey, jsonData, templateHtml) {
    const data = (typeof jsonData === 'object' && jsonData !== null) ? jsonData : jsonData;
    let newHtml = templateHtml.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const parts = path.trim().split('.');
      let value = data;
      for (const part of parts) {
        if (value && typeof value === 'object' && part in value) {
          value = value[part];
        } else {
          return '';
        }
      }
      return value !== undefined && value !== null ? String(value) : '';
    });
    cmEditor.setValue(newHtml);
    cmEditor.refresh();
    showNotification(`模板 "${rootKey}" 套用成功`, 1500);
  }  

  async function applyTemplate() {
    if (!isOpen || !cmEditor) {
      showNotification('请先打开全屏 HTML 编辑器', 2000);
      return;
    }
    const html = cmEditor.getValue();
    // 提取纯文本（忽略所有 HTML 标签）
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const text = doc.body.textContent.trim();
    if (!text) {
      showNotification('当前内容为空', 2000);
      return;
    }
    // 尝试解析 JSON
    let json;
    try {
      json = parseObjectLiteral(text);
    } catch (e) {
      showNotification('内容不是有效的 JSON', 2000);
      return;
    }
    // 获取模板库
    const result = await new Promise(resolve => {
      chrome.storage.local.get({ templates: {} }, resolve);
    });
    const templates = result.templates;
    const keys = Object.keys(json);

    // 2. 收集用户输入的所有顶层键
    const inputKeys = new Set(keys);

    // 3. 确定每个输入键所属的模板
    const keyToTemplateMap = {}; // 键 -> 模板根键
    for (const [templateKey, templateData] of Object.entries(templates)) {
      const templateKeys = new Set(templateData.keys || []);
      for (const inputKey of inputKeys) {
        if (templateKeys.has(inputKey)) {
          if (keyToTemplateMap[inputKey] && keyToTemplateMap[inputKey] !== templateKey) {
            showNotification(`键 "${inputKey}" 同时出现在多个模板中，请检查模板配置`, 3000);
            return;
          }
          keyToTemplateMap[inputKey] = templateKey;
        }
      }
    }

    // 检查是否所有输入键都有所属模板
    for (const inputKey of inputKeys) {
      if (!keyToTemplateMap[inputKey]) {
        showNotification(`键 "${inputKey}" 未在任何模板中找到`, 3000);
        return;
      }
    }

    // 检查所有输入键是否属于同一个模板
    const templateKeysSet = new Set(Object.values(keyToTemplateMap));
    if (templateKeysSet.size > 1) {
      showNotification(`输入键分属于多个模板（${[...templateKeysSet].join(', ')}），请确保所有键属于同一模板`, 3000);
      return;
    }
    const matchedTemplateKey = templateKeysSet.values().next().value;
    const templateData = templates[matchedTemplateKey];
    const htmlContent = typeof templateData === 'string' ? templateData : templateData.html;
    applyTemplateByKey(matchedTemplateKey, json, htmlContent);
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
      <button class="wx-prettify-btn" title="美化HTML" style="background:#f0f0f0;border:none;padding:6px 12px;margin-left:8px;border-radius:4px;cursor:pointer;">格式化...</button>
      <button hidden class="wx-svg-btn" title="处理SVG" style="background:#f0f0f0;border:none;padding:6px 12px;margin-left:8px;border-radius:4px;cursor:pointer;">处理 SVG...</button>
      <button class="wx-latex-btn" title="渲染LaTeX公式" style="background:#f0f0f0;border:none;padding:6px 12px;margin-left:8px;border-radius:4px;cursor:pointer;">LaTeX2SVG...</button>
      <button class="wx-replace-btn" title="预设替换规则" style="background:#f0f0f0;border:none;padding:6px 12px;margin-left:8px;border-radius:4px;cursor:pointer;">正则替换...</button>
      <button class="wx-template-btn" title="套用模版" style="background:#f0f0f0;border:none;padding:6px 12px;margin-left:8px;border-radius:4px;cursor:pointer;">套用模版...</button>
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
    toolbar.querySelector('.wx-template-btn').onclick = () => applyTemplate();
    toolbar.querySelector('.wx-exit-btn').onclick = () => exitEditor();
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
          const newHTML = await convertLatexInHTML(currentHTML);
          const final = await processSVGInHTML(newHTML);
          cmEditor.setValue(final);
          showNotification('LaTeX 渲染完成', 1500);
        } catch (err) {
          console.error(err);
          showNotification('渲染失败，请检查 MathJax 是否加载', 2000);
        }
      };
    }
    return overlay;
  }

  function getSelectedBlocks() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return [];
    const range = sel.getRangeAt(0);

    // 如果选区折叠（仅光标），则返回光标所在的段落
    if (range.collapsed) {
      const block = getCurrentBlock();
      return block ? [block] : [];
    }

    const startBlock = getBlockOfNode(range.startContainer);
    const endBlock = getBlockOfNode(range.endContainer);
    if (!startBlock || !endBlock) return [];

    // 收集从 startBlock 到 endBlock 的所有段落（按 DOM 顺序）
    const blocks = [];
    let current = startBlock;
    while (current && current !== endBlock.nextElementSibling) {
      // if (current.tagName === 'P' || current.tagName === 'SECTION') {
      //   blocks.push(current);
      // }
      blocks.push(current);
      current = current.nextElementSibling;
    }
    return blocks;
  }

  // 获取选区起始和结束位置的段落
  function getBlockOfNode(node) {
    if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    while (node && node !== document.body) {
      if (node.parentNode.tagName === 'DIV') {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  function getCurrentBlock() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    let node = range.commonAncestorContainer;
    return getBlockOfNode(node);
  }

  async function editCurrentParagraph() {
    const originalEditor = await getOriginalEditor();
    if (originalEditor) originalEditor.focus();
    await new Promise(r => requestAnimationFrame(r));

    const blocks = getSelectedBlocks();
    if (!blocks.length) {
      showNotification('请将光标移动到要编辑的段落内，或选择多个段落', 3000);
      return;
    }

    const combinedHTML = blocks.map(b => b.outerHTML).join('\n');
    window.__EDITING_BLOCKS__ = blocks;

    if (!overlay) {
      createFullscreenEditor(combinedHTML);
    } else {
      cmEditor.setValue(combinedHTML);
      overlay.style.display = 'flex';
      setTimeout(() => cmEditor.refresh(), 50);
    }
    isOpen = true;
    window.__IS_OPEN__ = isOpen;
    notifyState();
  }

  async function exitEditor() {
    if (!cmEditor) return;
    const newHTML = cmEditor.getValue();
    const blocks = window.__EDITING_BLOCKS__;

    if (blocks && blocks.length) {
      const parent = blocks[0].parentNode;
      // 解析编辑后的 HTML 片段
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = minifyHTML(newHTML);
      const newNodes = Array.from(tempDiv.childNodes);
      // 在原位置插入新节点
      const referenceNode = blocks[blocks.length - 1].nextSibling || null;
      for (const node of newNodes) {
        parent.insertBefore(node, referenceNode);
      }
      parent.dispatchEvent(new Event('input', { bubbles: true }));
      // 移除所有原段落
      for (const block of blocks) {
        block.remove();
      }
      delete window.__EDITING_BLOCKS__;
    } else {
      // 回退：全文档替换（极少情况）
      const originalEditor = await getOriginalEditor();
      if (originalEditor) {
        originalEditor.innerHTML = newHTML;
        originalEditor.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    overlay.style.display = 'none';
    isOpen = false;
    window.__IS_OPEN__ = isOpen;
    notifyState();
  }

  async function handleHtmlButtonClick() {
    const data = await chrome.storage.sync.get({ editMode: 'paragraph' });
    window.__EDIT_MODE__ = data.editMode;
    if (data.editMode === 'paragraph') {
      await editCurrentParagraph();
    } else {
      await toggleEditor();
    }
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
      window.__IS_OPEN__ = isOpen;
      notifyState();
    } else {
      const newHtml = cmEditor.getValue();
      const compactHTML = minifyHTML(newHtml);
      originalEditor.innerHTML = compactHTML;
      originalEditor.dispatchEvent(new Event('input', { bubbles: true }));
      originalEditor.style.display = '';
      overlay.style.display = 'none';
      const replaceDropdown = getreplaceDropdown();
      if (replaceDropdown) replaceDropdown.remove();
      isOpen = false;
      window.__IS_OPEN__ = isOpen;
      notifyState();
    }
  }

  async function handleLATEX(){
    const block = getCurrentBlock();
    processMathInOriginalEditor(block);
  }

  function setupLatexDoubleClick(editor) {
    if (!editor) return;
    if (editor._latexDblClickBound) return;
    editor._latexDblClickBound = true;

    editor.addEventListener('dblclick', function(e) {
      e.preventDefault();
      let target = e.target;
      const block = getBlockOfNode(target);
      if (!block) return;
      const clone = block.cloneNode(true);

      // 在该段落内查找所有 SVG[data-latex]
      const svgs = clone.querySelectorAll('svg[data-latex]');
      if (svgs.length === 0) return;

      // 为每个 SVG 找到对应的包裹容器（可能是 span.latex-wrapper 或 section）
      // 并替换为原始 LaTeX 文本
      for (const svg of svgs) {
        const latex = svg.getAttribute('data-latex');
        if (!latex) continue;

        const textNode = document.createTextNode(`\\(${latex}\\)`);
        svg.parentNode.insertBefore(textNode, svg);
        svg.remove();
      }
      block.parentNode.insertBefore(clone, block);

      // 触发 input 事件，通知微信编辑器内容已变更
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }  

  // 在微信编辑器工具栏中插入“HTML”按钮
  // ==================== 新增：LaTex 按钮 ====================
  async function addFloatingButtons() {
    // 避免重复添加
    if (document.getElementById('wx-custom-html-btn')) return;

    // 获取配置的定位选择器
    const config = await new Promise(resolve => {
      chrome.storage.sync.get({ targetSelector: 'div#ai_layout_container > div' }, resolve);
    });
    const targetSelector = config.targetSelector;
    let target = document.querySelector(targetSelector);
    if (!target) {
      console.warn(`未找到目标元素: ${targetSelector}，延迟重试`);
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
    // htmlBtn.onclick = () => toggleEditor(); // 全局切换全屏编辑器
    htmlBtn.onclick = () => handleHtmlButtonClick(); // 全局切换全屏编辑器

    document.body.appendChild(htmlBtn);

    // 创建 LaTex 按钮（位于 HTML 按钮上方 44px）
    const latexBtn = document.createElement('button');
    latexBtn.id = 'wx-latex-btn';
    latexBtn.textContent = 'LaTex';
    latexBtn.style.cssText = htmlBtn.style.cssText;
    latexBtn.onmouseover = () => latexBtn.style.background = '#05a50d';
    latexBtn.onmouseout = () => latexBtn.style.background = '#2f8532';
    latexBtn.onclick = () => handleLATEX();

    document.body.appendChild(latexBtn);

    function updateButtonPositions() {
      // 重新获取目标元素（可能 DOM 有变化，但通常不变）
      const currentTarget = document.querySelector(targetSelector);
      if (!currentTarget) return;
      const rect = currentTarget.getBoundingClientRect();
      // const rect = target.getBoundingClientRect();
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

  async function init() {
    const editor = await waitForOriginalEditor();
    addFloatingButtons();
    setupLatexDoubleClick(editor);  // 启用双击恢复功能
  }

  init();
})();