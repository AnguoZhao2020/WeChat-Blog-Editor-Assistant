// 1. Define the arrays of files to inject
const scriptsToInject = [
  "libs/codemirror/codemirror.min.js",
  "libs/codemirror/mode/xml.min.js",
  "libs/codemirror/mode/javascript.min.js",
  "libs/codemirror/mode/css.min.js",
  "libs/codemirror/mode/htmlmixed.min.js",
  "libs/mathjax-config.js", 
  "libs/MathJax/tex-svg.js",
  "libs/MathJax/double-struck.js",
  "func/svg-processor.js",
  "func/math.js",
  "func/content.common.js",
  "func/regex.replace.js",
  "func/content.js"  
];
const cssToInject = [
  "libs/codemirror/codemirror.min.css",
  "libs/codemirror/theme/material-darker.min.css",
  "libs/codemirror/theme/material.min.css",
  "libs/codemirror/theme/ttcn.min.css",
  "libs/codemirror/theme/eclipse.min.css",
  "styles.css"  
]; // Leave empty [] if you don't need CSS

// 2. Helper function to inject a single script and wait for it to finish loading
async function injectScript(fileName) {
  const scriptUrl = chrome.runtime.getURL(fileName);
  await import(scriptUrl); 
}

function injectMainWorldScript(path) {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL(path);
  script.onload = () => script.remove();      // 加载成功后移除标签
  script.onerror = (e) => {
    console.error(`注入主世界脚本失败: ${path}`, e);
    script.remove();                          // 失败时也移除
  };
  (document.head || document.documentElement).appendChild(script);
}

// 3. Helper function to inject CSS (CSS can load asynchronously)
function injectCSS(fileName) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL(fileName);
  (document.head || document.documentElement).appendChild(link);
}

// 4. Main function to run the loop
async function initializeInjection() {
  // Inject CSS files first (if any)
  cssToInject.forEach(cssFile => injectCSS(cssFile));
  
  // Inject JS files sequentially using a for...of loop
  for (const scriptFile of scriptsToInject) {
    try {
      await injectScript(scriptFile);
      // console.log(`${scriptFile} is loaded...`);
    } catch (error) {
      console.error(`Stopping injection sequence due to error:`, error);
      break; // Stop the loop if a critical script fails to load
    }
  }
}

// Execute the process
initializeInjection();
