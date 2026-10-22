"""Shared SQL predicates for persisted document metadata."""

from sqlalchemy import literal
from sqlalchemy.sql import ColumnElement

from models.dataset import Document


def process_metadata_filter_func(
    sequence: int, condition: str, metadata_name: str, value: object, filters: list[ColumnElement[bool]]
) -> list[ColumnElement[bool]]:
    if value is None and condition not in ("empty", "not empty"):
        return filters

    json_field = Document.doc_metadata[metadata_name].as_string()

    from libs.helper import escape_like_pattern

    match condition:
        case "contains":
            escaped_value = escape_like_pattern(str(value))
            filters.append(json_field.like(f"%{escaped_value}%", escape="\\"))

        case "not contains":
            escaped_value = escape_like_pattern(str(value))
            filters.append(json_field.notlike(f"%{escaped_value}%", escape="\\"))

        case "start with":
            escaped_value = escape_like_pattern(str(value))
            filters.append(json_field.like(f"{escaped_value}%", escape="\\"))

        case "end with":
            escaped_value = escape_like_pattern(str(value))
            filters.append(json_field.like(f"%{escaped_value}", escape="\\"))

        case "is" | "=":
            match value:
                case str():
                    filters.append(json_field == value)
                case int() | float():
                    filters.append(Document.doc_metadata[metadata_name].as_float() == value)

        case "is not" | "≠":
            match value:
                case str():
                    filters.append(json_field != value)
                case int() | float():
                    filters.append(Document.doc_metadata[metadata_name].as_float() != value)

        case "empty":
            filters.append(Document.doc_metadata[metadata_name].is_(None))

        case "not empty":
            filters.append(Document.doc_metadata[metadata_name].isnot(None))

        case "before" | "<":
            filters.append(Document.doc_metadata[metadata_name].as_float() < value)

        case "after" | ">":
            filters.append(Document.doc_metadata[metadata_name].as_float() > value)

        case "≤" | "<=":
            filters.append(Document.doc_metadata[metadata_name].as_float() <= value)

        case "≥" | ">=":
            filters.append(Document.doc_metadata[metadata_name].as_float() >= value)
        case "in" | "not in":
            match value:
                case str():
                    value_list = [v.strip() for v in value.split(",") if v.strip()]
                case list() | tuple():
                    value_list = [str(v) for v in value if v is not None]
                case _:
                    value_list = [str(value)] if value is not None else []

            if not value_list:
                # `field in []` is False, `field not in []` is True
                filters.append(literal(condition == "not in"))
            else:
                op = json_field.in_ if condition == "in" else json_field.notin_
                filters.append(op(value_list))
        case _:
            pass

    return filters
