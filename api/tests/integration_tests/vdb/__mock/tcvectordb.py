import os
from typing import Optional, Union

import pytest
from _pytest.monkeypatch import MonkeyPatch
from requests.adapters import HTTPAdapter
from tcvectordb import RPCVectorDBClient  # type: ignore
from tcvectordb.model.collection import FilterIndexConfig
from tcvectordb.model.document import Document, Filter  # type: ignore
from tcvectordb.model.enum import ReadConsistency  # type: ignore
from tcvectordb.model.index import Index, IndexField  # type: ignore
from tcvectordb.rpc.model.collection import RPCCollection
from tcvectordb.rpc.model.database import RPCDatabase
from xinference_client.types import Embedding  # type: ignore


class MockTcvectordbClass:
    def mock_vector_db_client(
        self,
        url: str,
        username="",
        key="",
        read_consistency: ReadConsistency = ReadConsistency.EVENTUAL_CONSISTENCY,
        timeout=10,
        adapter: HTTPAdapter = None,
        pool_size: int = 2,
        proxies: Optional[dict] = None,
        password: Optional[str] = None,
        **kwargs,
    ):
        self._conn = None
        self._read_consistency = read_consistency

    def create_database_if_not_exists(self, database_name: str, timeout: Optional[float] = None) -> RPCDatabase:
        return RPCDatabase(
            name="dify",
            read_consistency=self._read_consistency,
        )

    def exists_collection(self, database_name: str, collection_name: str) -> bool:
        return True

    def create_collection(
        self,
        database_name: str,
        collection_name: str,
        shard: int,
        replicas: int,
        description: Optional[str] = None,
        index: Index = None,
        embedding: Embedding = None,
        timeout: Optional[float] = None,
        ttl_config: Optional[dict] = None,
        filter_index_config: FilterIndexConfig = None,
        indexes: Optional[list[IndexField]] = None,
    ) -> RPCCollection:
        return RPCCollection(
            RPCDatabase(
                name="dify",
                read_consistency=self._read_consistency,
            ),
            collection_name,
            shard,
            replicas,
            description,
            index,
            embedding=embedding,
            read_consistency=self._read_consistency,
            timeout=timeout,
            ttl_config=ttl_config,
            filter_index_config=filter_index_config,
            indexes=indexes,
        )

    def collection_upsert(
        self,
        database_name: str,
        collection_name: str,
        documents: list[Union[Document, dict]],
        timeout: Optional[float] = None,
        build_index: bool = True,
        **kwargs,
    ):
        return {"code": 0, "msg": "operation success"}

    def collection_search(
        self,
        database_name: str,
        collection_name: str,
        vectors: list[list[float]],
        filter: Filter = None,
        params=None,
        retrieve_vector: bool = False,
        limit: int = 10,
        output_fields: Optional[list[str]] = None,
        timeout: Optional[float] = None,
    ) -> list[list[dict]]:
        return [[{"metadata": {"doc_id": "foo1"}, "text": "text", "doc_id": "foo1", "score": 0.1}]]

    def collection_query(
        self,
        database_name: str,
        collection_name: str,
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
        database_name: str,
        collection_name: str,
        document_ids: Optional[list[str]] = None,
        filter: Filter = None,
        timeout: Optional[float] = None,
    ):
        return {"code": 0, "msg": "operation success"}

    def drop_collection(self, database_name: str, collection_name: str, timeout: Optional[float] = None) -> dict:
        return {"code": 0, "msg": "operation success"}


MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture
def setup_tcvectordb_mock(request, monkeypatch: MonkeyPatch):
    if MOCK:
        monkeypatch.setattr(RPCVectorDBClient, "__init__", MockTcvectordbClass.mock_vector_db_client)
        monkeypatch.setattr(
            RPCVectorDBClient, "create_database_if_not_exists", MockTcvectordbClass.create_database_if_not_exists
        )
        monkeypatch.setattr(RPCVectorDBClient, "exists_collection", MockTcvectordbClass.exists_collection)
        monkeypatch.setattr(RPCVectorDBClient, "create_collection", MockTcvectordbClass.create_collection)
        monkeypatch.setattr(RPCVectorDBClient, "upsert", MockTcvectordbClass.collection_upsert)
        monkeypatch.setattr(RPCVectorDBClient, "search", MockTcvectordbClass.collection_search)
        monkeypatch.setattr(RPCVectorDBClient, "query", MockTcvectordbClass.collection_query)
        monkeypatch.setattr(RPCVectorDBClient, "delete", MockTcvectordbClass.collection_delete)
        monkeypatch.setattr(RPCVectorDBClient, "drop_collection", MockTcvectordbClass.drop_collection)

    yield

    if MOCK:
        monkeypatch.undo()
