# tests/test_gpt_permanent_error.py
#
# Chay tren host: python -m pytest tests/test_gpt_permanent_error.py
#
# LY DO TON TAI (do duoc 2026-08-27 tren log that, luc tai khoan het credit):
# OpenAI tra HTTP 429 cho CA hai truong hop rat khac nhau - qua tan suat (tam
# thoi, thu lai se qua) va HET CREDIT (vinh vien, thu bao nhieu lan cung the).
# chatgpt.py bat ca hai bang `except openai.RateLimitError` roi thu lai nhu nhau.
#
# Hau qua do duoc tren MOT trang:
#   - 33 luot goi API cho mot trang da chac chan that bai
#   - 11 lan "Max attempts reached" + 11 lan chia nho batch roi thu lai
#   - 185 GIAY rieng cho buoc dich, roi tra ve RONG
#   - Va vi ban dich that bai nen dst == src, bo loc "identical to original" xoa
#     sach moi vung => trang tra ve 0 vung, HTTP 200. Extension tuong la thanh
#     cong nhung khong co chu nao, ve overlay rong, KHONG bao loi gi.
# Ghep voi eager mode thi mot chuong 146 trang mat hon 7 tieng de "dich xong"
# ma khong hien gi.
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "patches"))

from gpt_permanent_error import is_permanent_error


# ===== Loi VINH VIEN - phai dung ngay =====

def test_het_credit():
    assert is_permanent_error(
        "Error code: 429 - {'error': {'message': 'You have no credits remaining. "
        "Add credits to continue using the API at https://platform.openai.com/...', "
        "'type': 'insufficient_quota', 'param': None, 'code': 'credit_balance_exhausted'}}"
    ) is True


def test_insufficient_quota():
    assert is_permanent_error("Error code: 429 - insufficient_quota") is True


def test_khoa_api_sai():
    assert is_permanent_error(
        "Error code: 401 - {'error': {'code': 'invalid_api_key'}}") is True


def test_tai_khoan_bi_khoa():
    assert is_permanent_error("account_deactivated") is True


def test_khong_phan_biet_hoa_thuong():
    assert is_permanent_error("INSUFFICIENT_QUOTA") is True
    assert is_permanent_error("Credit_Balance_Exhausted") is True


# ===== Loi TAM THOI - phai giu nguyen hanh vi thu lai =====

def test_qua_tan_suat_that_su_van_duoc_thu_lai():
    # Day moi la 429 dung nghia rate limit - thu lai se qua.
    assert is_permanent_error(
        "Error code: 429 - {'error': {'message': 'Rate limit reached for gpt-4o-mini "
        "in organization org-xxx on requests per min (RPM): Limit 3, Used 3.', "
        "'type': 'requests', 'code': 'rate_limit_exceeded'}}") is False


def test_loi_may_chu_van_duoc_thu_lai():
    assert is_permanent_error("Error code: 500 - internal server error") is False
    assert is_permanent_error("Error code: 503 - service unavailable") is False


def test_timeout_van_duoc_thu_lai():
    assert is_permanent_error("Request timed out") is False


def test_loi_dinh_dang_response_van_duoc_thu_lai():
    # Loi parse marker <|n|> - thu lai co the qua, khong duoc coi la vinh vien.
    assert is_permanent_error(
        "Found indices count (1) does not match expected count (2)") is False


# ===== Bien =====

def test_dau_vao_rong_hoac_None():
    assert is_permanent_error("") is False
    assert is_permanent_error(None) is False
    assert is_permanent_error(123) is False


def test_nhan_ca_doi_tuong_exception_khong_chi_chuoi():
    class FakeErr(Exception):
        pass
    assert is_permanent_error(FakeErr("insufficient_quota")) is True
    assert is_permanent_error(FakeErr("rate_limit_exceeded")) is False
