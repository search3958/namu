const WC_CONFIG = Object.freeze({
  maxPixels: 100_000_000,
  maxFileBytes: 1024 * 1024 * 1024,
  concurrency: 2,
  cdn: Object.freeze({
    webpEncode: 'https://esm.sh/@jsquash/webp@1.5.0?bundle',
    heif: 'https://cdn.jsdelivr.net/npm/libheif-js@1.23.2/libheif-wasm/libheif-bundle.mjs',
    tiff: 'https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js',
    psd: 'https://cdn.jsdelivr.net/npm/ag-psd@31.0.2/+esm',
    pdf: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/+esm',
    pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.mjs',
    jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.2/dist/jszip.min.js'
  })
});

const WC_STATE = {
  files: [],
  settings: {
    quality: 85,
    lossless: false,
    maxSizeEnabled: false,
    maxSize: 2048
  },
  results: new Map(),
  objectUrls: new Set(),
  encoderPromise: null,
  heifPromise: null,
  tiffPromise: null,
  psdPromise: null,
  pdfPromise: null,
  zipPromise: null,
  converting: false,
  autoConversionQueued: false
};

const wcDom = {};

const WC_SUPPORTED_LANGUAGES = Object.freeze([
  'ja',
  'en',
  'zh-CN',
  'zh-TW',
  'ko',
  'ko-KP'
]);

const WC_LANGUAGE_NAMES = Object.freeze({
  ja: Object.freeze({ ja: '日本語', en: 'Japanese', 'zh-CN': '日语', 'zh-TW': '日語', ko: '일본어', 'ko-KP': '일본어' }),
  en: Object.freeze({ ja: '英語', en: 'English', 'zh-CN': '英语', 'zh-TW': '英語', ko: '영어', 'ko-KP': '영어' }),
  'zh-CN': Object.freeze({ ja: '中国語（簡体字）', en: 'Simplified Chinese', 'zh-CN': '简体中文', 'zh-TW': '簡體中文', ko: '중국어(간체)', 'ko-KP': '중국어(간체)' }),
  'zh-TW': Object.freeze({ ja: '中国語（繁体字）', en: 'Traditional Chinese', 'zh-CN': '繁体中文', 'zh-TW': '繁體中文', ko: '중국어(번체)', 'ko-KP': '중국어(번체)' }),
  ko: Object.freeze({ ja: '韓国語', en: 'Korean', 'zh-CN': '韩语', 'zh-TW': '韓語', ko: '한국어', 'ko-KP': '한국어' }),
  'ko-KP': Object.freeze({ ja: '朝鮮語', en: 'Korean (North Korea)', 'zh-CN': '朝鲜语', 'zh-TW': '朝鮮語', ko: '조선어', 'ko-KP': '조선어' })
});

const WC_LANGUAGE_UI = Object.freeze({
  ja: Object.freeze({
    message: language => `${language}で使用できます`,
    action: language => `${language}に切り替える`
  }),
  en: Object.freeze({
    message: language => `Available in ${language}`,
    action: language => `Switch to ${language}`
  }),
  'zh-CN': Object.freeze({
    message: language => `${language}可用`,
    action: language => `切换到${language}`
  }),
  'zh-TW': Object.freeze({
    message: language => `可使用${language}`,
    action: language => `切換至${language}`
  }),
  ko: Object.freeze({
    message: language => `${language}로 사용할 수 있습니다`,
    action: language => `${language}로 전환`
  }),
  'ko-KP': Object.freeze({
    message: language => `${language}로 사용할수 있습니다`,
    action: language => `${language}로 전환`
  })
});

const WC_TAB_INDEX = Object.freeze({
  settings: 0,
  results: 1
});

const WC_SUPPORTED_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg',
  'heic', 'heif', 'heics', 'heifs', 'tif', 'tiff', 'psd', 'pdf'
]);

const WC_SUPPORTED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/svg+xml',
  'image/heic',
  'image/heif',
  'image/tiff',
  'application/pdf'
]);


function logInfo(message, detail) {
  if (typeof detail === 'undefined') {
    console.log(`[WebP Converter] ${message}`);
    return;
  }
  console.log(`[WebP Converter] ${message}`, detail);
}

function logError(message, error) {
  console.error(`[WebP Converter] ${message}`, error);
}

function uiText(key, ...args) {
  const template = window.WC_I18N?.[key];
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
  return WC_SUPPORTED_LANGUAGES.includes(normalized) ? normalized : null;
}

function getPageLanguage() {
  const pathname = window.location.pathname || '';
  const fileName = decodeURIComponent(pathname.split('/').pop() || '').trim();
  const match = /^(ja|en|zh-CN|zh-TW|ko|ko-KP)\.html$/i.exec(fileName);

  if (!match) {
    logInfo('Current page language could not be detected from filename.', { pathname, fileName });
    return null;
  }

  const languageByFilename = match[1];
  const exactLanguage = WC_SUPPORTED_LANGUAGES.find(language => language.toLowerCase() === languageByFilename.toLowerCase());
  if (!exactLanguage) {
    logError('Current page filename matched, but language is not configured.', new Error(languageByFilename));
    return null;
  }

  logInfo('Current page language detected from HTML filename.', { language: exactLanguage, fileName });
  return exactLanguage;
}

function mapBrowserLanguage(value) {
  const normalized = String(value || '').trim().replace(/_/g, '-');
  if (!normalized) return null;

  const lower = normalized.toLowerCase();
  if (lower === 'ko-kp') return 'ko-KP';
  if (lower.startsWith('ko-')) return 'ko';
  if (lower === 'ko') return 'ko';
  if (lower === 'zh-tw' || lower.startsWith('zh-hk') || lower.startsWith('zh-mo') || lower.includes('hant')) return 'zh-TW';
  if (lower === 'zh-cn' || lower === 'zh-sg' || lower === 'zh' || lower.includes('hans')) return 'zh-CN';
  if (lower.startsWith('ja')) return 'ja';
  if (lower.startsWith('en')) return 'en';

  return null;
}

