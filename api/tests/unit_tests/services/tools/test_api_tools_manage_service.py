from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture

from core.tools.entities.tool_entities import ApiProviderSchemaType
from services.tools.api_tools_manage_service import ApiToolManageService


@pytest.fixture
def mock_db(mocker: MockerFixture) -> MagicMock:
    # Arrange
    mocked_db = mocker.patch("services.tools.api_tools_manage_service.db")
    mocked_db.session = MagicMock()
    return mocked_db


def _tool_bundle(operation_id: str = "tool-1") -> SimpleNamespace:
    return SimpleNamespace(operation_id=operation_id)


def test_parser_api_schema_should_return_schema_payload_when_schema_is_valid(mocker: MockerFixture) -> None:
    # Arrange
    mocker.patch(
        "services.tools.api_tools_manage_service.ApiBasedToolSchemaParser.auto_parse_to_tool_bundle",
        return_value=([_tool_bundle()], ApiProviderSchemaType.OPENAPI.value),
    )

    # Act
    result = ApiToolManageService.parser_api_schema("valid-schema")

    # Assert
    assert result["schema_type"] == ApiProviderSchemaType.OPENAPI.value
    assert len(result["credentials_schema"]) == 3
    assert "warning" in result


def test_parser_api_schema_should_raise_value_error_when_parser_raises(mocker: MockerFixture) -> None:
    # Arrange
    mocker.patch(
        "services.tools.api_tools_manage_service.ApiBasedToolSchemaParser.auto_parse_to_tool_bundle",
        side_effect=RuntimeError("bad schema"),
    )

    # Act + Assert
    with pytest.raises(ValueError, match="invalid schema: invalid schema: bad schema"):
        ApiToolManageService.parser_api_schema("invalid")


def test_convert_schema_to_tool_bundles_should_return_tool_bundles_when_valid(mocker: MockerFixture) -> None:
    # Arrange
    expected = ([_tool_bundle("a"), _tool_bundle("b")], ApiProviderSchemaType.SWAGGER)
    mocker.patch(
        "services.tools.api_tools_manage_service.ApiBasedToolSchemaParser.auto_parse_to_tool_bundle",
        return_value=expected,
    )
    extra_info: dict[str, str] = {}

    # Act
    result = ApiToolManageService.convert_schema_to_tool_bundles("schema", extra_info=extra_info)

    # Assert
    assert result == expected


def test_convert_schema_to_tool_bundles_should_raise_value_error_when_parser_fails(mocker: MockerFixture) -> None:
    # Arrange
    mocker.patch(
        "services.tools.api_tools_manage_service.ApiBasedToolSchemaParser.auto_parse_to_tool_bundle",
        side_effect=ValueError("parse failed"),
    )

    # Act + Assert
    with pytest.raises(ValueError, match="invalid schema: parse failed"):
        ApiToolManageService.convert_schema_to_tool_bundles("schema")


