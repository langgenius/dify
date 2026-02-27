from unittest.mock import MagicMock, patch

from core.rag.datasource.vdb.weaviate.weaviate_vector import WeaviateConfig, WeaviateVector


def test_init_client_with_valid_config():
    """Test successful client initialization with valid configuration."""
    config = WeaviateConfig(
        endpoint="http://localhost:8080",
        api_key="WVF5YThaHlkYwhGUSmCRgsX3tD5ngdN8pkih",
    )

    with patch("weaviate.connect_to_custom") as mock_connect:
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_connect.return_value = mock_client

        vector = WeaviateVector(
            collection_name="test_collection",
            config=config,
            attributes=["doc_id"],
        )

        assert vector._client == mock_client
        mock_connect.assert_called_once()
        call_kwargs = mock_connect.call_args[1]
        assert call_kwargs["http_host"] == "localhost"
        assert call_kwargs["http_port"] == 8080
        assert call_kwargs["http_secure"] is False
        assert call_kwargs["grpc_host"] == "localhost"
        assert call_kwargs["grpc_port"] == 50051
        assert call_kwargs["grpc_secure"] is False
        assert call_kwargs["auth_credentials"] is not None