function getPreferredLanguage() {
  try {
    const storedLanguage = normalizeSupportedLanguage(localStorage.getItem('selectedLang'));
    if (storedLanguage) {
      logInfo('Language preference restored from localStorage.', { language: storedLanguage, source: 'selectedLang' });
      return { language: storedLanguage, source: 'localStorage' };
    }

    const browserLanguages = Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];

    for (const browserLanguage of browserLanguages) {
      const mappedLanguage = mapBrowserLanguage(browserLanguage);
      if (mappedLanguage) {
        logInfo('Language preference detected from browser language.', {
          language: mappedLanguage,
          browserLanguage,
          source: 'browser'
        });
        return { language: mappedLanguage, source: 'browser' };
      }
    }
  } catch (error) {
    logError('Language preference could not be read; falling back to browser language.', error);
  }

  const fallback = mapBrowserLanguage(navigator.language) || null;
  if (fallback) {
    logInfo('Language preference fallback detected from navigator.language.', {
      language: fallback,
      browserLanguage: navigator.language,
      source: 'browser-fallback'
    });
    return { language: fallback, source: 'browser-fallback' };
  }

  logInfo('No supported language preference was detected.');
  return { language: null, source: 'none' };
}

function getLocalizedLanguageName(targetLanguage, displayLanguage) {
  const names = WC_LANGUAGE_NAMES[targetLanguage];
  if (!names) {
    logError('Language name map is unavailable.', new Error(`Unknown target language: ${targetLanguage}`));
    return targetLanguage;
  }
  return names[displayLanguage] || names.en || targetLanguage;
}

function buildLanguagePageUrl(targetLanguage) {
  const url = new URL(window.location.href);
  const pathParts = url.pathname.split('/');
  if (pathParts.length === 0) {
    throw new Error('Current URL path is unavailable.');
  }

  const currentFile = pathParts[pathParts.length - 1] || '';
  if (/\.html$/i.test(currentFile)) {
    pathParts[pathParts.length - 1] = `${targetLanguage}.html`;
  } else {
    pathParts.push(`${targetLanguage}.html`);
  }

  url.pathname = pathParts.join('/');
  return url.toString();
}

function updateLanguageHint() {
  if (!wcDom.languageHint || !wcDom.languageHintMessage || !wcDom.languageSwitchButton || !wcDom.languageSwitchLabel) {
    logError('Language hint UI is unavailable.', new Error('Missing language hint elements.'));
    return;
  }

  const pageLanguage = getPageLanguage();
  const preference = getPreferredLanguage();
  const preferredLanguage = preference.language;

  if (!pageLanguage || !preferredLanguage || pageLanguage === preferredLanguage) {
    wcDom.languageHint.hidden = true;
    logInfo('Language hint hidden.', { pageLanguage, preferredLanguage, source: preference.source });
    return;
  }

  const ui = WC_LANGUAGE_UI[preferredLanguage];
  if (!ui) {
    wcDom.languageHint.hidden = true;
    logError('Language hint UI text is unavailable.', new Error(`Missing UI text for ${preferredLanguage}`));
    return;
  }

  const languageName = getLocalizedLanguageName(preferredLanguage, preferredLanguage);
  wcDom.languageHintMessage.textContent = ui.message(languageName);
  wcDom.languageSwitchLabel.textContent = ui.action(languageName);
  wcDom.languageSwitchButton.dataset.targetLanguage = preferredLanguage;
  wcDom.languageHint.hidden = false;
  logInfo('Language hint shown.', {
    pageLanguage,
    preferredLanguage,
    source: preference.source,
    languageName
  });
}

function switchToPreferredLanguage() {
  const targetLanguage = normalizeSupportedLanguage(wcDom.languageSwitchButton?.dataset.targetLanguage);
  if (!targetLanguage) {
    logError('Language switch failed: target language is missing or unsupported.', new Error('Invalid target language.'));
    return;
  }

  try {
    const targetUrl = buildLanguagePageUrl(targetLanguage);
    const currentUrl = window.location.href;
    if (targetUrl === currentUrl) {
      logInfo('Language switch skipped because the target page is already open.', { targetLanguage });
      return;
    }

    logInfo('Switching to preferred language page.', { targetLanguage, targetUrl });
    window.location.assign(targetUrl);
  } catch (error) {
    logError('Language page navigation failed.', error);
  }
}

function getExtension(name) {
  const cleanName = String(name || '').split(/[\\/]/).pop() || '';
  const index = cleanName.lastIndexOf('.');
  return index > 0 ? cleanName.slice(index + 1).toLowerCase() : '';
}

function getBaseName(name) {
  const cleanName = String(name || 'image').split(/[\\/]/).pop() || 'image';
  const index = cleanName.lastIndexOf('.');
  const base = index > 0 ? cleanName.slice(0, index) : cleanName;
  return base.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 120) || 'image';
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) {
    return '—';
  }
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function formatDimensions(width, height) {
  return Number.isFinite(width) && Number.isFinite(height) ? `${width.toLocaleString()} × ${height.toLocaleString()}` : uiText('dimensionUnknown');
}

function formatPercentChange(originalBytes, outputBytes) {
  if (!Number.isFinite(originalBytes) || !Number.isFinite(outputBytes) || originalBytes <= 0) {
    return { text: '', className: 'wc-result-size-neutral' };
  }
  const delta = ((outputBytes - originalBytes) / originalBytes) * 100;
  if (delta < 0) {
    return { text: `${Math.abs(delta).toFixed(1)}% ${uiText('shrink')}`, className: 'wc-result-size-good' };
  }
  if (delta > 0) {
    return { text: `${delta.toFixed(1)}% ${uiText('grow')}`, className: 'wc-result-size-bad' };
  }
  return { text: uiText('sizeNeutral'), className: 'wc-result-size-neutral' };
}

