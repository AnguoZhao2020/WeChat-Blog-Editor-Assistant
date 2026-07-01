const storageKey = 'replaceRules';
let rules = [];

function renderTable() {
  const tbody = document.querySelector('#rulesTable tbody');
  tbody.innerHTML = '';
  rules.forEach((rule, index) => {
    const row = tbody.insertRow();
    row.insertCell(0).textContent = rule.name;
    row.insertCell(1).textContent = rule.regex;
    row.insertCell(2).textContent = rule.replacement;
    const actionsCell = row.insertCell(3);
    const editBtn = document.createElement('button');
    editBtn.textContent = '编辑';
    editBtn.onclick = () => editRule(index);
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '删除';
    deleteBtn.onclick = () => deleteRule(index);
    actionsCell.appendChild(editBtn);
    actionsCell.appendChild(deleteBtn);
  });
}

function editRule(index) {
  const rule = rules[index];
  document.getElementById('ruleName').value = rule.name;
  document.getElementById('ruleRegex').value = rule.regex;
  document.getElementById('ruleReplacement').value = rule.replacement;
  // 移除原规则，等用户添加
  rules.splice(index, 1);
  renderTable();
}

function deleteRule(index) {
  rules.splice(index, 1);
  renderTable();
}

function addRule() {
  const name = document.getElementById('ruleName').value.trim();
  const regex = document.getElementById('ruleRegex').value.trim();
  const replacement = document.getElementById('ruleReplacement').value;
  if (!name || !regex) {
    alert('名称和正则表达式不能为空');
    return;
  }
  // 简单验证正则
  try {
    new RegExp(regex);
  } catch (e) {
    alert('正则表达式无效: ' + e.message);
    return;
  }
  rules.push({ name, regex, replacement });
  renderTable();
  // 清空输入框
  document.getElementById('ruleName').value = '';
  document.getElementById('ruleRegex').value = '';
  document.getElementById('ruleReplacement').value = '';
}

