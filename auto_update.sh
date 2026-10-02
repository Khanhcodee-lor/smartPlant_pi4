#!/usr/bin/env bash
# ==============================================================================
# Smart Plant - Auto Update Script for Raspberry Pi 4
# Kéo code mới nhất từ GitHub, tự động build lại và restart service PM2
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOCK_FILE="/tmp/smartplant-update.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⏳ Quá trình cập nhật khác đang thực thi, bỏ qua lần này."
    exit 0
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🔍 Đang kiểm tra cập nhật từ GitHub (branch main)..."
git fetch origin main > /dev/null 2>&1

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ Đang ở commit mới nhất ($LOCAL). Không có thay đổi."
    exit 0
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🚀 Phát hiện commit mới trên GitHub!"
echo "   Hiện tại: $LOCAL"
echo "   Mới nhất: $REMOTE"

CHANGED_FILES=$(git diff --name-only "$LOCAL" "$REMOTE")
echo "📄 Các file thay đổi:"
echo "$CHANGED_FILES" | sed 's/^/   - /'

# Đồng bộ sạch code sang commit mới nhất
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 📥 Đang cập nhật source code..."
git reset --hard origin/main

# 1. Nếu có thay đổi trong thư mục client (Frontend React)
if echo "$CHANGED_FILES" | grep -q "^client/"; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🎨 Phát hiện thay đổi Frontend, đang build lại..."
    cd "$SCRIPT_DIR/client"
    npm install --prefer-offline || npm install
    npm run build
    mkdir -p "$SCRIPT_DIR/server/public"
    cp -r dist/* "$SCRIPT_DIR/server/public/"
    cd "$SCRIPT_DIR"
fi

# 2. Nếu có thay đổi dependency của Server (Node.js)
if echo "$CHANGED_FILES" | grep -q "^server/package\.json"; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 📦 Cập nhật dependencies cho Node.js server..."
    cd "$SCRIPT_DIR/server"
    npm install
    cd "$SCRIPT_DIR"
fi

# 3. Nếu có thay đổi trong thư mục ai_engine (C++)
if echo "$CHANGED_FILES" | grep -q "^ai_engine/" && echo "$CHANGED_FILES" | grep -v "\.py$"; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚙️ Phát hiện thay đổi C++, đang biên dịch lại..."
    mkdir -p "$SCRIPT_DIR/ai_engine/build"
    cd "$SCRIPT_DIR/ai_engine/build"
    cmake ..
    make -j$(nproc)
    cd "$SCRIPT_DIR"
fi

# 3b. Cài Firebase Admin SDK riêng cho BLE gateway trong virtualenv.
if [ -f "$SCRIPT_DIR/ai_engine/requirements-firebase.txt" ]; then
    if [ ! -x "$SCRIPT_DIR/ai_engine/.venv/bin/python" ]; then
        python3 -m venv "$SCRIPT_DIR/ai_engine/.venv"
    fi
    "$SCRIPT_DIR/ai_engine/.venv/bin/pip" install -r "$SCRIPT_DIR/ai_engine/requirements-firebase.txt"
fi

# 4. Khởi động lại các dịch vụ PM2
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🔄 Khởi động lại các dịch vụ Smart Plant..."
if echo "$CHANGED_FILES" | grep -Eq "^server/|^auto_update\.sh$"; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🔎 Đang tìm đúng tiến trình Node server trong PM2..."
    SERVER_PM2_ID="$(pm2 jlist | python3 -c 'import json, os, sys; target=os.path.realpath(sys.argv[1]); items=json.load(sys.stdin); match=next((p for p in items if os.path.realpath(p.get("pm2_env", {}).get("pm_exec_path", "")) == target or p.get("name") == "smart-plant-server"), None); print(match.get("pm_id", "") if match else "")' "$SCRIPT_DIR/server/server.js")"
    if [ -n "$SERVER_PM2_ID" ]; then
        pm2 restart "$SERVER_PM2_ID"
    else
        echo "⚠️ Chưa có tiến trình server trong PM2, đang khởi động bằng server.js..."
        pm2 start "$SCRIPT_DIR/server/server.js" --name smart-plant-server --cwd "$SCRIPT_DIR/server"
    fi
fi
if [ -x "$SCRIPT_DIR/ai_engine/.venv/bin/python" ]; then
    pm2 delete smart-plant-ble 2>/dev/null || true
    pm2 start "$SCRIPT_DIR/ai_engine/ble_mesh_gateway.py" --name smart-plant-ble \
        --interpreter "$SCRIPT_DIR/ai_engine/.venv/bin/python" --cwd "$SCRIPT_DIR/ai_engine"
fi
pm2 restart smart-plant-engine

echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✨ Cập nhật hoàn tất thành công lên commit $REMOTE!"
