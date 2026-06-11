import json
import math
import re
from collections.abc import Collection, Mapping
from typing import Any

ORACLE_IN_CLAUSE_BATCH_SIZE = 900
MAX_METADATA_KEY_LENGTH = 255
MAX_METADATA_STRING_FILTER_BYTES = 4000
ORACLE_SIMPLE_JSON_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
ORACLE_METADATA_TEXT_OPERATORS = {
    "contains",
    "not contains",
    "start with",
    "end with",
}
ORACLE_METADATA_ORDER_OPERATORS = {
    ">": ">",
    "<": "<",
    "≥": ">=",
    "≤": "<=",
    "before": "<",
    "after": ">",
}


def validate_json_key(value: str) -> str:
    if not value or len(value) > MAX_METADATA_KEY_LENGTH:
        raise ValueError(f"Oracle JSON metadata keys must contain between 1 and {MAX_METADATA_KEY_LENGTH} characters.")
    return value


def get_condition_attr(condition: Any, attr: str, default: Any = None) -> Any:
    if isinstance(condition, dict):
        return condition.get(attr, default)
    return getattr(condition, attr, default)


def metadata_json_value(key: str, *, returning: str | None = None) -> str:
    sql_path = metadata_json_path(key)
    if returning:
        return f"JSON_VALUE(meta, '{sql_path}' RETURNING {returning} NULL ON ERROR)"
    return f"JSON_VALUE(meta, '{sql_path}')"


def metadata_json_path(key: str) -> str:
    key = validate_json_key(key)
    if ORACLE_SIMPLE_JSON_KEY.fullmatch(key):
        json_path = f"$.{key}"
    else:
        # Oracle requires a path literal, so quote as a JSON field name and then
        # escape SQL apostrophes. Comparison values remain bind variables.
        json_path = f"$.{json.dumps(key, ensure_ascii=False)}"
    return json_path.replace("'", "''")


def metadata_json_non_null_exists(key: str) -> str:
    return f"JSON_EXISTS(meta, '{metadata_json_path(key)}?(@ != null)')"


def metadata_json_empty_string_exists(key: str) -> str:
    return f"JSON_EXISTS(meta, '{metadata_json_path(key)}?(@ == \"\")')"


def add_bind_param(params: dict[str, Any], prefix: str, value: Any) -> str:
    if isinstance(value, str) and len(value.encode("utf-8")) > MAX_METADATA_STRING_FILTER_BYTES:
        raise ValueError(
            f"Oracle metadata string filter values must be at most {MAX_METADATA_STRING_FILTER_BYTES} UTF-8 bytes."
        )
    param_name = f"{prefix}_{len(params)}"
    params[param_name] = value
    return param_name


def escape_like_value(value: Any) -> str:
    return str(value).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def normalize_metadata_filter_values(operator: str, value: Any) -> list[Any]:
    if operator in {"in", "not in"}:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        if isinstance(value, Collection) and not isinstance(value, (str, bytes, bytearray, Mapping)):
            return [str(item) for item in value if item is not None]
        return [str(value)] if value is not None else []

    if isinstance(value, str) or (isinstance(value, (int, float)) and not isinstance(value, bool)):
        return [value]
    return []


def validate_numeric_metadata_filter_value(operator: str, value: Any) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"Oracle metadata operator {operator!r} requires a finite numeric value.")
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"Oracle metadata operator {operator!r} requires a finite numeric value.")
    return value


def metadata_comparison_expr(key: str, value: Any) -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return metadata_json_value(key, returning="NUMBER")
    return metadata_json_value(key)


def build_in_filter(
    column_expr: str,
    values: list[Any],
    params: dict[str, Any],
    prefix: str,
    *,
    negate: bool = False,
) -> str:
    if not values:
        return "1 = 1" if negate else "1 = 0"
    if len(values) > ORACLE_IN_CLAUSE_BATCH_SIZE:
        raise ValueError(f"metadata filters support at most {ORACLE_IN_CLAUSE_BATCH_SIZE} values per condition.")
    placeholders = []
    for value in values:
        param_name = add_bind_param(params, prefix, value)
        placeholders.append(f":{param_name}")
    operator = "NOT IN" if negate else "IN"
    return f"{column_expr} {operator} ({', '.join(placeholders)})"


def build_string_in_filter(key: str, values: list[Any], params: dict[str, Any], *, negate: bool = False) -> str:
    if not values:
        return "1 = 1" if negate else "1 = 0"
    if len(values) > ORACLE_IN_CLAUSE_BATCH_SIZE:
        raise ValueError(f"metadata filters support at most {ORACLE_IN_CLAUSE_BATCH_SIZE} values per condition.")

    text_expr = metadata_json_value(key)
    empty_exists = metadata_json_empty_string_exists(key)
    has_empty = "" in values
    non_empty_values = [value for value in values if value != ""]

    if not negate:
        if not non_empty_values:
            return empty_exists
        in_filter = build_in_filter(text_expr, non_empty_values, params, "metadata_filter")
        return f"({empty_exists} OR {in_filter})" if has_empty else in_filter

    non_null_exists = metadata_json_non_null_exists(key)
    if not non_empty_values:
        return f"({non_null_exists} AND NOT {empty_exists})"

    not_in_filter = build_in_filter(text_expr, non_empty_values, params, "metadata_filter", negate=True)
    if has_empty:
        return f"({non_null_exists} AND NOT {empty_exists} AND ({text_expr} IS NULL OR {not_in_filter}))"
    return f"({non_null_exists} AND ({text_expr} IS NULL OR {not_in_filter}))"


