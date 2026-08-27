# patches/gpt_permanent_error.py
"""Phan biet loi OpenAI VINH VIEN voi loi TAM THOI.

VAN DE (do duoc 2026-08-27 tren log that, luc tai khoan het credit): OpenAI tra
HTTP 429 cho CA hai truong hop rat khac nhau -

    - qua tan suat (rate_limit_exceeded): TAM THOI, doi mot chut roi thu lai se qua
    - het credit (insufficient_quota):    VINH VIEN, thu bao nhieu lan cung the

chatgpt.py bat ca hai bang mot `except openai.RateLimitError` roi thu lai nhu
nhau. Do duoc tren MOT trang khi het credit:

    33 luot goi API   |  11 lan "Max attempts reached"  |  11 lan chia nho batch
    185 GIAY rieng cho buoc dich, roi tra ve RONG

Va vi ban dich that bai nen dst == src, bo loc "identical to original" cua
backend xoa sach moi vung => trang tra ve 0 vung kem HTTP 200. Extension tuong
la thanh cong nhung khong co chu nao: no ve overlay rong va KHONG bao loi gi.
Ghep voi eager mode thi mot chuong 146 trang mat hon 7 tieng de "dich xong" ma
khong hien gi va khong noi gi.

Tach file rieng (chi can `re`, khong keo theo openai/manga_translator) de test
duoc doc lap - cung ly do http_retry.py va gpt_response_parse.py duoc tach.
Xem tests/test_gpt_permanent_error.py.
"""
import re

# Cac dau hieu cho biet loi se KHONG bao gio tu khoi neu thu lai.
# Chi liet ke thu that su vinh vien: het tien, khoa sai, tai khoan bi khoa.
# TUYET DOI khong them 'rate_limit_exceeded' vao day - do la 429 tam thoi that
# su, thu lai la qua, va coi no vinh vien se lam hong hanh vi dang dung.
_PERMANENT = re.compile(
    r"insufficient_quota"
    r"|credit_balance_exhausted"
    r"|no credits remaining"
    r"|billing_hard_limit_reached"
    r"|invalid_api_key"
    r"|account_deactivated"
    r"|organization_restricted",
    re.I,
)


def is_permanent_error(err):
    """True neu loi nay thu lai cung vo ich.

    Nhan ca chuoi lan doi tuong Exception (dung str() len no).
    Khong chac chan thi tra False - sai ve phia VAN THU LAI, tuc giu nguyen
    hanh vi cu, an toan hon la dung nham mot loi vo tinh khoi.
    """
    if err is None:
        return False
    if isinstance(err, BaseException):
        err = str(err)
    if not isinstance(err, str) or not err:
        return False
    return bool(_PERMANENT.search(err))
