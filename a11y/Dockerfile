# 無障礙輔助：後端（FastAPI）同時提供網頁、API 與分享畫面的轉送。
# 交給資訊局在自己的伺服器執行：docker build -t a11y . && docker run -d -p 8080:8080 a11y
# 登入與分享的狀態存在記憶體，只能跑一份。埠號讀環境變數 PORT。
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    A11Y_DB_PATH=/tmp/a11y.db \
    PORT=8080

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend ./backend
COPY frontend ./frontend

CMD ["sh", "-c", "exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT}"]
