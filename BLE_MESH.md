# ESP32 BLE Mesh Gateway qua USB

Raspberry Pi là hub lưu dữ liệu và chạy web. Một ESP32 riêng làm BLE Mesh
Provisioner, nối vào Pi bằng cáp USB data ở 115200 baud.

```text
ESP32 sensor nodes <-- BLE Mesh --> ESP32 Gateway <-- USB serial --> Pi 4 <-- HTTP --> Web
```

## Cấu hình Pi

### Đẩy số đo node BLE lên Firebase Realtime Database

Gateway ghi mỗi bản tin sensor vào SQLite như trước, đồng thời cập nhật RTDB
ngay sau khi nhận bản tin từ node. Cấu trúc dữ liệu:

```text
/ble_sensors/0x0002/latest
/ble_sensors/0x0002/history/<push-id>
```

`latest` luôn là số đo mới nhất của node; `history` lưu các lần đo. Mỗi object
có `temperature`, `humidity`, `light`, `soil_moisture`, `node_address`,
`zone_id` và timestamp do Firebase tạo.

Trên Pi, giữ service account tại
`ai_engine/config/pi4-iot.json` (không commit khóa lên GitHub). Cài SDK vào
virtualenv riêng:

```bash
cd /home/<pi-user>/Smart_Plant
python3 -m venv ai_engine/.venv
ai_engine/.venv/bin/pip install -r ai_engine/requirements-firebase.txt
```

Thêm vào `server/.env`:

```env
FIREBASE_ENABLED=true
FIREBASE_DATABASE_URL=https://pi4-iot-1b7bb-default-rtdb.asia-southeast1.firebasedatabase.app
GOOGLE_APPLICATION_CREDENTIALS=/home/<pi-user>/Smart_Plant/ai_engine/config/pi4-iot.json
```

Khởi động/restart gateway bằng Python trong virtualenv để các số đo BLE được
đồng bộ lên Firebase:

```bash
pm2 delete smart-plant-ble 2>/dev/null || true
pm2 start ai_engine/ble_mesh_gateway.py --name smart-plant-ble \
  --interpreter "$PWD/ai_engine/.venv/bin/python" --cwd "$PWD/ai_engine"
pm2 save
```

Sau đó mở Realtime Database → Data và xem `/ble_sensors`. Trạng thái kết nối
Firebase của gateway có trong `/api/ble/status` dưới `firebase_status`.

Tài khoản chạy gateway cần thuộc nhóm `dialout`:

```bash
sudo usermod -aG dialout "$USER"
sudo reboot
```

Gateway tự ưu tiên `/dev/serial/by-id/*`, sau đó thử `/dev/ttyACM*` và
`/dev/ttyUSB*`. Có thể cố định cổng:

```bash
MESH_SERIAL_PORT=/dev/serial/by-id/<ten-thiet-bi> \
  /usr/bin/python3 ai_engine/ble_mesh_gateway.py
```

Chạy bằng PM2:

```bash
pm2 delete smart-plant-ble 2>/dev/null || true
MESH_SERIAL_PORT=/dev/ttyUSB0 pm2 start ai_engine/ble_mesh_gateway.py \
  --name smart-plant-ble --interpreter /usr/bin/python3
pm2 save
```

Không cần `bluetooth-meshd`, `bluetooth.service` hay Python `dbus` cho gateway
mới. Bluetooth tích hợp trên Pi không tham gia mạng mesh.

## Giao thức USB JSON Lines

Mỗi bản tin là một JSON object trên một dòng, kết thúc bằng `\n`. Pi gửi:

```json
{"action":"status"}
{"action":"scan"}
{"action":"provision","uuid":"53504d31f105010020e7c867144e0001"}
{"action":"configure","uuid":"53504d31f105010020e7c867144e0001"}
```

ESP32 Gateway trả:

```json
{"event":"gateway","ready":true,"state":"attached","address":"0x0001","firmware":"1.0.0"}
{"event":"scan_result","uuid":"53504d31f105010020e7c867144e0001","rssi":-61}
{"event":"state","state":"provisioning","ready":true}
{"event":"node","uuid":"53504d31f105010020e7c867144e0001","address":"0x0002","provisioned":true,"appkey":true,"bind":true,"publication":true}
{"event":"sensor","address":"0x0002","temperature":27.8,"humidity":65.75,"light":415,"soil_moisture":45.65}
{"event":"error","message":"provision timeout"}
```