def test_create_api_tool_provider_should_raise_error_when_provider_already_exists(
    mock_db: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    mock_db.session.query.return_value.where.return_value.first.return_value = object()

    # Act + Assert
    with pytest.raises(ValueError, match="provider provider-a already exists"):
        ApiToolManageService.create_api_tool_provider(
            user_id="user-1",
            tenant_id="tenant-1",
            provider_name=" provider-a ",
            icon={"emoji": "X"},
            credentials={"auth_type": "none"},
            schema_type=ApiProviderSchemaType.OPENAPI,
            schema="schema",
            privacy_policy="privacy",
            custom_disclaimer="custom",
            labels=[],
        )


def test_create_api_tool_provider_should_raise_error_when_tool_count_exceeds_limit(
    mock_db: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    mock_db.session.query.return_value.where.return_value.first.return_value = None
    many_tools = [_tool_bundle(str(i)) for i in range(101)]
    mocker.patch.object(
        ApiToolManageService,
        "convert_schema_to_tool_bundles",
        return_value=(many_tools, ApiProviderSchemaType.OPENAPI),
    )

    # Act + Assert
    with pytest.raises(ValueError, match="the number of apis should be less than 100"):
        ApiToolManageService.create_api_tool_provider(
            user_id="user-1",
            tenant_id="tenant-1",
            provider_name="provider-a",
            icon={"emoji": "X"},
            credentials={"auth_type": "none"},
            schema_type=ApiProviderSchemaType.OPENAPI,
            schema="schema",
            privacy_policy="privacy",
            custom_disclaimer="custom",
            labels=[],
        )


def test_create_api_tool_provider_should_raise_error_when_auth_type_is_missing(
    mock_db: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    mock_db.session.query.return_value.where.return_value.first.return_value = None
    mocker.patch.object(
        ApiToolManageService,
        "convert_schema_to_tool_bundles",
        return_value=([_tool_bundle()], ApiProviderSchemaType.OPENAPI),
    )

    # Act + Assert
    with pytest.raises(ValueError, match="auth_type is required"):
        ApiToolManageService.create_api_tool_provider(
            user_id="user-1",
            tenant_id="tenant-1",
            provider_name="provider-a",
            icon={"emoji": "X"},
            credentials={},
            schema_type=ApiProviderSchemaType.OPENAPI,
            schema="schema",
            privacy_policy="privacy",
            custom_disclaimer="custom",
            labels=[],
        )


def test_create_api_tool_provider_should_create_provider_when_input_is_valid(
    mock_db: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    mock_db.session.query.return_value.where.return_value.first.return_value = None
    mocker.patch.object(
        ApiToolManageService,
        "convert_schema_to_tool_bundles",
        return_value=([_tool_bundle()], ApiProviderSchemaType.OPENAPI),
    )
    mock_controller = MagicMock()
    mocker.patch(
        "services.tools.api_tools_manage_service.ApiToolProviderController.from_db",
        return_value=mock_controller,
    )
    mock_encrypter = MagicMock()
    mock_encrypter.encrypt.return_value = {"auth_type": "none"}
    mocker.patch(
        "services.tools.api_tools_manage_service.create_tool_provider_encrypter",
        return_value=(mock_encrypter, MagicMock()),
    )
    mocker.patch("services.tools.api_tools_manage_service.ToolLabelManager.update_tool_labels")

    # Act
    result = ApiToolManageService.create_api_tool_provider(
        user_id="user-1",
        tenant_id="tenant-1",
        provider_name="provider-a",
        icon={"emoji": "X"},
        credentials={"auth_type": "none"},
        schema_type=ApiProviderSchemaType.OPENAPI,
        schema="schema",
        privacy_policy="privacy",
        custom_disclaimer="custom",
        labels=["news"],
    )

    # Assert
    assert result == {"result": "success"}
    mock_controller.load_bundled_tools.assert_called_once()
    mock_db.session.add.assert_called_once()
    mock_db.session.commit.assert_called_once()


def test_get_api_tool_provider_remote_schema_should_return_schema_when_response_is_valid(
    mocker: MockerFixture,
) -> None:
    # Arrange
    mocker.patch(
        "services.tools.api_tools_manage_service.get",
        return_value=SimpleNamespace(status_code=200, text="schema-content"),
    )
    mocker.patch.object(ApiToolManageService, "parser_api_schema", return_value={"ok": True})

    # Act
    result = ApiToolManageService.get_api_tool_provider_remote_schema("user-1", "tenant-1", "https://schema")

    # Assert
    assert result == {"schema": "schema-content"}


@pytest.mark.parametrize("status_code", [400, 404, 500])
def test_get_api_tool_provider_remote_schema_should_raise_error_when_remote_fetch_is_invalid(
    status_code: int,
    mocker: MockerFixture,
) -> None:
    # Arrange
    mocker.patch(
        "services.tools.api_tools_manage_service.get",
        return_value=SimpleNamespace(status_code=status_code, text="schema-content"),
    )
    mock_logger = mocker.patch("services.tools.api_tools_manage_service.logger")

    # Act + Assert
    with pytest.raises(ValueError, match="invalid schema, please check the url you provided"):
        ApiToolManageService.get_api_tool_provider_remote_schema("user-1", "tenant-1", "https://schema")
    mock_logger.exception.assert_called_once()


def test_list_api_tool_provider_tools_should_raise_error_when_provider_not_found(
    mock_db: MagicMock,
) -> None:
    # Arrange
    mock_db.session.query.return_value.where.return_value.first.return_value = None

    # Act + Assert
    with pytest.raises(ValueError, match="you have not added provider provider-a"):
        ApiToolManageService.list_api_tool_provider_tools("user-1", "tenant-1", "provider-a")


def test_list_api_tool_provider_tools_should_return_converted_tools_when_provider_exists(
    mock_db: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider = SimpleNamespace(tools=[_tool_bundle("tool-a"), _tool_bundle("tool-b")])
    mock_db.session.query.return_value.where.return_value.first.return_value = provider
    controller = MagicMock()
    mocker.patch(
        "services.tools.api_tools_manage_service.ToolTransformService.api_provider_to_controller",
        return_value=controller,
    )
    mocker.patch("services.tools.api_tools_manage_service.ToolLabelManager.get_tool_labels", return_value=["search"])
    mock_convert = mocker.patch(
        "services.tools.api_tools_manage_service.ToolTransformService.convert_tool_entity_to_api_entity",
        side_effect=[{"name": "tool-a"}, {"name": "tool-b"}],
    )

    # Act
    result = ApiToolManageService.list_api_tool_provider_tools("user-1", "tenant-1", "provider-a")

    # Assert
    assert result == [{"name": "tool-a"}, {"name": "tool-b"}]
    assert mock_convert.call_count == 2


def test_update_api_tool_provider_should_raise_error_when_original_provider_not_found(
    mock_db: MagicMock,
) -> None:
    # Arrange
    mock_db.session.query.return_value.where.return_value.first.return_value = None

    # Act + Assert
    with pytest.raises(ValueError, match="api provider provider-a does not exists"):
        ApiToolManageService.update_api_tool_provider(
            user_id="user-1",
            tenant_id="tenant-1",
            provider_name="provider-a",
            original_provider="provider-a",
            icon={},
            credentials={"auth_type": "none"},
            _schema_type=ApiProviderSchemaType.OPENAPI,
            schema="schema",
            privacy_policy=None,
            custom_disclaimer="custom",
            labels=[],
        )


def test_update_api_tool_provider_should_raise_error_when_auth_type_missing(
    mock_db: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider = SimpleNamespace(credentials={}, name="old")
    mock_db.session.query.return_value.where.return_value.first.return_value = provider
    mocker.patch.object(
        ApiToolManageService,
        "convert_schema_to_tool_bundles",
        return_value=([_tool_bundle()], ApiProviderSchemaType.OPENAPI),
    )

    # Act + Assert
    with pytest.raises(ValueError, match="auth_type is required"):
        ApiToolManageService.update_api_tool_provider(
            user_id="user-1",
            tenant_id="tenant-1",
            provider_name="provider-a",
            original_provider="provider-a",
            icon={},
            credentials={},
            _schema_type=ApiProviderSchemaType.OPENAPI,
            schema="schema",
            privacy_policy=None,
            custom_disclaimer="custom",
            labels=[],
        )


def test_update_api_tool_provider_should_update_provider_and_preserve_masked_credentials(
    mock_db: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider = SimpleNamespace(
        credentials={"auth_type": "none", "api_key_value": "encrypted-old"},
        name="old",
        icon="",
        schema="",
        description="",
        schema_type_str="",
        tools_str="",
        privacy_policy="",
        custom_disclaimer="",
        credentials_str="",
    )
    mock_db.session.query.return_value.where.return_value.first.return_value = provider
    mocker.patch.object(
        ApiToolManageService,
        "convert_schema_to_tool_bundles",
        return_value=([_tool_bundle()], ApiProviderSchemaType.OPENAPI),
    )
    controller = MagicMock()
    mocker.patch(
        "services.tools.api_tools_manage_service.ApiToolProviderController.from_db",
        return_value=controller,
    )
    cache = MagicMock()
    encrypter = MagicMock()
    encrypter.decrypt.return_value = {"auth_type": "none", "api_key_value": "plain-old"}
    encrypter.mask_plugin_credentials.return_value = {"api_key_value": "***"}
    encrypter.encrypt.return_value = {"auth_type": "none", "api_key_value": "encrypted-new"}
    mocker.patch(
        "services.tools.api_tools_manage_service.create_tool_provider_encrypter",
        return_value=(encrypter, cache),
    )
    mocker.patch("services.tools.api_tools_manage_service.ToolLabelManager.update_tool_labels")

    # Act
    result = ApiToolManageService.update_api_tool_provider(
        user_id="user-1",
        tenant_id="tenant-1",
        provider_name="provider-new",
        original_provider="provider-old",
        icon={"emoji": "E"},
        credentials={"auth_type": "none", "api_key_value": "***"},
        _schema_type=ApiProviderSchemaType.OPENAPI,
        schema="schema",
        privacy_policy="privacy",
        custom_disclaimer="custom",
        labels=["news"],
    )

    # Assert
    assert result == {"result": "success"}
    assert provider.name == "provider-new"
    assert provider.privacy_policy == "privacy"
    assert provider.credentials_str != ""
    cache.delete.assert_called_once()
    mock_db.session.commit.assert_called_once()


def test_delete_api_tool_provider_should_raise_error_when_provider_missing(mock_db: MagicMock) -> None:
    # Arrange
    mock_db.session.query.return_value.where.return_value.first.return_value = None

    # Act + Assert
    with pytest.raises(ValueError, match="you have not added provider provider-a"):
        ApiToolManageService.delete_api_tool_provider("user-1", "tenant-1", "provider-a")


def test_delete_api_tool_provider_should_delete_provider_when_exists(mock_db: MagicMock) -> None:
    # Arrange
    provider = object()
    mock_db.session.query.return_value.where.return_value.first.return_value = provider

    # Act
    result = ApiToolManageService.delete_api_tool_provider("user-1", "tenant-1", "provider-a")

    # Assert
    assert result == {"result": "success"}
    mock_db.session.delete.assert_called_once_with(provider)
    mock_db.session.commit.assert_called_once()


def test_get_api_tool_provider_should_delegate_to_tool_manager(mocker: MockerFixture) -> None:
    # Arrange
    expected = {"provider": "value"}
    mock_get = mocker.patch(
        "services.tools.api_tools_manage_service.ToolManager.user_get_api_provider",
        return_value=expected,
    )

    # Act
    result = ApiToolManageService.get_api_tool_provider("user-1", "tenant-1", "provider-a")

    # Assert
    assert result == expected
    mock_get.assert_called_once_with(provider="provider-a", tenant_id="tenant-1")


def test_test_api_tool_preview_should_raise_error_for_invalid_schema_type() -> None:
    # Arrange
    schema_type = "bad-schema-type"

    # Act + Assert
    with pytest.raises(ValueError, match="invalid schema type"):
        ApiToolManageService.test_api_tool_preview(
            tenant_id="tenant-1",
            provider_name="provider-a",
            tool_name="tool-a",
            credentials={"auth_type": "none"},
            parameters={},
            schema_type=schema_type,  # type: ignore[arg-type]
            schema="schema",
        )


def test_test_api_tool_preview_should_raise_error_when_schema_parser_fails(mocker: MockerFixture) -> None:
    # Arrange
    mocker.patch(
        "services.tools.api_tools_manage_service.ApiBasedToolSchemaParser.auto_parse_to_tool_bundle",
        side_effect=RuntimeError("invalid"),
    )

    # Act + Assert
    with pytest.raises(ValueError, match="invalid schema"):
        ApiToolManageService.test_api_tool_preview(
            tenant_id="tenant-1",
            provider_name="provider-a",
            tool_name="tool-a",
            credentials={"auth_type": "none"},
            parameters={},
            schema_type=ApiProviderSchemaType.OPENAPI,
            schema="schema",
        )


def test_test_api_tool_preview_should_raise_error_when_tool_name_is_invalid(
    mock_db: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    mocker.patch(
        "services.tools.api_tools_manage_service.ApiBasedToolSchemaParser.auto_parse_to_tool_bundle",
        return_value=([_tool_bundle("tool-a")], ApiProviderSchemaType.OPENAPI),
    )
    mock_db.session.query.return_value.where.return_value.first.return_value = SimpleNamespace(id="provider-id")

    # Act + Assert
    with pytest.raises(ValueError, match="invalid tool name tool-b"):
        ApiToolManageService.test_api_tool_preview(
            tenant_id="tenant-1",
            provider_name="provider-a",
            tool_name="tool-b",
            credentials={"auth_type": "none"},
            parameters={},
            schema_type=ApiProviderSchemaType.OPENAPI,
            schema="schema",
        )


def test_test_api_tool_preview_should_raise_error_when_auth_type_missing(
    mock_db: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    mocker.patch(
        "services.tools.api_tools_manage_service.ApiBasedToolSchemaParser.auto_parse_to_tool_bundle",
        return_value=([_tool_bundle("tool-a")], ApiProviderSchemaType.OPENAPI),
    )
    mock_db.session.query.return_value.where.return_value.first.return_value = SimpleNamespace(id="provider-id")

    # Act + Assert
    with pytest.raises(ValueError, match="auth_type is required"):
        ApiToolManageService.test_api_tool_preview(
            tenant_id="tenant-1",
            provider_name="provider-a",
            tool_name="tool-a",
            credentials={},
            parameters={},
            schema_type=ApiProviderSchemaType.OPENAPI,
            schema="schema",
        )


def test_test_api_tool_preview_should_return_error_payload_when_tool_validation_raises(
    mock_db: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    db_provider = SimpleNamespace(id="provider-id", credentials={"auth_type": "none"})
    mock_db.session.query.return_value.where.return_value.first.return_value = db_provider
    mocker.patch(
        "services.tools.api_tools_manage_service.ApiBasedToolSchemaParser.auto_parse_to_tool_bundle",
        return_value=([_tool_bundle("tool-a")], ApiProviderSchemaType.OPENAPI),
    )
    provider_controller = MagicMock()
    tool_obj = MagicMock()
    tool_obj.fork_tool_runtime.return_value = tool_obj
    tool_obj.validate_credentials.side_effect = ValueError("validation failed")
    provider_controller.get_tool.return_value = tool_obj
    mocker.patch(
        "services.tools.api_tools_manage_service.ApiToolProviderController.from_db",
        return_value=provider_controller,
    )
    mock_encrypter = MagicMock()
    mock_encrypter.decrypt.return_value = {"auth_type": "none"}
    mock_encrypter.mask_plugin_credentials.return_value = {}
    mocker.patch(
        "services.tools.api_tools_manage_service.create_tool_provider_encrypter",
        return_value=(mock_encrypter, MagicMock()),
    )

    # Act
    result = ApiToolManageService.test_api_tool_preview(
        tenant_id="tenant-1",
        provider_name="provider-a",
        tool_name="tool-a",
        credentials={"auth_type": "none"},
        parameters={},
        schema_type=ApiProviderSchemaType.OPENAPI,
        schema="schema",
    )

    # Assert
    assert result == {"error": "validation failed"}


def test_test_api_tool_preview_should_return_result_payload_when_validation_succeeds(
    mock_db: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    db_provider = SimpleNamespace(id="provider-id", credentials={"auth_type": "none"})
    mock_db.session.query.return_value.where.return_value.first.return_value = db_provider
    mocker.patch(
        "services.tools.api_tools_manage_service.ApiBasedToolSchemaParser.auto_parse_to_tool_bundle",
        return_value=([_tool_bundle("tool-a")], ApiProviderSchemaType.OPENAPI),
    )
    provider_controller = MagicMock()
    tool_obj = MagicMock()
    tool_obj.fork_tool_runtime.return_value = tool_obj
    tool_obj.validate_credentials.return_value = {"ok": True}
    provider_controller.get_tool.return_value = tool_obj
    mocker.patch(
        "services.tools.api_tools_manage_service.ApiToolProviderController.from_db",
        return_value=provider_controller,
    )
    mock_encrypter = MagicMock()
    mock_encrypter.decrypt.return_value = {"auth_type": "none"}
    mock_encrypter.mask_plugin_credentials.return_value = {}
    mocker.patch(
        "services.tools.api_tools_manage_service.create_tool_provider_encrypter",
        return_value=(mock_encrypter, MagicMock()),
    )

    # Act
    result = ApiToolManageService.test_api_tool_preview(
        tenant_id="tenant-1",
        provider_name="provider-a",
        tool_name="tool-a",
        credentials={"auth_type": "none"},
        parameters={"x": "1"},
        schema_type=ApiProviderSchemaType.OPENAPI,
        schema="schema",
    )

    # Assert
    assert result == {"result": {"ok": True}}


def test_list_api_tools_should_return_all_user_providers_with_converted_tools(
    mock_db: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider_one = SimpleNamespace(name="p1")
    provider_two = SimpleNamespace(name="p2")
    mock_db.session.scalars.return_value.all.return_value = [provider_one, provider_two]

    controller_one = MagicMock()
    controller_one.get_tools.return_value = ["tool-a"]
    controller_two = MagicMock()
    controller_two.get_tools.return_value = ["tool-b", "tool-c"]

    user_provider_one = SimpleNamespace(labels=[], tools=[])
    user_provider_two = SimpleNamespace(labels=[], tools=[])

    mocker.patch(
        "services.tools.api_tools_manage_service.ToolTransformService.api_provider_to_controller",
        side_effect=[controller_one, controller_two],
    )
    mocker.patch("services.tools.api_tools_manage_service.ToolLabelManager.get_tool_labels", return_value=["news"])
    mocker.patch(
        "services.tools.api_tools_manage_service.ToolTransformService.api_provider_to_user_provider",
        side_effect=[user_provider_one, user_provider_two],
    )
    mocker.patch("services.tools.api_tools_manage_service.ToolTransformService.repack_provider")
    mock_convert = mocker.patch(
        "services.tools.api_tools_manage_service.ToolTransformService.convert_tool_entity_to_api_entity",
        side_effect=[{"name": "tool-a"}, {"name": "tool-b"}, {"name": "tool-c"}],
    )

    # Act
    result = ApiToolManageService.list_api_tools("tenant-1")

    # Assert
    assert len(result) == 2
    assert user_provider_one.tools == [{"name": "tool-a"}]
    assert user_provider_two.tools == [{"name": "tool-b"}, {"name": "tool-c"}]
    assert mock_convert.call_count == 3
