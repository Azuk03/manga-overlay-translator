# tests/test_gpt_response_parse.py
#
# Chay tren host: python -m pytest tests/test_gpt_response_parse.py
#
# File nay test HAM THUAN. De kiem chung ca LOP THAT (OpenAITranslator) sau khi
# build lai image, chay doan duoi - no dem so lan goi GPT that su:
#
#   docker run --rm -i -e OPENAI_API_KEY=sk-test --entrypoint python \
#       manga-translator-patched:local - <<'PY'
#   import sys, asyncio, logging
#   sys.path.insert(0,'/app'); logging.disable(logging.CRITICAL)
#   from manga_translator.translators.chatgpt import OpenAITranslator
#   def run(resp):
#       t = OpenAITranslator(); calls={"n":0}
#       async def fake(to_lang, prompt):
#           calls["n"] += 1; return resp
#       t._request_with_retry = fake
#       ok,_ = asyncio.new_event_loop().run_until_complete(
#           t._translate_batch("ENG","VIN",["a","b"],[0,1],"p",0))
#       return ok, calls["n"]
#   assert run("<|1|>mot\n<|2|>hai")   == (True, 1)   # von da chay
#   assert run("<|1|>mot<|2|>hai")     == (True, 1)   # BAN VA: truoc day goi 3 lan
#   assert run("<|1|>mot <|2|>\nhai")  == (True, 1)   # BAN VA
#   assert run("<|1|>mot\n<|1|>hai")[1] > 1           # trung index: van phai tu choi
#   assert run("<|1|>chi mot thoi")[1] > 1            # thieu index: van phai tu choi
#   assert run("<|1|>mot\n<|7|>bay")[1] > 1           # ngoai pham vi: van phai tu choi
#   print("OK")
#   PY
#
# LY DO TON TAI (do duoc tu log that ngay 2026-08-26, mot phien webtoon 180 luot goi):
# backend bao "Found indices count (1) does not match expected count (2)" roi thu
# lai 3 lan, trong khi response CO DU ca <|1|> lan <|2|>. Moi lan thu lai GPT tra
# ve mot ban dich KHAC (GIAT MINH / Rung minh / RUT RE), va ban thang cuoc la ban
# ngau nhien - vua ton tien GPT gap 3, vua lam ban dich luc VIET HOA luc viet thuong.
#
# Goc re: trong chinh chatgpt.py cua upstream co HAI cach hieu khac nhau ve marker:
#   - buoc TRICH  (dong 319): re.split(r'<\|\d+\|>', response_text)  -> tim o BAT KY dau
#   - buoc KIEM TRA (dong 380): re.match(r'^<\|(\d+)\|>', line)      -> BAT BUOC dau dong
# Nen mot response ma buoc trich xu ly duoc hoan hao van bi buoc kiem tra bac bo.
# Module nay lam cho buoc kiem tra hieu marker GIONG buoc trich.
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "patches"))

from gpt_response_parse import find_marker_indices


# ===== Dang HOP LE ma ban cu VAN BAC BO (chinh la bug) =====

def test_khong_co_newline_truoc_marker():
    # Day la ca that gay ra 3 luot thu lai trong log.
    assert find_marker_indices("<|1|>Toi khong the tin...!<|2|>GIAT MINH") == [1, 2]


def test_chi_ngan_cach_bang_carriage_return():
    assert find_marker_indices("<|1|>mot\r<|2|>hai") == [1, 2]


def test_marker_o_cuoi_dong():
    assert find_marker_indices("<|1|>mot <|2|>\nhai") == [1, 2]


def test_marker_thut_le_hoac_co_khoang_trang_dau():
    assert find_marker_indices("   <|1|>mot\n\t<|2|>hai") == [1, 2]


# ===== Dang von da hop le - PHAI GIU NGUYEN hanh vi =====

def test_xuong_dong_binh_thuong():
    assert find_marker_indices("<|1|>mot\n<|2|>hai\n<|3|>ba") == [1, 2, 3]


def test_cau_bi_ngat_thanh_nhieu_dong():
    # Model hay ngat mot cau dai thanh nhieu dong; dong tiep khong co marker.
    text = "<|1|>day la mot cau rat dai\nbi ngat xuong dong\n<|2|>hai"
    assert find_marker_indices(text) == [1, 2]


def test_boc_trong_khoi_code():
    assert find_marker_indices("```\n<|1|>mot\n<|2|>hai\n```") == [1, 2]


def test_dong_trong_xen_giua():
    assert find_marker_indices("<|1|>mot\n\n\n<|2|>hai") == [1, 2]


# ===== Giu duoc du lieu de nguoi goi tu kiem tra trung/ngoai pham vi =====

def test_giu_thu_tu_va_ban_trung_de_nguoi_goi_bat_duoc():
    # KHONG duoc tra ve set: buoc kiem tra can phat hien index bi lap.
    assert find_marker_indices("<|1|>a\n<|1|>b\n<|2|>c") == [1, 1, 2]


def test_giu_ca_index_ngoai_pham_vi():
    # Nguoi goi so voi expected_indices roi tu quyet dinh, ham nay khong loc.
    assert find_marker_indices("<|1|>a\n<|5|>b") == [1, 5]


def test_index_nhieu_chu_so():
    assert find_marker_indices("<|9|>a<|10|>b<|11|>c") == [9, 10, 11]


# ===== Bien =====

def test_chuoi_rong():
    assert find_marker_indices("") == []


def test_khong_co_marker_nao():
    assert find_marker_indices("chi la van ban thuong, khong co marker") == []


def test_marker_hong_khong_duoc_tinh():
    # Thieu dau |, thieu >, hoac chua chu thay vi so - deu khong phai marker.
    assert find_marker_indices("<|a|>x <1|>y <|2>z <|>w") == []


def test_none_khong_lam_vo():
    assert find_marker_indices(None) == []
