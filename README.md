# 🌱 Smart Plant — Raspberry Pi 4

Hệ thống giám sát khu vườn thông minh trên Raspberry Pi 4.

- **AI Engine** (C++) — Đọc cảm biến + phát hiện sâu bệnh
- **Web Server** (Node.js) — REST API + Dashboard hiển thị dữ liệu

Hướng dẫn gateway Python trên Pi và giao thức ESP-IDF: [BLE_MESH.md](BLE_MESH.md).

## 📁 Cấu trúc dự án

```
Smart_Plant/
├── ai_engine/              # C++ — đọc sensor, phát hiện sâu bệnh
│   ├── CMakeLists.txt
│   ├── include/
│   │   ├── http_client.h
│   │   ├── sensor_simulator.h
│   │   └── pest_detector.h
│   └── src/
│       ├── main.cpp
│       ├── http_client.cpp
│       ├── sensor_simulator.cpp
│       └── pest_detector.cpp
│
├── client/                 # React + Vite — Frontend Dashboard UI
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── App.jsx
│       ├── api.js
│       ├── components/
│       └── assets/
│
├── server/                 # Node.js — REST API + Static Web Server
│   ├── server.js
│   ├── package.json
│   ├── .env
│   ├── db/
│   │   ├── database.js
│   │   └── seed.js
│   ├── routes/
│   │   ├── sensor.js
│   │   ├── pest.js
│   │   └── zone.js
│   └── public/             # Static files (built from client)
│       ├── index.html
│       └── assets/
│
├── .gitignore
├── deploy.sh
└── README.md
```

---

## ⚙️ Yêu cầu hệ thống

| Thành phần | Yêu cầu                           |
| ---------- | --------------------------------- |
| OS         | Ubuntu / Raspberry Pi OS (64-bit) |
| C++        | GCC ≥ 10 (hỗ trợ C++17)           |
| CMake      | ≥ 3.16                            |
| Node.js    | ≥ 18 (khuyến nghị v20 LTS)        |
| npm        | ≥ 8                               |

### Kiểm tra phiên bản

```bash
g++ --version
cmake --version
node --version
npm --version
```

### Cài Node.js (nếu chưa có)

```bash
# Cài NVM (không cần sudo)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# Khởi động NVM
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"

# Cài Node.js 20 LTS
nvm install 20
```

---

## 🚀 Hướng dẫn Build & Chạy

### Gửi code lên GitHub

Máy phát triển không cần kết nối trực tiếp tới Pi. Sau khi commit code, chạy:

```bash
chmod +x deploy.sh
./deploy.sh
```

Script chỉ push branch hiện tại lên `origin`, không dùng SSH tới Pi và không cần biết IP Pi.
Nếu còn file chưa commit, script sẽ dừng để tránh đẩy nhầm code.

### Build trên máy bên họ và SCP sang Pi

Máy bên họ cần là Linux và có cross-compiler ARM64, Node.js, CMake, SSH và `rsync`:

```bash
sudo apt update
sudo apt install -y g++-aarch64-linux-gnu gcc-aarch64-linux-gnu cmake rsync
git pull --ff-only origin main
PUSH_ONLY=0 REMOTE_BUILD=0 ./deploy.sh 10.42.0.187 khanhpi /home/khanhpi/Smart_Plant
```

Lệnh trên sẽ build C++ ARM64, build frontend, đóng gói server rồi dùng `scp`/`rsync` đẩy artifact sang Pi. Pi không cần build source code.

Pi chỉ cần cài Node.js, OpenCV runtime và PM2 một lần:

```bash
sudo apt update
sudo apt install -y libopencv-dev
npm install -g pm2
```

### Firebase: lưu ảnh camera và kết quả nhận diện

Backend dùng Firebase Admin SDK để lưu ảnh trong Cloud Storage for Firebase và tạo một tài liệu Firestore cho mỗi lần chụp. Trong Firebase Console của dự án `pi4-iot-1b7bb`, hãy bật Firestore Database và Storage. Cloud Storage for Firebase yêu cầu dự án dùng gói Blaze. Mở **Storage → Files**, lấy đúng tên bucket đang hiển thị (bỏ tiền tố `gs://`) rồi đặt vào `FIREBASE_STORAGE_BUCKET`; bucket có thể mang tên `.firebasestorage.app` hoặc `.appspot.com` tùy thời điểm tạo dự án.

