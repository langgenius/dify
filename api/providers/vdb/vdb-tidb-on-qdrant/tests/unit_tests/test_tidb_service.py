from unittest.mock import MagicMock, patch

from dify_vdb_tidb_on_qdrant.tidb_service import TidbService


class TestExtractQdrantEndpoint:
    """Unit tests for TidbService.extract_qdrant_endpoint."""

    def test_returns_endpoint_when_host_present(self):
        response = {"endpoints": {"public": {"host": "gateway01.us-east-1.tidbcloud.com", "port": 4000}}}
        result = TidbService.extract_qdrant_endpoint(response)
        assert result == "https://qdrant-gateway01.us-east-1.tidbcloud.com"

    def test_returns_none_when_host_missing(self):
        response = {"endpoints": {"public": {}}}
        assert TidbService.extract_qdrant_endpoint(response) is None

    def test_returns_none_when_public_missing(self):
        response = {"endpoints": {}}
        assert TidbService.extract_qdrant_endpoint(response) is None

    def test_returns_none_when_endpoints_missing(self):
        assert TidbService.extract_qdrant_endpoint({}) is None


class TestFetchQdrantEndpoint:
    """Unit tests for TidbService.fetch_qdrant_endpoint."""

    @patch.object(TidbService, "get_tidb_serverless_cluster")
    def test_returns_endpoint_when_host_present(self, mock_get_cluster):
        mock_get_cluster.return_value = {
            "endpoints": {"public": {"host": "gateway01.us-east-1.tidbcloud.com", "port": 4000}}
        }
        result = TidbService.fetch_qdrant_endpoint("url", "pub", "priv", "c-123")
        assert result == "https://qdrant-gateway01.us-east-1.tidbcloud.com"

    @patch.object(TidbService, "get_tidb_serverless_cluster")
    def test_returns_none_when_cluster_response_is_none(self, mock_get_cluster):
        mock_get_cluster.return_value = None
        assert TidbService.fetch_qdrant_endpoint("url", "pub", "priv", "c-123") is None

    @patch.object(TidbService, "get_tidb_serverless_cluster")
    def test_returns_none_when_host_missing(self, mock_get_cluster):
        mock_get_cluster.return_value = {"endpoints": {"public": {}}}
        assert TidbService.fetch_qdrant_endpoint("url", "pub", "priv", "c-123") is None

    @patch.object(TidbService, "get_tidb_serverless_cluster")
    def test_returns_none_when_endpoints_missing(self, mock_get_cluster):
        mock_get_cluster.return_value = {}
        assert TidbService.fetch_qdrant_endpoint("url", "pub", "priv", "c-123") is None

    @patch.object(TidbService, "get_tidb_serverless_cluster")
    def test_returns_none_on_exception(self, mock_get_cluster):
        mock_get_cluster.side_effect = RuntimeError("network error")
        assert TidbService.fetch_qdrant_endpoint("url", "pub", "priv", "c-123") is None


class TestCreateTidbServerlessClusterQdrantEndpoint:
    """Verify that create_tidb_serverless_cluster includes qdrant_endpoint in its result."""

    @patch.object(TidbService, "get_tidb_serverless_cluster")
    @patch("dify_vdb_tidb_on_qdrant.tidb_service._tidb_http_client")
    @patch("dify_vdb_tidb_on_qdrant.tidb_service.dify_config")
    def test_result_contains_qdrant_endpoint(self, mock_config, mock_http, mock_get_cluster):
        mock_config.TIDB_SPEND_LIMIT = 10
        mock_http.post.return_value = MagicMock(status_code=200, json=lambda: {"clusterId": "c-1"})
        mock_get_cluster.return_value = {
            "state": "ACTIVE",
            "userPrefix": "pfx",
            "endpoints": {"public": {"host": "gw.tidbcloud.com", "port": 4000}},
        }

        result = TidbService.create_tidb_serverless_cluster("proj", "url", "iam", "pub", "priv", "us-east-1")

        assert result is not None
        assert result["qdrant_endpoint"] == "https://qdrant-gw.tidbcloud.com"

    @patch.object(TidbService, "get_tidb_serverless_cluster")
    @patch("dify_vdb_tidb_on_qdrant.tidb_service._tidb_http_client")
    @patch("dify_vdb_tidb_on_qdrant.tidb_service.dify_config")
    def test_result_qdrant_endpoint_none_when_no_endpoints(self, mock_config, mock_http, mock_get_cluster):
        mock_config.TIDB_SPEND_LIMIT = 10
        mock_http.post.return_value = MagicMock(status_code=200, json=lambda: {"clusterId": "c-1"})
        mock_get_cluster.return_value = {"state": "ACTIVE", "userPrefix": "pfx"}

        result = TidbService.create_tidb_serverless_cluster("proj", "url", "iam", "pub", "priv", "us-east-1")

        assert result is not None
        assert result["qdrant_endpoint"] is None


class TestBatchCreateTidbServerlessClusterQdrantEndpoint:
    """Verify that batch_create includes qdrant_endpoint per cluster."""

    @patch.object(TidbService, "fetch_qdrant_endpoint", return_value="https://qdrant-gw.tidbcloud.com")
    @patch("dify_vdb_tidb_on_qdrant.tidb_service.redis_client")
    @patch("dify_vdb_tidb_on_qdrant.tidb_service._tidb_http_client")
    @patch("dify_vdb_tidb_on_qdrant.tidb_service.dify_config")
    def test_batch_result_contains_qdrant_endpoint(self, mock_config, mock_http, mock_redis, mock_fetch_ep):
        mock_config.TIDB_SPEND_LIMIT = 10
        cluster_name = "abc123"
        mock_http.post.return_value = MagicMock(
            status_code=200,
            json=lambda: {"clusters": [{"clusterId": "c-1", "displayName": cluster_name}]},
        )
        mock_redis.setex = MagicMock()
        mock_redis.get.return_value = b"password123"

        result = TidbService.batch_create_tidb_serverless_cluster(
            batch_size=1,
            project_id="proj",
            api_url="url",
            iam_url="iam",
            public_key="pub",
            private_key="priv",
            region="us-east-1",
        )

        assert len(result) == 1
        assert result[0]["qdrant_endpoint"] == "https://qdrant-gw.tidbcloud.com"
