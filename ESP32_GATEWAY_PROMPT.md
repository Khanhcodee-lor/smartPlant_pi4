# Prompt tạo firmware ESP32 Mesh Gateway

Hãy dùng nguyên prompt dưới đây khi tạo project firmware cho ESP32 thứ hai:

```text
Hãy tạo một project ESP-IDF 5.3.5 hoàn chỉnh cho ESP32 làm BLE Mesh
Provisioner/Gateway. ESP32 nối Raspberry Pi 4 qua USB-UART 115200, 8N1. Mỗi
message UART là một JSON object trên một dòng (JSON Lines). Dùng cJSON có sẵn
trong ESP-IDF, parser có giới hạn chiều dài và không block callback Bluetooth.

BLE Mesh:
- Provisioner address 0x0001, PB-ADV, No OOB, không dùng PB-GATT.
- NetKey index 0x0000, AppKey index 0x0000.
- Company ID 0x05F1, Vendor Model ID 0x0001.
- Chỉ scan/provision Device UUID 16 byte bắt đầu bằng ASCII "SPM1".
- Quản lý dải unicast từ 0x0002, không cấp trùng; lưu network keys, device keys,
  sequence number, node UUID/address/element count và next address trong NVS.
- Sau provision thành công phải lần lượt lấy Composition Data, Add AppKey, Bind
  AppKey 0 vào vendor model 0x05F1:0x0001 ở đúng element, và Set Publication của
  model đó về 0x0001. Có timeout, retry tối đa 3 lần và correlate đúng source,
  opcode, element, app index, company/model ID.
- Node chỉ thành công khi provisioned=true, appkey=true, bind=true và
  publication=true.
- Gateway có vendor server/client model để nhận opcode 3 byte 0xC1 + Company ID
  0x05F1. Payload đúng 8 byte little-endian: int16 temperature*100, uint16
  humidity*100, uint16 light lux, uint16 soil moisture*100. Kiểm tra humidity và
  soil từ 0..10000 trước khi gửi sang Pi.

Lệnh Pi gửi qua UART:
{"action":"status"}
{"action":"scan"}
{"action":"provision","uuid":"<32 hex>"}
{"action":"configure","uuid":"<32 hex>"}

Event ESP32 phải gửi:
{"event":"gateway","ready":true,"state":"attached","address":"0x0001","firmware":"1.0.0"}
{"event":"scan_result","uuid":"<32 hex>","rssi":-61}
{"event":"state","state":"scanning|provisioning|configuring|provision_failed|configuration_failed","ready":true,"error":"optional"}
{"event":"node","uuid":"<32 hex>","address":"0x0002","provisioned":true,"appkey":true,"bind":true,"publication":true}
{"event":"sensor","address":"0x0002","temperature":27.8,"humidity":65.75,"light":415,"soil_moisture":45.65}
{"event":"error","message":"..."}

Yêu cầu code:
- Trả toàn bộ CMakeLists.txt, sdkconfig.defaults, main/CMakeLists.txt và source C.
- Tách uart_protocol.c/.h, mesh_provisioner.c/.h và main.c.
- UART RX chạy task riêng; callback BLE chỉ đẩy event vào FreeRTOS queue.
- Mọi output UART0 sau boot phải là JSON hợp lệ; tắt ANSI và log thường.
- Chống buffer overflow, kiểm tra UUID/JSON/type/range, serialize UART bằng mutex.
- Nút configure phải tiếp tục cấu hình node đã provision mà không cấp địa chỉ mới.
- Khi reboot phải restore mạng và phát gateway ready; status phải phát lại toàn bộ
  node đã lưu bằng event node.
- Dùng API thật của ESP-IDF 5.3.5, không viết pseudo-code và không bỏ TODO.
- Cuối cùng ghi rõ lệnh idf.py build, erase-flash, flash và monitor.
```
