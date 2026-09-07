# BLE Mesh trên Raspberry Pi và ESP-IDF

Gateway dùng BlueZ Mesh D-Bus API (BlueZ 5.66 trở lên), Python 3 và SQLite
của server. Không cần build C++ để chạy gateway. Firmware ESP-IDF vẫn cần
build/flash riêng. Đây là BLE Mesh chuẩn, không phải ESP Wi-Fi Mesh hoặc BLE GATT thông thường.

## Cài và chạy trên Pi

Trên Raspberry Pi OS Bookworm/Debian có gói `bluez-meshd`:

```bash
sudo apt update
sudo apt install -y bluez-meshd python3-dbus python3-gi
sudo systemctl enable --now bluetooth-mesh
systemctl status bluetooth-mesh --no-pager
```

Nếu bản OS không có gói này, cần cài BlueZ có mesh daemon; chỉ cài thư viện
Python không đủ. Xem tên package/service trong tài liệu distro đang dùng.

Từ thư mục `Smart_Plant`, khởi tạo schema bằng module server (không chạy seed vì
seed xóa dữ liệu cũ):

```bash
npm --prefix server ci
node -e "require('./server/db/database').initDatabase()"
/usr/bin/python3 ai_engine/ble_mesh_gateway.py
```

Chạy gateway và Node.js bằng cùng tài khoản để Node.js truy cập socket.
Giữ terminal này mở. Trạng thái `attached` và `ready: true` nghĩa là Pi đã
cấu hình xong model/khóa cục bộ. Trong terminal khác:

```bash
/usr/bin/python3 ai_engine/ble_mesh_gateway.py status
/usr/bin/python3 ai_engine/ble_mesh_gateway.py scan
```

Sau vài giây, `status` trả về danh sách `devices`. Dùng **UUID thật** trong kết quả:

```bash
/usr/bin/python3 ai_engine/ble_mesh_gateway.py provision <UUID_32_KY_TU_HEX>
/usr/bin/python3 ai_engine/ble_mesh_gateway.py status
```

`provision` trả về yêu cầu đã được nhận; đợi `node_configured` để biết cấu hình
đã thành công. Gateway cấp cả dải địa chỉ theo số element của ESP, đọc Composition
Data page 0, gửi AppKey, bind vendor model và cấu hình publication về Pi `0x0001`.
Mỗi bước cấu hình thử tối đa 3 lần, mỗi lần chờ 10 giây.

Nếu đã cấp mạng nhưng cấu hình bị gián đoạn hoặc gateway khởi động lại giữa chừng:

```bash
/usr/bin/python3 ai_engine/ble_mesh_gateway.py configure <UUID_32_KY_TU_HEX>
```

Node không tự động được thêm chỉ vì ở gần Pi. Trên dashboard, mở tab **BLE Mesh**,
nhấn **Quét ESP32**, chọn UUID và nhấn **Thêm vào mạng**. Nút **Cấu hình lại** dùng
cho node đã provision. Khởi chạy server/frontend theo README của dự án.

API tương ứng:

- `GET /api/ble/status`: trạng thái trực tiếp từ gateway; không đọc file cũ để báo online.
- `POST /api/ble/scan`: quét 30 giây.
- `POST /api/ble/provision`, body `{"uuid":"...32 ký tự hex..."}`.
- `POST /api/ble/configure`, body như trên.

HTTP 202 nghĩa là nhận yêu cầu, không phải đã hoàn tất. HTTP 409 báo chưa sẵn sàng,
bận hoặc UUID không hợp lệ với trạng thái mạng; HTTP 503 báo gateway không truy cập được.

## Firmware ESP-IDF phải khớp

Firmware phải có Bluetooth Mesh node, Configuration Server và vendor model:

