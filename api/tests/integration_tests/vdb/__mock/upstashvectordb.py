import os
from typing import Optional

import pytest
from _pytest.monkeypatch import MonkeyPatch
from upstash_vector import Index


# Mocking the Index class from upstash_vector
class MockIndex:
    def __init__(self, url="", token=""):
        self.url = url
        self.token = token
        self.vectors = []

    def upsert(self, vectors):
        for vector in vectors:
            vector.score = 0.5
            self.vectors.append(vector)
        return {"code": 0, "msg": "operation success", "affectedCount": len(vectors)}

    def fetch(self, ids):
        return [vector for vector in self.vectors if vector.id in ids]

    def delete(self, ids):
        self.vectors = [vector for vector in self.vectors if vector.id not in ids]
        return {"code": 0, "msg": "Success"}

    def query(
        self,
        vector: None,
        top_k: int = 10,
        include_vectors: bool = False,
        include_metadata: bool = False,
        filter: str = "",
        data: Optional[str] = None,
        namespace: str = "",
        include_data: bool = False,
    ):
        # Simple mock query, in real scenario you would calculate similarity
        mock_result = []
        for vector_data in self.vectors:
            mock_result.append(vector_data)
        return mock_result[:top_k]

    def reset(self):
        self.vectors = []

    def info(self):
        return AttrDict({"dimension": 1024})


class AttrDict(dict):
    def __getattr__(self, item):
        return self.get(item)


MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture
def setup_upstashvector_mock(request, monkeypatch: MonkeyPatch):
    if MOCK:
        monkeypatch.setattr(Index, "__init__", MockIndex.__init__)
        monkeypatch.setattr(Index, "upsert", MockIndex.upsert)
        monkeypatch.setattr(Index, "fetch", MockIndex.fetch)
        monkeypatch.setattr(Index, "delete", MockIndex.delete)
        monkeypatch.setattr(Index, "query", MockIndex.query)
        monkeypatch.setattr(Index, "reset", MockIndex.reset)
        monkeypatch.setattr(Index, "info", MockIndex.info)

    yield

    if MOCK:
        monkeypatch.undo()
