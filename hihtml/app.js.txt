(() => {
  'use strict';

  const HH_CONFIG = Object.freeze({
    storageKey: 'hihtml-settings-v1',
    pollIntervalMs: 1000,
    realtimeDelayMs: 180,
    cdn: Object.freeze({
      htmlMinifier: [
        'https://cdn.jsdelivr.net/npm/html-minifier-terser@7.2.0/dist/htmlminifier.umd.bundle.min.js',
        'https://unpkg.com/html-minifier-terser@7.2.0/dist/htmlminifier.umd.bundle.min.js'
      ],
      htmlBeautify: [
        'https://cdnjs.cloudflare.com/ajax/libs/js-beautify/2.0.3/beautify-html.min.js',
        'https://cdn.jsdelivr.net/npm/js-beautify@2.0.3/js/lib/beautify-html.js'
      ],
      cssBeautify: [
        'https://cdnjs.cloudflare.com/ajax/libs/js-beautify/2.0.3/beautify-css.min.js',
        'https://cdn.jsdelivr.net/npm/js-beautify@2.0.3/js/lib/beautify-css.js'
      ],
      jsBeautify: [
        'https://cdnjs.cloudflare.com/ajax/libs/js-beautify/2.0.3/beautify.min.js',
        'https://cdn.jsdelivr.net/npm/js-beautify@2.0.3/js/lib/beautify.js'
      ]
    })
  });

  const HH_STATE = {
    mode: 'compress',
    settings: {
      css: true,
      javascript: true,
      indentSize: 2
    },
    fileHandle: null,
    fileName: '',
    lastLoadedContent: '',
    lastModified: 0,
    lastResult: '',
    processing: false,
    processingTimer: null,
    pollTimer: null,
    enginePromises: new Map()
  };

  const hhDom = {};

  function logInfo(message, data) {
    if (typeof data === 'undefined') console.info(`[HiHTML] ${message}`);
    else console.info(`[HiHTML] ${message}`, data);
  }

  function logWarn(message, data) {
    if (typeof data === 'undefined') console.warn(`[HiHTML] ${message}`);
    else console.warn(`[HiHTML] ${message}`, data);
  }

  function logError(message, error) {
    if (typeof error === 'undefined') console.error(`[HiHTML] ${message}`);
    else console.error(`[HiHTML] ${message}`, error);
  }

  function uiText(key, ...args) {
    const table = window.HH_I18N;
    const value = table ? table[key] : '';
    if (typeof value === 'function') return value(...args);
    return typeof value === 'string' ? value : key;
  }

  function collectDom() {
    const ids = [
      'html-input', 'html-output', 'file-input', 'open-file-button', 'clear-input-button',
      'copy-button', 'download-button', 'save-button', 'compress-tab', 'format-tab',
      'css-switch', 'javascript-switch', 'indent-2-button', 'indent-4-button',
      'action-status', 'file-status', 'result-meta', 'drop-overlay', 'sr-status'
    ];
    ids.forEach((id) => {
      hhDom[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id);
      if (!hhDom[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())]) {
        logError(`Required element is unavailable: #${id}`);
      }
    });
  }

  function saveSettings() {
    try {
      localStorage.setItem(HH_CONFIG.storageKey, JSON.stringify(HH_STATE.settings));
      logInfo('Settings saved.', HH_STATE.settings);
    } catch (error) {
      logWarn('Settings could not be saved to localStorage.', error);
    }
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(HH_CONFIG.storageKey);
      if (!raw) {
        logInfo('No saved settings found. Defaults are used.');
        return;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        HH_STATE.settings.css = parsed.css !== false;
        HH_STATE.settings.javascript = parsed.javascript !== false;
        HH_STATE.settings.indentSize = parsed.indentSize === 4 ? 4 : 2;
      }
      logInfo('Settings loaded.', HH_STATE.settings);
    } catch (error) {
      logError('Settings could not be loaded.', error);
    }
  }

  function updateSettingsUi() {
    if (hhDom.cssSwitch) hhDom.cssSwitch.selected = HH_STATE.settings.css;
    if (hhDom.javascriptSwitch) hhDom.javascriptSwitch.selected = HH_STATE.settings.javascript;
    [hhDom.indent2Button, hhDom.indent4Button].forEach((button) => {
      if (!button) return;
      const size = Number(button.dataset.indent);
      button.dataset.active = String(size === HH_STATE.settings.indentSize);
    });
  }

  function setStatus(message, isError = false) {
    if (!hhDom.actionStatus) {
      logError('Action status element is unavailable.');
      return;
    }
    hhDom.actionStatus.textContent = message;
    hhDom.actionStatus.dataset.error = String(isError);
    if (hhDom.srStatus) hhDom.srStatus.textContent = message;
  }

  function announce(message) {
    if (!hhDom.srStatus) {
      logError('Screen reader status element is unavailable.');
      return;
    }
    hhDom.srStatus.textContent = '';
    window.setTimeout(() => {
      if (hhDom.srStatus) hhDom.srStatus.textContent = message;
    }, 20);
  }

  function getInputHtml() {
    if (!hhDom.htmlInput) throw new Error('HTML input element is unavailable.');
    return String(hhDom.htmlInput.value || '');
  }

  function byteLength(value) {
    try {
      return new TextEncoder().encode(String(value || '')).byteLength;
    } catch (error) {
      logWarn('TextEncoder is unavailable; Blob size fallback is used.', error);
      return new Blob([String(value || '')]).size;
    }
  }

  function formatSize(bytes) {
    return uiText('size', bytes);
  }

  function calculateReduction(originalBytes, outputBytes) {
    if (originalBytes <= 0) return 0;
    return ((originalBytes - outputBytes) / originalBytes) * 100;
  }

  function updateFileUi() {
    if (!hhDom.fileStatus) {
      logError('File status element is unavailable.');
      return;
    }
    hhDom.fileStatus.textContent = HH_STATE.fileHandle && HH_STATE.fileName
      ? uiText('editingFile', HH_STATE.fileName)
      : uiText('noOpenFile');
    if (hhDom.saveButton) hhDom.saveButton.disabled = !HH_STATE.fileHandle || !HH_STATE.lastResult || HH_STATE.processing;
  }

  function setProcessing(value) {
    HH_STATE.processing = Boolean(value);
    if (hhDom.copyButton) hhDom.copyButton.disabled = HH_STATE.processing || !HH_STATE.lastResult;
    if (hhDom.downloadButton) hhDom.downloadButton.disabled = HH_STATE.processing || !HH_STATE.lastResult;
    updateFileUi();
  }

  function updateModeUi() {
    if (hhDom.compressTab) hhDom.compressTab.active = HH_STATE.mode === 'compress';
    if (hhDom.formatTab) hhDom.formatTab.active = HH_STATE.mode === 'format';
  }

  function setMode(mode, shouldProcess = true) {
    if (mode !== 'compress' && mode !== 'format') {
      logError(`Unsupported mode requested: ${mode}`);
      return;
    }
    HH_STATE.mode = mode;
    updateModeUi();
    logInfo('Processing mode changed.', mode);
    if (shouldProcess) scheduleRealtimeProcessing(true);
  }

  function injectExternalScript(engine, urls, check) {
    if (check()) return Promise.resolve();
    const normalized = Array.isArray(urls) ? urls.filter(Boolean) : [];
    if (normalized.length === 0) return Promise.reject(new Error(`No CDN URLs configured for ${engine}.`));

    const existingPromise = HH_STATE.enginePromises.get(engine);
    if (existingPromise) return existingPromise;

    const promise = (async () => {
      let lastError = null;
      for (const src of normalized) {
        if (check()) {
          logInfo(`External engine already available: ${engine}.`);
          return;
        }
        try {
          await new Promise((resolve, reject) => {
            const existing = Array.from(document.scripts).find((script) => script.dataset.hihtmlEngine === engine && script.src === src);
            if (existing) {
              const onLoad = () => {
                cleanup();
                check() ? resolve() : reject(new Error(`Loaded but API is unavailable: ${src}`));
              };
              const onError = () => {
                cleanup();
                reject(new Error(`External engine failed to load: ${src}`));
              };
              const timeoutId = window.setTimeout(() => {
                cleanup();
                reject(new Error(`External engine load timed out: ${src}`));
              }, 8000);
              const cleanup = () => {
                window.clearTimeout(timeoutId);
                existing.removeEventListener('load', onLoad);
                existing.removeEventListener('error', onError);
              };
              existing.addEventListener('load', onLoad, { once: true });
              existing.addEventListener('error', onError, { once: true });
              return;
            }
            const script = document.createElement('script');
            if (!script) {
              reject(new Error(`Script element could not be created for ${src}`));
              return;
            }
            script.src = src;
            script.async = true;
            script.dataset.hihtmlEngine = engine;
            const timeoutId = window.setTimeout(() => {
              cleanup();
              script.remove();
              reject(new Error(`External engine load timed out: ${src}`));
            }, 8000);
            const cleanup = () => {
              window.clearTimeout(timeoutId);
              script.onload = null;
              script.onerror = null;
            };
            script.onload = () => {
              cleanup();
              if (!check()) {
                reject(new Error(`External engine loaded but API is unavailable: ${src}`));
                return;
              }
              logInfo(`External engine loaded: ${engine}`, { src });
              resolve();
            };
            script.onerror = () => {
              cleanup();
              script.remove();
              reject(new Error(`External engine failed to load: ${src}`));
            };
            document.head.appendChild(script);
          });
          return;
        } catch (error) {
          lastError = error;
          logWarn(`External engine candidate failed: ${engine}`, { src, error });
        }
      }
      throw lastError || new Error(`All external engine URLs failed for ${engine}.`);
    })();

    HH_STATE.enginePromises.set(engine, promise);
    promise.catch(() => HH_STATE.enginePromises.delete(engine));
    return promise;
  }

  async function ensureEngine(engine) {
    const checks = {
      htmlMinifier: () => Boolean(window.HTMLMinifier && typeof window.HTMLMinifier.minify === 'function'),
      htmlBeautify: () => typeof window.html_beautify === 'function',
      cssBeautify: () => typeof window.css_beautify === 'function',
      jsBeautify: () => typeof window.js_beautify === 'function'
    };
    const check = checks[engine];
    if (!check) throw new Error(`Unknown external engine: ${engine}`);
    if (check()) return;
    await injectExternalScript(engine, HH_CONFIG.cdn[engine], check);
    if (!check()) throw new Error(`External engine remains unavailable: ${engine}`);
  }

  function buildCompressOptions() {
    return {
      collapseWhitespace: true,
      conservativeCollapse: false,
      removeComments: true,
      collapseBooleanAttributes: true,
      removeEmptyAttributes: true,
      removeRedundantAttributes: true,
      useShortDoctype: true,
      keepClosingSlash: false,
      includeAutoGeneratedTags: false,
      minifyCSS: HH_STATE.settings.css,
      minifyJS: HH_STATE.settings.javascript
    };
  }

  async function compressHtml(source) {
    await ensureEngine('htmlMinifier');
    const result = await window.HTMLMinifier.minify(source, buildCompressOptions());
    if (typeof result !== 'string') throw new Error('HTMLMinifier returned an invalid result.');
    return result;
  }

  async function formatHtml(source) {
    await ensureEngine('htmlBeautify');

    const html = window.html_beautify(source, {
      indent_size: HH_STATE.settings.indentSize,
      indent_inner_html: true,
      preserve_newlines: true,
      max_preserve_newlines: 2,
      wrap_line_length: 0,
      wrap_attributes: 'auto',
      end_with_newline: true,
      extra_liners: []
    });

    let output = html;

    if (HH_STATE.settings.css) {
      await ensureEngine('cssBeautify');
      output = transformEmbeddedBlocks(output, 'style', (content) => window.css_beautify(content, {
        indent_size: HH_STATE.settings.indentSize,
        newline_between_rules: true,
        end_with_newline: true
      }));
    }

    if (HH_STATE.settings.javascript) {
      await ensureEngine('jsBeautify');
      output = transformEmbeddedBlocks(output, 'script', (content, attrs) => {
        if (/\bapplication\/ld\+json\b/i.test(attrs) || /\bimportmap\b/i.test(attrs)) return content;
        return window.js_beautify(content, {
          indent_size: HH_STATE.settings.indentSize,
          preserve_newlines: true,
          max_preserve_newlines: 2,
          wrap_line_length: 0,
          end_with_newline: true
        });
      });
    }

    return output;
  }

  function transformEmbeddedBlocks(source, tagName, transform) {
    const pattern = new RegExp(`(<${tagName}\\b[^>]*>)([\\s\\S]*?)(</${tagName}\\s*>)`, 'gi');
    return source.replace(pattern, (whole, open, content, close) => {
      const trimmed = content.trim();
      if (!trimmed) return whole;
      try {
        const transformed = transform(trimmed, open);
        if (typeof transformed !== 'string') {
          logError(`Embedded ${tagName} transform returned a non-string result.`);
          return whole;
        }
        const indent = getBlockIndent(whole);
        const normalized = transformed.trim().split('\n').map((line) => `${indent}  ${line}`).join('\n');
        return `${open}\n${normalized}\n${indent}${close}`;
      } catch (error) {
        logError(`Embedded ${tagName} processing failed.`, error);
        return whole;
      }
    });
  }

  function getBlockIndent(whole) {
    const match = whole.match(/^(\s*)<\w/);
    return match ? match[1] : '';
  }

  async function processHtml() {
    const source = getInputHtml();
    if (!source.trim()) {
      HH_STATE.lastResult = '';
      if (hhDom.htmlOutput) hhDom.htmlOutput.value = '';
      if (hhDom.resultMeta) hhDom.resultMeta.textContent = uiText('notProcessed');
      setProcessing(false);
      setStatus(uiText('inputEmpty'));
      logInfo('Processing skipped because input is empty.');
      return;
    }

    setProcessing(true);
    setStatus(uiText('processing'));
    const started = performance.now();

    try {
      const result = HH_STATE.mode === 'compress'
        ? await compressHtml(source)
        : await formatHtml(source);
      HH_STATE.lastResult = result;
      if (hhDom.htmlOutput) hhDom.htmlOutput.value = result;

      const inputBytes = byteLength(source);
      const outputBytes = byteLength(result);
      const reduction = calculateReduction(inputBytes, outputBytes);
      const elapsed = performance.now() - started;

      if (hhDom.resultMeta) {
        hhDom.resultMeta.textContent = `${formatSize(inputBytes)} → ${formatSize(outputBytes)} / ${reduction.toFixed(1)}% / ${elapsed.toFixed(0)} ms`;
      }
      setStatus(HH_STATE.mode === 'compress' ? uiText('compressed') : uiText('formatted'));
      announce(HH_STATE.mode === 'compress' ? uiText('compressed') : uiText('formatted'));
      logInfo('HTML processing completed.', { mode: HH_STATE.mode, inputBytes, outputBytes, reduction, elapsedMs: elapsed });
    } catch (error) {
      HH_STATE.lastResult = '';
      if (hhDom.htmlOutput) hhDom.htmlOutput.value = '';
      if (hhDom.resultMeta) hhDom.resultMeta.textContent = uiText('processingFailed');
      setStatus(`${uiText('processingFailed')} ${error.message || error}`, true);
      announce(uiText('processingFailed'));
      logError('HTML processing failed.', error);
    } finally {
      setProcessing(false);
    }
  }

  function scheduleRealtimeProcessing(immediate = false) {
    if (HH_STATE.processingTimer) window.clearTimeout(HH_STATE.processingTimer);
    if (immediate) {
      void processHtml();
      return;
    }
    HH_STATE.processingTimer = window.setTimeout(() => {
      HH_STATE.processingTimer = null;
      void processHtml();
    }, HH_CONFIG.realtimeDelayMs);
  }

  async function readHandle(handle) {
    if (!handle || typeof handle.getFile !== 'function') throw new Error('Invalid file handle.');
    const file = await handle.getFile();
    const content = await file.text();
    return { file, content };
  }

  async function openWithFileSystemAccess() {
    if (typeof window.showOpenFilePicker !== 'function') return false;
    try {
      const handles = await window.showOpenFilePicker({
        multiple: false,
        excludeAcceptAllOption: false,
        types: [{ description: 'HTML files', accept: { 'text/html': ['.html', '.htm'] } }]
      });
      if (!handles || handles.length === 0) {
        logWarn('File picker returned no handles.');
        return true;
      }
      await loadFileHandle(handles[0], true);
      return true;
    } catch (error) {
      if (error && error.name === 'AbortError') {
        logInfo('File picker was canceled by the user.');
        return true;
      }
      logError('File System Access API open failed.', error);
      return false;
    }
  }

  async function loadFileHandle(handle, announceLoad = true) {
    try {
      const { file, content } = await readHandle(handle);
      HH_STATE.fileHandle = handle;
      HH_STATE.fileName = file.name;
      HH_STATE.lastLoadedContent = content;
      HH_STATE.lastModified = file.lastModified;
      if (!hhDom.htmlInput) throw new Error('HTML input element is unavailable.');
      hhDom.htmlInput.value = content;
      updateFileUi();
      if (hhDom.resultMeta) hhDom.resultMeta.textContent = uiText('notProcessed');
      if (announceLoad) {
        setStatus(uiText('fileLoaded', file.name));
        announce(uiText('fileLoaded', file.name));
      }
      logInfo('HTML file loaded.', { name: file.name, lastModified: file.lastModified, bytes: byteLength(content) });
      scheduleRealtimeProcessing(true);
    } catch (error) {
      setStatus(uiText('readFailed'), true);
      logError('HTML file read failed.', error);
    }
  }

  async function handleFallbackFileInput(event) {
    const input = event && event.target;
    if (!input || !input.files || input.files.length === 0) {
      logWarn('Fallback file input returned no file.');
      return;
    }
    const file = input.files[0];
    try {
      const content = await file.text();
      HH_STATE.fileHandle = null;
      HH_STATE.fileName = file.name;
      HH_STATE.lastLoadedContent = content;
      HH_STATE.lastModified = file.lastModified;
      if (hhDom.htmlInput) hhDom.htmlInput.value = content;
      if (hhDom.fileStatus) hhDom.fileStatus.textContent = uiText('loadedWithoutHandle', file.name);
      setStatus(uiText('fileLoaded', file.name));
      announce(uiText('fileLoaded', file.name));
      logInfo('HTML file loaded through fallback input.', { name: file.name, bytes: byteLength(content) });
      scheduleRealtimeProcessing(true);
    } catch (error) {
      setStatus(uiText('readFailed'), true);
      logError('Fallback HTML file read failed.', error);
    } finally {
      input.value = '';
    }
  }

  async function openFile() {
    const handled = await openWithFileSystemAccess();
    if (handled) return;
    if (!hhDom.fileInput) {
      logError('Fallback file input element is unavailable.');
      setStatus(uiText('fileAccessUnavailable'), true);
      return;
    }
    logWarn('File System Access API is unavailable. Falling back to input[type=file].');
    hhDom.fileInput.click();
  }

  async function pollExternalFile() {
    const handle = HH_STATE.fileHandle;
    if (!handle || typeof handle.getFile !== 'function' || HH_STATE.processing) return;
    try {
      const file = await handle.getFile();
      if (file.lastModified === HH_STATE.lastModified) return;
      const content = await file.text();
      if (content === HH_STATE.lastLoadedContent) {
        HH_STATE.lastModified = file.lastModified;
        return;
      }
      if (!hhDom.htmlInput) {
        logError('HTML input element is unavailable during external file update.');
        return;
      }
      HH_STATE.lastModified = file.lastModified;
      HH_STATE.lastLoadedContent = content;
      hhDom.htmlInput.value = content;
      setStatus(uiText('fileExternallyUpdated', file.name));
      announce(uiText('fileExternallyUpdated', file.name));
      logInfo('External HTML file change detected and applied.', { name: file.name, lastModified: file.lastModified, bytes: byteLength(content) });
      scheduleRealtimeProcessing(true);
    } catch (error) {
      logWarn('External HTML file polling failed.', error);
    }
  }

  function startFilePolling() {
    if (HH_STATE.pollTimer) window.clearInterval(HH_STATE.pollTimer);
    HH_STATE.pollTimer = window.setInterval(() => { void pollExternalFile(); }, HH_CONFIG.pollIntervalMs);
    logInfo('File change polling started.', { intervalMs: HH_CONFIG.pollIntervalMs });
  }

  async function saveToFile() {
    const handle = HH_STATE.fileHandle;
    if (!handle) {
      setStatus(uiText('noOpenFile'), true);
      logWarn('Save requested without an open File System Access handle.');
      return;
    }
    if (!HH_STATE.lastResult) {
      setStatus(uiText('nothingToSave'), true);
      logWarn('Save requested before a processing result existed.');
      return;
    }
    try {
      if (typeof handle.createWritable !== 'function') throw new Error('FileSystemFileHandle.createWritable is unavailable.');
      const writable = await handle.createWritable();
      await writable.write(HH_STATE.lastResult);
      await writable.close();
      const file = await handle.getFile();
      HH_STATE.lastLoadedContent = file.size ? await file.text() : '';
      HH_STATE.lastModified = file.lastModified;
      setStatus(uiText('savedToFile', HH_STATE.fileName));
      announce(uiText('savedToFile', HH_STATE.fileName));
      logInfo('HTML result saved to the opened file.', { name: HH_STATE.fileName, bytes: byteLength(HH_STATE.lastResult) });
    } catch (error) {
      setStatus(uiText('saveFailed'), true);
      logError('HTML file save failed.', error);
    } finally {
      updateFileUi();
    }
  }

  async function copyResult() {
    if (!HH_STATE.lastResult) {
      logWarn('Copy requested without a result.');
      return;
    }
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('Clipboard API is unavailable.');
      await navigator.clipboard.writeText(HH_STATE.lastResult);
      setStatus(uiText('copied'));
      announce(uiText('copied'));
      logInfo('HTML result copied to clipboard.');
    } catch (error) {
      setStatus(uiText('copyFailed'), true);
      logError('Clipboard copy failed.', error);
    }
  }

  function downloadResult() {
    if (!HH_STATE.lastResult) {
      logWarn('Download requested without a result.');
      return;
    }
    try {
      const blob = new Blob([HH_STATE.lastResult], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      if (!url) throw new Error('Object URL could not be created.');
      const anchor = document.createElement('a');
      if (!anchor) throw new Error('Download anchor could not be created.');
      const base = HH_STATE.fileName.replace(/\.(?:html?|HTML?)$/, '') || 'index';
      anchor.href = url;
      anchor.download = `${base}.${HH_STATE.mode}.html`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setStatus(uiText('downloaded'));
      announce(uiText('downloaded'));
      logInfo('HTML result downloaded.', { fileName: anchor.download });
    } catch (error) {
      setStatus(uiText('downloadFailed'), true);
      logError('HTML download failed.', error);
    }
  }

  function clearInput() {
    if (!hhDom.htmlInput) {
      logError('HTML input element is unavailable.');
      return;
    }
    hhDom.htmlInput.value = '';
    HH_STATE.lastResult = '';
    HH_STATE.lastLoadedContent = '';
    if (hhDom.htmlOutput) hhDom.htmlOutput.value = '';
    if (hhDom.resultMeta) hhDom.resultMeta.textContent = uiText('notProcessed');
    setStatus(uiText('inputEmpty'));
    updateFileUi();
    logInfo('HTML input cleared.');
  }

  function bindDropEvents() {
    const shell = document.getElementById('input-editor-shell');
    if (!shell) {
      logError('Input editor shell is unavailable for drag and drop.');
      return;
    }
    const setOverlay = (visible) => {
      if (hhDom.dropOverlay) hhDom.dropOverlay.hidden = !visible;
    };
    shell.addEventListener('dragenter', (event) => { event.preventDefault(); setOverlay(true); });
    shell.addEventListener('dragover', (event) => { event.preventDefault(); setOverlay(true); });
    shell.addEventListener('dragleave', (event) => {
      event.preventDefault();
      if (!shell.contains(event.relatedTarget)) setOverlay(false);
    });
    shell.addEventListener('drop', async (event) => {
      event.preventDefault();
      setOverlay(false);
      const files = event.dataTransfer && event.dataTransfer.files;
      if (!files || files.length === 0) {
        logWarn('Drop event contained no files.');
        return;
      }
      const file = files[0];
      if (!/\.html?$/i.test(file.name)) {
        setStatus(uiText('invalidFileType'), true);
        logWarn('Dropped file was not an HTML file.', file.name);
        return;
      }
      try {
        const content = await file.text();
        HH_STATE.fileHandle = null;
        HH_STATE.fileName = file.name;
        HH_STATE.lastLoadedContent = content;
        HH_STATE.lastModified = file.lastModified;
        if (hhDom.htmlInput) hhDom.htmlInput.value = content;
        setStatus(uiText('fileLoaded', file.name));
        logInfo('HTML file loaded by drag and drop.', { name: file.name, bytes: byteLength(content) });
        scheduleRealtimeProcessing(true);
      } catch (error) {
        setStatus(uiText('readFailed'), true);
        logError('Dropped HTML file read failed.', error);
      }
    });
    logInfo('Drag and drop listeners bound.');
  }

  function bindEvents() {
    if (hhDom.openFileButton) hhDom.openFileButton.addEventListener('click', openFile);
    else logError('Open file button listener could not be bound.');

    if (hhDom.fileInput) hhDom.fileInput.addEventListener('change', handleFallbackFileInput);
    else logError('Fallback file input listener could not be bound.');

    if (hhDom.clearInputButton) hhDom.clearInputButton.addEventListener('click', clearInput);
    else logError('Clear button listener could not be bound.');

    if (hhDom.copyButton) hhDom.copyButton.addEventListener('click', () => { void copyResult(); });
    else logError('Copy button listener could not be bound.');

    if (hhDom.downloadButton) hhDom.downloadButton.addEventListener('click', downloadResult);
    else logError('Download button listener could not be bound.');

    if (hhDom.saveButton) hhDom.saveButton.addEventListener('click', () => { void saveToFile(); });
    else logError('Save button listener could not be bound.');

    if (hhDom.compressTab) hhDom.compressTab.addEventListener('click', () => setMode('compress'));
    else logError('Compress mode tab listener could not be bound.');

    if (hhDom.formatTab) hhDom.formatTab.addEventListener('click', () => setMode('format'));
    else logError('Format mode tab listener could not be bound.');

    if (hhDom.cssSwitch) hhDom.cssSwitch.addEventListener('change', (event) => {
      HH_STATE.settings.css = Boolean(event.target.selected);
      saveSettings();
      logInfo('Embedded CSS processing changed.', HH_STATE.settings.css);
      scheduleRealtimeProcessing(true);
    });
    else logError('CSS switch listener could not be bound.');

    if (hhDom.javascriptSwitch) hhDom.javascriptSwitch.addEventListener('change', (event) => {
      HH_STATE.settings.javascript = Boolean(event.target.selected);
      saveSettings();
      logInfo('Embedded JavaScript processing changed.', HH_STATE.settings.javascript);
      scheduleRealtimeProcessing(true);
    });
    else logError('JavaScript switch listener could not be bound.');

    [hhDom.indent2Button, hhDom.indent4Button].forEach((button) => {
      if (!button) return;
      button.addEventListener('click', () => {
        const indent = Number(button.dataset.indent);
        if (indent !== 2 && indent !== 4) {
          logError(`Invalid indent size: ${indent}`);
          return;
        }
        HH_STATE.settings.indentSize = indent;
        saveSettings();
        updateSettingsUi();
        logInfo('Indent size changed.', indent);
        if (HH_STATE.mode === 'format') scheduleRealtimeProcessing(true);
      });
    });

    if (hhDom.htmlInput) {
      hhDom.htmlInput.addEventListener('input', () => scheduleRealtimeProcessing(false));
      logInfo('Realtime HTML input listener bound.');
    } else logError('Realtime HTML input listener could not be bound.');

    bindDropEvents();
  }

  function initPageMetadata() {
    try {
      const canonical = new URL(window.location.href);
      canonical.hash = '';
      canonical.search = '';
      const canonicalElement = document.getElementById('canonical-url');
      if (!canonicalElement) logError('Canonical link element is unavailable.');
      else canonicalElement.href = canonical.toString();

      const ogUrl = document.querySelector('meta[property="og:url"]');
      if (!ogUrl) logError('OG URL metadata element is unavailable.');
      else ogUrl.content = canonical.toString();

      const ldJson = document.querySelector('script[type="application/ld+json"]');
      if (!ldJson) logError('Structured data element is unavailable.');
      else {
        try {
          const data = JSON.parse(ldJson.textContent || '{}');
          data.url = canonical.toString();
          ldJson.textContent = JSON.stringify(data);
        } catch (error) {
          logError('Structured data JSON could not be updated.', error);
        }
      }
      logInfo('Page metadata initialized.');
    } catch (error) {
      logError('Page metadata initialization failed.', error);
    }
  }

  function initialize() {
    collectDom();
    loadSettings();
    bindEvents();
    updateSettingsUi();
    updateModeUi();
    updateFileUi();
    initPageMetadata();
    startFilePolling();
    setStatus(uiText('inputEmpty'));
    logInfo('HiHTML 調整ツール initialization completed.', { mode: HH_STATE.mode, settings: HH_STATE.settings });
  }

  document.addEventListener('DOMContentLoaded', initialize, { once: true });
})();
