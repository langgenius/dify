from typing import Any

import pytest
from pydantic import AliasChoices
from pydantic.fields import FieldInfo

from configs.remote_settings_sources.apollo import ApolloSettingsSource
from configs.remote_settings_sources.nacos import NacosSettingsSource


@pytest.mark.parametrize("source_cls", [NacosSettingsSource, ApolloSettingsSource])
def test_get_field_value_prefers_field_name(source_cls: type[Any]):
    source = source_cls.__new__(source_cls)
    source.remote_configs = {"SETTING": "direct", "ALIAS": "aliased"}
    field = FieldInfo(validation_alias="ALIAS")

    assert source.get_field_value(field, "SETTING") == ("direct", "SETTING", False)


@pytest.mark.parametrize("source_cls", [NacosSettingsSource, ApolloSettingsSource])
def test_get_field_value_falls_back_to_single_validation_alias(source_cls: type[Any]):
    source = source_cls.__new__(source_cls)
    source.remote_configs = {"ALIAS": "aliased"}
    field = FieldInfo(validation_alias="ALIAS")

    assert source.get_field_value(field, "SETTING") == ("aliased", "ALIAS", False)


@pytest.mark.parametrize("source_cls", [NacosSettingsSource, ApolloSettingsSource])
def test_get_field_value_falls_back_to_alias_choices_in_order(source_cls: type[Any]):
    source = source_cls.__new__(source_cls)
    source.remote_configs = {"SECOND_ALIAS": "second"}
    field = FieldInfo(validation_alias=AliasChoices("FIRST_ALIAS", "SECOND_ALIAS"))

    assert source.get_field_value(field, "SETTING") == ("second", "SECOND_ALIAS", False)
