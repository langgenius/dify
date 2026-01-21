from core.workflow.nodes.human_input.entities import EmailDeliveryConfig, EmailRecipients
from core.workflow.runtime import VariablePool


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


def test_render_body_template_replaces_variable_values():
    config = EmailDeliveryConfig(
        recipients=EmailRecipients(),
        subject="Subject",
        body="Hello {{#node1.value#}} {{#url#}}",
    )
    variable_pool = VariablePool()
    variable_pool.add(["node1", "value"], "World")

    result = config.render_body_template(body=config.body, url="https://example.com", variable_pool=variable_pool)

    assert result == "Hello World https://example.com"
