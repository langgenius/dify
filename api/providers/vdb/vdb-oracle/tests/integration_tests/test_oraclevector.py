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
    metadata_condition = {
        "logical_operator": "and",
        "conditions": [
            {
                "name": "dataset_id",
                "comparison_operator": "is",
                "value": test.example_doc_id,
            }
        ],
    }

    try:
        vector_hits = test.vector.search_by_vector(
            query_vector=test.example_embedding,
            document_ids_filter=document_ids,
            metadata_condition=metadata_condition,
        )
        text_hits = test.vector.search_by_full_text(
            query="test",
            document_ids_filter=document_ids,
            metadata_filtering_conditions=metadata_condition,
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


def test_oraclevector_filters_arbitrary_metadata_names_with_dify_null_semantics(setup_mock_redis):
    test = OracleVectorTest()
    special_keys = {
        "release-date": "2026-07-01",
        "Customer Name": "Alice",
        "2024_source": "annual-report",
        "a.b": "literal-dot",
        'quote"key': "quoted",
        "O'Brien": "apostrophe",
        r"path\name": "backslash",
        "客户": "甲",
        "source')) OR 1=1 --": "still-data",
    }
    documents = [
        Document(
            page_content="oracle special metadata",
            metadata={
                "doc_id": "special",
                "document_id": "special-parent",
                "status": "active",
                "blank": "",
                "long_text": "x" * 5000 + "needle",
                **special_keys,
            },
        ),
        Document(
            page_content="oracle legacy metadata",
            metadata={"doc_id": "legacy", "document_id": "legacy-parent", "status": "legacy", "blank": "alpha"},
        ),
        Document(
            page_content="oracle missing status metadata",
            metadata={"doc_id": "missing", "document_id": "missing-parent"},
        ),
        Document(
            page_content="oracle null metadata",
            metadata={"doc_id": "null", "document_id": "null-parent", "status": "legacy", "blank": None},
        ),
    ]

    try:
        test.vector.create(texts=documents, embeddings=[test.example_embedding] * len(documents))

        for key, value in special_keys.items():
            condition = {
                "logical_operator": "and",
                "conditions": [{"name": key, "comparison_operator": "is", "value": value}],
            }
            hits = test.vector.search_by_vector(test.example_embedding, top_k=10, metadata_condition=condition)
            assert [hit.metadata["doc_id"] for hit in hits] == ["special"]

        text_hits = test.vector.search_by_full_text(
            "oracle",
            top_k=10,
            metadata_condition={
                "logical_operator": "and",
                "conditions": [{"name": "Customer Name", "comparison_operator": "is", "value": "Alice"}],
            },
        )
        assert [hit.metadata["doc_id"] for hit in text_hits] == ["special"]

        negative_hits = test.vector.search_by_vector(
            test.example_embedding,
            top_k=10,
            metadata_condition={
                "logical_operator": "and",
                "conditions": [{"name": "status", "comparison_operator": "is not", "value": "legacy"}],
            },
        )
        assert [hit.metadata["doc_id"] for hit in negative_hits] == ["special"]

        not_empty_hits = test.vector.search_by_vector(
            test.example_embedding,
            top_k=10,
            metadata_condition={
                "logical_operator": "and",
                "conditions": [{"name": "blank", "comparison_operator": "not empty", "value": None}],
            },
        )
        assert {hit.metadata["doc_id"] for hit in not_empty_hits} == {"special", "legacy"}

        empty_hits = test.vector.search_by_vector(
            test.example_embedding,
            top_k=10,
            metadata_condition={
                "logical_operator": "and",
                "conditions": [{"name": "blank", "comparison_operator": "empty", "value": None}],
            },
        )
        assert {hit.metadata["doc_id"] for hit in empty_hits} == {"null", "missing"}

        cases = [
            ("contains", "", {"special", "legacy"}),
            ("start with", "", {"special", "legacy"}),
            ("end with", "", {"special", "legacy"}),
            ("not contains", "z", {"special", "legacy"}),
            ("not contains", "", set()),
            ("is", "", {"special"}),
            ("is not", "alpha", {"special"}),
            ("is not", "", {"legacy"}),
            ("in", [""], {"special"}),
            ("in", ["", "alpha"], {"special", "legacy"}),
            ("not in", ["z"], {"special", "legacy"}),
            ("not in", [""], {"legacy"}),
            ("not in", ["", "alpha"], set()),
        ]
        for operator, value, expected_ids in cases:
            hits = test.vector.search_by_vector(
                test.example_embedding,
                top_k=10,
                metadata_condition={
                    "logical_operator": "and",
                    "conditions": [{"name": "blank", "comparison_operator": operator, "value": value}],
                },
            )
            assert {hit.metadata["doc_id"] for hit in hits} == expected_ids

        long_contains_hits = test.vector.search_by_vector(
            test.example_embedding,
            top_k=10,
            metadata_condition={
                "logical_operator": "and",
                "conditions": [{"name": "long_text", "comparison_operator": "contains", "value": "needle"}],
            },
        )
        assert {hit.metadata["doc_id"] for hit in long_contains_hits} == {"special"}

        for operator in ("is not", "not in"):
            long_negative_hits = test.vector.search_by_vector(
                test.example_embedding,
                top_k=10,
                metadata_condition={
                    "logical_operator": "and",
                    "conditions": [{"name": "long_text", "comparison_operator": operator, "value": "other"}],
                },
            )
            assert {hit.metadata["doc_id"] for hit in long_negative_hits} == {"special"}
    finally:
        test.vector.delete()
