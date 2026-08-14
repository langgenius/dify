"""Application service for querying Console schema definitions."""

import logging
from collections.abc import Callable, Mapping
from typing import Any, Protocol

logger = logging.getLogger(__name__)


class SchemaDefinitionSource(Protocol):
    def get_all_schema_definitions(self, version: str = "v1") -> list[Mapping[str, Any]]: ...


class SchemaDefinitionService:
    def __init__(self, *, source_factory: Callable[[], SchemaDefinitionSource]) -> None:
        self._source_factory = source_factory

    def list(self) -> tuple[Mapping[str, Any], ...]:
        try:
            source = self._source_factory()
            return tuple(source.get_all_schema_definitions())
        except Exception:
            logger.exception("Failed to get schema definitions from local registry")
            return ()
