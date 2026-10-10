import pytest

from core.entities.provider_entities import CustomProviderConfiguration
from core.model_manager import ModelInstance
from core.prompt.entities.advanced_prompt_entities import MemoryConfig
from core.prompt.prompt_transform import PromptTransform
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, UserPromptMessage
from graphon.model_runtime.entities.model_entities import ModelPropertyKey, ParameterRule, ParameterType
from tests.unit_tests.core.model_fixtures import make_model_config, make_token_buffer_memory


class TestPromptTransform:
    def test_resolve_model_runtime_requires_model_config_or_instance(self):
        transform = PromptTransform()

        with pytest.raises(ValueError, match="Either model_config or model_instance must be provided."):
            transform._resolve_model_runtime()

    def test_resolve_model_runtime_builds_model_instance_from_model_config(self, monkeypatch: pytest.MonkeyPatch):
        transform = PromptTransform()
        model_config = make_model_config(provider="openai", model="config-model", mode="chat")
        model_config.credentials = {"api_key": "secret"}
        model_config.parameters = {"temperature": 0.1}
        model_config.stop = ["END"]
        bundle = model_config.provider_model_bundle
        bundle.configuration.custom_configuration.provider = CustomProviderConfiguration(
            credentials={"api_key": "provider-secret"}
        )
        model_schema = model_config.model_schema.model_copy(deep=True)
        schema_calls = []

        def get_model_schema(*, model, credentials):
            schema_calls.append((model, credentials))
            return model_schema

        monkeypatch.setattr(bundle.model_type_instance, "get_model_schema", get_model_schema)

        model_instance, resolved_schema = transform._resolve_model_runtime(model_config=model_config)

        assert isinstance(model_instance, ModelInstance)
        assert model_instance.provider_model_bundle is bundle
        assert model_instance.model_name == "config-model"
        assert schema_calls == [("config-model", {"api_key": "secret"})]
        assert model_instance.credentials == {"api_key": "secret"}
        assert model_instance.parameters == {"temperature": 0.1}
        assert model_instance.stop == ["END"]
        assert resolved_schema is model_schema

    def test_resolve_model_runtime_uses_model_config_schema_fallback(self, monkeypatch: pytest.MonkeyPatch):
        transform = PromptTransform()
        model_config = make_model_config(provider="openai", model="resolved-model", mode="chat")
        model_instance = make_token_buffer_memory(model_config).model_instance
        monkeypatch.setattr(model_instance.model_type_instance, "get_model_schema", lambda **_kwargs: None)

        resolved_model_instance, resolved_schema = transform._resolve_model_runtime(
            model_config=model_config,
            model_instance=model_instance,
        )

        assert resolved_model_instance is model_instance
        assert resolved_schema is model_config.model_schema

    def test_resolve_model_runtime_raises_when_schema_missing_without_model_config(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        transform = PromptTransform()
        model_config = make_model_config(provider="openai", model="resolved-model", mode="chat")
        model_instance = make_token_buffer_memory(model_config).model_instance
        monkeypatch.setattr(model_instance.model_type_instance, "get_model_schema", lambda **_kwargs: None)

        with pytest.raises(ValueError, match="Model schema not found for the provided model instance."):
            transform._resolve_model_runtime(model_instance=model_instance)

    def test_calculate_rest_token_defaults_when_context_size_missing(self, monkeypatch: pytest.MonkeyPatch):
        transform = PromptTransform()
        model_config = make_model_config(provider="openai", model="test-model", mode="chat")
        model_instance = make_token_buffer_memory(model_config).model_instance
        monkeypatch.setattr(
            model_instance.model_type_instance, "get_model_schema", lambda **_kwargs: model_config.model_schema
        )

        def unexpected_token_count(_messages):
            pytest.fail("A model without a context size must use the default token budget.")

        monkeypatch.setattr(model_instance, "get_llm_num_tokens", unexpected_token_count)

        rest = transform._calculate_rest_token([], model_instance=model_instance)

        assert rest == 2000

    @pytest.mark.parametrize(
        ("parameter_name", "use_template", "context_size", "max_tokens", "message_tokens", "expected"),
        [
            ("max_tokens", None, 100, 50, 95, 0),
            ("generation_max", "max_tokens", 200, 30, 20, 150),
        ],
        ids=["clamps-to-zero", "template-parameter"],
    )
    def test_calculate_rest_token_uses_max_tokens(
        self,
        monkeypatch: pytest.MonkeyPatch,
        parameter_name: str,
        use_template: str | None,
        context_size: int,
        max_tokens: int,
        message_tokens: int,
        expected: int,
    ):
        transform = PromptTransform()
        model_config = make_model_config(provider="openai", model="test-model", mode="chat")
        model_config.model_schema.model_properties = {ModelPropertyKey.CONTEXT_SIZE: context_size}
        model_config.model_schema.parameter_rules = [
            ParameterRule(
                name=parameter_name,
                use_template=use_template,
                label=I18nObject(en_US="Maximum tokens"),
                type=ParameterType.INT,
            )
        ]
        model_instance = make_token_buffer_memory(model_config).model_instance
        model_instance.parameters = {"max_tokens": max_tokens}
        messages = [UserPromptMessage(content="hello")]
        token_calls = []

        def get_llm_num_tokens(prompt_messages):
            token_calls.append(prompt_messages)
            return message_tokens

        monkeypatch.setattr(model_instance, "get_llm_num_tokens", get_llm_num_tokens)
        monkeypatch.setattr(
            model_instance.model_type_instance, "get_model_schema", lambda **_kwargs: model_config.model_schema
        )

        rest = transform._calculate_rest_token(messages, model_instance=model_instance)

        assert rest == expected
        assert token_calls == [messages]

    def test_get_history_messages_from_memory_with_and_without_window(self, monkeypatch: pytest.MonkeyPatch):
        transform = PromptTransform()
        model_config = make_model_config(provider="openai", model="test-model", mode="chat")
        memory = make_token_buffer_memory(model_config)
        history_calls = []

        def get_history_prompt_text(**kwargs):
            history_calls.append(kwargs)
            return "history"

        monkeypatch.setattr(memory, "get_history_prompt_text", get_history_prompt_text)
        memory_config_with_window = MemoryConfig(window=MemoryConfig.WindowConfig(enabled=True, size=3))
        result = transform._get_history_messages_from_memory(
            memory=memory,
            memory_config=memory_config_with_window,
            max_token_limit=100,
            human_prefix="Human",
            ai_prefix="Assistant",
        )

        assert result == "history"
        assert history_calls == [
            {"max_token_limit": 100, "human_prefix": "Human", "ai_prefix": "Assistant", "message_limit": 3}
        ]

        memory_config_no_window = MemoryConfig(window=MemoryConfig.WindowConfig(enabled=False, size=2))
        result = transform._get_history_messages_from_memory(
            memory=memory,
            memory_config=memory_config_no_window,
            max_token_limit=50,
        )

        assert result == "history"
        assert history_calls[1:] == [{"max_token_limit": 50}]

    def test_get_history_messages_list_from_memory_with_and_without_window(self, monkeypatch: pytest.MonkeyPatch):
        transform = PromptTransform()
        model_config = make_model_config(provider="openai", model="test-model", mode="chat")
        memory = make_token_buffer_memory(model_config)
        messages = [UserPromptMessage(content="m1"), AssistantPromptMessage(content="m2")]
        history_calls = []

        def get_history_prompt_messages(**kwargs):
            history_calls.append(kwargs)
            return messages

        monkeypatch.setattr(memory, "get_history_prompt_messages", get_history_prompt_messages)
        memory_config_window = MemoryConfig(window=MemoryConfig.WindowConfig(enabled=True, size=2))
        result = transform._get_history_messages_list_from_memory(memory, memory_config_window, 120)
        assert result == messages
        assert history_calls == [{"max_token_limit": 120, "message_limit": 2}]

        messages = [UserPromptMessage(content="only")]
        memory_config_no_window = MemoryConfig(window=MemoryConfig.WindowConfig(enabled=True, size=0))
        result = transform._get_history_messages_list_from_memory(memory, memory_config_no_window, 10)
        assert result == messages
        assert history_calls[1:] == [{"max_token_limit": 10, "message_limit": None}]

    def test_append_chat_histories_extends_prompt_messages(self, monkeypatch: pytest.MonkeyPatch):
        transform = PromptTransform()
        model_config = make_model_config(provider="openai", model="test-model", mode="chat")
        memory = make_token_buffer_memory(model_config)
        memory_config = MemoryConfig(window=MemoryConfig.WindowConfig(enabled=False, size=None))
        histories = [UserPromptMessage(content="h1"), AssistantPromptMessage(content="h2")]
        messages = [UserPromptMessage(content="p1")]
        history_calls = []

        def get_history_prompt_messages(**kwargs):
            history_calls.append(kwargs)
            return histories

        monkeypatch.setattr(memory, "get_history_prompt_messages", get_history_prompt_messages)
        monkeypatch.setattr(
            memory.model_instance.model_type_instance,
            "get_model_schema",
            lambda **_kwargs: model_config.model_schema,
        )

        result = transform._append_chat_histories(
            memory=memory,
            memory_config=memory_config,
            prompt_messages=messages,
            model_instance=memory.model_instance,
        )

        assert result is messages
        assert result == [UserPromptMessage(content="p1"), *histories]
        assert history_calls == [{"max_token_limit": 2000, "message_limit": None}]
