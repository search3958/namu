const HJ_CONFIG = Object.freeze({
  settingsStorageKey: 'hijs-settings-v1',
  outputFileName: 'script.js',
  realtimeDebounceMs: 180,
  fileWatchIntervalMs: 1000,
  cdn: Object.freeze({
    terser: 'https://cdn.jsdelivr.net/npm/terser@5.51.2/dist/bundle.min.js',
    terserFallbacks: Object.freeze([
      'https://cdn.jsdelivr.net/npm/terser@5.51.2/dist/bundle.js'
    ]),
    jsBeautify: 'https://cdnjs.cloudflare.com/ajax/libs/js-beautify/2.0.3/beautify-js.min.js',
    jsBeautifyFallbacks: Object.freeze([
      'https://cdnjs.cloudflare.com/ajax/libs/js-beautify/2.0.3/beautify.js'
    ]),
    obfuscator: 'https://cdn.jsdelivr.net/npm/javascript-obfuscator@5.8.1/dist/index.browser.js',
    obfuscatorFallbacks: Object.freeze([
      'https://cdn.jsdelivr.net/npm/javascript-obfuscator@5.7.0/dist/index.browser.js'
    ])
  })
});

const HJ_STATE = {
  settings: {
    obfuscation: false,
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
  fileWatchBusy: false
};

const hjDom = {};

const HJ_SUPPORTED_LANGUAGES = Object.freeze(['ja', 'en', 'zh-CN', 'zh-TW', 'ko', 'ko-KP']);

const HJ_LANGUAGE_NAMES = Object.freeze({
  ja: Object.freeze({ ja: '日本語', en: 'Japanese', 'zh-CN': '日语', 'zh-TW': '日語', ko: '일본어', 'ko-KP': '일본어' }),
  en: Object.freeze({ ja: '英語', en: 'English', 'zh-CN': '英语', 'zh-TW': '英語', ko: '영어', 'ko-KP': '영어' }),
  'zh-CN': Object.freeze({ ja: '中国語（簡体字）', en: 'Simplified Chinese', 'zh-CN': '简体中文', 'zh-TW': '簡體中文', ko: '중국어(간체)', 'ko-KP': '중국어(간체)' }),
  'zh-TW': Object.freeze({ ja: '中国語（繁体字）', en: 'Traditional Chinese', 'zh-CN': '繁体中文', 'zh-TW': '繁體中文', ko: '중국어(번체)', 'ko-KP': '중국어(번체)' }),
  ko: Object.freeze({ ja: '韓国語', en: 'Korean', 'zh-CN': '韩语', 'zh-TW': '韓語', ko: '한국어', 'ko-KP': '한국어' }),
  'ko-KP': Object.freeze({ ja: '朝鮮語', en: 'Korean (North Korea)', 'zh-CN': '朝鲜语', 'zh-TW': '朝鮮語', ko: '조선어', 'ko-KP': '조선어' })
});

const HJ_LANGUAGE_UI = Object.freeze({
  ja: Object.freeze({ message: language => `${language}で使用できます`, action: language => `${language}に切り替える` }),
  en: Object.freeze({ message: language => `Available in ${language}`, action: language => `Switch to ${language}` }),
  'zh-CN': Object.freeze({ message: language => `${language}可用`, action: language => `切换到${language}` }),
  'zh-TW': Object.freeze({ message: language => `可使用${language}`, action: language => `切換至${language}` }),
  ko: Object.freeze({ message: language => `${language}로 사용할 수 있습니다`, action: language => `${language}로 전환` }),
  'ko-KP': Object.freeze({ message: language => `${language}로 사용할수 있습니다`, action: language => `${language}로 전환` })
});

function logInfo(message, detail) {
  if (typeof detail === 'undefined') {
    console.log(`[HiJS] ${message}`);
    return;
  }
  console.log(`[HiJS] ${message}`, detail);
}

function logError(message, error) {
  console.error(`[HiJS] ${message}`, error);
}

function uiText(key, ...args) {
  const template = window.HJ_I18N?.[key];
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
  return HJ_SUPPORTED_LANGUAGES.includes(normalized) ? normalized : null;
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
    const exactLanguage = HJ_SUPPORTED_LANGUAGES.find(language => language.toLowerCase() === match[1].toLowerCase());
    if (exactLanguage) return exactLanguage;
  }
  return mapBrowserLanguage(document.documentElement.getAttribute('lang'));
}

