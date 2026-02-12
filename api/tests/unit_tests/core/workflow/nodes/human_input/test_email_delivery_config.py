from core.workflow.nodes.human_input.entities import EmailDeliveryConfig, EmailRecipients
from core.workflow.runtime import VariablePool


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


def test_render_body_template_converts_newlines_for_plain_text():
    config = EmailDeliveryConfig(
        recipients=EmailRecipients(),
        subject="Subject",
        body="Line1\n{{#url#}}\nLine3",
    )

    result = config.render_body_template(body=config.body, url="https://example.com", variable_pool=None)

    assert result == "Line1<br>https://example.com<br>Line3"


def test_render_body_template_preserves_html():
    config = EmailDeliveryConfig(
        recipients=EmailRecipients(),
        subject="Subject",
        body="Line1<br>Line2\n{{#url#}}",
    )

    result = config.render_body_template(body=config.body, url="https://example.com", variable_pool=None)

    assert result == "Line1<br>Line2\nhttps://example.com"


def test_render_body_template_escapes_plain_text_html():
    config = EmailDeliveryConfig(
        recipients=EmailRecipients(),
        subject="Subject",
        body="Hello <script>alert(1)</script>\n{{#url#}}",
    )

    result = config.render_body_template(body=config.body, url="https://example.com", variable_pool=None)

    assert result == "Hello &lt;script&gt;alert(1)&lt;/script&gt;<br>https://example.com"
