"""Validate JSON fixture containers without copying mutable aliases or business rules."""


def fixture_object(value: object) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise TypeError("fixture object must have string keys")
    return value


def fixture_list(value: object) -> list[object]:
    if not isinstance(value, list):
        raise TypeError("fixture value must be a list")
    return value


def fixture_records(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        raise TypeError("fixture value must be a list")
    for row in value:
        fixture_object(row)
    return value


def fixture_string(value: object) -> str:
    if not isinstance(value, str):
        raise TypeError("fixture value must be a string")
    return value
