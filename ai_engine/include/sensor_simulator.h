#pragma once

#include <nlohmann/json.hpp>
#include <random>
#include <chrono>

/**
 * Giả lập dữ liệu cảm biến
 * Sinh dữ liệu realistic theo thời gian trong ngày
 */
class SensorSimulator {
public:
    SensorSimulator();

    /**
     * Đọc dữ liệu cảm biến (giả lập)
     * @param zone_id ID khu vực (1-4)
     * @return JSON object chứa temperature, humidity, light, soil_moisture
     */
    nlohmann::json read_sensors(int zone_id);

private:
    std::mt19937 rng_;

    // Sinh giá trị cảm biến realistic
    double simulate_temperature();
    double simulate_humidity();
    double simulate_light();
    double simulate_soil_moisture();

    // Lấy giờ hiện tại (0-23)
    int current_hour();
};
