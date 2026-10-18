import '@material/web/all.js';
import {styles as typescaleStyles} from '@material/web/typography/md-typescale-styles.js';

document.adoptedStyleSheets.push(typescaleStyles.styleSheet);

// 集計API（zhisight Worker）の接続先
var API = 'https://zhisight.takesen2278.workers.dev';
var OF8 = window.OF8Account;
var NEW = '__new', EXT = '__ext';
var apps = [], cur = null, stats = null, keyShown = false, view = 'overview';
var info = null, busyN = 0, geo = null, lastCountries = [];
var daysValue = '30';

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function mask(k) { return k.slice(0, 4) + '••••••••'; }

function toast(msg) {
  var t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(function () { t.hidden = true; }, 3000);
}

// エラーはコンソールに出し、画面にも短く知らせる
function fail(msg, e) {
  console.error(msg, e);
  toast(msg + '：' + (e && e.message ? e.message : String(e)));
}
window.addEventListener('unhandledrejection', function (ev) { fail('予期しないエラー', ev.reason); });
window.addEventListener('error', function (ev) { console.error(ev.error || ev.message); });

if (!OF8) console.error('OF8Account が見つかりません（client-service.js の読み込みを確認）');

// 操作中は全画面をブロックする。終わるまで重複操作させない
async function busy(fn) {
  busyN++;
  $('busy').hidden = false;
  try { return await fn(); } finally {
    if (--busyN === 0) $('busy').hidden = true;
  }
}
function okWrite() {
  if (info && info.permissions && info.permissions.write === false) {
    toast('この操作には書き込み権限が必要です');
    return false;
  }
  return true;
}

async function loadApps() {
  var raw = await OF8.getItem('zs1_apps');
  apps = raw ? JSON.parse(raw) : [];
}
async function saveApps() {
  await OF8.setItem('zs1_apps', JSON.stringify(apps));
}

