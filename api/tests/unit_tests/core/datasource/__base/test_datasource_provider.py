from unittest.mock import MagicMock, patch

import pytest

from core.datasource.__base.datasource_plugin import DatasourcePlugin
from core.datasource.__base.datasource_provider import DatasourcePluginProviderController
from core.datasource.entities.datasource_entities import (
    DatasourceProviderEntityWithPlugin,
    DatasourceProviderType,
)
from core.entities.provider_entities import ProviderConfig
from core.tools.errors import ToolProviderCredentialValidationError


class ConcreteDatasourcePluginProviderController(DatasourcePluginProviderController):
    """
    Concrete implementation of DatasourcePluginProviderController for testing purposes.
    """

    def get_datasource(self, datasource_name: str) -> DatasourcePlugin:
        return MagicMock(spec=DatasourcePlugin)


class TestDatasourcePluginProviderController:
    def test_init(self):
        # Arrange
        mock_entity = MagicMock(spec=DatasourceProviderEntityWithPlugin)
        tenant_id = "test-tenant-id"

        # Act
        controller = ConcreteDatasourcePluginProviderController(entity=mock_entity, tenant_id=tenant_id)

        # Assert
        assert controller.entity == mock_entity
        assert controller.tenant_id == tenant_id

    def test_need_credentials(self):
        # Arrange
        mock_entity = MagicMock(spec=DatasourceProviderEntityWithPlugin)
        tenant_id = "test-tenant-id"
        controller = ConcreteDatasourcePluginProviderController(entity=mock_entity, tenant_id=tenant_id)

        # Case 1: credentials_schema is None
        mock_entity.credentials_schema = None
        assert controller.need_credentials is False

        # Case 2: credentials_schema is empty
        mock_entity.credentials_schema = []
        assert controller.need_credentials is False

        # Case 3: credentials_schema has items
        mock_entity.credentials_schema = [MagicMock()]
        assert controller.need_credentials is True

    @patch("core.datasource.__base.datasource_provider.PluginToolManager")
    def test_validate_credentials(self, mock_manager_class):
        # Arrange
        mock_manager = mock_manager_class.return_value
        mock_entity = MagicMock(spec=DatasourceProviderEntityWithPlugin)
        mock_entity.identity = MagicMock()
        mock_entity.identity.name = "test-provider"
        tenant_id = "test-tenant-id"
        user_id = "test-user-id"
        credentials = {"api_key": "secret"}

        controller = ConcreteDatasourcePluginProviderController(entity=mock_entity, tenant_id=tenant_id)

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
        mock_entity = MagicMock(spec=DatasourceProviderEntityWithPlugin)
        controller = ConcreteDatasourcePluginProviderController(entity=mock_entity, tenant_id="test")

        # Act & Assert
        assert controller.provider_type == DatasourceProviderType.LOCAL_FILE

    def test_validate_credentials_format_empty_schema(self):
        # Arrange
        mock_entity = MagicMock(spec=DatasourceProviderEntityWithPlugin)
        mock_entity.credentials_schema = []
        controller = ConcreteDatasourcePluginProviderController(entity=mock_entity, tenant_id="test")
        credentials = {}

        # Act & Assert (Should not raise anything)
        controller.validate_credentials_format(credentials)

    def test_validate_credentials_format_unknown_credential(self):
        # Arrange
        mock_entity = MagicMock(spec=DatasourceProviderEntityWithPlugin)
        mock_entity.identity = MagicMock()
        mock_entity.identity.name = "test-provider"
        mock_entity.credentials_schema = []
        controller = ConcreteDatasourcePluginProviderController(entity=mock_entity, tenant_id="test")
        credentials = {"unknown": "value"}

        # Act & Assert
        with pytest.raises(
            ToolProviderCredentialValidationError, match="credential unknown not found in provider test-provider"
        ):
            controller.validate_credentials_format(credentials)

    def test_validate_credentials_format_required_missing(self):
        # Arrange
        mock_config = MagicMock(spec=ProviderConfig)
        mock_config.name = "api_key"
        mock_config.required = True

        mock_entity = MagicMock(spec=DatasourceProviderEntityWithPlugin)
        mock_entity.credentials_schema = [mock_config]
        controller = ConcreteDatasourcePluginProviderController(entity=mock_entity, tenant_id="test")

        # Act & Assert
        with pytest.raises(ToolProviderCredentialValidationError, match="credential api_key is required"):
            controller.validate_credentials_format({})

    def test_validate_credentials_format_not_required_null(self):
        # Arrange
        mock_config = MagicMock(spec=ProviderConfig)
        mock_config.name = "optional"
        mock_config.required = False
        mock_config.default = None

        mock_entity = MagicMock(spec=DatasourceProviderEntityWithPlugin)
        mock_entity.credentials_schema = [mock_config]
        controller = ConcreteDatasourcePluginProviderController(entity=mock_entity, tenant_id="test")

        # Act & Assert
        credentials = {"optional": None}
        controller.validate_credentials_format(credentials)
        assert credentials["optional"] is None

    def test_validate_credentials_format_type_mismatch_text(self):
        # Arrange
        mock_config = MagicMock(spec=ProviderConfig)
        mock_config.name = "text_field"
        mock_config.required = True
        mock_config.type = ProviderConfig.Type.TEXT_INPUT

        mock_entity = MagicMock(spec=DatasourceProviderEntityWithPlugin)
        mock_entity.credentials_schema = [mock_config]
        controller = ConcreteDatasourcePluginProviderController(entity=mock_entity, tenant_id="test")

        # Act & Assert
        with pytest.raises(ToolProviderCredentialValidationError, match="credential text_field should be string"):
            controller.validate_credentials_format({"text_field": 123})

    def test_validate_credentials_format_select_validation(self):
        # Arrange
        mock_option = MagicMock()
        mock_option.value = "opt1"

        mock_config = MagicMock(spec=ProviderConfig)
        mock_config.name = "select_field"
        mock_config.required = True
        mock_config.type = ProviderConfig.Type.SELECT
        mock_config.options = [mock_option]

        mock_entity = MagicMock(spec=DatasourceProviderEntityWithPlugin)
        mock_entity.credentials_schema = [mock_config]
        controller = ConcreteDatasourcePluginProviderController(entity=mock_entity, tenant_id="test")

        # Case 1: Value not string
        with pytest.raises(ToolProviderCredentialValidationError, match="credential select_field should be string"):
            controller.validate_credentials_format({"select_field": 123})

        # Case 2: Options not list
        mock_config.options = "invalid"
        with pytest.raises(
            ToolProviderCredentialValidationError, match="credential select_field options should be list"
        ):
            controller.validate_credentials_format({"select_field": "opt1"})

        # Case 3: Value not in options
        mock_config.options = [mock_option]
        with pytest.raises(ToolProviderCredentialValidationError, match="credential select_field should be one of"):
            controller.validate_credentials_format({"select_field": "invalid_opt"})

    def test_get_datasource_base(self):
        # Arrange
        mock_entity = MagicMock(spec=DatasourceProviderEntityWithPlugin)
        controller = ConcreteDatasourcePluginProviderController(entity=mock_entity, tenant_id="test")

        # Act
        # Call the base class method to cover line 53
        result = DatasourcePluginProviderController.get_datasource(controller, "test")

        # Assert
        assert result is None

    def test_validate_credentials_format_hits_pop(self):
        # Arrange
        mock_config = MagicMock(spec=ProviderConfig)
        mock_config.name = "valid_field"
        mock_config.required = True
        mock_config.type = ProviderConfig.Type.TEXT_INPUT

        mock_entity = MagicMock(spec=DatasourceProviderEntityWithPlugin)
        mock_entity.credentials_schema = [mock_config]
        controller = ConcreteDatasourcePluginProviderController(entity=mock_entity, tenant_id="test")

        # Act
        credentials = {"valid_field": "valid_value"}
        controller.validate_credentials_format(credentials)

        # Assert
        # Line 100 should have been hit (pop from credentials_need_to_validate)
        assert "valid_field" in credentials
        assert credentials["valid_field"] == "valid_value"

    def test_validate_credentials_format_hits_continue(self):
        # Arrange
        mock_config = MagicMock(spec=ProviderConfig)
        mock_config.name = "optional_field"
        mock_config.required = False
        mock_config.default = None

        mock_entity = MagicMock(spec=DatasourceProviderEntityWithPlugin)
        mock_entity.credentials_schema = [mock_config]
        controller = ConcreteDatasourcePluginProviderController(entity=mock_entity, tenant_id="test")

        # Act
        credentials = {"optional_field": None}
        controller.validate_credentials_format(credentials)

        # Assert
        # Hits line 81 (continue), should NOT hit line 100 for this field
        assert credentials["optional_field"] is None

    def test_validate_credentials_format_unreachable_none(self):
        # This test attempts to hit line 63 which checks if credentials_schema is None.
        # Since it's initialized as dict(), we have to mock 'dict' in the module.
        mock_entity = MagicMock(spec=DatasourceProviderEntityWithPlugin)
        mock_entity.credentials_schema = []
        controller = ConcreteDatasourcePluginProviderController(entity=mock_entity, tenant_id="test")

        # We need to patch the specific reference in the module
        with patch("core.datasource.__base.datasource_provider.dict", return_value=None):
            controller.validate_credentials_format({})

    def test_validate_credentials_format_default_values(self):
        # Arrange
        mock_config_text = MagicMock(spec=ProviderConfig)
        mock_config_text.name = "text_def"
        mock_config_text.required = False
        mock_config_text.type = ProviderConfig.Type.TEXT_INPUT
        mock_config_text.default = 123  # Int default, should be converted to str

        mock_config_other = MagicMock(spec=ProviderConfig)
        mock_config_other.name = "other_def"
        mock_config_other.required = False
        mock_config_other.type = "OTHER"
        mock_config_other.default = "fallback"

        mock_entity = MagicMock(spec=DatasourceProviderEntityWithPlugin)
        mock_entity.credentials_schema = [mock_config_text, mock_config_other]
        controller = ConcreteDatasourcePluginProviderController(entity=mock_entity, tenant_id="test")

        # Act
        credentials = {}
        controller.validate_credentials_format(credentials)

        # Assert
        assert credentials["text_def"] == "123"
        assert credentials["other_def"] == "fallback"
