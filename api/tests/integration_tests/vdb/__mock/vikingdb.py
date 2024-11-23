import os
from typing import Union
from unittest.mock import MagicMock

import pytest
from _pytest.monkeypatch import MonkeyPatch
from volcengine.viking_db import (
    Collection,
    Data,
    DistanceType,
    Field,
    FieldType,
    Index,
    IndexType,
    QuantType,
    VectorIndexParams,
    VikingDBService,
)

from core.rag.datasource.vdb.field import Field as vdb_Field


class MockVikingDBClass:
    def __init__(
        self,
        host="api-vikingdb.volces.com",
        region="cn-north-1",
        ak="",
        sk="",
        scheme="http",
        connection_timeout=30,
        socket_timeout=30,
        proxy=None,
    ):
        self._viking_db_service = MagicMock()
        self._viking_db_service.get_exception = MagicMock(return_value='{"data": {"primary_key": "test_id"}}')

    def get_collection(self, collection_name) -> Collection:
        return Collection(
            collection_name=collection_name,
            description="Collection For Dify",
            viking_db_service=self._viking_db_service,
            primary_key=vdb_Field.PRIMARY_KEY.value,
            fields=[
                Field(field_name=vdb_Field.PRIMARY_KEY.value, field_type=FieldType.String, is_primary_key=True),
                Field(field_name=vdb_Field.METADATA_KEY.value, field_type=FieldType.String),
                Field(field_name=vdb_Field.GROUP_KEY.value, field_type=FieldType.String),
                Field(field_name=vdb_Field.CONTENT_KEY.value, field_type=FieldType.Text),
                Field(field_name=vdb_Field.VECTOR.value, field_type=FieldType.Vector, dim=768),
            ],
            indexes=[
                Index(
                    collection_name=collection_name,
                    index_name=f"{collection_name}_idx",
                    vector_index=VectorIndexParams(
                        distance=DistanceType.L2,
                        index_type=IndexType.HNSW,
                        quant=QuantType.Float,
                    ),
                    scalar_index=None,
                    stat=None,
                    viking_db_service=self._viking_db_service,
                )
            ],
        )

    def drop_collection(self, collection_name):
        assert collection_name != ""

    def create_collection(self, collection_name, fields, description="") -> Collection:
        return Collection(
            collection_name=collection_name,
            description=description,
            primary_key=vdb_Field.PRIMARY_KEY.value,
            viking_db_service=self._viking_db_service,
            fields=fields,
        )

    def get_index(self, collection_name, index_name) -> Index:
        return Index(
            collection_name=collection_name,
            index_name=index_name,
            viking_db_service=self._viking_db_service,
            stat=None,
            scalar_index=None,
            vector_index=VectorIndexParams(
                distance=DistanceType.L2,
                index_type=IndexType.HNSW,
                quant=QuantType.Float,
            ),
        )

    def create_index(
        self,
        collection_name,
        index_name,
        vector_index=None,
        cpu_quota=2,
        description="",
        partition_by="",
        scalar_index=None,
        shard_count=None,
        shard_policy=None,
    ):
        return Index(
            collection_name=collection_name,
            index_name=index_name,
            vector_index=vector_index,
            cpu_quota=cpu_quota,
            description=description,
            partition_by=partition_by,
            scalar_index=scalar_index,
            shard_count=shard_count,
            shard_policy=shard_policy,
            viking_db_service=self._viking_db_service,
            stat=None,
        )

    def drop_index(self, collection_name, index_name):
        assert collection_name != ""
        assert index_name != ""

    def upsert_data(self, data: Union[Data, list[Data]]):
        assert data is not None

    def fetch_data(self, id: Union[str, list[str], int, list[int]]):
        return Data(
            fields={
                vdb_Field.GROUP_KEY.value: "test_group",
                vdb_Field.METADATA_KEY.value: "{}",
                vdb_Field.CONTENT_KEY.value: "content",
                vdb_Field.PRIMARY_KEY.value: id,
                vdb_Field.VECTOR.value: [-0.00762577411336441, -0.01949881482151406, 0.008832383941428398],
            },
            id=id,
        )

    def delete_data(self, id: Union[str, list[str], int, list[int]]):
        assert id is not None

    def search_by_vector(
        self,
        vector,
        sparse_vectors=None,
        filter=None,
        limit=10,
        output_fields=None,
        partition="default",
        dense_weight=None,
    ) -> list[Data]:
        return [
            Data(
                fields={
                    vdb_Field.GROUP_KEY.value: "test_group",
                    vdb_Field.METADATA_KEY.value: '\
                    {"source": "/var/folders/ml/xxx/xxx.txt", \
                    "document_id": "test_document_id", \
                    "dataset_id": "test_dataset_id", \
                    "doc_id": "test_id", \
                    "doc_hash": "test_hash"}',
                    vdb_Field.CONTENT_KEY.value: "content",
                    vdb_Field.PRIMARY_KEY.value: "test_id",
                    vdb_Field.VECTOR.value: vector,
                },
                id="test_id",
                score=0.10,
            )
        ]

    def search(
        self, order=None, filter=None, limit=10, output_fields=None, partition="default", dense_weight=None
    ) -> list[Data]:
        return [
            Data(
                fields={
                    vdb_Field.GROUP_KEY.value: "test_group",
                    vdb_Field.METADATA_KEY.value: '\
                    {"source": "/var/folders/ml/xxx/xxx.txt", \
                    "document_id": "test_document_id", \
                    "dataset_id": "test_dataset_id", \
                    "doc_id": "test_id", \
                    "doc_hash": "test_hash"}',
                    vdb_Field.CONTENT_KEY.value: "content",
                    vdb_Field.PRIMARY_KEY.value: "test_id",
                    vdb_Field.VECTOR.value: [-0.00762577411336441, -0.01949881482151406, 0.008832383941428398],
                },
                id="test_id",
                score=0.10,
            )
        ]


MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture
def setup_vikingdb_mock(monkeypatch: MonkeyPatch):
    if MOCK:
        monkeypatch.setattr(VikingDBService, "__init__", MockVikingDBClass.__init__)
        monkeypatch.setattr(VikingDBService, "get_collection", MockVikingDBClass.get_collection)
        monkeypatch.setattr(VikingDBService, "create_collection", MockVikingDBClass.create_collection)
        monkeypatch.setattr(VikingDBService, "drop_collection", MockVikingDBClass.drop_collection)
        monkeypatch.setattr(VikingDBService, "get_index", MockVikingDBClass.get_index)
        monkeypatch.setattr(VikingDBService, "create_index", MockVikingDBClass.create_index)
        monkeypatch.setattr(VikingDBService, "drop_index", MockVikingDBClass.drop_index)
        monkeypatch.setattr(Collection, "upsert_data", MockVikingDBClass.upsert_data)
        monkeypatch.setattr(Collection, "fetch_data", MockVikingDBClass.fetch_data)
        monkeypatch.setattr(Collection, "delete_data", MockVikingDBClass.delete_data)
        monkeypatch.setattr(Index, "search_by_vector", MockVikingDBClass.search_by_vector)
        monkeypatch.setattr(Index, "search", MockVikingDBClass.search)

    yield

    if MOCK:
        monkeypatch.undo()