function announce(message) {
  if (!wcDom.srStatus) {
    logError('Screen reader status element is unavailable.', new Error('Missing #sr-status'));
    return;
  }
  wcDom.srStatus.textContent = message;
}

function showError(title, message, cause) {
  logError(`${title}: ${message}`, cause || new Error(message));
  if (wcDom.errorTitle) wcDom.errorTitle.textContent = title;
  if (wcDom.errorMessage) wcDom.errorMessage.textContent = message;
  if (wcDom.errorDialog && typeof wcDom.errorDialog.show === 'function') {
    wcDom.errorDialog.show();
  } else {
    logError('Error dialog is unavailable; message was logged only.');
  }
}

function rememberObjectUrl(url) {
  WC_STATE.objectUrls.add(url);
  return url;
}

function revokeAllObjectUrls() {
  for (const url of WC_STATE.objectUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch (error) {
      logError('Failed to revoke object URL.', error);
    }
  }
  WC_STATE.objectUrls.clear();
}

function getStoredSettings() {
  try {
    const raw = localStorage.getItem('wc-settings');
    if (!raw) {
      logInfo('No saved settings found; using defaults.');
      return;
    }
    const parsed = JSON.parse(raw);
    if (Number.isFinite(parsed.quality)) {
      WC_STATE.settings.quality = Math.min(100, Math.max(1, Math.round(parsed.quality)));
    }
    WC_STATE.settings.lossless = parsed.lossless === true;
    if (typeof parsed.maxSizeEnabled === 'boolean') {
      WC_STATE.settings.maxSizeEnabled = parsed.maxSizeEnabled;
    } else if (['4096', '2048', '1024'].includes(parsed.maxSize)) {
      WC_STATE.settings.maxSizeEnabled = true;
    }
    if (Number.isFinite(Number(parsed.maxSize)) && Number(parsed.maxSize) > 0) {
      WC_STATE.settings.maxSize = Math.min(100000, Math.max(1, Math.round(Number(parsed.maxSize))));
    }
    logInfo('Saved settings restored.', WC_STATE.settings);
  } catch (error) {
    logError('Saved settings could not be restored; using defaults.', error);
  }
}

function saveSettings() {
  try {
    localStorage.setItem('wc-settings', JSON.stringify(WC_STATE.settings));
    logInfo('Settings saved.', WC_STATE.settings);
  } catch (error) {
    logError('Settings could not be saved.', error);
  }
}

function updateSettingsUi() {
  if (wcDom.qualitySlider) wcDom.qualitySlider.value = WC_STATE.settings.quality;
  if (wcDom.qualityValue) wcDom.qualityValue.textContent = String(WC_STATE.settings.quality);
  if (wcDom.losslessSwitch) wcDom.losslessSwitch.selected = WC_STATE.settings.lossless;
  if (wcDom.maxSizeSwitch) wcDom.maxSizeSwitch.selected = WC_STATE.settings.maxSizeEnabled;
  if (wcDom.maxSizeInput) {
    wcDom.maxSizeInput.value = String(WC_STATE.settings.maxSize);
    wcDom.maxSizeInput.disabled = !WC_STATE.settings.maxSizeEnabled;
  }
  if (wcDom.qualitySlider) wcDom.qualitySlider.disabled = WC_STATE.settings.lossless;
}

