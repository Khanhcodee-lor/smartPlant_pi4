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
