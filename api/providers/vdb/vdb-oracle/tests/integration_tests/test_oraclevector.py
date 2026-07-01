from typing import override

import pytest
from dify_vdb_oracle.oraclevector import ORACLE_IN_CLAUSE_BATCH_SIZE, OracleVector, OracleVectorConfig

from core.rag.datasource.vdb.vector_integration_test_support import AbstractVectorTest
from core.rag.models.document import Document


class OracleVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.vector = OracleVector(
            collection_name=self.collection_name,
            config=OracleVectorConfig(
                user="dify",
                password="dify",
                dsn="localhost:1521/FREEPDB1",
            ),
        )

    @override
    def search_by_full_text(self):
        # WORLD_LEXER splits the shared fixture text "test_text" into two searchable tokens.
        hits_by_full_text: list[Document] = self.vector.search_by_full_text(query="test")
        assert len(hits_by_full_text) == 1
        assert hits_by_full_text[0].metadata["doc_id"] == self.example_doc_id


def test_oraclevector(setup_mock_redis):
    OracleVectorTest().run_all_tests()


def test_oraclevector_batches_large_document_filters(setup_mock_redis):
    test = OracleVectorTest()
    test.create_vector()
    document_ids = [f"missing-{index}" for index in range(ORACLE_IN_CLAUSE_BATCH_SIZE)]
    document_ids.append(test.example_doc_id)

    try:
        vector_hits = test.vector.search_by_vector(
            query_vector=test.example_embedding,
            document_ids_filter=document_ids,
        )
        text_hits = test.vector.search_by_full_text(
            query="test",
            document_ids_filter=document_ids,
        )

        assert [hit.metadata["doc_id"] for hit in vector_hits] == [test.example_doc_id]
        assert [hit.metadata["doc_id"] for hit in text_hits] == [test.example_doc_id]
    finally:
        test.delete_vector()


def test_oraclevector_rejects_legacy_flexible_vector_without_modifying_data(setup_mock_redis):
    test = OracleVectorTest()
    vector = test.vector

    try:
        with vector._get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""CREATE TABLE {vector.table_name} (
                        id VARCHAR2(100) PRIMARY KEY,
                        text CLOB NOT NULL,
                        meta JSON,
                        embedding VECTOR NOT NULL
                    )"""
                )
                cursor.execute(
                    f"INSERT INTO {vector.table_name} (id, text, meta, embedding) VALUES (:1, :2, :3, TO_VECTOR(:4))",
                    ("legacy-row", "legacy text", '{"doc_id":"legacy-row"}', "[1, 2]"),
                )
            connection.commit()

        with pytest.raises(RuntimeError, match="does not enforce an embedding dimension"):
            vector._create_collection(2)

        with vector._get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(f"SELECT id, text FROM {vector.table_name}")
                assert cursor.fetchall() == [("legacy-row", "legacy text")]
    finally:
        vector.delete()
