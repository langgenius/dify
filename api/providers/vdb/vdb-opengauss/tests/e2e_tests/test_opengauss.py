import time
import uuid

import psycopg2
from dify_vdb_opengauss.opengauss import OpenGauss, OpenGaussConfig

from core.rag.datasource.vdb.vector_integration_test_support import (
    AbstractVectorTest,
    get_example_document,
    get_example_text,
)


class OpenGaussTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        max_retries = 5
        retry_delay = 20
        retry_count = 0
        while retry_count < max_retries:
            try:
                config = OpenGaussConfig(
                    host="localhost",
                    port=6600,
                    user="postgres",
                    password="Dify@123",
                    database="dify",
                    min_connection=1,
                    max_connection=5,
                )
                break
            except psycopg2.OperationalError:
                retry_count += 1
                if retry_count < max_retries:
                    time.sleep(retry_delay)
        self.vector = OpenGauss(
            collection_name=self.collection_name,
            config=config,
        )

    def search_with_document_ids_filter(self):
        other_document = get_example_document(doc_id=str(uuid.uuid4()))
        self.vector.add_texts(documents=[other_document], embeddings=[self.example_embedding])
        other_document_id = other_document.metadata["document_id"]

        for hits in (
            self.vector.search_by_vector(
                query_vector=self.example_embedding, top_k=10, document_ids_filter=[self.example_doc_id]
            ),
            self.vector.search_by_full_text(
                query=get_example_text(), top_k=10, document_ids_filter=[self.example_doc_id]
            ),
        ):
            assert [hit.metadata["document_id"] for hit in hits] == [self.example_doc_id]
        hits = self.vector.search_by_vector(
            query_vector=self.example_embedding, top_k=10, document_ids_filter=[other_document_id]
        )
        assert [hit.metadata["document_id"] for hit in hits] == [other_document_id]


def test_opengauss(setup_mock_redis):
    OpenGaussTest().run_all_tests()


def test_opengauss_document_ids_filter(setup_mock_redis):
    test = OpenGaussTest()
    test.create_vector()
    try:
        test.search_with_document_ids_filter()
    finally:
        test.delete_vector()
