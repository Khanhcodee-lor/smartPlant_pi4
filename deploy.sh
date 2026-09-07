#!/usr/bin/env bash
# ==============================================================================
# Smart Plant - Raspberry Pi Deploy Script
# Default mode pushes committed code to GitHub for the Pi team to build.
# ==============================================================================

set -e

# --- Colors for Terminal Output ---
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# --- Configuration ---
PI_IP="${1:-${PI_IP:-"10.42.0.187"}}"
PI_USER="${2:-${PI_USER:-"khanhpi"}}"
PI_DIR="${3:-${PI_DIR:-"/home/${PI_USER}/Smart_Plant"}}"
PUSH_ONLY="${PUSH_ONLY:-1}"
REMOTE_BUILD="${REMOTE_BUILD:-0}"
REPO_URL="${REPO_URL:-$(git -C "$(dirname "${BASH_SOURCE[0]}")" config --get remote.origin.url 2>/dev/null || true)}"
GIT_BRANCH="${GIT_BRANCH:-$(git -C "$(dirname "${BASH_SOURCE[0]}")" branch --show-current 2>/dev/null || printf 'main')}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AI_ENGINE_DIR="${SCRIPT_DIR}/ai_engine"
SERVER_DIR="${SCRIPT_DIR}/server"
TOOLCHAIN_FILE="${AI_ENGINE_DIR}/toolchain-aarch64.cmake"
BUILD_DIR="${AI_ENGINE_DIR}/build_aarch64"
BINARY_ENGINE="smart_plant_engine"

echo -e "${BLUE}=====================================================${NC}"
echo -e "${BLUE} 🌱 Smart Plant - Git Push Deploy Tool               ${NC}"
echo -e "${BLUE}=====================================================${NC}"
echo -e "Git remote  : ${YELLOW}${REPO_URL:-not configured}${NC}"
echo -e "Git branch  : ${YELLOW}${GIT_BRANCH}${NC}"
echo -e "${BLUE}-----------------------------------------------------${NC}"

if [ "${PUSH_ONLY}" = "1" ]; then
  if [ -z "${REPO_URL}" ]; then
    echo -e "${RED}Lỗi: Không tìm thấy Git remote origin.${NC}"
    exit 1
  fi
  if [ -n "$(git -C "${SCRIPT_DIR}" status --porcelain)" ]; then
    echo -e "${YELLOW}Lỗi: Vẫn còn thay đổi chưa commit. Hãy commit trước:${NC}"
    echo "  git add -A && git commit -m \"Update Smart Plant\""
    exit 1
  fi
  echo -e "${GREEN}Đang push code lên GitHub, không cần kết nối tới Raspberry Pi...${NC}"
  git -C "${SCRIPT_DIR}" push origin "${GIT_BRANCH}"
  echo -e "${GREEN}Đã push thành công.${NC} Phía Pi chạy: git pull --ff-only origin ${GIT_BRANCH}"
  echo -e "${BLUE}Sau khi build lỗi, lấy log bằng: pm2 logs --lines 100${NC}"
  exit 0
fi

# Optional legacy modes: REMOTE_BUILD=1 builds through SSH, REMOTE_BUILD=0
# continues with the old cross-compile and copy workflow.

# Build on the Pi so native dependencies such as OpenCV and better-sqlite3
# match the target system.
if [ "${REMOTE_BUILD}" = "1" ]; then
    if [ -z "${REPO_URL}" ]; then
        echo -e "${RED}Lỗi: Không tìm thấy Git remote origin.${NC}"
        exit 1
    fi

    echo -e "${GREEN}🚀 Đồng bộ, build và khởi động trực tiếp trên Raspberry Pi...${NC}"
    ssh "${PI_USER}@${PI_IP}" "PI_DIR='${PI_DIR}' REPO_URL='${REPO_URL}' GIT_BRANCH='${GIT_BRANCH}' bash -s" <<'REMOTE_SCRIPT'
set -e