async function loadClassicScript(url, globalName) {
  if (globalName && window[globalName]) {
    logInfo(`Library already available: ${globalName}`);
    return window[globalName];
  }

  const existing = Array.from(document.scripts).find(script => script.dataset.wcCdn === url) ?? null;
  if (existing) {
    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error(`Timed out loading ${url}`)), 30_000);
      existing.addEventListener('load', () => {
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
      existing.addEventListener('error', () => {
        window.clearTimeout(timeout);
        reject(new Error(`Failed to load ${url}`));
      }, { once: true });
    });
    return globalName ? window[globalName] : undefined;
  }

  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    if (!script) {
      reject(new Error('Failed to create script element.'));
      return;
    }
    script.src = url;
    script.async = true;
    script.dataset.wcCdn = url;
    script.onload = () => {
      logInfo(`CDN script loaded: ${url}`);
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load CDN script: ${url}`));
    if (!document.head) {
      reject(new Error('Document head is unavailable.'));
      return;
    }
    document.head.appendChild(script);
  });

  if (globalName && !window[globalName]) {
    throw new Error(`CDN script loaded but global ${globalName} is unavailable.`);
  }
  return globalName ? window[globalName] : undefined;
}

async function loadWebpEncoder() {
  if (!WC_STATE.encoderPromise) {
    WC_STATE.encoderPromise = import(WC_CONFIG.cdn.webpEncode)
      .then(module => {
        const encode = module.default ?? module.encode;
        if (typeof encode !== 'function') {
          throw new Error('WebP encoder export was not found.');
        }
        logInfo('WebP WASM encoder loaded.');
        return encode;
      })
      .catch(error => {
        WC_STATE.encoderPromise = null;
        throw error;
      });
  }
  return WC_STATE.encoderPromise;
}

async function loadHeif() {
  if (!WC_STATE.heifPromise) {
    WC_STATE.heifPromise = import(WC_CONFIG.cdn.heif)
      .then(module => module.default ?? module)
      .then(libheif => {
        if (!libheif || typeof libheif.HeifDecoder !== 'function') {
          throw new Error('libheif decoder export was not found.');
        }
        logInfo('HEIF/HEIC WASM decoder loaded.');
        return libheif;
      })
      .catch(error => {
        WC_STATE.heifPromise = null;
        throw error;
      });
  }
  return WC_STATE.heifPromise;
}

async function loadTiff() {
  if (!WC_STATE.tiffPromise) {
    WC_STATE.tiffPromise = loadClassicScript(WC_CONFIG.cdn.tiff, 'UTIF')
      .then(utif => {
        if (!utif || typeof utif.decode !== 'function' || typeof utif.toRGBA8 !== 'function') {
          throw new Error('UTIF decoder API was not found.');
        }
        logInfo('TIFF decoder loaded.');
        return utif;
      })
      .catch(error => {
        WC_STATE.tiffPromise = null;
        throw error;
      });
  }
  return WC_STATE.tiffPromise;
}

async function loadPsd() {
  if (!WC_STATE.psdPromise) {
    WC_STATE.psdPromise = import(WC_CONFIG.cdn.psd)
      .then(module => module.default ?? module)
      .then(api => {
        if (!api || typeof api.readPsd !== 'function') {
          throw new Error('ag-psd readPsd API was not found.');
        }
        logInfo('PSD decoder loaded.');
        return api;
      })
      .catch(error => {
        WC_STATE.psdPromise = null;
        throw error;
      });
  }
  return WC_STATE.psdPromise;
}

async function loadPdf() {
  if (!WC_STATE.pdfPromise) {
    WC_STATE.pdfPromise = import(WC_CONFIG.cdn.pdf)
      .then(module => module.default ?? module)
      .then(pdfjs => {
        const api = pdfjs.pdfjsLib ?? pdfjs;
        if (!api || typeof api.getDocument !== 'function') {
          throw new Error('PDF.js API was not found.');
        }
        if (api.GlobalWorkerOptions) {
          api.GlobalWorkerOptions.workerSrc = WC_CONFIG.cdn.pdfWorker;
        }
        logInfo('PDF.js loaded.');
        return api;
      })
      .catch(error => {
        WC_STATE.pdfPromise = null;
        throw error;
      });
  }
  return WC_STATE.pdfPromise;
}

async function loadJsZip() {
  if (!WC_STATE.zipPromise) {
    WC_STATE.zipPromise = loadClassicScript(WC_CONFIG.cdn.jszip, 'JSZip')
      .then(JSZip => {
        if (typeof JSZip !== 'function') {
          throw new Error('JSZip global was not found.');
        }
        logInfo('JSZip loaded for batch download.');
        return JSZip;
      })
      .catch(error => {
        WC_STATE.zipPromise = null;
        throw error;
      });
  }
  return WC_STATE.zipPromise;
}

function isLikelyHeif(file) {
  const extension = getExtension(file.name);
  return ['heic', 'heif', 'heics', 'heifs'].includes(extension);
}

function isPdf(file) {
  return getExtension(file.name) === 'pdf' || file.type === 'application/pdf';
}

function isTiff(file) {
  const extension = getExtension(file.name);
  return ['tif', 'tiff'].includes(extension) || file.type === 'image/tiff';
}

function isPsd(file) {
  const extension = getExtension(file.name);
  return extension === 'psd';
}

function isSupportedFile(file) {
  if (!(file instanceof File)) {
    return false;
  }
  const extension = getExtension(file.name);
  const mimeType = String(file.type || '').toLowerCase();
  return WC_SUPPORTED_EXTENSIONS.has(extension) || WC_SUPPORTED_MIME_TYPES.has(mimeType);
}

async function ensureFileIsReasonable(file) {
  if (!(file instanceof File)) {
    throw new Error(uiText('notFile'));
  }
  if (file.size > WC_CONFIG.maxFileBytes) {
    throw new Error(uiText('fileTooLarge', formatBytes(WC_CONFIG.maxFileBytes)));
  }
}

async function createCanvas(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(uiText('invalidImageSize'));
  }
  const pixels = width * height;
  if (pixels > WC_CONFIG.maxPixels) {
    throw new Error(uiText('tooManyPixels', WC_CONFIG.maxPixels));
  }
  const canvas = document.createElement('canvas');
  if (!canvas) {
    throw new Error(uiText('canvasCreationFailed'));
  }
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
  if (!context) {
    throw new Error(uiText('canvasContextFailed'));
  }
  return { canvas, context };
}

async function decodeNativeImage(file) {
  let bitmap = null;

  if (typeof createImageBitmap === 'function') {
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image', premultiplyAlpha: 'default' });
      logInfo(`Native decoder: createImageBitmap succeeded for ${file.name}.`);
    } catch (error) {
      logInfo(`createImageBitmap did not decode ${file.name}; falling back to HTMLImageElement.`, error);
    }
  }

  if (bitmap) {
    try {
      const { canvas, context } = await createCanvas(bitmap.width, bitmap.height);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0);
      return { canvas, width: bitmap.width, height: bitmap.height, kind: 'native' };
    } finally {
      if (typeof bitmap.close === 'function') bitmap.close();
    }
  }

  const url = rememberObjectUrl(URL.createObjectURL(file));
  const image = new Image();
  if (!image) throw new Error(uiText('imageElementFailed'));
  image.decoding = 'async';
  image.alt = '';
  image.src = url;

  await new Promise((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(uiText('browserLoadFailed', file.name)));
  });

  const { canvas, context } = await createCanvas(image.naturalWidth, image.naturalHeight);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  logInfo(`Native decoder: HTMLImageElement succeeded for ${file.name}.`);
  return { canvas, width: image.naturalWidth, height: image.naturalHeight, kind: 'native' };
}

async function decodeTiff(file) {
  const UTIF = await loadTiff();
  const buffer = await file.arrayBuffer();
  const ifds = UTIF.decode(buffer);
  if (!Array.isArray(ifds) || ifds.length === 0) {
    throw new Error(uiText('tiffNoImages'));
  }
  const firstIfd = ifds[0];
  UTIF.decodeImage(buffer, firstIfd);
  const rgba = UTIF.toRGBA8(firstIfd);
  const width = firstIfd.width ?? firstIfd.t256;
  const height = firstIfd.height ?? firstIfd.t257;
  if (!width || !height || !rgba) {
    throw new Error(uiText('tiffInvalidData'));
  }
  const { canvas, context } = await createCanvas(width, height);
  const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
  context.putImageData(imageData, 0, 0);
  logInfo(`TIFF decoded: ${file.name}`, { width, height });
  return { canvas, width, height, kind: 'tiff' };
}

async function decodeHeif(file) {
  const libheif = await loadHeif();
  const decoder = new libheif.HeifDecoder();
  if (!decoder || typeof decoder.decode !== 'function') {
    throw new Error(uiText('heifInitFailed'));
  }
  const buffer = await file.arrayBuffer();
  const images = decoder.decode(new Uint8Array(buffer));
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error(uiText('heifNoImages'));
  }
  const image = images[0];
  const width = image.get_width();
  const height = image.get_height();
  const { canvas, context } = await createCanvas(width, height);
  const rgba = new Uint8ClampedArray(width * height * 4);

  await new Promise((resolve, reject) => {
    image.display({ data: rgba, width, height }, displayData => {
      if (!displayData) {
        reject(new Error(uiText('heifDecodeFailed')));
        return;
      }
      resolve();
    });
  });

  context.putImageData(new ImageData(rgba, width, height), 0, 0);
  if (typeof image.free === 'function') image.free();
  logInfo(`HEIF decoded: ${file.name}`, { width, height });
  return { canvas, width, height, kind: 'heif' };
}

async function decodePsd(file) {
  const agPsd = await loadPsd();
  const buffer = await file.arrayBuffer();
  const psd = agPsd.readPsd(buffer, { logMissingFeatures: false });
  const canvas = psd?.canvas;
  if (!canvas || typeof canvas.width !== 'number' || typeof canvas.height !== 'number') {
    throw new Error(uiText('psdCompositeFailed'));
  }
  logInfo(`PSD decoded: ${file.name}`, { width: canvas.width, height: canvas.height });
  return { canvas, width: canvas.width, height: canvas.height, kind: 'psd' };
}

async function decodePdf(file) {
  const pdfjs = await loadPdf();
  const buffer = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: buffer, isEvalSupported: false });
  const pdf = await loadingTask.promise;
  if (!pdf || pdf.numPages < 1) {
    throw new Error(uiText('pdfNoPages'));
  }
  const page = await pdf.getPage(1);
  const baseViewport = page.getViewport({ scale: 1 });
  const maxDimension = WC_STATE.settings.maxSizeEnabled ? Number(WC_STATE.settings.maxSize) : Math.max(baseViewport.width, baseViewport.height);
  const scale = maxDimension > 0 ? Math.min(1, maxDimension / Math.max(baseViewport.width, baseViewport.height)) : 1;
  const viewport = page.getViewport({ scale });
  const { canvas, context } = await createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
  const renderTask = page.render({ canvasContext: context, viewport });
  await renderTask.promise;
  logInfo(`PDF first page rendered: ${file.name}`, { width: canvas.width, height: canvas.height });
  if (typeof pdf.cleanup === 'function') pdf.cleanup();
  return { canvas, width: canvas.width, height: canvas.height, kind: 'pdf-first-page' };
}

async function decodeFile(file) {
  await ensureFileIsReasonable(file);
  if (isPdf(file)) return decodePdf(file);
  if (isPsd(file)) return decodePsd(file);
  if (isTiff(file)) return decodeTiff(file);
  if (isLikelyHeif(file)) return decodeHeif(file);
  return decodeNativeImage(file);
}

function getTargetDimensions(width, height) {
  const limit = WC_STATE.settings.maxSizeEnabled ? Number(WC_STATE.settings.maxSize) : null;
  if (!limit || !Number.isFinite(limit) || limit <= 0) {
    return { width, height };
  }
  const longestSide = Math.max(width, height);
  if (longestSide <= limit) {
    return { width, height };
  }
  const ratio = limit / longestSide;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio))
  };
}

async function getOutputImageData(canvas, width, height) {
  const target = getTargetDimensions(width, height);
  if (target.width === width && target.height === height) {
    const context = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
    if (!context) throw new Error(uiText('originalCanvasContextFailed'));
    return context.getImageData(0, 0, width, height);
  }

  const { canvas: resizedCanvas, context: resizedContext } = await createCanvas(target.width, target.height);
  resizedContext.imageSmoothingEnabled = true;
  resizedContext.imageSmoothingQuality = 'high';
  resizedContext.drawImage(canvas, 0, 0, target.width, target.height);
  logInfo('Image resized.', { from: `${width}x${height}`, to: `${target.width}x${target.height}` });
  return resizedContext.getImageData(0, 0, target.width, target.height);
}

async function encodeWebp(imageData) {
  const encode = await loadWebpEncoder();
  const options = WC_STATE.settings.lossless
    ? { quality: 100, lossless: 1 }
    : { quality: WC_STATE.settings.quality, lossless: 0 };
  const buffer = await encode(imageData, options);
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
    throw new Error(uiText('encoderInvalid'));
  }
  return new Blob([buffer], { type: 'image/webp' });
}

async function convertFile(file) {
  logInfo(`Conversion started: ${file.name}`);
  const decoded = await decodeFile(file);
  const imageData = await getOutputImageData(decoded.canvas, decoded.width, decoded.height);
  const outputBlob = await encodeWebp(imageData);
  logInfo(`Conversion finished: ${file.name}`, {
    input: file.size,
    output: outputBlob.size,
    width: imageData.width,
    height: imageData.height
  });
  return {
    file,
    blob: outputBlob,
    width: imageData.width,
    height: imageData.height,
    name: `${getBaseName(file.name)}.webp`,
    sourceKind: decoded.kind
  };
}

function createFileKey(file, index) {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}\u0000${index}`;
}

