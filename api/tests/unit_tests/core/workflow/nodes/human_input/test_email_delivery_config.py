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
    assert "<a" not in rendered
    assert "onclick" not in rendered
    assert "javascript:" not in rendered
    assert "Click" in rendered


def test_render_markdown_body_sanitizes_markdown_link_with_javascript_href():
    rendered = EmailDeliveryConfig.render_markdown_body("[bad](javascript:alert(1)) and [ok](https://example.com)")

    assert "javascript:" not in rendered
    assert "<a>bad</a>" in rendered
    assert '<a href="https://example.com">ok</a>' in rendered


def test_render_markdown_body_does_not_allow_raw_html_tags():
    rendered = EmailDeliveryConfig.render_markdown_body("<b>raw html</b> and **markdown**")

    assert "<b>" not in rendered
    assert "raw html" in rendered
    assert "<strong>markdown</strong>" in rendered


def test_render_markdown_body_supports_table_syntax():
    rendered = EmailDeliveryConfig.render_markdown_body("| h1 | h2 |\n| --- | ---: |\n| v1 | v2 |")

    assert "<table>" in rendered
    assert "<thead>" in rendered
    assert "<tbody>" in rendered
    assert 'align="right"' in rendered
    assert "style=" not in rendered


def test_sanitize_subject_removes_crlf():
    sanitized = EmailDeliveryConfig.sanitize_subject("Notice\r\nBCC:attacker@example.com")

    assert "\r" not in sanitized
    assert "\n" not in sanitized
    assert sanitized == "Notice BCC:attacker@example.com"


def test_sanitize_subject_removes_html_tags():
    sanitized = EmailDeliveryConfig.sanitize_subject("<b>Alert</b><img src=x onerror=1>")

    assert "<" not in sanitized
    assert ">" not in sanitized
    assert sanitized == "Alert"
