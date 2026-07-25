#pragma once

#include <nlohmann/json.hpp>
#include <random>
#include <string>
#include <vector>

/**
 * Giả lập phát hiện sâu bệnh
 * Trong thực tế sẽ thay bằng model AI (TFLite, ONNX, v.v.)
 */
class PestDetector {
public:
    PestDetector();

    /**
     * Chạy phát hiện sâu bệnh (giả lập)
     * @param zone_id ID khu vực
     * @return JSON object chứa pest_type, confidence, severity, notes
     *         Hoặc null nếu không phát hiện gì
     */
    nlohmann::json detect(int zone_id);

    /**
     * Xác suất phát hiện sâu bệnh mỗi lần chạy (0.0 - 1.0)
     * Mặc định 30% — không phải lúc nào cũng phát hiện
     */
    void set_detection_probability(double prob);

private:
    std::mt19937 rng_;
    double detection_probability_ = 0.3;

    struct PestInfo {
        std::string name;
        std::string severity;
        std::string notes;
    };

    std::vector<PestInfo> pest_database_;
};
