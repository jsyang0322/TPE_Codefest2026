"""FastAPI 進入點：註冊路由、啟動背景工作、掛載 frontend 靜態檔。

在 a11y/ 資料夾執行：
    uvicorn backend.main:app --reload
"""

import asyncio
import inspect
import logging
import mimetypes
from collections.abc import Callable
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import auth, care, config, db, faq, faq_sync, share, ws
from .errors import ApiError, api_error_handler

log = logging.getLogger("a11y")

# Windows 可能從登錄檔把 .js 對應成 text/plain，瀏覽器就不會執行 <script type="module">
mimetypes.add_type("text/javascript", ".js")

# 背景工作：每 HOUSEKEEPING_INTERVAL_SECONDS 秒執行一次（可以是一般函式或 async 函式）
HOUSEKEEPING_JOBS: list[Callable] = [
    auth.expire_idle_logins,      # 閒置太久自動登出（授權跟著結束）
    care.expire_bind_codes,       # 過期的數字碼
    care.expire_pending_links,    # 照顧者輸入數字碼後，被照顧者一直沒回應
]


async def run_housekeeping_once() -> None:
    """每項工作各自處理錯誤，一項失敗不影響其他項。"""
    for job in HOUSEKEEPING_JOBS:
        try:
            result = job()
            if inspect.isawaitable(result):
                await result
        except Exception:
            log.exception("housekeeping job %s failed", getattr(job, "__name__", job))


async def housekeeping_loop() -> None:
    while True:
        await asyncio.sleep(config.HOUSEKEEPING_INTERVAL_SECONDS)
        await run_housekeeping_once()


async def faq_sync_loop() -> None:
    """沒有資料或超過同步間隔就從官方網站同步。失敗（例如沒有網路）時保留原本的資料，稍後再試。"""
    while True:
        wait_minutes = 60
        if faq_sync.needs_sync():
            try:
                await asyncio.to_thread(faq_sync.sync)
            except Exception:
                log.exception("FAQ 同步失敗，保留原本的資料，%d 分鐘後再試", config.FAQ_SYNC_RETRY_MINUTES)
                wait_minutes = config.FAQ_SYNC_RETRY_MINUTES
        await asyncio.sleep(wait_minutes * 60)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init()
    tasks = [asyncio.create_task(housekeeping_loop())]
    if config.FAQ_AUTO_SYNC:
        tasks.append(asyncio.create_task(faq_sync_loop()))
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


app = FastAPI(title="台北通無障礙輔助", lifespan=lifespan)
app.add_exception_handler(ApiError, api_error_handler)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request, exc: RequestValidationError) -> JSONResponse:
    # 和其他錯誤同一個格式，網頁可以直接顯示並朗讀 message
    detail = jsonable_encoder(exc.errors())
    return JSONResponse({"error": "invalid_request", "message": "資料格式不正確", "detail": detail}, status_code=422)


for router in (faq.router, auth.router, care.router, share.router, ws.router):
    app.include_router(router)


@app.get("/api/health")
def health() -> dict:
    """網頁用來確認連得到後端（手機實測時也看這個）。"""
    return {"ok": True}


# 一定要最後掛載：放在前面會把 /api 路由蓋掉
app.mount("/", StaticFiles(directory=config.FRONTEND_DIR, html=True), name="frontend")
