import pytest

from models.human_input import RecipientType


@pytest.mark.parametrize(
    ("recipient_type", "expected_label"),
    [
        (RecipientType.EMAIL_MEMBER, "email"),
        (RecipientType.EMAIL_EXTERNAL, "email"),
        (RecipientType.CONSOLE, "console"),
        (RecipientType.BACKSTAGE, "console"),
        (RecipientType.STANDALONE_WEB_APP, "web_app"),
    ],
)
def test_approval_channel_label_collapses_delivery_types(recipient_type: RecipientType, expected_label: str) -> None:
    # Both email types collapse to "email" and console/backstage to "console":
    # the user-facing approval channel, not the internal recipient type.
    assert recipient_type.approval_channel_label == expected_label
