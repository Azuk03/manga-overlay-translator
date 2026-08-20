# patches/http_retry.py
"""Tai anh tu CDN co retry va ep IPv4.

Do duoc 2026-08-18: khi may co Cloudflare WARP bat, connect toi CDN anh hong
khoang 4% (o dung ~21s) va cac lan thanh cong cung mat 2.5-10s; tat WARP thi
10/10 thanh cong trong 0.65s. Nguoi dung cuoi o Viet Nam nhieu kha nang phai
dung VPN nen se gap dung loi nay.

Ep IPv4 bang local_address="0.0.0.0": CDN co ca ban ghi A lan AAAA nhung
container khong co route IPv6, nen nhanh IPv6 luon hong tuc thi va httpx bao
LEN chinh loi cua nhanh do ("Network is unreachable") du loi that nam o nhanh
IPv4 - thong bao gay hieu sai. Ep IPv4 don luon cai nhieu do.
"""
import asyncio

import httpx

CONNECT_TIMEOUT = 8.0
READ_TIMEOUT = 30.0


def _default_client_factory():
    return httpx.AsyncClient(
        follow_redirects=True,
        timeout=httpx.Timeout(
            connect=CONNECT_TIMEOUT, read=READ_TIMEOUT, write=READ_TIMEOUT, pool=CONNECT_TIMEOUT
        ),
        transport=httpx.AsyncHTTPTransport(local_address="0.0.0.0"),
    )


async def fetch_with_retry(url, headers, attempts=3, client_factory=None):
    """Tra ve httpx.Response. Chi retry loi TANG VAN CHUYEN (httpx.HTTPError).

    Ma loi HTTP that (403/404...) KHONG duoc retry: do la cau tra loi hop le
    cua CDN, thu lai chi ton thoi gian.
    """
    factory = client_factory or _default_client_factory
    last_err = None
    for attempt in range(attempts):
        try:
            async with factory() as client:
                return await client.get(url, headers=headers)
        except httpx.HTTPError as e:
            last_err = e
            if attempt < attempts - 1:
                await asyncio.sleep(0.5 * (2 ** attempt))
    raise last_err
