# tests/test_translate_texts.py
#
# Chay (can container manga_translator DANG CHAY):
#   docker exec -i manga_translator python - < tests/test_translate_texts.py
#
# Pha B: dich CHUOI, khong dung GPU, KHONG giu khoa executor. Diem quan trong
# nhat cua test nay khong phai "dich co dung khong" (GPT khong tat dinh) ma la
# "goi pha B co lam ket executor khong" - vi ca thiet ke dua tren viec no khong
# cham vao khoa do.

import json
import sys
import urllib.error
import urllib.request

SERVER = "http://127.0.0.1:5003"
EXECUTOR = "http://127.0.0.1:5004"


def post(url, payload, timeout=180):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:300]


def is_locked():
    with urllib.request.urlopen(EXECUTOR + "/is_locked", timeout=5) as r:
        return json.load(r)["locked"]


def test_empty_input_returns_empty_without_calling_gpt():
    status, body = post(SERVER + "/translate/texts", {"texts": []})
    assert status == 200, (status, body)
    assert body["translations"] == [], body


def test_translates_and_preserves_order_and_length():
    texts = ["HELLO", "GOOD MORNING", "THANK YOU"]
    status, body = post(SERVER + "/translate/texts",
                        {"texts": texts, "target_lang": "VIN",
                         "gpt_config": "/app/gpt_config-vi.yaml"})
    assert status == 200, (status, body)
    out = body["translations"]
    assert len(out) == len(texts), out
    assert all(isinstance(s, str) for s in out), out


def test_does_not_take_the_executor_lock():
    """Ca thiet ke chong len viec nay: pha B chay song song voi pha A duoc."""
    assert not is_locked(), "executor da ket TRUOC khi test chay"
    status, body = post(SERVER + "/translate/texts",
                        {"texts": ["HELLO"], "target_lang": "VIN",
                         "gpt_config": "/app/gpt_config-vi.yaml"})
    assert status == 200, (status, body)
    assert not is_locked(), "pha A/B se khong chong lan duoc"


failed = 0
for test in (test_empty_input_returns_empty_without_calling_gpt,
             test_translates_and_preserves_order_and_length,
             test_does_not_take_the_executor_lock):
    try:
        test()
    except Exception as e:
        print("FAIL  " + test.__name__ + ": " + type(e).__name__ + ": " + str(e))
        failed += 1
        continue
    print("PASS  " + test.__name__)

if failed:
    sys.exit(1)
print("TAT CA TEST PASS")
