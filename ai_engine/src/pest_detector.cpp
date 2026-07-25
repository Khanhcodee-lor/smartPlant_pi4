#include "pest_detector.h"

PestDetector::PestDetector()
    : rng_(std::random_device{}())
{
    // Database các loại sâu bệnh thường gặp ở Việt Nam
    pest_database_ = {
        {"Rệp xanh",         "medium",   "Phát hiện rệp xanh trên mặt dưới lá"},
        {"Sâu tơ",           "high",     "Sâu tơ đang ăn lá, cần xử lý ngay"},
        {"Bọ trĩ",           "critical", "Bọ trĩ mật độ cao trên hoa và chồi non"},
        {"Sâu xanh da láng", "medium",   "Sâu xanh ăn lá, số lượng vừa phải"},
        {"Bệnh phấn trắng",  "low",      "Đốm trắng nhẹ trên bề mặt lá"},
        {"Bệnh sương mai",   "medium",   "Vết bệnh sương mai trên lá, cần theo dõi"},
        {"Nhện đỏ",          "high",     "Nhện đỏ trên mặt dưới lá, lá vàng úa"},
        {"Bệnh thán thư",    "high",     "Vết đốm nâu trên quả, cần xử lý sớm"},
        {"Sâu đục thân",     "critical", "Phát hiện lỗ đục trên thân cây"},
        {"Bệnh héo xanh",    "critical", "Cây héo đột ngột, nghi ngờ vi khuẩn"}
    };
}

void PestDetector::set_detection_probability(double prob) {
    detection_probability_ = std::clamp(prob, 0.0, 1.0);
}

nlohmann::json PestDetector::detect(int zone_id) {
    std::uniform_real_distribution<double> chance(0.0, 1.0);

    // Không phải lúc nào cũng phát hiện sâu bệnh
    if (chance(rng_) > detection_probability_) {
        return nullptr; // Không phát hiện gì
    }

    // Chọn ngẫu nhiên một loại sâu bệnh
    std::uniform_int_distribution<int> pest_index(0, static_cast<int>(pest_database_.size()) - 1);
    const auto& pest = pest_database_[pest_index(rng_)];

    // Confidence từ 0.65 đến 0.98
    std::uniform_real_distribution<double> conf(0.65, 0.98);
    double confidence = std::round(conf(rng_) * 100.0) / 100.0;

    return {
        {"pest_type",  pest.name},
        {"confidence", confidence},
        {"zone_id",    zone_id},
        {"severity",   pest.severity},
        {"notes",      pest.notes}
    };
}
