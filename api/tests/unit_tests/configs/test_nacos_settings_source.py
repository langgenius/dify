from unittest.mock import patch

from pydantic import AliasChoices, Field
from pydantic.fields import FieldInfo
from pydantic_settings import BaseSettings

from configs.remote_settings_sources.nacos import NacosSettingsSource


class _SettingsWithAliases(BaseSettings):
    PLAIN_KEY: str | None = Field(default=None)

    ALIASED_KEY: str | None = Field(
        default=None,
        validation_alias=AliasChoices("ALIAS_ONE", "ALIAS_TWO"),
    )

    STR_ALIASED_KEY: str | None = Field(
        default=None,
        validation_alias="STR_ALIAS",
    )


def _field(name: str) -> FieldInfo:
    return _SettingsWithAliases.model_fields[name]


def _make_source(content: str) -> NacosSettingsSource:
    with patch("configs.remote_settings_sources.nacos.NacosHttpClient") as mock_client:
        mock_client.return_value.http_request.return_value = content
        return NacosSettingsSource({})


def test_get_field_value_matches_exact_field_name() -> None:
    source = _make_source("PLAIN_KEY=plain-value")

    assert source.get_field_value(_field("PLAIN_KEY"), "PLAIN_KEY") == ("plain-value", "PLAIN_KEY", False)


def test_get_field_value_matches_alias_choices() -> None:
    source = _make_source("ALIAS_TWO=aliased-value")

    assert source.get_field_value(_field("ALIASED_KEY"), "ALIASED_KEY") == ("aliased-value", "ALIAS_TWO", False)


def test_get_field_value_prefers_field_name_over_alias() -> None:
    source = _make_source("ALIASED_KEY=by-name\nALIAS_ONE=by-alias")

    assert source.get_field_value(_field("ALIASED_KEY"), "ALIASED_KEY") == ("by-name", "ALIASED_KEY", False)


def test_get_field_value_matches_string_validation_alias() -> None:
    source = _make_source("STR_ALIAS=str-alias-value")

    assert source.get_field_value(_field("STR_ALIASED_KEY"), "STR_ALIASED_KEY") == (
        "str-alias-value",
        "STR_ALIAS",
        False,
    )


def test_get_field_value_returns_none_when_missing() -> None:
    source = _make_source("OTHER_KEY=other")

    assert source.get_field_value(_field("ALIASED_KEY"), "ALIASED_KEY") == (None, "ALIASED_KEY", False)
