"""Slack card assessment enforces the complete outgoing Markdown payload limit."""

import pytest

from core.human_input_v2.im_integration.adapters.entities import (
    CorrelationToken,
    DynamicCardMessagingError,
    MessageAccepted,
    ProviderUserId,
)
from core.human_input_v2.resolved_form import MarkdownFragment, ParagraphInput
from tests.unit_tests.core.human_input_v2.im_provider.test_slack_sdk_boundary import (
    _adapter,
    _custom_intent,
    _SlackApiServer,
)

pytest_plugins = ("tests.unit_tests.core.human_input_v2.im_provider.test_slack_sdk_boundary",)


@pytest.mark.parametrize(
    ("lengths", "representable"),
    [
        ((12_000,), True),
        ((6_000, 6_000), True),
        ((6_000, 6_001), False),
        ((7_000, 7_000), False),
    ],
)
def test_card_markdown_limit_applies_to_all_fragments(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: _SlackApiServer,
    lengths: tuple[int, ...],
    representable: bool,
) -> None:
    """Assess without I/O; preserve accepted content and reject oversized sends before I/O."""
    adapter, _client = _adapter(monkeypatch, slack_api_server)
    paragraphs = tuple(MarkdownFragment(text="审" * length) for length in lengths)
    intent = _custom_intent(
        blocks=(paragraphs[0], ParagraphInput(output_variable_name="note", default_value="Approved"), *paragraphs[1:])
    )

    assert adapter.dynamic_card_messaging.assess(intent).representable is representable
    assert slack_api_server.state.requests == []

    if representable:
        slack_api_server.state.enqueue(
            "chat.postMessage", {"ok": True, "channel": "sanitized-channel", "ts": "1000.000001"}
        )
        accepted = adapter.dynamic_card_messaging.send_card(
            ProviderUserId("sanitized-user"), intent, CorrelationToken("sanitized-token")
        )
        assert isinstance(accepted, MessageAccepted)
        requests = slack_api_server.state.requests_for("chat.postMessage")
        assert len(requests) == 1
        blocks = requests[0].parameters()["blocks"]
        assert isinstance(blocks, list)
        assert [block["text"] for block in blocks if block["type"] == "markdown"] == [
            paragraph.text for paragraph in paragraphs
        ]
    else:
        with pytest.raises(DynamicCardMessagingError):
            adapter.dynamic_card_messaging.send_card(
                ProviderUserId("sanitized-user"), intent, CorrelationToken("sanitized-token")
            )
        assert slack_api_server.state.requests == []
    adapter.close()
