"""Integration tests for IRIS vector database."""

from core.rag.datasource.vdb.iris.iris_vector import IrisVector, IrisVectorConfig
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    setup_mock_redis,
)


class IrisVectorTest(AbstractVectorTest):
    """Test suite for IRIS vector store implementation."""

    def __init__(self):
        """Initialize IRIS vector test with hardcoded test configuration.

        Note: Uses 'host.docker.internal' to connect from DevContainer to
        host OS Docker, or 'localhost' when running directly on host OS.
        """
        super().__init__()
        self.vector = IrisVector(
            collection_name=self.collection_name,
            config=IrisVectorConfig(
                IRIS_HOST="host.docker.internal",
                IRIS_SUPER_SERVER_PORT=1972,
                IRIS_USER="_SYSTEM",
                IRIS_PASSWORD="Dify@1234",
                IRIS_DATABASE="USER",
                IRIS_SCHEMA="dify",
                IRIS_CONNECTION_URL=None,
                IRIS_MIN_CONNECTION=1,
                IRIS_MAX_CONNECTION=3,
                IRIS_TEXT_INDEX=True,
                IRIS_TEXT_INDEX_LANGUAGE="en",
            ),
        )


def test_iris_vector(setup_mock_redis) -> None:
    """Run all IRIS vector store tests.

    Args:
        setup_mock_redis: Pytest fixture for mock Redis setup
    """
    IrisVectorTest().run_all_tests()
