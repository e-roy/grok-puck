idf_component_register(
    SRCS "main.c" "board.c" "audio.c" "face.c" "settings.c" "net.c" "portal.c" "link.c" "player.c" "listen.c"
    INCLUDE_DIRS "."
    REQUIRES esp_driver_gpio esp_driver_i2c esp_driver_i2s esp_driver_ledc esp_driver_spi esp_lcd esp_timer
             esp_wifi esp_netif esp_event nvs_flash esp_http_server lwip mbedtls esp_app_format
)
