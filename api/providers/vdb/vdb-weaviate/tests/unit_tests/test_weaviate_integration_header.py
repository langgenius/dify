"""Unit tests for the Weaviate client integration telemetry header.

Verifies that Dify registers the ``X-Weaviate-Client-Integration`` header on the Weaviate
client so server-side telemetry can attribute traffic to Dify, mirroring the behavior of other
official Weaviate integrations.
"""

import unittest
from typing import override
from unittest.mock import MagicMock, patch

from dify_vdb_weaviate import weaviate_vector as weaviate_vector_module
from dify_vdb_weaviate.weaviate_vector import (
    _INTEGRATION_NAME,
    WeaviateConfig,
    WeaviateVector,
    _integration_version,
    _register_integration,
)


class TestIntegrationVersion(unittest.TestCase):
    """Tests for resolving the version reported in the integration header."""

    def test_uses_dify_project_version_when_present(self):
        with patch.object(weaviate_vector_module.dify_config.project, "version", "1.15.0"):
            assert _integration_version() == "1.15.0"

    def test_strips_whitespace_from_version(self):
        with patch.object(weaviate_vector_module.dify_config.project, "version", "  1.15.0  "):
            assert _integration_version() == "1.15.0"

    def test_falls_back_to_package_metadata_when_version_empty(self):
        with (
            patch.object(weaviate_vector_module.dify_config.project, "version", ""),
            patch("dify_vdb_weaviate.weaviate_vector.importlib.metadata.version", return_value="9.9.9"),
        ):
            assert _integration_version() == "9.9.9"

    def test_falls_back_to_unknown_when_everything_fails(self):
        with (
            patch.object(weaviate_vector_module.dify_config.project, "version", ""),
            patch(
                "dify_vdb_weaviate.weaviate_vector.importlib.metadata.version",
                side_effect=Exception("no metadata"),
            ),
        ):
            assert _integration_version() == "unknown"


class TestRegisterIntegration(unittest.TestCase):
    """Tests for registering the integration header on the client."""

    def test_configures_header_with_dify_name_and_version(self):
        client = MagicMock()
        with patch.object(weaviate_vector_module.dify_config.project, "version", "1.15.0"):
            _register_integration(client)

        client.integrations.configure.assert_called_once()
        config = client.integrations.configure.call_args.args[0]
        header = config._to_header()
        assert header == {"X-Weaviate-Client-Integration": "dify/1.15.0"}
        assert _INTEGRATION_NAME == "dify"

    def test_swallows_errors_so_init_never_breaks(self):
        client = MagicMock()
        client.integrations.configure.side_effect = Exception("old client without integrations API")

        # Must not raise.
        with patch.object(weaviate_vector_module.dify_config.project, "version", "1.15.0"):
            _register_integration(client)


class TestInitClientRegistersIntegration(unittest.TestCase):
    """Ensures the integration header is registered during client initialization."""

    @override
    def setUp(self):
        weaviate_vector_module._weaviate_client = None
        self.config = WeaviateConfig(endpoint="http://localhost:8080", api_key="test-key")

    @override
    def tearDown(self):
        weaviate_vector_module._weaviate_client = None

    @patch("dify_vdb_weaviate.weaviate_vector.weaviate")
    def test_init_client_registers_integration(self, mock_weaviate_module):
        mock_client = MagicMock()
        mock_client.is_ready.return_value = True
        mock_weaviate_module.connect_to_custom.return_value = mock_client

        with patch("dify_vdb_weaviate.weaviate_vector._register_integration") as mock_register:
            WeaviateVector(
                collection_name="Test_Collection_Node",
                config=self.config,
                attributes=["doc_id"],
            )

        mock_register.assert_called_once_with(mock_client)


if __name__ == "__main__":
    unittest.main()