function getPreferredLanguage() {
  try {
    const storedLanguage = normalizeSupportedLanguage(localStorage.getItem('selectedLang'));
    if (storedLanguage) return { language: storedLanguage, source: 'localStorage' };
    const browserLanguages = Array.isArray(navigator.languages) && navigator.languages.length > 0 ? navigator.languages : [navigator.language];
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
  if (!hjDom.languageHint || !hjDom.languageHintMessage || !hjDom.languageSwitchButton || !hjDom.languageSwitchLabel) {
    logError('Language hint UI is unavailable.');
    return;
  }
  const pageLanguage = getPageLanguage();
  const preferredLanguage = getPreferredLanguage().language;
  if (!pageLanguage || !preferredLanguage || pageLanguage === preferredLanguage) {
    hjDom.languageHint.hidden = true;
    return;
  }
  const ui = HJ_LANGUAGE_UI[preferredLanguage];
  const names = HJ_LANGUAGE_NAMES[preferredLanguage];
  if (!ui || !names) {
    hjDom.languageHint.hidden = true;
    logError('Language hint data is unavailable.', new Error(preferredLanguage));
    return;
  }
  const languageName = names[preferredLanguage] || names.en || preferredLanguage;
  hjDom.languageHintMessage.textContent = ui.message(languageName);
  hjDom.languageSwitchLabel.textContent = ui.action(languageName);
  hjDom.languageSwitchButton.dataset.targetLanguage = preferredLanguage;
  hjDom.languageHint.hidden = false;
  logInfo('Language hint displayed.', { pageLanguage, preferredLanguage });
}

function switchToPreferredLanguage() {
  const targetLanguage = normalizeSupportedLanguage(hjDom.languageSwitchButton?.dataset.targetLanguage);
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
    const raw = localStorage.getItem(HJ_CONFIG.settingsStorageKey);
    if (!raw) {
      logInfo('No saved settings found; defaults are used.');
      return;
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      HJ_STATE.settings.obfuscation = parsed.obfuscation === true;
      HJ_STATE.settings.indentSize = Number(parsed.indentSize) === 4 ? 4 : 2;
    }
    logInfo('Saved settings restored.', HJ_STATE.settings);
  } catch (error) {
    logError('Saved settings could not be restored; defaults are used.', error);
  }
}

function saveSettings() {
  try {
    localStorage.setItem(HJ_CONFIG.settingsStorageKey, JSON.stringify(HJ_STATE.settings));
    logInfo('Settings saved.', HJ_STATE.settings);
  } catch (error) {
    logError('Settings could not be saved.', error);
  }
}

function updateSettingsUi() {
  if (hjDom.obfuscationSwitch) hjDom.obfuscationSwitch.selected = HJ_STATE.settings.obfuscation;
  const buttons = document.querySelectorAll('.hj-indent-button');
  if (!buttons || buttons.length === 0) {
    logError('Indent buttons were not found.');
    return;
  }
  buttons.forEach(button => {
    const indent = Number(button.dataset.indent);
    button.dataset.active = String(indent === HJ_STATE.settings.indentSize);
  });
}

function getInputJs() {
  if (!hjDom.jsInput) throw new Error('JavaScript input element is unavailable.');
  return String(hjDom.jsInput.value || '');
}

function byteLength(value) {
  try {
    return new TextEncoder().encode(String(value || '')).byteLength;
  } catch (error) {
    logError('TextEncoder is unavailable; Blob byte length fallback is used.', error);
    return new Blob([String(value || '')]).size;
  }
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
  if (!hjDom.actionStatus) {
    logError('Action status element is unavailable.');
    return;
  }
  hjDom.actionStatus.textContent = message;
  hjDom.actionStatus.dataset.error = String(isError);
  if (hjDom.srStatus) hjDom.srStatus.textContent = message;
}

function announce(message) {
  if (!hjDom.srStatus) {
    logError('Screen reader status element is unavailable.');
    return;
  }
  hjDom.srStatus.textContent = '';
  window.setTimeout(() => {
    if (hjDom.srStatus) hjDom.srStatus.textContent = message;
  }, 20);
}

function updateFileUi() {
  if (!hjDom.fileStatus) {
    logError('File status element is unavailable.');
    return;
  }
  if (HJ_STATE.fileHandle && HJ_STATE.fileName) {
    hjDom.fileStatus.textContent = `編集中: ${HJ_STATE.fileName}`;
  } else {
    hjDom.fileStatus.textContent = 'ファイルは開かれていません。';
  }
  if (hjDom.saveButton) hjDom.saveButton.disabled = !HJ_STATE.fileHandle || !HJ_STATE.lastResult;
}

