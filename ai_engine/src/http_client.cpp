#include "http_client.h"

#include <sys/socket.h>
#include <arpa/inet.h>
#include <netdb.h>
#include <unistd.h>

#include <iostream>
#include <sstream>
#include <cstring>
#include <algorithm>

HttpClient::HttpClient(const std::string& base_url)
    : base_url_(base_url)
{
    parse_url(base_url);
}

void HttpClient::parse_url(const std::string& url) {
    // Parse "http://host:port" hoặc "http://host"
    std::string stripped = url;

    // Bỏ "http://"
    auto pos = stripped.find("://");
    if (pos != std::string::npos) {
        stripped = stripped.substr(pos + 3);
    }

    // Bỏ trailing "/"
    if (!stripped.empty() && stripped.back() == '/') {
        stripped.pop_back();
    }

    // Tách host:port
    auto colon = stripped.find(':');
    if (colon != std::string::npos) {
        host_ = stripped.substr(0, colon);
        port_ = std::stoi(stripped.substr(colon + 1));
    } else {
        host_ = stripped;
        port_ = 80;
    }
}

std::string HttpClient::send_request(const std::string& request) {
    // Tạo socket
    int sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock < 0) {
        std::cerr << "[HTTP] Không thể tạo socket" << std::endl;
        return "";
    }

    // Set timeout 5 giây
    struct timeval tv;
    tv.tv_sec = 5;
    tv.tv_usec = 0;
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));

    // Resolve hostname
    struct addrinfo hints{}, *result = nullptr;
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_STREAM;

    std::string port_str = std::to_string(port_);
    int gai_err = getaddrinfo(host_.c_str(), port_str.c_str(), &hints, &result);
    if (gai_err != 0) {
        std::cerr << "[HTTP] Không thể resolve host: " << host_
                  << " (" << gai_strerror(gai_err) << ")" << std::endl;
        close(sock);
        return "";
    }

    // Kết nối
    if (connect(sock, result->ai_addr, result->ai_addrlen) < 0) {
        std::cerr << "[HTTP] Không thể kết nối tới " << host_ << ":" << port_ << std::endl;
        freeaddrinfo(result);
        close(sock);
        return "";
    }
    freeaddrinfo(result);

    // Gửi request
    ssize_t sent = send(sock, request.c_str(), request.size(), 0);
    if (sent < 0) {
        std::cerr << "[HTTP] Gửi request thất bại" << std::endl;
        close(sock);
        return "";
    }

    // Nhận response
    std::string response;
    char buffer[4096];
    ssize_t bytes;
    while ((bytes = recv(sock, buffer, sizeof(buffer) - 1, 0)) > 0) {
        buffer[bytes] = '\0';
        response.append(buffer, bytes);
    }

    close(sock);
    return response;
}

bool HttpClient::post(const std::string& endpoint, const std::string& json_body) {
    // Build HTTP POST request
    std::ostringstream req;
    req << "POST " << endpoint << " HTTP/1.1\r\n"
        << "Host: " << host_ << ":" << port_ << "\r\n"
        << "Content-Type: application/json\r\n"
        << "Content-Length: " << json_body.size() << "\r\n"
        << "Connection: close\r\n"
        << "\r\n"
        << json_body;

    std::string response = send_request(req.str());

    if (response.empty()) {
        return false;
    }

    // Kiểm tra HTTP status code (dòng đầu: "HTTP/1.1 201 Created")
    auto first_line_end = response.find("\r\n");
    if (first_line_end == std::string::npos) return false;

    std::string status_line = response.substr(0, first_line_end);
    // Tìm status code (sau "HTTP/1.x ")
    auto space1 = status_line.find(' ');
    if (space1 == std::string::npos) return false;

    int status_code = std::stoi(status_line.substr(space1 + 1, 3));
    return (status_code >= 200 && status_code < 300);
}

std::string HttpClient::get(const std::string& endpoint) {
    // Build HTTP GET request
    std::ostringstream req;
    req << "GET " << endpoint << " HTTP/1.1\r\n"
        << "Host: " << host_ << ":" << port_ << "\r\n"
        << "Connection: close\r\n"
        << "\r\n";

    std::string response = send_request(req.str());

    if (response.empty()) {
        return "";
    }

    // Tách body từ response (sau "\r\n\r\n")
    auto body_start = response.find("\r\n\r\n");
    if (body_start == std::string::npos) return "";

    return response.substr(body_start + 4);
}

bool HttpClient::health_check() {
    std::string body = get("/api/health");
    return !body.empty() && body.find("\"ok\"") != std::string::npos;
}
