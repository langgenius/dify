from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolEntity,
    ToolIdentity,
    ToolInvokeMessage,
)


def _make_identity() -> ToolIdentity:
    return ToolIdentity(
        author="author",
        name="tool",
        label=I18nObject(en_US="Label"),
        provider="builtin",
    )


def test_log_message_metadata_none_defaults_to_empty_dict():
    log_message = ToolInvokeMessage.LogMessage(
        id="log-1",
        label="Log entry",
        status=ToolInvokeMessage.LogMessage.LogStatus.START,
        data={},
        metadata=None,
    )

    assert log_message.metadata == {}


def test_tool_entity_output_schema_none_defaults_to_empty_dict():
    entity = ToolEntity(identity=_make_identity(), output_schema=None)

    assert entity.output_schema == {}


def test_tool_entity_parameters_keep_show_on_from_yaml_dict():
    """Builtin/plugin YAML may declare ``show_on``; it must survive ToolEntity validation for API responses."""
    raw = {
        "identity": {
            "author": "author",
            "name": "t",
            "label": {"en_US": "T", "zh_Hans": "T"},
            "provider": "builtin",
        },
        "parameters": [
            {
                "name": "mode",
                "label": {"en_US": "Mode", "zh_Hans": "Mode"},
                "type": "string",
                "required": True,
                "form": "form",
                "human_description": {"en_US": "", "zh_Hans": ""},
                "show_on": [{"variable": "other", "value": "x"}],
                "options": [
                    {
                        "value": "a",
                        "label": {"en_US": "A", "zh_Hans": "A"},
                        "show_on": [{"variable": "mode", "value": "b"}],
                    },
                ],
            },
        ],
    }
    entity = ToolEntity.model_validate(raw)
    param = entity.parameters[0]
    assert len(param.show_on) == 1
    assert param.show_on[0].variable == "other"
    assert param.show_on[0].value == "x"
    assert len(param.options[0].show_on) == 1
    assert param.options[0].show_on[0].variable == "mode"
    dumped = param.model_dump(mode="json")
    assert dumped["show_on"] == [{"variable": "other", "value": "x"}]
    assert dumped["options"][0]["show_on"] == [{"variable": "mode", "value": "b"}]
