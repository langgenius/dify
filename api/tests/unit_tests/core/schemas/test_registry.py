import json
from unittest.mock import patch

from core.schemas.registry import SchemaRegistry


class TestSchemaRegistry:
    def test_initialization(self, tmp_path):
        base_dir = tmp_path / "schemas"
        base_dir.mkdir()
        registry = SchemaRegistry(str(base_dir))
        assert registry.base_dir == base_dir
        assert registry.versions == {}
        assert registry.metadata == {}

    def test_default_registry_singleton(self):
        registry1 = SchemaRegistry.default_registry()
        registry2 = SchemaRegistry.default_registry()
        assert registry1 is registry2
        assert isinstance(registry1, SchemaRegistry)

    def test_load_all_versions_non_existent_dir(self, tmp_path):
        base_dir = tmp_path / "non_existent"
        registry = SchemaRegistry(str(base_dir))
        registry.load_all_versions()
        assert registry.versions == {}

    def test_load_all_versions_filtering(self, tmp_path):
        base_dir = tmp_path / "schemas"
        base_dir.mkdir()
        (base_dir / "not_a_version_dir").mkdir()
        (base_dir / "v1").mkdir()
        (base_dir / "some_file.txt").write_text("content")

        registry = SchemaRegistry(str(base_dir))
        with patch.object(registry, "_load_version_dir") as mock_load:
            registry.load_all_versions()
            mock_load.assert_called_once()
            assert mock_load.call_args[0][0] == "v1"

    def test_load_version_dir_filtering(self, tmp_path):
        version_dir = tmp_path / "v1"
        version_dir.mkdir()
        (version_dir / "schema1.json").write_text("{}")
        (version_dir / "not_a_schema.txt").write_text("content")

        registry = SchemaRegistry(str(tmp_path))
        with patch.object(registry, "_load_schema") as mock_load:
            registry._load_version_dir("v1", version_dir)
            mock_load.assert_called_once()
            assert mock_load.call_args[0][1] == "schema1"

    def test_load_version_dir_non_existent(self, tmp_path):
        version_dir = tmp_path / "non_existent"
        registry = SchemaRegistry(str(tmp_path))
        registry._load_version_dir("v1", version_dir)
        assert "v1" not in registry.versions

    def test_load_schema_success(self, tmp_path):
        schema_path = tmp_path / "test.json"
        schema_content = {"title": "Test Schema", "description": "A test schema"}
        schema_path.write_text(json.dumps(schema_content))

        registry = SchemaRegistry(str(tmp_path))
        registry.versions["v1"] = {}
        registry._load_schema("v1", "test", schema_path)

        assert registry.versions["v1"]["test"] == schema_content
        uri = "https://dify.ai/schemas/v1/test.json"
        assert registry.metadata[uri]["title"] == "Test Schema"
        assert registry.metadata[uri]["version"] == "v1"

    def test_load_schema_invalid_json(self, tmp_path, caplog):
        schema_path = tmp_path / "invalid.json"
        schema_path.write_text("invalid json")

        registry = SchemaRegistry(str(tmp_path))
        registry.versions["v1"] = {}
        registry._load_schema("v1", "invalid", schema_path)

        assert "Failed to load schema v1/invalid" in caplog.text

    def test_load_schema_os_error(self, tmp_path, caplog):
        schema_path = tmp_path / "error.json"
        schema_path.write_text("{}")

        registry = SchemaRegistry(str(tmp_path))
        registry.versions["v1"] = {}

        with patch("builtins.open", side_effect=OSError("Read error")):
            registry._load_schema("v1", "error", schema_path)

        assert "Failed to load schema v1/error" in caplog.text

    def test_get_schema(self):
        registry = SchemaRegistry("/tmp")
        registry.versions = {"v1": {"test": {"type": "object"}}}

        # Valid URI
        assert registry.get_schema("https://dify.ai/schemas/v1/test.json") == {"type": "object"}

        # Invalid URI
        assert registry.get_schema("invalid-uri") is None

        # Missing version
        assert registry.get_schema("https://dify.ai/schemas/v2/test.json") is None

    def test_list_versions(self):
        registry = SchemaRegistry("/tmp")
        registry.versions = {"v2": {}, "v1": {}}
        assert registry.list_versions() == ["v1", "v2"]

    def test_list_schemas(self):
        registry = SchemaRegistry("/tmp")
        registry.versions = {"v1": {"b": {}, "a": {}}}

        assert registry.list_schemas("v1") == ["a", "b"]
        assert registry.list_schemas("v2") == []

    def test_get_all_schemas_for_version(self):
        registry = SchemaRegistry("/tmp")
        registry.versions = {"v1": {"test": {"title": "Test Label"}}}

        results = registry.get_all_schemas_for_version("v1")
        assert len(results) == 1
        assert results[0]["name"] == "test"
        assert results[0]["label"] == "Test Label"
        assert results[0]["schema"] == {"title": "Test Label"}

        # Default label if title missing
        registry.versions["v1"]["no_title"] = {}
        results = registry.get_all_schemas_for_version("v1")
        item = next(r for r in results if r["name"] == "no_title")
        assert item["label"] == "no_title"

        # Empty if version missing
        assert registry.get_all_schemas_for_version("v2") == []
