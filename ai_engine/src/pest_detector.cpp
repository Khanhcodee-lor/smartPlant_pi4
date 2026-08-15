#include "pest_detector.h"
#include <iostream>
#include <fstream>
#include <vector>

// Hàm mã hóa base64 (đơn giản)
static const std::string base64_chars = 
             "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
             "abcdefghijklmnopqrstuvwxyz"
             "0123456789+/";

std::string PestDetector::mat_to_base64(const cv::Mat& img) {
    std::vector<uchar> buf;
    cv::imencode(".jpg", img, buf);
    std::string ret;
    int i = 0;
    int j = 0;
    unsigned char char_array_3[3];
    unsigned char char_array_4[4];
    auto bytes_to_encode = buf.data();
    size_t in_len = buf.size();

    while (in_len--) {
        char_array_3[i++] = *(bytes_to_encode++);
        if (i == 3) {
            char_array_4[0] = (char_array_3[0] & 0xfc) >> 2;
            char_array_4[1] = ((char_array_3[0] & 0x03) << 4) + ((char_array_3[1] & 0xf0) >> 4);
            char_array_4[2] = ((char_array_3[1] & 0x0f) << 2) + ((char_array_3[2] & 0xc0) >> 6);
            char_array_4[3] = char_array_3[2] & 0x3f;
            for(i = 0; (i <4) ; i++)
                ret += base64_chars[char_array_4[i]];
            i = 0;
        }
    }
    if (i) {
        for(j = i; j < 3; j++) char_array_3[j] = '\0';
        char_array_4[0] = (char_array_3[0] & 0xfc) >> 2;
        char_array_4[1] = ((char_array_3[0] & 0x03) << 4) + ((char_array_3[1] & 0xf0) >> 4);
        char_array_4[2] = ((char_array_3[1] & 0x0f) << 2) + ((char_array_3[2] & 0xc0) >> 6);
        for (j = 0; (j < i + 1); j++) ret += base64_chars[char_array_4[j]];
        while((i++ < 3)) ret += '=';
    }
    return ret;
}

PestDetector::PestDetector(const std::string& model_path)
    : rng_(std::random_device{}())
{
    pest_database_ = {
        {"Rệp xanh",         "medium",   "Phát hiện rệp xanh"},
        {"Sâu tơ",           "high",     "Sâu tơ đang ăn lá"},
        {"Bọ trĩ",           "critical", "Bọ trĩ mật độ cao"},
        {"Bệnh phấn trắng",  "low",      "Đốm trắng nhẹ"},
        {"Bệnh thán thư",    "high",     "Vết đốm nâu trên quả"}
    };

    try {
        net_ = cv::dnn::readNetFromONNX(model_path);
        // Thiết lập chạy trên CPU (hoặc có thể dùng NPU/OpenCL nếu Pi có hỗ trợ)
        net_.setPreferableBackend(cv::dnn::DNN_BACKEND_OPENCV);
        net_.setPreferableTarget(cv::dnn::DNN_TARGET_CPU);
        model_loaded_ = true;
        std::cout << "[AI] Đã nạp thành công model YOLO từ " << model_path << "\n";
    } catch (const std::exception& e) {
        std::cerr << "[AI] Lỗi không thể nạp model: " << e.what() << "\n";
        model_loaded_ = false;
    }
}

void PestDetector::set_detection_probability(double prob) {
    detection_probability_ = std::clamp(prob, 0.0, 1.0);
}

void PestDetector::draw_label(cv::Mat& input_image, const std::string& label, int left, int top) {
    int baseLine;
    cv::Size label_size = cv::getTextSize(label, cv::FONT_HERSHEY_SIMPLEX, 0.5, 1, &baseLine);
    top = std::max(top, label_size.height);
    cv::rectangle(input_image, cv::Point(left, top - round(1.5 * label_size.height)),
                  cv::Point(left + round(1.5 * label_size.width), top + baseLine),
                  cv::Scalar(255, 255, 255), cv::FILLED);
    cv::putText(input_image, label, cv::Point(left, top), cv::FONT_HERSHEY_SIMPLEX, 0.5, cv::Scalar(0,0,0), 1);
}

