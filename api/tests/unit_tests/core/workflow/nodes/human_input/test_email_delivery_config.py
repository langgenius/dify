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
