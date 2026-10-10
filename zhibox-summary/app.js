(function () {
  "use strict";

  // Worker の URL（ローカル検証時は wrangler dev の http://localhost:8787 に変更）
  var API_BASE = "https://zhibao-summary.takesen2278.workers.dev";

  var MONTHLY_LIMIT = 10;
  var MAX_INPUT_CHARS = 18000;

  // client-service.js が保存する Cookie 名
  var COOKIE_TOKEN = "__Host-of8_access_token";
  var COOKIE_SIG = "__Host-of8_access_signature";
  var COOKIE_LEGACY_TOKEN = "of8_access_token";
  var COOKIE_LEGACY_SIG = "of8_access_signature";

  var mode = "text";
  var lastMarkdown = "";
  var loggedIn = false;
  var lastUsage = null;
  var loginInProgress = false;

  function $(sel) {
    return document.querySelector(sel);
  }

  var els = {
    loginBtn: $("#login-btn"),
    logoutBtn: $("#logout-btn"),
    usage: $("#usage"),
    tabs: document.querySelectorAll(".mode-tab"),
    urlInput: $("#url-input"),
    textInput: $("#text-input"),
    counter: $("#char-counter"),
    sendBtn: $("#send-btn"),
    status: $("#status"),
    error: $("#error"),
    result: $("#result"),
    resultBody: $("#result-body"),
    resultNotice: $("#result-notice"),
    copyBtn: $("#copy-btn"),
    downloadBtn: $("#download-btn")
  };

  if (window.DOMPurify) {
    DOMPurify.addHook("afterSanitizeAttributes", function (node) {
      if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
  }

  /* ---------------- Cookie（0F8 が保存したものを読む） ---------------- */

  function getCookie(name) {
    var prefix = name + "=";
    var parts = document.cookie.split(";");
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p.indexOf(prefix) === 0) {
        try {
          return decodeURIComponent(p.slice(prefix.length));
        } catch (e) {
          return "";
        }
      }
    }
    return "";
  }

  function setCookieValue(name, value) {
    document.cookie =
      name + "=" + encodeURIComponent(value) + "; Max-Age=259200; Path=/; Secure; SameSite=Strict";
  }

  // Worker へ送る認証ヘッダー
  function authHeaders() {
    var h = {};
    var token = getCookie(COOKIE_TOKEN) || getCookie(COOKIE_LEGACY_TOKEN);
    var sig = getCookie(COOKIE_SIG) || getCookie(COOKIE_LEGACY_SIG);
    if (token) h["Authorization"] = "Bearer " + token;
    if (sig) h["X-OF8-Signature"] = sig;
    return h;
  }

  // Worker がトークンを更新したら Cookie も更新する
  function saveRotated(data) {
    if (data && data.rotated && data.rotated.token && data.rotated.signature) {
      setCookieValue(COOKIE_TOKEN, data.rotated.token);
      setCookieValue(COOKIE_SIG, data.rotated.signature);
    }
  }

  /* ---------------- API（Worker へクロスオリジン通信） ---------------- */

  function api(path, body) {
    var isPost = body !== undefined;
    var headers = authHeaders();
    headers["Accept"] = "application/json";
    if (isPost) headers["Content-Type"] = "application/json";

    return fetch(API_BASE + path, {
      method: isPost ? "POST" : "GET",
      headers: headers,
      body: isPost ? JSON.stringify(body) : undefined,
      credentials: "omit",
      mode: "cors"
    }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          if (!res.ok) {
            var err = new Error(data.error || "通信エラー（" + res.status + "）");
            err.status = res.status;
            throw err;
          }
          return data;
        });
    });
  }

  /* ---------------- 文字数・表示 ---------------- */

  function charLen(s) {
    return Array.from(s).length;
  }

  function fmt(n) {
    return n.toLocaleString("ja-JP");
  }

  function setError(msg) {
    els.error.textContent = msg || "";
  }

  function setStatus(msg) {
    els.status.textContent = msg || "";
  }

  function setBusy(busy, msg) {
    els.sendBtn.disabled = busy;
    setStatus(msg);
  }

  // 利用回数の表示（赤字）
  function renderUsage() {
    if (!loggedIn) {
      els.usage.textContent = "ログインすると月" + MONTHLY_LIMIT + "回まで要約できます";
      return;
    }
    if (lastUsage) {
      els.usage.textContent = "今月の残り " + lastUsage.remaining + " / " + lastUsage.limit + " 回";
    } else {
      els.usage.textContent = "";
    }
  }

  function setLoggedIn(me) {
    loggedIn = true;
    lastUsage = me.usage || null;
    els.loginBtn.hidden = true;
    els.logoutBtn.hidden = false;
    renderUsage();
  }

  function setLoggedOut() {
    loggedIn = false;
    lastUsage = null;
    els.loginBtn.hidden = false;
    els.logoutBtn.hidden = true;
    renderUsage();
  }

  /* ---------------- 起動時の状態判定 ---------------- */

  // fromLogin: ログイン直後の確認なら、失敗理由を画面に出す
  function boot(fromLogin) {
    return api("/api/me").then(
      function (me) {
        saveRotated(me);
        setLoggedIn(me);
      },
      function (err) {
        setLoggedOut();
        if (err.status === 401) {
          if (fromLogin) setError("ログインを確認できませんでした：" + err.message);
        } else {
          setError("サーバーに接続できません：" + err.message);
        }
      }
    );
  }

  /* ---------------- ログイン / ログアウト（0F8） ---------------- */

  els.loginBtn.addEventListener("click", function () {
    var OF8 = window.OF8Account;
    setError("");

    if (!OF8) {
      setError("ログイン機能の読み込みに失敗しました。ページを再読み込みしてください");
      return;
    }
    if (loginInProgress) return;

    loginInProgress = true;
    els.loginBtn.disabled = true;

    // クリックの中で直接呼ぶ（ポップアップブロック対策）
    OF8.login()
      .then(function () {
        return boot(true);
      })
      .catch(function (err) {
        setError(err && err.message ? err.message : "ログインに失敗しました");
      })
      .then(function () {
        loginInProgress = false;
        els.loginBtn.disabled = false;
      });
  });

  els.logoutBtn.addEventListener("click", function () {
    var OF8 = window.OF8Account;

    var finish = function () {
      lastMarkdown = "";
      els.result.hidden = true;
      setError("");
      setLoggedOut();
    };

    if (!OF8) {
      finish();
      return;
    }
    OF8.logout().then(finish, finish);
  });

  /* ---------------- 入力UI ---------------- */

  els.tabs.forEach(function (btn) {
    btn.addEventListener("click", function () {
      mode = btn.getAttribute("data-mode");

      els.tabs.forEach(function (b) {
        var on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", String(on));
      });

      var isText = mode === "text";
      els.urlInput.hidden = isText;
      els.textInput.hidden = !isText;
      els.counter.hidden = !isText;
      setError("");
      if (isText) {
        els.textInput.focus();
      } else {
        els.urlInput.focus();
      }
    });
  });

  function updateCounter() {
    var n = charLen(els.textInput.value);
    els.counter.textContent = fmt(n) + " / " + fmt(MAX_INPUT_CHARS);
    els.counter.classList.toggle("over", n > MAX_INPUT_CHARS);
  }

  els.textInput.addEventListener("input", updateCounter);

  els.urlInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") summarize();
  });

  els.textInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) summarize();
  });

  /* ---------------- 要約 ---------------- */

  function summarize() {
    if (els.sendBtn.disabled) return;
    setError("");

    var payload;

    if (mode === "url") {
      var url = els.urlInput.value.trim();
      if (!url) {
        setError("URLを入力してください");
        return;
      }
      payload = { mode: "url", url: url };
    } else {
      var text = els.textInput.value;
      if (!text.trim()) {
        setError("文章を入力してください");
        return;
      }
      if (charLen(text) > MAX_INPUT_CHARS) {
        setError(fmt(MAX_INPUT_CHARS) + "文字以内で入力してください");
        return;
      }
      payload = { mode: "text", text: text };
    }

    setBusy(true, mode === "url" ? "ページを取得して要約中…" : "要約中…");

    api("/api/summarize", payload)
      .then(function (data) {
        saveRotated(data);
        renderResult(data);
        if (data.usage) {
          lastUsage = data.usage;
          renderUsage();
        }
      })
      .catch(function (err) {
        if (err.status === 401) {
          setLoggedOut();
          setError("要約するにはログインしてください");
        } else if (err.status === 429) {
          lastUsage = { remaining: 0, limit: MONTHLY_LIMIT };
          renderUsage();
          setError(err.message);
        } else {
          setError(err.message);
        }
      })
      .then(function () {
        setBusy(false, "");
      });
  }

  els.sendBtn.addEventListener("click", summarize);

  /* ---------------- 結果描画 ---------------- */

  function renderResult(data) {
    lastMarkdown = data.summary;

    // Markdown → HTML → サニタイズ（LLM出力・取得ページ由来の内容は信頼しない）
    var html = marked.parse(data.summary, { gfm: true, breaks: true });

    els.resultBody.innerHTML = DOMPurify.sanitize(html, {
      ADD_TAGS: ["input"],
      ADD_ATTR: ["checked", "disabled", "type"]
    });

    // コードハイライト
    els.resultBody.querySelectorAll("pre code").forEach(function (block) {
      hljs.highlightElement(block);
    });

    // 数式（KaTeX）
    renderMathInElement(els.resultBody, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false }
      ],
      throwOnError: false,
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"]
    });

    var notes = [];
    if (data.truncated) {
      notes.push("本文が1.8万文字を超えたため、先頭部分のみを要約しています。");
    }
    if (data.finishReason === "length") {
      notes.push("出力が上限に達したため、途中で切れている可能性があります。");
    }
    els.resultNotice.textContent = notes.join(" ");
    els.resultNotice.hidden = notes.length === 0;

    els.result.hidden = false;
    els.result.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------------- コピー / 保存 ---------------- */

  function flash(btn, text) {
    var orig = btn.textContent;
    btn.textContent = text;
    setTimeout(function () {
      btn.textContent = orig;
    }, 1500);
  }

  els.copyBtn.addEventListener("click", function () {
    if (!navigator.clipboard) {
      flash(els.copyBtn, "コピー非対応");
      return;
    }
    navigator.clipboard.writeText(lastMarkdown).then(
      function () {
        flash(els.copyBtn, "コピーしました");
      },
      function () {
        flash(els.copyBtn, "コピー失敗");
      }
    );
  });

  els.downloadBtn.addEventListener("click", function () {
    var blob = new Blob([lastMarkdown], { type: "text/markdown;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "summary-" + new Date().toISOString().slice(0, 10) + ".md";
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 1000);
  });

  /* ---------------- 初期化 ---------------- */

  updateCounter();
  renderUsage();
  boot();
})();