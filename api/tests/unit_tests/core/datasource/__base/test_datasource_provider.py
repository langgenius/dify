from unittest.mock import patch

import pytest

from core.datasource.__base.datasource_plugin import DatasourcePlugin
from core.datasource.__base.datasource_provider import DatasourcePluginProviderController
from core.datasource.entities.datasource_entities import (
    DatasourceProviderType,
)
from core.entities.provider_entities import ProviderConfig, ProviderConfigType
from core.tools.entities.common_entities import I18nObject
from core.tools.errors import ToolProviderCredentialValidationError
from tests.unit_tests.core.datasource.factories import provider_entity


class ConcreteDatasourcePluginProviderController(DatasourcePluginProviderController):
    """
    Concrete implementation of DatasourcePluginProviderController for testing purposes.
    """

    def get_datasource(self, datasource_name: str) -> DatasourcePlugin:
        raise AssertionError("Credential validation must not fetch a datasource")


class TestDatasourcePluginProviderController:
    def test_init(self):
        # Arrange
        entity = provider_entity(DatasourceProviderType.LOCAL_FILE)
        tenant_id = "test-tenant-id"

        # Act
        controller = ConcreteDatasourcePluginProviderController(entity=entity, tenant_id=tenant_id)

        # Assert
        assert controller.entity == entity
        assert controller.tenant_id == tenant_id

    def test_need_credentials(self):
        # Arrange
        entity = provider_entity(DatasourceProviderType.LOCAL_FILE)
        tenant_id = "test-tenant-id"
        controller = ConcreteDatasourcePluginProviderController(entity=entity, tenant_id=tenant_id)

        # Case 1: credentials_schema is None
        entity.credentials_schema = None
        assert controller.need_credentials is False

        # Case 2: credentials_schema is empty
        entity.credentials_schema = []
        assert controller.need_credentials is False

        # Case 3: credentials_schema has items
        entity.credentials_schema = [ProviderConfig(name="api_key", type=ProviderConfigType.SECRET_INPUT)]
        assert controller.need_credentials is True

    @patch("core.datasource.__base.datasource_provider.PluginToolManager")
    def test_validate_credentials(self, mock_manager_class):
        # Arrange
        mock_manager = mock_manager_class.return_value
        entity = provider_entity(DatasourceProviderType.LOCAL_FILE)
        tenant_id = "test-tenant-id"
        user_id = "test-user-id"
        credentials = {"api_key": "secret"}

        controller = ConcreteDatasourcePluginProviderController(entity=entity, tenant_id=tenant_id)

        # Act: Successful validation
        mock_manager.validate_datasource_credentials.return_value = True
        controller._validate_credentials(user_id, credentials)

        mock_manager.validate_datasource_credentials.assert_called_once_with(
            tenant_id=tenant_id,
            user_id=user_id,
            provider="test-provider",
            credentials=credentials,
        )

        # Act: Failed validation
        mock_manager.validate_datasource_credentials.return_value = False
        with pytest.raises(ToolProviderCredentialValidationError, match="Invalid credentials"):
            controller._validate_credentials(user_id, credentials)

    def test_provider_type(self):
        # Arrange
        entity = provider_entity(DatasourceProviderType.LOCAL_FILE)
        controller = ConcreteDatasourcePluginProviderController(entity=entity, tenant_id="test")

        # Act & Assert
        assert controller.provider_type == DatasourceProviderType.LOCAL_FILE

    def test_validate_credentials_format_empty_schema(self):
        # Arrange
        entity = provider_entity(DatasourceProviderType.LOCAL_FILE)
        entity.credentials_schema = []
        controller = ConcreteDatasourcePluginProviderController(entity=entity, tenant_id="test")
        credentials = {}

        # Act & Assert (Should not raise anything)
        controller.validate_credentials_format(credentials)

    def test_validate_credentials_format_unknown_credential(self):
        # Arrange
        entity = provider_entity(DatasourceProviderType.LOCAL_FILE)
        entity.credentials_schema = []
        controller = ConcreteDatasourcePluginProviderController(entity=entity, tenant_id="test")
        credentials = {"unknown": "value"}

        # Act & Assert
        with pytest.raises(
            ToolProviderCredentialValidationError, match="credential unknown not found in provider test-provider"
        ):
            controller.validate_credentials_format(credentials)

    def test_validate_credentials_format_required_missing(self):
        # Arrange
        config = ProviderConfig(
            name="api_key",
            required=True,
            type=ProviderConfigType.TEXT_INPUT,
        )

        entity = provider_entity(DatasourceProviderType.LOCAL_FILE)
        entity.credentials_schema = [config]
        controller = ConcreteDatasourcePluginProviderController(entity=entity, tenant_id="test")

        # Act & Assert
        with pytest.raises(ToolProviderCredentialValidationError, match="credential api_key is required"):
            controller.validate_credentials_format({})

    def test_validate_credentials_format_not_required_null(self):
        # Arrange
        config = ProviderConfig(
            name="optional",
            required=False,
            default=None,
            type=ProviderConfigType.TEXT_INPUT,
        )

        entity = provider_entity(DatasourceProviderType.LOCAL_FILE)
        entity.credentials_schema = [config]
        controller = ConcreteDatasourcePluginProviderController(entity=entity, tenant_id="test")

        # Act & Assert
        credentials = {"optional": None}
        controller.validate_credentials_format(credentials)
        assert credentials["optional"] is None

    def test_validate_credentials_format_type_mismatch_text(self):
        # Arrange
        config = ProviderConfig(
            name="text_field",
            required=True,
            type=ProviderConfigType.TEXT_INPUT,
        )

        entity = provider_entity(DatasourceProviderType.LOCAL_FILE)
        entity.credentials_schema = [config]
        controller = ConcreteDatasourcePluginProviderController(entity=entity, tenant_id="test")

        # Act & Assert
        with pytest.raises(ToolProviderCredentialValidationError, match="credential text_field should be string"):
            controller.validate_credentials_format({"text_field": 123})

    def test_validate_credentials_format_select_validation(self):
        # Arrange
        option = ProviderConfig.Option(value="opt1", label=I18nObject(en_US="Option 1"))

        config = ProviderConfig(
            name="select_field",
            required=True,
            type=ProviderConfigType.SELECT,
            options=[option],
        )

        entity = provider_entity(DatasourceProviderType.LOCAL_FILE)
        entity.credentials_schema = [config]
        controller = ConcreteDatasourcePluginProviderController(entity=entity, tenant_id="test")

        # Case 1: Value not string
        with pytest.raises(ToolProviderCredentialValidationError, match="credential select_field should be string"):
            controller.validate_credentials_format({"select_field": 123})

        # Case 2: Options not list
        config.options = "invalid"
        with pytest.raises(
            ToolProviderCredentialValidationError, match="credential select_field options should be list"
        ):
            controller.validate_credentials_format({"select_field": "opt1"})

        # Case 3: Value not in options
        config.options = [option]
        with pytest.raises(ToolProviderCredentialValidationError, match="credential select_field should be one of"):
            controller.validate_credentials_format({"select_field": "invalid_opt"})

    def test_get_datasource_base(self):
        # Arrange
        entity = provider_entity(DatasourceProviderType.LOCAL_FILE)
        controller = ConcreteDatasourcePluginProviderController(entity=entity, tenant_id="test")

        # Act
        result = DatasourcePluginProviderController.get_datasource(controller, "test")

        # Assert
        assert result is None

    def test_validate_credentials_format_hits_pop(self):
        # Arrange
        config = ProviderConfig(
            name="valid_field",
            required=True,
            type=ProviderConfigType.TEXT_INPUT,
        )

        entity = provider_entity(DatasourceProviderType.LOCAL_FILE)
        entity.credentials_schema = [config]
        controller = ConcreteDatasourcePluginProviderController(entity=entity, tenant_id="test")

        # Act
        credentials = {"valid_field": "valid_value"}
        controller.validate_credentials_format(credentials)

        # Assert
        assert "valid_field" in credentials
        assert credentials["valid_field"] == "valid_value"

    def test_validate_credentials_format_hits_continue(self):
        # Arrange
        config = ProviderConfig(
            name="optional_field",
            required=False,
            default=None,
            type=ProviderConfigType.TEXT_INPUT,
        )

        entity = provider_entity(DatasourceProviderType.LOCAL_FILE)
        entity.credentials_schema = [config]
        controller = ConcreteDatasourcePluginProviderController(entity=entity, tenant_id="test")

        # Act
        credentials = {"optional_field": None}
        controller.validate_credentials_format(credentials)

        # Assert
        assert credentials["optional_field"] is None

    def test_validate_credentials_format_default_values(self):
        # Arrange
        config_text = ProviderConfig(
            name="text_def",
            required=False,
            type=ProviderConfigType.TEXT_INPUT,
            default=123,  # Int default, should be converted to str
        )

        config_other = ProviderConfig.model_construct(
            name="other_def",
            required=False,
            type="OTHER",
            default="fallback",
        )

        entity = provider_entity(DatasourceProviderType.LOCAL_FILE)
        entity.credentials_schema = [config_text, config_other]
        controller = ConcreteDatasourcePluginProviderController(entity=entity, tenant_id="test")

        # Act
        credentials = {}
        controller.validate_credentials_format(credentials)

        # Assert
        assert credentials["text_def"] == "123"
        assert credentials["other_def"] == "fallback"
