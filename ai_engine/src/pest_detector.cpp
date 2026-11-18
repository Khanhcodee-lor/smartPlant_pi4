#include "pest_detector.h"
#include "yolo_compat.h"
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <opencv2/videoio.hpp>
#include <iostream>
#include <fstream>
#include <vector>
#include <filesystem>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <ctime>
#include <stdexcept>

namespace fs = std::filesystem;

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

std::string remove_vietnamese_accents(const std::string& str) {
    std::string result = str;
    
    std::vector<std::pair<std::string, std::string>> mapping = {
        {"á", "a"}, {"à", "a"}, {"ả", "a"}, {"ã", "a"}, {"ạ", "a"},
        {"ă", "a"}, {"ắ", "a"}, {"ằ", "a"}, {"ẳ", "a"}, {"ẵ", "a"}, {"ặ", "a"},
        {"â", "a"}, {"ấ", "a"}, {"ầ", "a"}, {"ẩ", "a"}, {"ẫ", "a"}, {"ậ", "a"},
        {"é", "e"}, {"è", "e"}, {"ẻ", "e"}, {"ẽ", "e"}, {"ẹ", "e"},
        {"ê", "e"}, {"ế", "e"}, {"ề", "e"}, {"ể", "e"}, {"ễ", "e"}, {"ệ", "e"},
        {"í", "i"}, {"ì", "i"}, {"ỉ", "i"}, {"ĩ", "i"}, {"ị", "i"},
        {"ó", "o"}, {"ò", "o"}, {"ỏ", "o"}, {"õ", "o"}, {"ọ", "o"},
        {"ô", "o"}, {"ố", "o"}, {"ồ", "o"}, {"ổ", "o"}, {"ỗ", "o"}, {"ộ", "o"},
        {"ơ", "o"}, {"ớ", "o"}, {"ờ", "o"}, {"ở", "o"}, {"ỡ", "o"}, {"ợ", "o"},
        {"ú", "u"}, {"ù", "u"}, {"ủ", "u"}, {"ũ", "u"}, {"ụ", "u"},
        {"ư", "u"}, {"ứ", "u"}, {"ừ", "u"}, {"ử", "u"}, {"ữ", "u"}, {"ự", "u"},
        {"ý", "y"}, {"ỳ", "y"}, {"ỷ", "y"}, {"ỹ", "y"}, {"ỵ", "y"},
        {"đ", "d"},
        
        {"Á", "A"}, {"À", "A"}, {"Ả", "A"}, {"Ã", "A"}, {"Ạ", "A"},
        {"Ă", "A"}, {"Ắ", "A"}, {"Ằ", "A"}, {"Ẳ", "A"}, {"Ẵ", "A"}, {"Ặ", "A"},
        {"Â", "A"}, {"Ấ", "A"}, {"Ầ", "A"}, {"Ẩ", "A"}, {"Ẫ", "A"}, {"Ậ", "A"},
        {"É", "E"}, {"È", "E"}, {"Ẻ", "E"}, {"Ẽ", "E"}, {"Ẹ", "E"},
        {"Ê", "E"}, {"Ế", "E"}, {"Ề", "E"}, {"Ể", "E"}, {"Ễ", "E"}, {"Ệ", "E"},
        {"Í", "I"}, {"Ì", "I"}, {"Ỉ", "I"}, {"Ĩ", "I"}, {"Ị", "I"},
        {"Ó", "O"}, {"Ò", "O"}, {"Ỏ", "O"}, {"Õ", "O"}, {"Ọ", "O"},
        {"Ô", "O"}, {"Ố", "O"}, {"Ồ", "O"}, {"Ổ", "O"}, {"Ỗ", "O"}, {"Ộ", "O"},
        {"Ơ", "O"}, {"Ớ", "O"}, {"Ờ", "O"}, {"Ở", "O"}, {"Ỡ", "O"}, {"Ợ", "O"},
        {"Ú", "U"}, {"Ù", "U"}, {"Ủ", "U"}, {"Ũ", "U"}, {"Ụ", "U"},
        {"Ư", "U"}, {"Ứ", "U"}, {"Ừ", "U"}, {"Ử", "U"}, {"Ữ", "U"}, {"Ự", "U"},
        {"Ý", "Y"}, {"Ỳ", "Y"}, {"Ỷ", "Y"}, {"Ỹ", "Y"}, {"Ỵ", "Y"},
        {"Đ", "D"}
    };

    for (const auto& pair : mapping) {
        size_t pos = 0;
        while ((pos = result.find(pair.first, pos)) != std::string::npos) {
            result.replace(pos, pair.first.length(), pair.second);
            pos += pair.second.length();
        }
    }
    
    return result;
}

