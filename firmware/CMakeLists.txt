# Desk display firmware. One build per board (spec §4.8): a plain `idf.py build` builds the Waveshare
# ESP32-S3-Touch-LCD-1.46 into build/; another board is chosen with -D BOARD=<id>, a folder in boards/,
# in a build folder of its own (firmware/README.md).
cmake_minimum_required(VERSION 3.22)
set(PROJECT_VER "0.6.1")  # reported to the bridge as desk-display/<version>

# A build folder holds one board: switching would mix two boards' settings and objects. The folder
# remembers its board in a file, which outlives the CMake cache (idf.py deletes the cache when CMake
# fails), so later commands need only -B, and a switch is refused every time.
set(board_file "${CMAKE_BINARY_DIR}/grok-puck-board.txt")
set(built_board "")
if(EXISTS "${board_file}")
    file(STRINGS "${board_file}" built_board LIMIT_COUNT 1)
endif()
if(NOT DEFINED CACHE{BOARD} AND built_board)
    set(BOARD "${built_board}" CACHE STRING "The board to build for: a folder in boards/")
endif()
set(BOARD "waveshare-lcd-1.46" CACHE STRING "The board to build for: a folder in boards/")
if(NOT EXISTS "${CMAKE_CURRENT_LIST_DIR}/boards/${BOARD}/board_config.h")
    file(GLOB boards RELATIVE "${CMAKE_CURRENT_LIST_DIR}/boards" "${CMAKE_CURRENT_LIST_DIR}/boards/*/board_config.h")
    list(TRANSFORM boards REPLACE "/board_config.h$" "")
    list(JOIN boards ", " boards)
    message(FATAL_ERROR "There is no board \"${BOARD}\" in boards/. The boards: ${boards}.")
endif()
if(built_board AND NOT built_board STREQUAL BOARD)
    message(FATAL_ERROR "This build folder (${CMAKE_BINARY_DIR}) is for ${built_board}, not ${BOARD}: "
                        "build ${BOARD} in another folder (idf.py -D BOARD=${BOARD} -B <folder> build).")
endif()
file(WRITE "${board_file}" "${BOARD}\n")

# The LCD-1.46 keeps its sdkconfig next to this file, as before; other boards keep theirs in their
# build folder. Settings for everyone go in sdkconfig.defaults, a board's own in its folder.
if(NOT BOARD STREQUAL "waveshare-lcd-1.46" AND NOT SDKCONFIG)
    set(SDKCONFIG "${CMAKE_BINARY_DIR}/sdkconfig")
endif()
if(NOT SDKCONFIG_DEFAULTS AND EXISTS "${CMAKE_CURRENT_LIST_DIR}/boards/${BOARD}/sdkconfig.defaults")
    set(SDKCONFIG_DEFAULTS "sdkconfig.defaults;boards/${BOARD}/sdkconfig.defaults")
endif()

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
idf_build_set_property(BOARD "${BOARD}")  # main/CMakeLists.txt compiles that board's folder
project(desk_display)
