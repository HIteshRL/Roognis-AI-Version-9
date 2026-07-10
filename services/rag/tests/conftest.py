import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-rag-secret")
os.environ.setdefault("RAG_TEST_MODE", "true")

from main import app


@pytest.fixture()
def client():
    return TestClient(app)
