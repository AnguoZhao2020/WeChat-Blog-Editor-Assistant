window.MathJax = {
  loader: {
    paths: {
      // 关键：将 'fonts' 这个命名空间指向你的本地字体目录
      fonts: chrome.runtime.getURL('libs/MathJax/fonts'),
    }
  },
  output: {
    fontPath: '[fonts]/%%FONT%%-font'
  },
  tex: {
    inlineMath: [['$', '$'], ['\\(', '\\)']],
    displayMath: [['$$', '$$'], ['\\[', '\\]']],
  },
  svg: {
    fontCache: 'local'
  },
  startup: { typeset: false }
};