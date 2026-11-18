#include "yolo_compat.h"

#include <opencv2/imgcodecs.hpp>
#include <algorithm>
#include <cmath>
#include <iostream>
#include <stdexcept>

int main(int argc, char** argv) {
    if (argc != 3) return 2;
    try {
        cv::Mat image = cv::imread(argv[2]);
        if (image.empty() || image.cols != 640 || image.rows != 640) {
            throw std::runtime_error("Test image is missing or has unexpected dimensions");
        }
        auto net = cv::dnn::readNetFromONNX(argv[1]);
        cv::Mat blob = cv::dnn::blobFromImage(image, 1.0 / 255.0, cv::Size(640, 640), cv::Scalar(), true, false);
        net.setInput(blob);
        cv::Mat native;
        try {
            native = net.forward();
        } catch (const cv::Exception&) {
            // OpenCV 4.6 cannot execute this model's exported decoding graph.
        }
        cv::Mat compat = forward_yolo_compat(net, blob, 0.35f);
        if (compat.dims != 3 || compat.size[0] != 1 || compat.size[1] != 14 || compat.size[2] != 8400) {
            throw std::runtime_error("Compatibility output has incorrect dimensions");
        }
        const float* actual = compat.ptr<float>();
        constexpr int count = 8400;
        float best_score = 0.0f;
        int best_class = -1;
        for (int cls = 0; cls < 10; ++cls) {
            for (int i = 0; i < count; ++i) {
                const float score = actual[(cls + 4) * count + i];
                if (score > best_score) {
                    best_score = score;
                    best_class = cls;
                }
            }
        }
        if (best_class != 2 || best_score < 0.95f) {
            throw std::runtime_error("Sample was not recognized as bacterial spot");
        }
        if (!native.empty()) {
            if (native.dims != 3 || native.size[1] != 14 || native.size[2] != count) {
                throw std::runtime_error("Native output has incorrect dimensions");
            }
            const float* reference = native.ptr<float>();
            for (int i = 0; i < count; ++i) {
                float highest = 0.0f;
                for (int cls = 0; cls < 10; ++cls) {
                    const int index = (cls + 4) * count + i;
                    highest = std::max(highest, reference[index]);
                    if (std::abs(reference[index] - actual[index]) > 1e-4f) {
                        throw std::runtime_error("Compatibility class score differs from native output");
                    }
                }
                if (highest >= 0.35f) {
                    for (int coordinate = 0; coordinate < 4; ++coordinate) {
                        const int index = coordinate * count + i;
                        if (std::abs(reference[index] - actual[index]) > 0.02f) {
                            throw std::runtime_error("Compatibility box differs from native output");
                        }
                    }
                }
            }
        }
        std::cout << "Compatibility inference passed; bacterial spot confidence=" << best_score << "\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << "\n";
        return 1;
    }
}
