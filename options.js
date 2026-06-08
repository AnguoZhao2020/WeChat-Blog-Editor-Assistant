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
}

// 加载已保存规则
chrome.storage.sync.get({ [storageKey]: [] }, (data) => {
  rules = data[storageKey];
  renderTable();
});

document.getElementById('addRule').addEventListener('click', addRule);
document.getElementById('saveRules').addEventListener('click', saveRules);