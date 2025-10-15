from collections.abc import Mapping
from typing import Any

from core.schemas.registry import SchemaRegistry


class SchemaManager:
    """Schema manager provides high-level schema operations"""

    def __init__(self, registry: SchemaRegistry | None = None):
        self.registry = registry or SchemaRegistry.default_registry()

    def get_all_schema_definitions(self, version: str = "v1") -> list[Mapping[str, Any]]:
        """
        Get all JSON Schema definitions for a specific version

        Args:
            version: Schema version, defaults to v1

        Returns:
            Array containing schema definitions, each element contains name and schema fields
        """
        return self.registry.get_all_schemas_for_version(version)

    def get_schema_by_name(self, schema_name: str, version: str = "v1") -> Mapping[str, Any] | None:
        """
        Get a specific schema by name

        Args:
            schema_name: Schema name
            version: Schema version, defaults to v1

        Returns:
            Dictionary containing name and schema, returns None if not found
        """
        uri = f"https://dify.ai/schemas/{version}/{schema_name}.json"
        schema = self.registry.get_schema(uri)

        if schema:
            return {"name": schema_name, "schema": schema}
        return None

    def list_available_schemas(self, version: str = "v1") -> list[str]:
        """
        List all available schema names for a specific version

        Args:
            version: Schema version, defaults to v1

        Returns:
            List of schema names
        """
        return self.registry.list_schemas(version)

    def list_available_versions(self) -> list[str]:
        """
        List all available schema versions

        Returns:
            List of versions
        """
        return self.registry.list_versions()
