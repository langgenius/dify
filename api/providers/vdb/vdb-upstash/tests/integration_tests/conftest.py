import os
import re
from typing import Any

import pytest
from _pytest.monkeypatch import MonkeyPatch
from upstash_vector import Index


class InMemoryUpstashTransport:
    """Handle serialized Upstash requests below IndexOperations."""

    def __init__(self) -> None:
        self.vectors: dict[str, dict[str, Any]] = {}

    def execute(self, payload: Any = "", path: str = ""):
        if path == "/upsert":
            for vector in payload:
                self.vectors[str(vector["id"])] = vector
            return "Success"

        if path == "/query":
            vectors = list(self.vectors.values())
            if value_match := re.fullmatch(r"([A-Za-z0-9_.]+) = '([^']*)'", payload.get("filter", "")):
                key, value = value_match.groups()
                vectors = [vector for vector in vectors if (vector.get("metadata") or {}).get(key) == value]
            return [
                {
                    "id": str(vector["id"]),
                    "score": 0.9,
                    "vector": vector.get("vector") if payload.get("includeVectors") else None,
                    "metadata": vector.get("metadata") if payload.get("includeMetadata") else None,
                    "data": vector.get("data") if payload.get("includeData") else None,
                }
                for vector in vectors[: payload["topK"]]
            ]

        if path == "/delete":
            deleted = 0
            for vector_id in payload.get("ids", []):
                if self.vectors.pop(str(vector_id), None) is not None:
                    deleted += 1
            return {"deleted": deleted}

        if path == "/fetch":
            return [self.vectors.get(str(vector_id)) for vector_id in payload.get("ids", [])]

        if path == "/reset":
            self.vectors.clear()
            return "Success"

        if path == "/info":
            return {
                "vectorCount": len(self.vectors),
                "pendingVectorCount": 0,
                "indexSize": 0,
                "dimension": 1024,
                "similarityFunction": "COSINE",
                "namespaces": {
                    "": {
                        "vectorCount": len(self.vectors),
                        "pendingVectorCount": 0,
                    }
                },
            }

        raise AssertionError(f"Unhandled Upstash request: path={path} payload={payload}")


MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture
def setup_upstashvector_mock(monkeypatch: MonkeyPatch):
    if MOCK:
        transport = InMemoryUpstashTransport()

        def execute_request(client, payload="", path=""):
            return transport.execute(payload=payload, path=path)

        monkeypatch.setattr(Index, "_execute_request", execute_request)
