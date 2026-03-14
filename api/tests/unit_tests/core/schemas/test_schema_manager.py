from unittest.mock import MagicMock, patch

from core.schemas.registry import SchemaRegistry
from core.schemas.schema_manager import SchemaManager


def test_init_with_provided_registry():
    mock_registry = MagicMock(spec=SchemaRegistry)
    manager = SchemaManager(registry=mock_registry)
    assert manager.registry == mock_registry


@patch("core.schemas.schema_manager.SchemaRegistry.default_registry")
def test_init_with_default_registry(mock_default_registry):
    mock_registry = MagicMock(spec=SchemaRegistry)
    mock_default_registry.return_value = mock_registry

    manager = SchemaManager()

    mock_default_registry.assert_called_once()
    assert manager.registry == mock_registry


def test_get_all_schema_definitions():
    mock_registry = MagicMock(spec=SchemaRegistry)
    expected_definitions = [{"name": "schema1", "schema": {}}, {"name": "schema2", "schema": {}}]
    mock_registry.get_all_schemas_for_version.return_value = expected_definitions

    manager = SchemaManager(registry=mock_registry)
    result = manager.get_all_schema_definitions(version="v2")

    mock_registry.get_all_schemas_for_version.assert_called_once_with("v2")
    assert result == expected_definitions


def test_get_schema_by_name_success():
    mock_registry = MagicMock(spec=SchemaRegistry)
    mock_schema = {"type": "object"}
    mock_registry.get_schema.return_value = mock_schema

    manager = SchemaManager(registry=mock_registry)
    result = manager.get_schema_by_name("my_schema", version="v1")

    expected_uri = "https://dify.ai/schemas/v1/my_schema.json"
    mock_registry.get_schema.assert_called_once_with(expected_uri)
    assert result == {"name": "my_schema", "schema": mock_schema}


def test_get_schema_by_name_not_found():
    mock_registry = MagicMock(spec=SchemaRegistry)
    mock_registry.get_schema.return_value = None

    manager = SchemaManager(registry=mock_registry)
    result = manager.get_schema_by_name("non_existent", version="v1")

    assert result is None


def test_list_available_schemas():
    mock_registry = MagicMock(spec=SchemaRegistry)
    expected_schemas = ["schema1", "schema2"]
    mock_registry.list_schemas.return_value = expected_schemas

    manager = SchemaManager(registry=mock_registry)
    result = manager.list_available_schemas(version="v1")

    mock_registry.list_schemas.assert_called_once_with("v1")
    assert result == expected_schemas


def test_list_available_versions():
    mock_registry = MagicMock(spec=SchemaRegistry)
    expected_versions = ["v1", "v2"]
    mock_registry.list_versions.return_value = expected_versions

    manager = SchemaManager(registry=mock_registry)
    result = manager.list_available_versions()

    mock_registry.list_versions.assert_called_once()
    assert result == expected_versions
