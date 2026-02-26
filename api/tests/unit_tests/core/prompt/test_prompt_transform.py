from types import SimpleNamespace
from unittest.mock import MagicMock

from core.model_runtime.entities.model_entities import ModelPropertyKey
from core.prompt.prompt_transform import PromptTransform


class TestPromptTransform:
    def test_calculate_rest_token_defaults_when_context_size_missing(self):
        transform = PromptTransform()
        model_config = SimpleNamespace(
            model_schema=SimpleNamespace(model_properties={}, parameter_rules=[]),
            provider_model_bundle=object(),
            model="test-model",
            parameters={},
        )

        rest = transform._calculate_rest_token([], model_config)

        assert rest == 2000

    def test_calculate_rest_token_uses_max_tokens_and_clamps_to_zero(self, monkeypatch):
        transform = PromptTransform()

        class FakeModelInstance:
            def __init__(self, provider_model_bundle, model):
                self.provider_model_bundle = provider_model_bundle
                self.model = model

            def get_llm_num_tokens(self, prompt_messages):
                return 95

        monkeypatch.setattr("core.prompt.prompt_transform.ModelInstance", FakeModelInstance)

        parameter_rule = SimpleNamespace(name="max_tokens", use_template=None)
        model_config = SimpleNamespace(
            model_schema=SimpleNamespace(
                model_properties={ModelPropertyKey.CONTEXT_SIZE: 100},
                parameter_rules=[parameter_rule],
            ),
            provider_model_bundle=object(),
            model="test-model",
            parameters={"max_tokens": 50},
        )

        rest = transform._calculate_rest_token([SimpleNamespace()], model_config)

        assert rest == 0

    def test_calculate_rest_token_supports_use_template_parameter(self, monkeypatch):
        transform = PromptTransform()

        class FakeModelInstance:
            def __init__(self, provider_model_bundle, model):
                self.provider_model_bundle = provider_model_bundle
                self.model = model

            def get_llm_num_tokens(self, prompt_messages):
                return 20

        monkeypatch.setattr("core.prompt.prompt_transform.ModelInstance", FakeModelInstance)

        parameter_rule = SimpleNamespace(name="generation_max", use_template="max_tokens")
        model_config = SimpleNamespace(
            model_schema=SimpleNamespace(
                model_properties={ModelPropertyKey.CONTEXT_SIZE: 200},
                parameter_rules=[parameter_rule],
            ),
            provider_model_bundle=object(),
            model="test-model",
            parameters={"max_tokens": 30},
        )

        rest = transform._calculate_rest_token([SimpleNamespace()], model_config)

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

        monkeypatch.setattr(transform, "_calculate_rest_token", lambda prompt_messages, model_config: 99)
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
