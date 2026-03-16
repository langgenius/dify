from dify_graph.nodes.human_input.entities import EmailDeliveryConfig, EmailRecipients
from dify_graph.runtime import VariablePool


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


def test_render_markdown_body_renders_markdown_to_html():
    rendered = EmailDeliveryConfig.render_markdown_body("**Bold** and [link](https://example.com)")

    assert "<strong>Bold</strong>" in rendered
    assert '<a href="https://example.com">link</a>' in rendered


def test_render_markdown_body_sanitizes_unsafe_html():
    rendered = EmailDeliveryConfig.render_markdown_body(
        '<script>alert("xss")</script><a href="javascript:alert(1)" onclick="alert(2)">Click</a>'
    )

    assert "<script" not in rendered
    assert "onclick" not in rendered
    assert "javascript:" not in rendered
    assert "Click" in rendered
