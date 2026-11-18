#include "yolo_compat.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <stdexcept>
#include <string>
#include <vector>

cv::Mat forward_yolo_compat(cv::dnn::Net& net, const cv::Mat& blob, float threshold) {
    constexpr int class_count = 10;
    constexpr int bins = 16;
    constexpr int input_size = 640;
    const std::vector<std::string> names = {
        "onnx_node!/model.22/cv2.0/cv2.0.2/Conv", "onnx_node!/model.22/cv3.0/cv3.0.2/Conv",
        "onnx_node!/model.22/cv2.1/cv2.1.2/Conv", "onnx_node!/model.22/cv3.1/cv3.1.2/Conv",
        "onnx_node!/model.22/cv2.2/cv2.2.2/Conv", "onnx_node!/model.22/cv3.2/cv3.2.2/Conv"
    };
    std::vector<cv::Mat> heads;
    net.setInput(blob);
    net.forward(heads, names);
    if (heads.size() != names.size()) {
        throw std::runtime_error("Model không có các lớp nhận diện tương thích.");
    }

    int candidate_count = 0;
    for (size_t i = 0; i < heads.size(); i += 2) {
        const auto& boxes = heads[i];
        const auto& scores = heads[i + 1];
        if (boxes.dims != 4 || scores.dims != 4 || boxes.type() != CV_32F || scores.type() != CV_32F ||
            !boxes.isContinuous() || !scores.isContinuous() || boxes.size[0] != 1 || scores.size[0] != 1 ||
            boxes.size[1] != 4 * bins || scores.size[1] != class_count ||
            boxes.size[2] != scores.size[2] || boxes.size[3] != scores.size[3] ||
            boxes.size[2] <= 0 || boxes.size[3] <= 0) {
            throw std::runtime_error("Các lớp nhận diện của model có kích thước không hợp lệ.");
        }
        candidate_count += boxes.size[2] * boxes.size[3];
    }

    const int shape[] = {1, 4 + class_count, candidate_count};
    cv::Mat decoded(3, shape, CV_32F, cv::Scalar(0));
    float* output = decoded.ptr<float>();
    int offset = 0;
    for (size_t i = 0; i < heads.size(); i += 2) {
        const auto& boxes = heads[i];
        const auto& scores = heads[i + 1];
        const int height = boxes.size[2], width = boxes.size[3], cells = height * width;
        const float stride_x = static_cast<float>(input_size) / width;
        const float stride_y = static_cast<float>(input_size) / height;
        const float* box_data = boxes.ptr<float>();
        const float* score_data = scores.ptr<float>();
        for (int cell = 0; cell < cells; ++cell) {
            const int candidate = offset + cell;
            float best_score = 0.0f;
            for (int cls = 0; cls < class_count; ++cls) {
                const float logit = score_data[cls * cells + cell];
                const float score = 1.0f / (1.0f + std::exp(-logit));
                output[(4 + cls) * candidate_count + candidate] = score;
                best_score = std::max(best_score, score);
            }
            if (best_score < threshold) continue;

            std::array<float, 4> distance{};
            for (int side = 0; side < 4; ++side) {
                float largest = box_data[(side * bins) * cells + cell];
                for (int bin = 1; bin < bins; ++bin) {
                    largest = std::max(largest, box_data[(side * bins + bin) * cells + cell]);
                }
                float sum = 0.0f, weighted_sum = 0.0f;
                for (int bin = 0; bin < bins; ++bin) {
                    const float probability = std::exp(box_data[(side * bins + bin) * cells + cell] - largest);
                    sum += probability;
                    weighted_sum += bin * probability;
                }
                distance[side] = weighted_sum / sum;
            }
            const float center_x = (cell % width) + 0.5f;
            const float center_y = (cell / width) + 0.5f;
            output[candidate] = (center_x + (distance[2] - distance[0]) * 0.5f) * stride_x;
            output[candidate_count + candidate] = (center_y + (distance[3] - distance[1]) * 0.5f) * stride_y;
            output[2 * candidate_count + candidate] = (distance[0] + distance[2]) * stride_x;
            output[3 * candidate_count + candidate] = (distance[1] + distance[3]) * stride_y;
        }
        offset += cells;
    }
    return decoded;
}
