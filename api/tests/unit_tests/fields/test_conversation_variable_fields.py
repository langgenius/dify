from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from fields._value_type_serializer import serialize_value_type
from fields.conversation_variable_fields import ConversationVariableResponse
from graphon.variables import StringSegment
from graphon.variables.types import SegmentType


def test_conversation_variable_response_normalizes_string_value_type_alias() -> None:
    response = ConversationVariableResponse.model_validate(
        {
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "name": "foo",
            "value_type": SegmentType.INTEGER.value,
            "created_at": datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC),
        }
    )

    assert response.value_type == "number"
    assert response.created_at == int(datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC).timestamp())


def test_conversation_variable_response_normalizes_callable_exposed_type() -> None:
    response = ConversationVariableResponse.model_validate(
        {
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "name": "foo",
            "value_type": SimpleNamespace(exposed_type=lambda: SegmentType.STRING.exposed_type()),
        }
    )

    assert response.value_type == "string"


def test_serialize_value_type_supports_segments_and_mappings() -> None:
    assert serialize_value_type(StringSegment(value="hello")) == "string"
    assert serialize_value_type({"value_type": SegmentType.INTEGER}) == "number"


def test_serialize_value_type_requires_mapping_value_type() -> None:
    with pytest.raises(ValueError, match="value_type is required but not provided"):
        serialize_value_type({})
