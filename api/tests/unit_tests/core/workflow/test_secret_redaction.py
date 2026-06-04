from typing import NamedTuple

from core.workflow.secret_redaction import (
    SECRET_REDACTION_PLACEHOLDER,
    collect_secret_values,
    collect_sensitive_string_values,
    contains_sensitive_value,
    mask_sensitive_value,
    redact_sensitive_values,
)
from graphon.variables import SecretVariable, StringVariable


def test_collect_secret_values_only_returns_secret_variables() -> None:
    assert collect_secret_values(
        [
            StringVariable(name="public", value="visible"),
            SecretVariable(name="api_key", value="sk-secret"),
            SecretVariable(name="empty", value=""),
        ]
    ) == ("sk-secret",)


def test_redact_sensitive_values_recursively_replaces_string_content() -> None:
    payload = {
        "authorization": "Bearer sk-secret",
        "nested": ["prefix-sk-secret-suffix"],
        "visible": "hello",
    }

    assert redact_sensitive_values(payload, ("sk-secret",)) == {
        "authorization": f"Bearer {SECRET_REDACTION_PLACEHOLDER}",
        "nested": [f"prefix-{SECRET_REDACTION_PLACEHOLDER}-suffix"],
        "visible": "hello",
    }


def test_short_sensitive_values_only_match_exact_strings() -> None:
    assert redact_sensitive_values("token=a", ("a",)) == "token=a"
    assert redact_sensitive_values("a", ("a",)) == SECRET_REDACTION_PLACEHOLDER
    assert contains_sensitive_value("token=a", ("a",)) is False
    assert contains_sensitive_value("a", ("a",)) is True


def test_mask_sensitive_value_preserves_container_shape() -> None:
    assert mask_sensitive_value({"a": "x", "nested": ["y"]}) == {
        "a": SECRET_REDACTION_PLACEHOLDER,
        "nested": [SECRET_REDACTION_PLACEHOLDER],
    }


def test_secret_values_below_substring_threshold_only_match_exact_strings() -> None:
    # "abcdef" is 6 chars, below the 8-char substring threshold, so it is only redacted on
    # an exact whole-string match and must not corrupt unrelated text that contains it.
    assert redact_sensitive_values("prefix-abcdef-suffix", ("abcdef",)) == "prefix-abcdef-suffix"
    assert redact_sensitive_values("abcdef", ("abcdef",)) == SECRET_REDACTION_PLACEHOLDER
    # A value at or above the threshold is still redacted as a substring.
    assert redact_sensitive_values("prefix-longsecret-suffix", ("longsecret",)) == (
        f"prefix-{SECRET_REDACTION_PLACEHOLDER}-suffix"
    )


def test_tainted_values_match_exactly_not_as_substring() -> None:
    tainted = ("Operation completed successfully",)
    # Innocuous text that merely contains a tainted string as a substring is left intact.
    assert redact_sensitive_values("Operation completed successfully!", (), tainted) == (
        "Operation completed successfully!"
    )
    # An exact reappearance of the tainted string is redacted.
    assert redact_sensitive_values(
        {"echo": "Operation completed successfully"}, (), tainted
    ) == {"echo": SECRET_REDACTION_PLACEHOLDER}
    assert contains_sensitive_value("Operation completed successfully!", (), tainted) is False
    assert contains_sensitive_value("Operation completed successfully", (), tainted) is True


def test_collect_sensitive_string_values_drops_short_strings() -> None:
    collected = collect_sensitive_string_values({"encoded": "c2stc2VjcmV0", "pieces": ["sk", "secret"]})
    # "sk" (2 chars) is below the taint threshold and excluded; longer strings are kept.
    assert set(collected) == {"c2stc2VjcmV0", "secret"}


def test_redact_preserves_namedtuple_subclass() -> None:
    class Point(NamedTuple):
        label: str
        value: str

    redacted = redact_sensitive_values(Point(label="api", value="longsecret"), ("longsecret",))
    assert isinstance(redacted, Point)
    assert redacted == Point(label="api", value=SECRET_REDACTION_PLACEHOLDER)

    masked = mask_sensitive_value(Point(label="api", value="longsecret"))
    assert isinstance(masked, Point)
    assert masked == Point(label=SECRET_REDACTION_PLACEHOLDER, value=SECRET_REDACTION_PLACEHOLDER)
