cmake_minimum_required(VERSION 3.16)
project(smart_plant_engine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Tải nlohmann_json tự động (không cần sudo apt install)
include(FetchContent)
FetchContent_Declare(
    json
    URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
)
FetchContent_MakeAvailable(json)

# Find OpenCV
find_package(OpenCV REQUIRED)

# Source files
set(SOURCES
    src/main.cpp
    src/http_client.cpp
    src/sensor_simulator.cpp
    src/pest_detector.cpp
    src/yolo_compat.cpp
)

# Build executable
add_executable(${PROJECT_NAME} ${SOURCES})

target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${OpenCV_INCLUDE_DIRS}
)

target_link_libraries(${PROJECT_NAME} PRIVATE
    nlohmann_json::nlohmann_json
    ${OpenCV_LIBS}
)

# Compiler warnings
target_compile_options(${PROJECT_NAME} PRIVATE
    -Wall -Wextra -Wpedantic
)

option(SMART_PLANT_BUILD_TESTS "Build model compatibility tests" OFF)
if(SMART_PLANT_BUILD_TESTS)
    enable_testing()
    add_executable(test_yolo_compat tests/test_yolo_compat.cpp src/yolo_compat.cpp)
    target_include_directories(test_yolo_compat PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include ${OpenCV_INCLUDE_DIRS})
    target_link_libraries(test_yolo_compat PRIVATE ${OpenCV_LIBS})
    add_test(NAME yolo_compat COMMAND test_yolo_compat
        ${CMAKE_CURRENT_SOURCE_DIR}/model/best.onnx
        ${CMAKE_CURRENT_SOURCE_DIR}/test_images/7e423f77-2947-4e4e-9777-17a780996d39___GCREC_Bact-Sp-5600_JPG_jpg.rf.22SIsV1MH2SYWf9Vzo9o.jpg)
endif()
