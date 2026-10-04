const HC_CONFIG = Object.freeze({
  settingsStorageKey: 'hicss-settings-v2',
  outputFileName: 'style.css',
  realtimeDebounceMs: 180,
  fileWatchIntervalMs: 1000,
  cdn: Object.freeze({
    cleanCss: 'https://esm.sh/clean-css@5.3.3?bundle&target=es2020',
    cleanCssFallbacks: Object.freeze([
      'https://cdn.skypack.dev/clean-css@5.3.3'
    ]),
    jsBeautifyCss: 'https://cdnjs.cloudflare.com/ajax/libs/js-beautify/2.0.3/beautify-css.min.js'
  })
});

const HC_STATE = {
  settings: {
    duplicateRemoval: false,
    indentSize: 2
  },
  activeMode: 'compress',
  lastResult: '',
  lastStats: null,
  processing: false,
  scheduledTimer: null,
  processSequence: 0,
  enginePromises: new Map(),
  fileHandle: null,
  fileName: '',
  fileLastModified: 0,
  fileLastSize: 0,
  fileWatchTimer: null,
  fileWatchBusy: false,
  cleanCssConstructor: null
};

const hcDom = {};

const HC_SUPPORTED_LANGUAGES = Object.freeze([
  'ja',
  'en',
  'zh-CN',
  'zh-TW',
  'ko',
  'ko-KP'
]);

const HC_LANGUAGE_NAMES = Object.freeze({
  ja: Object.freeze({ ja: '日本語', en: 'Japanese', 'zh-CN': '日语', 'zh-TW': '日語', ko: '일본어', 'ko-KP': '일본어' }),
  en: Object.freeze({ ja: '英語', en: 'English', 'zh-CN': '英语', 'zh-TW': '英語', ko: '영어', 'ko-KP': '영어' }),
  'zh-CN': Object.freeze({ ja: '中国語（簡体字）', en: 'Simplified Chinese', 'zh-CN': '简体中文', 'zh-TW': '簡體中文', ko: '중국어(간체)', 'ko-KP': '중국어(간체)' }),
  'zh-TW': Object.freeze({ ja: '中国語（繁体字）', en: 'Traditional Chinese', 'zh-CN': '繁体中文', 'zh-TW': '繁體中文', ko: '중국어(번체)', 'ko-KP': '중국어(번체)' }),
  ko: Object.freeze({ ja: '韓国語', en: 'Korean', 'zh-CN': '韩语', 'zh-TW': '韓語', ko: '한국어', 'ko-KP': '한국어' }),
  'ko-KP': Object.freeze({ ja: '朝鮮語', en: 'Korean (North Korea)', 'zh-CN': '朝鲜语', 'zh-TW': '朝鮮語', ko: '조선어', 'ko-KP': '조선어' })
});

const HC_LANGUAGE_UI = Object.freeze({
  ja: Object.freeze({ message: language => `${language}で使用できます`, action: language => `${language}に切り替える` }),
  en: Object.freeze({ message: language => `Available in ${language}`, action: language => `Switch to ${language}` }),
  'zh-CN': Object.freeze({ message: language => `${language}可用`, action: language => `切换到${language}` }),
  'zh-TW': Object.freeze({ message: language => `可使用${language}`, action: language => `切換至${language}` }),
  ko: Object.freeze({ message: language => `${language}로 사용할 수 있습니다`, action: language => `${language}로 전환` }),
  'ko-KP': Object.freeze({ message: language => `${language}로 사용할수 있습니다`, action: language => `${language}로 전환` })
});

function logInfo(message, detail) {
  if (typeof detail === 'undefined') {
    console.log(`[NaeCSS] ${message}`);
    return;
  }
  console.log(`[NaeCSS] ${message}`, detail);
}

function logError(message, error) {
  console.error(`[NaeCSS] ${message}`, error);
}

function uiText(key, ...args) {
  const template = window.HC_I18N?.[key];
  if (typeof template === 'function') return template(...args);
  if (typeof template === 'string') return template;
  return key;
}

function getRequiredElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    logError(`Required element not found: #${id}`, new Error(`Missing DOM element: ${id}`));
    return null;
  }
  return element;
}

function normalizeSupportedLanguage(value) {
  const normalized = String(value || '').trim();
  return HC_SUPPORTED_LANGUAGES.includes(normalized) ? normalized : null;
}

function mapBrowserLanguage(value) {
  const normalized = String(value || '').trim().replace(/_/g, '-');
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  if (lower === 'ko-kp') return 'ko-KP';
  if (lower.startsWith('ko-') || lower === 'ko') return 'ko';
  if (lower === 'zh-tw' || lower.startsWith('zh-hk') || lower.startsWith('zh-mo') || lower.includes('hant')) return 'zh-TW';
  if (lower === 'zh-cn' || lower === 'zh-sg' || lower === 'zh' || lower.includes('hans')) return 'zh-CN';
  if (lower.startsWith('ja')) return 'ja';
  if (lower.startsWith('en')) return 'en';
  return null;
}

