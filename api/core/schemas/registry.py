import json
import logging
import threading
from collections.abc import Mapping, MutableMapping
from pathlib import Path
from typing import Any, ClassVar, Optional


class SchemaRegistry:
    """Schema registry manages JSON schemas with version support"""

    logger: ClassVar[logging.Logger] = logging.getLogger(__name__)

    _default_instance: ClassVar[Optional["SchemaRegistry"]] = None
    _lock: ClassVar[threading.Lock] = threading.Lock()

    def __init__(self, base_dir: str):
        self.base_dir = Path(base_dir)
        self.versions: MutableMapping[str, MutableMapping[str, Any]] = {}
        self.metadata: MutableMapping[str, MutableMapping[str, Any]] = {}

    @classmethod
    def default_registry(cls) -> "SchemaRegistry":
        """Returns the default schema registry for builtin schemas (thread-safe singleton)"""
        if cls._default_instance is None:
            with cls._lock:
                # Double-checked locking pattern
                if cls._default_instance is None:
                    current_dir = Path(__file__).parent
                    schema_dir = current_dir / "builtin" / "schemas"

                    registry = cls(str(schema_dir))
                    registry.load_all_versions()

                    cls._default_instance = registry

        return cls._default_instance

    def load_all_versions(self) -> None:
        """Scans the schema directory and loads all versions"""
        if not self.base_dir.exists():
            return

        for entry in self.base_dir.iterdir():
            if not entry.is_dir():
                continue

            version = entry.name
            if not version.startswith("v"):
                continue

            self._load_version_dir(version, entry)

    def _load_version_dir(self, version: str, version_dir: Path) -> None:
        """Loads all schemas in a version directory"""
        if not version_dir.exists():
            return

        if version not in self.versions:
            self.versions[version] = {}

        for entry in version_dir.iterdir():
            if entry.suffix != ".json":
                continue

            schema_name = entry.stem
            self._load_schema(version, schema_name, entry)

    def _load_schema(self, version: str, schema_name: str, schema_path: Path) -> None:
        """Loads a single schema file"""
        try:
            with open(schema_path, encoding="utf-8") as f:
                schema = json.load(f)

            # Store the schema
            self.versions[version][schema_name] = schema

            # Extract and store metadata
            uri = f"https://dify.ai/schemas/{version}/{schema_name}.json"
            metadata = {
                "version": version,
                "title": schema.get("title", ""),
                "description": schema.get("description", ""),
                "deprecated": schema.get("deprecated", False),
            }
            self.metadata[uri] = metadata

        except (OSError, json.JSONDecodeError) as e:
            self.logger.warning("Failed to load schema %s/%s: %s", version, schema_name, e)

    def get_schema(self, uri: str) -> Any | None:
        """Retrieves a schema by URI with version support"""
        version, schema_name = self._parse_uri(uri)
        if not version or not schema_name:
            return None

        version_schemas = self.versions.get(version)
        if not version_schemas:
            return None

        return version_schemas.get(schema_name)

    def _parse_uri(self, uri: str) -> tuple[str, str]:
        """Parses a schema URI to extract version and schema name"""
        from core.schemas.resolver import parse_dify_schema_uri

        return parse_dify_schema_uri(uri)

    def list_versions(self) -> list[str]:
        """Returns all available versions"""
        return sorted(self.versions.keys())

    def list_schemas(self, version: str) -> list[str]:
        """Returns all schemas in a specific version"""
        version_schemas = self.versions.get(version)
        if not version_schemas:
            return []

        return sorted(version_schemas.keys())

    def get_all_schemas_for_version(self, version: str = "v1") -> list[Mapping[str, Any]]:
        """Returns all schemas for a version in the API format"""
        version_schemas = self.versions.get(version, {})

        result: list[Mapping[str, Any]] = []
        for schema_name, schema in version_schemas.items():
            result.append({"name": schema_name, "label": schema.get("title", schema_name), "schema": schema})

        return result
