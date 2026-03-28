from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

from core.entities import mcp_provider as mcp_provider_module
from core.entities.mcp_provider import (
    DEFAULT_EXPIRES_IN,
    DEFAULT_TOKEN_TYPE,
    MCPProviderEntity,
)
from core.mcp.types import OAuthTokens


def _build_mcp_provider_entity() -> MCPProviderEntity:
    now = datetime(2025, 1, 1, tzinfo=UTC)
    return MCPProviderEntity(
        id="provider-1",
        provider_id="server-1",
        name="Example MCP",
        tenant_id="tenant-1",
        user_id="user-1",
        server_url="encrypted-server-url",
        headers={},
        timeout=30,
        sse_read_timeout=300,
        authed=False,
        credentials={},
        tools=[],
        icon={"en_US": "icon.png"},
        created_at=now,
        updated_at=now,
    )


def test_from_db_model_maps_fields() -> None:
    # Arrange
    now = datetime(2025, 1, 1, tzinfo=UTC)
    db_provider = SimpleNamespace(
        id="provider-1",
        server_identifier="server-1",
        name="Example MCP",
        tenant_id="tenant-1",
        user_id="user-1",
        server_url="encrypted-server-url",
        headers={"Authorization": "enc"},
        timeout=15,
        sse_read_timeout=120,
        authed=True,
        credentials={"access_token": "enc-token"},
        tool_dict=[{"name": "search"}],
        icon=None,
        created_at=now,
        updated_at=now,
    )

    # Act
    entity = MCPProviderEntity.from_db_model(db_provider)

    # Assert
    assert entity.provider_id == "server-1"
    assert entity.tools == [{"name": "search"}]
    assert entity.icon == ""