function getPageLanguage() {
  const pathname = window.location.pathname || '';
  const fileName = decodeURIComponent(pathname.split('/').pop() || '').trim();
  const match = /^(ja|en|zh-CN|zh-TW|ko|ko-KP)\.html$/i.exec(fileName);
  if (match) {
    const exactLanguage = HC_SUPPORTED_LANGUAGES.find(language => language.toLowerCase() === match[1].toLowerCase());
    if (exactLanguage) return exactLanguage;
  }
  const htmlLang = document.documentElement.getAttribute('lang');
  return htmlLang ? mapBrowserLanguage(htmlLang) : null;
}

function getPreferredLanguage() {
  try {
    const storedLanguage = normalizeSupportedLanguage(localStorage.getItem('selectedLang'));
    if (storedLanguage) return { language: storedLanguage, source: 'localStorage' };
    const browserLanguages = Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];
    for (const browserLanguage of browserLanguages) {
      const mappedLanguage = mapBrowserLanguage(browserLanguage);
      if (mappedLanguage) return { language: mappedLanguage, source: 'browser' };
    }
  } catch (error) {
    logError('Language preference could not be read.', error);
  }
  return { language: null, source: 'none' };
}

function buildLanguagePageUrl(targetLanguage) {
  const url = new URL(window.location.href);
  const pathParts = url.pathname.split('/');
  const currentFile = pathParts[pathParts.length - 1] || '';
  if (/\.html$/i.test(currentFile)) pathParts[pathParts.length - 1] = `${targetLanguage}.html`;
  else pathParts.push(`${targetLanguage}.html`);
  url.pathname = pathParts.join('/');
  return url.toString();
}

function updateLanguageHint() {
  if (!hcDom.languageHint || !hcDom.languageHintMessage || !hcDom.languageSwitchButton || !hcDom.languageSwitchLabel) {
    logError('Language hint UI is unavailable.');
    return;
  }
  const pageLanguage = getPageLanguage();
  const preferredLanguage = getPreferredLanguage().language;
  if (!pageLanguage || !preferredLanguage || pageLanguage === preferredLanguage) {
    hcDom.languageHint.hidden = true;
    return;
  }
  const ui = HC_LANGUAGE_UI[preferredLanguage];
  const names = HC_LANGUAGE_NAMES[preferredLanguage];
  if (!ui || !names) {
    hcDom.languageHint.hidden = true;
    logError('Language hint data is unavailable.', new Error(preferredLanguage));
    return;
  }
  const languageName = names[preferredLanguage] || names.en || preferredLanguage;
  hcDom.languageHintMessage.textContent = ui.message(languageName);
  hcDom.languageSwitchLabel.textContent = ui.action(languageName);
  hcDom.languageSwitchButton.dataset.targetLanguage = preferredLanguage;
  hcDom.languageHint.hidden = false;
  logInfo('Language hint displayed.', { pageLanguage, preferredLanguage });
}

function switchToPreferredLanguage() {
  const targetLanguage = normalizeSupportedLanguage(hcDom.languageSwitchButton?.dataset.targetLanguage);
  if (!targetLanguage) {
    logError('Cannot switch language because no supported target exists.');
    return;
  }
  try {
    const targetUrl = buildLanguagePageUrl(targetLanguage);
    logInfo('Switching language page.', { targetUrl });
    window.location.assign(targetUrl);
  } catch (error) {
    logError('Language switching failed.', error);
  }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(HC_CONFIG.settingsStorageKey);
    if (!raw) {
      logInfo('No saved settings found; defaults are used.');
      return;
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      HC_STATE.settings.duplicateRemoval = parsed.duplicateRemoval === true;
      HC_STATE.settings.indentSize = Number(parsed.indentSize) === 4 ? 4 : 2;
    }
    logInfo('Saved settings restored.', HC_STATE.settings);
  } catch (error) {
    logError('Saved settings could not be restored; defaults are used.', error);
  }
}

function saveSettings() {
  try {
    localStorage.setItem(HC_CONFIG.settingsStorageKey, JSON.stringify(HC_STATE.settings));
    logInfo('Settings saved.', HC_STATE.settings);
  } catch (error) {
    logError('Settings could not be saved.', error);
  }
}

function updateSettingsUi() {
  if (hcDom.duplicateSwitch) hcDom.duplicateSwitch.selected = HC_STATE.settings.duplicateRemoval;
  const buttons = document.querySelectorAll('.hc-indent-button');
  if (!buttons || buttons.length === 0) {
    logError('Indent buttons were not found.');
    return;
  }
  buttons.forEach(button => {
    const indent = Number(button.dataset.indent);
    button.dataset.active = String(indent === HC_STATE.settings.indentSize);
  });
}

function getInputCss() {
  if (!hcDom.cssInput) throw new Error('CSS input element is unavailable.');
  return String(hcDom.cssInput.value || '');
}

function byteLength(value) {
  return new TextEncoder().encode(String(value || '')).byteLength;
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return '0 bytes';
  return uiText('size', bytes);
}

function calculateReduction(originalBytes, outputBytes) {
  if (originalBytes <= 0) return 0;
  return ((originalBytes - outputBytes) / originalBytes) * 100;
}

function setStatus(message, isError = false) {
  if (!hcDom.actionStatus) {
    logError('Action status element is unavailable.');
    return;
  }
  hcDom.actionStatus.textContent = message;
  hcDom.actionStatus.dataset.error = String(isError);
  if (hcDom.srStatus) hcDom.srStatus.textContent = message;
}

