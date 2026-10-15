"""Suggested-question tuning using real model objects and the Redis schema cache."""

from uuid import uuid4

import pytest
from flask import Flask

from core.entities.provider_configuration import ProviderConfiguration, ProviderModelBundle
from core.entities.provider_entities import CustomConfiguration, SystemConfiguration
from core.model_manager import ModelInstance
from core.plugin.impl.model_runtime_factory import create_plugin_model_runtime
from extensions.ext_redis import redis_client
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import (
    AIModelEntity,
    FetchFrom,
    ModelType,
    ParameterRule,
    ParameterType,
)
from graphon.model_runtime.entities.provider_entities import ProviderEntity
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from models.provider import ProviderType
from services.message_suggested_questions_generator import _default_suggested_questions_model_parameters


@pytest.mark.parametrize(
    ("thinking_type", "thinking_options", "reasoning_options", "expected"),
    [
        (None, [], [], {}),
        (None, [], ["minimal", "low", "medium", "high"], {"reasoning_effort": "minimal"}),
        (None, [], ["low", "none", "minimal"], {"reasoning_effort": "none"}),
        (None, [], ["low", "high"], {"reasoning_effort": "low"}),
        (None, [], ["medium", "high"], {}),
        (ParameterType.BOOLEAN, [], ["low", "high"], {"thinking": False}),
        (ParameterType.STRING, ["enabled", "disabled"], ["low", "high"], {"thinking": "disabled"}),
        (ParameterType.STRING, ["enabled"], ["low", "high"], {"reasoning_effort": "low"}),
    ],
)
def test_default_model_parameters_use_cached_provider_schema(
    flask_app_with_containers: Flask,
    thinking_type: ParameterType | None,
    thinking_options: list[str],
    reasoning_options: list[str],
    expected: dict[str, object],
) -> None:
    tenant_id = str(uuid4())
    provider = ProviderEntity(
        provider="langgenius/openai/openai",
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[],
    )
    rules = []
    if thinking_type is not None:
        rules.append(
            ParameterRule(
                name="thinking", label=I18nObject(en_US="Thinking"), type=thinking_type, options=thinking_options
            )
        )
    if reasoning_options:
        rules.append(
            ParameterRule(
                name="reasoning_effort",
                label=I18nObject(en_US="Reasoning effort"),
                type=ParameterType.STRING,
                options=reasoning_options,
            )
        )
    schema = AIModelEntity(
        model="questions-model",
        label=I18nObject(en_US="Questions model"),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={},
        parameter_rules=rules,
    )
    runtime = create_plugin_model_runtime(tenant_id=tenant_id)
    model = ModelInstance(
        provider_model_bundle=ProviderModelBundle(
            configuration=ProviderConfiguration(
                tenant_id=tenant_id,
                provider=provider,
                preferred_provider_type=ProviderType.CUSTOM,
                using_provider_type=ProviderType.CUSTOM,
                system_configuration=SystemConfiguration(enabled=False),
                custom_configuration=CustomConfiguration(provider=None),
                model_settings=[],
            ),
            model_type_instance=LargeLanguageModel(provider_schema=provider, model_runtime=runtime),
        ),
        model=schema.model,
        credentials={},
    )
    cache_key = runtime._get_schema_cache_key(
        provider=provider.provider, model_type=ModelType.LLM, model=schema.model, credentials={}
    )
    with flask_app_with_containers.app_context():
        redis_client.setex(cache_key, 60, schema.model_dump_json())
        try:
            assert model.get_model_schema() == schema
            assert _default_suggested_questions_model_parameters(model) == {
                "max_tokens": 256,
                "temperature": 0.0,
                **expected,
            }
        finally:
            redis_client.delete(cache_key)
