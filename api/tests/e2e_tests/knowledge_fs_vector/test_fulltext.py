"""CI-owned full-text acceptance against actual vector services, no model calls."""

import hashlib
import os
from operator import itemgetter
from uuid import uuid4

import pytest

from configs import dify_config
from services.knowledge_fs.text_store import TextPayload, configured_text_client, execute_text_request
from services.knowledge_fs.text_store_native import ElasticsearchTextStore, QdrantTextStore

pytestmark = pytest.mark.skipif(
    os.getenv("KNOWLEDGE_FS_VECTOR_INTEGRATION") != "1", reason="Requires CI vector services"
)


@pytest.mark.parametrize("backend", ["elasticsearch", "weaviate", "qdrant"])
def test_fulltext_native_write_search_isolation_retry_and_delete(monkeypatch, backend):
    monkeypatch.setattr(dify_config, "VECTOR_STORE", backend)
    scope = {"tenant_id": str(uuid4()), "knowledge_space_id": str(uuid4()), "index_version": "fulltext-ci-v1"}
    points = [
        {
            "id": str(uuid4()),
            "generation_id": str(uuid4()),
            "text": text,
            "content_hash": hashlib.sha256(text.encode()).hexdigest(),
        }
        for text in ["refund policy 退 款 规 则", "refund refund refund private 退 款", "vacation 假 期"]
    ]

    def request(operation, **kwargs):
        return TextPayload.model_validate({"operation": operation, "scope": scope, **kwargs})

    with configured_text_client(scope["tenant_id"]) as store:
        try:
            for _ in range(2):
                execute_text_request(store, request("upsert", points=points))
            read = execute_text_request(store, request("get", ids=[p["id"] for p in points]))["points"]
            assert sorted(read, key=itemgetter("id")) == sorted(points, key=itemgetter("id"))
            for query in ["refund", "退 款"]:
                matches = execute_text_request(
                    store, request("search", ids=[points[0]["id"], points[2]["id"]], query=query, limit=1)
                )["matches"]
                assert [m["id"] for m in matches] == [points[0]["id"]]
                assert matches[0]["score"] > 0
            assert not execute_text_request(
                store, request("search", ids=[p["id"] for p in points], query="absentword")
            )["matches"]
            assert not execute_text_request(
                store, request("search", ids=[p["id"] for p in points], query="refund vacation")
            )["matches"]
            assert [
                m["id"]
                for m in execute_text_request(
                    store, request("search", ids=[p["id"] for p in points], query="refund policy")
                )["matches"]
            ] == [points[0]["id"]]
            for key in scope:
                isolated = TextPayload.model_validate(
                    {"operation": "get", "scope": {**scope, key: str(uuid4())}, "ids": [points[0]["id"]]}
                )
                assert not execute_text_request(store, isolated)["points"]
            for _ in range(2):
                execute_text_request(store, request("delete", ids=[points[0]["id"]]))
            assert not execute_text_request(store, request("get", ids=[points[0]["id"]]))["points"]
            assert len(execute_text_request(store, request("get", ids=[points[1]["id"]]))["points"]) == 1
            assert not execute_text_request(store, request("search", ids=[points[0]["id"]], query="refund"))["matches"]
        finally:
            name = request("get", ids=[points[0]["id"]]).scope.collection_name
            if isinstance(store, ElasticsearchTextStore):
                store.client.indices.delete(index=name, ignore_unavailable=True)
            elif isinstance(store, QdrantTextStore):
                store.client.delete_collection(name)
            else:
                store.client.collections.delete(name.capitalize())
