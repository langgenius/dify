from core.workflow.nodes.human_input.entities import EmailDeliveryConfig, EmailRecipients


def test_replace_url_placeholder_with_value():
    config = EmailDeliveryConfig(
        recipients=EmailRecipients(),
        subject="Subject",
        body="Click here {{#url#}} to open.",
    )

    result = config.body_with_url("https://example.com/link")

    assert result == "Click here https://example.com/link to open."


def test_replace_url_placeholder_missing_value():
    config = EmailDeliveryConfig(
        recipients=EmailRecipients(),
        subject="Subject",
        body="No link {{#url#}} available.",
    )

    result = config.body_with_url(None)

    assert result == "No link  available."