if ! command -v git >/dev/null 2>&1; then
  echo "Lỗi: Pi chưa cài git. Chạy: sudo apt update && sudo apt install -y git"
  exit 1
fi

mkdir -p "$(dirname "$PI_DIR")"
if [ ! -d "$PI_DIR/.git" ]; then
  if [ -d "$PI_DIR" ] && [ "$(find "$PI_DIR" -mindepth 1 -maxdepth 1 | wc -l)" -gt 0 ]; then
    backup_dir="${PI_DIR}.before-git-$(date +%Y%m%d-%H%M%S)"
    mv "$PI_DIR" "$backup_dir"
    echo "Đã giữ bản cũ tại: $backup_dir"
  fi
  git clone --branch "$GIT_BRANCH" "$REPO_URL" "$PI_DIR"
else
  git -C "$PI_DIR" fetch origin "$GIT_BRANCH"
  git -C "$PI_DIR" checkout "$GIT_BRANCH"
  git -C "$PI_DIR" reset --hard "origin/$GIT_BRANCH"
fi

cd "$PI_DIR"

if ! command -v cmake >/dev/null 2>&1 || ! command -v g++ >/dev/null 2>&1; then
  echo "Lỗi: Pi cần cmake và g++. Chạy: sudo apt update && sudo apt install -y build-essential cmake libopencv-dev"
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Lỗi: Pi cần Node.js 18+ và npm. Hãy cài Node.js trước khi deploy."
  exit 1
fi