def build_metadata_condition_filter(metadata_condition: Any, params: dict[str, Any]) -> str:
    if not metadata_condition:
        return ""

    logical_operator = str(get_condition_attr(metadata_condition, "logical_operator", "and") or "and").lower()
    if logical_operator not in {"and", "or"}:
        raise ValueError("metadata_condition.logical_operator must be 'and' or 'or'.")

    conditions = get_condition_attr(metadata_condition, "conditions") or []
    initial_param_count = len(params)
    predicates = [build_single_metadata_filter(condition, params) for condition in conditions]
    if len(params) - initial_param_count > ORACLE_IN_CLAUSE_BATCH_SIZE:
        raise ValueError(f"metadata filters support at most {ORACLE_IN_CLAUSE_BATCH_SIZE} bound values per query.")
    predicates = [predicate for predicate in predicates if predicate]
    if not predicates:
        return ""

    joiner = f" {logical_operator.upper()} "
    return f"({joiner.join(predicates)})"


def build_single_metadata_filter(condition: Any, params: dict[str, Any]) -> str:
    key = validate_json_key(str(get_condition_attr(condition, "name", "")))
    operator = str(get_condition_attr(condition, "comparison_operator", "")).strip().lower()
    value = get_condition_attr(condition, "value")
    if value is None and operator not in {"empty", "not empty"}:
        return ""

    text_expr = metadata_json_value(key)

    if operator in ORACLE_METADATA_TEXT_OPERATORS:
        text_expr = metadata_json_value(key, returning="CLOB")
        text_value = str(value)
        if not text_value:
            if operator == "not contains":
                return "1 = 0"
            return metadata_json_non_null_exists(key)

        param_name = add_bind_param(params, "metadata_filter", escape_like_value(text_value))
        if operator == "contains":
            return f"{text_expr} LIKE '%' || :{param_name} || '%' ESCAPE '\\'"
        if operator == "not contains":
            empty_exists = metadata_json_empty_string_exists(key)
            return f"({empty_exists} OR {text_expr} NOT LIKE '%' || :{param_name} || '%' ESCAPE '\\')"
        if operator == "start with":
            return f"{text_expr} LIKE :{param_name} || '%' ESCAPE '\\'"
        if operator == "end with":
            return f"{text_expr} LIKE '%' || :{param_name} ESCAPE '\\'"

    if operator == "is":
        values = normalize_metadata_filter_values(operator, value)
        if not values:
            return ""
        if values[0] == "":
            return metadata_json_empty_string_exists(key)
        expr = metadata_comparison_expr(key, values[0])
        param_name = add_bind_param(params, "metadata_filter", values[0])
        return f"{expr} = :{param_name}"

    if operator == "=":
        numeric_value = validate_numeric_metadata_filter_value(operator, value)
        param_name = add_bind_param(params, "metadata_filter", numeric_value)
        return f"{metadata_json_value(key, returning='NUMBER')} = :{param_name}"

    if operator == "in":
        values = normalize_metadata_filter_values(operator, value)
        return build_string_in_filter(key, values, params)

    if operator == "is not":
        values = normalize_metadata_filter_values(operator, value)
        if not values:
            return ""
        if values[0] == "":
            non_null_exists = metadata_json_non_null_exists(key)
            empty_exists = metadata_json_empty_string_exists(key)
            return f"({non_null_exists} AND NOT {empty_exists})"
        expr = metadata_comparison_expr(key, values[0])
        param_name = add_bind_param(params, "metadata_filter", values[0])
        comparison = f"{expr} != :{param_name}"
        if isinstance(values[0], str):
            non_null_exists = metadata_json_non_null_exists(key)
            return f"({non_null_exists} AND ({expr} IS NULL OR {comparison}))"
        return comparison

    if operator == "≠":
        numeric_value = validate_numeric_metadata_filter_value(operator, value)
        param_name = add_bind_param(params, "metadata_filter", numeric_value)
        return f"{metadata_json_value(key, returning='NUMBER')} != :{param_name}"

    if operator == "not in":
        values = normalize_metadata_filter_values(operator, value)
        return build_string_in_filter(key, values, params, negate=True)

    if operator == "empty":
        return f"NOT {metadata_json_non_null_exists(key)}"

    if operator == "not empty":
        return metadata_json_non_null_exists(key)

    if operator in ORACLE_METADATA_ORDER_OPERATORS:
        # Dify stores time metadata and before/after filter values as Unix epoch seconds.
        numeric_value = validate_numeric_metadata_filter_value(operator, value)
        expr = metadata_json_value(key, returning="NUMBER")
        param_name = add_bind_param(params, "metadata_filter", numeric_value)
        return f"{expr} {ORACLE_METADATA_ORDER_OPERATORS[operator]} :{param_name}"

    raise ValueError(f"Unsupported Oracle metadata comparison operator: {operator}")


def build_where_clause(filters: list[str]) -> str:
    filters = [filter_clause for filter_clause in filters if filter_clause]
    if not filters:
        return ""
    return f"WHERE {' AND '.join(filters)}"


def build_and_clause(filters: list[str]) -> str:
    filters = [filter_clause for filter_clause in filters if filter_clause]
    if not filters:
        return ""
    return f" AND {' AND '.join(filters)}"