function setActiveTab(index, reason = 'manual') {
  if (!wcDom.mainTabs || !wcDom.settingsPanel || !wcDom.resultsPanel) {
    logError('Tab UI is unavailable.', new Error('Missing tab elements.'));
    return;
  }

  const normalizedIndex = index === WC_TAB_INDEX.results ? WC_TAB_INDEX.results : WC_TAB_INDEX.settings;
  wcDom.mainTabs.activeTabIndex = normalizedIndex;
  wcDom.settingsPanel.hidden = normalizedIndex !== WC_TAB_INDEX.settings;
  wcDom.resultsPanel.hidden = normalizedIndex !== WC_TAB_INDEX.results;
  logInfo('Active tab changed.', { index: normalizedIndex, reason });
}

function setToolbarState() {
  const count = WC_STATE.files.length;
  wcDom.fileCount.textContent = uiText('fileCount', count);
  wcDom.toolbarStatus.textContent = count > 0 ? uiText('canConvert') : uiText('addFilesHint');
  wcDom.resultToolbar.hidden = count === 0;
  wcDom.convertButton.disabled = count === 0 || WC_STATE.converting;
}

function setProgress(current, total, message) {
  const ratio = total > 0 ? current / total : 0;
  wcDom.progressBar.value = ratio;
  wcDom.progressPercent.textContent = `${Math.round(ratio * 100)}%`;
  wcDom.progressLabel.textContent = message;
}