| Tham số | Giá trị gateway sử dụng |
| --- | --- |
| Provisioning bearer | PB-ADV (`ESP_BLE_MESH_PROV_ADV`) |
| Authentication | No OOB; gateway này chưa có luồng nhập mã OOB |
| Device UUID | 16 byte, riêng cho từng ESP, giữ ổn định qua reboot |
| Company ID | `0x05F1` (giữ giá trị thử nghiệm của dự án) |
| Vendor model ID | `0x0001` |
| NetKey index / AppKey index | `0` / `0`, nhận khi provision/configure |
| Địa chỉ nhận dữ liệu | Pi `0x0001` |
| Sensor opcode | `ESP_BLE_MESH_MODEL_OP_3(0xC1, 0x05F1)` |

Company ID `0x05F1` không phải mã tự do được cấp cho dự án này; khi triển khai sản
phẩm, thay bằng Company ID phù hợp ở cả Pi và ESP.

Bật provisioning sau khi khởi tạo stack và đăng ký callback:

```c
esp_ble_mesh_node_prov_enable(ESP_BLE_MESH_PROV_ADV);
```

Vendor model cần có **publication context/buffer** đủ chứa opcode và payload,
vì Pi gửi Config Model Publication Set. Sau khi AppKey và model binding được cấu
hình, firmware đọc cảm biến và gửi bằng vendor model đó. Gateway đặt publication
period bằng 0: **firmware chủ động gửi theo chu kỳ**, ví dụ 5 giây, qua
`esp_ble_mesh_model_publish()` với opcode trên và role node. Không hardcode NetKey
hoặc AppKey vào firmware. Lưu provisioning/configuration vào NVS để giữ mạng qua reboot.

Payload gồm **8 byte**, có thể thêm 4 byte reserved ở cuối để tương thích định dạng
12 byte cũ. Tất cả số nhiều byte dùng little-endian:

| Offset payload | Kiểu | Nội dung |
| --- | --- | --- |
| 0–1 | `int16` | Nhiệt độ °C × 100 |
| 2–3 | `uint16` | Độ ẩm không khí % × 100 |
| 4–5 | `uint16` | Ánh sáng lux, tối đa 65535 |
| 6–7 | `uint16` | Độ ẩm đất % × 100 |
| 8–11 | optional | Reserved |

Ví dụ 27.50°C, 65%, 400 lux, 45.20%:

```text
Payload ESP:      be 0a 64 19 90 01 a8 11
BlueZ nhận: c1 f1 05 be 0a 64 19 90 01 a8 11
            opcode  |       payload
```

Khi gọi API publish của ESP-IDF, truyền **opcode riêng và payload riêng**, không
chèn opcode thêm vào payload. Pi kiểm tra opcode, chiều dài, AppKey index, địa chỉ
node đã cấu hình và miền phần trăm trước khi ghi SQLite. Gói mang opcode khác sẽ
bị bỏ qua. Dữ liệu từ element phụ cũng được gắn vào zone của node chính.

Firmware mẫu OnOff nguyên bản không có vendor model này, nên có thể provision
thành công nhưng sẽ báo thiếu model khi cấu hình. Không coi đó là lỗi Bluetooth.

## Lưu trạng thái và vận hành

- `ai_engine/mesh_state/network.json`: UUID Pi, attachment token, dải địa chỉ đã
  cấp và node đã provision; thư mục mode 0700, file mode 0600, ghi atomic + fsync.
- BlueZ tự lưu NetKey/AppKey/DeviceKey và dữ liệu mạng trong thư mục storage của
  daemon (thường `/var/lib/bluetooth/mesh`). Không ghi khóa/token vào status hoặc log.
- `ble_mesh.sock`: Unix socket điều khiển, mode 0660. File `.lock` ngăn chạy hai
  gateway trên cùng socket. File status chỉ phục vụ chẩn đoán.
- Sao lưu **cả trạng thái gateway và storage BlueZ khi dịch vụ đã dừng**. Không
  xóa một bên để “sửa lỗi”, không tái sử dụng bản backup cũ tùy tiện vì mesh có
  sequence number và chống replay. Không chạy hai Pi từ cùng bản sao danh tính.
