from dify_vdb_oracle.oraclevector import OracleVector, OracleVectorConfig

from core.rag.datasource.vdb.vector_integration_test_support import (
    AbstractVectorTest,
    get_example_text,
)
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

    def search_by_full_text(self):
        hits_by_full_text: list[Document] = self.vector.search_by_full_text(query=get_example_text())
        assert len(hits_by_full_text) == 0


def test_oraclevector(setup_mock_redis):
    OracleVectorTest().run_all_tests()
