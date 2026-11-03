import pytest
from dify_trace_sdk.config import FormField, ProviderConfig, derived, http_url, integer_id, name_or_default, secret
from pydantic import ValidationError, field_validator


class _Config(ProviderConfig):
    api_key: str = secret()
    password: str | None = secret(default=None)
    endpoint: str = "https://example.com"
    project_url: str | None = derived()

    @field_validator("endpoint")
    @classmethod
    def _endpoint(cls, value: str) -> str:
        return http_url(value, allowed_schemes=("https",))


def test_field_metadata_drives_secrets_derived_fields_and_form() -> None:
    assert _Config.secret_fields() == {"api_key", "password"}
    assert _Config.derived_fields() == {"project_url"}
    assert _Config.form_fields() == (
        FormField(name="api_key", secret=True, required=True),
        FormField(name="password", secret=True, required=False),
        FormField(name="endpoint", secret=False, required=False),
    )


def test_validation_errors_never_echo_input() -> None:
    with pytest.raises(ValidationError) as caught:
        _Config.model_validate({"api_key": "sk-123", "endpoint": "http://user:pw@example.com"})
    assert "user:pw" not in str(caught.value)


def test_unknown_stored_keys_are_ignored() -> None:
    config = _Config.model_validate({"api_key": "k", "legacy_field": "x"})
    assert not hasattr(config, "legacy_field")


def test_url_and_name_helpers() -> None:
    assert http_url(" https://example.com/base/ ", allowed_schemes=("https",)) == "https://example.com/base/"
    with pytest.raises(ValueError, match="URL must start with"):
        http_url("ftp://example.com", allowed_schemes=("https", "http"))
    with pytest.raises(ValueError, match="must not contain credentials"):
        http_url("https://user:secret@example.com", allowed_schemes=("https",))
    assert name_or_default("  ", "default") == "default"
    assert name_or_default(" project ", "default") == "project"
    assert integer_id(" 42 ") == "42"
    with pytest.raises(ValueError, match="valid integer"):
        integer_id("4x")
    with pytest.raises(ValueError, match="valid integer"):
        integer_id("\u0664\u0662")