function announce(message) {
  if (!hcDom.srStatus) {
    logError('Screen reader status element is unavailable.');
    return;
  }
  hcDom.srStatus.textContent = '';
  window.setTimeout(() => {
    if (hcDom.srStatus) hcDom.srStatus.textContent = message;
  }, 20);
}

function updateFileUi() {
  if (!hcDom.fileStatus) {
    logError('File status element is unavailable.');
    return;
  }
  if (HC_STATE.fileHandle && HC_STATE.fileName) {
    hcDom.fileStatus.textContent = `編集中: ${HC_STATE.fileName}`;
  } else {
    hcDom.fileStatus.textContent = 'ファイルは開かれていません。';
  }
  if (hcDom.saveButton) hcDom.saveButton.disabled = !HC_STATE.fileHandle || !HC_STATE.lastResult || HC_STATE.processing;
}

function setProcessing(processing) {
  HC_STATE.processing = processing;
  if (hcDom.openFileButton) hcDom.openFileButton.disabled = processing;
  if (hcDom.clearInputButton) hcDom.clearInputButton.disabled = processing;
  if (hcDom.saveButton) hcDom.saveButton.disabled = processing || !HC_STATE.fileHandle || !HC_STATE.lastResult;
  if (hcDom.downloadButton) hcDom.downloadButton.disabled = processing || !HC_STATE.lastResult;
  if (hcDom.copyButton) hcDom.copyButton.disabled = processing || !HC_STATE.lastResult;
}

function getExternalGlobal(name) {
  return typeof window[name] !== 'undefined' ? window[name] : null;
}

async function loadCleanCssModule() {
  if (typeof HC_STATE.cleanCssConstructor === 'function') {
    logInfo('CleanCSS module is already available.');
    return HC_STATE.cleanCssConstructor;
  }

  const promiseKey = 'CleanCSS:esm';
  const existingPromise = HC_STATE.enginePromises.get(promiseKey);
  if (existingPromise) return existingPromise;

  const urls = [HC_CONFIG.cdn.cleanCss, ...HC_CONFIG.cdn.cleanCssFallbacks];
  const promise = (async () => {
    const errors = [];

    for (const url of urls) {
      if (!url) continue;
      try {
        logInfo('Loading CleanCSS from external ESM CDN.', { url });
        const module = await import(url);
        const constructor = module?.default || module?.CleanCSS || module;
        if (typeof constructor !== 'function') {
          throw new Error('CleanCSS module loaded, but no constructor was exported.');
        }
        HC_STATE.cleanCssConstructor = constructor;
        logInfo('CleanCSS external ESM engine loaded successfully.', { url });
        return constructor;
      } catch (error) {
        errors.push(`${url}: ${error?.message || error}`);
        logError('CleanCSS external ESM engine load failed; trying the next CDN.', { url, error });
      }
    }

    HC_STATE.cleanCssConstructor = null;
    throw new Error(`All external CleanCSS engines failed to load. ${errors.join(' | ')}`);
  })();

  HC_STATE.enginePromises.set(promiseKey, promise);
  promise.catch(() => {
    if (HC_STATE.enginePromises.get(promiseKey) === promise) {
      HC_STATE.enginePromises.delete(promiseKey);
    }
  });
  return promise;
}

function injectExternalScript(url, globalName) {
  const existingPromise = HC_STATE.enginePromises.get(globalName);
  if (existingPromise) return existingPromise;

  const promise = new Promise((resolve, reject) => {
    if (getExternalGlobal(globalName)) {
      logInfo('External engine is already available.', { globalName, url });
      resolve();
      return;
    }

    const script = document.createElement('script');
    if (!script) {
      reject(new Error(`Could not create an external engine script element: ${url}`));
      return;
    }

    script.src = url;
    script.async = true;
    script.dataset.hicssEngine = globalName;
    script.dataset.hicssRetry = 'true';
    script.onload = () => {
      if (!getExternalGlobal(globalName)) {
        reject(new Error(`External engine loaded but global ${globalName} was not created: ${url}`));
        return;
      }
      logInfo('External engine loaded by runtime retry.', { globalName, url });
      resolve();
    };
    script.onerror = () => reject(new Error(`External engine failed to load: ${url}`));
    document.head.appendChild(script);
  });

  HC_STATE.enginePromises.set(globalName, promise);
  promise.catch(error => {
    HC_STATE.enginePromises.delete(globalName);
    logError(`External engine load promise rejected: ${globalName}`, error);
  });
  return promise;
}

async function ensureExternalEngines(mode) {
  if (mode === 'compress') {
    const CleanCSS = await loadCleanCssModule();
    if (typeof CleanCSS !== 'function') {
      throw new Error(`CleanCSS is unavailable. Expected external engine: ${HC_CONFIG.cdn.cleanCss}`);
    }
    logInfo('External engine availability confirmed.', { mode, engine: 'CleanCSS' });
    return;
  }

  if (mode === 'format') {
    if (typeof window.css_beautify !== 'function') {
      try {
        await injectExternalScript(HC_CONFIG.cdn.jsBeautifyCss, 'css_beautify');
      } catch (error) {
        throw new Error(`css-beautify is unavailable. Expected external engine: ${HC_CONFIG.cdn.jsBeautifyCss}. ${error.message || ''}`.trim());
      }
    }
    if (typeof window.css_beautify !== 'function') {
      throw new Error(`css-beautify is unavailable. Expected external engine: ${HC_CONFIG.cdn.jsBeautifyCss}`);
    }
    logInfo('External engine availability confirmed.', { mode, engine: 'css-beautify' });
  }
}

