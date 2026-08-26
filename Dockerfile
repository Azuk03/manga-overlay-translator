FROM zyddnys/manga-image-translator:main

# Pillow 10.2.0 trong image goc doc duoc JPEG/PNG/WebP nhung KHONG doc duoc
# AVIF (da kiem chung: PIL.features.check('avif') -> False). Hitomi tra ve toan
# AVIF, nen extension phai giai ma bang trinh duyet roi nen lai thanh PNG - phinh
# ~7x va ton mot luot nen anh 6 megapixel moi trang. Plugin nay cho backend doc
# thang AVIF, bo han buoc do. Da kiem chung: cai sach, Pillow van 10.2.0, khong
# keo theo phu thuoc nao khac. Xem patches/main.py (import pillow_avif).
RUN pip install --no-cache-dir pillow-avif-plugin==1.6.0

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

# Retry + ep IPv4 cho /fetch-image (xem patches/http_retry.py). Tach file rieng
# de test duoc doc lap voi FastAPI app.
COPY patches/http_retry.py /app/server/http_retry.py

# Va bug: _LANGUAGE_CODE_MAP trong deepl.py chua co entry 'VIN' du DeepL API
# that da ho tro tieng Viet tu 6/2025 (code backend chua cap nhat theo) - xem
# docs/superpowers/specs/2026-07-23-translator-engine-picker-design.md muc 3.
COPY patches/deepl.py /app/manga_translator/translators/deepl.py

# Va bug: buoc KIEM TRA response cua chatgpt.py bat buoc marker <|n|> phai nam dau
# dong (re.match voi ^), trong khi buoc TRICH ngay tren no lai tim marker o bat ky
# dau (re.split). Response ma buoc trich xu ly duoc van bi bac bo -> thu lai 3 lan,
# moi lan mot ban dich khac. Do tren log that: 3/79 batch dinh loi nay.
# Xem patches/gpt_response_parse.py + tests/test_gpt_response_parse.py.
COPY patches/gpt_response_parse.py /app/manga_translator/translators/gpt_response_parse.py
COPY patches/chatgpt.py /app/manga_translator/translators/chatgpt.py

# Toi uu: chuyen to_translation sang chay tren executor de chi truyen JSON nho
# (~108KB) thay vi pickle ca Context (~108MB) qua ranh gioi tien trinh; kem sua
# O(n^2) buffer o sent_data_internal. Xem
# docs/superpowers/specs/2026-08-09-backend-context-relay-optimization-design.md
COPY patches/share.py /app/manga_translator/mode/share.py
COPY patches/sent_data_internal.py /app/server/sent_data_internal.py
