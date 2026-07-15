from core.workflow.secret_scrub import (
    SECRET_PLACEHOLDER,
    collect_workflow_secret_values,
    redact_secret_values,
)
from graphon.variables import SecretVariable, StringVariable

SECRET = "supersecretvalue123"


def test_empty_registry_is_a_no_op() -> None:
    value = {"a": SECRET, "b": [SECRET]}
    result = redact_secret_values(value, ())
    assert result is value


def test_long_secret_is_substring_redacted() -> None:
    result = redact_secret_values({"h": f"Bearer {SECRET}"}, (SECRET,))
    assert result == {"h": f"Bearer {SECRET_PLACEHOLDER}"}


def test_short_secret_only_exact_match() -> None:
    # "abc" (<8) must not corrupt unrelated text that merely contains it
    result = redact_secret_values({"x": "abcdef", "y": "abc"}, ("abc",))
    assert result == {"x": "abcdef", "y": SECRET_PLACEHOLDER}


def test_redaction_recurses_nested_structures() -> None:
    value = {"list": [f"k={SECRET}"], "tuple": (SECRET,), "n": 5}
    result = redact_secret_values(value, (SECRET,))
    assert result == {"list": [f"k={SECRET_PLACEHOLDER}"], "tuple": (SECRET_PLACEHOLDER,), "n": 5}


def test_collect_gathers_env_and_conversation_secrets_only() -> None:
    env = [SecretVariable(value="env-secret-123", name="API_KEY"), StringVariable(value="plain", name="p")]
    conv = [SecretVariable(value="conv-secret-456", name="TOKEN")]
    assert collect_workflow_secret_values(env, conv) == ("env-secret-123", "conv-secret-456")


def test_collect_deduplicates_and_skips_empty() -> None:
    env = [
        SecretVariable(value="dup", name="a"),
        SecretVariable(value="dup", name="b"),
        SecretVariable(value="", name="c"),
    ]
    assert collect_workflow_secret_values(env, []) == ("dup",)