function setProcessing(value) {
  HJ_STATE.processing = Boolean(value);
  if (hjDom.copyButton) hjDom.copyButton.disabled = HJ_STATE.processing || !HJ_STATE.lastResult;
  if (hjDom.downloadButton) hjDom.downloadButton.disabled = HJ_STATE.processing || !HJ_STATE.lastResult;
  updateFileUi();
}

function normalizeEngineArray(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()) : [];
}

function getGlobalEngineStatus(engine) {
  if (engine === 'terser') return window.Terser && typeof window.Terser.minify === 'function';
  if (engine === 'jsBeautify') return typeof window.js_beautify === 'function';
  if (engine === 'obfuscator') return window.JavaScriptObfuscator && typeof window.JavaScriptObfuscator.obfuscate === 'function';
  return false;
}

function injectExternalScript(engine, urls, check) {
  const candidates = [urls, ...normalizeEngineArray(HJ_CONFIG.cdn[`${engine}Fallbacks`])].flat().filter(Boolean);
  if (candidates.length === 0) return Promise.reject(new Error(`No CDN URLs configured for ${engine}.`));

  let candidateIndex = 0;
  const tryCandidate = () => {
    if (check()) {
      logInfo(`External engine already available: ${engine}.`);
      return Promise.resolve();
    }
    if (candidateIndex >= candidates.length) {
      return Promise.reject(new Error(`All external engine URLs failed for ${engine}.`));
    }
    const src = candidates[candidateIndex++];
    return new Promise((resolve, reject) => {
      const existing = Array.from(document.querySelectorAll('script[data-hijs-engine]')).find(script => script.getAttribute('src') === src);
      if (existing) {
        const timeoutId = window.setTimeout(() => {
          if (check()) resolve();
          else reject(new Error(`External engine did not initialize: ${src}`));
        }, 5000);
        existing.addEventListener('load', () => {
          window.clearTimeout(timeoutId);
          if (check()) resolve();
          else reject(new Error(`External engine loaded but global API is unavailable: ${src}`));
        }, { once: true });
        existing.addEventListener('error', () => {
          window.clearTimeout(timeoutId);
          reject(new Error(`External engine failed to load: ${src}`));
        }, { once: true });
        return;
      }

      const script = document.createElement('script');
      if (!script) {
        reject(new Error(`Script element could not be created for ${src}`));
        return;
      }
      script.src = src;
      script.async = true;
      script.dataset.hijsEngine = engine;
      script.onload = () => {
        if (!check()) {
          logError(`External engine loaded but global API is unavailable: ${engine}`, new Error(src));
          reject(new Error(`External engine global API is unavailable: ${src}`));
          return;
        }
        logInfo(`External engine loaded: ${engine}`, { src });
        resolve();
      };
      script.onerror = () => {
        logError(`External engine failed to load: ${engine}`, new Error(src));
        script.remove();
        reject(new Error(`External engine failed to load: ${src}`));
      };
      document.head.appendChild(script);
    }).catch(error => {
      logError(`External engine candidate failed: ${engine}`, error);
      return tryCandidate();
    });
  };

  return tryCandidate();
}

function ensureEngine(engine) {
  if (getGlobalEngineStatus(engine)) return Promise.resolve();
  if (HJ_STATE.enginePromises.has(engine)) return HJ_STATE.enginePromises.get(engine);

  const source = HJ_CONFIG.cdn[engine];
  const promise = injectExternalScript(engine, source, () => getGlobalEngineStatus(engine))
    .catch(error => {
      HJ_STATE.enginePromises.delete(engine);
      throw error;
    });
  HJ_STATE.enginePromises.set(engine, promise);
  return promise;
}

async function ensureRequiredEngines(mode) {
  const required = mode === 'format' ? ['jsBeautify'] : HJ_STATE.settings.obfuscation ? ['terser', 'obfuscator'] : ['terser'];
  for (const engine of required) {
    await ensureEngine(engine);
  }
  logInfo('Required JavaScript engines are ready.', { mode, required });
}