function renderResults() {
  wcDom.results.textContent = '';
  const resultEntries = Array.from(WC_STATE.results.values());
  const hasResults = resultEntries.length > 0;
  wcDom.resultsSection.hidden = !hasResults;
  if (!hasResults) {
    return;
  }

  for (const result of resultEntries) {
    const card = document.createElement('article');
    if (!card) {
      logError('Could not create result card.');
      continue;
    }
    card.className = `wc-result-card${result.error ? ' wc-result-error' : ''}`;

    const preview = document.createElement('img');
    if (!preview) {
      logError('Could not create result preview.');
      continue;
    }
    preview.className = 'wc-result-preview';
    preview.alt = result.name || result.file.name;
    if (!result.error && result.blob) {
      if (!result.previewUrl) {
        result.previewUrl = rememberObjectUrl(URL.createObjectURL(result.blob));
      }
      preview.src = result.previewUrl;
    }

    const body = document.createElement('div');
    body.className = 'wc-result-body';

    const name = document.createElement('div');
    name.className = 'wc-result-name';
    name.textContent = result.name || result.file.name;
    name.title = result.name || result.file.name;

    const meta = document.createElement('div');
    meta.className = 'wc-result-meta';

    const dimensions = document.createElement('span');
    dimensions.textContent = result.error ? formatBytes(result.file.size) : formatDimensions(result.width, result.height);
    meta.appendChild(dimensions);

    const size = document.createElement('span');
    size.textContent = result.error ? uiText('conversionFailed') : `${formatBytes(result.file.size)} → ${formatBytes(result.blob.size)}`;
    meta.appendChild(size);

    const status = document.createElement('div');
    status.className = 'wc-result-status';
    if (result.error) {
      status.textContent = result.errorMessage;
    } else {
      const change = formatPercentChange(result.file.size, result.blob.size);
      status.textContent = change.text;
      status.classList.add(change.className);
    }

    body.appendChild(name);
    body.appendChild(meta);
    body.appendChild(status);

    const actions = document.createElement('div');
    actions.className = 'wc-result-actions';
    if (!result.error && result.blob) {
      const button = document.createElement('md-outlined-button');
      button.setAttribute('aria-label', uiText('saveAs', result.name));
      button.innerHTML = `<md-icon slot="icon">download</md-icon>${uiText('saveButton')}`;
      button.addEventListener('click', () => downloadBlob(result.blob, result.name));
      actions.appendChild(button);
    }

    card.appendChild(preview);
    card.appendChild(body);
    card.appendChild(actions);
    wcDom.results.appendChild(card);
  }
  logInfo('Results rendered.', { count: resultEntries.length });
}

