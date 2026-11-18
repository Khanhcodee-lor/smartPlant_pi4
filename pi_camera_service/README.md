# Smart Plant Raspberry Pi Capture Service

Service này chạy trên Raspberry Pi, polling `plants/{PLANT_ID}/commands/capture`,
lấy ảnh JPEG từ endpoint `/snapshot` của ustreamer, chạy model YOLO qua `ai_engine/build/smart_plant_engine --analyze`, upload Storage và ghi trạng thái/kết quả xử lý vào RTDB tại
`plants/{PLANT_ID}/plant_captures/{request_id}`. Kết quả phân tích cũng được mirror sang Firestore tại
`plants/{PLANT_ID}/plant_captures/{request_id}` để lịch sử bệnh trên web và AI cùng đọc từ Firestore.
`request_id` là khóa idempotency:
capture đã có `status=completed` sẽ không bị chụp lại sau restart. Trạng thái
Firebase là nguồn bền vững; file local chỉ chứa ảnh để retry/điều tra, không tự
động xóa ảnh cũ.

`analysis_listener.py` xử lý thêm hàng đợi ảnh từ app tại
`plants/{PLANT_ID}/commands/analyze`: ảnh tải từ Firebase Storage được đưa vào
`ai_engine/build/smart_plant_engine --analyze`, rồi kết quả được ghi vào RTDB
và mirror sang Firestore.

## Cài đặt

Trên Raspberry Pi OS Bookworm:

```bash
sudo apt update
sudo apt install -y python3-venv
sudo mkdir -p /opt/smart-plant
sudo chown "$USER" /opt/smart-plant
git clone <repository-url> /opt/smart-plant/repository
cd /opt/smart-plant/repository/pi_camera_service
python3 -m venv /opt/smart-plant/repository/pi_camera_service/.venv
. /opt/smart-plant/repository/pi_camera_service/.venv/bin/activate
pip install -r requirements.txt
```

Tạo service account trong Firebase Console, tải JSON vào vị trí chỉ user service
đọc được (ví dụ `/etc/smart-plant/firebase-service-account.json`), rồi:

```bash
cp .env.example .env
chmod 600 .env /home/toan/Smart_Plant/ai_engine/config/pi4-iot.json
# kiểm tra GOOGLE_APPLICATION_CREDENTIALS trỏ đúng tới service account JSON
```

Không commit `.env` hoặc service-account JSON.

## Chạy và kiểm thử

Kiểm tra camera trước:

```bash
curl -f http://127.0.0.1:8080/snapshot -o /tmp/camera-test.jpg
```

Chạy dry-run không cần camera/Firebase thật:

```bash
cd /opt/smart-plant/repository
DRY_RUN=true python -m pi_camera_service.main
python -m pytest -q pi_camera_service/tests
```

Chạy thật:

```bash
python -m pi_camera_service.main
```

Chạy bằng PM2 (từ thư mục repository):

```bash
pm2 start pi_camera_service/main.py --name smart-plant-camera \
  --interpreter pi_camera_service/.venv/bin/python --cwd "$PWD"
pm2 start pi_camera_service/analysis_listener.py --name smart-plant-ai-listener \
  --interpreter pi_camera_service/.venv/bin/python --cwd "$PWD"
pm2 save
```

`auto_update.sh` cài dependencies vào virtualenv này và restart cả hai service sau
mỗi lần pull có commit mới.

## systemd và log

Tạo user/thư mục runtime rồi cài unit:

```bash
sudo useradd --system --home /opt/smart-plant --shell /usr/sbin/nologin smartplant || true
sudo mkdir -p /var/lib/smart-plant/captures /var/log/smart-plant /etc/smart-plant
sudo chown -R smartplant:smartplant /var/lib/smart-plant /var/log/smart-plant
sudo cp deploy/smart-plant-pi.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now smart-plant-pi
sudo journalctl -u smart-plant-pi -f
```

Đảm bảo đường dẫn `/opt/smart-plant/repository` trong unit trỏ tới thư mục cài
đặt thực tế và file `.env` nằm trong `pi_camera_service/`.

## Test end-to-end

Ghi thủ công vào `plants/tomato_001/commands/capture`:

```json
{
  "status": 1,
  "request_id": "manual_1720000000000_ab12",
  "timestamp": 1720000000.123
}
```

Theo dõi command chuyển `1 -> 2 -> 0` (hoặc `-1`), rồi kiểm tra
`plants/tomato_001/plant_captures/manual_1720000000000_ab12`. Storage path là
`detections/snapshots/<filename>`. Nếu bucket không hỗ trợ public URL, service
vẫn lưu `image_path` để app dùng cơ chế download hiện tại.

## Nhận diện ảnh webcam

