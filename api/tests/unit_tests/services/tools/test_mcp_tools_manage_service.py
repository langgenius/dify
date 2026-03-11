from __future__ import annotations

import hashlib
import json
from datetime import datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.exc import IntegrityError

from core.entities.mcp_provider import MCPAuthentication, MCPConfiguration, MCPProviderEntity
from core.mcp.entities import AuthActionType
from core.mcp.error import MCPAuthError, MCPError
from models.tools import MCPToolProvider
from services.tools.mcp_tools_manage_service import (
    EMPTY_CREDENTIALS_JSON,
    EMPTY_TOOLS_JSON,
    UNCHANGED_SERVER_URL_PLACEHOLDER,
    MCPToolManageService,
    OAuthDataType,
    ProviderUrlValidationData,
    ReconnectResult,
    ServerUrlValidationResult,
)


class _ToolStub:
    def __init__(self, name: str, description: str | None) -> None:
        self._name = name
        self._description = description

    def model_dump(self) -> dict[str, str | None]:
        return {"name": self._name, "description": self._description}


@pytest.fixture
def mock_session() -> MagicMock:
    # Arrange
    return MagicMock()


@pytest.fixture
def service(mock_session: MagicMock) -> MCPToolManageService:
    # Arrange
    return MCPToolManageService(session=mock_session)


def _provider_entity_stub(*, authed: bool = True) -> MCPProviderEntity:
    return cast(
        MCPProviderEntity,
        SimpleNamespace(
            authed=authed,
            timeout=30.0,
            sse_read_timeout=300.0,
            provider_id="server-1",
            headers={"x-api-key": "enc"},
            decrypt_headers=lambda: {"x-api-key": "key"},
            retrieve_tokens=lambda: SimpleNamespace(token_type="bearer", access_token="token-1"),
            decrypt_server_url=lambda: "https://mcp.example.com/sse",
            to_api_response=lambda user_name=None: {
                "id": "provider-1",
                "author": user_name or "Anonymous",
                "name": "MCP Tool",
                "description": {"en_US": "", "zh_Hans": ""},
                "icon": "icon",
                "label": {"en_US": "MCP Tool", "zh_Hans": "MCP Tool"},
                "type": "mcp",
                "is_team_authorization": True,
                "server_url": "https://mcp.example.com/******",
                "updated_at": 1,
                "server_identifier": "server-1",
                "configuration": {"timeout": "30", "sse_read_timeout": "300"},
                "masked_headers": {},
                "is_dynamic_registration": True,
            },
            decrypt_credentials=lambda: {"client_id": "plain-id", "client_secret": "plain-secret"},
            masked_credentials=lambda: {"client_id": "pl***id", "client_secret": "pl***et"},
            masked_headers=lambda: {"x-api-key": "ke***ey"},
        ),
    )


def _provider_stub(*, authed: bool = True) -> MCPToolProvider:
    entity = _provider_entity_stub(authed=authed)
    return cast(
        MCPToolProvider,
        SimpleNamespace(
            id="provider-1",
            tenant_id="tenant-1",
            user_id="user-1",
            name="Provider A",
            server_identifier="server-1",
            server_url="encrypted-url",
            server_url_hash="old-hash",
            authed=authed,
            tools=EMPTY_TOOLS_JSON,
            encrypted_credentials=json.dumps({"existing": "credential"}),
            encrypted_headers=json.dumps({"x-api-key": "enc"}),
            credentials={"existing": "credential"},
            timeout=30.0,
            sse_read_timeout=300.0,
            updated_at=datetime.now(),
            icon="icon",
            to_entity=lambda: entity,
            load_user=lambda: SimpleNamespace(name="Tester"),
        ),
    )


def test_server_url_validation_result_should_update_server_url_when_all_conditions_match() -> None:
    # Arrange
    result = ServerUrlValidationResult(
        needs_validation=True,
        validation_passed=True,
        reconnect_result=ReconnectResult(authed=True, tools="[]", encrypted_credentials="{}"),
    )

    # Act
    should_update = result.should_update_server_url

    # Assert
    assert should_update is True


def test_get_provider_should_return_provider_when_exists(
    service: MCPToolManageService,
    mock_session: MagicMock,
) -> None:
    # Arrange
    provider = _provider_stub()
    mock_session.scalar.return_value = provider

    # Act
    result = service.get_provider(provider_id="provider-1", tenant_id="tenant-1")

    # Assert
    assert result is provider


