# Desk display firmware for the Waveshare ESP32-S3-Touch-LCD-1.46.
cmake_minimum_required(VERSION 3.22)
set(PROJECT_VER "0.5.0")  # reported to the bridge as desk-display/<version>
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(desk_display)
