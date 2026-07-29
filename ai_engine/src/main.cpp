/**
 * Smart Plant AI Engine
 * 
 * Chương trình chính — khởi động web server + đọc sensor + phát hiện sâu bệnh
 * Khi chạy: tự start Node.js server → gửi dữ liệu → dừng thì kill server luôn
 * 
 * Usage:
 *   ./smart_plant_engine [--server-url URL] [--sensor-interval SEC] [--pest-interval SEC]
 */

#include "http_client.h"
#include "sensor_simulator.h"
#include "pest_detector.h"

#include <iostream>
#include <string>
#include <thread>
#include <chrono>
#include <csignal>
#include <atomic>
#include <iomanip>
#include <ctime>
#include <cstdlib>
#include <unistd.h>
#include <sys/wait.h>
#include <sys/types.h>

// Flag để dừng chương trình gracefully
static std::atomic<bool> running{true};
static pid_t server_pid = -1;

void signal_handler(int /*signum*/) {
    std::cout << "\n🛑 Đang dừng chương trình..." << std::endl;
    running = false;
}

// In thời gian hiện tại
std::string current_time_str() {
    auto now = std::chrono::system_clock::now();
    auto time_t_now = std::chrono::system_clock::to_time_t(now);
    auto tm_now = std::localtime(&time_t_now);
    char buf[32];
    std::strftime(buf, sizeof(buf), "%H:%M:%S", tm_now);
    return std::string(buf);
}

/**
 * Tìm đường dẫn tới thư mục server/ (tương đối với executable)
 * Cấu trúc: ai_engine/build/smart_plant_engine → ../server/
 */
std::string find_server_dir() {
    char exe_path[1024];
    ssize_t len = readlink("/proc/self/exe", exe_path, sizeof(exe_path) - 1);
    if (len <= 0) {
        return "../server";
    }
    exe_path[len] = '\0';

    std::string bin_dir(exe_path);
    auto pos = bin_dir.rfind('/');
    if (pos != std::string::npos) {
        bin_dir = bin_dir.substr(0, pos);
    }

    // Danh sách các đường dẫn server/ có thể xảy ra
    std::vector<std::string> candidates = {
        bin_dir + "/../server",           // Khi deploy: /Smart_Plant/ai_engine/ -> /Smart_Plant/server
        bin_dir + "/../../server",        // Khi dev: /Smart_Plant/ai_engine/build/ -> /Smart_Plant/server
        bin_dir + "/server",              // Cùng thư mục
        "./server",
        "../server"
    };

    for (const auto& path : candidates) {
        if (access((path + "/index.js").c_str(), F_OK) == 0 ||
            access((path + "/server.bundle.js").c_str(), F_OK) == 0 ||
            access((path + "/server.js").c_str(), F_OK) == 0) {
            return path;
        }
    }

    // Trả về candidate đầu tiên làm fallback
    return bin_dir + "/../server";
}

/**
 * Tìm node binary (hỗ trợ NVM)
 */
std::string find_node_binary() {
    // Thử NVM trước
    const char* home = getenv("HOME");
    if (home) {
        std::string nvm_node = std::string(home) + "/.nvm/versions/node";
        // Tìm version mới nhất
        FILE* fp = popen(("ls -t " + nvm_node + " 2>/dev/null | head -1").c_str(), "r");
        if (fp) {
            char buf[256];
            if (fgets(buf, sizeof(buf), fp)) {
                std::string version(buf);
                // Bỏ newline
                while (!version.empty() && (version.back() == '\n' || version.back() == '\r'))
                    version.pop_back();
                pclose(fp);
                std::string node_path = nvm_node + "/" + version + "/bin/node";
                if (access(node_path.c_str(), X_OK) == 0) {
                    return node_path;
                }
            } else {
                pclose(fp);
            }
        }
    }

    // Thử system node
    if (access("/usr/bin/node", X_OK) == 0) return "/usr/bin/node";
    if (access("/usr/local/bin/node", X_OK) == 0) return "/usr/local/bin/node";

    return "";
}

/**
 * Khởi động Node.js web server như child process
 * Trả về PID hoặc -1 nếu thất bại
 */