async function compressJs(source) {
  await ensureRequiredEngines('compress');
  if (!window.Terser || typeof window.Terser.minify !== 'function') {
    throw new Error('Terser is unavailable after loading.');
  }

  const terserOptions = {
    compress: true,
    mangle: true,
    format: {
      comments: false
    },
    ecma: 2020,
    module: false
  };

  const minified = await window.Terser.minify(source, terserOptions);
  if (!minified || typeof minified.code !== 'string') throw new Error('Terser returned no code.');
  let output = minified.code;

  if (HJ_STATE.settings.obfuscation) {
    if (!window.JavaScriptObfuscator || typeof window.JavaScriptObfuscator.obfuscate !== 'function') {
      throw new Error('JavaScript Obfuscator is unavailable after loading.');
    }
    const result = window.JavaScriptObfuscator.obfuscate(output, {
      compact: true,
      simplify: true,
      identifierNamesGenerator: 'hexadecimal',
      renameGlobals: false,
      stringArray: true,
      stringArrayShuffle: true,
      stringArrayThreshold: 0.75,
      splitStrings: false,
      controlFlowFlattening: false,
      deadCodeInjection: false,
      debugProtection: false,
      disableConsoleOutput: false,
      selfDefending: false,
      unicodeEscapeSequence: false
    });
    if (!result || typeof result.getObfuscatedCode !== 'function') throw new Error('JavaScript Obfuscator returned no result.');
    output = result.getObfuscatedCode();
  }

  return {
    code: output,
    warnings: Array.isArray(minified.warnings) ? minified.warnings : [],
    engine: HJ_STATE.settings.obfuscation ? 'Terser + JavaScript Obfuscator' : 'Terser'
  };
}

async function formatJs(source) {
  await ensureRequiredEngines('format');
  if (typeof window.js_beautify !== 'function') throw new Error('JavaScript Beautifier is unavailable after loading.');
  const code = window.js_beautify(source, {
    indent_size: HJ_STATE.settings.indentSize,
    indent_char: ' ',
    preserve_newlines: true,
    max_preserve_newlines: 2,
    space_in_paren: false,
    e4x: false,
    end_with_newline: true
  });
  if (typeof code !== 'string') throw new Error('JavaScript Beautifier returned no code.');
  return { code, warnings: [], engine: 'js-beautify' };
}

async function processJs() {
  const sequence = HJ_STATE.processSequence;
  const source = getInputJs();
  if (!source.trim()) {
    HJ_STATE.lastResult = '';
    HJ_STATE.lastStats = null;
    if (hjDom.jsOutput) hjDom.jsOutput.value = '';
    if (hjDom.resultMeta) hjDom.resultMeta.textContent = 'まだ処理されていません。';
    setStatus(uiText('inputEmpty'));
    setProcessing(false);
    logInfo('Processing skipped because JavaScript input is empty.');
    return;
  }

  setProcessing(true);
  if (hjDom.resultMeta) hjDom.resultMeta.textContent = '処理しています…';
  const startedAt = performance.now();

  try {
    const result = HJ_STATE.activeMode === 'compress' ? await compressJs(source) : await formatJs(source);
    if (sequence !== HJ_STATE.processSequence) {
      logInfo('Outdated processing result ignored.', { sequence, currentSequence: HJ_STATE.processSequence });
      return;
    }

    const output = String(result.code || '');
    const originalBytes = byteLength(source);
    const outputBytes = byteLength(output);
    const reduction = calculateReduction(originalBytes, outputBytes);
    const elapsedMs = performance.now() - startedAt;

    HJ_STATE.lastResult = output;
    HJ_STATE.lastStats = Object.freeze({ originalBytes, outputBytes, reduction, elapsedMs, engine: result.engine });
    if (hjDom.jsOutput) hjDom.jsOutput.value = output;
    if (hjDom.resultMeta) {
      const warningText = result.warnings.length > 0 ? ` / ${result.warnings.length}件の警告` : '';
      hjDom.resultMeta.textContent = `${formatSize(originalBytes)} → ${formatSize(outputBytes)} / ${uiText('reduction', reduction)} / ${elapsedMs.toFixed(0)}ms / ${result.engine}${warningText}`;
    }
    if (hjDom.actionStatus) setStatus(HJ_STATE.activeMode === 'compress' ? (HJ_STATE.settings.obfuscation ? 'JavaScriptを圧縮・難読化しました。' : uiText('compressed')) : uiText('formatted'));
    updateFileUi();
    logInfo('JavaScript processing succeeded.', HJ_STATE.lastStats);
  } catch (error) {
    if (sequence !== HJ_STATE.processSequence) {
      logInfo('Outdated processing error ignored.', { sequence, currentSequence: HJ_STATE.processSequence });
      return;
    }
    const detail = error instanceof Error ? error.message : String(error);
    if (hjDom.resultMeta) hjDom.resultMeta.textContent = detail;
    setStatus(`${uiText('processFailed')} ${detail}`.trim(), true);
    logError('JavaScript processing failed.', error);
  } finally {
    if (sequence === HJ_STATE.processSequence) setProcessing(false);
  }
}

