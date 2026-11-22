# The firmware, plus the board it is built for (boards/<id>/: its board.c, audio.c and board_config.h).
idf_build_get_property(board BOARD)
set(board_dir "${CMAKE_CURRENT_LIST_DIR}/../boards/${board}")
idf_component_register(
    SRCS "main.c" "face.c" "audio_level.c" "settings.c" "net.c" "portal.c" "link.c" "player.c" "listen.c"
         "fonts/font_name_bold_24.c"
         "${board_dir}/board.c" "${board_dir}/audio.c"
    INCLUDE_DIRS "." "${board_dir}"
    REQUIRES esp_driver_gpio esp_driver_i2c esp_driver_i2s esp_driver_ledc esp_driver_spi esp_lcd esp_timer
             esp_wifi esp_netif esp_event nvs_flash esp_http_server lwip mbedtls esp_app_format
)
