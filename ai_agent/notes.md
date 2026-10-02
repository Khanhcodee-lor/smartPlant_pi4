# Nhật ký hoạt động của AI Agent

Dưới đây là các ghi chú về những công việc AI Agent đã thực hiện trên dự án `smartPlant_pi4`:

## 1. Dọn dẹp mã nguồn trên Raspberry Pi (15/08/2026)
- **Vấn đề**: Toàn bộ mã nguồn (source code) bao gồm `client/` và `ai_engine/` đã được đồng bộ lên Pi thông qua `deploy.sh`. Tuy nhiên, chỉ cần giữ lại các file đã build/biên dịch để chạy.
- **Hành động**: Đã sử dụng SSH (mật khẩu `123456`) để truy cập vào Pi (IP `192.168.1.106`) và xóa các mã nguồn không cần thiết để giải phóng dung lượng.
- **Kết quả**: Trên Pi hiện tại chỉ còn lại các file phục vụ việc chạy ứng dụng:
  - `ai_engine/build/` (chứa file thực thi C++ `smart_plant_engine`)
  - `ai_engine/model/` (chứa model AI YOLO)
  - `server/` (chứa source code Node.js server và thư mục `public/` chứa bản build frontend).

## 2. Xóa các file ảnh bị trùng lặp (15/08/2026)
- **Vấn đề**: Trong workspace cục bộ có 2 thư mục chứa các file ảnh test giống hệt nhau (`ai_engine/test_images/` và `ai_engine/test/img/`).
- **Hành động**: Đã kiểm tra source code `ai_engine/src/pest_detector.cpp` và xác nhận chương trình đọc ảnh từ `test_images/`. Do đó, đã tiến hành xóa bỏ thư mục bị thừa là `ai_engine/test/`.
- **Kết quả**: Thư mục `ai_engine/test/` cùng toàn bộ các ảnh trùng lặp bên trong đã bị xóa, giữ lại `ai_engine/test_images/` để AI Engine có thể fallback đọc ảnh khi không có camera.

## 3. Khắc phục xung đột cổng 3000 & dọn dẹp tiến trình PM2 (02/10/2026)
- **Vấn đề**:
  - Trên Raspberry Pi 4 (IP: `192.168.1.148`, user: `toan`), tiến trình `smart-plant-server` trên PM2 liên tục bị crash và restart hơn 550 lần với lỗi `listen EADDRINUSE: address already in use 0.0.0.0:3000`.
  - Nguyên nhân: File `ai_engine/src/main.cpp` của C++ Engine đã có cơ chế tự động fork và quản lý `node server.js` khi chạy. Do đó, việc PM2 cùng lúc chạy riêng `smart-plant-server` dẫn đến xung đột chiếm dụng cổng 3000.
- **Hành động**:
  - Dừng và xóa tiến trình trùng lặp `smart-plant-server` khỏi PM2 (`pm2 delete smart-plant-server && pm2 save`).
  - Để C++ Engine (`smart-plant-engine`) độc quyền quản lý vòng đời của Web Server Node.js.
- **Kết quả**:
  - Web Server chạy ổn định tuyệt đối tại PID do `smart_plant_engine` điều phối.
  - Cổng 3000 phục vụ Dashboard và REST API (`/api/sensors/latest`, `/api/ble/status`) phản hồi chuẩn `HTTP 200 OK`.

## 4. Xây dựng hệ thống tự động nhận diện và cập nhật code qua GitHub Webhook (02/10/2026)
- **Mục tiêu**: Người dùng chỉ cần `git push origin main` (hoặc chạy `./deploy.sh`) từ máy tính, Raspberry Pi sẽ tự động nhận biết, kéo code mới nhất, build lại các thành phần tương ứng và khởi động lại dịch vụ trong vòng ~2 giây mà không cần thao tác SSH thủ công.
- **Giải pháp kiến trúc**:
  - Do Raspberry Pi nằm trong mạng LAN nội bộ (`192.168.1.148`) không có IP public / không mở port modem, giải pháp là sử dụng **Smee.io Relay** (kênh chuyển tiếp Webhook mã nguồn mở chuẩn của GitHub) qua URL `https://smee.io/vJo3oGd8YjGekcKS`.
  - Trên Pi chạy một daemon Python kết nối outbound qua giao thức Server-Sent Events (SSE), nhận tin nhắn thời gian thực từ GitHub mà không cần cấu hình NAT/Port Forwarding.
