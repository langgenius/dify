import os

from dify_vdb_dxmt.dxmt_vector import DXMTVector, DXMTVectorConfig

from core.rag.datasource.vdb.vector_integration_test_support import AbstractVectorTest


class DXMTVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        self.vector = DXMTVector(
            collection_name=self.collection_name,
            config=DXMTVectorConfig(
                host=os.environ.get("DXMT_HOST", "127.0.0.1"),
                port=int(os.environ.get("DXMT_PORT", "9999")),
                api_key=os.environ.get("DXMT_API_KEY") or None,
            ),
        )


def test_dxmt_vector(setup_mock_redis):
    DXMTVectorTest().run_all_tests()
