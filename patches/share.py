import asyncio
import pickle
import io
import secrets
from threading import Lock

import uvicorn
from fastapi import FastAPI, HTTPException, Path, Request, Response
from pydantic import BaseModel

from starlette.responses import StreamingResponse

from manga_translator import MangaTranslator

SAFE_PICKLE_MODULES = frozenset({
    'builtins',
    'collections',
    'numpy',
    'numpy.core.multiarray',
    'numpy.dtype',
    'manga_translator',
    'manga_translator.utils',
    'manga_translator.utils.generic',
    'manga_translator.config'
})

class RestrictedUnpickler(pickle.Unpickler):
    def find_class(self, module: str, name: str):
        if module in SAFE_PICKLE_MODULES or module.startswith('PIL.'):
            return super().find_class(module, name)
        raise pickle.UnpicklingError(
            f"Deserialization of {module}.{name} is not allowed"
        )


def restricted_loads(data: bytes):
    return RestrictedUnpickler(io.BytesIO(data)).load()

class MethodCall(BaseModel):
    method_name: str
    attributes: bytes





class MangaShare:
    def __init__(self, params: dict = None):
        self.manga = MangaTranslator(params)
        self.host = params.get('host', '127.0.0.1')
        self.port = int(params.get('port', '5003'))
        nonce = params.get('nonce', None)
        if not nonce:
            nonce = secrets.token_hex(16)
        if nonce == "None":
            nonce = None
        self.nonce = nonce

        # each chunk has a structure like this status_code(int/1byte),len(int/4bytes),bytechunk
        # status codes are 0 for result, 1 for progress report, 2 for error
        self.progress_queue = asyncio.Queue()
        self.lock = Lock()

        async def hook(state: str, finished: bool):
            state_data = state.encode("utf-8")
            progress_data = b'\x01' + len(state_data).to_bytes(4, 'big') + state_data
            await self.progress_queue.put(progress_data)
            await asyncio.sleep(0)

        self.manga.add_progress_hook(hook)

    async def progress_stream(self):
        """
        loops until the status is != 1 which is eiter an error or the result
        """
        while True:
            progress = await self.progress_queue.get()
            yield progress
            if progress[0] != 1:
                break

    async def run_method(self, method, **attributes):
        try:
            # Ngu canh thoai client gui kem, chi song trong dung luot nay.
            # An toan vi check_lock() da gianh khoa doc quyen truoc khi toi day
            # (luot thu hai bi tra HTTP 429), nen khong the co hai luot chen nhau.
            from manga_translator.translators import chatgpt as _mot_chatgpt
            _mot_chatgpt.REQUEST_CONTEXT = list(
                getattr(attributes.get("config", None), "_mot_context", None) or [])

            if asyncio.iscoroutinefunction(method):
                result = await method(**attributes)
            else:
                result = method(**attributes)

            # 检查是否使用占位符，如果是则创建最小化的结果对象
            if hasattr(result, 'use_placeholder') and result.use_placeholder:
                # 创建一个最小的Context对象，只包含占位符图片，避免传输大量数据
                from manga_translator import Context
                from PIL import Image
                minimal_result = Context()
                minimal_result.result = Image.new('RGB', (1, 1), color='white')
                minimal_result.use_placeholder = True
                result_bytes = pickle.dumps(minimal_result)
            elif getattr(attributes.get("config", None), "_response_format", None) == "json":
                # json fast-path: dung san TranslationResponse ngay tren executor
                # (noi da co ctx.img_inpainted) roi chi pickle cai do (~108KB-vai MB)
                # thay vi pickle ca Context ~108MB roi truyen qua tien trinh server.
                from server.to_json import to_translation
                result_bytes = pickle.dumps(to_translation(result))
            else:
                result_bytes = pickle.dumps(result)

            encoded_result = b'\x00' + len(result_bytes).to_bytes(4, 'big') + result_bytes
            await self.progress_queue.put(encoded_result)
        except Exception as e:
            err_bytes = str(e).encode("utf-8")
            encoded_result = b'\x02' + len(err_bytes).to_bytes(4, 'big') + err_bytes
            await self.progress_queue.put(encoded_result)
        finally:
            # Xoa NGAY: de sot lai thi luot sau (co the la truyen khac, tab khac)
            # se lay nham ngu canh - dung tai hoa AM THAM ma spec canh bao.
            try:
                from manga_translator.translators import chatgpt as _mot_chatgpt
                _mot_chatgpt.REQUEST_CONTEXT = []
            except Exception:
                pass
            self.lock.release()


    def check_nonce(self, request: Request):
        if self.nonce:
            nonce = request.headers.get('X-Nonce')
            if nonce != self.nonce:
                raise HTTPException(401, detail="Nonce does not match")

    def check_lock(self):
        if not self.lock.acquire(blocking=False):
            raise HTTPException(status_code=429, detail="some Method is already being executed.")

    def get_fn(self, method_name: str):
        if method_name.startswith("__"):
            raise HTTPException(status_code=403, detail="These functions are not allowed to be executed remotely")
        method = getattr(self.manga, method_name, None)
        if not method:
            raise HTTPException(status_code=404, detail="Method not found")
        return method

    async def listen(self, translation_params: dict = None):
        app = FastAPI()

        @app.get("/is_locked")
        async def is_locked():
            if self.lock.locked():
                return {"locked": True}
            return {"locked": False}

        @app.post("/simple_execute/{method_name}")
        async def execute_method(request: Request, method_name: str = Path(...)):
            self.check_nonce(request)
            self.check_lock()
            method = self.get_fn(method_name)
            attr = restricted_loads(await request.body())
            try:
                if asyncio.iscoroutinefunction(method):
                    result = await method(**attr)
                else:
                    result = method(**attr)
                self.lock.release()
                result_bytes = pickle.dumps(result)
                return Response(content=result_bytes, media_type="application/octet-stream")
            except Exception as e:
                self.lock.release()
                raise HTTPException(status_code=500, detail=str(e))

        @app.post("/execute/{method_name}")
        async def execute_method(request: Request, method_name: str = Path(...)):
            self.check_nonce(request)
            self.check_lock()
            method = self.get_fn(method_name)
            attr = restricted_loads(await request.body())

            # 根据端点类型决定是否使用占位符优化
            config = attr.get('config')
            self.manga._is_streaming_mode = getattr(config, '_web_frontend_optimized', False) if config else False

            # streaming response
            streaming_response = StreamingResponse(self.progress_stream(), media_type="application/octet-stream")
            asyncio.create_task(self.run_method(method, **attr))
            return streaming_response

        config = uvicorn.Config(app, host=self.host, port=self.port)
        server = uvicorn.Server(config)
        await server.serve()