echo "[1/4] Cài dependency frontend và build..."
cd "$PI_DIR/client"
npm install
npm run build
rm -rf "$PI_DIR/server/public"/*
cp -r dist/* "$PI_DIR/server/public/"

echo "[2/4] Cài dependency server..."
cd "$PI_DIR/server"
npm install --omit=dev
node -e "require('./db/database').initDatabase()"

echo "[3/4] Build AI engine..."
cd "$PI_DIR/ai_engine"
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel

echo "[4/4] Khởi động dịch vụ..."
if command -v pm2 >/dev/null 2>&1; then
  pm2 delete smart-plant-engine smart-plant-server smart-plant-ble 2>/dev/null || true
  pm2 start "$PI_DIR/ai_engine/build/smart_plant_engine" --name smart-plant-engine
  pm2 start "$PI_DIR/server/server.js" --name smart-plant-server --cwd "$PI_DIR/server"
  pm2 start "$PI_DIR/ai_engine/ble_mesh_gateway.py" --name smart-plant-ble --interpreter /usr/bin/python3 --cwd "$PI_DIR/ai_engine"
  pm2 save
else
  echo "Cảnh báo: chưa có pm2, khởi động bằng nohup. Cài bằng: npm install -g pm2"
  pkill -f smart_plant_engine 2>/dev/null || true
  pkill -f "node server.js" 2>/dev/null || true
  nohup "$PI_DIR/ai_engine/build/smart_plant_engine" > "$PI_DIR/ai_engine.log" 2>&1 &
  (cd "$PI_DIR/server" && nohup node server.js > "$PI_DIR/server.log" 2>&1 &)
  pkill -f "ble_mesh_gateway.py" 2>/dev/null || true
  nohup /usr/bin/python3 "$PI_DIR/ai_engine/ble_mesh_gateway.py" > "$PI_DIR/ble_mesh.log" 2>&1 &
fi
REMOTE_SCRIPT

    echo -e "${BLUE}=====================================================${NC}"
    echo -e "${GREEN}DEPLOYMENT SUCCESSFUL${NC}"
    echo -e "Mở trình duyệt: ${YELLOW}http://${PI_IP}:3000${NC}"
    echo -e "${BLUE}=====================================================${NC}"
    exit 0
fi

# 1. Check if Cross-Compiler is installed
if ! command -v aarch64-linux-gnu-g++ &> /dev/null; then
    echo -e "${RED}❌ Lỗi: Chưa cài đặt aarch64 cross-compiler trên PC!${NC}"
    echo -e "${YELLOW}Vui lòng chạy:${NC} sudo apt update && sudo apt install -y g++-aarch64-linux-gnu gcc-aarch64-linux-gnu cmake rsync"
    exit 1
fi

# 2. Toolchain CMake
if [ ! -f "${TOOLCHAIN_FILE}" ]; then
    echo -e "${YELLOW}🔧 Tạo file CMake Toolchain cho ARM64...${NC}"
    cat << 'EOF' > "${TOOLCHAIN_FILE}"
set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR aarch64)

set(CMAKE_C_COMPILER aarch64-linux-gnu-gcc)
set(CMAKE_CXX_COMPILER aarch64-linux-gnu-g++)

set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
EOF
fi

# 3. Cross-Compile C++ Engine
echo -e "${GREEN}🔨 [1/5] Cross-Compiling C++ AI Engine cho ARM64...${NC}"
if [ "${SKIP_CPP}" = "1" ]; then
    echo -e "${YELLOW}  -> Đã bỏ qua biên dịch C++ (SKIP_CPP=1)${NC}"
else
    mkdir -p "${BUILD_DIR}"
    cd "${BUILD_DIR}"
    cmake -DCMAKE_TOOLCHAIN_FILE="${TOOLCHAIN_FILE}" -DCMAKE_BUILD_TYPE=Release "${AI_ENGINE_DIR}" > /dev/null
    make -j$(nproc)
    echo -e "${GREEN}  ✓ C++ Binary: ${BUILD_DIR}/${BINARY_ENGINE}${NC}"
fi

# 4. Build React Frontend & Bundle Node.js Web Server
echo -e "${GREEN}🎨 [2/5] Build React Frontend (Vite) & Đóng gói Node.js Server (ncc)...${NC}"
cd "${SCRIPT_DIR}/client"
npm run build > /dev/null
rm -rf "${SERVER_DIR}/public"/*
cp -r dist/* "${SERVER_DIR}/public/"

cd "${SERVER_DIR}"
mkdir -p dist
npx --yes @vercel/ncc build server.js -o dist -m > /dev/null
echo -e "${GREEN}  ✓ Server Bundle: ${SERVER_DIR}/dist/index.js${NC}"

# 5. Remote Folder Prep & Clean Old Source Files
echo -e "${GREEN}📁 [3/5] Dọn dẹp file thừa & khởi tạo thư mục trên Raspberry Pi...${NC}"
ssh "${PI_USER}@${PI_IP}" "
  # Xóa các file source .js thừa từ lần deploy cũ
  rm -rf ${PI_DIR}/server/*.js ${PI_DIR}/server/routes ${PI_DIR}/server/node_modules
  rm -f ${PI_DIR}/server/db/smart_plant.db 2>/dev/null || true
  mkdir -p ${PI_DIR}/ai_engine ${PI_DIR}/server/public ${PI_DIR}/server/db
"

# 6. Deploy C++ BINARY + SERVER BUNDLE + STATIC ASSETS ONLY
echo -e "${GREEN}🚀 [4/5] Đẩy C++ Binary & Server Bundle sang Pi...${NC}"

# Push C++ Binary
if [ "${SKIP_CPP}" = "1" ]; then
    echo -e "  -> Bỏ qua đẩy C++ Binary (SKIP_CPP=1)..."
else
    echo -e "  -> Đẩy C++ Binary (${BINARY_ENGINE})..."
    scp "${BUILD_DIR}/${BINARY_ENGINE}" "${PI_USER}@${PI_IP}:${PI_DIR}/ai_engine/"
fi

# Push Bundled JS file & package.json
echo -e "  -> Đẩy Server Bundle (index.js)..."
scp "${SERVER_DIR}/dist/index.js" "${PI_USER}@${PI_IP}:${PI_DIR}/server/"
scp "${SERVER_DIR}/package.json" "${PI_USER}@${PI_IP}:${PI_DIR}/server/"

# Push static web frontend (public/) and .env config
echo -e "  -> Đẩy giao diện Web static (public/)..."
rsync -avz --delete "${SERVER_DIR}/public/" "${PI_USER}@${PI_IP}:${PI_DIR}/server/public/"
[ -f "${SERVER_DIR}/.env" ] && scp "${SERVER_DIR}/.env" "${PI_USER}@${PI_IP}:${PI_DIR}/server/"

# Push BLE Mesh Gateway (Python script)
echo -e "  -> Đẩy BLE Mesh Gateway script..."
scp "${AI_ENGINE_DIR}/ble_mesh_gateway.py" "${AI_ENGINE_DIR}/ble_mesh_protocol.py" "${PI_USER}@${PI_IP}:${PI_DIR}/ai_engine/"

# 7. Start Remote Application
echo -e "${GREEN}🔄 [5/5] Khởi động ứng dụng trên Raspberry Pi...${NC}"
ssh "${PI_USER}@${PI_IP}" "bash -s" << EOF
  set -e
  echo "  -> Cài đặt & liên kết native modules (better-sqlite3) trên Pi..."
  cd ${PI_DIR}/server
  npm install --production > /dev/null 2>&1 || true
  mkdir -p ${PI_DIR}/server/build/Release
  cp node_modules/better-sqlite3/build/Release/better_sqlite3.node ${PI_DIR}/server/build/Release/ 2>/dev/null || true

  node -e "require('./db/database').initDatabase()"

  echo "  -> Cấp quyền thực thi..."
  chmod +x ${PI_DIR}/ai_engine/${BINARY_ENGINE} 2>/dev/null || true
  chmod +x ${PI_DIR}/ai_engine/ble_mesh_gateway.py 2>/dev/null || true

  echo "  -> Khởi chạy Smart Plant System..."
  pkill -f "${BINARY_ENGINE}" || true
  pkill -f "node index.js" || true
  pkill -f "node server.js" || true
  pkill -f "ble_mesh_gateway.py" || true

  if command -v pm2 &> /dev/null; then
    # Start AI Engine only if binary exists
    if [ -f "${PI_DIR}/ai_engine/${BINARY_ENGINE}" ]; then
      pm2 restart smart-plant-engine || pm2 start ${PI_DIR}/ai_engine/${BINARY_ENGINE} --name "smart-plant-engine" || true
    else
      echo "  -> Bỏ qua chạy AI Engine vì chưa được compile/đẩy lên Pi"
    fi
    
    # Start Web Server
    pm2 restart smart-plant-server || pm2 start ${PI_DIR}/server/server.js --name "smart-plant-server" || true
    
    # Start BLE Gateway
    pm2 restart smart-plant-ble || pm2 start ble_mesh_gateway.py --interpreter /usr/bin/python3 --cwd ${PI_DIR}/ai_engine --name "smart-plant-ble" || true
    
    pm2 save
  else
    echo "  ⚠️ CẢNH BÁO: Không tìm thấy PM2! Ứng dụng chạy bằng nohup sẽ không tự khởi động lại khi mất điện."
    cd ${PI_DIR}
    nohup ${PI_DIR}/ai_engine/${BINARY_ENGINE} > ai_engine.log 2>&1 &
    cd ${PI_DIR}/server
    nohup node server.js > ../server.log 2>&1 &
    cd ${PI_DIR}/ai_engine
    nohup /usr/bin/python3 ble_mesh_gateway.py > ../ble_mesh.log 2>&1 &
  fi

  echo "  ✓ Hệ thống đã khởi chạy thành công trên Pi!"
EOF

echo -e "${BLUE}=====================================================${NC}"
echo -e "${GREEN}🎉 EMBEDDED DEPLOYMENT SUCCESSFUL!${NC}"
echo -e "Mở trình duyệt truy cập Web: ${YELLOW}http://${PI_IP}:3000${NC}"
echo -e "${BLUE}=====================================================${NC}"