PestDetector::PestDetector(const std::string& model_path)
    : rng_(std::random_device{}())
{
    // Must follow the `names` metadata embedded in model/best.onnx.
    pest_database_ = {
        {"Cháy sớm (Early Blight)",         "medium",   "Đốm nâu vòng đồng tâm trên lá già"},
        {"Đốm lá Septoria",                  "medium",   "Nhiều đốm tròn nhỏ viền sẫm màu"},
        {"Đốm lá vi khuẩn (Bacterial Spot)", "high",     "Vết đốm sẫm màu trên lá"},
        {"Cây khỏe mạnh (Healthy)",          "low",      "Model nhận diện lá có vẻ khỏe mạnh"},
        {"Sương mai muộn (Late Blight)",    "critical", "Lá và thân bị ủng nước màu nâu đen, lây lan rất nhanh"},
        {"Mốc lá (Leaf Mold)",               "medium",   "Mặt trên lá vàng nhạt, mặt dưới có lớp mốc xám"},
        {"Virus khảm (Mosaic Virus)",        "critical", "Lá loang lổ xanh vàng, biến dạng méo mó"},
        {"Nhện đỏ (Spider Mites)",           "high",     "Mặt dưới lá có tơ mỏng và đốm vàng lấm chấm"},
        {"Đốm mắt cua (Target Spot)",        "medium",   "Vết bệnh hình tròn nhiều quầng đồng tâm"},
        {"Virus vàng lá (Yellow Virus)",     "critical", "Lá có thể vàng và biến dạng; cần kiểm tra thêm"}
    };

    if (const char* configured = std::getenv("YOLO_CONFIDENCE_THRESHOLD")) {
        char* end = nullptr;
        const float value = std::strtof(configured, &end);
        if (end != configured && *end == '\0' && std::isfinite(value) && value >= 0.0f && value <= 1.0f) {
            confidence_threshold_ = value;
        } else {
            std::cerr << "[AI] YOLO_CONFIDENCE_THRESHOLD không hợp lệ; dùng 0.35\n";
        }
    }

    std::vector<std::string> candidates = {
        model_path,
        "model/best.onnx",
        "ai_engine/model/best.onnx",
        "../ai_engine/model/best.onnx",
        "/home/toan/Smart_Plant/ai_engine/model/best.onnx",
        "/home/khanh/Workspace_company/pi_4/Smart_Plant/ai_engine/model/best.onnx"
    };

    std::string valid_path = "";
    for (const auto& p : candidates) {
        if (fs::exists(p)) {
            valid_path = p;
            break;
        }
    }

    if (valid_path.empty()) {
        valid_path = model_path;
    }

    try {
        net_ = cv::dnn::readNetFromONNX(valid_path);
        net_.setPreferableBackend(cv::dnn::DNN_BACKEND_OPENCV);
        net_.setPreferableTarget(cv::dnn::DNN_TARGET_CPU);
        model_loaded_ = true;
        std::cout << "[AI] ✅ Đã nạp thành công model YOLO từ " << valid_path << "\n";
    } catch (const std::exception& e) {
        std::cerr << "[AI] ❌ Lỗi không thể nạp model (" << valid_path << "): " << e.what() << "\n";
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

cv::Mat PestDetector::get_test_image() {
    std::vector<std::string> candidate_dirs = {
        "test_images",
        "ai_engine/test_images",
        "../ai_engine/test_images",
        "../test_images",
        "/home/toan/Smart_Plant/ai_engine/test_images"
    };

    std::vector<std::string> image_files;
    for (const auto& dir : candidate_dirs) {
        if (fs::exists(dir) && fs::is_directory(dir)) {
            for (const auto& entry : fs::directory_iterator(dir)) {
                if (entry.is_regular_file()) {
                    std::string ext = entry.path().extension().string();
                    for (auto& c : ext) c = tolower(c);
                    if (ext == ".jpg" || ext == ".jpeg" || ext == ".png" || ext == ".bmp") {
                        image_files.push_back(entry.path().string());
                    }
                }
            }
            if (!image_files.empty()) break;
        }
    }

    if (image_files.empty()) {
        return cv::Mat();
    }

    // Lấy ảnh tuần tự vòng tròn
    std::string selected_file = image_files[test_image_index_ % image_files.size()];
    test_image_index_++;
    std::cout << "[AI 📸] Đọc ảnh test: " << selected_file << "\n";
    return cv::imread(selected_file);
}

nlohmann::json PestDetector::detect_image(const std::string& image_path, int zone_id) {
    if (!model_loaded_) {
        throw std::runtime_error("Không nạp được model YOLO.");
    }
    if (!fs::exists(image_path)) {
        throw std::runtime_error("Không tìm thấy file ảnh: " + image_path);
    }
    cv::Mat frame = cv::imread(image_path);
    if (frame.empty()) {
        throw std::runtime_error("Không thể đọc ảnh: " + image_path);
    }
    std::cout << "[AI 🔍] Bắt đầu phân tích ảnh theo yêu cầu: " << image_path << "\n";
    return detect_mat(frame, zone_id, true); // include base64 for on-demand UI
}

nlohmann::json PestDetector::detect(int zone_id) {
    // 1. Kiểm tra model
    if (!model_loaded_) {
        return nullptr;
    }

    // 2. Lấy frame từ Camera hoặc từ thư mục test_images/
    cv::Mat frame;
    cv::VideoCapture cap;

    // Ưu tiên đọc từ ustreamer snapshot (chạy ở port 8080)
    // Dùng snapshot endpoint vì nó cho phép đọc 1 frame an toàn mà không giữ kết nối lâu
    cap.open("http://127.0.0.1:8080/snapshot");
    if (!cap.isOpened() || !cap.read(frame) || frame.empty()) {
        std::cout << "[AI] ustreamer không chạy, thử mở /dev/video0 trực tiếp...\n";
        // Fallback: Mở thiết bị /dev/video0
        cap.open(0);
        if (cap.isOpened()) {
            cap >> frame;
        }
    }

    if (frame.empty()) {
        // Thử lấy ảnh từ thư mục test_images/
        frame = get_test_image();
    }

    if (frame.empty()) {
        return nullptr;
    }

    return detect_mat(frame, zone_id, false); // NO base64 for periodic POST (avoid PayloadTooLarge)
}

nlohmann::json PestDetector::detect_mat(cv::Mat& frame, int zone_id, bool include_b64) {
    if (!model_loaded_ || frame.empty()) {
        return nullptr;
    }

    // A disconnected or severely overexposed camera can produce an almost
    // uniform frame. The model may still assign it a confident "healthy"
    // label, even though there is no visible leaf to evaluate.
    cv::Scalar mean, deviation;
    cv::meanStdDev(frame, mean, deviation);
    if (std::max({deviation[0], deviation[1], deviation[2]}) < 2.0) {
        std::cout << "[AI] Ảnh gần như không có chi tiết; không thể đánh giá.\n";
        return nullptr;
    }

    // Match the model's fixed 640x640 letterbox preprocessing without stretching
    // webcam frames. Retain the padding and scale to map boxes back to the photo.
    constexpr int input_size = 640;
    const float scale = std::min(input_size / static_cast<float>(frame.cols),
                                 input_size / static_cast<float>(frame.rows));
    const int resized_width = std::max(1, static_cast<int>(std::round(frame.cols * scale)));
    const int resized_height = std::max(1, static_cast<int>(std::round(frame.rows * scale)));
    const int pad_left = (input_size - resized_width) / 2;
    const int pad_top = (input_size - resized_height) / 2;
    cv::Mat resized, letterboxed;
    cv::resize(frame, resized, cv::Size(resized_width, resized_height));
    cv::copyMakeBorder(resized, letterboxed, pad_top, input_size - resized_height - pad_top,
                       pad_left, input_size - resized_width - pad_left,
                       cv::BORDER_CONSTANT, cv::Scalar(114, 114, 114));
    cv::Mat blob;
    cv::dnn::blobFromImage(letterboxed, blob, 1.0 / 255.0, cv::Size(), cv::Scalar(), true, false);
    net_.setInput(blob);

    // 4. Chạy dự đoán (Forward)
    std::vector<cv::Mat> outputs;
    try {
        net_.forward(outputs, net_.getUnconnectedOutLayersNames());
    } catch (const cv::Exception& error) {
        std::cerr << "[AI] OpenCV không chạy được đầu ra model; thử chế độ tương thích: "
                  << error.what() << "\n";
        outputs = {forward_yolo_compat(net_, blob, confidence_threshold_)};
    }

    // 5. Parse output YOLOv8 (Output shape: [1, classes + 4, 8400])
    if (outputs.empty() || outputs[0].dims != 3 || outputs[0].type() != CV_32F ||
        outputs[0].size[0] != 1 || outputs[0].size[1] != static_cast<int>(pest_database_.size()) + 4) {
        throw std::runtime_error("Model trả về dữ liệu nhận diện không đúng định dạng.");
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

    for (int i = 0; i < rows; ++i) {
        float* classes_scores = data + 4;
        cv::Mat scores(1, pest_database_.size(), CV_32F, classes_scores);
        cv::Point class_id;
        double max_class_score;
        cv::minMaxLoc(scores, 0, &max_class_score, 0, &class_id);

        if (max_class_score >= confidence_threshold_) {
            float x = data[0];
            float y = data[1];
            float w = data[2];
            float h = data[3];
            int left = static_cast<int>((x - 0.5f * w - pad_left) / scale);
            int top = static_cast<int>((y - 0.5f * h - pad_top) / scale);
            int right = static_cast<int>((x + 0.5f * w - pad_left) / scale);
            int bottom = static_cast<int>((y + 0.5f * h - pad_top) / scale);
            left = std::clamp(left, 0, frame.cols);
            right = std::clamp(right, 0, frame.cols);
            top = std::clamp(top, 0, frame.rows);
            bottom = std::clamp(bottom, 0, frame.rows);
            if (right > left && bottom > top) {
                confidences.push_back(static_cast<float>(max_class_score));
                class_ids.push_back(class_id.x);
                boxes.emplace_back(left, top, right - left, bottom - top);
            }
        }
        data += dimensions;
    }

    // NMS (Non-Maximum Suppression)
    std::vector<int> indices;
    cv::dnn::NMSBoxes(boxes, confidences, confidence_threshold_, 0.4f, indices);

    if (indices.empty()) {
        std::cout << "[AI] Không có nhận diện vượt ngưỡng tin cậy.\n";
        return nullptr;
    }

    // 6. Vẽ Bounding Box cho tất cả các đối tượng phát hiện được
    constexpr int healthy_class_id = 3;
    int best_class_id = healthy_class_id;
    float best_conf = 0.0f;
    bool found_disease = false;

    for (int idx : indices) {
        cv::Rect box = boxes[idx];
        int class_id = class_ids[idx];
        float conf = confidences[idx];
        
        if (class_id >= (int)pest_database_.size()) class_id = 0;
        
        const bool is_disease = class_id != healthy_class_id;
        if ((is_disease && !found_disease) || (is_disease == found_disease && conf > best_conf)) {
            best_conf = conf;
            best_class_id = class_id;
            found_disease = is_disease;
        }

        auto pest = pest_database_[class_id];

        // Vẽ khung bounding box đỏ
        cv::rectangle(frame, box, cv::Scalar(0, 0, 255), 3);
        
        // OpenCV putText không hỗ trợ tiếng Việt có dấu.
        // Ta sẽ chuyển đổi tiếng Việt có dấu thành không dấu để vẽ lên ảnh.
        std::string ascii_name = remove_vietnamese_accents(pest.name);

        std::string label = ascii_name + " (" + std::to_string(int(conf * 100)) + "%)";
        draw_label(frame, label, box.x, box.y);
    }

    auto main_pest = pest_database_[best_class_id];
    std::string notes = main_pest.notes;
    if (best_conf < 0.60f) {
        notes += ". Độ tin cậy còn thấp; hãy chụp rõ hơn và kiểm tra lại";
    }

    // Tạo tên file ảnh duy nhất theo timestamp
    auto now = std::chrono::system_clock::now();
    auto time_t_now = std::chrono::system_clock::to_time_t(now);
    auto tm_now = std::localtime(&time_t_now);
    char ts_buf[64];
    std::strftime(ts_buf, sizeof(ts_buf), "%Y%m%d_%H%M%S", tm_now);
    std::string unique_filename = std::string("detection_") + ts_buf + ".jpg";

    // Tìm thư mục public/ của Web Server để lưu ảnh
    std::vector<std::string> public_dirs = {
        "../server/public",
        "server/public",
        "public",
        "/home/toan/Smart_Plant/server/public"
    };
    std::string image_url = "/latest_detection.jpg"; // fallback
    for (const auto& dir : public_dirs) {
        if (fs::exists(dir)) {
            // Lưu ảnh với tên duy nhất (cho lịch sử)
            cv::imwrite(dir + "/" + unique_filename, frame);
            // Cũng ghi đè latest_detection.jpg (cho live view)
            cv::imwrite(dir + "/latest_detection.jpg", frame);
            image_url = "/" + unique_filename;
            break;
        }
    }

    nlohmann::json result = {
        {"pest_type",  main_pest.name},
        {"confidence", std::round(best_conf * 100.0) / 100.0},
        {"zone_id",    zone_id},
        {"severity",   main_pest.severity},
        {"notes",      notes},
        {"image_path", image_url}
    };

    // Chỉ đính kèm base64 khi được yêu cầu (on-demand mode từ UI)
    // Periodic mode không cần base64 vì ảnh đã lưu file rồi, tránh PayloadTooLarge
    if (include_b64) {
        std::string b64_img = mat_to_base64(frame);
        result["image_b64"] = "data:image/jpeg;base64," + b64_img;
    }

    return result;
}

