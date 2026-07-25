# 🌱 Smart Plant — Raspberry Pi 4

Hệ thống giám sát khu vườn thông minh trên Raspberry Pi 4.

- **AI Engine** (C++) — Đọc cảm biến + phát hiện sâu bệnh
- **Web Server** (Node.js) — REST API + Dashboard hiển thị dữ liệu

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
├── server/                 # Node.js — web server + dashboard
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
│   └── public/
│       ├── index.html
│       ├── css/style.css
│       └── js/app.js
│
├── .gitignore
└── README.md
```

---

## ⚙️ Yêu cầu hệ thống

| Thành phần | Yêu cầu |
|------------|----------|
| OS | Ubuntu / Raspberry Pi OS (64-bit) |
| C++ | GCC ≥ 10 (hỗ trợ C++17) |
| CMake | ≥ 3.16 |
| Node.js | ≥ 18 (khuyến nghị v20 LTS) |
| npm | ≥ 8 |

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

### 1. Clone dự án

```bash
git clone <repo-url>
cd Smart_Plant
```

### 2. Build Web Server (Node.js)

```bash
cd server

# Cài dependencies
npm install

# Tạo dữ liệu mẫu (lần đầu)
npm run seed

# Chạy server (development mode — auto reload khi sửa code)
npm run dev
```

Server sẽ chạy tại: `http://0.0.0.0:3000`

> **Lưu ý:** Nếu dùng NVM, mỗi lần mở terminal mới cần load NVM trước:
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

| Tham số | Mặc định | Mô tả |
|---------|----------|-------|
| `--server-url` | `http://localhost:3000` | URL web server |
| `--sensor-interval` | `5` | Gửi sensor data mỗi N giây |
| `--pest-interval` | `30` | Chạy pest detection mỗi N giây |
| `--zones` | `4` | Số khu vực vườn |
| `-h`, `--help` | | Hiện trợ giúp |

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

| Method | Endpoint | Mô tả |
|--------|----------|--------|
| `GET` | `/api/sensors/latest` | Dữ liệu cảm biến mới nhất |
| `GET` | `/api/sensors/latest-by-zone` | Mới nhất theo từng zone |
| `GET` | `/api/sensors/history?hours=24` | Lịch sử N giờ |
| `POST` | `/api/sensors` | Ghi reading mới |

### Pest Detection API

| Method | Endpoint | Mô tả |
|--------|----------|--------|
| `GET` | `/api/pests/latest?limit=10` | Phát hiện gần đây |
| `GET` | `/api/pests/history?days=7` | Lịch sử N ngày |
| `GET` | `/api/pests/stats` | Thống kê theo loại/mức độ |
| `POST` | `/api/pests` | Ghi kết quả phát hiện |

### Zone API

| Method | Endpoint | Mô tả |
|--------|----------|--------|
| `GET` | `/api/zones` | Danh sách khu vực |
| `GET` | `/api/zones/:id` | Chi tiết khu vực |
| `POST` | `/api/zones` | Tạo khu vực mới |
| `PUT` | `/api/zones/:id` | Cập nhật khu vực |

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
