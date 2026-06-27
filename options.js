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