function buildCleanCssOptions(removeDuplicates) {
  return {
    inline: ['none'],
    level: {
      1: {},
      2: removeDuplicates
        ? {
            all: false,
            removeDuplicateRules: true,
            removeDuplicateMediaBlocks: true,
            removeDuplicateFontRules: true,
            removeEmpty: true
          }
        : {
            all: false,
            removeDuplicateRules: false,
            removeDuplicateMediaBlocks: false,
            removeDuplicateFontRules: false,
            removeEmpty: false
          }
    }
  };
}

async function compressCss(css, removeDuplicates) {
  const CleanCSS = await loadCleanCssModule();
  if (typeof CleanCSS !== 'function') {
    throw new Error(`CleanCSS is unavailable. Expected external engine: ${HC_CONFIG.cdn.cleanCss}`);
  }
  const result = new CleanCSS(buildCleanCssOptions(removeDuplicates)).minify(css);
  if (!result || typeof result.styles !== 'string') throw new Error('CleanCSS returned an invalid result.');
  if (Array.isArray(result.errors) && result.errors.length > 0) {
    logError('CleanCSS reported errors.', result.errors);
    throw new Error(result.errors.join('\n'));
  }
  if (Array.isArray(result.warnings) && result.warnings.length > 0) logInfo('CleanCSS reported warnings.', result.warnings);
  return {
    css: result.styles,
    warnings: Array.isArray(result.warnings) ? result.warnings : []
  };
}

async function removeDuplicatesBeforeFormatting(css) {
  const CleanCSS = await loadCleanCssModule();
  if (typeof CleanCSS !== 'function') {
    throw new Error(`CleanCSS is unavailable. Expected external engine: ${HC_CONFIG.cdn.cleanCss}`);
  }
  const result = new CleanCSS({
    inline: ['none'],
    level: {
      1: { all: false },
      2: {
        all: false,
        removeDuplicateRules: true,
        removeDuplicateMediaBlocks: true,
        removeDuplicateFontRules: true
      }
    }
  }).minify(css);
  if (!result || typeof result.styles !== 'string') throw new Error('CleanCSS returned an invalid duplicate-removal result.');
  if (Array.isArray(result.errors) && result.errors.length > 0) {
    logError('CleanCSS reported errors during duplicate removal.', result.errors);
    throw new Error(result.errors.join('\n'));
  }
  if (Array.isArray(result.warnings) && result.warnings.length > 0) logInfo('CleanCSS reported warnings during duplicate removal.', result.warnings);
  return {
    css: result.styles,
    warnings: Array.isArray(result.warnings) ? result.warnings : []
  };
}

async function formatCss(css, indentSize, removeDuplicates) {
  let workingCss = css;
  let warnings = [];
  if (removeDuplicates) {
    const optimized = await removeDuplicatesBeforeFormatting(css);
    workingCss = optimized.css;
    warnings = optimized.warnings;
  }
  await ensureExternalEngines('format');
  const formatted = window.css_beautify(workingCss, {
    indent_size: indentSize,
    indent_char: ' ',
    end_with_newline: true,
    brace_style: 'collapse',
    selector_separator_newline: true,
    newline_between_rules: true
  });
  if (typeof formatted !== 'string') throw new Error('css-beautify returned an invalid result.');
  return { css: formatted, warnings };
}

function renderResult(outputCss, mode, warnings, processingTimeMs, inputCss) {
  if (!hcDom.cssOutput || !hcDom.copyButton || !hcDom.downloadButton || !hcDom.resultMeta) {
    throw new Error('Result UI elements are unavailable.');
  }
  hcDom.cssOutput.value = outputCss;
  HC_STATE.lastResult = outputCss;
  HC_STATE.lastStats = {
    mode,
    originalBytes: byteLength(inputCss),
    outputBytes: byteLength(outputCss),
    reduction: calculateReduction(byteLength(inputCss), byteLength(outputCss)),
    warnings,
    processingTimeMs
  };

  const originalBytes = HC_STATE.lastStats.originalBytes;
  const outputBytes = HC_STATE.lastStats.outputBytes;
  const reduction = HC_STATE.lastStats.reduction;
  const modeLabel = mode === 'compress' ? '圧縮' : '整形';
  const warningText = warnings.length > 0 ? ` / ${uiText('warning', warnings.length)}` : '';
  const reductionText = mode === 'compress' ? ` / ${uiText('reduction', reduction)}` : '';
  hcDom.resultMeta.textContent = `${modeLabel}: ${formatSize(originalBytes)} → ${formatSize(outputBytes)}${reductionText} / ${processingTimeMs.toFixed(1)}ms${warningText}`;
  hcDom.copyButton.disabled = false;
  hcDom.downloadButton.disabled = false;
  updateFileUi();
}