def test_get_provider_should_raise_error_when_provider_not_found(
    service: MCPToolManageService, mock_session: MagicMock
) -> None:
    # Arrange
    mock_session.scalar.return_value = None

    # Act + Assert
    with pytest.raises(ValueError, match="MCP tool not found"):
        service.get_provider(provider_id="provider-404", tenant_id="tenant-1")


def test_get_provider_entity_should_get_entity_by_provider_id_when_by_server_id_is_false(
    service: MCPToolManageService,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider = _provider_stub()
    mock_get_provider = mocker.patch.object(service, "get_provider", return_value=provider)

    # Act
    result = service.get_provider_entity("provider-1", "tenant-1", by_server_id=False)

    # Assert
    assert result is provider.to_entity()
    mock_get_provider.assert_called_once_with(provider_id="provider-1", tenant_id="tenant-1")


def test_get_provider_entity_should_get_entity_by_server_identifier_when_by_server_id_is_true(
    service: MCPToolManageService,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider = _provider_stub()
    mock_get_provider = mocker.patch.object(service, "get_provider", return_value=provider)

    # Act
    result = service.get_provider_entity("server-1", "tenant-1", by_server_id=True)

    # Assert
    assert result is provider.to_entity()
    mock_get_provider.assert_called_once_with(server_identifier="server-1", tenant_id="tenant-1")


def test_create_provider_should_raise_error_when_server_url_is_invalid(service: MCPToolManageService) -> None:
    # Arrange
    config = MCPConfiguration(timeout=30, sse_read_timeout=300)

    # Act + Assert
    with pytest.raises(ValueError, match="Server URL is not valid"):
        service.create_provider(
            tenant_id="tenant-1",
            name="Provider A",
            server_url="invalid-url",
            user_id="user-1",
            icon="icon",
            icon_type="emoji",
            icon_background="#fff",
            server_identifier="server-1",
            configuration=config,
        )


def test_create_provider_should_create_and_return_user_provider_when_input_is_valid(
    service: MCPToolManageService,
    mock_session: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    config = MCPConfiguration(timeout=42, sse_read_timeout=123)
    auth_data = MCPAuthentication(client_id="client-id", client_secret="secret")
    mocker.patch.object(service, "_check_provider_exists")
    mocker.patch("services.tools.mcp_tools_manage_service.encrypter.encrypt_token", return_value="encrypted-url")
    mocker.patch.object(service, "_prepare_encrypted_dict", return_value='{"x":"enc"}')
    mocker.patch.object(service, "_build_and_encrypt_credentials", return_value='{"client_information":{}}')
    mocker.patch.object(service, "_prepare_icon", return_value='{"content":"😀"}')
    expected_user_provider = {"id": "provider-1"}
    mock_convert = mocker.patch(
        "services.tools.mcp_tools_manage_service.ToolTransformService.mcp_provider_to_user_provider",
        return_value=expected_user_provider,
    )

    # Act
    result = service.create_provider(
        tenant_id="tenant-1",
        name="Provider A",
        server_url="https://mcp.example.com",
        user_id="user-1",
        icon="😀",
        icon_type="emoji",
        icon_background="#fff",
        server_identifier="server-1",
        configuration=config,
        authentication=auth_data,
        headers={"x-api-key": "v1"},
    )

    # Assert
    assert result == expected_user_provider
    mock_session.add.assert_called_once()
    mock_session.flush.assert_called_once()
    mock_convert.assert_called_once()


def test_update_provider_should_raise_error_when_new_name_conflicts(
    service: MCPToolManageService,
    mock_session: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider = _provider_stub()
    mocker.patch.object(service, "get_provider", return_value=provider)
    mock_session.scalar.return_value = object()

    # Act + Assert
    with pytest.raises(ValueError, match="already exists"):
        service.update_provider(
            tenant_id="tenant-1",
            provider_id="provider-1",
            name="New Name",
            server_url="https://mcp.example.com",
            icon="😀",
            icon_type="emoji",
            icon_background="#fff",
            server_identifier="server-1",
            configuration=MCPConfiguration(),
        )


def test_update_provider_should_update_fields_when_input_is_valid(
    service: MCPToolManageService,
    mock_session: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider = _provider_stub()
    validation = ServerUrlValidationResult(
        needs_validation=True,
        validation_passed=True,
        reconnect_result=ReconnectResult(authed=True, tools='[{"name":"t"}]', encrypted_credentials='{"x":"y"}'),
        encrypted_server_url="new-encrypted-url",
        server_url_hash="new-hash",
    )
    mocker.patch.object(service, "get_provider", return_value=provider)
    mock_session.scalar.return_value = None
    mocker.patch.object(service, "_prepare_icon", return_value="new-icon")
    mocker.patch.object(service, "_process_headers", return_value='{"x":"enc"}')
    mocker.patch.object(service, "_process_credentials", return_value='{"client":"enc"}')

    # Act
    service.update_provider(
        tenant_id="tenant-1",
        provider_id="provider-1",
        name="Provider B",
        server_url="https://mcp.example.com/new",
        icon="😎",
        icon_type="emoji",
        icon_background="#000",
        server_identifier="server-2",
        headers={"x-api-key": "v2"},
        configuration=MCPConfiguration(timeout=50, sse_read_timeout=120),
        authentication=MCPAuthentication(client_id="new-id", client_secret="new-secret"),
        validation_result=validation,
    )

    # Assert
    assert provider.name == "Provider B"
    assert provider.server_identifier == "server-2"
    assert provider.server_url == "new-encrypted-url"
    assert provider.server_url_hash == "new-hash"
    assert provider.authed is True
    assert provider.tools == '[{"name":"t"}]'
    assert provider.encrypted_credentials == '{"client":"enc"}'
    assert provider.encrypted_headers == '{"x":"enc"}'
    assert provider.timeout == 50
    assert provider.sse_read_timeout == 120
    mock_session.flush.assert_called_once()


def test_update_provider_should_handle_integrity_error_with_readable_message(
    service: MCPToolManageService,
    mock_session: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider = _provider_stub()
    mocker.patch.object(service, "get_provider", return_value=provider)
    mock_session.scalar.return_value = None
    mocker.patch.object(service, "_prepare_icon", return_value="icon")
    mock_session.flush.side_effect = IntegrityError("stmt", {}, Exception("unique_mcp_provider_name"))

    # Act + Assert
    with pytest.raises(ValueError, match="MCP tool Provider A already exists"):
        service.update_provider(
            tenant_id="tenant-1",
            provider_id="provider-1",
            name="Provider A",
            server_url="https://mcp.example.com",
            icon="😀",
            icon_type="emoji",
            icon_background="#fff",
            server_identifier="server-1",
            configuration=MCPConfiguration(),
        )


def test_delete_provider_should_delete_existing_provider(
    service: MCPToolManageService,
    mock_session: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider = _provider_stub()
    mocker.patch.object(service, "get_provider", return_value=provider)

    # Act
    service.delete_provider(tenant_id="tenant-1", provider_id="provider-1")

    # Assert
    mock_session.delete.assert_called_once_with(provider)


def test_list_providers_should_return_empty_list_when_no_provider_exists(
    service: MCPToolManageService,
    mock_session: MagicMock,
) -> None:
    # Arrange
    mock_session.scalars.return_value.all.return_value = []

    # Act
    result = service.list_providers(tenant_id="tenant-1")

    # Assert
    assert result == []


def test_list_providers_should_convert_all_providers_and_attach_user_names(
    service: MCPToolManageService,
    mock_session: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider_1 = _provider_stub()
    provider_2 = _provider_stub()
    provider_2.user_id = "user-2"
    mock_session.scalars.return_value.all.return_value = [provider_1, provider_2]
    mock_session.query.return_value.where.return_value.all.return_value = [
        SimpleNamespace(id="user-1", name="Alice"),
        SimpleNamespace(id="user-2", name="Bob"),
    ]
    mock_convert = mocker.patch(
        "services.tools.mcp_tools_manage_service.ToolTransformService.mcp_provider_to_user_provider",
        side_effect=[{"id": "1"}, {"id": "2"}],
    )

    # Act
    result = service.list_providers(tenant_id="tenant-1", for_list=True, include_sensitive=False)

    # Assert
    assert result == [{"id": "1"}, {"id": "2"}]
    assert mock_convert.call_count == 2


def test_list_provider_tools_should_raise_error_when_provider_is_not_authenticated(
    service: MCPToolManageService,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider = _provider_stub(authed=False)
    mocker.patch.object(service, "get_provider", return_value=provider)

    # Act + Assert
    with pytest.raises(ValueError, match="Please auth the tool first"):
        service.list_provider_tools(tenant_id="tenant-1", provider_id="provider-1")


def test_list_provider_tools_should_raise_error_when_remote_client_fails(
    service: MCPToolManageService,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider = _provider_stub(authed=True)
    mocker.patch.object(service, "get_provider", return_value=provider)
    mcp_client_instance = MagicMock()
    mcp_client_instance.list_tools.side_effect = MCPError("connection failed")
    mock_client_cls = mocker.patch("services.tools.mcp_tools_manage_service.MCPClientWithAuthRetry")
    mock_client_cls.return_value.__enter__.return_value = mcp_client_instance

    # Act + Assert
    with pytest.raises(ValueError, match="Failed to connect to MCP server"):
        service.list_provider_tools(tenant_id="tenant-1", provider_id="provider-1")


def test_list_provider_tools_should_update_db_and_return_response_on_success(
    service: MCPToolManageService,
    mock_session: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider = _provider_stub(authed=True)
    mocker.patch.object(service, "get_provider", return_value=provider)
    mcp_client_instance = MagicMock()
    mcp_client_instance.list_tools.return_value = [
        _ToolStub("tool-a", None),
        _ToolStub("tool-b", "desc"),
    ]
    mock_client_cls = mocker.patch("services.tools.mcp_tools_manage_service.MCPClientWithAuthRetry")
    mock_client_cls.return_value.__enter__.return_value = mcp_client_instance
    mocker.patch("services.tools.mcp_tools_manage_service.ToolTransformService.mcp_tool_to_user_tool", return_value=[])

    # Act
    result = service.list_provider_tools(tenant_id="tenant-1", provider_id="provider-1")

    # Assert
    assert result.plugin_unique_identifier == "server-1"
    assert provider.authed is True
    payload = json.loads(provider.tools)
    assert payload[0]["description"] == ""
    assert payload[1]["description"] == "desc"
    mock_session.flush.assert_called_once()


def test_update_provider_credentials_should_update_encrypted_credentials_and_auth_state(
    service: MCPToolManageService,
    mock_session: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider = _provider_stub(authed=True)
    provider.encrypted_credentials = json.dumps({"existing": "value"})
    mocker.patch.object(service, "get_provider", return_value=provider)
    mock_controller = MagicMock()
    mocker.patch("core.tools.mcp_tool.provider.MCPToolProviderController.from_db", return_value=mock_controller)
    mock_encryptor = MagicMock()
    mock_encryptor.encrypt.return_value = {"access_token": "encrypted-token"}
    mocker.patch("services.tools.mcp_tools_manage_service.ProviderConfigEncrypter", return_value=mock_encryptor)

    # Act
    service.update_provider_credentials(
        provider_id="provider-1",
        tenant_id="tenant-1",
        credentials={"access_token": "plain-token"},
        authed=False,
    )

    # Assert
    assert provider.authed is False
    assert provider.tools == EMPTY_TOOLS_JSON
    assert json.loads(cast(str, provider.encrypted_credentials))["access_token"] == "encrypted-token"
    mock_session.flush.assert_called_once()


@pytest.mark.parametrize(
    ("data_type", "data", "expected_authed"),
    [
        (OAuthDataType.TOKENS, {"access_token": "token"}, True),
        (OAuthDataType.MIXED, {"access_token": "token"}, True),
        (OAuthDataType.MIXED, {"client_id": "id"}, None),
        (OAuthDataType.CLIENT_INFO, {"client_id": "id"}, None),
    ],
)
def test_save_oauth_data_should_delegate_with_expected_authed_value(
    data_type: OAuthDataType,
    data: dict[str, str],
    expected_authed: bool | None,
    service: MCPToolManageService,
    mocker: MockerFixture,
) -> None:
    # Arrange
    mock_update = mocker.patch.object(service, "update_provider_credentials")

    # Act
    service.save_oauth_data("provider-1", "tenant-1", data, data_type)

    # Assert
    assert mock_update.call_args.kwargs["authed"] == expected_authed


def test_clear_provider_credentials_should_reset_provider_state(
    service: MCPToolManageService,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider = _provider_stub(authed=True)
    mocker.patch.object(service, "get_provider", return_value=provider)

    # Act
    service.clear_provider_credentials(provider_id="provider-1", tenant_id="tenant-1")

    # Assert
    assert provider.tools == EMPTY_TOOLS_JSON
    assert provider.encrypted_credentials == EMPTY_CREDENTIALS_JSON
    assert provider.authed is False


def test_check_provider_exists_should_raise_different_errors_for_conflicts(
    service: MCPToolManageService,
    mock_session: MagicMock,
) -> None:
    # Arrange
    mock_session.scalar.return_value = SimpleNamespace(
        name="name-a",
        server_url_hash="hash-a",
        server_identifier="server-a",
    )

    # Act + Assert
    with pytest.raises(ValueError, match="MCP tool name-a already exists"):
        service._check_provider_exists("tenant-1", "name-a", "hash-b", "server-b")
    with pytest.raises(ValueError, match="MCP tool with this server URL already exists"):
        service._check_provider_exists("tenant-1", "name-b", "hash-a", "server-b")
    with pytest.raises(ValueError, match="MCP tool server-a already exists"):
        service._check_provider_exists("tenant-1", "name-b", "hash-b", "server-a")


def test_prepare_icon_should_return_json_for_emoji_and_raw_value_for_non_emoji(service: MCPToolManageService) -> None:
    # Arrange
    # Act
    emoji_icon = service._prepare_icon("😀", "emoji", "#fff")
    raw_icon = service._prepare_icon("https://icon.png", "file", "#000")

    # Assert
    assert json.loads(emoji_icon)["content"] == "😀"
    assert raw_icon == "https://icon.png"


def test_encrypt_dict_fields_should_encrypt_secret_fields(service: MCPToolManageService, mocker: MockerFixture) -> None:
    # Arrange
    mock_encryptor = MagicMock()
    mock_encryptor.encrypt.return_value = {"Authorization": "enc-token"}
    mocker.patch("core.tools.utils.encryption.create_provider_encrypter", return_value=(mock_encryptor, MagicMock()))

    # Act
    result = service._encrypt_dict_fields({"Authorization": "token"}, ["Authorization"], "tenant-1")

    # Assert
    assert result == {"Authorization": "enc-token"}


def test_prepare_encrypted_dict_should_return_json_string(service: MCPToolManageService, mocker: MockerFixture) -> None:
    # Arrange
    mocker.patch.object(service, "_encrypt_dict_fields", return_value={"x": "enc"})

    # Act
    result = service._prepare_encrypted_dict({"x": "v"}, "tenant-1")

    # Assert
    assert result == '{"x": "enc"}'


def test_prepare_auth_headers_should_append_authorization_when_tokens_exist(service: MCPToolManageService) -> None:
    # Arrange
    provider_entity = _provider_entity_stub()

    # Act
    headers = service._prepare_auth_headers(provider_entity)

    # Assert
    assert headers["Authorization"] == "Bearer token-1"


def test_retrieve_remote_mcp_tools_should_return_tools_from_client(
    service: MCPToolManageService,
    mocker: MockerFixture,
) -> None:
    # Arrange
    mcp_client_instance = MagicMock()
    mcp_client_instance.list_tools.return_value = [_ToolStub("tool-a", "desc")]
    mock_client_cls = mocker.patch("services.tools.mcp_tools_manage_service.MCPClientWithAuthRetry")
    mock_client_cls.return_value.__enter__.return_value = mcp_client_instance

    # Act
    tools = service._retrieve_remote_mcp_tools("https://mcp.example.com", {}, _provider_entity_stub())

    # Assert
    assert len(tools) == 1
    assert tools[0].model_dump()["name"] == "tool-a"


def test_execute_auth_actions_should_dispatch_supported_actions(
    service: MCPToolManageService,
    mocker: MockerFixture,
) -> None:
    # Arrange
    mock_save = mocker.patch.object(service, "save_oauth_data")
    auth_result = SimpleNamespace(
        actions=[
            SimpleNamespace(
                action_type=AuthActionType.SAVE_CLIENT_INFO,
                data={"client_id": "c1"},
                provider_id="provider-1",
                tenant_id="tenant-1",
            ),
            SimpleNamespace(
                action_type=AuthActionType.SAVE_TOKENS,
                data={"access_token": "t1"},
                provider_id="provider-1",
                tenant_id="tenant-1",
            ),
            SimpleNamespace(
                action_type=AuthActionType.SAVE_CODE_VERIFIER,
                data={"code_verifier": "cv"},
                provider_id="provider-1",
                tenant_id="tenant-1",
            ),
            SimpleNamespace(
                action_type=AuthActionType.SAVE_TOKENS,
                data={"access_token": "skip"},
                provider_id=None,
                tenant_id="tenant-1",
            ),
        ],
        response={"ok": "1"},
    )

    # Act
    result = service.execute_auth_actions(auth_result)

    # Assert
    assert result == {"ok": "1"}
    assert mock_save.call_count == 3


def test_auth_with_actions_should_call_auth_and_execute_actions(
    service: MCPToolManageService,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider_entity = _provider_entity_stub()
    auth_result = SimpleNamespace(actions=[], response={"status": "ok"})
    mocker.patch("services.tools.mcp_tools_manage_service.auth", return_value=auth_result)
    mock_execute = mocker.patch.object(service, "execute_auth_actions", return_value={"status": "ok"})

    # Act
    result = service.auth_with_actions(provider_entity=provider_entity, authorization_code="code-1")

    # Assert
    assert result == {"status": "ok"}
    mock_execute.assert_called_once_with(auth_result)


def test_get_provider_for_url_validation_should_return_validation_data(
    service: MCPToolManageService,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider = _provider_stub()
    mocker.patch.object(service, "get_provider", return_value=provider)

    # Act
    result = service.get_provider_for_url_validation(tenant_id="tenant-1", provider_id="provider-1")

    # Assert
    assert result.current_server_url_hash == "old-hash"
    assert result.headers == {"x-api-key": "enc"}


def test_validate_server_url_standalone_should_skip_validation_for_unchanged_placeholder() -> None:
    # Arrange
    data = ProviderUrlValidationData(current_server_url_hash="hash", headers={}, timeout=30, sse_read_timeout=300)

    # Act
    result = MCPToolManageService.validate_server_url_standalone(
        tenant_id="tenant-1",
        new_server_url=UNCHANGED_SERVER_URL_PLACEHOLDER,
        validation_data=data,
    )

    # Assert
    assert result.needs_validation is False


def test_validate_server_url_standalone_should_raise_error_for_invalid_url() -> None:
    # Arrange
    data = ProviderUrlValidationData(current_server_url_hash="hash", headers={}, timeout=30, sse_read_timeout=300)

    # Act + Assert
    with pytest.raises(ValueError, match="Server URL is not valid"):
        MCPToolManageService.validate_server_url_standalone(
            tenant_id="tenant-1",
            new_server_url="bad-url",
            validation_data=data,
        )


def test_validate_server_url_standalone_should_return_no_validation_when_hash_unchanged(mocker: MockerFixture) -> None:
    # Arrange
    url = "https://mcp.example.com"
    current_hash = hashlib.sha256(url.encode()).hexdigest()
    data = ProviderUrlValidationData(current_server_url_hash=current_hash, headers={}, timeout=30, sse_read_timeout=300)
    mocker.patch("services.tools.mcp_tools_manage_service.encrypter.encrypt_token", return_value="enc-url")

    # Act
    result = MCPToolManageService.validate_server_url_standalone(
        tenant_id="tenant-1",
        new_server_url=url,
        validation_data=data,
    )

    # Assert
    assert result.needs_validation is False
    assert result.encrypted_server_url == "enc-url"
    assert result.server_url_hash == current_hash


def test_validate_server_url_standalone_should_reconnect_when_url_changes(mocker: MockerFixture) -> None:
    # Arrange
    url = "https://mcp-new.example.com"
    data = ProviderUrlValidationData(current_server_url_hash="old", headers={}, timeout=30, sse_read_timeout=300)
    reconnect_result = ReconnectResult(authed=True, tools='[{"name":"x"}]', encrypted_credentials="{}")
    mocker.patch("services.tools.mcp_tools_manage_service.encrypter.encrypt_token", return_value="enc-new")
    mock_reconnect = mocker.patch.object(MCPToolManageService, "_reconnect_with_url", return_value=reconnect_result)

    # Act
    result = MCPToolManageService.validate_server_url_standalone(
        tenant_id="tenant-1",
        new_server_url=url,
        validation_data=data,
    )

    # Assert
    assert result.validation_passed is True
    assert result.reconnect_result == reconnect_result
    mock_reconnect.assert_called_once()


def test_reconnect_with_url_should_delegate_to_private_method(mocker: MockerFixture) -> None:
    # Arrange
    expected = ReconnectResult(authed=True, tools="[]", encrypted_credentials="{}")
    mock_delegate = mocker.patch.object(MCPToolManageService, "_reconnect_with_url", return_value=expected)

    # Act
    result = MCPToolManageService.reconnect_with_url(
        server_url="https://mcp.example.com",
        headers={},
        timeout=30,
        sse_read_timeout=300,
    )

    # Assert
    assert result == expected
    mock_delegate.assert_called_once()


def test_private_reconnect_with_url_should_return_authed_true_when_connection_succeeds(mocker: MockerFixture) -> None:
    # Arrange
    mcp_client_instance = MagicMock()
    mcp_client_instance.list_tools.return_value = [_ToolStub("tool-a", None)]
    mock_client_cls = mocker.patch("core.mcp.mcp_client.MCPClient")
    mock_client_cls.return_value.__enter__.return_value = mcp_client_instance

    # Act
    result = MCPToolManageService._reconnect_with_url(
        server_url="https://mcp.example.com",
        headers={},
        timeout=30,
        sse_read_timeout=300,
    )

    # Assert
    assert result.authed is True
    assert json.loads(result.tools)[0]["description"] == ""


def test_private_reconnect_with_url_should_return_authed_false_on_auth_error(mocker: MockerFixture) -> None:
    # Arrange
    mcp_client_instance = MagicMock()
    mcp_client_instance.list_tools.side_effect = MCPAuthError("auth required")
    mock_client_cls = mocker.patch("core.mcp.mcp_client.MCPClient")
    mock_client_cls.return_value.__enter__.return_value = mcp_client_instance

    # Act
    result = MCPToolManageService._reconnect_with_url(
        server_url="https://mcp.example.com",
        headers={},
        timeout=30,
        sse_read_timeout=300,
    )

    # Assert
    assert result.authed is False
    assert result.tools == EMPTY_TOOLS_JSON


def test_private_reconnect_with_url_should_raise_value_error_on_mcp_error(mocker: MockerFixture) -> None:
    # Arrange
    mcp_client_instance = MagicMock()
    mcp_client_instance.list_tools.side_effect = MCPError("network failure")
    mock_client_cls = mocker.patch("core.mcp.mcp_client.MCPClient")
    mock_client_cls.return_value.__enter__.return_value = mcp_client_instance

    # Act + Assert
    with pytest.raises(ValueError, match="Failed to re-connect MCP server: network failure"):
        MCPToolManageService._reconnect_with_url(
            server_url="https://mcp.example.com",
            headers={},
            timeout=30,
            sse_read_timeout=300,
        )


def test_build_tool_provider_response_should_build_api_entity_with_tools(
    service: MCPToolManageService,
    mocker: MockerFixture,
) -> None:
    # Arrange
    db_provider = _provider_stub()
    provider_entity = _provider_entity_stub()
    tools = [_ToolStub("tool-a", "desc")]
    mocker.patch("services.tools.mcp_tools_manage_service.ToolTransformService.mcp_tool_to_user_tool", return_value=[])

    # Act
    result = service._build_tool_provider_response(db_provider, provider_entity, tools)

    # Assert
    assert result.plugin_unique_identifier == "server-1"
    assert result.name == "MCP Tool"


@pytest.mark.parametrize(
    ("orig_message", "expected_error"),
    [
        ("unique_mcp_provider_name", "MCP tool name already exists"),
        ("unique_mcp_provider_server_url", "MCP tool https://mcp.example.com already exists"),
        ("unique_mcp_provider_server_identifier", "MCP tool server-1 already exists"),
    ],
)
def test_handle_integrity_error_should_raise_readable_value_errors(
    orig_message: str,
    expected_error: str,
    service: MCPToolManageService,
) -> None:
    """Test that known integrity errors raise readable value errors."""
    # Arrange
    error = IntegrityError("stmt", {}, Exception(orig_message))

    # Act + Assert
    with pytest.raises(ValueError, match=expected_error):
        service._handle_integrity_error(error, "name", "https://mcp.example.com", "server-1")


def test_handle_integrity_error_should_reraise_unknown_error(service: MCPToolManageService) -> None:
    """Test that unknown integrity errors are re-raised."""
    # Arrange
    error = IntegrityError("stmt", {}, Exception("unknown-constraint"))

    # Act + Assert
    with pytest.raises(IntegrityError) as exc_info:
        service._handle_integrity_error(error, "name", "url", "identifier")

    assert exc_info.value is error


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://mcp.example.com", True),
        ("http://mcp.example.com", True),
        ("", False),
        ("invalid", False),
        ("ftp://mcp.example.com", False),
    ],
)
def test_is_valid_url_should_validate_supported_schemes(
    url: str,
    expected: bool,
    service: MCPToolManageService,
) -> None:
    # Arrange
    # Act
    result = service._is_valid_url(url)

    # Assert
    assert result is expected


def test_update_optional_fields_should_update_only_non_none_values(service: MCPToolManageService) -> None:
    # Arrange
    provider = _provider_stub()
    configuration = MCPConfiguration(timeout=99, sse_read_timeout=300)

    # Act
    service._update_optional_fields(provider, configuration)

    # Assert
    assert provider.timeout == 99
    assert provider.sse_read_timeout == 300


def test_process_headers_should_return_none_when_empty_headers(service: MCPToolManageService) -> None:
    # Arrange
    provider = _provider_stub()

    # Act
    result = service._process_headers({}, provider, "tenant-1")

    # Assert
    assert result is None


def test_process_headers_should_merge_and_encrypt_headers(
    service: MCPToolManageService,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider = _provider_stub()
    mocker.patch.object(service, "_merge_headers_with_masked", return_value={"x-api-key": "plain"})
    mocker.patch.object(service, "_prepare_encrypted_dict", return_value='{"x-api-key":"enc"}')

    # Act
    result = service._process_headers({"x-api-key": "*****"}, provider, "tenant-1")

    # Assert
    assert result == '{"x-api-key":"enc"}'


def test_process_credentials_should_merge_and_encrypt_credentials(
    service: MCPToolManageService,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider = _provider_stub()
    authentication = MCPAuthentication(client_id="masked-id", client_secret="masked-secret")
    mocker.patch.object(service, "_merge_credentials_with_masked", return_value=("plain-id", "plain-secret"))
    mocker.patch.object(service, "_build_and_encrypt_credentials", return_value='{"client_information":{}}')

    # Act
    result = service._process_credentials(authentication, provider, "tenant-1")

    # Assert
    assert result == '{"client_information":{}}'


def test_merge_headers_with_masked_should_preserve_original_values_for_unchanged_masked_inputs(
    service: MCPToolManageService,
) -> None:
    # Arrange
    provider = _provider_stub()
    incoming_headers = {"x-api-key": "ke***ey", "new-header": "new-value", "dropped": "*****"}

    # Act
    result = service._merge_headers_with_masked(incoming_headers, provider)

    # Assert
    assert result["x-api-key"] == "key"
    assert result["new-header"] == "new-value"
    assert result["dropped"] == "*****"


def test_merge_credentials_with_masked_should_preserve_decrypted_values_when_masked_match(
    service: MCPToolManageService,
) -> None:
    # Arrange
    provider = _provider_stub()

    # Act
    client_id, client_secret = service._merge_credentials_with_masked("pl***id", "pl***et", provider)

    # Assert
    assert client_id == "plain-id"
    assert client_secret == "plain-secret"


def test_build_and_encrypt_credentials_should_encrypt_secret_when_client_secret_present(
    service: MCPToolManageService,
    mocker: MockerFixture,
) -> None:
    # Arrange
    mocker.patch.object(
        service,
        "_encrypt_dict_fields",
        return_value={
            "client_id": "id",
            "client_name": "Dify",
            "is_dynamic_registration": False,
            "encrypted_client_secret": "enc-secret",
        },
    )

    # Act
    result = service._build_and_encrypt_credentials("id", "secret", "tenant-1")

    # Assert
    payload = json.loads(result)
    assert payload["client_information"]["encrypted_client_secret"] == "enc-secret"


def test_build_and_encrypt_credentials_should_skip_secret_field_when_client_secret_is_none(
    service: MCPToolManageService,
    mocker: MockerFixture,
) -> None:
    # Arrange
    mocker.patch.object(
        service,
        "_encrypt_dict_fields",
        return_value={"client_id": "id", "client_name": "Dify", "is_dynamic_registration": False},
    )

    # Act
    result = service._build_and_encrypt_credentials("id", None, "tenant-1")

    # Assert
    payload = json.loads(result)
    assert "encrypted_client_secret" not in payload["client_information"]
