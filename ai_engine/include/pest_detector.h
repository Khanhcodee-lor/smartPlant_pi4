#pragma once

#include <nlohmann/json.hpp>
#include <random>
#include <string>
#include <vector>
#include <opencv2/opencv.hpp>
#include <opencv2/dnn.hpp>

/**
 * Phát hiện sâu bệnh sử dụng mô hình YOLO (ONNX) qua OpenCV DNN
 */
class PestDetector {
public:
    PestDetector(const std::string& model_path = "model/best.onnx");

    /**
     * Chạy phát hiện sâu bệnh bằng camera
     * @param zone_id ID khu vực
     * @return JSON object chứa danh sách phát hiện và ảnh base64 có vẽ bounding box
     */
    nlohmann::json detect(int zone_id);

    void set_detection_probability(double prob);

private:
    std::mt19937 rng_;
    double detection_probability_ = 0.3;
    
    cv::dnn::Net net_;
    bool model_loaded_ = false;

    struct PestInfo {
        std::string name;
        std::string severity;
        std::string notes;
    };

    std::vector<PestInfo> pest_database_;
    
    // Hàm phụ trợ YOLOv8
    void draw_label(cv::Mat& input_image, const std::string& label, int left, int top);
    std::string mat_to_base64(const cv::Mat& img);
};
