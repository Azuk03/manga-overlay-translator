# patches/gpt_response_parse.py
"""Tim cac marker <|n|> trong response cua GPT.

VAN DE (do duoc 2026-08-26 tu log that, mot phien webtoon 180 luot goi backend):
backend bao "Found indices count (1) does not match expected count (2)" roi thu
lai 3 lan, trong khi response ro rang CO DU ca <|1|> lan <|2|>. Moi lan thu lai
GPT tra ve mot ban dich khac (GIAT MINH / Rung minh / RUT RE) va ban thang cuoc
la ban ngau nhien - vua ton tien GPT gap 3 lan, vua khien ban dich luc VIET HOA
luc viet thuong ngay trong cung mot chuong.

GOC RE: trong chinh chatgpt.py cua upstream co HAI cach hieu khac nhau ve marker:

    buoc TRICH   (chatgpt.py:319)  re.split(r'<\\|\\d+\\|>', response_text)
                                   -> tim marker o BAT KY dau trong chuoi
    buoc KIEM TRA (chatgpt.py:380) re.match(r'^<\\|(\\d+)\\|>(.*)', line)
                                   -> BAT BUOC marker nam dau dong

Nghia la mot response ma buoc TRICH xu ly duoc hoan hao van bi buoc KIEM TRA bac
bo, chi vi model khong xuong dong truoc marker. Da kiem chung bang chinh logic
cua upstream: cac dang "khong co newline", "chi co \\r" va "marker o cuoi dong"
deu cho ra "found 1 / expected 2".

Ham nay lam cho buoc kiem tra hieu marker GIONG HET buoc trich. No CO Y tra ve
danh sach theo dung thu tu xuat hien VA giu ca ban trung lan index ngoai pham vi
- vi ben goi con phai tu phat hien index lap va index vuot khoang, dung nhu ban
cu van lam. Loc bot o day se lam mat hai phep kiem tra do.

Tach thanh file rieng (khong nhet vao chatgpt.py) de test duoc doc lap: file nay
chi can `re`, khong keo theo openai/manga_translator - cung ly do http_retry.py
duoc tach khoi FastAPI app. Xem tests/test_gpt_response_parse.py.
"""
import re

# Giong het bieu thuc ma buoc TRICH dung (chatgpt.py:319), chi them nhom bat so.
_MARKER = re.compile(r'<\|(\d+)\|>')


def find_marker_indices(response_text):
    """Tra ve [int] cac chi so marker theo dung thu tu xuat hien trong chuoi.

    Khong bo trung, khong loc theo pham vi - ben goi tu quyet dinh.
    """
    if not response_text:
        return []
    return [int(m) for m in _MARKER.findall(response_text)]
