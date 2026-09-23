from collections.abc import Mapping
from unittest.mock import Mock, create_autospec

import pytest

from services.schema_definition_service import (
    SchemaDefinitionService,
    SchemaDefinitionSource,
)


@pytest.fixture
def source() -> Mock:
    return create_autospec(SchemaDefinitionSource, instance=True, spec_set=True)


@pytest.fixture
def source_factory(source: Mock) -> Mock:
    return Mock(return_value=source)


def test_list_returns_schema_definitions(source: Mock, source_factory: Mock) -> None:
    definitions: list[Mapping[str, object]] = [
        {
            "name": "conversation-variable",
            "label": "Conversation variable",
            "schema": {"type": "object"},
        }
    ]
    source.get_all_schema_definitions.return_value = definitions
    service = SchemaDefinitionService(source_factory=source_factory)

    assert service.list() == tuple(definitions)
    source_factory.assert_called_once_with()
    source.get_all_schema_definitions.assert_called_once_with()


def test_list_returns_empty_tuple_when_source_query_fails(
    source: Mock,
    source_factory: Mock,
    caplog: pytest.LogCaptureFixture,
) -> None:
    source.get_all_schema_definitions.side_effect = RuntimeError("boom")
    service = SchemaDefinitionService(source_factory=source_factory)

    assert service.list() == ()
    assert "Failed to get schema definitions from local registry" in caplog.text
    assert "boom" in caplog.text


def test_list_returns_empty_tuple_when_source_construction_fails(caplog: pytest.LogCaptureFixture) -> None:
    source_factory = Mock(side_effect=RuntimeError("construction failed"))
    service = SchemaDefinitionService(source_factory=source_factory)

    assert service.list() == ()
    assert "Failed to get schema definitions from local registry" in caplog.text
    assert "construction failed" in caplog.text
