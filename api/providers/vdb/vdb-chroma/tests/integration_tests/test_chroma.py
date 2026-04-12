import chromadb
from dify_vdb_chroma.chroma_vector import ChromaConfig, ChromaVector

from core.rag.datasource.vdb.vector_integration_test_support import (
    AbstractVectorTest,
    get_example_text,
)


class ChromaVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.vector = ChromaVector(
            collection_name=self.collection_name,
            config=ChromaConfig(
                host="localhost",
                port=8000,
                tenant=chromadb.DEFAULT_TENANT,
                database=chromadb.DEFAULT_DATABASE,
                auth_provider="chromadb.auth.token_authn.TokenAuthClientProvider",
                auth_credentials="difyai123456",
            ),
        )

    def search_by_full_text(self):
        # chroma dos not support full text searching
        hits_by_full_text = self.vector.search_by_full_text(query=get_example_text())
        assert len(hits_by_full_text) == 0


def test_chroma_vector(setup_mock_redis):
    ChromaVectorTest().run_all_tests()