Pi chỉ tạo node hoàn chỉnh khi cả `provisioned`, `appkey`, `bind` và
`publication` đều là `true`. Sensor từ node chưa hoàn chỉnh sẽ bị từ chối.

## Yêu cầu firmware Gateway

- ESP-IDF 5.3.x, BLE Mesh Provisioner, PB-ADV, No OOB.
- Primary address của gateway: `0x0001`.
- NetKey index `0x0000`, AppKey index `0x0000`.
- Chỉ hiện device UUID bắt đầu bằng ASCII `SPM1` (`53 50 4d 31`).
- Sau provisioning: Config AppKey Add, Model App Bind cho vendor model
  Company `0x05F1` / Model `0x0001`, rồi Model Publication Set về `0x0001`.
- Chỉ phát event `node` với bốn cờ `true` sau khi nhận status thành công của cả
  bốn bước.
- Nhận vendor opcode `0xC1`, Company ID `0x05F1`; giải mã payload 8 byte
  little-endian: `int16 temperature*100`, `uint16 humidity*100`, `uint16 light`,
  `uint16 soil_moisture*100`.
- Lưu NetKey, AppKey, DeviceKey, sequence number và dải unicast trong NVS.
- Không dùng `ESP_LOG*` trên cùng UART USB sau khi chạy giao thức, vì log thường
  sẽ làm hỏng JSON Lines. Có thể tắt log hoặc gửi log thành event JSON.

Prompt đầy đủ để tạo firmware nằm trong [ESP32_GATEWAY_PROMPT.md](ESP32_GATEWAY_PROMPT.md).

## Kiểm tra

```bash
/usr/bin/python3 ai_engine/ble_mesh_gateway.py status
/usr/bin/python3 ai_engine/ble_mesh_gateway.py scan
node --test server/test/ble.test.js
/usr/bin/python3 -m unittest discover -s ai_engine -p 'test_ble_mesh.py' -v
npm --prefix client run build
```

## Không quét thấy node trên web

Chạy trên **Raspberry Pi đang phục vụ web** (không phải laptop chỉnh code):

```bash
ls -l /dev/serial/by-id/ /dev/ttyUSB* /dev/ttyACM*
/usr/bin/python3 ai_engine/ble_mesh_gateway.py status
```

- `disconnected`: Pi chưa mở được USB gateway. Kiểm tra cáp data, nhóm `dialout`,
  và `MESH_SERIAL_PORT` có đang cố định cổng cũ hay không.
- `connecting`: cổng mở được nhưng chưa nhận JSON `gateway` với `ready:true`.
  Đóng Serial Monitor và kiểm tra đã nạp firmware gateway. Bridge hỏi lại status
  mỗi 2 giây trong 20 giây, sau đó thử kết nối lại/chuyển cổng nếu tự dò.
- `attached, ready:true`: bật ESP32 **node cảm biến riêng**, chọn **Quét ESP32**,
  bấm UUID tìm được rồi **Join vào Mesh**. ESP32 gateway nối USB không nằm trong
  danh sách quét. Node đã provision không quảng bá unprovisioned nữa; dùng
  **Cấu hình lại** nếu node đã xuất hiện trong danh sách.

Bridge bỏ qua chữ boot ROM, đồng bộ node đã lưu khi gateway sẵn sàng và xóa
kết quả quét cũ khi mất USB. Web làm mới trạng thái mỗi 2 giây. Sau khi cập nhật
code lên Pi, cần khởi động lại tiến trình bridge và build lại frontend theo cách
triển khai hiện có. Sửa code trên laptop không tự cập nhật dịch vụ trên Pi.

## Vòng đời node và khu (gateway 1.1.0)

Khu chỉ được tạo khi cả `provisioned`, `appkey`, `bind`, `publication` đều true.
Node đang cấu hình vẫn xuất hiện trong BLE Mesh nhưng chưa tạo khu. Khu mẫu hoặc
khu không gắn node đã cấu hình không xuất hiện trong tổng quan.

Nút xóa gửi `{"action":"remove","uuid":"..."}`. Gateway gửi Config Node Reset,
chờ Node Reset Status rồi xóa DevKey/bản ghi node trong NVS và phát
`{"event":"node_removed","uuid":"..."}`. Pi chỉ xóa node, khu không còn node
và dữ liệu của khu đó khi nhận xác nhận. Dấu xóa được lưu trong SQLite để bản
snapshot cũ không tạo lại node sau F5/restart. Node tắt nguồn khiến xóa thất bại;
bật node rồi thử lại. Sau reset thành công có thể Scan và Join node lại.
