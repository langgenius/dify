import os
from typing import Optional

import pytest
from _pytest.monkeypatch import MonkeyPatch
from requests.adapters import HTTPAdapter
from tcvectordb import VectorDBClient
from tcvectordb.model.database import Collection, Database
from tcvectordb.model.document import Document, Filter
from tcvectordb.model.enum import ReadConsistency
from tcvectordb.model.index import Index
from xinference_client.types import Embedding


class MockTcvectordbClass:
    def mock_vector_db_client(
        self,
        url=None,
        username="",
        key="",
        read_consistency: ReadConsistency = ReadConsistency.EVENTUAL_CONSISTENCY,
        timeout=5,
        adapter: HTTPAdapter = None,
    ):
        self._conn = None
        self._read_consistency = read_consistency

    def list_databases(self) -> list[Database]:
        return [
            Database(
                conn=self._conn,
                read_consistency=self._read_consistency,
                name="dify",
            )
        ]

    def list_collections(self, timeout: Optional[float] = None) -> list[Collection]:
        return []

    def drop_collection(self, name: str, timeout: Optional[float] = None):
        return {"code": 0, "msg": "operation success"}

    def create_collection(
        self,
        name: str,
        shard: int,
        replicas: int,
        description: str,
        index: Index,
        embedding: Embedding = None,
        timeout: float = None,
    ) -> Collection:
        return Collection(
            self,
            name,
            shard,
            replicas,
            description,
            index,
            embedding=embedding,
            read_consistency=self._read_consistency,
            timeout=timeout,
        )

    def describe_collection(self, name: str, timeout: Optional[float] = None) -> Collection:
        collection = Collection(self, name, shard=1, replicas=2, description=name, timeout=timeout)
        return collection

    def collection_upsert(
        self, documents: list[Document], timeout: Optional[float] = None, build_index: bool = True, **kwargs
    ):
        return {"code": 0, "msg": "operation success"}

    def collection_search(
        self,
        vectors: list[list[float]],
        filter: Filter = None,
        params=None,
        retrieve_vector: bool = False,
        limit: int = 10,
        output_fields: Optional[list[str]] = None,
        timeout: Optional[float] = None,
    ) -> list[list[dict]]:
        return [[{"metadata": '{"doc_id":"foo1"}', "text": "text", "doc_id": "foo1", "score": 0.1}]]

    def collection_query(
        self,
        document_ids: Optional[list] = None,
        retrieve_vector: bool = False,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        filter: Optional[Filter] = None,
        output_fields: Optional[list[str]] = None,
        timeout: Optional[float] = None,
    ) -> list[dict]:
        return [{"metadata": '{"doc_id":"foo1"}', "text": "text", "doc_id": "foo1", "score": 0.1}]

    def collection_delete(
        self,
        document_ids: list[str] = None,
        filter: Filter = None,
        timeout: float = None,
    ):
        return {"code": 0, "msg": "operation success"}


MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture()
def setup_tcvectordb_mock(request, monkeypatch: MonkeyPatch):
    if MOCK:
        monkeypatch.setattr(VectorDBClient, "__init__", MockTcvectordbClass.mock_vector_db_client)
        monkeypatch.setattr(VectorDBClient, "list_databases", MockTcvectordbClass.list_databases)
        monkeypatch.setattr(Database, "collection", MockTcvectordbClass.describe_collection)
        monkeypatch.setattr(Database, "list_collections", MockTcvectordbClass.list_collections)
        monkeypatch.setattr(Database, "drop_collection", MockTcvectordbClass.drop_collection)
        monkeypatch.setattr(Database, "create_collection", MockTcvectordbClass.create_collection)
        monkeypatch.setattr(Collection, "upsert", MockTcvectordbClass.collection_upsert)
        monkeypatch.setattr(Collection, "search", MockTcvectordbClass.collection_search)
        monkeypatch.setattr(Collection, "query", MockTcvectordbClass.collection_query)
        monkeypatch.setattr(Collection, "delete", MockTcvectordbClass.collection_delete)

    yield

    if MOCK:
        monkeypatch.undo()
