// svg-processor.js - 在 Chrome Extension 中使用

/**
 * 处理 SVG DOM，将所有 class 引用转为内联 style，展开 <use>，清理 defs 等。
 * @param {SVGSVGElement|Element} svgElement - SVG 根元素或任意 SVG 元素（必须包含完整文档）
 * @returns {string} 处理后的 SVG 字符串
 */
function processSvg(svgElement) {
    // 深拷贝一份，避免修改原 DOM
    const doc = svgElement.ownerDocument;
    const clonedSvg = svgElement.cloneNode(true);
    
    const namespaces = { svg: 'http://www.w3.org/2000/svg' };
    const defs = clonedSvg.querySelector('defs');
    
    // 存储解析结果
    const styleDefs = {};          // 类名 -> 样式字符串
    const clipPaths = new Map();   // clipPath id -> 元素
    const reusableElements = new Map(); // id -> 可重用元素（path, rect, circle, g, text 等）
    const styleElementsToRemove = [];
    
    // 可重用的标签列表（不包含 clipPath 和 style）
    const reusableTags = ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'g', 'text'];
    
    if (defs) {
        // 处理 <style> 元素
        const styleTags = defs.querySelectorAll('style');
        styleTags.forEach(styleTag => {
            const cssText = styleTag.textContent;
            if (cssText) {
                parseCss(cssText, styleDefs);
            }
            styleElementsToRemove.push(styleTag);
        });
        
        // 处理 <clipPath> 元素
        const clipPathTags = defs.querySelectorAll('clipPath');
        clipPathTags.forEach(clipPath => {
            const id = clipPath.getAttribute('id');
            if (id) {
                clipPaths.set(id, clipPath);
            }
        });
        
        // 收集可重用元素（有 id 的图形元素）
        reusableTags.forEach(tagName => {
            const elems = defs.querySelectorAll(tagName);
            elems.forEach(elem => {
                const id = elem.getAttribute('id');
                if (id) {
                    reusableElements.set(id, elem);
                }
            });
        });
    }
    
    // 1. 处理 class 样式和 clip-path
    const graphicElements = [
        'rect', 'circle', 'ellipse', 'line', 'polyline',
        'polygon', 'path', 'text', 'g', 'use'
    ];
    const allElements = clonedSvg.querySelectorAll(graphicElements.join(','));
    allElements.forEach(elem => {
        processElementStyles(elem, styleDefs, clipPaths);
    });
    
    // 2. 替换 <use> 元素（递归展开）
    replaceUseElements(clonedSvg, reusableElements);
    
    // 3. 清理 <defs>
    if (defs) {
        // 删除 <style> 元素
        styleElementsToRemove.forEach(styleElem => {
            if (styleElem.parentNode === defs) defs.removeChild(styleElem);
        });
        // 删除可重用元素（已展开）
        reusableTags.forEach(tagName => {
            const elems = defs.querySelectorAll(tagName);
            elems.forEach(elem => {
                if (elem.parentNode === defs) defs.removeChild(elem);
            });
        });
        // 如果 defs 变空则删除整个 defs
        if (defs.children.length === 0) {
            defs.parentNode.removeChild(defs);
        }
    }
    
    // 返回序列化后的字符串
    return new XMLSerializer().serializeToString(clonedSvg);
}

/**
 * 处理单个元素的 class 样式和内联 style，以及 clip-path 包装
 */
