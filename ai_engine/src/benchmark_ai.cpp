#include <iostream>
#include <iomanip>
#include <vector>
#include <string>
#include <chrono>
#include <numeric>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <unistd.h>
#include <opencv2/opencv.hpp>
#include <opencv2/dnn.hpp>

namespace fs = std::filesystem;

// Đọc dung lượng RAM (VmRSS) tính bằng MB từ /proc/self/status
double get_ram_usage_mb() {
    std::ifstream status("/proc/self/status");
    std::string line;
    while (std::getline(status, line)) {
        if (line.rfind("VmRSS:", 0) == 0) {
            long kb = 0;
            sscanf(line.c_str(), "VmRSS: %ld kB", &kb);
            return kb / 1024.0;
        }
    }
    return 0.0;
}

// Đọc nhiệt độ CPU tính bằng độ C
double get_cpu_temp() {
    std::ifstream temp_file("/sys/class/thermal/thermal_zone0/temp");
    long millidegrees = 0;
    if (temp_file >> millidegrees) {
        return millidegrees / 1000.0;
    }
    return 0.0;
}

// Cấu trúc đo thời gian CPU (user + system)
struct CpuTime {
    unsigned long long utime;
    unsigned long long stime;
};

CpuTime get_process_cpu_time() {
    std::ifstream stat("/proc/self/stat");
    std::string ignore;
    CpuTime ct = {0, 0};
    for (int i = 1; i <= 13; ++i) stat >> ignore;
    stat >> ct.utime >> ct.stime;
    return ct;
}

struct Stats {
    double mean;
    double stddev;
    double min_val;
    double max_val;
};

Stats compute_stats(const std::vector<double>& v) {
    if (v.empty()) return {0, 0, 0, 0};
    double sum = std::accumulate(v.begin(), v.end(), 0.0);
    double mean = sum / v.size();
    double sq_sum = 0.0;
    double min_v = v[0];
    double max_v = v[0];
    for (double x : v) {
        sq_sum += (x - mean) * (x - mean);
        if (x < min_v) min_v = x;
        if (x > max_v) max_v = x;
    }
    double stddev = std::sqrt(sq_sum / v.size());
    return {mean, stddev, min_v, max_v};
}

