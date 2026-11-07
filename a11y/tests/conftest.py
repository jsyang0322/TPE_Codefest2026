import pytest
from fastapi.testclient import TestClient

from backend import config, store
from backend.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    """每個測試用新的暫存資料庫、清空的記憶體狀態；測試不連官方網站。用 with 才會執行 lifespan。"""
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(config, "FAQ_AUTO_SYNC", False)
    store.reset()
    with TestClient(app) as test_client:
        yield test_client
    store.reset()