function saveRules() {
  chrome.storage.sync.set({ [storageKey]: rules }, () => {
    const status = document.getElementById('status');
    status.textContent = '已保存';
    status.className = '';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
  // ... 保存 replaceRules 的代码 ...
  const editorSelector = editorSelectorInput.value.trim();
  chrome.storage.sync.set({ editorSelector }, () => {
    // 提示保存成功
  });
  // 在 saveAll 函数中增加
  const targetSelectorVal = targetSelector.value.trim();
  chrome.storage.sync.set({ targetSelector: targetSelectorVal });

  const editMode = document.querySelector('input[name="editMode"]:checked').value;
  chrome.storage.sync.set({ editMode: editMode });

  const processScope = document.getElementById('processScope').value;
  const maxFormulas = parseInt(document.getElementById('maxFormulas').value) || 0;
  chrome.storage.sync.set({ processScope: processScope, maxFormulas: maxFormulas });
}

// 加载已保存规则
chrome.storage.sync.get({ [storageKey]: [] }, (data) => {
  rules = data[storageKey];
  renderTable();
});

// 加载已存储的选择器
const editorSelectorInput = document.getElementById('editorSelector');
chrome.storage.sync.get({ editorSelector: 'div.rich_media_content div.ProseMirror[contenteditable="true"]' }, (data) => {
  editorSelectorInput.value = data.editorSelector;
});

// 加载时读取
chrome.storage.sync.get({ editMode: 'paragraph' }, (data) => {
  document.querySelector(`input[name="editMode"][value="${data.editMode}"]`).checked = true;
});

chrome.storage.sync.get({
  processScope: 'document',
  maxFormulas: 0
}, (data) => {
  document.getElementById('processScope').value = data.processScope;
  document.getElementById('maxFormulas').value = data.maxFormulas;
});

// 在 loadConfig 函数中增加
const targetSelector = document.getElementById('targetSelector');
chrome.storage.sync.get({ targetSelector: 'div#ai_layout_container > div' }, (data) => {
  targetSelector.value = data.targetSelector;
});

document.getElementById('addRule').addEventListener('click', addRule);
document.getElementById('saveRules').addEventListener('click', saveRules);

function loadTemplates() {
  chrome.storage.local.get({ templates: {} }, (data) => {
    const templates = data.templates;
    const tbody = document.querySelector('#templateTable tbody');
    tbody.innerHTML = '';
    for (const [key, value] of Object.entries(templates)) {
      const html = typeof value === 'string' ? value : value.html;
      const keys = Array.isArray(value.keys) ? value.keys : [];
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${key}</td>
        <td><pre style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${html}</pre></td>
        <td>${keys.join(', ')}</td>
        <td>
          <button class="edit-template" data-key="${key}">编辑</button>
          <button class="delete-template" data-key="${key}">删除</button>
        </td>
      `;
      tbody.appendChild(tr);
    }
    // 绑定事件
    tbody.querySelectorAll('.edit-template').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        document.getElementById('templateKey').value = key;
        document.getElementById('templateHtml').value = templates[key];
      });
    });
    tbody.querySelectorAll('.delete-template').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        if (confirm(`确定删除模板 "${key}" 吗？`)) {
          delete templates[key];
          chrome.storage.local.set({ templates }, loadTemplates);
        }
      });
    });
  });
}

document.getElementById('addTemplateBtn').addEventListener('click', () => {
  const key = document.getElementById('templateKey').value.trim();
  const html = document.getElementById('templateHtml').value.trim();
  if (!key || !html) {
    alert('根键和模板 HTML 都不能为空');
    return;
  }

  // 解析模板中的所有占位符键
  const keys = extractKeys(html);
  keys.add(key); // 加入根键本身

  // 获取所有现有模板（包括当前正在编辑的）
  chrome.storage.local.get({ templates: {} }, (data) => {
    const templates = data.templates;
    // 检查键是否与其他模板冲突（除了自身）
    for (const [existingKey, existingTemplate] of Object.entries(templates)) {
      // 如果是更新同一个模板，跳过自身
      if (existingKey === key) continue;
      const existingKeys = new Set(existingTemplate.keys || []);
      // 检查是否有交集
      for (const k of keys) {
        if (existingKeys.has(k)) {
          alert(`键 "${k}" 已在模板 "${existingKey}" 中使用，请修改占位符或键名`);
          return;
        }
      }
    }

    // 保存模板，同时保存键集合
    templates[key] = {
      html: html,
      keys: Array.from(keys)
    };
    chrome.storage.local.set({ templates }, () => {
      loadTemplates();
      document.getElementById('templateKey').value = '';
      document.getElementById('templateHtml').value = '';
    });
  });
});

// 辅助：提取模板中的占位符键
function extractKeys(html) {
  const keys = new Set();
  const regex = /\{\{([^}]+)\}\}/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    keys.add(match[1].trim());
  }
  return keys;
}

// 初始化
loadTemplates();

// 加载日志
function loadLogs() {
  chrome.storage.local.get({ extensionLogs: [] }, (data) => {
    const logs = data.extensionLogs;
    const logContent = document.getElementById('logContent');
    if (logs.length === 0) {
      logContent.textContent = '暂无日志';
      return;
    }
    // 倒序显示（最新的在前）
    const reversed = logs.slice().reverse();
    const lines = reversed.map(entry => {
      const time = entry.timestamp;
      const level = entry.level.toUpperCase();
      const msg = entry.message;
      return `[${time}] [${level}] ${msg}`;
    });
    logContent.textContent = lines.join('\n');
  });
}

// 清空日志
document.getElementById('clearLogs').addEventListener('click', () => {
  if (confirm('确定清空所有日志吗？')) {
    chrome.storage.local.set({ extensionLogs: [] }, loadLogs);
  }
});

document.getElementById('refreshLogs').addEventListener('click', loadLogs);

// 初始加载
loadLogs();

(function() {
  const menuItems = document.querySelectorAll('.menu-item');
  const panels = {
    general: document.getElementById('section-general'),
    rules: document.getElementById('section-rules'),
    templates: document.getElementById('section-templates'),
    logs: document.getElementById('section-logs')
  };

  // 切换面板
  function showPanel(target) {
    // 隐藏所有面板
    Object.values(panels).forEach(p => p.classList.remove('active'));
    // 显示目标
    if (panels[target]) panels[target].classList.add('active');
    // 更新菜单状态
    menuItems.forEach(item => {
      item.classList.toggle('active', item.dataset.target === target);
    });
  }

  // 绑定点击事件
  menuItems.forEach(item => {
    item.addEventListener('click', function(e) {
      const target = this.dataset.target;
      if (target) showPanel(target);
    });
  });

  // 如果 URL 有 hash，则跳转到对应面板
  const hash = window.location.hash.replace('#', '');
  if (hash && panels[hash]) {
    showPanel(hash);
  }
})();