def test_redirect_url_uses_console_api_url(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    entity = _build_mcp_provider_entity()
    monkeypatch.setattr(mcp_provider_module.dify_config, "CONSOLE_API_URL", "https://console.example.com")

    # Act
    redirect_url = entity.redirect_url

    # Assert
    assert redirect_url == "https://console.example.com/console/api/mcp/oauth/callback"


def test_client_metadata_for_authorization_code_flow() -> None:
    # Arrange
    entity = _build_mcp_provider_entity()

    with patch.object(MCPProviderEntity, "decrypt_credentials", return_value={}):
        # Act
        metadata = entity.client_metadata

    # Assert
    assert metadata.grant_types == ["refresh_token", "authorization_code"]
    assert metadata.redirect_uris == [entity.redirect_url]
    assert metadata.response_types == ["code"]


def test_client_metadata_for_client_credentials_flow() -> None:
    # Arrange
    entity = _build_mcp_provider_entity()
    credentials = {"client_information": {"grant_types": ["client_credentials"]}}

    with patch.object(MCPProviderEntity, "decrypt_credentials", return_value=credentials):
        # Act
        metadata = entity.client_metadata

    # Assert
    assert metadata.grant_types == ["refresh_token", "client_credentials"]
    assert metadata.redirect_uris == []
    assert metadata.response_types == []


def test_client_metadata_prefers_nested_authorization_code_grant_type() -> None:
    # Arrange
    entity = _build_mcp_provider_entity()
    credentials = {
        "grant_type": "client_credentials",
        "client_information": {"grant_types": ["authorization_code"]},
    }

    with patch.object(MCPProviderEntity, "decrypt_credentials", return_value=credentials):
        # Act
        metadata = entity.client_metadata

    # Assert
    assert metadata.grant_types == ["refresh_token", "authorization_code"]
    assert metadata.redirect_uris == [entity.redirect_url]
    assert metadata.response_types == ["code"]


def test_provider_icon_returns_icon_dict_as_is() -> None:
    # Arrange
    entity = _build_mcp_provider_entity().model_copy(update={"icon": {"en_US": "icon.png"}})

    # Act
    icon = entity.provider_icon

    # Assert
    assert icon == {"en_US": "icon.png"}


def test_provider_icon_uses_signed_url_for_plain_path() -> None:
    # Arrange
    entity = _build_mcp_provider_entity().model_copy(update={"icon": "icons/mcp.png"})

    with patch(
        "core.entities.mcp_provider.file_helpers.get_signed_file_url",
        return_value="https://signed.example.com/icons/mcp.png",
    ) as mock_get_signed_url:
        # Act
        icon = entity.provider_icon

    # Assert
    mock_get_signed_url.assert_called_once_with("icons/mcp.png")
    assert icon == "https://signed.example.com/icons/mcp.png"


def test_to_api_response_without_sensitive_data_skips_auth_related_work() -> None:
    # Arrange
    entity = _build_mcp_provider_entity().model_copy(update={"icon": {"en_US": "icon.png"}})

    with patch.object(MCPProviderEntity, "masked_server_url", return_value="https://api.example.com/******"):
        # Act
        response = entity.to_api_response(include_sensitive=False)

    # Assert
    assert response["author"] == "Anonymous"
    assert response["masked_headers"] == {}
    assert response["is_dynamic_registration"] is True
    assert "authentication" not in response


def test_to_api_response_with_sensitive_data_includes_masked_values() -> None:
    # Arrange
    entity = _build_mcp_provider_entity().model_copy(
        update={
            "credentials": {"client_information": {"is_dynamic_registration": False}},
            "icon": {"en_US": "icon.png"},
        }
    )

    with patch.object(MCPProviderEntity, "masked_server_url", return_value="https://api.example.com/******"):
        with patch.object(MCPProviderEntity, "masked_headers", return_value={"Authorization": "Be****"}):
            with patch.object(MCPProviderEntity, "masked_credentials", return_value={"client_id": "cl****"}):
                # Act
                response = entity.to_api_response(user_name="Rajat", include_sensitive=True)

    # Assert
    assert response["author"] == "Rajat"
    assert response["masked_headers"] == {"Authorization": "Be****"}
    assert response["authentication"] == {"client_id": "cl****"}
    assert response["is_dynamic_registration"] is False


def test_retrieve_client_information_decrypts_nested_secret() -> None:
    # Arrange
    entity = _build_mcp_provider_entity()
    credentials = {"client_information": {"client_id": "client-1", "encrypted_client_secret": "enc-secret"}}

    with patch.object(MCPProviderEntity, "decrypt_credentials", return_value=credentials):
        with patch("core.entities.mcp_provider.encrypter.decrypt_token", return_value="plain-secret") as mock_decrypt:
            # Act
            client_info = entity.retrieve_client_information()

    # Assert
    assert client_info is not None
    assert client_info.client_id == "client-1"
    assert client_info.client_secret == "plain-secret"
    mock_decrypt.assert_called_once_with("tenant-1", "enc-secret")


def test_retrieve_client_information_returns_none_for_missing_data() -> None:
    # Arrange
    entity = _build_mcp_provider_entity()

    with patch.object(MCPProviderEntity, "decrypt_credentials", return_value={}):
        # Act
        result_empty = entity.retrieve_client_information()

    with patch.object(MCPProviderEntity, "decrypt_credentials", return_value={"client_information": "invalid"}):
        # Act
        result_invalid = entity.retrieve_client_information()

    # Assert
    assert result_empty is None
    assert result_invalid is None


def test_masked_server_url_hides_path_segments() -> None:
    # Arrange
    entity = _build_mcp_provider_entity()

    with patch.object(
        MCPProviderEntity,
        "decrypt_server_url",
        return_value="https://api.example.com/v1/mcp?query=1",
    ):
        # Act
        masked_url = entity.masked_server_url()

    # Assert
    assert masked_url == "https://api.example.com/******?query=1"


def test_mask_value_covers_short_and_long_values() -> None:
    # Arrange
    entity = _build_mcp_provider_entity()

    # Act
    short_masked = entity._mask_value("short")
    long_masked = entity._mask_value("abcdefghijkl")

    # Assert
    assert short_masked == "*****"
    assert long_masked == "ab********kl"


def test_masked_headers_masks_all_decrypted_header_values() -> None:
    # Arrange
    entity = _build_mcp_provider_entity()

    with patch.object(MCPProviderEntity, "decrypt_headers", return_value={"Authorization": "abcdefgh"}):
        # Act
        masked = entity.masked_headers()

    # Assert
    assert masked == {"Authorization": "ab****gh"}


def test_masked_credentials_handles_nested_secret_fields() -> None:
    # Arrange
    entity = _build_mcp_provider_entity()
    credentials = {
        "client_information": {
            "client_id": "client-id",
            "encrypted_client_secret": "encrypted-value",
            "client_secret": "plain-secret",
        }
    }

    with patch.object(MCPProviderEntity, "decrypt_credentials", return_value=credentials):
        with patch("core.entities.mcp_provider.encrypter.decrypt_token", return_value="decrypted-secret"):
            # Act
            masked = entity.masked_credentials()

    # Assert
    assert masked["client_id"] == "cl*****id"
    assert masked["client_secret"] == "pl********et"


def test_masked_credentials_returns_empty_for_missing_client_information() -> None:
    # Arrange
    entity = _build_mcp_provider_entity()

    with patch.object(MCPProviderEntity, "decrypt_credentials", return_value={}):
        # Act
        masked_empty = entity.masked_credentials()

    with patch.object(MCPProviderEntity, "decrypt_credentials", return_value={"client_information": "invalid"}):
        # Act
        masked_invalid = entity.masked_credentials()

    # Assert
    assert masked_empty == {}
    assert masked_invalid == {}


def test_retrieve_tokens_returns_defaults_when_optional_fields_missing() -> None:
    # Arrange
    entity = _build_mcp_provider_entity().model_copy(update={"credentials": {"token": "encrypted"}})

    with patch.object(
        MCPProviderEntity,
        "decrypt_credentials",
        return_value={"access_token": "token", "expires_in": "", "refresh_token": "refresh"},
    ):
        # Act
        tokens = entity.retrieve_tokens()

    # Assert
    assert isinstance(tokens, OAuthTokens)
    assert tokens.access_token == "token"
    assert tokens.token_type == DEFAULT_TOKEN_TYPE
    assert tokens.expires_in == DEFAULT_EXPIRES_IN
    assert tokens.refresh_token == "refresh"


def test_retrieve_tokens_returns_none_when_access_token_missing() -> None:
    # Arrange
    entity = _build_mcp_provider_entity().model_copy(update={"credentials": {"token": "encrypted"}})

    with patch.object(MCPProviderEntity, "decrypt_credentials", return_value={"access_token": ""}) as mock_decrypt:
        # Act
        tokens = entity.retrieve_tokens()

    # Assert
    mock_decrypt.assert_called_once()
    assert tokens is None


def test_decrypt_server_url_delegates_to_encrypter() -> None:
    # Arrange
    entity = _build_mcp_provider_entity()

    with patch("core.entities.mcp_provider.encrypter.decrypt_token", return_value="https://api.example.com") as mock:
        # Act
        decrypted = entity.decrypt_server_url()

    # Assert
    mock.assert_called_once_with("tenant-1", "encrypted-server-url")
    assert decrypted == "https://api.example.com"


def test_decrypt_authentication_injects_authorization_for_oauth() -> None:
    # Arrange
    entity = _build_mcp_provider_entity().model_copy(update={"authed": True, "headers": {}})

    with patch.object(MCPProviderEntity, "decrypt_headers", return_value={}):
        with patch.object(
            MCPProviderEntity,
            "retrieve_tokens",
            return_value=OAuthTokens(access_token="abc123", token_type="bearer"),
        ):
            # Act
            headers = entity.decrypt_authentication()

    # Assert
    assert headers["Authorization"] == "Bearer abc123"


def test_decrypt_authentication_does_not_overwrite_existing_headers() -> None:
    # Arrange
    entity = _build_mcp_provider_entity().model_copy(
        update={"authed": True, "headers": {"Authorization": "encrypted-header"}}
    )

    with patch.object(MCPProviderEntity, "decrypt_headers", return_value={"Authorization": "existing"}):
        with patch.object(
            MCPProviderEntity,
            "retrieve_tokens",
            return_value=OAuthTokens(access_token="abc", token_type="bearer"),
        ) as mock_tokens:
            # Act
            headers = entity.decrypt_authentication()

    # Assert
    mock_tokens.assert_not_called()
    assert headers == {"Authorization": "existing"}


def test_decrypt_dict_returns_empty_for_empty_input() -> None:
    # Arrange
    entity = _build_mcp_provider_entity()

    # Act
    decrypted = entity._decrypt_dict({})

    # Assert
    assert decrypted == {}


def test_decrypt_dict_returns_original_data_when_no_encrypted_fields() -> None:
    # Arrange
    entity = _build_mcp_provider_entity()
    input_data = {"nested": {"k": "v"}, "count": 2, "empty": ""}

    # Act
    result = entity._decrypt_dict(input_data)

    # Assert
    assert result is input_data


def test_decrypt_dict_only_decrypts_top_level_string_values() -> None:
    # Arrange
    entity = _build_mcp_provider_entity()
    decryptor = Mock()
    decryptor.decrypt.return_value = {"api_key": "plain-key"}

    def _fake_create_provider_encrypter(*, tenant_id: str, config: list, cache):
        assert tenant_id == "tenant-1"
        assert any(item.name == "api_key" for item in config)
        return decryptor, None

    with patch("core.tools.utils.encryption.create_provider_encrypter", side_effect=_fake_create_provider_encrypter):
        # Act
        result = entity._decrypt_dict(
            {
                "api_key": "encrypted-key",
                "nested": {"client_id": "unchanged"},
                "empty": "",
                "count": 2,
            }
        )

    # Assert
    decryptor.decrypt.assert_called_once_with({"api_key": "encrypted-key"})
    assert result["api_key"] == "plain-key"
    assert result["nested"] == {"client_id": "unchanged"}
    assert result["count"] == 2


def test_decrypt_headers_and_credentials_delegate_to_decrypt_dict() -> None:
    # Arrange
    entity = _build_mcp_provider_entity()

    with patch.object(MCPProviderEntity, "_decrypt_dict", side_effect=[{"h": "v"}, {"c": "v"}]) as mock:
        # Act
        headers = entity.decrypt_headers()
        credentials = entity.decrypt_credentials()

    # Assert
    assert mock.call_count == 2
    assert headers == {"h": "v"}
    assert credentials == {"c": "v"}
