# tests/test_share_lock.py
#
# Chay (can container manga_translator DANG CHAY va KHONG bi ket khoa):
#
#   docker cp patches/share.py manga_translator:/tmp/share.py
#   docker exec -i manga_translator python - < tests/test_share_lock.py
#
# Hai loi cua upstream, deu lam chet backend khi gap trang AVIF:
#
#  1. SAFE_PICKLE_MODULES chi cho qua module bat dau bang 'PIL.'. Anh AVIF do
#     pillow_avif giai ma nen tra ve pillow_avif.AvifImagePlugin.AvifImageFile
#     - NGOAI namespace 'PIL.' - nen restricted_loads tu choi.
#
#  2. execute_method goi check_lock() (gianh khoa doc quyen) roi moi goi
#     restricted_loads(). Khong co try/finally, nen loi o buoc 2 lam khoa KHONG
#     BAO GIO duoc nha -> moi request sau do an HTTP 429 vinh vien, phai restart
#     container moi song lai. Do la bug nghiem trong hon: BAT KY exception nao
#     giua check_lock() va run_method() cung giet backend.

import io
import json
import pickle
import sys
import urllib.error
import urllib.request

sys.path.insert(0, "/tmp")

EXECUTOR = "http://127.0.0.1:5004"


def is_locked() -> bool:
    with urllib.request.urlopen(EXECUTOR + "/is_locked", timeout=5) as r:
        return json.load(r)["locked"]


def post_execute(body: bytes) -> int:
    req = urllib.request.Request(
        EXECUTOR + "/execute/translate", data=body, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def test_avif_image_survives_the_pickle_allowlist():
    """Anh AVIF phai qua duoc restricted_loads y het anh PNG."""
    import pillow_avif  # noqa: F401  (side-effect: dang ky AVIF vao PIL)
    from PIL import Image
    from share import restricted_loads

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), "white").save(buf, format="AVIF")
    buf.seek(0)
    img = Image.open(buf)
    img.load()
    assert type(img).__module__ == "pillow_avif.AvifImagePlugin", type(img)

    restored = restricted_loads(pickle.dumps({"image": img}))

    assert restored["image"].size == (8, 8), restored["image"].size


def test_executor_releases_the_lock_when_unpickling_fails():
    """Pickle bi tu choi khong duoc lam ket khoa cua executor."""
    assert not is_locked(), "executor da bi ket khoa TRUOC khi test chay"

    import decimal  # module khong nam trong SAFE_PICKLE_MODULES
    status = post_execute(pickle.dumps({"image": decimal.Decimal("1")}))

    assert status == 500, status
    assert not is_locked(), "khoa bi ro: moi request sau day se an HTTP 429"


# Chay HET moi test roi moi bao loi: hai loi doc lap nhau, dung lai o cai dau
# tien thi khong thay duoc cai thu hai.
failed = 0
for test in (test_avif_image_survives_the_pickle_allowlist,
             test_executor_releases_the_lock_when_unpickling_fails):
    try:
        test()
    except AssertionError as e:
        print("FAIL  " + test.__name__ + ": " + str(e))
        failed += 1
        continue
    except Exception as e:
        print("FAIL  " + test.__name__ + ": " + type(e).__name__ + ": " + str(e))
        failed += 1
        continue
    print("PASS  " + test.__name__)

if failed:
    sys.exit(1)
print("TAT CA TEST PASS")
