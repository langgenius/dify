"""Shared SQL predicates for persisted document metadata."""

from collections.abc import Sequence
from decimal import Decimal
from typing import Protocol

from sqlalchemy import Numeric, and_, case, cast, func, literal, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.sql import ColumnElement

from models.dataset import Dataset, Document


class MetadataFilterCondition(Protocol):
    @property
    def name(self) -> str: ...

    @property
    def comparison_operator(self) -> str: ...

    @property
    def value(self) -> object: ...


def process_metadata_filter_func(
    sequence: int,
    condition: str,
    metadata_name: str,
    value: object,
    filters: list[ColumnElement[bool]],
    *,
    dialect_name: str,
) -> list[ColumnElement[bool]]:
    """Append a predicate using the active database's JSON semantics.

    The query owner supplies ``dialect_name``. Unknown dialects fail closed
    instead of applying unsafe JSON coercions.
    """
    if value is None and condition not in ("empty", "not empty"):
        return filters

    json_field = Document.doc_metadata[metadata_name].as_string()

    json_value = Document.doc_metadata[metadata_name]
    match dialect_name:
        case "postgresql":
            is_json_number = func.jsonb_typeof(json_value) == "number"
            is_json_string = func.jsonb_typeof(json_value) == "string"
            numeric_value = cast(json_value.as_string(), Numeric())
        case "mysql":
            is_json_number = func.json_type(json_value).in_(("INTEGER", "DOUBLE"))
            is_json_string = func.json_type(json_value) == "STRING"
            numeric_value = json_value.as_float()
        case "sqlite":
            is_json_number = func.json_type(json_value).in_(("integer", "real"))
            is_json_string = func.json_type(json_value) == "text"
            numeric_value = json_value.as_float()
        case _:
            is_json_number = literal(False)
            is_json_string = literal(False)
            numeric_value = literal(None, type_=Numeric())
    numeric_field = case((is_json_number, numeric_value), else_=None)
    numeric_comparison_value = (
        cast(literal(Decimal(str(value))), Numeric())
        if dialect_name == "postgresql" and isinstance(value, (int, float)) and not isinstance(value, bool)
        else value
    )

    from libs.helper import escape_like_pattern

    match condition:
        case "contains":
            escaped_value = escape_like_pattern(str(value))
            filters.append(and_(is_json_string, json_field.like(f"%{escaped_value}%", escape="\\")))

        case "not contains":
            escaped_value = escape_like_pattern(str(value))
            filters.append(and_(is_json_string, json_field.notlike(f"%{escaped_value}%", escape="\\")))

        case "start with":
            escaped_value = escape_like_pattern(str(value))
            filters.append(and_(is_json_string, json_field.like(f"{escaped_value}%", escape="\\")))

        case "end with":
            escaped_value = escape_like_pattern(str(value))
            filters.append(and_(is_json_string, json_field.like(f"%{escaped_value}", escape="\\")))

        case "is" | "=":
            match value:
                case str():
                    filters.append(and_(is_json_string, json_field == value))
                case int() | float():
                    filters.append(numeric_field == numeric_comparison_value)

        case "is not" | "≠":
            match value:
                case str():
                    filters.append(and_(is_json_string, json_field != value))
                case int() | float():
                    filters.append(numeric_field != numeric_comparison_value)

        case "empty":
            filters.append(json_field.is_(None))

        case "not empty":
            filters.append(json_field.isnot(None))

        case "before" | "<":
            filters.append(numeric_field < numeric_comparison_value)

        case "after" | ">":
            filters.append(numeric_field > numeric_comparison_value)

        case "≤" | "<=":
            filters.append(numeric_field <= numeric_comparison_value)

        case "≥" | ">=":
            filters.append(numeric_field >= numeric_comparison_value)
        case "in" | "not in":
            match value:
                case str():
                    value_list = [v.strip() for v in value.split(",") if v.strip()]
                case list() | tuple():
                    value_list = [str(v) for v in value if v is not None]
                case _:
                    value_list = [str(value)]

            if not value_list:
                # `field in []` is False, `field not in []` is True
                filters.append(literal(condition == "not in"))
            else:
                op = json_field.in_ if condition == "in" else json_field.notin_
                filters.append(and_(is_json_string, op(value_list)))
        case _:
            pass

    return filters


def query_metadata_filter_document_ids(
    session: Session,
    *,
    tenant_id: str,
    dataset_ids: Sequence[str],
    logical_operator: str | None = "and",
    conditions: Sequence[MetadataFilterCondition] | None = None,
) -> dict[str, list[str]]:
    """Return eligible document IDs grouped by dataset for one metadata filter."""
    if not dataset_ids:
        return {}
    filters: list[ColumnElement[bool]] = []
    for sequence, condition in enumerate(conditions or ()):
        process_metadata_filter_func(
            sequence,
            condition.comparison_operator,
            condition.name,
            condition.value,
            filters,
            dialect_name=session.get_bind().dialect.name,
        )
    statement = (
        select(Document.dataset_id, Document.id)
        .join(Dataset, Dataset.id == Document.dataset_id)
        .where(
            Document.tenant_id == tenant_id,
            Document.dataset_id.in_(dataset_ids),
            Dataset.tenant_id == tenant_id,
            Document.enabled.is_(True),
            Document.archived.is_(False),
            Document.indexing_status == "completed",
        )
    )
    if filters:
        statement = statement.where(and_(*filters) if logical_operator == "and" else or_(*filters))
    document_ids: dict[str, list[str]] = {}
    for dataset_id, document_id in session.execute(statement):
        document_ids.setdefault(dataset_id, []).append(document_id)
    return document_ids