Ảnh webcam và ảnh từ điện thoại dùng cùng binary và model `ai_engine/model/best.onnx`.
Model hiện tại nhận diện 9 nhóm dấu hiệu bệnh/sâu hại và lá có vẻ khỏe của **cà chua**; không thể suy ra
model nhận diện được bệnh trên các loại cây khác. Nếu chưa build engine trên Pi:

```bash
cd /opt/smart-plant/repository/ai_engine
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j2
```

Sau khi cập nhật source, build lại engine như trên và cập nhật giao diện web nếu
cần, rồi khởi động lại các dịch vụ PM2 đang dùng:

```bash
cd /opt/smart-plant/repository
(cd client && npm install && npm run build && cp -r dist/* ../server/public/)
pm2 restart smart-plant-camera --update-env
pm2 restart smart-plant-ai-listener --update-env
pm2 restart smart-plant-engine --update-env
```

Đổi `/opt/smart-plant/repository` thành thư mục cài đặt thực tế. Nếu dùng systemd
thay PM2, build engine và khởi động lại unit tương ứng. Có thể kiểm tra riêng
model bằng `cmake -S ai_engine -B ai_engine/build -DSMART_PLANT_BUILD_TESTS=ON`,
`cmake --build ai_engine/build -j2`, rồi `ctest --test-dir ai_engine/build --output-on-failure`.
OpenCV 4.6 có thể chạy model qua chế độ tương thích với các lớp đầu ra của model
được cung cấp. Chế độ này phụ thuộc cấu trúc của `best.onnx`; nếu đổi model cần
kiểm tra lại, không mặc định model khác sẽ tương thích.

Đặt `AI_ENGINE_BINARY` trong `.env` nếu binary ở vị trí khác. Chụp cận cảnh một
hoặc vài lá, đủ sáng, rõ nét; giữ webcam yên và tránh bóng đổ. Nếu chỉ thấy lá rất
nhỏ trong ảnh thì đưa camera gần hơn. Ảnh gốc và ảnh có khung nhận diện (nếu có)
được lưu lên Storage. Zoom trong giao diện chỉ phóng to hình xem, không tăng chi
tiết ảnh đưa vào model. Ảnh gần như một màu sẽ không được kết luận là lá khỏe.

Mỗi lần chụp, service mặc định lấy 3 khung hình cách nhau 0,2 giây, chọn khung
có nhiều chi tiết cạnh hơn và lưu nguyên JPEG đó. Điểm cạnh chỉ là ước lượng:
ảnh nhiễu cũng có thể có nhiều cạnh. Model xem toàn ảnh gốc trước, sau đó phân
tích thêm tối đa hai vùng lá được phóng lên và tăng nét nhẹ (hoặc tăng nét toàn
ảnh nếu lá đã chiếm gần hết khung). Nếu lần đầu không
thấy lá, model thử thêm vùng giữa ảnh. Khi hai kết quả khác nhau, ảnh toàn cảnh
có điểm thấp hoặc chỉ thấy lá ở vùng giữa, giao diện báo **Cần kiểm tra lại**.
Ảnh gốc vẫn được giữ; tăng nét
không khôi phục được chi tiết đã mất do sai tiêu cự hay rung camera.

Trong `pi_camera_service/.env`, có thể đặt `CAPTURE_BURST_FRAMES` từ 1 đến 5
(mặc định 3) và `CAPTURE_BURST_INTERVAL_SECONDS` từ 0 đến 1 (mặc định 0.2).
`YOLO_ENHANCE=0` tắt lần phân tích bổ sung để so sánh; `YOLO_SHARPEN_STRENGTH`
từ 0 đến 1 điều chỉnh tăng nét, mặc định 0.3. Đặt về 0 để bỏ tăng nét nhưng vẫn
phân tích vùng lá. Các lượt bổ sung tốn thêm thời gian CPU trên Pi. Khởi động
lại camera service và AI listener sau khi đổi các thiết lập này.

Đây là xử lý ảnh trước khi **suy luận** bằng model hiện có, không huấn luyện lại
model. Kiểm thử bằng nhiều ảnh webcam thật, cả lá khỏe và lá bệnh, trước khi kết
luận thay đổi làm tăng độ chính xác; điểm model cao cũng có thể là dự đoán sai.

Ngưỡng mặc định là `0.35`. Nếu cần điều chỉnh, đặt `YOLO_CONFIDENCE_THRESHOLD`
(từ `0` đến `1`) trong `pi_camera_service/.env`, rồi khởi động lại hai dịch vụ
camera và AI listener. Giảm ngưỡng có thể bắt được thêm bệnh nhưng cũng tăng
nhận diện nhầm. Dự đoán dưới 60% được kèm nhắc kiểm tra lại; “Không phát hiện bệnh”
không có nghĩa là cây chắc chắn khỏe. Khi engine hoặc model lỗi, lệnh chụp báo lỗi
thay vì trả kết quả khỏe mạnh. Thay đổi model cần cập nhật danh sách nhãn theo đúng
metadata `names` của model mới.
