from collections.abc import Iterable, Mapping
from enum import Enum

from graphon.enums import BuiltinNodeTypes
from graphon.variables import SecretVariable, VariableBase

SECRET_REDACTION_PLACEHOLDER = "[SECRET_REDACTED]"
# Secrets shorter than this are only redacted on an exact whole-string match. Substring
# redaction of very short values corrupts unrelated text that merely contains the value
# (e.g. a 4-char secret colliding with a common word), so we require an exact match below
# this length. Real environment secrets (API keys, tokens) are comfortably longer.
_MIN_SUBSTRING_REDACTION_LENGTH = 8
# Code-node output strings shorter than this are not registered as tainted values. Exact
# matching already prevents broad false positives, and dropping trivial values keeps the
# taint set free of noise such as "ok" or "true".
_MIN_TAINT_LENGTH = 4


def collect_secret_values(variables: Iterable[VariableBase]) -> tuple[str, ...]:
    values: list[str] = []
    for variable in variables:
        if not isinstance(variable, SecretVariable):
            continue
        value = variable.value
        if isinstance(value, str) and value:
            values.append(value)
    return tuple(dict.fromkeys(values))


def collect_sensitive_string_values(value: object, *, min_length: int = _MIN_TAINT_LENGTH) -> tuple[str, ...]:
    """Collect string leaves worth tracking as tainted values.

    Used to register the raw output strings of a code node that consumed a secret, so the
    same transformed string can be redacted if it reappears in a downstream payload.
    """
    values: list[str] = []

    def visit(item: object) -> None:
        if isinstance(item, str):
            if len(item) >= min_length:
                values.append(item)
            return
        if isinstance(item, Mapping):
            for nested_value in item.values():
                visit(nested_value)
            return
        if isinstance(item, list | tuple | set | frozenset):
            for nested_value in item:
                visit(nested_value)

    visit(value)
    return tuple(dict.fromkeys(values))


def _build_matcher(
    sensitive_values: Iterable[str],
    exact_match_values: Iterable[str],
) -> tuple[tuple[str, ...], frozenset[str]]:
    """Split sensitive values into substring-matched and exact-matched buckets.

    ``sensitive_values`` are true secrets: long enough values are matched as substrings so
    they are redacted even when embedded in larger strings, while short values fall back to
    exact matching. ``exact_match_values`` (tainted code outputs) are always matched exactly
    to avoid redacting unrelated text that merely shares a token with them.
    """
    substring_values: list[str] = []
    exact_values: set[str] = set()
    for value in sensitive_values:
        if not value:
            continue
        if len(value) >= _MIN_SUBSTRING_REDACTION_LENGTH:
            substring_values.append(value)
        else:
            exact_values.add(value)
    for value in exact_match_values:
        if value:
            exact_values.add(value)
    return tuple(dict.fromkeys(substring_values)), frozenset(exact_values)


def _rebuild_tuple(original: tuple, values: list[object]) -> tuple:
    # Preserve NamedTuple subclasses instead of flattening them into a bare tuple.
    # ``_make`` is the canonical NamedTuple constructor and only exists on NamedTuples,
    # so its presence doubles as the subclass check.
    make = getattr(original, "_make", None)
    if make is not None:
        return make(values)
    return tuple(values)


def contains_sensitive_value(
    value: object,
    sensitive_values: Iterable[str],
    exact_match_values: Iterable[str] = (),
) -> bool:
    substring_values, exact_values = _build_matcher(sensitive_values, exact_match_values)
    if not substring_values and not exact_values:
        return False

    def matches(text: str) -> bool:
        if text in exact_values:
            return True
        return any(sensitive_value in text for sensitive_value in substring_values)

    def visit(item: object) -> bool:
        if isinstance(item, str):
            return matches(item)
        if isinstance(item, Mapping):
            return any(visit(nested_value) for nested_value in item.values())
        if isinstance(item, list | tuple | set | frozenset):
            return any(visit(nested_value) for nested_value in item)
        return False

    return visit(value)


def redact_sensitive_values(
    value: object,
    sensitive_values: Iterable[str],
    exact_match_values: Iterable[str] = (),
) -> object:
    substring_values, exact_values = _build_matcher(sensitive_values, exact_match_values)
    if not substring_values and not exact_values:
        return value

    def redact_text(text: str) -> str:
        if text in exact_values:
            return SECRET_REDACTION_PLACEHOLDER
        redacted = text
        for sensitive_value in substring_values:
            redacted = redacted.replace(sensitive_value, SECRET_REDACTION_PLACEHOLDER)
        return redacted

    def visit(item: object) -> object:
        if isinstance(item, str):
            return redact_text(item)
        if isinstance(item, Mapping):
            return {key: visit(nested_value) for key, nested_value in item.items()}
        if isinstance(item, tuple):
            return _rebuild_tuple(item, [visit(nested_value) for nested_value in item])
        if isinstance(item, list):
            return [visit(nested_value) for nested_value in item]
        if isinstance(item, set):
            return {visit(nested_value) for nested_value in item}
        if isinstance(item, frozenset):
            return frozenset(visit(nested_value) for nested_value in item)
        return item

    return visit(value)


def mask_sensitive_value(value: object) -> object:
    if isinstance(value, Mapping):
        return {key: mask_sensitive_value(nested_value) for key, nested_value in value.items()}
    if isinstance(value, tuple):
        return _rebuild_tuple(value, [mask_sensitive_value(nested_value) for nested_value in value])
    if isinstance(value, list):
        return [mask_sensitive_value(nested_value) for nested_value in value]
    if isinstance(value, set):
        return {mask_sensitive_value(nested_value) for nested_value in value}
    if isinstance(value, frozenset):
        return frozenset(mask_sensitive_value(nested_value) for nested_value in value)
    return SECRET_REDACTION_PLACEHOLDER


def is_code_node_type(node_type: object) -> bool:
    code_node_type = getattr(BuiltinNodeTypes.CODE, "value", BuiltinNodeTypes.CODE)
    if node_type == BuiltinNodeTypes.CODE:
        return True
    if isinstance(node_type, Enum):
        return str(node_type.value) == str(code_node_type)
    return str(node_type) == str(code_node_type)