- Các biến `DB_PATH`, `MESH_SOCKET_PATH` cần thống nhất giữa gateway và server.
  `MESH_STATE_DIR` đổi nơi lưu trạng thái Python.
- Xóa node trên dashboard chỉ xóa bản ghi/zone mapping trong database, **không
  reset ESP, không thu hồi khóa**. Gateway vẫn giữ dải địa chỉ và thông tin mạng.
  Chạy `configure UUID` có thể tạo lại bản ghi. Chưa có luồng Node Reset/key refresh.

Nếu dùng PM2, từ thư mục dự án:

```bash
pm2 start ai_engine/ble_mesh_gateway.py --name smart-plant-ble --interpreter /usr/bin/python3
pm2 logs smart-plant-ble --lines 100
```

Chỉ chạy một bản gateway: dừng tiến trình terminal trước khi chạy PM2. Script
deploy đã copy cả `ble_mesh_gateway.py` và `ble_mesh_protocol.py`.

## Nếu đã từng chạy gateway cũ

Code cũ không lưu số element/dải địa chỉ đầy đủ. Khi thấy `mesh_token.dat` hoặc
bản ghi BLE cũ nhưng chưa có `mesh_state/network.json`, gateway dừng với thông báo
`Legacy mesh state found`. Nó không tự tạo mạng đè lên danh tính cũ.

Nếu mạng cũ có node thật, cần kiểm kê/export mạng bằng công cụ BlueZ để biết token,
UUID, địa chỉ và số element từng node; đồng thời đối chiếu composition của Pi
với code mới trước khi migration. Không suy ra `next_address` bằng số lượng dòng
trong database. Nếu đó chỉ là dữ liệu thử nghiệm, sao lưu trước rồi thực hiện quy
trình reset mạng thử nghiệm và reset provisioning trên ESP một cách chủ động.
Không có lệnh xóa hàng loạt tự động trong gateway này.

## Chẩn đoán

```bash
journalctl -u bluetooth-mesh -n 100 --no-pager
/usr/bin/python3 ai_engine/ble_mesh_gateway.py status
```

- `org.bluez.mesh` không tồn tại: kiểm tra mesh daemon, không chỉ `bluetooth.service`.
- Không có kết quả scan: ESP phải ở trạng thái unprovisioned và bật PB-ADV. ESP đã
  thuộc mạng khác cần reset provisioning bằng firmware/quy trình của mạng đó.
- Daemon không lấy được adapter: kiểm tra log và cấu hình adapter của BlueZ;
  bluetoothd và mesh daemon có thể tranh quyền điều khiển cùng controller.
- `AccessDenied`: kiểm tra D-Bus policy đi kèm package BlueZ và quyền tài khoản.
- `configuration_failed`: xem trường `error`; kiểm tra model, publication context,
  nguồn điện ESP và thử `configure UUID`. Khởi động lại gateway nếu cấu hình Pi lỗi.
- Node `configured` nhưng chưa có dữ liệu: kiểm tra ESP thực sự publish đúng opcode,
  payload và AppKey; `active` chỉ xuất hiện khi đã ghi được reading cảm biến.

## Kiểm thử phần mềm

```bash
/usr/bin/python3 -m unittest discover -s ai_engine -p 'test_ble_mesh.py' -v
node --check server/routes/ble.js
node --test server/test/ble.test.js
npm --prefix client run build
```

Các kiểm thử mô phỏng phản hồi BlueZ/node; vẫn cần chạy Pi + ESP thật để kiểm chứng
adapter, provisioning qua sóng và dữ liệu cảm biến từ firmware của bạn.

Tài liệu đối chiếu:

- [BlueZ 5.66 Mesh D-Bus API](https://github.com/bluez/bluez/blob/5.66/doc/mesh-api.txt)
- [BlueZ Configuration Client](https://github.com/bluez/bluez/blob/5.66/tools/mesh/cfgcli.c)
- [Debian bluez-meshd](https://packages.debian.org/bookworm/bluez-meshd)
- [ESP-IDF BLE Mesh API](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/bluetooth/esp-ble-mesh.html)
