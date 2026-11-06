"""Only prepared static plugin declarations qualify for the metadata gate."""

from typing import Literal

import pytest

from core.entities.provider_entities import CustomModelConfiguration
from core.model_manager import ModelInstance
from core.plugin.entities.plugin_daemon import PluginModelProviderDeclaration
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
from models.provider import ProviderType
from services.dify_builder import cognition_model_gateway as gateway
from tests.helpers.unit.core.model_fixtures import make_model_instance

IDENTIFIER = "langgenius/anthropic:1.0.0@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"


def _instance() -> ModelInstance:
    instance = make_model_instance(provider="langgenius/anthropic/anthropic", model="static-model")
    original = instance.model_type_instance.provider_schema
    declaration = PluginModelProviderDeclaration(
        **original.model_dump(exclude={"models"}),
        models=[
            AIModelEntity(
                model=instance.model_name,
                label=original.label,
                model_type=ModelType.LLM,
                fetch_from=FetchFrom.PREDEFINED_MODEL,
                model_properties={},
            )
        ],
        plugin_unique_identifier=IDENTIFIER,
        installation_source=None,
    )
    instance.model_type_instance.provider_schema = declaration
    instance.provider_model_bundle.configuration.provider = declaration
    instance.provider_model_bundle.configuration._cached_provider_schema = declaration
    return instance


def test_qualified_metadata_gate_bypasses_schema_cache_and_preserves_prepared_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    instance = _instance()
    credentials = {"api_key": "prepared"}
    instance.credentials = credentials
    runtime = instance.model_type_instance.model_runtime
    calls = []
    monkeypatch.setattr(runtime.client, "ensure_model_metadata_ready", lambda **kwargs: calls.append(kwargs))
    monkeypatch.setattr(
        runtime, "get_model_schema", lambda **_: pytest.fail("cached schema cannot establish readiness")
    )

    def check() -> None:
        pass

    assert gateway.ensure_predefined_plugin_metadata_ready(instance, check=check)
    assert calls == [
        {
            "tenant_id": "test-tenant-id",
            "user_id": None,
            "plugin_id": "langgenius/anthropic",
            "provider": "anthropic",
            "model": "static-model",
            "plugin_unique_identifier": IDENTIFIER,
            "check": check,
        }
    ]
    assert instance.credentials is credentials


@pytest.mark.parametrize("unqualified", ["custom_override", "custom_declaration", "unpinned", "system", "pending_lb"])
def test_config_dependent_or_unpinned_models_keep_existing_dispatch_behavior(
    monkeypatch: pytest.MonkeyPatch,
    unqualified: Literal["custom_override", "custom_declaration", "unpinned", "system", "pending_lb"],
) -> None:
    instance = _instance()
    declaration = instance.model_type_instance.provider_schema
    if unqualified == "custom_override":
        instance.provider_model_bundle.configuration.custom_configuration.models = [
            CustomModelConfiguration(
                model=instance.model_name, model_type=ModelType.LLM, credentials={"key": "private"}
            )
        ]
    elif unqualified == "custom_declaration":
        declaration.models[0].fetch_from = FetchFrom.CUSTOMIZABLE_MODEL
    elif unqualified == "system":
        instance.provider_model_bundle.configuration.using_provider_type = ProviderType.SYSTEM
    elif unqualified == "pending_lb":
        from tests.unit_tests.services.dify_builder.test_cognition_model_gateway import NativeSelection

        instance.load_balancing_manager = NativeSelection()
    else:
        instance.model_type_instance.provider_schema = make_model_instance(
            provider="anthropic", model="x"
        ).model_type_instance.provider_schema
    monkeypatch.setattr(
        instance.model_type_instance.model_runtime.client,
        "get_model_schema",
        lambda **_: pytest.fail("unqualified metadata call"),
    )
    assert not gateway.ensure_predefined_plugin_metadata_ready(instance, check=lambda: None)