nlohmann::json PestDetector::detect(int zone_id) {
    // 1. Nếu không có model, không làm gì cả thay vì gửi dữ liệu giả
    if (!model_loaded_) {
        return nullptr;
    }

    // 2. Chụp ảnh từ camera (id 0)
    cv::VideoCapture cap(0);
    cv::Mat frame;
    if (!cap.isOpened()) {
        std::cerr << "[AI] Không tìm thấy camera\n";
        return nullptr; // Bỏ qua nếu không có camera thay vì dùng ảnh giả
    }
    
    cap >> frame;

    if (frame.empty()) return nullptr;

    // 3. Chuẩn bị ảnh cho YOLOv8 (resize 640x640)
    cv::Mat blob;
    cv::dnn::blobFromImage(frame, blob, 1.0 / 255.0, cv::Size(640, 640), cv::Scalar(), true, false);
    net_.setInput(blob);

    // 4. Chạy dự đoán (Forward)
    std::vector<cv::Mat> outputs;
    net_.forward(outputs, net_.getUnconnectedOutLayersNames());

    // 5. Parse output YOLOv8 (Output shape: [1, classes + 4, 8400])
    // Tuỳ vào bản YOLO mà format output có thể khác (v5 vs v8)
    // Code dưới đây giả định YOLOv8 ONNX chuẩn (transpose 1x84x8400 -> 8400x84)
    if (outputs.size() == 0 || outputs[0].dims != 3) {
        return nullptr;
    }
    
    cv::Mat out = outputs[0];
    int dimensions = out.size[1]; 
    int rows = out.size[2];
    
    cv::Mat out_transposed;
    cv::transpose(cv::Mat(dimensions, rows, CV_32F, out.ptr<float>()), out_transposed);

    std::vector<int> class_ids;
    std::vector<float> confidences;
    std::vector<cv::Rect> boxes;
    float* data = (float*)out_transposed.data;

    float x_factor = frame.cols / 640.0f;
    float y_factor = frame.rows / 640.0f;

    for (int i = 0; i < rows; ++i) {
        float* classes_scores = data + 4;
        cv::Mat scores(1, pest_database_.size(), CV_32F, classes_scores);
        cv::Point class_id;
        double max_class_score;
        cv::minMaxLoc(scores, 0, &max_class_score, 0, &class_id);

        if (max_class_score > 0.45) {
            confidences.push_back(max_class_score);
            class_ids.push_back(class_id.x);

            float x = data[0];
            float y = data[1];
            float w = data[2];
            float h = data[3];
            int left = int((x - 0.5 * w) * x_factor);
            int top = int((y - 0.5 * h) * y_factor);
            int width = int(w * x_factor);
            int height = int(h * y_factor);
            boxes.push_back(cv::Rect(left, top, width, height));
        }
        data += dimensions;
    }

    // NMS (Non-Maximum Suppression)
    std::vector<int> indices;
    cv::dnn::NMSBoxes(boxes, confidences, 0.45, 0.4, indices);

    if (indices.empty()) {
        return nullptr; // Không phát hiện gì
    }

    // 6. Vẽ Bounding Box cho đối tượng tốt nhất
    int idx = indices[0];
    cv::Rect box = boxes[idx];
    int class_id = class_ids[idx];
    float conf = confidences[idx];
    
    // Đảm bảo không vượt quá kích thước mảng database
    if (class_id >= (int)pest_database_.size()) class_id = 0;
    auto pest = pest_database_[class_id];

    cv::rectangle(frame, box, cv::Scalar(0, 0, 255), 3); // Khung màu đỏ
    std::string label = pest.name + ":" + std::to_string(conf).substr(0, 4);
    draw_label(frame, label, box.x, box.y);

    // Lưu file để có thể hiển thị web (nếu cần)
    cv::imwrite("../server/public/latest_detection.jpg", frame);

    // Chuyển frame thành base64 để server có thể tuỳ chọn gửi lên FE
    std::string b64_img = mat_to_base64(frame);

    return {
        {"pest_type",  pest.name},
        {"confidence", std::round(conf * 100.0) / 100.0},
        {"zone_id",    zone_id},
        {"severity",   pest.severity},
        {"notes",      pest.notes},
        {"image_path", "/latest_detection.jpg"},
        {"image_b64",  "data:image/jpeg;base64," + b64_img}
    };
}