Đặt service-account JSON tại `ai_engine/config/pi4-iot.json` trên Pi. File này đã bị Git ignore; không đưa khóa lên GitHub. Trên Pi, tạo/cập nhật `server/.env` theo các dòng sau, thay bucket bằng tên lấy trong Firebase Console nếu khác:

```dotenv
FIREBASE_PROJECT_ID=pi4-iot-1b7bb
FIREBASE_STORAGE_BUCKET=pi4-iot-1b7bb.firebasestorage.app
GOOGLE_APPLICATION_CREDENTIALS=../ai_engine/config/pi4-iot.json
```

Khi Pi nhận commit thay đổi `server/package.json`, `auto_update.sh` chạy `npm install`. Web server Node.js do `smart-plant-engine` khởi chạy và quản lý; script cập nhật sẽ xóa tiến trình PM2 `smart-plant-server` cũ nếu còn sót rồi restart engine. Không chạy thêm Node server riêng bằng PM2 vì sẽ tranh cổng 3000. Dữ liệu được ghi như sau:

- Storage: `plant-captures/{captureId}/original.<ext>` cho ảnh camera và ảnh test từ thẻ nhớ; thêm `ai-annotated.jpg` khi AI phát hiện sâu bệnh.
- Firestore: collection `plant_captures`, document ID là `captureId`. Các trường gồm `source` (`camera`, `pi_test_image` hoặc `sqlite_history`), `source_location`, `source_filename` và `source_path` với ảnh test, `status` (`detected`, `no_detection`, `analysis_failed`), `captured_at` (Firestore Timestamp), `captured_at_iso` (UTC), `capture_date` và `capture_time` (giờ Việt Nam), `zone_id`, `pest_type`, `confidence`, `severity`, `notes`, đường dẫn Storage và URL ảnh.
- Cả trường hợp không phát hiện bệnh vẫn lưu ảnh và một tài liệu Firestore. Lỗi AI được ghi vào `analysis_error`; lỗi khi lưu ảnh chú thích được ghi vào `annotation_storage_error`.
- Lịch sử bệnh trên dashboard gộp các lần phát hiện từ SQLite và Firestore. Các dòng SQLite cũ được đồng bộ lên Firestore theo ID ổn định khi API lịch sử chạy; các lần chụp mới lưu ID tài liệu Firebase vào SQLite để tránh hiện trùng. Nút xóa lịch sử xóa các bản ghi phát hiện ở cả hai nơi.

URL ảnh do Admin SDK tạo là URL truy cập dài hạn: ai có URL đều có thể mở ảnh. Server dùng service-account nên khóa chỉ được giữ trên Pi; Admin SDK có quyền quản trị và không bị giới hạn bởi Firestore/Storage Security Rules của ứng dụng khách.

Nếu build lỗi, phía Pi gửi log:

```bash
pm2 status
pm2 logs --lines 100
tail -n 100 ~/Smart_Plant/server.log
tail -n 100 ~/Smart_Plant/ai_engine.log
```

Lần đầu trên Pi, cài dependency hệ thống:

```bash
sudo apt update
sudo apt install -y git build-essential cmake libopencv-dev
npm install -g pm2
```

Chế độ Pi tự pull và build qua SSH vẫn có thể bật thủ công bằng `PUSH_ONLY=0 REMOTE_BUILD=1 ./deploy.sh`, nhưng không cần dùng trong workflow này.

### 1. Clone dự án

```bash
git clone <repo-url>
cd Smart_Plant
```

### 2. Build & Chạy Web Application

#### a. Build & Run Frontend (React + Vite)

```bash
cd client
npm install
npm run dev      # Chạy dev server (HMR hot reload tại http://localhost:5173)
# Hoặc build production:
npm run build    # Xuất file tĩnh ra dist/ và copy sang server/public/
```

#### b. Build & Run Web Server (Node.js)

```bash
cd server
npm install
npm run seed     # Tạo dữ liệu mẫu (lần đầu)
npm run dev      # Chạy server (development mode tại http://localhost:3000)
```

Server sẽ chạy tại: `http://0.0.0.0:3000`

> **Lưu ý:** Nếu dùng NVM, mỗi lần mở terminal mới cần load NVM trước:
>
> ```bash
> export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh"
> ```

### 3. Build AI Engine (C++)

```bash
cd ai_engine

# Tạo thư mục build
mkdir -p build && cd build

# Configure (CMake sẽ tự tải nlohmann_json)
cmake ..

# Build
make -j$(nproc)
```

