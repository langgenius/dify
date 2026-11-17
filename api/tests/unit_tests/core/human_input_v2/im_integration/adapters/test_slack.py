"""Slack card assessment enforces the complete outgoing Markdown payload limit."""

import pytest

from core.human_input_v2.im_integration.adapters.entities import (
    CorrelationToken,
    DynamicCardMessagingError,
    MessageAccepted,
    ProviderUserId,
)
from core.human_input_v2.resolved_form import MarkdownFragment, ParagraphInput
from tests.helpers.unit.core.human_input_v2.slack import (
    SlackApiServer,
    make_slack_adapter,
    make_slack_form,
)


@pytest.mark.parametrize(
    ("lengths", "representable", "expected_total_length"),
    [
        ((12_000,), True, 12_000),
        ((6_000, 6_000), True, 12_000),
        ((6_000, 6_001), False, 12_001),
        ((7_000, 7_000), False, 14_000),
        ((7_000, 7_000, 7_000), False, 21_000),
    ],
)
def test_card_markdown_limit_applies_to_all_fragments(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: SlackApiServer,
    lengths: tuple[int, ...],
    representable: bool,
    expected_total_length: int,
) -> None:
    """Assess without I/O; preserve accepted content and reject oversized sends before I/O."""
    adapter, _client = make_slack_adapter(monkeypatch, slack_api_server)
    paragraphs = tuple(MarkdownFragment(text="审" * length) for length in lengths)
    intent = make_slack_form(
        blocks=(
            paragraphs[0],
            ParagraphInput(output_variable_name="note", resolved_default_value="Approved"),
            *paragraphs[1:],
        )
    )

    assessment = adapter.dynamic_card_messaging.assess(intent)
    assert assessment.representable is representable
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
        assert assessment.reason is not None
        assert f"total text length of {expected_total_length} characters" in assessment.reason
        assert "maximum: 12000 characters" in assessment.reason
        with pytest.raises(DynamicCardMessagingError, match=rf"{expected_total_length}.*12000"):
            adapter.dynamic_card_messaging.send_card(
                ProviderUserId("sanitized-user"), intent, CorrelationToken("sanitized-token")
            )
        assert slack_api_server.state.requests == []
    adapter.close()
