import os
from typing import Any
from urllib.parse import unquote

import pytest
from _pytest.monkeypatch import MonkeyPatch
from elastic_transport import ApiResponseMeta, HttpHeaders, NodeConfig, Transport

from core.rag.datasource.vdb.field import Field


class InMemoryElasticsearchTransport:
    """Handle Elasticsearch requests after the real clients serialize them."""

    def __init__(self) -> None:
        self.indices: set[str] = set()
        self.documents: dict[str, dict[str, dict[str, Any]]] = {}
        self.meta = ApiResponseMeta(
            status=200,
            http_version="1.1",
            headers=HttpHeaders({"x-elastic-product": "Elasticsearch"}),
            duration=0.0,
            node=NodeConfig("https", "127.0.0.1", 9200),
        )

    def perform_request(self, method: str, target: str, *, body: Any = None, **kwargs):
        parts = [unquote(part) for part in target.split("?", 1)[0].split("/") if part]
        index = parts[0] if parts else ""

        if method == "HEAD":
            exists = index in self.indices if len(parts) == 1 else parts[-1] in self.documents.get(index, {})
            return self._response({"exists": exists}, status=200 if exists else 404)

        if method in {"PUT", "POST"} and len(parts) == 1:
            self.indices.add(index)
            self.documents.setdefault(index, {})
            return self._response({"acknowledged": True})

        if method in {"PUT", "POST"} and len(parts) >= 3 and parts[1] in {"_doc", "_create"}:
            self.indices.add(index)
            self.documents.setdefault(index, {})[parts[2]] = body
            return self._response({"result": "created", "_id": parts[2]}, status=201)

        if parts[-1:] == ["_refresh"]:
            return self._response({"_shards": {"successful": 1}})

        if parts[-1:] == ["_search"]:
            stored_documents = list(self.documents.get(index, {}).values())
            seed = (
                stored_documents[0]
                if stored_documents
                else {
                    Field.CONTENT_KEY: "test_text",
                    Field.VECTOR: [1.0, 2.0],
                    Field.METADATA_KEY: {},
                }
            )
            hits = [
                {"_id": str(position), "_source": seed, "_score": score}
                for position, score in enumerate((1.0, 0.9, 0.8), start=1)
            ]
            return self._response({"took": 1, "hits": {"hits": hits}})

        if method == "DELETE" and len(parts) >= 3 and parts[1] == "_doc":
            self.documents.get(index, {}).pop(parts[2], None)
            return self._response({"result": "deleted"})

        if method == "DELETE" and len(parts) == 1:
            self.indices.discard(index)
            self.documents.pop(index, None)
            return self._response({"acknowledged": True})

        raise AssertionError(f"Unhandled Elasticsearch request: {method} {target} body={body}")

    def _response(self, body: Any, status: int = 200):
        if status == self.meta.status:
            return self.meta, body
        return ApiResponseMeta(
            status=status,
            http_version=self.meta.http_version,
            headers=self.meta.headers,
            duration=self.meta.duration,
            node=self.meta.node,
        ), body


MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture
def setup_client_mock(monkeypatch: MonkeyPatch):
    if MOCK:
        transport = InMemoryElasticsearchTransport()

        def perform_request(client, method, target, **kwargs):
            return transport.perform_request(method, target, **kwargs)

        monkeypatch.setattr(Transport, "perform_request", perform_request)
