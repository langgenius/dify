import os
import uuid

import tablestore
from _pytest.python_api import approx

from core.rag.datasource.vdb.tablestore.tablestore_vector import (
    TableStoreConfig,
    TableStoreVector,
)
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    get_example_document,
    get_example_text,
    setup_mock_redis,
)


class TableStoreVectorTest(AbstractVectorTest):
    def __init__(self, normalize_full_text_score: bool = False):
        super().__init__()
        self.vector = TableStoreVector(
            collection_name=self.collection_name,
            config=TableStoreConfig(
                endpoint=os.getenv("TABLESTORE_ENDPOINT"),
                instance_name=os.getenv("TABLESTORE_INSTANCE_NAME"),
                access_key_id=os.getenv("TABLESTORE_ACCESS_KEY_ID"),
                access_key_secret=os.getenv("TABLESTORE_ACCESS_KEY_SECRET"),
                normalize_full_text_bm25_score=normalize_full_text_score,
            ),
        )

    def get_ids_by_metadata_field(self):
        ids = self.vector.get_ids_by_metadata_field(key="doc_id", value=self.example_doc_id)
        assert ids is not None
        assert len(ids) == 1
        assert ids[0] == self.example_doc_id

    def create_vector(self):
        self.vector.create(
            texts=[get_example_document(doc_id=self.example_doc_id)],
            embeddings=[self.example_embedding],
        )
        while True:
            search_response = self.vector._tablestore_client.search(
                table_name=self.vector._table_name,
                index_name=self.vector._index_name,
                search_query=tablestore.SearchQuery(query=tablestore.MatchAllQuery(), get_total_count=True, limit=0),
                columns_to_get=tablestore.ColumnsToGet(return_type=tablestore.ColumnReturnType.ALL_FROM_INDEX),
            )
            if search_response.total_count == 1:
                break

    def search_by_vector(self):
        super().search_by_vector()
        docs = self.vector.search_by_vector(self.example_embedding, document_ids_filter=[self.example_doc_id])
        assert len(docs) == 1
        assert docs[0].metadata["doc_id"] == self.example_doc_id
        assert docs[0].metadata["score"] > 0

        docs = self.vector.search_by_vector(self.example_embedding, document_ids_filter=[str(uuid.uuid4())])
        assert len(docs) == 0

    def search_by_full_text(self):
        super().search_by_full_text()
        docs = self.vector.search_by_full_text(get_example_text(), document_ids_filter=[self.example_doc_id])
        assert len(docs) == 1
        assert docs[0].metadata["doc_id"] == self.example_doc_id
        if self.vector._config.normalize_full_text_bm25_score:
            assert docs[0].metadata["score"] == approx(0.1214, abs=1e-3)
        else:
            assert docs[0].metadata.get("score") is None

        # return none if normalize_full_text_score=true and score_threshold > 0
        docs = self.vector.search_by_full_text(
            get_example_text(), document_ids_filter=[self.example_doc_id], score_threshold=0.5
        )
        if self.vector._config.normalize_full_text_bm25_score:
            assert len(docs) == 0
        else:
            assert len(docs) == 1
            assert docs[0].metadata["doc_id"] == self.example_doc_id
            assert docs[0].metadata.get("score") is None

        docs = self.vector.search_by_full_text(get_example_text(), document_ids_filter=[str(uuid.uuid4())])
        assert len(docs) == 0

    def run_all_tests(self):
        try:
            self.vector.delete()
        except Exception:
            pass

        return super().run_all_tests()


def test_tablestore_vector(setup_mock_redis):
    TableStoreVectorTest().run_all_tests()
    TableStoreVectorTest(normalize_full_text_score=True).run_all_tests()
    TableStoreVectorTest(normalize_full_text_score=False).run_all_tests()