async function processCss(mode = HC_STATE.activeMode) {
  if (!hcDom.cssInput) {
    logError('CSS input element is unavailable.');
    return;
  }
  const css = getInputCss();
  if (!css.trim()) {
    HC_STATE.lastResult = '';
    HC_STATE.lastStats = null;
    if (hcDom.cssOutput) hcDom.cssOutput.value = '';
    if (hcDom.resultMeta) hcDom.resultMeta.textContent = 'まだ処理されていません。';
    setStatus(uiText('inputEmpty'));
    setProcessing(false);
    return;
  }

  const sequence = ++HC_STATE.processSequence;
  setProcessing(true);
  setStatus(mode === 'compress' ? '圧縮中…' : '整形中…');
  const startedAt = performance.now();
  logInfo('CSS processing started.', { mode, sequence, inputBytes: byteLength(css), duplicateRemoval: HC_STATE.settings.duplicateRemoval });

  try {
    const result = mode === 'compress'
      ? await compressCss(css, HC_STATE.settings.duplicateRemoval)
      : await formatCss(css, HC_STATE.settings.indentSize, HC_STATE.settings.duplicateRemoval);

    if (sequence !== HC_STATE.processSequence) {
      logInfo('Stale CSS processing result ignored.', { mode, sequence });
      return;
    }

    const processingTimeMs = performance.now() - startedAt;
    renderResult(result.css, mode, result.warnings || [], processingTimeMs, css);
    setStatus(mode === 'compress' ? uiText('compressed') : uiText('formatted'));
    announce(mode === 'compress' ? uiText('compressed') : uiText('formatted'));
    logInfo('CSS processing completed successfully.', { mode, sequence, processingTimeMs });
  } catch (error) {
    if (sequence !== HC_STATE.processSequence) return;
    logError(`CSS ${mode} processing failed.`, error);
    setStatus(`${uiText('processFailed')} ${error.message || ''}`.trim(), true);
    announce(uiText('processFailed'));
  } finally {
    if (sequence === HC_STATE.processSequence) setProcessing(false);
  }
}

function scheduleRealtimeProcessing(immediate = false) {
  if (HC_STATE.scheduledTimer !== null) {
    window.clearTimeout(HC_STATE.scheduledTimer);
    HC_STATE.scheduledTimer = null;
  }
  const css = getInputCss();
  if (!css.trim()) {
    void processCss(HC_STATE.activeMode);
    return;
  }
  const delay = immediate ? 0 : HC_CONFIG.realtimeDebounceMs;
  HC_STATE.scheduledTimer = window.setTimeout(() => {
    HC_STATE.scheduledTimer = null;
    void processCss(HC_STATE.activeMode);
  }, delay);
  logInfo('Realtime CSS processing scheduled.', { mode: HC_STATE.activeMode, delay });
}

async function copyResult() {
  const output = String(hcDom.cssOutput?.value || '');
  if (!output) {
    logError('Copy skipped because output is empty.');
    return;
  }
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('Clipboard API is unavailable.');
    await navigator.clipboard.writeText(output);
    setStatus(uiText('copied'));
    announce(uiText('copied'));
    logInfo('Result copied successfully.');
  } catch (error) {
    logError('Result copy failed.', error);
    setStatus(uiText('copyFailed'), true);
  }
}

async function requestWritePermission(handle) {
  if (!handle || typeof handle.createWritable !== 'function') throw new Error('A writable CSS file handle is unavailable.');
  if (typeof handle.queryPermission !== 'function' || typeof handle.requestPermission !== 'function') return;
  const current = await handle.queryPermission({ mode: 'readwrite' });
  if (current === 'granted') return;
  const requested = await handle.requestPermission({ mode: 'readwrite' });
  if (requested !== 'granted') throw new Error('ファイルへの書き込み権限が許可されませんでした。');
}

async function saveToOpenedFile() {
  if (!HC_STATE.fileHandle) {
    setStatus(uiText('noOpenFile'), true);
    logError('Save skipped because no File System Access handle exists.');
    return;
  }
  const output = String(hcDom.cssOutput?.value || '');
  if (!output) {
    setStatus(uiText('inputEmpty'), true);
    logError('Save skipped because output is empty.');
    return;
  }

  try {
    setProcessing(true);
    await requestWritePermission(HC_STATE.fileHandle);
    const writable = await HC_STATE.fileHandle.createWritable();
    if (!writable || typeof writable.write !== 'function' || typeof writable.close !== 'function') {
      throw new Error('File writer is unavailable.');
    }
    await writable.write(output);
    await writable.close();
    if (hcDom.cssInput) hcDom.cssInput.value = output;
    try {
      const savedFile = await HC_STATE.fileHandle.getFile();
      if (savedFile instanceof File) {
        HC_STATE.fileLastModified = savedFile.lastModified;
        HC_STATE.fileLastSize = savedFile.size;
      }
    } catch (snapshotError) {
      logError('Saved CSS file snapshot could not be refreshed.', snapshotError);
    }
    setStatus(uiText('savedToFile', HC_STATE.fileName));
    announce(uiText('saved'));
    logInfo('CSS result written back to the opened file.', { fileName: HC_STATE.fileName, bytes: byteLength(output) });
  } catch (error) {
    logError('CSS file save failed.', error);
    setStatus(`${uiText('saveFailed')} ${error.message || ''}`.trim(), true);
  } finally {
    setProcessing(false);
  }
}

