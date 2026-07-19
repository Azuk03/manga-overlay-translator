FROM zyddnys/manga-image-translator:main

# Va bug: to_translation() trong to_json.py doc nham ctx.translations (rong)
# thay vi text_region.translation (noi ban dich that su duoc luu).
# Xem patches/to_json.py va ghi chu trong README de biet chi tiet.
COPY patches/to_json.py /app/server/to_json.py

# gpt_config chi nhan DUONG DAN file tren server (OmegaConf.load), khong
# nhan noi dung YAML truc tiep qua API - xem README.md.
COPY patches/gpt_config-vi.yaml /app/gpt_config-vi.yaml
