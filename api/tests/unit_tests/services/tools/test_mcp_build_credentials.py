"""Tests for MCPToolManageService._build_and_encrypt_credentials scope support."""

import json
from unittest.mock import MagicMock, patch

from services.tools.mcp_tools_manage_service import MCPToolManageService


def _create_service() -> MCPToolManageService:
    """Create a service instance with a mock session."""
    return MCPToolManageService(session=MagicMock())


def _stub_encrypt_dict_fields(data, secret_fields, tenant_id):
    """Stub that returns data as-is (no actual encryption)."""
    return dict(data)


class TestBuildAndEncryptCredentials:
    """Tests for _build_and_encrypt_credentials, focusing on scope handling."""

    def test_without_scope_omits_scope_key(self) -> None:
        # Arrange
        service = _create_service()

        with patch.object(service, "_encrypt_dict_fields", side_effect=_stub_encrypt_dict_fields):
            # Act
            result_json = service._build_and_encrypt_credentials("client-1", "secret", "tenant-1")

        # Assert
        result = json.loads(result_json)
        assert "client_information" in result
        assert "scope" not in result
        assert result["client_information"]["client_id"] == "client-1"

    def test_with_scope_includes_scope_key(self) -> None:
        # Arrange
        service = _create_service()

        with patch.object(service, "_encrypt_dict_fields", side_effect=_stub_encrypt_dict_fields):
            # Act
            result_json = service._build_and_encrypt_credentials(
                "client-1", "secret", "tenant-1", scope="gateway:invoke"
            )

        # Assert
        result = json.loads(result_json)
        assert result["scope"] == "gateway:invoke"
        assert result["client_information"]["client_id"] == "client-1"

    def test_with_empty_scope_omits_scope_key(self) -> None:
        # Arrange
        service = _create_service()

        with patch.object(service, "_encrypt_dict_fields", side_effect=_stub_encrypt_dict_fields):
            # Act
            result_json = service._build_and_encrypt_credentials("client-1", "secret", "tenant-1", scope="")

        # Assert
        result = json.loads(result_json)
        assert "scope" not in result

    def test_with_none_scope_omits_scope_key(self) -> None:
        # Arrange
        service = _create_service()

        with patch.object(service, "_encrypt_dict_fields", side_effect=_stub_encrypt_dict_fields):
            # Act
            result_json = service._build_and_encrypt_credentials("client-1", "secret", "tenant-1", scope=None)

        # Assert
        result = json.loads(result_json)
        assert "scope" not in result

    def test_with_multiple_scopes(self) -> None:
        # Arrange
        service = _create_service()

        with patch.object(service, "_encrypt_dict_fields", side_effect=_stub_encrypt_dict_fields):
            # Act
            result_json = service._build_and_encrypt_credentials(
                "client-1", "secret", "tenant-1", scope="gateway:invoke openid profile"
            )

        # Assert
        result = json.loads(result_json)
        assert result["scope"] == "gateway:invoke openid profile"

    def test_without_client_secret(self) -> None:
        # Arrange
        service = _create_service()

        with patch.object(service, "_encrypt_dict_fields", side_effect=_stub_encrypt_dict_fields):
            # Act
            result_json = service._build_and_encrypt_credentials(
                "client-1", None, "tenant-1", scope="gateway:invoke"
            )

        # Assert
        result = json.loads(result_json)
        assert result["scope"] == "gateway:invoke"
        assert "encrypted_client_secret" not in result["client_information"]

    def test_scope_is_stored_at_top_level_not_in_client_information(self) -> None:
        """Scope must be at the top level of credentials (not inside client_information)
        because auth_flow.auth() reads credentials.get('scope') at the top level."""
        # Arrange
        service = _create_service()

        with patch.object(service, "_encrypt_dict_fields", side_effect=_stub_encrypt_dict_fields):
            # Act
            result_json = service._build_and_encrypt_credentials(
                "client-1", "secret", "tenant-1", scope="gateway:invoke"
            )

        # Assert
        result = json.loads(result_json)
        assert result["scope"] == "gateway:invoke"
        assert "scope" not in result["client_information"]
