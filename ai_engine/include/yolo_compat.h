#pragma once

#include <opencv2/core.hpp>
#include <opencv2/dnn.hpp>

// Decode the bundled model's raw YOLOv8 detection heads. Older OpenCV DNN
// releases can run these heads but cannot evaluate the exported decode graph.
cv::Mat forward_yolo_compat(cv::dnn::Net& net, const cv::Mat& blob, float threshold);