function downloadResult() {
  const output = String(hcDom.cssOutput?.value || '');
  if (!output) {
    logError('Download skipped because output is empty.');
    return;
  }
  try {
    const blob = new Blob([output], { type: 'text/css;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    if (!link) throw new Error('Download link element could not be created.');
    link.href = url;
    const baseName = HC_STATE.fileName && /\.css$/i.test(HC_STATE.fileName) ? HC_STATE.fileName : HC_CONFIG.outputFileName;
    link.download = baseName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus(uiText('downloaded'));
    announce(uiText('downloaded'));
    logInfo('CSS result downloaded successfully.', { fileName: baseName, bytes: byteLength(output) });
  } catch (error) {
    logError('Result download failed.', error);
    setStatus(uiText('downloadFailed'), true);
  }
}

async function readCssFile(file, handle = null) {
  if (!(file instanceof File)) {
    logError('Selected file is not a File object.', file);
    setStatus(uiText('readFailed'), true);
    return;
  }
  if (!/\.css$/i.test(file.name) && file.type && file.type !== 'text/css') {
    logError('Selected file does not appear to be CSS.', { name: file.name, type: file.type });
    setStatus(uiText('readFailed'), true);
    return;
  }
  try {
    const text = await file.text();
    if (!hcDom.cssInput) throw new Error('CSS input element is unavailable.');
    if (handle) {
      HC_STATE.fileHandle = handle;
      HC_STATE.fileName = file.name;
      HC_STATE.fileLastModified = Number(file.lastModified) || 0;
      HC_STATE.fileLastSize = Number(file.size) || byteLength(text);
      stopFileWatcher();
    } else {
      stopFileWatcher();
      HC_STATE.fileHandle = null;
      HC_STATE.fileName = '';
      HC_STATE.fileLastModified = 0;
      HC_STATE.fileLastSize = 0;
    }
    hcDom.cssInput.value = text;
    HC_STATE.lastResult = '';
    if (hcDom.cssOutput) hcDom.cssOutput.value = '';
    if (hcDom.resultMeta) hcDom.resultMeta.textContent = '処理しています…';
    updateFileUi();
    setStatus(uiText('fileLoaded', file.name));
    logInfo('CSS file loaded.', { name: file.name, bytes: byteLength(text), viaFileSystemAccess: Boolean(handle) });
    if (handle) scheduleFileWatcher();
    scheduleRealtimeProcessing(true);
  } catch (error) {
    logError('CSS file read failed.', error);
    setStatus(uiText('readFailed'), true);
  }
}

function stopFileWatcher() {
  if (HC_STATE.fileWatchTimer !== null) {
    window.clearTimeout(HC_STATE.fileWatchTimer);
    HC_STATE.fileWatchTimer = null;
  }
  HC_STATE.fileWatchBusy = false;
  logInfo('Opened CSS file watcher stopped.');
}

function scheduleFileWatcher() {
  if (!HC_STATE.fileHandle || typeof HC_STATE.fileHandle.getFile !== 'function') return;
  if (HC_STATE.fileWatchTimer !== null) window.clearTimeout(HC_STATE.fileWatchTimer);
  HC_STATE.fileWatchTimer = window.setTimeout(() => {
    HC_STATE.fileWatchTimer = null;
    void checkOpenedFileForChanges();
  }, HC_CONFIG.fileWatchIntervalMs);
}

async function checkOpenedFileForChanges() {
  const handle = HC_STATE.fileHandle;
  if (!handle || typeof handle.getFile !== 'function' || HC_STATE.fileWatchBusy) return;

  HC_STATE.fileWatchBusy = true;
  try {
    const file = await handle.getFile();
    if (!(file instanceof File)) throw new Error('Opened CSS file snapshot is unavailable.');

    const changed = file.lastModified !== HC_STATE.fileLastModified || file.size !== HC_STATE.fileLastSize;
    if (!changed) return;

    const css = await file.text();
    if (!hcDom.cssInput) throw new Error('CSS input element is unavailable.');

    HC_STATE.fileLastModified = file.lastModified;
    HC_STATE.fileLastSize = file.size;

    if (hcDom.cssInput.value === css) {
      logInfo('Opened CSS file metadata changed, but content is unchanged.', {
        name: file.name,
        lastModified: file.lastModified,
        bytes: file.size
      });
      return;
    }

    HC_STATE.processSequence += 1;
    hcDom.cssInput.value = css;
    HC_STATE.lastResult = '';
    HC_STATE.lastStats = null;
    if (hcDom.resultMeta) hcDom.resultMeta.textContent = '外部変更を反映しています…';
    setStatus(uiText('fileExternallyUpdated', file.name));
    announce(uiText('fileExternallyUpdated', file.name));
    logInfo('Opened CSS file changed externally; input updated automatically.', {
      name: file.name,
      bytes: file.size,
      lastModified: file.lastModified
    });
    scheduleRealtimeProcessing(true);
  } catch (error) {
    logError('Opened CSS file change check failed.', error);
  } finally {
    HC_STATE.fileWatchBusy = false;
    if (HC_STATE.fileHandle === handle) scheduleFileWatcher();
  }
}

async function openCssFile() {
  if (typeof window.showOpenFilePicker !== 'function') {
    logError('File System Access API is unavailable in this browser.');
    setStatus(uiText('fileAccessUnavailable'), true);
    if (hcDom.fileInput) hcDom.fileInput.click();
    return;
  }

  try {
    const handles = await window.showOpenFilePicker({
      multiple: false,
      excludeAcceptAllOption: true,
      types: [{
        description: 'CSS files',
        accept: { 'text/css': ['.css'] }
      }]
    });
    if (!Array.isArray(handles) || handles.length === 0) {
      logInfo('File picker returned no file handle.');
      return;
    }
    const handle = handles[0];
    if (!handle || handle.kind !== 'file') {
      logError('The selected File System Access handle is not a file.', handle);
      return;
    }
    const file = await handle.getFile();
    await readCssFile(file, handle);
  } catch (error) {
    if (error?.name === 'AbortError') {
      logInfo('CSS file picker was cancelled.');
      return;
    }
    logError('CSS file picker failed.', error);
    setStatus(uiText('readFailed'), true);
  }
}

function clearInput() {
  if (!hcDom.cssInput) {
    logError('CSS input element is unavailable.');
    return;
  }
  if (HC_STATE.scheduledTimer !== null) {
    window.clearTimeout(HC_STATE.scheduledTimer);
    HC_STATE.scheduledTimer = null;
  }
  HC_STATE.processSequence += 1;
  stopFileWatcher();
  hcDom.cssInput.value = '';
  if (hcDom.cssOutput) hcDom.cssOutput.value = '';
  if (hcDom.resultMeta) hcDom.resultMeta.textContent = 'まだ処理されていません。';
  HC_STATE.lastResult = '';
  HC_STATE.lastStats = null;
  HC_STATE.fileHandle = null;
  HC_STATE.fileName = '';
  updateFileUi();
  setStatus(uiText('inputEmpty'));
  setProcessing(false);
  logInfo('Input, result, and open-file state cleared.');
}

function bindDropEvents() {
  if (!hcDom.inputEditorShell || !hcDom.dropOverlay) {
    logError('Drop UI elements are unavailable.');
    return;
  }
  hcDom.inputEditorShell.addEventListener('dragenter', event => {
    event.preventDefault();
    event.stopPropagation();
    hcDom.dropOverlay.hidden = false;
  });
  hcDom.inputEditorShell.addEventListener('dragover', event => {
    event.preventDefault();
    event.stopPropagation();
    hcDom.dropOverlay.hidden = false;
  });
  hcDom.inputEditorShell.addEventListener('dragleave', event => {
    event.preventDefault();
    event.stopPropagation();
    if (event.relatedTarget && hcDom.inputEditorShell.contains(event.relatedTarget)) return;
    hcDom.dropOverlay.hidden = true;
  });
  hcDom.inputEditorShell.addEventListener('drop', event => {
    event.preventDefault();
    event.stopPropagation();
    hcDom.dropOverlay.hidden = true;
    const files = Array.from(event.dataTransfer?.files || []).filter(file => file instanceof File);
    if (files.length === 0) {
      logError('No files were present in the drop event.');
      return;
    }
    void readCssFile(files[0]);
    logInfo('CSS file received by drop.', { name: files[0].name });
  });
}

function setActiveMode(mode, processImmediately = true) {
  if (mode !== 'compress' && mode !== 'format') {
    logError('Unsupported result mode requested.', mode);
    return;
  }
  HC_STATE.activeMode = mode;
  if (hcDom.compressTab) hcDom.compressTab.active = mode === 'compress';
  if (hcDom.formatTab) hcDom.formatTab.active = mode === 'format';
  if (hcDom.resultTabs) hcDom.resultTabs.activeTabIndex = mode === 'compress' ? 0 : 1;
  logInfo('Result mode changed.', { mode });
  if (processImmediately) scheduleRealtimeProcessing(true);
}

function bindEvents() {
  const requiredIds = [
    ['cssInput', 'css-input'],
    ['cssOutput', 'css-output'],
    ['duplicateSwitch', 'duplicate-switch'],
    ['copyButton', 'copy-button'],
    ['saveButton', 'save-button'],
    ['downloadButton', 'download-button'],
    ['openFileButton', 'open-file-button'],
    ['fileInput', 'file-input'],
    ['clearInputButton', 'clear-input-button'],
    ['actionStatus', 'action-status'],
    ['resultMeta', 'result-meta'],
    ['fileStatus', 'file-status'],
    ['languageHint', 'language-hint'],
    ['languageHintMessage', 'language-hint-message'],
    ['languageSwitchButton', 'language-switch-button'],
    ['languageSwitchLabel', 'language-switch-label'],
    ['inputEditorShell', 'input-editor-shell'],
    ['dropOverlay', 'drop-overlay'],
    ['resultTabs', 'result-tabs'],
    ['compressTab', 'compress-tab'],
    ['formatTab', 'format-tab'],
    ['srStatus', 'sr-status']
  ];

  for (const [key, id] of requiredIds) hcDom[key] = getRequiredElement(id);

  if (hcDom.openFileButton) hcDom.openFileButton.addEventListener('click', () => void openCssFile());
  else logError('Open-file button is unavailable.');

  if (hcDom.fileInput) {
    hcDom.fileInput.addEventListener('change', () => {
      const file = hcDom.fileInput.files?.[0];
      hcDom.fileInput.value = '';
      if (!file) {
        logInfo('Fallback CSS file picker closed without selection.');
        return;
      }
      void readCssFile(file);
    });
  } else {
    logError('Fallback file input is unavailable.');
  }

  if (hcDom.clearInputButton) hcDom.clearInputButton.addEventListener('click', clearInput);
  else logError('Clear button is unavailable.');

  if (hcDom.copyButton) hcDom.copyButton.addEventListener('click', () => void copyResult());
  else logError('Copy button is unavailable.');

  if (hcDom.saveButton) hcDom.saveButton.addEventListener('click', () => void saveToOpenedFile());
  else logError('Save button is unavailable.');

  if (hcDom.downloadButton) hcDom.downloadButton.addEventListener('click', downloadResult);
  else logError('Download button is unavailable.');

  if (hcDom.duplicateSwitch) {
    hcDom.duplicateSwitch.addEventListener('change', () => {
      HC_STATE.settings.duplicateRemoval = hcDom.duplicateSwitch.selected === true;
      saveSettings();
      setStatus(HC_STATE.settings.duplicateRemoval ? '重複削除を有効にしました。' : '重複削除を無効にしました。');
      logInfo('Duplicate removal setting changed.', { enabled: HC_STATE.settings.duplicateRemoval });
      scheduleRealtimeProcessing(true);
    });
  } else {
    logError('Duplicate-removal switch is unavailable.');
  }

  const indentButtons = document.querySelectorAll('.hc-indent-button');
  if (!indentButtons || indentButtons.length === 0) {
    logError('No indent buttons found.');
  } else {
    indentButtons.forEach(button => {
      button.addEventListener('click', () => {
        const indent = Number(button.dataset.indent);
        if (indent !== 2 && indent !== 4) {
          logError('Unsupported indent value.', indent);
          return;
        }
        HC_STATE.settings.indentSize = indent;
        saveSettings();
        updateSettingsUi();
        setStatus(`${indent}スペースを選択しました。`);
        logInfo('Indent size changed.', { indentSize: indent });
        if (HC_STATE.activeMode === 'format') scheduleRealtimeProcessing(true);
      });
    });
  }

  if (hcDom.compressTab) hcDom.compressTab.addEventListener('click', () => setActiveMode('compress'));
  else logError('Compress result tab is unavailable.');

  if (hcDom.formatTab) hcDom.formatTab.addEventListener('click', () => setActiveMode('format'));
  else logError('Format result tab is unavailable.');

  if (hcDom.languageSwitchButton) hcDom.languageSwitchButton.addEventListener('click', switchToPreferredLanguage);
  else logError('Language switch button is unavailable.');

  if (hcDom.cssInput) {
    hcDom.cssInput.addEventListener('input', () => {
      if (!HC_STATE.processing) setStatus(hcDom.cssInput.value.trim() ? '更新しています…' : uiText('inputEmpty'));
      scheduleRealtimeProcessing(false);
    });
  } else {
    logError('CSS input is unavailable.');
  }

  window.addEventListener('beforeunload', () => {
    if (HC_STATE.scheduledTimer !== null) window.clearTimeout(HC_STATE.scheduledTimer);
    logInfo('NaeCSS page unloading.');
  }, { once: true });

  logInfo('UI event bindings completed.');
}

function initializeCanonicalUrl() {
  try {
    const url = new URL(window.location.href);
    const canonicalUrl = url.toString().replace(/[?#].*$/, '');
    const canonical = document.getElementById('canonical-url');
    if (canonical) canonical.href = canonicalUrl;
    else logError('Canonical URL element is unavailable.');
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.content = canonicalUrl;
    else logError('Open Graph URL meta element is unavailable.');
    const currentFile = url.pathname.split('/').pop() || '';
    const pathParts = url.pathname.split('/');
    for (const language of HC_SUPPORTED_LANGUAGES) {
      const clone = [...pathParts];
      if (/\.html$/i.test(currentFile)) clone[clone.length - 1] = `${language}.html`;
      else clone.push(`${language}.html`);
      const link = document.getElementById(`hreflang-${language}`);
      if (link) link.href = `${url.origin}${clone.join('/')}`;
      else logError(`hreflang element is unavailable: #hreflang-${language}`);
    }
    logInfo('Canonical and hreflang URLs initialized.');
  } catch (error) {
    logError('Canonical URL initialization failed.', error);
  }
}

function initialize() {
  try {
    loadSettings();
    bindEvents();
    updateSettingsUi();
    updateLanguageHint();
    initializeCanonicalUrl();
    updateFileUi();
    setActiveMode('compress', false);
    setStatus(uiText('inputEmpty'));
    logInfo('Application initialized successfully.', { settings: HC_STATE.settings, activeMode: HC_STATE.activeMode });
    logInfo('External engines configured.', HC_CONFIG.cdn);
  } catch (error) {
    logError('Application initialization failed.', error);
    setStatus(uiText('processFailed'), true);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize, { once: true });
} else {
  initialize();
}
