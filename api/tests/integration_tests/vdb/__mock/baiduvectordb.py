import os
from collections import UserDict
from unittest.mock import MagicMock

import pytest
from _pytest.monkeypatch import MonkeyPatch
from pymochow import MochowClient
from pymochow.model.database import Database
from pymochow.model.enum import IndexState, IndexType, MetricType, ReadConsistency, TableState
from pymochow.model.schema import HNSWParams, VectorIndex
from pymochow.model.table import Table
from requests.adapters import HTTPAdapter


class AttrDict(UserDict):
    def __getattr__(self, item):
        return self.get(item)


class MockBaiduVectorDBClass:
    def mock_vector_db_client(
        self,
        config=None,
        adapter: HTTPAdapter = None,
    ):
        self.conn = MagicMock()
        self._config = MagicMock()

    def list_databases(self, config=None) -> list[Database]:
        return [
            Database(
                conn=self.conn,
                database_name="dify",
                config=self._config,
            )
        ]

    def create_database(self, database_name: str, config=None) -> Database:
        return Database(conn=self.conn, database_name=database_name, config=config)

    def list_table(self, config=None) -> list[Table]:
        return []

    def drop_table(self, table_name: str, config=None):
        return {"code": 0, "msg": "Success"}

    def create_table(
        self,
        table_name: str,
        replication: int,
        partition: int,
        schema,
        enable_dynamic_field=False,
        description: str = "",
        config=None,
    ) -> Table:
        return Table(self, table_name, replication, partition, schema, enable_dynamic_field, description, config)

    def describe_table(self, table_name: str, config=None) -> Table:
        return Table(
            self,
            table_name,
            3,
            1,
            None,
            enable_dynamic_field=False,
            description="table for dify",
            config=config,
            state=TableState.NORMAL,
        )

    def upsert(self, rows, config=None):
        return {"code": 0, "msg": "operation success", "affectedCount": 1}

    def rebuild_index(self, index_name: str, config=None):
        return {"code": 0, "msg": "Success"}

    def describe_index(self, index_name: str, config=None):
        return VectorIndex(
            index_name=index_name,
            index_type=IndexType.HNSW,
            field="vector",
            metric_type=MetricType.L2,
            params=HNSWParams(m=16, efconstruction=200),
            auto_build=False,
            state=IndexState.NORMAL,
        )

    def query(
        self,
        primary_key,
        partition_key=None,
        projections=None,
        retrieve_vector=False,
        read_consistency=ReadConsistency.EVENTUAL,
        config=None,
    ):
        return AttrDict(
            {
                "row": {
                    "id": primary_key.get("id"),
                    "vector": [0.23432432, 0.8923744, 0.89238432],
                    "text": "text",
                    "metadata": '{"doc_id": "doc_id_001"}',
                },
                "code": 0,
                "msg": "Success",
            }
        )

    def delete(self, primary_key=None, partition_key=None, filter=None, config=None):
        return {"code": 0, "msg": "Success"}

    def search(
        self,
        anns,
        partition_key=None,
        projections=None,
        retrieve_vector=False,
        read_consistency=ReadConsistency.EVENTUAL,
        config=None,
    ):
        return AttrDict(
            {
                "rows": [
                    {
                        "row": {
                            "id": "doc_id_001",
                            "vector": [0.23432432, 0.8923744, 0.89238432],
                            "text": "text",
                            "metadata": '{"doc_id": "doc_id_001"}',
                        },
                        "distance": 0.1,
                        "score": 0.5,
                    }
                ],
                "code": 0,
                "msg": "Success",
            }
        )


MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture
def setup_baiduvectordb_mock(request, monkeypatch: MonkeyPatch):
    if MOCK:
        monkeypatch.setattr(MochowClient, "__init__", MockBaiduVectorDBClass.mock_vector_db_client)
        monkeypatch.setattr(MochowClient, "list_databases", MockBaiduVectorDBClass.list_databases)
        monkeypatch.setattr(MochowClient, "create_database", MockBaiduVectorDBClass.create_database)
        monkeypatch.setattr(Database, "table", MockBaiduVectorDBClass.describe_table)
        monkeypatch.setattr(Database, "list_table", MockBaiduVectorDBClass.list_table)
        monkeypatch.setattr(Database, "create_table", MockBaiduVectorDBClass.create_table)
        monkeypatch.setattr(Database, "drop_table", MockBaiduVectorDBClass.drop_table)
        monkeypatch.setattr(Database, "describe_table", MockBaiduVectorDBClass.describe_table)
        monkeypatch.setattr(Table, "rebuild_index", MockBaiduVectorDBClass.rebuild_index)
        monkeypatch.setattr(Table, "describe_index", MockBaiduVectorDBClass.describe_index)
        monkeypatch.setattr(Table, "delete", MockBaiduVectorDBClass.delete)
        monkeypatch.setattr(Table, "query", MockBaiduVectorDBClass.query)
        monkeypatch.setattr(Table, "search", MockBaiduVectorDBClass.search)

    yield

    if MOCK:
        monkeypatch.undo()
