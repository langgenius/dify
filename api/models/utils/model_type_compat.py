from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy import ColumnElement, Row
from sqlalchemy.orm import Mapped

from graphon.model_runtime.entities.model_entities import ModelType

_PERSISTED_MODEL_TYPE_LABEL = "persisted_model_type"


@dataclass(frozen=True)
class _ModelTypeCompatValues:
    canonical_enum: ModelType
    canonical_value: str
    legacy_value: str

    @property
    def has_distinct_legacy_value(self) -> bool:
        return self.legacy_value != self.canonical_value


@dataclass(frozen=True)
class PersistedModelTypeRecord[T]:
    record: T
    persisted_model_type: str


def _get_model_type_compat_values(model_type: ModelType | str) -> _ModelTypeCompatValues:
    model_type_enum = model_type if isinstance(model_type, ModelType) else ModelType.value_of(model_type)
    return _ModelTypeCompatValues(
        canonical_enum=model_type_enum,
        canonical_value=model_type_enum.value,
        legacy_value=model_type_enum.to_origin_model_type(),
    )


def _canonical_model_type_filter(column: Mapped[ModelType], model_type: ModelType | str):
    values = _get_model_type_compat_values(model_type)
    return column == values.canonical_enum


def _legacy_model_type_filter(column: Mapped[ModelType], model_type: ModelType | str):
    values = _get_model_type_compat_values(model_type)
    return sa.type_coerce(column, sa.String()) == values.legacy_value


def legacy_compatible_model_type_filter(column: Mapped[ModelType], model_type: ModelType | str):
    """
    Match both canonical and legacy persisted model_type values during reads.

    Graphon normalizes legacy values such as ``text-generation`` to
    ``ModelType.LLM``. Query paths therefore receive canonical enums while
    older rows may still store the original string value.
    """
    values = _get_model_type_compat_values(model_type)

    if not values.has_distinct_legacy_value:
        return _canonical_model_type_filter(column, values.canonical_enum)

    return sa.or_(
        _canonical_model_type_filter(column, values.canonical_enum),
        # rely on sa.type_coerce instead of sa.cast to ensure that we can
        # utilize indexes.
        _legacy_model_type_filter(column, values.canonical_enum),
    )


def persisted_model_type_column(column: Mapped[ModelType]):
    return sa.type_coerce(column, sa.String()).label(_PERSISTED_MODEL_TYPE_LABEL)


def fetch_singleton_with_model_type_fallback[T](
    *,
    column: Mapped[ModelType],
    model_type: ModelType | str,
    fetch_by_filter: Callable[[ColumnElement[bool]], T | None],
) -> T | None:
    values = _get_model_type_compat_values(model_type)

    result = fetch_by_filter(_canonical_model_type_filter(column, values.canonical_enum))
    if result is not None or not values.has_distinct_legacy_value:
        return result

    return fetch_by_filter(_legacy_model_type_filter(column, values.canonical_enum))


def _build_persisted_model_type_records[T](
    rows: Iterable[tuple[T, str] | Row[tuple[T, str]]],
) -> list[PersistedModelTypeRecord[T]]:
    return [PersistedModelTypeRecord(record=row[0], persisted_model_type=row[1]) for row in rows]


def prefer_canonical_model_type_records[T, K](
    rows: Iterable[tuple[T, str] | Row[tuple[T, str]]],
    *,
    scope_key: Callable[[T], K],
    model_type_getter: Callable[[T], ModelType],
) -> list[T]:
    records = _build_persisted_model_type_records(rows)
    grouped_records: dict[K, list[PersistedModelTypeRecord[T]]] = defaultdict(list)
    for record in records:
        grouped_records[scope_key(record.record)].append(record)

    preferred_records: list[T] = []
    for scoped_records in grouped_records.values():
        compat_values = _get_model_type_compat_values(model_type_getter(scoped_records[0].record))
        canonical_records = [
            scoped_record.record
            for scoped_record in scoped_records
            if scoped_record.persisted_model_type == compat_values.canonical_value
        ]
        if canonical_records:
            preferred_records.extend(canonical_records)
            continue

        if compat_values.has_distinct_legacy_value:
            legacy_records = [
                scoped_record.record
                for scoped_record in scoped_records
                if scoped_record.persisted_model_type == compat_values.legacy_value
            ]
            if legacy_records:
                preferred_records.extend(legacy_records)
                continue

        preferred_records.extend(scoped_record.record for scoped_record in scoped_records)

    return preferred_records
