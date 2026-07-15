"""Value-matching backstop redactor for workflow run logs.

Known limitations: secrets transformed (encoded, truncated, …) before logging
won't match; mapping *keys* are not scrubbed; the registry is collected from
workflow-definition secrets only and may not cover all runtime credential
sources.
"""

from collections.abc import Iterable, Mapping

from graphon.variables import SecretVariable, VariableBase

SECRET_PLACEHOLDER = "[REDACTED_SECRET]"
# Values shorter than this are redacted only on an exact whole-string match;
# substring-redacting a short value would corrupt unrelated text containing it.
_MIN_SUBSTRING_LENGTH = 8


def collect_workflow_secret_values(
    environment_variables: Iterable[VariableBase],
    conversation_variables: Iterable[VariableBase],
) -> tuple[str, ...]:
    """Collect the plaintext of every secret env/conversation variable.

    Returns:
        A de-duplicated tuple of non-empty secret string values, in first-seen order.
    """
    values: list[str] = []
    for variable in (*environment_variables, *conversation_variables):
        if isinstance(variable, SecretVariable) and isinstance(variable.value, str) and variable.value:
            values.append(variable.value)
    return tuple(dict.fromkeys(values))


def _split_values(secret_values: Iterable[str]) -> tuple[tuple[str, ...], frozenset[str]]:
    """Partition secrets into substring-redactable (long) and exact-match-only (short) sets."""
    substrings: list[str] = []
    exacts: set[str] = set()
    for value in secret_values:
        if not value:
            continue
        if len(value) >= _MIN_SUBSTRING_LENGTH:
            substrings.append(value)
        else:
            exacts.add(value)
    # Sort longest-first so a longer secret containing a shorter one is matched first,
    # preventing the shorter secret from fragmenting a longer overlapping one.
    deduped = list(dict.fromkeys(substrings))
    return tuple(sorted(deduped, key=len, reverse=True)), frozenset(exacts)


def redact_secret_values(value: object, secret_values: Iterable[str]) -> object:
    """Return ``value`` unchanged when there is nothing to redact, otherwise a copy with secrets replaced.

    Returns:
        ``value`` unchanged (same object) when there are no secrets to redact;
        otherwise a structurally-identical copy with secrets replaced by
        ``SECRET_PLACEHOLDER``.
    """
    substrings, exacts = _split_values(secret_values)
    if not substrings and not exacts:
        return value

    def redact_text(text: str) -> str:
        if text in exacts:
            return SECRET_PLACEHOLDER
        for secret in substrings:
            text = text.replace(secret, SECRET_PLACEHOLDER)
        return text

    def visit(item: object) -> object:
        if isinstance(item, str):
            return redact_text(item)
        if isinstance(item, Mapping):
            # Keys are field/variable names, not secret plaintext — intentionally not scrubbed.
            return {key: visit(nested) for key, nested in item.items()}
        if isinstance(item, list):
            return [visit(nested) for nested in item]
        if isinstance(item, tuple):
            return tuple(visit(nested) for nested in item)
        if isinstance(item, set):
            return {visit(nested) for nested in item}
        if isinstance(item, frozenset):
            return frozenset(visit(nested) for nested in item)
        return item

    return visit(value)