pid_t start_web_server(const std::string& server_dir) {
    std::string node_bin = find_node_binary();
    if (node_bin.empty()) {
        std::cerr << "❌ Không tìm thấy Node.js trên Pi! Vui lòng cài Node.js." << std::endl;
        return -1;
    }

    // Ưu tiên: index.js (bundled) > server.bundle.js > server.js
    std::string target_js = "";
    if (access((server_dir + "/index.js").c_str(), F_OK) == 0) {
        target_js = server_dir + "/index.js";
    } else if (access((server_dir + "/server.bundle.js").c_str(), F_OK) == 0) {
        target_js = server_dir + "/server.bundle.js";
    } else if (access((server_dir + "/server.js").c_str(), F_OK) == 0) {
        target_js = server_dir + "/server.js";
    } else {
        std::cerr << "❌ Không tìm thấy file chạy Web Server trong " << server_dir << std::endl;
        return -1;
    }

    std::string filename = target_js.substr(target_js.rfind('/') + 1);

    std::cout << "🚀 Khởi động Web Server..." << std::endl;
    std::cout << "   Node  : " << node_bin << std::endl;
    std::cout << "   Target: " << target_js << std::endl;

    pid_t pid = fork();
    if (pid < 0) {
        std::cerr << "❌ fork() thất bại" << std::endl;
        return -1;
    }

    if (pid == 0) {
        FILE* devnull = fopen("/dev/null", "w");
        if (devnull) {
            dup2(fileno(devnull), STDOUT_FILENO);
            fclose(devnull);
        }

        if (chdir(server_dir.c_str()) != 0) {
            perror("chdir failed");
        }

        execl(node_bin.c_str(), "node", filename.c_str(), nullptr);
        perror("execl failed");
        _exit(1);
    }

    return pid;
}

/**
 * Dừng web server
 */
