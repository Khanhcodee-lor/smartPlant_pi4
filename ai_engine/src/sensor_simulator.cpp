#include "sensor_simulator.h"
#include <cmath>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

SensorSimulator::SensorSimulator()
    : rng_(std::random_device{}())
{
}

int SensorSimulator::current_hour() {
    auto now = std::chrono::system_clock::now();
    auto time_t_now = std::chrono::system_clock::to_time_t(now);
    auto tm_now = std::localtime(&time_t_now);
    return tm_now->tm_hour;
}

double SensorSimulator::simulate_temperature() {
    int hour = current_hour();
    std::normal_distribution<double> noise(0.0, 1.0);

    // Ban ngày (6h-18h): 28-35°C, ban đêm: 20-24°C
    double base;
    if (hour >= 6 && hour <= 18) {
        base = 28.0 + std::sin(static_cast<double>(hour - 6) / 12.0 * M_PI) * 7.0;
    } else {
        base = 22.0 + noise(rng_) * 1.0;
    }

    return std::round((base + noise(rng_) * 0.5) * 10.0) / 10.0;
}

double SensorSimulator::simulate_humidity() {
    int hour = current_hour();
    std::normal_distribution<double> noise(0.0, 2.0);

    // Ban ngày ẩm thấp hơn (50-65%), sáng/tối cao hơn (70-90%)
    double base;
    if (hour >= 10 && hour <= 16) {
        base = 55.0 + noise(rng_) * 3.0;
    } else {
        base = 78.0 + noise(rng_) * 4.0;
    }

    return std::clamp(std::round(base * 10.0) / 10.0, 20.0, 99.0);
}

double SensorSimulator::simulate_light() {
    int hour = current_hour();
    std::normal_distribution<double> noise(0.0, 2000.0);

    // Ban đêm ~0, đỉnh trưa ~80000 lux
    double base;
    if (hour >= 6 && hour <= 18) {
        base = std::sin(static_cast<double>(hour - 6) / 12.0 * M_PI) * 80000.0;
    } else {
        base = 0.0;
    }

    return std::max(0.0, std::round(base + noise(rng_)));
}

double SensorSimulator::simulate_soil_moisture() {
    std::normal_distribution<double> noise(0.0, 3.0);

    // Dao động quanh 50-70%
    double base = 60.0 + noise(rng_) * 5.0;
    return std::clamp(std::round(base * 10.0) / 10.0, 15.0, 95.0);
}

nlohmann::json SensorSimulator::read_sensors(int zone_id) {
    return {
        {"temperature",   simulate_temperature()},
        {"humidity",      simulate_humidity()},
        {"light",         simulate_light()},
        {"soil_moisture", simulate_soil_moisture()},
        {"zone_id",       zone_id}
    };
}
