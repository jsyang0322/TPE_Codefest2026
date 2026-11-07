"""統一的錯誤格式（規格第二部分第 5 節）：

    { "error": "consent_payload_mismatch", "message": "操作內容與同意時不同" }

message 是可以直接顯示並朗讀給使用者的繁體中文句子。
"""

from fastapi import Request
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, error: str, message: str):
        super().__init__(message)
        self.status = status
        self.error = error
        self.message = message


async def api_error_handler(_request: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse({"error": exc.error, "message": exc.message}, status_code=exc.status)