function scheduleRealtimeProcessing(immediate = false) {
  if (HJ_STATE.scheduledTimer !== null) {
    window.clearTimeout(HJ_STATE.scheduledTimer);
    HJ_STATE.scheduledTimer = null;
  }
  const delay = immediate ? 0 : HJ_CONFIG.realtimeDebounceMs;
  HJ_STATE.scheduledTimer = window.setTimeout(() => {
    HJ_STATE.scheduledTimer = null;
    HJ_STATE.processSequence += 1;
    void processJs();
  }, delay);
  logInfo('Realtime processing scheduled.', { immediate, delay, mode: HJ_STATE.activeMode });
}

async function copyResult() {
  const result = String(hjDom.jsOutput?.value || '');
  if (!result) {
    logError('Copy skipped because output is empty.');
    return;
  }
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('Clipboard API is unavailable.');
    await navigator.clipboard.writeText(result);
    setStatus(uiText('copied'));
    announce(uiText('copied'));
    logInfo('JavaScript result copied successfully.', { bytes: byteLength(result) });
  } catch (error) {
    logError('Result copy failed.', error);
    setStatus(uiText('copyFailed'), true);
  }
}

async function requestWritePermission(handle) {
  if (!handle || typeof handle.createWritable !== 'function') throw new Error('File System Access write handle is unavailable.');
  if (typeof handle.queryPermission !== 'function' || typeof handle.requestPermission !== 'function') return;
  const current = await handle.queryPermission({ mode: 'readwrite' });
  if (current === 'granted') return;
  const requested = await handle.requestPermission({ mode: 'readwrite' });
  if (requested !== 'granted') throw new Error('ファイルへの書き込み権限が許可されませんでした。');
}

async function saveToOpenedFile() {
  if (!HJ_STATE.fileHandle) {
    setStatus(uiText('noOpenFile'), true);
    logError('Save skipped because no File System Access handle exists.');
    return;
  }
  const output = String(hjDom.jsOutput?.value || '');
  if (!output) {
    setStatus(uiText('inputEmpty'), true);
    logError('Save skipped because output is empty.');
    return;
  }

  try {
    setProcessing(true);
    await requestWritePermission(HJ_STATE.fileHandle);
    const writable = await HJ_STATE.fileHandle.createWritable();
    if (!writable || typeof writable.write !== 'function' || typeof writable.close !== 'function') throw new Error('File writer is unavailable.');
    await writable.write(output);
    await writable.close();

    if (hjDom.jsInput) hjDom.jsInput.value = output;
    try {
      const savedFile = await HJ_STATE.fileHandle.getFile();
      if (savedFile instanceof File) {
        HJ_STATE.fileLastModified = savedFile.lastModified;
        HJ_STATE.fileLastSize = savedFile.size;
      }
    } catch (snapshotError) {
      logError('Saved JavaScript file snapshot could not be refreshed.', snapshotError);
    }
    setStatus(uiText('savedToFile', HJ_STATE.fileName));
    announce(uiText('saved'));
    logInfo('JavaScript result written back to the opened file.', { fileName: HJ_STATE.fileName, bytes: byteLength(output) });
  } catch (error) {
    logError('JavaScript file save failed.', error);
    setStatus(`${uiText('saveFailed')} ${error.message || ''}`.trim(), true);
  } finally {
    setProcessing(false);
  }
}

