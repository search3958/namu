#!/bin/bash

# 1. 仮想環境 (venv) を作成・確認
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi

# 2. Flaskをインストール
./venv/bin/pip install flask --quiet

# 3. server.py を作成（ポートを5005に固定）
cat << 'EOF' > server.py
from flask import Flask, request, render_template_string
import subprocess
import os

app = Flask(__name__)

HTML_UI = """
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Mac Remote</title>
    <style>
        body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; padding: 20px; background: #222; color: white; }
        input[type="text"] { width: 90%; padding: 15px; margin-bottom: 15px; font-size: 18px; border-radius: 8px; border: none; }
        .btn-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; width: 95%; }
        button { padding: 20px; font-size: 16px; cursor: pointer; border: none; border-radius: 8px; background: #007AFF; color: white; font-weight: bold; }
        button:active { background: #0051a8; }
        .special { background: #34C759; }
        .danger { background: #FF3B30; }
        .wide { grid-column: span 2; background: #5856D6; }
    </style>
</head>
<body>
    <h3>Remote Mac Input</h3>
    <input type="text" id="textbox" placeholder="ここに文字入力...">
    <div class="btn-grid">
        <button onclick="sendText()" class="special">送信 (Type)</button>
        <button onclick="sendCommand('enter')">Enter</button>
        <button onclick="sendCommand('cmd_c')">Cmd + C</button>
        <button onclick="sendCommand('cmd_v')">Cmd + V</button>
        <button onclick="sendCommand('cmd_k')">Cmd + K</button>
        <button onclick="sendCommand('ctrl_opt_g')">Ctrl+Opt+G</button>
        <button onclick="sendCommand('ctrl_c')" class="danger">Ctrl + C</button>
        <button onclick="sendCommand('cmd_v')" class="wide">貼り付けのみ実行</button>
    </div>
    <script>
        function sendText() {
            const val = document.getElementById('textbox').value;
            fetch('/type', {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: 'text=' + encodeURIComponent(val)
            });
            document.getElementById('textbox').value = '';
        }
        function sendCommand(cmd) {
            fetch('/shortcut', {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: 'cmd=' + cmd
            });
        }
    </script>
</body>
</html>
"""

def run_applescript(script):
    subprocess.run(["osascript", "-e", script])

@app.route('/')
def index():
    return HTML_UI

@app.route('/type', methods=['POST'])
def type_text():
    text = request.form.get('text', '')
    subprocess.run(["pbcopy"], input=text.encode('utf-8'))
    run_applescript('tell application "System Events" to keystroke "v" using {command down}')
    return "OK"

@app.route('/shortcut', methods=['POST'])
def shortcut():
    cmd = request.form.get('cmd', '')
    scripts = {
        'enter': 'tell application "System Events" to key code 36',
        'cmd_c': 'tell application "System Events" to keystroke "c" using {command down}',
        'cmd_v': 'tell application "System Events" to keystroke "v" using {command down}',
        'cmd_k': 'tell application "System Events" to keystroke "k" using {command down}',
        'ctrl_opt_g': 'tell application "System Events" to keystroke "g" using {control down, option down}',
        'ctrl_c': 'tell application "System Events" to keystroke "c" using {control down}'
    }
    if cmd in scripts:
        run_applescript(scripts[cmd])
    return "OK"

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5005)
EOF

# 4. 実行
IP_ADDR=$(ipconfig getifaddr en0)
echo "------------------------------------------"
echo "サーバー起動！以下のURLをブラウザで開いてください："
echo "http://$IP_ADDR:5005"
echo "------------------------------------------"

./venv/bin/python3 server.py