function processElementStyles(element, styleDefs, clipPaths) {
    // 处理 class 样式
    const className = element.getAttribute('class');
    if (className && styleDefs[className]) {
        const currentStyle = element.getAttribute('style') || '';
        const classStyle = styleDefs[className];
        const mergedStyle = mergeStyles(classStyle, currentStyle);
        element.setAttribute('style', mergedStyle);
        element.removeAttribute('class');
    }
    
    // 处理 clip-path 引用
    const clipPathAttr = element.getAttribute('clip-path');
    if (clipPathAttr) {
        const match = clipPathAttr.match(/url\(#([^)]+)\)/);
        if (match) {
            const clipPathId = match[1];
            if (clipPaths.has(clipPathId)) {
                const clipPathElem = clipPaths.get(clipPathId);
                if (clipPathElem && clipPathElem.children.length > 0) {
                    const parent = element.parentNode;
                    if (parent) {
                        // 创建 <g> 包装元素
                        const newGroup = element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
                        newGroup.setAttribute('clip-path', clipPathAttr);
                        parent.replaceChild(newGroup, element);
                        newGroup.appendChild(element);
                    }
                }
                element.removeAttribute('clip-path');
            }
        }
    }
}

/**
 * 合并两个样式字符串，existingStyle 优先级更高
 */
function mergeStyles(classStyle, existingStyle) {
    const toObj = (styleStr) => {
        const obj = {};
        if (!styleStr) return obj;
        styleStr.split(';').forEach(prop => {
            prop = prop.trim();
            if (prop) {
                const [key, value] = prop.split(':');
                if (key && value) obj[key.trim()] = value.trim();
            }
        });
        return obj;
    };
    const classObj = toObj(classStyle);
    const existingObj = toObj(existingStyle);
    const merged = { ...classObj, ...existingObj };
    return Object.entries(merged).map(([k, v]) => `${k}: ${v}`).join('; ');
}

/**
 * 解析简单 CSS，仅支持类选择器，存入 styleDefs
 */
function parseCss(cssText, styleDefs) {
    // 简单正则匹配 .classname { ... }
    const ruleRegex = /\.([^{]+)\s*\{([^}]+)\}/g;
    let match;
    while ((match = ruleRegex.exec(cssText)) !== null) {
        const className = match[1].trim();
        const styleText = match[2].trim();
        styleDefs[className] = styleText;
    }
}

/**
 * 递归替换所有 <use> 元素为实际定义元素
 */
function replaceUseElements(root, reusableElements) {
    // 收集所有 <use> 及其父节点和索引（避免遍历时修改树）
    const usesToReplace = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
        acceptNode: (node) => {
            if (node.tagName === 'use') return NodeFilter.FILTER_ACCEPT;
            return NodeFilter.FILTER_SKIP;
        }
    });
    while (walker.nextNode()) {
        const useElem = walker.currentNode;
        const parent = useElem.parentNode;
        if (parent) {
            const children = Array.from(parent.children);
            const index = children.indexOf(useElem);
            usesToReplace.push({ parent, useElem, index });
        }
    }
    
    for (const { parent, useElem, index } of usesToReplace) {
        const href = useElem.getAttribute('href') || useElem.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (href && href.startsWith('#')) {
            const refId = href.slice(1);
            if (reusableElements.has(refId)) {
                const original = reusableElements.get(refId);
                // 深拷贝定义元素
                const newElem = original.cloneNode(true);
                // 删除原定义的 id
                newElem.removeAttribute('id');
                
                // 复制 use 上的属性（排除特殊属性）
                for (const attr of useElem.attributes) {
                    const attrName = attr.name;
                    if (['href', 'xlink:href', 'x', 'y', 'class', 'id'].includes(attrName)) continue;
                    newElem.setAttribute(attrName, attr.value);
                }
                
                // 处理 x, y 属性 -> translate 变换
                const x = useElem.getAttribute('x');
                const y = useElem.getAttribute('y');
                const existingTransform = useElem.getAttribute('transform') || '';
                if (x !== null || y !== null) {
                    const tx = x !== null ? x : '0';
                    const ty = y !== null ? y : '0';
                    const translate = `translate(${tx}, ${ty})`;
                    const newTransform = `${translate} ${existingTransform}`.trim();
                    newElem.setAttribute('transform', newTransform);
                }
                
                // 合并 style
                const useStyle = useElem.getAttribute('style');
                if (useStyle) {
                    const existingStyle = newElem.getAttribute('style') || '';
                    const mergedStyle = mergeStyles(existingStyle, useStyle);
                    newElem.setAttribute('style', mergedStyle);
                }
                
                // 替换原 use 元素
                parent.replaceChild(newElem, useElem);
                
                // 递归处理新元素内可能存在的 use
                replaceUseElements(newElem, reusableElements);
            } else {
                console.warn(`未找到 id 为 ${refId} 的可重用元素`);
            }
        } else {
            console.warn(`use 元素的 href 属性无效: ${href}`);
        }
    }
}

// 导出函数（用于模块化，若在扩展中使用可直接挂载到 window）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { processSvg };
} else {
    window.processSvg = processSvg;
}