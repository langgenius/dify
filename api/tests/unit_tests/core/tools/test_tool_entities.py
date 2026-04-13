from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolEntity, ToolIdentity, ToolInvokeMessage


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
