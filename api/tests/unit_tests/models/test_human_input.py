import pytest

from models.human_input import ApprovalChannel, RecipientType


@pytest.mark.parametrize(
    ("recipient_type", "expected_channel"),
    [
        (RecipientType.EMAIL_MEMBER, ApprovalChannel.EMAIL),
        (RecipientType.EMAIL_EXTERNAL, ApprovalChannel.EMAIL),
        (RecipientType.CONSOLE, ApprovalChannel.CONSOLE),
        (RecipientType.BACKSTAGE, ApprovalChannel.CONSOLE),
        (RecipientType.STANDALONE_WEB_APP, ApprovalChannel.WEB_APP),
    ],
)
def test_approval_channel_collapses_delivery_types(
    recipient_type: RecipientType, expected_channel: ApprovalChannel
) -> None:
    # Both email types collapse to EMAIL and console/backstage to CONSOLE:
    # the user-facing approval channel, not the internal recipient type.
    assert recipient_type.approval_channel == expected_channel
