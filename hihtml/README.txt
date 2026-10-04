NaeHTML

HTML 調整ツール。

HTMLの圧縮・整形に対応し、埋め込みCSS・JavaScriptの処理を個別にオン／オフできます。
圧縮・整形はモードを切り替えると結果へ自動反映します。

外部エンジン:
- html-minifier-terser 7.2.0: HTML圧縮。minifyCSS / minifyJS により埋め込みCSS・JavaScriptも処理。
- js-beautify 2.0.3: HTML / CSS / JavaScript整形。

ファイル操作:
- File System Access APIでHTMLファイルを開き、保存で同じファイルへ直接書き戻します。
- 開いたファイルが外部で変更されると自動検知して入力内容へ反映します。
- ブラウザがFile System Access APIに対応しない場合は通常のファイル選択へフォールバックします。
- ダウンロードは元ファイルとは別操作です。

処理はブラウザ内で行い、HTML本文をアプリのサーバーへ送信しません。
