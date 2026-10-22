# Smart Plant Raspberry Pi Capture Service

Service này chạy trên Raspberry Pi, polling `plants/{PLANT_ID}/commands/capture`,
chụp bằng Picamera2, phân tích ảnh, upload Storage và ghi kết quả vào
`plants/{PLANT_ID}/plant_captures/{request_id}`. `request_id` là khóa idempotency:
capture đã có `status=completed` sẽ không bị chụp lại sau restart. Trạng thái
Firebase là nguồn bền vững; file local chỉ chứa ảnh để retry/điều tra, không tự
động xóa ảnh cũ.

## Cài đặt

Trên Raspberry Pi OS Bookworm:

```bash
sudo apt update
sudo apt install -y python3-venv python3-picamera2 libcamera-apps
sudo mkdir -p /opt/smart-plant
sudo chown "$USER" /opt/smart-plant
git clone <repository-url> /opt/smart-plant/repository
cd /opt/smart-plant/repository/pi_camera_service
python3 -m venv --system-site-packages /opt/smart-plant/repository/.venv
. /opt/smart-plant/repository/.venv/bin/activate
pip install -r requirements.txt
```

Tạo service account trong Firebase Console, tải JSON vào vị trí chỉ user service
đọc được (ví dụ `/etc/smart-plant/firebase-service-account.json`), rồi:

```bash
cp .env.example .env
chmod 600 .env /etc/smart-plant/firebase-service-account.json
# sửa các giá trị Firebase và PLANT_ID trong .env
```

Không commit `.env` hoặc service-account JSON.

## Chạy và kiểm thử

Kiểm tra camera trước:

```bash
libcamera-still -o /tmp/camera-test.jpg
```

Chạy dry-run không cần camera/Firebase thật:

```bash
DRY_RUN=true python -m pi_camera_service.main
pytest -q
```

Chạy thật:

```bash
python -m pi_camera_service.main
```

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

## Thay model AI

Thay nội dung `DiseaseAnalyzer.load_model` và `_run_inference` trong
`disease_analyzer.py`. `_run_inference` cần trả về list có
`disease_class` và `confidence`; `analyze` sẽ ép confidence về `[0, 1]` và
trả fallback “Không phát hiện bệnh” khi danh sách rỗng. Có thể dùng YOLO,
TensorFlow Lite hoặc PyTorch mà không đổi orchestration.
