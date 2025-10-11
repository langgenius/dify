from core.rag.datasource.vdb.oracle.oraclevector import OracleVector, OracleVectorConfig
from core.rag.models.document import Document
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    get_example_text,
    setup_mock_redis,
)


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

    def search_by_full_text(self):
        hits_by_full_text: list[Document] = self.vector.search_by_full_text(query=get_example_text())
        assert len(hits_by_full_text) == 0


def test_oraclevector(setup_mock_redis):
    OracleVectorTest().run_all_tests()
