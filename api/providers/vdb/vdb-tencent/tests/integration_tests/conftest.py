import os
from typing import Any, Union

import pytest
from _pytest.monkeypatch import MonkeyPatch
from tcvectordb import RPCVectorDBClient
from tcvectordb.model import enum
from tcvectordb.model.collection import FilterIndexConfig
from tcvectordb.model.document import AnnSearch, Document, Filter, KeywordSearch, Rerank
from tcvectordb.model.enum import ReadConsistency
from tcvectordb.model.index import FilterIndex, HNSWParams, Index, IndexField, VectorIndex
from tcvectordb.rpc.model.collection import RPCCollection
from tcvectordb.rpc.model.database import RPCDatabase
from xinference_client.types import Embedding


class MockTcvectordbClass:
    def mock_vector_db_client(
        self,
        url: str,
        username="",
        key="",
        read_consistency: ReadConsistency = ReadConsistency.EVENTUAL_CONSISTENCY,
        timeout=10,
        adapter: Any | None = None,
        pool_size: int = 2,
        proxies: dict | None = None,
        password: str | None = None,
        **kwargs,
    ):
        self._conn = None
        self._read_consistency = read_consistency

    def create_database_if_not_exists(self, database_name: str, timeout: float | None = None) -> RPCDatabase:
        return RPCDatabase(
            name="dify",
            read_consistency=self._read_consistency,
        )

    def exists_collection(self, database_name: str, collection_name: str) -> bool:
        return True

    def describe_collection(
        self, database_name: str, collection_name: str, timeout: float | None = None
    ) -> RPCCollection:
        index = Index(
            FilterIndex("id", enum.FieldType.String, enum.IndexType.PRIMARY_KEY),
            VectorIndex(
                "vector",
                128,
                enum.IndexType.HNSW,
                enum.MetricType.IP,
                HNSWParams(m=16, efconstruction=200),
            ),
            FilterIndex("text", enum.FieldType.String, enum.IndexType.FILTER),
            FilterIndex("metadata", enum.FieldType.String, enum.IndexType.FILTER),
        )
        return RPCCollection(
            RPCDatabase(
                name=database_name,
                read_consistency=self._read_consistency,
            ),
            collection_name,
            index=index,
        )

    def create_collection(
        self,
        database_name: str,
        collection_name: str,
        shard: int,
        replicas: int,
        description: str | None = None,
        index: Index | None = None,
        embedding: Embedding | None = None,
        timeout: float | None = None,
        ttl_config: dict | None = None,
        filter_index_config: FilterIndexConfig | None = None,
        indexes: list[IndexField] | None = None,
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
        timeout: float | None = None,
        build_index: bool = True,
        **kwargs,
    ):
        return {"code": 0, "msg": "operation success"}

    def collection_search(
        self,
        database_name: str,
        collection_name: str,
        vectors: list[list[float]],
        filter: Filter | None = None,
        params=None,
        retrieve_vector: bool = False,
        limit: int = 10,
        output_fields: list[str] | None = None,
        timeout: float | None = None,
    ) -> list[list[dict]]:
        return [[{"metadata": {"doc_id": "foo1"}, "text": "text", "doc_id": "foo1", "score": 0.1}]]

    def collection_hybrid_search(
        self,
        database_name: str,
        collection_name: str,
        ann: Union[list[AnnSearch], AnnSearch] | None = None,
        match: Union[list[KeywordSearch], KeywordSearch] | None = None,
        filter: Union[Filter, str] | None = None,
        rerank: Rerank | None = None,
        retrieve_vector: bool | None = None,
        output_fields: list[str] | None = None,
        limit: int | None = None,
        timeout: float | None = None,
        return_pd_object=False,
        **kwargs,
    ) -> list[list[dict]]:
        return [[{"metadata": {"doc_id": "foo1"}, "text": "text", "doc_id": "foo1", "score": 0.1}]]

    def collection_query(
        self,
        database_name: str,
        collection_name: str,
        document_ids: list | None = None,
        retrieve_vector: bool = False,
        limit: int | None = None,
        offset: int | None = None,
        filter: Filter | None = None,
        output_fields: list[str] | None = None,
        timeout: float | None = None,
    ):
        return [{"metadata": '{"doc_id":"foo1"}', "text": "text", "doc_id": "foo1", "score": 0.1}]

    def collection_delete(
        self,
        database_name: str,
        collection_name: str,
        document_ids: list[str] | None = None,
        filter: Filter | None = None,
        timeout: float | None = None,
    ):
        return {"code": 0, "msg": "operation success"}

    def drop_collection(self, database_name: str, collection_name: str, timeout: float | None = None):
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
        monkeypatch.setattr(RPCVectorDBClient, "describe_collection", MockTcvectordbClass.describe_collection)
        monkeypatch.setattr(RPCVectorDBClient, "upsert", MockTcvectordbClass.collection_upsert)
        monkeypatch.setattr(RPCVectorDBClient, "search", MockTcvectordbClass.collection_search)
        monkeypatch.setattr(RPCVectorDBClient, "hybrid_search", MockTcvectordbClass.collection_hybrid_search)
        monkeypatch.setattr(RPCVectorDBClient, "query", MockTcvectordbClass.collection_query)
        monkeypatch.setattr(RPCVectorDBClient, "delete", MockTcvectordbClass.collection_delete)
        monkeypatch.setattr(RPCVectorDBClient, "drop_collection", MockTcvectordbClass.drop_collection)

    yield

    if MOCK:
        monkeypatch.undo()
