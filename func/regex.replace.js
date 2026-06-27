// 预设替换规则下拉菜单
function showReplaceDropdown(anchorElement) {
  const replaceDropdownExisting = getreplaceDropdown();
  if (replaceDropdownExisting) replaceDropdownExisting.remove();
  const replaceDropdown = document.createElement('div');
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
window.showReplaceDropdown=showReplaceDropdown;

function applyReplaceRule(rule) {
  const cmEditor = getCmEditor();
  if (!cmEditor) {
    showNotification(`没有找到编辑器！`, 1500);
  }
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