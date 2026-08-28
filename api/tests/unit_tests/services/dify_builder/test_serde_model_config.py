from core.dify_builder.models import DifyBuilderContext
from services.dify_builder.serde import context_from_dict, context_to_dict


def test_model_config_defaults_empty():
    fc = DifyBuilderContext()
    assert fc.model_config == {}


def test_model_config_round_trips():
    fc = DifyBuilderContext(model_config={"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {"temperature": 0.2}})
    restored = context_from_dict(context_to_dict(fc))
    assert restored.model_config == {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {"temperature": 0.2}}


def test_model_config_absent_in_old_row_defaults_empty():
    # An older persisted dict (pre-this-field) still deserializes.
    restored = context_from_dict({"goal_text": "x"})
    assert restored.model_config == {}
