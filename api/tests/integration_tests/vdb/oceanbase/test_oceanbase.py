from unittest.mock import MagicMock, patch

import pytest

from core.rag.datasource.vdb.oceanbase.oceanbase_vector import (
    OceanBaseVector,
    OceanBaseVectorConfig,
)
from tests.integration_tests.vdb.__mock.tcvectordb import setup_tcvectordb_mock
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    get_example_text,
    setup_mock_redis,
)
from core.rag.models.document import Document

def oceanbase_vector():
    return OceanBaseVector(
        "dify_test_collection",
        config=OceanBaseVectorConfig(
            host="127.0.0.1",
            port="2881",
            user="root@test",
            database="difyai",
            password="difyai123456",
            enable_hybrid_search=True
        ),
    )

def get_example_document(doc_id: str) -> Document:
    doc = Document(
        page_content=get_example_text(),
        metadata={
            "doc_id": doc_id,
            "doc_hash": doc_id,
            "document_id": doc_id,
            "dataset_id": doc_id,
        },
    )
    return doc


class OceanBaseVectorTest(AbstractVectorTest):
    def __init__(self, vector: OceanBaseVector):
        super().__init__()
        self.vector = vector
        
    def create_vector(self):
        self.vector.create(
            texts=[get_example_document(doc_id=self.example_doc_id)],
            embeddings=[self.example_embedding],
        )

    def search_by_vector(self):
        hits_by_vector = self.vector.search_by_vector(query_vector=self.example_embedding)
        assert len(hits_by_vector) > 0

    def search_by_full_text(self):
        hits_by_full_text = self.vector.search_by_full_text(query=get_example_text())
        assert len(hits_by_full_text) > 0

    def text_exists(self):
        exist = self.vector.text_exists(self.example_doc_id)
        assert exist == True

    def get_ids_by_metadata_field(self):
        ids = self.vector.get_ids_by_metadata_field(key="document_id", value=self.example_doc_id)
        assert len(ids) > 0


def test_oceanbase_vector(setup_mock_redis):
    OceanBaseVectorTest(oceanbase_vector()).run_all_tests()
