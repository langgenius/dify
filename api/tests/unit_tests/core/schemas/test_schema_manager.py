from pathlib import Path
from unittest.mock import patch

from core.schemas.registry import SchemaRegistry
from core.schemas.schema_manager import SchemaManager


def test_init_with_provided_registry(tmp_path: Path):
    registry = SchemaRegistry(str(tmp_path))
    manager = SchemaManager(registry=registry)
    assert manager.registry == registry


@patch("core.schemas.schema_manager.SchemaRegistry.default_registry")
def test_init_with_default_registry(mock_default_registry, tmp_path: Path):
    registry = SchemaRegistry(str(tmp_path))
    mock_default_registry.return_value = registry

    manager = SchemaManager()

    mock_default_registry.assert_called_once()
    assert manager.registry == registry


def test_get_all_schema_definitions(tmp_path: Path):
    registry = SchemaRegistry(str(tmp_path))
    expected_definitions = [
        {"name": "schema1", "label": "schema1", "schema": {}},
        {"name": "schema2", "label": "schema2", "schema": {}},
    ]
    registry.versions = {"v1": {"other": {}}, "v2": {"schema1": {}, "schema2": {}}}

    manager = SchemaManager(registry=registry)
    result = manager.get_all_schema_definitions(version="v2")

    assert result == expected_definitions


def test_get_schema_by_name_success(tmp_path: Path):
    registry = SchemaRegistry(str(tmp_path))
    mock_schema = {"type": "object"}
    registry.versions = {"v1": {"my_schema": mock_schema}, "v2": {"my_schema": {"type": "string"}}}

    manager = SchemaManager(registry=registry)
    result = manager.get_schema_by_name("my_schema", version="v1")

    assert result == {"name": "my_schema", "schema": mock_schema}


def test_get_schema_by_name_not_found(tmp_path: Path):
    registry = SchemaRegistry(str(tmp_path))

    manager = SchemaManager(registry=registry)
    result = manager.get_schema_by_name("non_existent", version="v1")

    assert result is None


def test_list_available_schemas(tmp_path: Path):
    registry = SchemaRegistry(str(tmp_path))
    expected_schemas = ["schema1", "schema2"]
    registry.versions = {"v1": {"schema2": {}, "schema1": {}}, "v2": {"other": {}}}

    manager = SchemaManager(registry=registry)
    result = manager.list_available_schemas(version="v1")

    assert result == expected_schemas


def test_list_available_versions(tmp_path: Path):
    registry = SchemaRegistry(str(tmp_path))
    expected_versions = ["v1", "v2"]
    registry.versions = {"v2": {}, "v1": {}}

    manager = SchemaManager(registry=registry)
    result = manager.list_available_versions()

    assert result == expected_versions