function downloadResult() {
  const output = String(hjDom.jsOutput?.value || '');
  if (!output) {
    logError('Download skipped because output is empty.');
    return;
  }
  try {
    const blob = new Blob([output], { type: 'text/javascript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    if (!link) throw new Error('Download link element could not be created.');
    link.href = url;
    const baseName = HJ_STATE.fileName && /\.js$/i.test(HJ_STATE.fileName) ? HJ_STATE.fileName : HJ_CONFIG.outputFileName;
    link.download = baseName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus(uiText('downloaded'));
    announce(uiText('downloaded'));
    logInfo('JavaScript result downloaded successfully.', { fileName: baseName, bytes: byteLength(output) });
  } catch (error) {
    logError('Result download failed.', error);
    setStatus(uiText('downloadFailed'), true);
  }
}

async function readJsFile(file, handle = null) {
  if (!(file instanceof File)) {
    logError('Selected file is not a File object.', file);
    setStatus(uiText('readFailed'), true);
    return;
  }
  if (!/\.m?js$/i.test(file.name) && file.type && !/javascript|ecmascript/i.test(file.type)) {
    logError('Selected file does not appear to be JavaScript.', { name: file.name, type: file.type });
    setStatus(uiText('readFailed'), true);
    return;
  }

  try {
    const text = await file.text();
    if (!hjDom.jsInput) throw new Error('JavaScript input element is unavailable.');
    if (handle) {
      HJ_STATE.fileHandle = handle;
      HJ_STATE.fileName = file.name;
      HJ_STATE.fileLastModified = Number(file.lastModified) || 0;
      HJ_STATE.fileLastSize = Number(file.size) || byteLength(text);
      stopFileWatcher();
    } else {
      stopFileWatcher();
      HJ_STATE.fileHandle = null;
      HJ_STATE.fileName = '';
      HJ_STATE.fileLastModified = 0;
      HJ_STATE.fileLastSize = 0;
    }

    HJ_STATE.processSequence += 1;
    hjDom.jsInput.value = text;
    HJ_STATE.lastResult = '';
    HJ_STATE.lastStats = null;
    if (hjDom.jsOutput) hjDom.jsOutput.value = '';
    if (hjDom.resultMeta) hjDom.resultMeta.textContent = '処理しています…';
    updateFileUi();
    setStatus(uiText('fileLoaded', file.name));
    logInfo('JavaScript file loaded.', { name: file.name, bytes: byteLength(text), viaFileSystemAccess: Boolean(handle) });
    if (handle) scheduleFileWatcher();
    scheduleRealtimeProcessing(true);
  } catch (error) {
    logError('JavaScript file read failed.', error);
    setStatus(uiText('readFailed'), true);
  }
}

function stopFileWatcher() {
  if (HJ_STATE.fileWatchTimer !== null) {
    window.clearTimeout(HJ_STATE.fileWatchTimer);
    HJ_STATE.fileWatchTimer = null;
  }
  HJ_STATE.fileWatchBusy = false;
  logInfo('Opened JavaScript file watcher stopped.');
}

function scheduleFileWatcher() {
  if (!HJ_STATE.fileHandle || typeof HJ_STATE.fileHandle.getFile !== 'function') return;
  if (HJ_STATE.fileWatchTimer !== null) window.clearTimeout(HJ_STATE.fileWatchTimer);
  HJ_STATE.fileWatchTimer = window.setTimeout(() => {
    HJ_STATE.fileWatchTimer = null;
    void checkOpenedFileForChanges();
  }, HJ_CONFIG.fileWatchIntervalMs);
}

async function checkOpenedFileForChanges() {
  const handle = HJ_STATE.fileHandle;
  if (!handle || typeof handle.getFile !== 'function' || HJ_STATE.fileWatchBusy) return;

  HJ_STATE.fileWatchBusy = true;
  try {
    const file = await handle.getFile();
    if (!(file instanceof File)) throw new Error('Opened JavaScript file snapshot is unavailable.');

    const changed = file.lastModified !== HJ_STATE.fileLastModified || file.size !== HJ_STATE.fileLastSize;
    if (!changed) return;

    const source = await file.text();
    if (!hjDom.jsInput) throw new Error('JavaScript input element is unavailable.');

    HJ_STATE.fileLastModified = file.lastModified;
    HJ_STATE.fileLastSize = file.size;

    if (hjDom.jsInput.value === source) {
      logInfo('Opened JavaScript file metadata changed, but content is unchanged.', {
        name: file.name,
        lastModified: file.lastModified,
        bytes: file.size
      });
      return;
    }

    HJ_STATE.processSequence += 1;
    hjDom.jsInput.value = source;
    HJ_STATE.lastResult = '';
    HJ_STATE.lastStats = null;
    if (hjDom.resultMeta) hjDom.resultMeta.textContent = '外部変更を反映しています…';
    setStatus(uiText('fileExternallyUpdated', file.name));
    announce(uiText('fileExternallyUpdated', file.name));
    logInfo('Opened JavaScript file changed externally; input updated automatically.', {
      name: file.name,
      bytes: file.size,
      lastModified: file.lastModified
    });
    scheduleRealtimeProcessing(true);
  } catch (error) {
    logError('Opened JavaScript file change check failed.', error);
  } finally {
    HJ_STATE.fileWatchBusy = false;
    if (HJ_STATE.fileHandle === handle) scheduleFileWatcher();
  }
}

async function openJsFile() {
  if (typeof window.showOpenFilePicker !== 'function') {
    logError('File System Access API is unavailable in this browser.');
    setStatus(uiText('fileAccessUnavailable'), true);
    if (hjDom.fileInput) hjDom.fileInput.click();
    return;
  }

  try {
    const handles = await window.showOpenFilePicker({
      multiple: false,
      excludeAcceptAllOption: true,
      types: [{
        description: 'JavaScript files',
        accept: { 'text/javascript': ['.js', '.mjs'] }
      }]
    });
    if (!Array.isArray(handles) || handles.length === 0) {
      logInfo('JavaScript file picker returned no file handle.');
      return;
    }
    const handle = handles[0];
    if (!handle || handle.kind !== 'file') {
      logError('The selected File System Access handle is not a file.', handle);
      return;
    }
    const file = await handle.getFile();
    await readJsFile(file, handle);
  } catch (error) {
    if (error?.name === 'AbortError') {
      logInfo('JavaScript file picker was cancelled.');
      return;
    }
    logError('JavaScript file picker failed.', error);
    setStatus(uiText('readFailed'), true);
  }
}

function clearInput() {
  if (!hjDom.jsInput) {
    logError('JavaScript input element is unavailable.');
    return;
  }
  if (HJ_STATE.scheduledTimer !== null) {
    window.clearTimeout(HJ_STATE.scheduledTimer);
    HJ_STATE.scheduledTimer = null;
  }
  HJ_STATE.processSequence += 1;
  stopFileWatcher();
  hjDom.jsInput.value = '';
  if (hjDom.jsOutput) hjDom.jsOutput.value = '';
  if (hjDom.resultMeta) hjDom.resultMeta.textContent = 'まだ処理されていません。';
  HJ_STATE.lastResult = '';
  HJ_STATE.lastStats = null;
  HJ_STATE.fileHandle = null;
  HJ_STATE.fileName = '';
  HJ_STATE.fileLastModified = 0;
  HJ_STATE.fileLastSize = 0;
  updateFileUi();
  setStatus(uiText('inputEmpty'));
  setProcessing(false);
  logInfo('Input, result, and open-file state cleared.');
}

function bindDropEvents() {
  if (!hjDom.inputEditorShell || !hjDom.dropOverlay) {
    logError('Drop UI elements are unavailable.');
    return;
  }
  hjDom.inputEditorShell.addEventListener('dragenter', event => {
    event.preventDefault();
    event.stopPropagation();
    hjDom.dropOverlay.hidden = false;
  });
  hjDom.inputEditorShell.addEventListener('dragover', event => {
    event.preventDefault();
    event.stopPropagation();
    hjDom.dropOverlay.hidden = false;
  });
  hjDom.inputEditorShell.addEventListener('dragleave', event => {
    event.preventDefault();
    event.stopPropagation();
    if (event.relatedTarget && hjDom.inputEditorShell.contains(event.relatedTarget)) return;
    hjDom.dropOverlay.hidden = true;
  });
  hjDom.inputEditorShell.addEventListener('drop', event => {
    event.preventDefault();
    event.stopPropagation();
    hjDom.dropOverlay.hidden = true;
    const files = Array.from(event.dataTransfer?.files || []).filter(file => file instanceof File);
    if (files.length === 0) {
      logError('No files were present in the drop event.');
      return;
    }
    void readJsFile(files[0]);
    logInfo('JavaScript file received by drop.', { name: files[0].name });
  });
}

function setActiveMode(mode, processImmediately = true) {
  if (mode !== 'compress' && mode !== 'format') {
    logError('Unsupported result mode requested.', mode);
    return;
  }
  HJ_STATE.activeMode = mode;
  if (hjDom.compressTab) hjDom.compressTab.active = mode === 'compress';
  if (hjDom.formatTab) hjDom.formatTab.active = mode === 'format';
  if (hjDom.resultTabs) hjDom.resultTabs.activeTabIndex = mode === 'compress' ? 0 : 1;
  logInfo('Result mode changed.', { mode });
  if (processImmediately) scheduleRealtimeProcessing(true);
}

function bindEvents() {
  const requiredIds = [
    ['jsInput', 'js-input'],
    ['jsOutput', 'js-output'],
    ['obfuscationSwitch', 'obfuscation-switch'],
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

  for (const [key, id] of requiredIds) hjDom[key] = getRequiredElement(id);

  if (hjDom.openFileButton) hjDom.openFileButton.addEventListener('click', () => void openJsFile());
  else logError('Open-file button is unavailable.');

  if (hjDom.fileInput) {
    hjDom.fileInput.addEventListener('change', () => {
      const file = hjDom.fileInput.files?.[0];
      hjDom.fileInput.value = '';
      if (!file) {
        logInfo('Fallback JavaScript file picker closed without selection.');
        return;
      }
      void readJsFile(file);
    });
  } else {
    logError('Fallback file input is unavailable.');
  }

  if (hjDom.clearInputButton) hjDom.clearInputButton.addEventListener('click', clearInput);
  else logError('Clear button is unavailable.');

  if (hjDom.copyButton) hjDom.copyButton.addEventListener('click', () => void copyResult());
  else logError('Copy button is unavailable.');

  if (hjDom.saveButton) hjDom.saveButton.addEventListener('click', () => void saveToOpenedFile());
  else logError('Save button is unavailable.');

  if (hjDom.downloadButton) hjDom.downloadButton.addEventListener('click', downloadResult);
  else logError('Download button is unavailable.');

  if (hjDom.obfuscationSwitch) {
    hjDom.obfuscationSwitch.addEventListener('change', () => {
      HJ_STATE.settings.obfuscation = hjDom.obfuscationSwitch.selected === true;
      saveSettings();
      setStatus(HJ_STATE.settings.obfuscation ? '難読化を有効にしました。' : '難読化を無効にしました。');
      logInfo('Obfuscation setting changed.', { enabled: HJ_STATE.settings.obfuscation });
      if (HJ_STATE.activeMode === 'compress') scheduleRealtimeProcessing(true);
    });
  } else {
    logError('Obfuscation switch is unavailable.');
  }

  const indentButtons = document.querySelectorAll('.hj-indent-button');
  if (!indentButtons || indentButtons.length === 0) {
    logError('No indent buttons found.');
  } else {
    indentButtons.forEach(button => {
      button.addEventListener('click', () => {
        const indent = Number(button.dataset.indent);
        if (indent !== 2 && indent !== 4) {
          logError('Invalid indent button value.', button.dataset.indent);
          return;
        }
        HJ_STATE.settings.indentSize = indent;
        saveSettings();
        updateSettingsUi();
        setStatus(`${indent}スペースを設定しました。`);
        logInfo('Indent setting changed.', { indentSize: indent });
        if (HJ_STATE.activeMode === 'format') scheduleRealtimeProcessing(true);
      });
    });
  }

  if (hjDom.compressTab) hjDom.compressTab.addEventListener('click', () => setActiveMode('compress'));
  else logError('Compress tab is unavailable.');

  if (hjDom.formatTab) hjDom.formatTab.addEventListener('click', () => setActiveMode('format'));
  else logError('Format tab is unavailable.');

  if (hjDom.languageSwitchButton) hjDom.languageSwitchButton.addEventListener('click', switchToPreferredLanguage);
  else logError('Language switch button is unavailable.');

  if (hjDom.jsInput) {
    hjDom.jsInput.addEventListener('input', () => scheduleRealtimeProcessing(false));
    logInfo('Realtime input listener bound.');
  } else {
    logError('JavaScript input listener could not be bound.');
  }

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

    for (const language of HJ_SUPPORTED_LANGUAGES) {
      const element = document.getElementById(`hreflang-${language}`);
      if (!element) {
        logError(`hreflang link element is unavailable: ${language}`);
        continue;
      }
      const languageUrl = new URL(canonical.toString());
      languageUrl.pathname = languageUrl.pathname.replace(/[^/]*$/, `${language}.html`);
      element.href = languageUrl.toString();
    }

    for (const selector of ['meta[property="og:url"]', 'script[type="application/ld+json"]']) {
      const element = document.querySelector(selector);
      if (!element) {
        logError(`Metadata element is unavailable: ${selector}`);
        continue;
      }
      if (selector === 'meta[property="og:url"]') element.setAttribute('content', canonical.toString());
      else {
        try {
          const json = JSON.parse(element.textContent || '{}');
          json.url = canonical.toString();
          element.textContent = JSON.stringify(json);
        } catch (error) {
          logError('Structured data JSON could not be updated.', error);
        }
      }
    }
    logInfo('Page metadata initialized.');
  } catch (error) {
    logError('Page metadata initialization failed.', error);
  }
}

function initialize() {
  logInfo('HiJS initialization started.');
  loadSettings();
  bindEvents();
  updateSettingsUi();
  updateFileUi();
  updateLanguageHint();
  initPageMetadata();
  setActiveMode('compress', false);
  setStatus(uiText('inputEmpty'));
  logInfo('HiJS initialization completed.', { settings: HJ_STATE.settings, mode: HJ_STATE.activeMode });
}

document.addEventListener('DOMContentLoaded', initialize, { once: true });
