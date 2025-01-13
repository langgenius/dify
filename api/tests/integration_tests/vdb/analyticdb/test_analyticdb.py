from core.rag.datasource.vdb.analyticdb.analyticdb_vector import AnalyticdbVector
from core.rag.datasource.vdb.analyticdb.analyticdb_vector_openapi import AnalyticdbVectorOpenAPIConfig
from core.rag.datasource.vdb.analyticdb.analyticdb_vector_sql import AnalyticdbVectorBySqlConfig
from tests.integration_tests.vdb.test_vector_store import AbstractVectorTest, setup_mock_redis


class AnalyticdbVectorTest(AbstractVectorTest):
    def __init__(self, config_type: str):
        super().__init__()
        # Analyticdb requires collection_name length less than 60.
        # it's ok for normal usage.
        self.collection_name = self.collection_name.replace("_test", "")
        if config_type == "sql":
            self.vector = AnalyticdbVector(
                collection_name=self.collection_name,
                sql_config=AnalyticdbVectorBySqlConfig(
                    host="test_host",
                    port=5432,
                    account="test_account",
                    account_password="test_passwd",
                    namespace="difytest_namespace",
                ),
                api_config=None,
            )
        else:
            self.vector = AnalyticdbVector(
                collection_name=self.collection_name,
                sql_config=None,
                api_config=AnalyticdbVectorOpenAPIConfig(
                    access_key_id="test_key_id",
                    access_key_secret="test_key_secret",
                    region_id="test_region",
                    instance_id="test_id",
                    account="test_account",
                    account_password="test_passwd",
                    namespace="difytest_namespace",
                    collection="difytest_collection",
                    namespace_password="test_passwd",
                ),
            )

    def run_all_tests(self):
        self.vector.delete()
        return super().run_all_tests()


def test_chroma_vector(setup_mock_redis):
    AnalyticdbVectorTest("api").run_all_tests()
    AnalyticdbVectorTest("sql").run_all_tests()
