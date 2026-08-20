# tests/test_http_retry.py
# Chay: docker cp patches/http_retry.py manga_translator:/tmp/http_retry.py
#       docker exec -i manga_translator python - < tests/test_http_retry.py
import sys, asyncio
sys.path.insert(0, "/tmp")
import httpx
from http_retry import fetch_with_retry

def make_factory(script):
    """script: danh sach 'fail' hoac ma HTTP. Dem so lan thu that su."""
    calls = {"n": 0}
    def factory():
        def handler(request):
            i = calls["n"]
            calls["n"] += 1
            step = script[min(i, len(script) - 1)]
            if step == "fail":
                raise httpx.ConnectError("gia lap loi mang")
            return httpx.Response(step, content=b"anh")
        return httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return factory, calls

async def main():
    # 1. Thanh cong ngay lan dau -> chi 1 lan goi
    f, calls = make_factory([200])
    r = await fetch_with_retry("https://x/a.avif", {}, client_factory=f)
    assert r.status_code == 200, r.status_code
    assert calls["n"] == 1, calls["n"]

    # 2. Hong 2 lan roi thanh cong -> phai thu lai va tra ve ket qua tot
    f, calls = make_factory(["fail", "fail", 200])
    r = await fetch_with_retry("https://x/a.avif", {}, client_factory=f)
    assert r.status_code == 200, r.status_code
    assert calls["n"] == 3, calls["n"]

    # 3. Hong het -> nem loi cuoi cung, KHONG thu qua so lan cho phep
    f, calls = make_factory(["fail"])
    try:
        await fetch_with_retry("https://x/a.avif", {}, attempts=3, client_factory=f)
        raise AssertionError("phai nem loi khi tat ca deu hong")
    except httpx.HTTPError:
        pass
    assert calls["n"] == 3, calls["n"]

    # 4. Loi HTTP that (404) KHONG duoc retry - do la cau tra loi hop le cua CDN
    f, calls = make_factory([404])
    r = await fetch_with_retry("https://x/a.avif", {}, client_factory=f)
    assert r.status_code == 404
    assert calls["n"] == 1, calls["n"]

    print("TAT CA TEST PASS")

asyncio.run(main())