int main(int argc, char** argv) {
    std::string model_path = "/home/toan/Smart_Plant/ai_engine/model/best.onnx";
    std::string test_dir = "/home/toan/Smart_Plant/ai_engine/test_images";
    int num_runs = 50;
    if (argc > 1) num_runs = std::stoi(argv[1]);

    std::cout << "========================================================\n";
    std::cout << "   BENCHMARK YOLOv8 EDGE AI TREN RASPBERRY PI 4\n";
    std::cout << "========================================================\n";
    std::cout << "Mo hinh           : " << model_path << "\n";
    std::cout << "Thu muc anh test  : " << test_dir << "\n";
    std::cout << "So lan lap do     : " << num_runs << " lan\n";

    // 1. Kiem tra kich thuoc file model
    if (!fs::exists(model_path)) {
        std::cerr << "Khong tim thay model tai " << model_path << "\n";
        return 1;
    }
    double model_size_mb = fs::file_size(model_path) / (1024.0 * 1024.0);
    std::cout << "Dung luong model  : " << std::fixed << std::setprecision(2) << model_size_mb << " MB\n";

    // 2. Nap model ONNX vao OpenCV DNN
    std::cout << "Dang nap mo hinh vao OpenCV DNN...\n";
    double ram_before = get_ram_usage_mb();
    double temp_before = get_cpu_temp();

    cv::dnn::Net net = cv::dnn::readNetFromONNX(model_path);
    if (net.empty()) {
        std::cerr << "Khong the load mo hinh ONNX!\n";
        return 1;
    }
    net.setPreferableBackend(cv::dnn::DNN_BACKEND_OPENCV);
    net.setPreferableTarget(cv::dnn::DNN_TARGET_CPU);

    double ram_after_load = get_ram_usage_mb();
    std::cout << "Nap model thanh cong! RAM nap model: " << (ram_after_load - ram_before) << " MB\n";

    // 3. Tai danh sach anh test
    std::vector<cv::Mat> images;
    if (fs::exists(test_dir)) {
        for (const auto& entry : fs::directory_iterator(test_dir)) {
            if (entry.path().extension() == ".jpg" || entry.path().extension() == ".png") {
                cv::Mat img = cv::imread(entry.path().string());
                if (!img.empty()) {
                    images.push_back(img);
                }
            }
        }
    }

    if (images.empty()) {
        std::cout << "Tao anh mau 640x480 de benchmark\n";
        images.push_back(cv::Mat(480, 640, CV_8UC3, cv::Scalar(100, 150, 100)));
    } else {
        std::cout << "Da tai " << images.size() << " anh mau tu thu muc test.\n";
    }

    // 4. Warm-up (Khoi dong bo nho dem CPU)
    std::cout << "Dang Warm-up 5 lan suy luan...\n";
    for (int i = 0; i < 5; ++i) {
        cv::Mat& sample = images[i % images.size()];
        cv::Mat blob;
        cv::dnn::blobFromImage(sample, blob, 1.0 / 255.0, cv::Size(640, 640), cv::Scalar(), true, false);
        net.setInput(blob);
        std::vector<cv::Mat> outputs;
        net.forward(outputs, net.getUnconnectedOutLayersNames());
    }
    std::cout << "Hoan tat Warm-up!\n\n";

    // 5. Chay Benchmark chinh thuc
    std::cout << "Bat dau do kiem " << num_runs << " lan suy luan...\n";
    std::vector<double> pre_times;
    std::vector<double> infer_times;
    std::vector<double> post_times;
    std::vector<double> total_times;

    auto benchmark_start = std::chrono::high_resolution_clock::now();
    CpuTime cpu_start = get_process_cpu_time();

    double peak_ram = get_ram_usage_mb();

    for (int i = 0; i < num_runs; ++i) {
        cv::Mat& frame = images[i % images.size()];

        // Phase 1: Preprocessing
        auto t1 = std::chrono::high_resolution_clock::now();
        cv::Mat blob;
        cv::dnn::blobFromImage(frame, blob, 1.0 / 255.0, cv::Size(640, 640), cv::Scalar(), true, false);
        net.setInput(blob);
        auto t2 = std::chrono::high_resolution_clock::now();

        // Phase 2: Model Inference
        std::vector<cv::Mat> outputs;
        net.forward(outputs, net.getUnconnectedOutLayersNames());
        auto t3 = std::chrono::high_resolution_clock::now();

        // Phase 3: Postprocessing & NMS
        if (!outputs.empty() && outputs[0].dims == 3) {
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

            for (int r = 0; r < rows; ++r) {
                float* classes_scores = data + 4;
                cv::Mat scores(1, 10, CV_32F, classes_scores);
                cv::Point class_id;
                double max_class_score;
                cv::minMaxLoc(scores, 0, &max_class_score, 0, &class_id);

                if (max_class_score > 0.50) {
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

            std::vector<int> indices;
            cv::dnn::NMSBoxes(boxes, confidences, 0.50, 0.40, indices);
        }
        auto t4 = std::chrono::high_resolution_clock::now();

        double d_pre = std::chrono::duration<double, std::milli>(t2 - t1).count();
        double d_inf = std::chrono::duration<double, std::milli>(t3 - t2).count();
        double d_post = std::chrono::duration<double, std::milli>(t4 - t3).count();
        double d_total = std::chrono::duration<double, std::milli>(t4 - t1).count();

        pre_times.push_back(d_pre);
        infer_times.push_back(d_inf);
        post_times.push_back(d_post);
        total_times.push_back(d_total);

        double cur_ram = get_ram_usage_mb();
        if (cur_ram > peak_ram) peak_ram = cur_ram;

        if ((i + 1) % 10 == 0 || i == num_runs - 1) {
            std::cout << "   -> Da xu ly: " << (i + 1) << "/" << num_runs 
                      << " anh | Lan gan nhat: " << std::fixed << std::setprecision(1) << d_total << " ms\n";
        }
    }

    auto benchmark_end = std::chrono::high_resolution_clock::now();
    CpuTime cpu_end = get_process_cpu_time();
    double temp_after = get_cpu_temp();

    double wall_time_sec = std::chrono::duration<double>(benchmark_end - benchmark_start).count();
    long clock_ticks_per_sec = sysconf(_SC_CLK_TCK);
    double total_cpu_time_sec = ((cpu_end.utime - cpu_start.utime) + (cpu_end.stime - cpu_start.stime)) / (double)clock_ticks_per_sec;
    double avg_cpu_percent = (total_cpu_time_sec / wall_time_sec) * 100.0;

    Stats s_pre = compute_stats(pre_times);
    Stats s_inf = compute_stats(infer_times);
    Stats s_post = compute_stats(post_times);
    Stats s_total = compute_stats(total_times);

    double fps = 1000.0 / s_total.mean;

    // Cong suat tieu thu cua Pi 4 khi full load AI la ~6.0 W (datasheet Pi 4 4-core Cortex-A72 @ 1.5GHz)
    double p_watts = 6.0; 
    double energy_per_infer_j = p_watts * (s_total.mean / 1000.0);

    std::cout << "\n========================================================\n";
    std::cout << "                  KET QUA THUC NGHIEM CHI TIET\n";
    std::cout << "========================================================\n";
    std::cout << "1. THOI GIAN VA TOC DO:\n";
    std::cout << "   - Tien xu ly (Preprocessing)   : " << s_pre.mean << " +/- " << s_pre.stddev << " ms (Min: " << s_pre.min_val << ", Max: " << s_pre.max_val << ")\n";
    std::cout << "   - Suy luan no-ron (Inference)  : " << s_inf.mean << " +/- " << s_inf.stddev << " ms (Min: " << s_inf.min_val << ", Max: " << s_inf.max_val << ")\n";
    std::cout << "   - Hau xu ly & NMS (Postprocess): " << s_post.mean << " +/- " << s_post.stddev << " ms (Min: " << s_post.min_val << ", Max: " << s_post.max_val << ")\n";
    std::cout << "   -----------------------------------------------------\n";
    std::cout << "   * Thoi gian suy luan trung binh [T] : " << s_total.mean << " ms/anh (" << s_total.mean << " +/- " << s_total.stddev << " ms)\n";
    std::cout << "   * Toc do xu ly khung hinh   [F] : " << fps << " FPS\n";
    std::cout << "\n2. TAI NGUYEN PHAN CUNG:\n";
    std::cout << "   * Muc su dung CPU trung binh [C] : " << avg_cpu_percent << " %\n";
    std::cout << "   * Muc su dung RAM thuc te    [R] : " << peak_ram << " MB\n";
    std::cout << "   * Nhiet do CPU (Truoc / Sau)     : " << temp_before << " oC / " << temp_after << " oC\n";
    std::cout << "\n3. THONG SO NET ZERO & TIET KIEM NANG LUONG:\n";
    std::cout << "   * Dung luong mo hinh (Model Size)   : " << model_size_mb << " MB\n";
    std::cout << "   * Cong suat uoc tinh khi chay AI (P): " << p_watts << " W\n";
    std::cout << "   * Nang luong tieu hao moi anh (E)   : " << energy_per_infer_j << " Joules/anh (" << (energy_per_infer_j / 3.6) << " mWh)\n";
    std::cout << "========================================================\n";

    return 0;
}