File thực thi: `ai_engine/build/smart_plant_engine`

### 4. Chạy AI Engine

```bash
# Đảm bảo web server đang chạy trước!

cd ai_engine/build

# Chạy với cấu hình mặc định
./smart_plant_engine

# Hoặc tùy chỉnh
./smart_plant_engine --server-url http://localhost:3000 \
                     --sensor-interval 5 \
                     --pest-interval 30 \
                     --zones 4
```

**Các tham số:**

| Tham số             | Mặc định                | Mô tả                          |
| ------------------- | ----------------------- | ------------------------------ |
| `--server-url`      | `http://localhost:3000` | URL web server                 |
| `--sensor-interval` | `5`                     | Gửi sensor data mỗi N giây     |
| `--pest-interval`   | `30`                    | Chạy pest detection mỗi N giây |
| `--zones`           | `4`                     | Số khu vực vườn                |
| `-h`, `--help`      |                         | Hiện trợ giúp                  |

### 5. Xem Dashboard

Mở trình duyệt tại:

```
http://<địa-chỉ-IP-Pi>:3000
```

Ví dụ: `http://192.168.1.67:3000`

Trên chính Pi: `http://localhost:3000`

---

## 📡 API Endpoints

### Sensor API

| Method | Endpoint                        | Mô tả                     |
| ------ | ------------------------------- | ------------------------- |
| `GET`  | `/api/sensors/latest`           | Dữ liệu cảm biến mới nhất |
| `GET`  | `/api/sensors/latest-by-zone`   | Mới nhất theo từng zone   |
| `GET`  | `/api/sensors/history?hours=24` | Lịch sử N giờ             |
| `POST` | `/api/sensors`                  | Ghi reading mới           |

### Pest Detection API

| Method | Endpoint                     | Mô tả                     |
| ------ | ---------------------------- | ------------------------- |
| `GET`  | `/api/pests/latest?limit=10` | Phát hiện gần đây         |
| `GET`  | `/api/pests/history?days=7`  | Lịch sử N ngày            |
| `GET`  | `/api/pests/stats`           | Thống kê theo loại/mức độ |
| `POST` | `/api/pests`                 | Ghi kết quả phát hiện     |

### Zone API

| Method | Endpoint         | Mô tả             |
| ------ | ---------------- | ----------------- |
| `GET`  | `/api/zones`     | Danh sách khu vực |
| `GET`  | `/api/zones/:id` | Chi tiết khu vực  |
| `POST` | `/api/zones`     | Tạo khu vực mới   |
| `PUT`  | `/api/zones/:id` | Cập nhật khu vực  |

### Chat API

| Method | Endpoint    | Mô tả                                                     |
| ------ | ----------- | --------------------------------------------------------- |
| `POST` | `/api/chat` | Gửi tin nhắn cho Trợ lý AI (body: `{ "message": "..." }`) |

### Ví dụ gửi dữ liệu bằng curl

```bash
# Gửi sensor data
curl -X POST http://localhost:3000/api/sensors \
  -H "Content-Type: application/json" \
  -d '{"temperature": 28.5, "humidity": 65, "light": 45000, "soil_moisture": 55, "zone_id": 1}'

# Gửi pest detection
curl -X POST http://localhost:3000/api/pests \
  -H "Content-Type: application/json" \
  -d '{"pest_type": "Rệp xanh", "confidence": 0.92, "zone_id": 1, "severity": "medium"}'
```

---

## 🔧 Quick Start (tất cả trong 1)

```bash
# Terminal 1 — Web Server
cd server
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh"
npm install && npm run seed && npm run dev

# Terminal 2 — AI Engine
cd ai_engine
mkdir -p build && cd build
cmake .. && make -j$(nproc)
./smart_plant_engine

# Terminal 3 hoặc Browser
# Mở http://localhost:3000
```

---

## 📝 Ghi chú

- Database SQLite được lưu tại `server/db/smart_plant.db` (tự tạo khi khởi động)
- `npm run seed` sẽ xóa dữ liệu cũ và tạo dữ liệu mẫu mới
- AI Engine hiện đang ở chế độ **giả lập** — thay thế `SensorSimulator` và `PestDetector` bằng code đọc sensor/camera thật khi tích hợp hardware
- Dashboard tự cập nhật mỗi 30 giây
