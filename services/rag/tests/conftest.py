import os

import jwt
import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "test-rag-secret-with-enough-length")
os.environ.setdefault("RAG_DB_SCHEMA", "")
os.environ.setdefault("RAG_TEST_MODE", "true")

from main import app


@pytest.fixture()
def client():
    return TestClient(app)


@pytest.fixture()
def token_factory():
    def create_token(role: str = "teacher", **overrides):
        payload = {
            "userId": "11111111-1111-1111-1111-111111111111",
            "role": role,
            "schoolId": "22222222-2222-2222-2222-222222222222",
            **overrides,
        }
        return jwt.encode(payload, os.environ["JWT_SECRET"], algorithm="HS256")

    return create_token