- **Các thành phần đã triển khai**:
  1. **`webhook_service.py`**:
     - Viết bằng Python 3 thuần (dùng thư viện chuẩn `urllib`, `json`, `subprocess`, không phụ thuộc pip).
     - Kết nối giữ luồng SSE tới Smee Relay; tự động kết nối lại khi mất mạng (backoff).
     - Phân tích payload GitHub: Khi phát hiện sự kiện `push` vào nhánh `refs/heads/main`, tự động kích hoạt `auto_update.sh` trong luồng ngầm an toàn.
     - Đã đăng ký thành tiến trình nền PM2: `smart-plant-webhook` (tự bật lại khi reboot).
  2. **`auto_update.sh`**:
     - Đặt cơ chế chống chạy đồng thời bằng `flock /tmp/smartplant-update.lock`.
     - Tự động đồng bộ bằng `git reset --hard origin/main`, triệt tiêu hoàn toàn các lỗi nghẽn do file build / untracked sinh ra trước đó.
     - **Tự động nhận diện module thay đổi để biên dịch**:
       * Thay đổi `client/`: tự động chạy `npm install` và `npm run build`, đồng bộ ra `server/public/`.
       * Thay đổi `ai_engine/`: tự động chạy `cmake` và `make -j$(nproc)` để build lại file thực thi C++.
       * Thay đổi `server/package.json`: tự động cập nhật dependencies Node.js.
     - Tự động khởi động lại các dịch vụ PM2 liên quan (`smart-plant-ble`, `smart-plant-engine`).
  3. **Cấu hình dự án & Git**:
     - Cập nhật [.gitignore](file:///home/khanh0209/workspace/pi_4_thiIOT/smartPlant_pi4/.gitignore): loại trừ triệt để thư mục `build/` root và các file chứng chỉ nhạy cảm (`*.json`, `ai_engine/config/`).
     - Cập nhật [deploy.sh](file:///home/khanh0209/workspace/pi_4_thiIOT/smartPlant_pi4/deploy.sh): điều chỉnh IP mặc định sang `192.168.1.148`, user `toan`.
     - Điều chỉnh lịch crontab trên Pi sang `*/15 * * * *` đóng vai trò heartbeat dự phòng.
  4. **Thiết lập GitHub Repository Webhook**:
     - Đã thêm Webhook thành công trên GitHub Settings của repository `Khanhcodee-lor/smartPlant_pi4`.
     - Kiểm thử thực tế (End-to-End Test): Ping và Push event đã được gửi từ GitHub, Pi nhận diện và hoàn tất cập nhật trong 2 giây.

## 5. Định tuyến dữ liệu Firebase theo tên Node & Thêm tính năng đổi tên Node (02/10/2026)
- **Vấn đề**:
  - Ban đầu dữ liệu đẩy lên Firebase theo đường dẫn hex tĩnh `/ble_sensors/0x07fa/...` thay vì phân loại theo tên node trực quan (`node1`, `node2`...) do người dùng thiết lập trên Web Dashboard.
- **Hành động**:
  - Chép khóa bí mật Firebase [pi4-iot.json](file:///home/khanh0209/workspace/pi_4_thiIOT/smartPlant_pi4/ai_engine/config/pi4-iot.json) lên Pi và tạo [server/.env](file:///home/khanh0209/workspace/pi_4_thiIOT/smartPlant_pi4/server/.env).
  - Cài đặt thư viện `firebase-admin` vào môi trường ảo `venv` trên Pi và kích hoạt qua PM2.
  - Sửa đổi [ble_mesh_gateway.py](file:///home/khanh0209/workspace/pi_4_thiIOT/smartPlant_pi4/ai_engine/ble_mesh_gateway.py) để truy vấn tên node (`ble_nodes.name`) và zone tương ứng, đẩy dữ liệu trực tiếp vào:
    * `/{node_name}/sensor/`: Chứa số đo mới nhất (nhiệt độ, độ ẩm, ánh sáng, độ ẩm đất, zone, timestamp).
    * `/{node_name}/history/{push_key}`: Lưu trữ lịch sử từng lần đo.
  - Thêm API `PATCH /api/ble/nodes/:id` trong [server/routes/ble.js](file:///home/khanh0209/workspace/pi_4_thiIOT/smartPlant_pi4/server/routes/ble.js) cho phép cập nhật tên node bất kỳ lúc nào.
  - Cập nhật giao diện tab BLE Mesh trong [BleMeshTab.jsx](file:///home/khanh0209/workspace/pi_4_thiIOT/smartPlant_pi4/client/src/components/BleMeshTab.jsx): cho phép người dùng click icon bút chì sửa tên Node (VD: `node1`, `node2`) trực tiếp trên Web Dashboard.
- **Kết quả**:
  - Đã đổi tên Node hiện tại thành `node1`.
  - Dữ liệu đã xuất hiện chuẩn xác trên Firebase Realtime Database tại nhánh `https://pi4-iot-1b7bb-default-rtdb.asia-southeast1.firebasedatabase.app/node1/sensor`.


