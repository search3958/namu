HiJS

JavaScriptの圧縮・整形ツール。

外部エンジン:
- Terser 5.51.2: JavaScript圧縮
- js-beautify 2.0.3: JavaScript整形
- javascript-obfuscator 5.8.1: JavaScript難読化

処理はブラウザ内で行い、JavaScript本文をアプリのサーバーへ送信しません。
CSS版と同様にFile System Access APIでファイルを開き、保存時に同じファイルへ書き戻します。
