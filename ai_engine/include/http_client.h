#pragma once

#include <string>

/**
 * HTTP Client sử dụng POSIX sockets (không cần libcurl)
 * Phù hợp cho Pi 4 — không cần cài thêm thư viện
 */
class HttpClient {
public:
    HttpClient(const std::string& base_url);
    ~HttpClient() = default;

    // Không cho copy
    HttpClient(const HttpClient&) = delete;
    HttpClient& operator=(const HttpClient&) = delete;

    /**
     * Gửi HTTP POST request với JSON body
     * @param endpoint  API endpoint (e.g. "/api/sensors")
     * @param json_body JSON string
     * @return true nếu server trả về 2xx
     */
    bool post(const std::string& endpoint, const std::string& json_body);

    /**
     * Gửi HTTP GET request
     * @param endpoint  API endpoint
     * @return Response body string
     */
    std::string get(const std::string& endpoint);

    /**
     * Kiểm tra kết nối tới server
     */
    bool health_check();

    /**
     * Lấy base URL hiện tại
     */
    const std::string& get_base_url() const { return base_url_; }

private:
    std::string host_;
    int port_;
    std::string base_url_;

    /**
     * Parse URL thành host và port
     */
    void parse_url(const std::string& url);

    /**
     * Gửi raw HTTP request và nhận response
     */
    std::string send_request(const std::string& request);
};
