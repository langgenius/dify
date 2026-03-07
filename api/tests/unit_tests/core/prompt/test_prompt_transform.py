from types import SimpleNamespace
from unittest.mock import MagicMock

from core.prompt.prompt_transform import PromptTransform
from dify_graph.model_runtime.entities.model_entities import ModelPropertyKey

# from core.app.app_config.entities import ModelConfigEntity
# from core.entities.provider_configuration import ProviderConfiguration, ProviderModelBundle
# from dify_graph.model_runtime.entities.message_entities import UserPromptMessage
# from dify_graph.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey, ParameterRule
# from dify_graph.model_runtime.entities.provider_entities import ProviderEntity
# from dify_graph.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
# from core.prompt.prompt_transform import PromptTransform


class TestPromptTransform:
    def test_calculate_rest_token_defaults_when_context_size_missing(self):
        transform = PromptTransform()
        fake_model_instance = SimpleNamespace(parameters={}, get_llm_num_tokens=lambda _: 0)
        fake_model_schema = SimpleNamespace(model_properties={}, parameter_rules=[])
        transform._resolve_model_runtime = MagicMock(return_value=(fake_model_instance, fake_model_schema))
        model_config = SimpleNamespace(
            model_schema=SimpleNamespace(model_properties={}, parameter_rules=[]),
            provider_model_bundle=object(),
            model="test-model",
            parameters={},
        )

        rest = transform._calculate_rest_token([], model_config=model_config)

        assert rest == 2000

    def test_calculate_rest_token_uses_max_tokens_and_clamps_to_zero(self):
        transform = PromptTransform()

        parameter_rule = SimpleNamespace(name="max_tokens", use_template=None)
        fake_model_instance = SimpleNamespace(parameters={"max_tokens": 50}, get_llm_num_tokens=lambda _: 95)
        fake_model_schema = SimpleNamespace(
            model_properties={ModelPropertyKey.CONTEXT_SIZE: 100},
            parameter_rules=[parameter_rule],
        )
        transform._resolve_model_runtime = MagicMock(return_value=(fake_model_instance, fake_model_schema))
        model_config = SimpleNamespace(
            model_schema=SimpleNamespace(
                model_properties={ModelPropertyKey.CONTEXT_SIZE: 100},
                parameter_rules=[parameter_rule],
            ),
            provider_model_bundle=object(),
            model="test-model",
            parameters={"max_tokens": 50},
        )

        rest = transform._calculate_rest_token([SimpleNamespace()], model_config=model_config)

        assert rest == 0

    def test_calculate_rest_token_supports_use_template_parameter(self):
        transform = PromptTransform()

        parameter_rule = SimpleNamespace(name="generation_max", use_template="max_tokens")
        fake_model_instance = SimpleNamespace(parameters={"max_tokens": 30}, get_llm_num_tokens=lambda _: 20)
        fake_model_schema = SimpleNamespace(
            model_properties={ModelPropertyKey.CONTEXT_SIZE: 200},
            parameter_rules=[parameter_rule],
        )
        transform._resolve_model_runtime = MagicMock(return_value=(fake_model_instance, fake_model_schema))
        model_config = SimpleNamespace(
            model_schema=SimpleNamespace(
                model_properties={ModelPropertyKey.CONTEXT_SIZE: 200},
                parameter_rules=[parameter_rule],
            ),
            provider_model_bundle=object(),
            model="test-model",
            parameters={"max_tokens": 30},
        )

        rest = transform._calculate_rest_token([SimpleNamespace()], model_config=model_config)

        assert rest == 150

    def test_get_history_messages_from_memory_with_and_without_window(self):
        transform = PromptTransform()
        memory = MagicMock()
        memory.get_history_prompt_text.return_value = "history"

        memory_config_with_window = SimpleNamespace(window=SimpleNamespace(enabled=True, size=3))
        result = transform._get_history_messages_from_memory(
            memory=memory,
            memory_config=memory_config_with_window,
            max_token_limit=100,
            human_prefix="Human",
            ai_prefix="Assistant",
        )

        assert result == "history"
        memory.get_history_prompt_text.assert_called_with(
            max_token_limit=100,
            human_prefix="Human",
            ai_prefix="Assistant",
            message_limit=3,
        )

        memory.reset_mock()
        memory_config_no_window = SimpleNamespace(window=SimpleNamespace(enabled=False, size=2))
        transform._get_history_messages_from_memory(
            memory=memory,
            memory_config=memory_config_no_window,
            max_token_limit=50,
        )
        memory.get_history_prompt_text.assert_called_with(max_token_limit=50)

    def test_get_history_messages_list_from_memory_with_and_without_window(self):
        transform = PromptTransform()
        memory = MagicMock()
        memory.get_history_prompt_messages.return_value = ["m1", "m2"]

        memory_config_window = SimpleNamespace(window=SimpleNamespace(enabled=True, size=2))
        result = transform._get_history_messages_list_from_memory(memory, memory_config_window, 120)
        assert result == ["m1", "m2"]
        memory.get_history_prompt_messages.assert_called_with(max_token_limit=120, message_limit=2)

        memory.reset_mock()
        memory.get_history_prompt_messages.return_value = ["only"]
        memory_config_no_window = SimpleNamespace(window=SimpleNamespace(enabled=True, size=0))
        result = transform._get_history_messages_list_from_memory(memory, memory_config_no_window, 10)
        assert result == ["only"]
        memory.get_history_prompt_messages.assert_called_with(max_token_limit=10, message_limit=None)

    def test_append_chat_histories_extends_prompt_messages(self, monkeypatch):
        transform = PromptTransform()
        memory = MagicMock()
        memory_config = SimpleNamespace(window=SimpleNamespace(enabled=False, size=None))

        monkeypatch.setattr(transform, "_calculate_rest_token", lambda prompt_messages, **kwargs: 99)
        monkeypatch.setattr(
            transform,
            "_get_history_messages_list_from_memory",
            lambda memory, memory_config, max_token_limit: ["h1", "h2"],
        )

        result = transform._append_chat_histories(
            memory=memory,
            memory_config=memory_config,
            prompt_messages=["p1"],
            model_config=SimpleNamespace(),
        )

        assert result == ["p1", "h1", "h2"]