void stop_web_server(pid_t pid) {
    if (pid <= 0) return;

    std::cout << "🔌 Đang dừng Web Server (PID " << pid << ")..." << std::endl;

    // Gửi SIGTERM (dừng nhẹ nhàng)
    kill(pid, SIGTERM);

    // Đợi tối đa 3 giây
    for (int i = 0; i < 30; i++) {
        int status;
        pid_t result = waitpid(pid, &status, WNOHANG);
        if (result == pid) {
            std::cout << "✅ Web Server đã dừng." << std::endl;
            return;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    // Nếu vẫn chưa dừng → kill -9
    kill(pid, SIGKILL);
    waitpid(pid, nullptr, 0);
    std::cout << "✅ Web Server đã bị force kill." << std::endl;
}

// Parse command line arguments
struct Config {
    std::string server_url = "http://localhost:3000";
    int sensor_interval = 5;   // giây
    int pest_interval   = 30;  // giây
    int num_zones       = 4;
    int port            = 3000;
};

Config parse_args(int argc, char* argv[]) {
    Config cfg;
    for (int i = 1; i < argc; i++) {
        std::string arg = argv[i];
        if (arg == "--server-url" && i + 1 < argc) {
            cfg.server_url = argv[++i];
        } else if (arg == "--sensor-interval" && i + 1 < argc) {
            cfg.sensor_interval = std::stoi(argv[++i]);
        } else if (arg == "--pest-interval" && i + 1 < argc) {
            cfg.pest_interval = std::stoi(argv[++i]);
        } else if (arg == "--zones" && i + 1 < argc) {
            cfg.num_zones = std::stoi(argv[++i]);
        } else if (arg == "--port" && i + 1 < argc) {
            cfg.port = std::stoi(argv[++i]);
            cfg.server_url = "http://localhost:" + std::to_string(cfg.port);
        } else if (arg == "--help" || arg == "-h") {
            std::cout << "Usage: " << argv[0] << " [options]\n"
                      << "Options:\n"
                      << "  --server-url URL      Web server URL (default: http://localhost:3000)\n"
                      << "  --port N              Web server port (default: 3000)\n"
                      << "  --sensor-interval N   Sensor read interval in seconds (default: 5)\n"
                      << "  --pest-interval N     Pest detection interval in seconds (default: 30)\n"
                      << "  --zones N             Number of zones (default: 4)\n"
                      << "  -h, --help            Show this help\n";
            std::exit(0);
        }
    }
    return cfg;
}

int main(int argc, char* argv[]) {
    // Parse arguments
    Config cfg = parse_args(argc, argv);

    // Setup signal handler cho Ctrl+C
    std::signal(SIGINT, signal_handler);
    std::signal(SIGTERM, signal_handler);

    // Banner
    std::cout << "\n"
              << "╔══════════════════════════════════════════════╗\n"
              << "║       🌱 Smart Plant System v1.0             ║\n"
              << "╠══════════════════════════════════════════════╣\n"
              << "║  Server:  " << std::left << std::setw(34) << cfg.server_url << "║\n"
              << "║  Sensor:  mỗi " << std::left << std::setw(29) << (std::to_string(cfg.sensor_interval) + " giây") << "║\n"
              << "║  Pest:    mỗi " << std::left << std::setw(29) << (std::to_string(cfg.pest_interval) + " giây") << "║\n"
              << "║  Zones:   " << std::left << std::setw(34) << cfg.num_zones << "║\n"
              << "╚══════════════════════════════════════════════╝\n"
              << std::endl;

    // === BƯỚC 1: Khởi động Web Server ===
    std::string server_dir = find_server_dir();
    if (server_dir.empty()) {
        std::cerr << "❌ Không tìm thấy thư mục server/" << std::endl;
        return 1;
    }

    server_pid = start_web_server(server_dir);
    if (server_pid < 0) {
        return 1;
    }
    std::cout << "✅ Web Server đã khởi động (PID " << server_pid << ")" << std::endl;

    // Đợi server sẵn sàng (tối đa 10 giây)
    std::cout << "⏳ Đợi server sẵn sàng..." << std::endl;
    HttpClient http(cfg.server_url);
    bool server_ready = false;
    for (int i = 0; i < 20 && running; i++) {
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
        if (http.health_check()) {
            server_ready = true;
            break;
        }
    }

    if (!server_ready) {
        std::cerr << "❌ Web Server không phản hồi sau 10 giây!" << std::endl;
        stop_web_server(server_pid);
        return 1;
    }

    std::cout << "✅ Web Server sẵn sàng!" << std::endl;
    std::cout << "🌐 Dashboard: " << cfg.server_url << std::endl;

    // === BƯỚC 2: Khởi tạo AI components ===
    SensorSimulator sensor;
    PestDetector pest;

    std::cout << "\n📡 Bắt đầu gửi dữ liệu... (Ctrl+C để dừng)\n" << std::endl;

    int sensor_counter = 0;
    int pest_counter = 0;
    int tick = 0;

    // === BƯỚC 3: Main loop ===
    while (running) {
        tick++;

        // Kiểm tra server process còn sống không
        if (tick % 10 == 0) {
            int status;
            pid_t result = waitpid(server_pid, &status, WNOHANG);
            if (result == server_pid) {
                std::cerr << "\n❌ Web Server đã crash! Đang restart..." << std::endl;
                server_pid = start_web_server(server_dir);
                if (server_pid < 0) {
                    std::cerr << "❌ Không thể restart server. Dừng." << std::endl;
                    break;
                }
                std::this_thread::sleep_for(std::chrono::seconds(2));
            }
        }

        // === GỬI SENSOR DATA ===
        if (tick % cfg.sensor_interval == 0) {
            int zone_id = (sensor_counter % cfg.num_zones) + 1;
            auto data = sensor.read_sensors(zone_id);

            bool ok = http.post("/api/sensors", data.dump());

            std::cout << "[" << current_time_str() << "] "
                      << "📊 Sensor Zone " << zone_id << ": "
                      << "T=" << data["temperature"] << "°C  "
                      << "H=" << data["humidity"] << "%  "
                      << "L=" << data["light"] << " lux  "
                      << "S=" << data["soil_moisture"] << "%  "
                      << (ok ? "✅" : "❌")
                      << std::endl;

            sensor_counter++;
        }

        // === CHẠY PEST DETECTION ===
        if (tick % cfg.pest_interval == 0) {
            int zone_id = (pest_counter % cfg.num_zones) + 1;
            auto result = pest.detect(zone_id);

            if (!result.is_null()) {
                bool ok = http.post("/api/pests", result.dump());

                std::cout << "[" << current_time_str() << "] "
                          << "🔬 Pest Zone " << zone_id << ": "
                          << result["pest_type"].get<std::string>() << " "
                          << "(conf=" << result["confidence"] << ", "
                          << result["severity"].get<std::string>() << ") "
                          << (ok ? "✅" : "❌")
                          << std::endl;
            } else {
                std::cout << "[" << current_time_str() << "] "
                          << "🔬 Pest Zone " << zone_id << ": "
                          << "Không phát hiện sâu bệnh ✅"
                          << std::endl;
            }

            pest_counter++;
        }

        // Sleep 1 giây mỗi tick
        std::this_thread::sleep_for(std::chrono::seconds(1));
    }

    // === BƯỚC 4: Cleanup ===
    std::cout << "\n📊 Tổng kết:" << std::endl;
    std::cout << "   Sensor readings gửi: " << sensor_counter << std::endl;
    std::cout << "   Pest scans thực hiện: " << pest_counter << std::endl;

    // Dừng web server
    stop_web_server(server_pid);

    std::cout << "👋 Đã dừng toàn bộ hệ thống." << std::endl;

    return 0;
}
