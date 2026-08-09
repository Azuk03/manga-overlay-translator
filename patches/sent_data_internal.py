import json
import pickle
from typing import Mapping, Optional, Callable

import aiohttp
from PIL.Image import Image
from fastapi import HTTPException

from manga_translator import Config

NotifyType = Optional[Callable[[int, Optional[bytes]], None]]

async def fetch_data_stream(url, image: Image, config: Config, sender: NotifyType, headers: Mapping[str, str] = {}):
    attributes = {"image": image, "config": config}
    data = pickle.dumps(attributes)

    async with aiohttp.ClientSession() as session:
        async with session.post(url, data=data, headers=headers) as response:
            if response.status == 200:
                await process_stream(response, sender)
            else:
                raise HTTPException(response.status, detail=await response.text())

async def fetch_data(url, image: Image, config: Config, headers: Mapping[str, str] = {}):
    attributes = {"image": image, "config": config}
    data = pickle.dumps(attributes)

    async with aiohttp.ClientSession() as session:
        async with session.post(url, data=data, headers=headers) as response:
            if response.status == 200:
                try:
                    return json.loads(await response.text())
                except json.JSONDecodeError:
                    raise HTTPException(502, detail='Invalid JSON response from upstream')
            else:
                raise HTTPException(response.status, detail=await response.text())

async def process_stream(response, sender: NotifyType):
    buffer = bytearray()

    async for chunk in response.content.iter_any():
        if chunk:
            buffer.extend(chunk)
            _drain_buffer(buffer, sender)


def _drain_buffer(buffer: bytearray, sender: NotifyType):
    """Consume every complete frame from the front of `buffer` in place.
    Frame = status(1) + size(4, big-endian) + data. Amortized O(n): we
    delete the consumed prefix once, not per-frame. The previous version
    used `buffer = buffer[k:]` bytes-slicing on every frame, which is
    O(n^2) on a large final frame (e.g. a ~108MB pickled Context)."""
    consumed = 0
    total = len(buffer)
    while total - consumed >= 5:
        status = buffer[consumed]
        expected_size = int.from_bytes(buffer[consumed + 1:consumed + 5], 'big')
        if total - consumed >= 5 + expected_size:
            data = bytes(buffer[consumed + 5:consumed + 5 + expected_size])
            sender(status, data)
            consumed += 5 + expected_size
        else:
            break
    if consumed:
        del buffer[:consumed]


def extract_header(buffer):
    """Extract the status and expected size from the buffer."""
    status = int.from_bytes(buffer[0:1], byteorder='big')
    expected_size = int.from_bytes(buffer[1:5], byteorder='big')
    return status, expected_size

