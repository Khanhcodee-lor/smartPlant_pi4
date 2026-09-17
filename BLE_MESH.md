# ESP32 BLE Mesh Gateway qua USB

Raspberry Pi là hub lưu dữ liệu và chạy web. Một ESP32 riêng làm BLE Mesh
Provisioner, nối vào Pi bằng cáp USB data ở 115200 baud.

```text
ESP32 sensor nodes <-- BLE Mesh --> ESP32 Gateway <-- USB serial --> Pi 4 <-- HTTP --> Web
```

## Cấu hình Pi

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
