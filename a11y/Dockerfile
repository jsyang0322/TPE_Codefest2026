# 無障礙輔助：後端（FastAPI）同時提供網頁與 API。
# Cloud Run：在 a11y/ 執行 gcloud run deploy（指令見 README.md「部署」）。Cloud Run 會給 PORT。
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