function addFiles(fileList) {
  if (!fileList) {
    logError('No FileList was supplied.');
    return;
  }

  const incoming = Array.from(fileList).filter(item => item instanceof File);
  if (incoming.length === 0) {
    logInfo('No files selected.');
    return;
  }

  const existing = new Set(
    WC_STATE.files.map(file => `${file.name}\u0000${file.size}\u0000${file.lastModified}`)
  );

  let added = 0;
  let skippedUnsupported = 0;

  for (const file of incoming) {
    if (!isSupportedFile(file)) {
      skippedUnsupported += 1;
      logInfo(`Unsupported format skipped: ${file.name}`, {
        type: file.type || '(unknown)',
        extension: getExtension(file.name) || '(none)'
      });
      continue;
    }

    const signature = `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
    if (existing.has(signature)) {
      logInfo(`Duplicate skipped: ${file.name}`);
      continue;
    }

    existing.add(signature);
    WC_STATE.files.push(file);
    added += 1;
  }

  setToolbarState();

  if (skippedUnsupported > 0) {
    logInfo(`Unsupported files skipped: ${skippedUnsupported}`);
  }

  if (added === 0) {
    announce(
      skippedUnsupported > 0
        ? uiText('unsupportedSkipped', skippedUnsupported)
        : uiText('noNewFiles')
    );
    return;
  }

  announce(
    skippedUnsupported > 0
      ? uiText('addedSkipped', added, skippedUnsupported)
      : uiText('added', added)
  );
  logInfo(`Files added: ${added}`, WC_STATE.files.map(file => file.name));
  setActiveTab(WC_TAB_INDEX.results, 'files-added');

  if (WC_STATE.converting) {
    WC_STATE.autoConversionQueued = true;
    logInfo('Automatic conversion queued for newly added files.');
    return;
  }

  void startConversion({ force: false });
}

function clearAll() {
  if (WC_STATE.converting) {
    logInfo('Clear ignored while conversion is running.');
    return;
  }
  WC_STATE.files = [];
  WC_STATE.results.clear();
  WC_STATE.autoConversionQueued = false;
  revokeAllObjectUrls();
  wcDom.results.textContent = '';
  wcDom.resultsSection.hidden = true;
  wcDom.fileInput.value = '';
  setToolbarState();
  setProgress(0, 0, uiText('waiting'));
  wcDom.progressSection.hidden = true;
  setActiveTab(WC_TAB_INDEX.settings, 'clear');
  announce(uiText('filesCleared'));
  logInfo('All files and results cleared.');
}

async function runWithConcurrency(items, limit, handler) {
  const total = items.length;
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= total) return;
      await handler(items[currentIndex], currentIndex);
      completed += 1;
      setProgress(completed, total, uiText('processing', completed, total));
    }
  }

  const workerCount = Math.min(limit, Math.max(1, total));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

async function startConversion({ force = false } = {}) {
  if (WC_STATE.converting) {
    logInfo('Conversion request ignored because another conversion is running.');
    return;
  }
  if (WC_STATE.files.length === 0) {
    showError(uiText('noFiles'), uiText('addFilesFirst'));
    return;
  }

  const items = force
    ? [...WC_STATE.files]
    : WC_STATE.files.filter((file, index) => !WC_STATE.results.has(createFileKey(file, index)));

  if (items.length === 0) {
    logInfo('No unprocessed files remain; automatic conversion was skipped.');
    setToolbarState();
    return;
  }

  WC_STATE.converting = true;

  if (force) {
    WC_STATE.results.clear();
    revokeAllObjectUrls();
  }

  wcDom.progressSection.hidden = false;
  wcDom.convertButton.disabled = true;
  wcDom.clearButton.disabled = true;
  setProgress(0, items.length, uiText('converting'));
  announce(force ? uiText('conversionStarted') : uiText('autoConversionStarted'));
  logInfo('Batch conversion started.', { force, count: items.length });

  try {
    await runWithConcurrency(items, WC_CONFIG.concurrency, async (file) => {
      const index = WC_STATE.files.indexOf(file);
      if (index < 0) {
        logError(`Conversion target disappeared: ${file.name}`);
        return;
      }

      const key = createFileKey(file, index);

      try {
        const result = await convertFile(file);
        WC_STATE.results.set(key, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : uiText('unknownError');
        WC_STATE.results.set(key, {
          file,
          name: `${getBaseName(file.name)}.webp`,
          error: true,
          errorMessage: message
        });
        logError(`Conversion failed: ${file.name}`, error);
      }

      renderResults();
    });

    const processedCount = items.length;
    const successCount = items.filter(file => {
      const index = WC_STATE.files.indexOf(file);
      return index >= 0 && !WC_STATE.results.get(createFileKey(file, index))?.error;
    }).length;
    const failedCount = processedCount - successCount;

    setProgress(
      processedCount,
      processedCount,
      failedCount > 0
        ? uiText('successFail', successCount, failedCount)
        : uiText('completed')
    );

    announce(
      failedCount > 0
        ? uiText('someFailed', successCount, failedCount)
        : uiText('allSuccess', successCount)
    );

    logInfo('Batch conversion finished.', {
      force,
      processedCount,
      successCount,
      failedCount
    });
  } catch (error) {
    showError(
      uiText('conversionStopped'),
      error instanceof Error ? error.message : uiText('unknownError'),
      error
    );
  } finally {
    WC_STATE.converting = false;
    wcDom.convertButton.disabled = false;
    wcDom.clearButton.disabled = false;
    setToolbarState();
    renderResults();

    if (WC_STATE.autoConversionQueued) {
      WC_STATE.autoConversionQueued = false;
      logInfo('Starting queued automatic conversion.');
      void startConversion({ force: false });
    }
  }
}

function downloadBlob(blob, name) {
  if (!(blob instanceof Blob)) {
    logError('Download failed: invalid Blob.', blob);
    return;
  }
  const url = rememberObjectUrl(URL.createObjectURL(blob));
  const anchor = document.createElement('a');
  if (!anchor) {
    logError('Download failed: anchor element could not be created.');
    return;
  }
  anchor.href = url;
  anchor.download = name || 'image.webp';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
      WC_STATE.objectUrls.delete(url);
    } catch (error) {
      logError('Failed to revoke download URL.', error);
    }
  }, 1_000);
  logInfo(`Download started: ${name}`);
}

async function downloadAll() {
  const successful = Array.from(WC_STATE.results.values()).filter(result => !result.error && result.blob);
  if (successful.length === 0) {
    showError(uiText('saveableResults'), uiText('completeConversionFirst'));
    return;
  }

  try {
    wcDom.downloadAllButton.disabled = true;
    announce(uiText('creatingZip'));
    const JSZip = await loadJsZip();
    const zip = new JSZip();

    if (!zip || typeof zip.file !== 'function') {
      throw new Error(uiText('zipCreationFailed'));
    }

    const usedNames = new Set();
    for (const result of successful) {
      let name = result.name;
      if (usedNames.has(name)) {
        let suffix = 2;
        const base = getBaseName(name);
        while (usedNames.has(`${base}-${suffix}.webp`)) {
          suffix += 1;
        }
        name = `${base}-${suffix}.webp`;
      }
      usedNames.add(name);
      zip.file(name, result.blob);
    }

    const archive = await zip.generateAsync({
      type: 'blob',
      compression: 'STORE'
    });

    downloadBlob(archive, 'webp-converted.zip');
    announce(uiText('zipCreated'));
    logInfo('Batch ZIP created.', { files: successful.length, bytes: archive.size });
  } catch (error) {
    showError(
      uiText('zipCreationFailed'),
      error instanceof Error ? error.message : uiText('unknownError'),
      error
    );
  } finally {
    wcDom.downloadAllButton.disabled = false;
  }
}

function bindDom() {
  const ids = [
    'dropzone', 'file-input', 'result-toolbar', 'file-count', 'toolbar-status',
    'clear-button', 'convert-button', 'progress-section', 'progress-bar', 'progress-label', 'progress-percent',
    'main-tabs', 'settings-panel', 'results-panel', 'results-section', 'results', 'download-all-button', 'settings-form', 'quality-slider',
    'quality-value', 'lossless-switch', 'max-size-switch', 'max-size-input', 'error-dialog', 'error-title', 'error-message',
    'error-close-button', 'sr-status', 'language-hint', 'language-hint-message', 'language-switch-button', 'language-switch-label'
  ];
  for (const id of ids) {
    const property = id.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    wcDom[property] = getRequiredElement(id);
  }
  return Object.values(wcDom).every(Boolean);
}

function bindEvents() {
  if (!bindDom()) {
    throw new Error('DOM initialization failed.');
  }

  wcDom.dropzone.addEventListener('click', () => {
    if (WC_STATE.converting) {
      logInfo('File picker click ignored while converting.');
      return;
    }
    wcDom.fileInput.click();
  });

  wcDom.dropzone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      wcDom.fileInput.click();
    }
  });

  wcDom.fileInput.addEventListener('change', event => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement)) {
      logError('File input event target is invalid.');
      return;
    }
    addFiles(target.files);
  });

  ['dragenter', 'dragover'].forEach(type => {
    wcDom.dropzone.addEventListener(type, event => {
      event.preventDefault();
      wcDom.dropzone.classList.add('wc-is-dragging');
    });
  });

  ['dragleave', 'dragend', 'drop'].forEach(type => {
    wcDom.dropzone.addEventListener(type, event => {
      event.preventDefault();
      wcDom.dropzone.classList.remove('wc-is-dragging');
    });
  });

  wcDom.dropzone.addEventListener('drop', event => {
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) {
      logError('Drop event has no DataTransfer.');
      return;
    }
    addFiles(dataTransfer.files);
  });

  wcDom.mainTabs.addEventListener('change', event => {
    const target = event.currentTarget;
    if (!target || typeof target.activeTabIndex !== 'number') {
      logError('Tab change event target is invalid.', target);
      return;
    }
    setActiveTab(target.activeTabIndex, 'user');
  });

  wcDom.clearButton.addEventListener('click', clearAll);
  wcDom.convertButton.addEventListener('click', () => {
    void startConversion({ force: true });
  });
  wcDom.downloadAllButton.addEventListener('click', downloadAll);
  wcDom.languageSwitchButton.addEventListener('click', switchToPreferredLanguage);

  wcDom.qualitySlider.addEventListener('input', () => {
    const value = Number(wcDom.qualitySlider.value);
    if (!Number.isFinite(value)) {
      logError('Quality slider produced an invalid value.', value);
      return;
    }
    WC_STATE.settings.quality = Math.round(value);
    wcDom.qualityValue.textContent = String(WC_STATE.settings.quality);
    saveSettings();
    logInfo(`Quality changed: ${WC_STATE.settings.quality}`);
  });

  wcDom.losslessSwitch.addEventListener('change', () => {
    WC_STATE.settings.lossless = wcDom.losslessSwitch.selected === true;
    wcDom.qualitySlider.disabled = WC_STATE.settings.lossless;
    saveSettings();
    logInfo(`Lossless changed: ${WC_STATE.settings.lossless}`);
  });

  wcDom.maxSizeSwitch.addEventListener('change', () => {
    WC_STATE.settings.maxSizeEnabled = wcDom.maxSizeSwitch.selected === true;
    wcDom.maxSizeInput.disabled = !WC_STATE.settings.maxSizeEnabled;
    saveSettings();
    logInfo(`Max size enabled changed: ${WC_STATE.settings.maxSizeEnabled}`);
  });

  wcDom.maxSizeInput.addEventListener('change', () => {
    const value = Number(wcDom.maxSizeInput.value);
    if (!Number.isInteger(value) || value < 1 || value > 100000) {
      logError('Max-size input produced an invalid value.', value);
      wcDom.maxSizeInput.value = String(WC_STATE.settings.maxSize);
      return;
    }
    WC_STATE.settings.maxSize = value;
    saveSettings();
    logInfo(`Max size changed: ${value}px`);
  });

  wcDom.errorCloseButton.addEventListener('click', () => {
    if (typeof wcDom.errorDialog.close === 'function') wcDom.errorDialog.close();
    else logError('Error dialog close method is unavailable.');
  });

  document.addEventListener('paste', event => {
    if (WC_STATE.converting) return;
    const clipboardFiles = Array.from(event.clipboardData?.files || []).filter(file => file instanceof File);
    if (clipboardFiles.length > 0) {
      addFiles(clipboardFiles);
      logInfo('Files added from clipboard.', clipboardFiles.map(file => file.name));
    }
  });

  window.addEventListener('beforeunload', () => {
    revokeAllObjectUrls();
  });

  logInfo('UI event bindings completed.');
}

function initialize() {
  try {
    getStoredSettings();
    bindEvents();
    updateLanguageHint();
    updateSettingsUi();
    setToolbarState();
    wcDom.resultsSection.hidden = true;
    wcDom.progressSection.hidden = true;
    setActiveTab(WC_TAB_INDEX.settings, 'initialize');
    logInfo('Application initialized successfully.', WC_STATE.settings);
    logInfo('Supported input formats configured.', {
      extensions: Array.from(WC_SUPPORTED_EXTENSIONS).sort(),
      mimeTypes: Array.from(WC_SUPPORTED_MIME_TYPES).sort()
    });
  } catch (error) {
    logError('Application initialization failed.', error);
    announce(uiText('unknownError'));
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize, { once: true });
} else {
  initialize();
}