// API 呼び出し。通信失敗（CORS・ネットワーク）と API のエラーを区別する
async function api(path, key, method, body) {
  var opts = { method: method || 'GET', headers: { Authorization: 'Bearer ' + key } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  var res;
  try {
    res = await fetch(API + path, opts);
  } catch (e) {
    throw new Error('通信に失敗しました（接続先・CORS・ネットワークを確認）');
  }
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

// ---- アカウント ----
function showAccount() {
  var a = info.account;
  $('menuName').textContent = a.name || '0F8アカウント';
  if (a.icon) {
    var img = $('avatar');
    img.src = 'data:' + a.iconMimeType + ';base64,' + a.icon;
    img.hidden = false;
    $('avatarIcon').hidden = true;
  }
}

// アカウントプルダウン（独自実装）
$('acctBtn').addEventListener('click', function (e) {
  e.stopPropagation();
  var dd = $('acctDropdown');
  dd.hidden = !dd.hidden;
  $('acctBtn').setAttribute('aria-expanded', String(!dd.hidden));
});
document.addEventListener('click', function (e) {
  var dd = $('acctDropdown');
  if (dd && !dd.hidden && !dd.contains(e.target) && e.target !== $('acctBtn') && !$('acctBtn').contains(e.target)) {
    dd.hidden = true;
    $('acctBtn').setAttribute('aria-expanded', 'false');
  }
});
$('logout').onclick = function () {
  busy(async function () {
    await OF8.logout();
    location.reload();
  }).catch(function (e) { fail('ログアウトに失敗', e); });
};

// ---- アプリ選択 ----
function select(id) {
  cur = apps.find(function (a) { return a.app_id === id; }) || null;
  stats = null;
  keyShown = false;
  renderSelect();
  showView();
  renderOverview();
  if (cur) {
    renderSettings();
    loadStats(false);
  }
}

function renderSelect() {
  var btn = $('appSelBtn');
  var panel = $('appSelPanel');
  panel.innerHTML = apps.map(function (a) {
    return '<button class="csel-opt" data-value="' + esc(a.app_id) + '">' + esc(a.name) + '</button>';
  }).join('') +
    '<button class="csel-opt" data-value="' + NEW + '">＋ 新しいアプリを登録</button>' +
    '<button class="csel-opt" data-value="' + EXT + '">＋ アクセスキーで追加</button>';
  panel.querySelectorAll('.csel-opt').forEach(function (b) {
    b.addEventListener('click', function () {
      panel.hidden = true;
      var v = b.dataset.value;
      if (v === NEW) { $('dlgNew').show(); return; }
      if (v === EXT) { $('dlgExt').show(); return; }
      select(v);
    });
  });
  btn.textContent = cur ? cur.name : 'アプリを選択';
}

// toggle panel
$('appSelBtn').addEventListener('click', function (e) {
  e.stopPropagation();
  $('appSelPanel').hidden = !$('appSelPanel').hidden;
});
document.addEventListener('click', function (e) {
  var panel = $('appSelPanel');
  if (panel && !panel.hidden && !panel.contains(e.target) && e.target !== $('appSelBtn')) {
    panel.hidden = true;
  }
  var dp = $('daysPanel');
  if (dp && !dp.hidden && !dp.contains(e.target) && e.target !== $('daysBtn')) {
    dp.hidden = true;
  }
});

// ---- 表示切り替え ----
function showView() {
  document.querySelectorAll('.ri').forEach(function (r) {
    r.querySelector('md-icon-button').selected = r.dataset.view === view;
  });
  $('empty').hidden = apps.length > 0;
  $('vOverview').hidden = !cur || view !== 'overview';
  $('vSettings').hidden = !cur || view !== 'settings';
}
document.querySelectorAll('.ri').forEach(function (r) {
  r.addEventListener('click', function () {
    view = r.dataset.view;
    showView();
  });
});

// ---- 概要 ----
function loadStats(refresh) {
  var app = cur;
  if (!app) return Promise.resolve();
  $('err').textContent = '';
  return busy(async function () {
    try {
      if (refresh) await api('/api/refresh', app.access_key, 'POST');
      var s = await api('/api/stats?days=' + daysValue, app.access_key);
      if (cur !== app) return;
      app.allow_any_origin = s.app.allow_any_origin;
      stats = s;
      renderOverview();
      renderSettings();
    } catch (e) {
      console.error('統計の取得に失敗', e);
      if (cur === app) $('err').textContent = '取得に失敗: ' + e.message;
    }
  });
}

function rows(list) {
  return list.length
    ? list.map(function (r) { return '<tr><td>' + esc(r.item) + '</td><td class="n">' + r.cnt + '</td></tr>'; }).join('')
    : '<tr><td colspan="2">データなし</td></tr>';
}

function renderOverview() {
  var s = stats;
  if (!s) {
    $('kUsers').textContent = '…';
    $('kPv').textContent = '…';
    $('kAvg').textContent = '…';
    $('hours').innerHTML = '';
    ['tCountries', 'tPages', 'tCities', 'tOs'].forEach(function (t) {
      $(t).innerHTML = '<tr><td colspan="2">読み込み中…</td></tr>';
    });
    drawMap([]);
    return;
  }
  $('kUsers').textContent = s.summary.users;
  $('kPv').textContent = s.summary.pv;
  $('kAvg').textContent = s.summary.pv_per_user;
  var max = Math.max.apply(null, s.hours.concat([1]));
  $('hours').innerHTML = s.hours.map(function (v, h) {
    return '<div class="bar" title="' + h + '時: ' + v + '"><i style="height:' +
      Math.max(2, Math.round(v / max * 140)) + 'px"></i><span>' + h + '</span></div>';
  }).join('');
  $('tCountries').innerHTML = rows(s.countries);
  $('tPages').innerHTML = rows(s.pages);
  $('tCities').innerHTML = rows(s.cities);
  $('tOs').innerHTML = rows(s.os);
  drawMap(s.countries);
}

// days custom dropdown
$('daysBtn').addEventListener('click', function (e) {
  e.stopPropagation();
  $('daysPanel').hidden = !$('daysPanel').hidden;
});
$('daysPanel').querySelectorAll('.csel-opt').forEach(function (b) {
  b.addEventListener('click', function () {
    daysValue = b.dataset.value;
    $('daysBtn').textContent = b.textContent;
    $('daysPanel').hidden = true;
    if (cur) loadStats(false);
  });
});
$('refresh').onclick = function () { if (cur) loadStats(true); };

// ---- 国別マップ ----
// 国名の表記ゆれを吸収する。サーバーが ISO の 2 文字コードを返した場合も英語名に変換する
var ALIAS = {
  'usa': 'united states of america', 'united states': 'united states of america',
  'czech republic': 'czechia', 'türkiye': 'turkey', 'turkiye': 'turkey',
  'russian federation': 'russia', 'korea, south': 'south korea'
};
function canon(s) {
  s = String(s).trim();
  if (/^[A-Za-z]{2}$/.test(s)) {
    try { s = new Intl.DisplayNames(['en'], { type: 'region' }).of(s.toUpperCase()); } catch (e) {}
  }
  s = s.toLowerCase();
  return ALIAS[s] || s;
}

async function initMap() {
  try {
    var w = await (await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json')).json();
    var features = topojson.feature(w, w.objects.countries).features;
    var svg = d3.select('#map');
    var g = svg.append('g');
    var path = d3.geoPath(d3.geoNaturalEarth1().fitExtent([[4, 4], [956, 496]], { type: 'Sphere' }));
    var paths = g.selectAll('path').data(features).join('path').attr('d', path);
    var tip = $('tip'), wrap = $('mapwrap');

    paths.on('mousemove', function (e, d) {
      var v = +d3.select(this).attr('data-v') || 0;
      var p = d3.pointer(e, wrap);
      tip.hidden = false;
      tip.style.left = (p[0] + 12) + 'px';
      tip.style.top = (p[1] + 12) + 'px';
      tip.textContent = d.properties.name + '：' + v;
    }).on('mouseleave', function () { tip.hidden = true; });

    var zoom = d3.zoom().scaleExtent([1, 8]).on('zoom', function (e) { g.attr('transform', e.transform); });
    svg.call(zoom);
    $('zin').onclick = function () { svg.transition().call(zoom.scaleBy, 1.6); };
    $('zout').onclick = function () { svg.transition().call(zoom.scaleBy, 1 / 1.6); };
    $('zreset').onclick = function () { svg.transition().call(zoom.transform, d3.zoomIdentity); };

    geo = { paths: paths };
    drawMap(lastCountries);
  } catch (e) {
    console.error('地図の読み込みに失敗', e);
    $('mapnote').textContent = '地図を読み込めませんでした';
  }
}

function drawMap(list) {
  lastCountries = list || [];
  if (!geo) return;
  var vals = {};
  lastCountries.forEach(function (r) {
    var k = canon(r.item);
    vals[k] = (vals[k] || 0) + r.cnt;
  });
  var max = Math.max.apply(null, Object.values(vals).concat([1]));
  geo.paths
    .attr('data-v', function (d) { return vals[canon(d.properties.name)] || 0; })
    .style('fill-opacity', function (d) {
      var v = vals[canon(d.properties.name)] || 0;
      return v ? 0.25 + 0.75 * v / max : 1;
    });
  $('mapnote').textContent = lastCountries.length ? '' : 'データなし';
}

// ---- 設定 ----
function renderSettings() {
  if (!cur) return;
  $('sName').textContent = cur.name;
  $('sId').textContent = cur.app_id;
  $('sOrigin').textContent = cur.origin;
  $('allowAny').selected = !!cur.allow_any_origin;
  updateKey();
}
function updateKey() {
  $('sKey').textContent = keyShown ? cur.access_key : mask(cur.access_key);
  $('toggleKey').querySelector('md-icon').textContent = keyShown ? 'visibility_off' : 'visibility';
}
$('toggleKey').onclick = function () { keyShown = !keyShown; updateKey(); };
$('copyKey').onclick = function () {
  navigator.clipboard.writeText(cur.access_key).then(
    function () { toast('アクセスキーをコピーしました'); },
    function (e) { fail('コピーできませんでした', e); }
  );
};

$('allowAny').addEventListener('change', function (e) {
  var v = e.target.selected, app = cur;
  if (!okWrite()) { e.target.selected = !v; return; }
  busy(async function () {
    try {
      await api('/api/apps/allow-any', app.access_key, 'POST', { allow_any_origin: v });
      app.allow_any_origin = v;
      await saveApps();
      toast(v ? '全オリジン許可をONにしました' : '全オリジン許可をOFFにしました');
    } catch (err) {
      e.target.selected = !v;
      fail('切り替えに失敗', err);
    }
  });
});

$('rotate').onclick = function () { $('dlgRotate').show(); };
$('confirmRotate').onclick = function () {
  if (!okWrite()) return;
  $('dlgRotate').close();
  busy(async function () {
    try {
      var res = await api('/api/apps/rotate', cur.access_key, 'POST');
      cur.access_key = res.access_key;
      await saveApps();
      keyShown = true;
      updateKey();
      toast('新しいキーを発行しました。表示されたキーを控えてください');
    } catch (e) {
      fail('再発行に失敗', e);
      $('dlgRotate').show();
    }
  });
};

$('remove').onclick = function () {
  $('memo').checked = false;
  $('confirmRemove').disabled = true;
  $('dlgRemove').show();
};
$('memo').addEventListener('change', function (e) {
  $('confirmRemove').disabled = !e.target.checked;
});
$('confirmRemove').onclick = function () {
  if (!okWrite()) return;
  var id = cur.app_id;
  $('dlgRemove').close();
  busy(async function () {
    apps = apps.filter(function (a) { return a.app_id !== id; });
    await saveApps();
    toast('一覧から外しました');
    select(apps[0] ? apps[0].app_id : '');
  });
};

// ---- 登録・追加 ----
$('confirmNew').onclick = function () {
  if (!okWrite()) return;
  var body = { name: $('newName').value.trim(), origin: $('newOrigin').value.trim() };
  $('dlgNew').close();
  busy(async function () {
    try {
      var d = await api('/api/apps', '', 'POST', body);
      apps.push({
        app_id: d.app_id, name: d.name, origin: d.origin,
        access_key: d.access_key, allow_any_origin: false
      });
      await saveApps();
      $('newName').value = '';
      $('newOrigin').value = '';
      toast('登録しました。アクセスキーは0F8アカウントに保存されています');
      select(d.app_id);
    } catch (e) {
      fail('登録に失敗', e);
      $('dlgNew').show();
    }
  });
};

$('confirmExt').onclick = function () {
  if (!okWrite()) return;
  var key = $('extKey').value.trim();
  $('dlgExt').close();
  busy(async function () {
    try {
      var s = await api('/api/stats?days=1', key);
      if (apps.some(function (a) { return a.app_id === s.app.app_id; })) throw new Error('すでに追加済みです');
      apps.push({
        app_id: s.app.app_id, name: s.app.name, origin: s.app.origin,
        access_key: key, allow_any_origin: !!s.app.allow_any_origin
      });
      await saveApps();
      $('extKey').value = '';
      select(s.app.app_id);
    } catch (e) {
      fail('追加できません', e);
      $('dlgExt').show();
    }
  });
};

// ---- 起動 ----
async function start() {
  try {
    await busy(async function () {
      info = await OF8.accountInfo();
      $('login').hidden = true;
      $('app').hidden = false;
      showAccount();
      await loadApps();
      select(apps[0] ? apps[0].app_id : '');
    });
  } catch (e) {
    fail('読み込みに失敗', e);
  }
}

$('loginBtn').onclick = async function () {
  try {
    await busy(function () { return OF8.login(); });
    await start();
  } catch (e) {
    fail('ログインに失敗', e);
  }
};

initMap();
(async function boot() {
  try {
    if (await OF8.isLoggedIn()) await start();
  } catch (e) {
    fail('ログイン状態の確認に失敗', e);
  }
})();
