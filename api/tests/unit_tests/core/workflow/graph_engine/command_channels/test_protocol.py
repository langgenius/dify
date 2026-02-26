from __future__ import annotations

from core.workflow.graph_engine.protocols.command_channel import CommandChannel


def test_command_channel_protocol_stubs_are_callable() -> None:
    dummy = object()

    assert CommandChannel.fetch_commands(dummy) is None
    assert CommandChannel.send_command(dummy, command=object()) is None
