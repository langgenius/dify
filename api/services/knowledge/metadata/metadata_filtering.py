from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from core.rag.entities.metadata_entities import ConditionValue
from graphon.variables.segments import Segment
from graphon.variables.template_resolution import convert_template


class VariablePoolReader(Protocol):
    def get(self, selector: Sequence[str], /) -> Segment | None: ...


def resolve_metadata_filter_value(value: ConditionValue, variable_pool: VariablePoolReader) -> ConditionValue:
    match value:
        case str():
            segment_group = convert_template(variable_pool, value)
            if len(segment_group.value) == 1:
                return _normalize_metadata_filter_scalar(segment_group.value[0].to_object())
            return segment_group.text
        case _ if isinstance(value, Sequence) and all(isinstance(item, str) for item in value):
            resolved_values: list[str] = []
            for item in value:
                segment_group = convert_template(variable_pool, item)
                if len(segment_group.value) == 1:
                    resolved_values.append(_normalize_metadata_filter_sequence_item(segment_group.value[0].to_object()))
                else:
                    resolved_values.append(segment_group.text)
            return resolved_values
        case _:
            return value


def _normalize_metadata_filter_scalar(value: object) -> str | int | float | None:
    if value is None or isinstance(value, (str, float)):
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    return str(value)


def _normalize_metadata_filter_sequence_item(value: object) -> str:
    return value if isinstance(value, str) else str(value)
