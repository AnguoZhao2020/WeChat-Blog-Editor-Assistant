document.addEventListener('DOMContentLoaded', () => {
    const rowsContainer = document.getElementById('rows-container');
    const addRowBtn = document.getElementById('add-row-btn');
    const template = document.getElementById('row-template');
    
    const exportSizeInput = document.getElementById('export-size');
    const exportColorInput = document.getElementById('export-color');
    const exportBgColorInput = document.getElementById('export-bg-color');
    const exportBgTransparentBtn = document.getElementById('export-bg-transparent-btn');

    // Background: transparent toggle
    let bgTransparent = true;
    exportBgTransparentBtn.addEventListener('click', () => {
        bgTransparent = !bgTransparent;
        exportBgTransparentBtn.classList.toggle('active', bgTransparent);
        exportBgColorInput.disabled = bgTransparent;
    });

    // Default equations
    const eq1 = "x=\\sin\\left(\\frac{\\pi}{6}\\right)";
    const eq2 = "\\langle a^{\\dagger n}a^m \\rangle\n=\n\\langle\\psi|a^{\\dagger n}a^m |\\psi\\rangle";
    const eq3 = "\\rho=\\begin{pmatrix}\nP_0 & c_{01}^* \\\\\nc_{01} & P_1 \n\\end{pmatrix}";

    // Wait for MathJax to be ready before adding the first row
    const waitForMathJax = setInterval(() => {
        if (window.MathJax && window.MathJax.tex2svgPromise) {
            clearInterval(waitForMathJax);
            addRow(eq1);
            addRow(eq2);
            addRow(eq3);
        }
    }, 100);

    // Add new row handler
    addRowBtn.addEventListener('click', () => {
        addRow("");
    });

    function addRow(initialLatex) {
        const rowFrag = template.content.cloneNode(true);
        const rowEl = rowFrag.querySelector('.equation-row');
        
        const input = rowEl.querySelector('.latex-input');
        const svgContainer = rowEl.querySelector('.svg-output');
        const errorMsg = rowEl.querySelector('.error-msg');
        const removeBtn = rowEl.querySelector('.remove-row-btn');
        
        const copySvgBtn = rowEl.querySelector('.copy-svg-btn');
        const copyPngBtn = rowEl.querySelector('.copy-png-btn');
        const copyDropdownContainer = rowEl.querySelector('.copy-dropdown-container');
        const copyBtn = rowEl.querySelector('.copy-btn');
        const downloadDropdownContainer = rowEl.querySelector('.download-dropdown-container');
        const downloadBtn = rowEl.querySelector('.download-btn');
        const downloadSvgBtn = rowEl.querySelector('.download-svg-btn');
        const downloadPngBtn = rowEl.querySelector('.download-png-btn');
        const downloadPdfBtn = rowEl.querySelector('.download-pdf-btn');

        input.value = initialLatex;

        // Render initially
        if (initialLatex) {
            renderMath(initialLatex, svgContainer, errorMsg);
        }

        // Debounce input
        let timeout = null;
        input.addEventListener('input', () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                renderMath(input.value, svgContainer, errorMsg);
            }, 300);
        });

        // Remove row
        removeBtn.addEventListener('click', () => {
            rowEl.remove();
        });

        // Copy dropdown toggle
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.copy-dropdown-container.active, .download-dropdown-container.active').forEach(el => {
                if (el !== copyDropdownContainer) el.classList.remove('active');
            });
            copyDropdownContainer.classList.toggle('active');
        });

        // Dropdown toggle
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // prevent document click from closing immediately
            // Close other dropdowns
            document.querySelectorAll('.download-dropdown-container.active').forEach(el => {
                if (el !== downloadDropdownContainer) el.classList.remove('active');
            });
            downloadDropdownContainer.classList.toggle('active');
        });

        // Action Buttons
        copySvgBtn.addEventListener('click', () => {
            handleCopySvg(svgContainer, copyBtn);
            copyDropdownContainer.classList.remove('active');
        });
        copyPngBtn.addEventListener('click', () => {
            handleCopyPng(svgContainer, copyBtn);
            copyDropdownContainer.classList.remove('active');
        });
        downloadSvgBtn.addEventListener('click', () => {
            handleDownloadSvg(svgContainer);
            downloadDropdownContainer.classList.remove('active');
        });
        downloadPngBtn.addEventListener('click', () => {
            handleDownloadImage(svgContainer);
            downloadDropdownContainer.classList.remove('active');
        });
        downloadPdfBtn.addEventListener('click', () => {
            handleDownloadPdf(svgContainer);
            downloadDropdownContainer.classList.remove('active');
        });

        rowsContainer.appendChild(rowFrag);
    }

    // Close dropdowns when clicking outside
    document.addEventListener('click', () => {
        document.querySelectorAll('.download-dropdown-container.active, .copy-dropdown-container.active').forEach(el => {
            el.classList.remove('active');
        });
    });

    function renderMath(latex, container, errorMsg) {
        if (!latex.trim()) {
            container.innerHTML = '';
            errorMsg.style.display = 'none';
            return;
        }

        MathJax.tex2svgPromise(latex, {display: true}).then((node) => {
            container.innerHTML = '';
            container.appendChild(node);
            
            const svg = container.querySelector('svg');
            if (svg) {
                svg.style.width = 'auto';
                svg.style.height = 'auto';
            }

            errorMsg.style.display = 'none';
        }).catch((err) => {
            errorMsg.textContent = err.message;
            errorMsg.style.display = 'block';
        });
    }

    // --- Export Helpers --- //

    // Gets a serialized, self-contained SVG string styled for export
    function getSvgString(container) {
        const svg = container.querySelector('svg');
        if (!svg) return null;

        const clone = svg.cloneNode(true);
        const exportColor = exportColorInput.value;
        const exportSize = parseInt(exportSizeInput.value) || 32;
        
        // 1. Calculate exact pixel dimensions by rendering it temporarily
        const tempDiv = document.createElement('div');
        tempDiv.style.fontSize = `${exportSize}px`;
        // MathJax uses ex units relative to font-size. 
        // We append the clone to measure how the browser resolves its width/height.
        tempDiv.appendChild(clone.cloneNode(true));
        document.body.appendChild(tempDiv);
        const tempSvg = tempDiv.querySelector('svg');
        const rect = tempSvg.getBoundingClientRect();
        document.body.removeChild(tempDiv);

        // 2. Set precise width and height without px suffix to avoid parser NaN issues
        clone.setAttribute('width', `${rect.width.toFixed(3)}`);
        clone.setAttribute('height', `${rect.height.toFixed(3)}`);
        
        // 3. Clean up the style and attributes to match a standard standalone SVG
        clone.removeAttribute('focusable');
        clone.removeAttribute('role');
        clone.removeAttribute('aria-hidden');
        clone.removeAttribute('style'); // clear MathJax inline styles instead of setting to empty string
        
        // Emulate the requested semantic structure by adding data-latex to the math node
        const mathG = clone.querySelector('g[data-mml-node="math"]');
        if (mathG) {
            const input = container.closest('.equation-row').querySelector('.latex-input');
            if (input) {
                mathG.setAttribute('data-latex', input.value);
            }
        }
        
        // Add namespaces
        clone.setAttribute('xmlns', "http://www.w3.org/2000/svg");
        clone.setAttribute('xmlns:xlink', "http://www.w3.org/1999/xlink");
        
        // 4. Serialize to string
        const serializer = new XMLSerializer();
        let svgString = serializer.serializeToString(clone);
        
        // 5. Replace currentColor with the exact exportColor string
        svgString = svgString.replace(/currentColor/g, exportColor);

        // 5b. Apply background color if not transparent
        // Use viewBox coords so the rect covers negative-Y regions that MathJax uses
        if (!bgTransparent) {
            const bg = exportBgColorInput.value;
            const vbMatch = clone.getAttribute('viewBox');
            let rectAttrs;
            if (vbMatch) {
                const [vx, vy, vw, vh] = vbMatch.trim().split(/[\s,]+/).map(Number);
                rectAttrs = `x="${vx}" y="${vy}" width="${vw}" height="${vh}"`;
            } else {
                rectAttrs = `width="100%" height="100%"`;
            }
            svgString = svgString.replace(
                /(<svg[^>]*>)/,
                `$1<rect ${rectAttrs} fill="${bg}"/>`
            );
        }
        
        // 6. Fix for svg2pdf: empty path data d="" causes NaN / hpf errors
        svgString = svgString.replace(/d=""/g, 'd="M 0 0"');
        
        // 7. Return with standard XML declaration
        return '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n' + svgString;
    }

    async function handleCopySvg(container, btn) {
        const svgString = getSvgString(container);
        if (!svgString) return;

        try {
            if (window.ClipboardItem) {
                const svgBlob = new Blob([svgString], { type: 'image/svg+xml' });
                await navigator.clipboard.write([new ClipboardItem({ 'image/svg+xml': svgBlob })]);
            } else {
                await navigator.clipboard.writeText(svgString);
            }
            flashSuccess(btn);
        } catch (err) {
            console.error('Copy SVG failed, falling back to text', err);
            try {
                await navigator.clipboard.writeText(svgString);
                flashSuccess(btn);
            } catch {
                alert('Failed to copy SVG to clipboard.');
            }
        }
    }

    async function handleCopyPng(container, btn) {
        createSvgCanvas(container, async (canvas) => {
            try {
                canvas.toBlob(async (blob) => {
                    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                    flashSuccess(btn);
                }, 'image/png');
            } catch (err) {
                alert('Failed to copy PNG to clipboard: ' + err.message);
            }
        });
    }

    function flashSuccess(btn) {
        const originalIcon = btn.innerHTML;
        btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="green" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        setTimeout(() => { btn.innerHTML = originalIcon; }, 2000);
    }

    function handleDownloadSvg(container) {
        const svgString = getSvgString(container);
        if (!svgString) return;

        const blob = new Blob([svgString], {type: "image/svg+xml;charset=utf-8"});
        const url = URL.createObjectURL(blob);
        triggerDownload(url, 'expression.svg');
    }

    function createSvgCanvas(container, callback) {
        const svgString = getSvgString(container);
        if (!svgString) return;

        // Read dimensions directly from the SVG attributes set by getSvgString (no remeasure needed)
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');
        const parsedSvg = svgDoc.querySelector('svg');
        const svgWidth = parseFloat(parsedSvg.getAttribute('width'));
        const svgHeight = parseFloat(parsedSvg.getAttribute('height'));

        const img = new Image();
        const svgBlob = new Blob([svgString], {type: "image/svg+xml;charset=utf-8"});
        const url = URL.createObjectURL(svgBlob);

        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            const scale = 2; // 2x per axis = 4x pixel density
            canvas.width = svgWidth * scale;
            canvas.height = svgHeight * scale;

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            
            callback(canvas);
        };
        img.src = url;
    }

    function handleDownloadImage(container) {
        createSvgCanvas(container, (canvas) => {
            const imgURL = canvas.toDataURL("image/png");
            triggerDownload(imgURL, 'expression.png');
        });
    }

    async function handleDownloadPdf(container) {
        const svgString = getSvgString(container);
        if (!svgString) return;

        // Create a temporary element to hold the SVG so we can parse its dimensions
        const tempDiv = document.createElement('div');
        // Hide it so it doesn't flash on screen
        tempDiv.style.position = 'absolute';
        tempDiv.style.left = '-9999px';
        tempDiv.innerHTML = svgString;
        document.body.appendChild(tempDiv);
        
        const svgElement = tempDiv.querySelector('svg');
        
        const width = parseFloat(svgElement.getAttribute('width'));
        const height = parseFloat(svgElement.getAttribute('height'));

        const { jsPDF } = window.jspdf;
        const padding = 20;
        const pdfWidth = width + padding * 2;
        const pdfHeight = height + padding * 2;

        // Use pt for exact 1:1 mapping with the SVG pixel coordinates
        const pdf = new jsPDF('l', 'pt', [pdfWidth, pdfHeight]);
        
        try {
            await pdf.svg(svgElement, {
                x: padding,
                y: padding,
                width: width,
                height: height
            });
            pdf.save('expression.pdf');
        } catch (err) {
            console.error('Error generating PDF:', err);
            alert('Failed to generate vector PDF: ' + err.message);
        } finally {
            document.body.removeChild(tempDiv);
        }
    }

    function triggerDownload(url, filename) {
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
});
