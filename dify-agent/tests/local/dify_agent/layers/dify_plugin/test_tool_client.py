"""Regression tests for DifyPluginToolInvokeMessage validation.

Agent V2 talks to the plugin daemon through its own copy of the tool-stream
message model. A tool that emits an operation log via the plugin SDK's
``create_log_message`` leaves ``metadata`` unset, and the daemon serializes it
onto the wire as ``metadata: null``. The canonical core model
(``core.tools.entities.tool_entities.ToolInvokeMessage.LogMessage``) normalizes
that null to ``{}``; Agent V2's copy must do the same, otherwise every such log
message collapses the whole ``message`` union and the tool invocation fails with
``N validation errors for DifyPluginToolInvokeMessage``.

See langgenius/dify-official-plugins#3512.
"""

from __future__ import annotations

from dify_agent.layers.dify_plugin.tool_client import DifyPluginToolInvokeMessage


def test_log_message_with_null_metadata_normalizes_to_empty_dict() -> None:
    """A LogMessage whose ``metadata`` is null must validate, not raise.

    This is the exact wire shape produced when a plugin tool calls
    ``create_log_message(label=..., data=..., status=...)`` without passing
    ``metadata`` (the SDK default), e.g. the Google Calendar tool.
    """
    message = DifyPluginToolInvokeMessage.model_validate(
        {
            "type": "log",
            "message": {
                "id": "log-1",
                "label": "Search Events Operation",
                "status": "success",
                "data": {"calendar_id": "primary"},
                "metadata": None,
            },
        }
    )

    assert isinstance(message.message, DifyPluginToolInvokeMessage.LogMessage)
    assert message.message.metadata == {}


def test_log_message_with_omitted_metadata_still_validates() -> None:
    """Omitting ``metadata`` entirely must also validate to an empty dict."""
    message = DifyPluginToolInvokeMessage.model_validate(
        {
            "type": "log",
            "message": {
                "id": "log-2",
                "label": "Fetching Top Stories",
                "status": "success",
                "data": {"limit": 10},
            },
        }
    )

    assert isinstance(message.message, DifyPluginToolInvokeMessage.LogMessage)
    assert message.message.metadata == {}
