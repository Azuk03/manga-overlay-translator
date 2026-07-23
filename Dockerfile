FROM zyddnys/manga-image-translator:main

# Va bug: to_translation() trong to_json.py doc nham ctx.translations (rong)
# thay vi text_region.translation (noi ban dich that su duoc luu).
# Xem patches/to_json.py va ghi chu trong README de biet chi tiet.
COPY patches/to_json.py /app/server/to_json.py

# gpt_config chi nhan DUONG DAN file tren server (OmegaConf.load), khong
# nhan noi dung YAML truc tiep qua API - xem README.md.
COPY patches/gpt_config-vi.yaml /app/gpt_config-vi.yaml

# Them route /fetch-image: extension khong tu dat duoc header Referer trong
# Manifest V3 (xem docs/superpowers/specs/2026-07-21-browser-extension-port-design.md
# muc 2/6) - route nay de backend tu tai anh ho kem Referer dung.
COPY patches/main.py /app/server/main.py

# Va bug: _LANGUAGE_CODE_MAP trong deepl.py chua co entry 'VIN' du DeepL API
# that da ho tro tieng Viet tu 6/2025 (code backend chua cap nhat theo) - xem
# docs/superpowers/specs/2026-07-23-translator-engine-picker-design.md muc 3.
COPY patches/deepl.py /app/manga_translator/translators/deepl.py
