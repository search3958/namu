# WebP Converter — Static Browser Edition

PNG / JPG / JPEG / HEIC / HEIF / TIFF / PSD / SVG / AVIF などを、ブラウザだけでWebPへ変換する静的Webアプリです。

## 特徴

- サーバー、Worker API、画像アップロードAPIなし
- 変換はユーザーのブラウザ内で完結
- Material Web 2.5.0をCDNから読み込み
- WebPはlibwebp WASM (`@jsquash/webp`) でエンコード
- HEIC / HEIFはlibheif WASMでデコード
- TIFFはUTIF.jsでデコード
- PSDはag-psdでデコード
- PDFはPDF.jsで1ページ目を画像化
- 複数ファイルを一括変換
- ドラッグ&ドロップ、ファイル選択、貼り付け対応
- 対応形式のみ自動で追加し、非対応形式は自動スキップ
- ファイル追加後は自動変換（設定変更後は「WebPに変換」ボタンで再変換）
- 品質設定 / ロスレス / 長辺サイズ制限（ON/OFF + 数値入力）
- 個別保存 / 変換結果のZIP保存
- 設定はlocalStorageへ保存
- 外部へ送信するのはCDNライブラリの取得だけで、ユーザーの画像バイト列は送信しない構成

## 使い方

このフォルダをGitHub Pages / Cloudflare Pages / Netlifyなどの静的ホスティングへそのまま置けます。

ローカルで試す場合もHTTPサーバーを使うことを推奨します。ES Module / importmap / CDN読み込みの組み合わせを安定して扱えるためです。

例:

```text
python -m http.server 8000
```

その後、`http://127.0.0.1:8000/` を開きます。

## CDN

UI:

- Material Web 2.5.0 — `https://esm.run/@material/web@2.5.0/`
- Google Sans / Material Symbols — Google Fonts

変換用ライブラリは必要になった時だけ遅延読み込みします。

- `@jsquash/webp@1.5.0`
- `libheif-js@1.23.2`
- `utif@3.1.0`
- `ag-psd@31.0.2`
- `pdfjs-dist@6.3.289`
- `jszip@3.10.2`

## 対応範囲について

「何でも」はブラウザでデコード可能な形式と、搭載したWASM/JSデコーダーが読める形式の範囲を指します。

特殊なRAW、暗号化されたPDF、壊れたファイル、特殊なPhotoshop機能を含むPSDなどは変換できない場合があります。

PDFは現在「1ページ目」をWebP化します。
GIFはブラウザ標準の画像デコード経路を使用するため、アニメーションGIFを入れた場合は基本的に静止画として1枚目を出力します。

## CDN依存について

このアプリ自体にはビルド工程がありませんが、CDNからMaterial WebやWASM/JSライブラリを取得するため、完全オフラインでは動作しません。

画像ファイルそのものはこれらのCDNへ送信しません。

## ライセンス / 外部ライブラリ

使用ライブラリのライセンスは各配布元を確認してください。

- Material Web: Apache-2.0
- `@jsquash/webp`: Apache-2.0
- libheif-js: 配布元のライセンスに従う
- UTIF.js: MIT
- ag-psd: MIT
- PDF.js: Apache-2.0
- JSZip: MIT / GPL-3.0-or-later


## スタイル

- `../m3color.css` のMaterial 3カラー定義を利用し、このツール側ではカラー値を定義しません。
