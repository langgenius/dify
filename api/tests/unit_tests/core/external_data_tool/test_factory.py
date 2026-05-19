from unittest.mock import MagicMock, patch

from core.extension.extensible import ExtensionModule
from core.external_data_tool.factory import ExternalDataToolFactory


def test_external_data_tool_factory_init():
    with patch("core.external_data_tool.factory.code_based_extension") as mock_code_based_extension:
        mock_extension_class = MagicMock()
        mock_code_based_extension.extension_class.return_value = mock_extension_class

        name = "test_tool"
        tenant_id = "tenant_123"
        app_id = "app_456"
        variable = "var_v"
        config = {"key": "value"}

        factory = ExternalDataToolFactory(name, tenant_id, app_id, variable, config)

        mock_code_based_extension.extension_class.assert_called_once_with(ExtensionModule.EXTERNAL_DATA_TOOL, name)
        mock_extension_class.assert_called_once_with(
            tenant_id=tenant_id, app_id=app_id, variable=variable, config=config
        )


def test_external_data_tool_factory_validate_config():
    with patch("core.external_data_tool.factory.code_based_extension") as mock_code_based_extension:
        mock_extension_class = MagicMock()
        mock_code_based_extension.extension_class.return_value = mock_extension_class

        name = "test_tool"
        tenant_id = "tenant_123"
        config = {"key": "value"}

        ExternalDataToolFactory.validate_config(name, tenant_id, config)

        mock_code_based_extension.extension_class.assert_called_once_with(ExtensionModule.EXTERNAL_DATA_TOOL, name)
        mock_extension_class.validate_config.assert_called_once_with(tenant_id, config)


def test_external_data_tool_factory_query():
    with patch("core.external_data_tool.factory.code_based_extension") as mock_code_based_extension:
        mock_extension_class = MagicMock()
        mock_extension_instance = MagicMock()
        mock_extension_class.return_value = mock_extension_instance
        mock_code_based_extension.extension_class.return_value = mock_extension_class

        mock_extension_instance.query.return_value = "query_result"

        factory = ExternalDataToolFactory("name", "tenant", "app", "var", {})

        inputs = {"input_key": "input_value"}
        query = "search_query"

        result = factory.query(inputs, query)

        assert result == "query_result"
        mock_extension_instance.query.assert_called_once_with(inputs, query)
