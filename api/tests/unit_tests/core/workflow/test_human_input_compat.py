from types import SimpleNamespace

from graphon.enums import BuiltinNodeTypes
from pydantic import BaseModel

from core.workflow.human_input_compat import (
    DeliveryMethodType,
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    EmailRecipients,
    WebAppDeliveryMethod,
    _WebAppDeliveryConfig,
    is_human_input_webapp_enabled,
    normalize_human_input_node_data_for_graph,
    normalize_node_config_for_graph,
    normalize_node_data_for_graph,
    parse_human_input_delivery_methods,
)


def test_email_delivery_config_helpers_render_and_sanitize_text() -> None:
    variable_pool = SimpleNamespace(
        convert_template=lambda body: SimpleNamespace(text=body.replace("{{#node.value#}}", "42"))
    )

    rendered = EmailDeliveryConfig.render_body_template(
        body="Open {{#url#}} and use {{#node.value#}}",
        url="https://example.com",
        variable_pool=variable_pool,
    )
    sanitized = EmailDeliveryConfig.sanitize_subject("Hello\r\n<script>alert(1)</script> Team")
    html = EmailDeliveryConfig.render_markdown_body(
        "**Hello** <script>alert(1)</script> [mail](mailto:test@example.com)"
    )

    assert rendered == "Open https://example.com and use 42"
    assert sanitized == "Hello alert(1) Team"
    assert "<strong>Hello</strong>" in html
    assert "<script>" not in html
    assert "mailto:test@example.com" in html


def test_parse_human_input_delivery_methods_normalizes_legacy_recipient_keys() -> None:
    methods = parse_human_input_delivery_methods(
        {
            "delivery_methods": [
                {
                    "type": DeliveryMethodType.EMAIL,
                    "config": {
                        "recipients": {
                            "whole_workspace": True,
                            "items": [
                                {"type": "member", "user_id": "user-1"},
                                {"type": "external", "email": "external@example.com"},
                            ],
                        },
                        "subject": "Subject",
                        "body": "Body",
                    },
                }
            ]
        }
    )

    assert len(methods) == 1
    assert methods[0].config.recipients.include_bound_group is True
    assert methods[0].config.recipients.items[0].reference_id == "user-1"
    assert methods[0].config.recipients.items[1].email == "external@example.com"


def test_parse_human_input_delivery_methods_returns_empty_for_non_lists() -> None:
    assert parse_human_input_delivery_methods({"delivery_methods": None}) == []


def test_is_human_input_webapp_enabled_checks_enabled_delivery_methods() -> None:
    assert (
        is_human_input_webapp_enabled(
            {
                "delivery_methods": [
                    {"type": DeliveryMethodType.WEBAPP, "enabled": True, "config": {}},
                    {
                        "type": DeliveryMethodType.EMAIL,
                        "enabled": True,
                        "config": {
                            "recipients": {"include_bound_group": False, "items": []},
                            "subject": "Subject",
                            "body": "Body",
                        },
                    },
                ]
            }
        )
        is True
    )
    assert (
        is_human_input_webapp_enabled(
            {"delivery_methods": [{"type": DeliveryMethodType.WEBAPP, "enabled": False, "config": {}}]}
        )
        is False
    )


def test_normalize_node_data_for_graph_only_rewrites_human_input_nodes() -> None:
    human_input = normalize_node_data_for_graph(
        {
            "type": BuiltinNodeTypes.HUMAN_INPUT,
            "delivery_methods": [
                {
                    "type": DeliveryMethodType.EMAIL,
                    "config": {
                        "recipients": {"whole_workspace": True, "items": [{"type": "member", "user_id": "user-1"}]},
                        "subject": "Subject",
                        "body": "Body",
                    },
                }
            ],
        }
    )
    other_node = normalize_node_data_for_graph({"type": "answer", "delivery_methods": "unchanged"})

    assert human_input["delivery_methods"][0]["config"]["recipients"]["include_bound_group"] is True
    assert other_node == {"type": "answer", "delivery_methods": "unchanged"}


def test_normalize_node_config_for_graph_rewrites_nested_node_data() -> None:
    normalized = normalize_node_config_for_graph(
        {
            "data": {
                "type": BuiltinNodeTypes.HUMAN_INPUT,
                "delivery_methods": [
                    {
                        "type": DeliveryMethodType.EMAIL,
                        "config": {
                            "recipients": {"whole_workspace": True, "items": [{"type": "member", "user_id": "user-1"}]},
                            "subject": "Subject",
                            "body": "Body",
                        },
                    }
                ],
            }
        }
    )

    recipients = normalized["data"]["delivery_methods"][0]["config"]["recipients"]
    assert recipients["include_bound_group"] is True
    assert recipients["items"][0]["reference_id"] == "user-1"


def test_normalize_human_input_node_data_for_graph_accepts_models() -> None:
    class _NodeModel(BaseModel):
        delivery_methods: list[dict]

    normalized = normalize_human_input_node_data_for_graph(
        _NodeModel(
            delivery_methods=[
                {
                    "type": DeliveryMethodType.WEBAPP,
                    "enabled": True,
                    "config": _WebAppDeliveryConfig().model_dump(mode="python"),
                }
            ]
        )
    )

    assert normalized["delivery_methods"][0]["type"] == DeliveryMethodType.WEBAPP


def test_email_delivery_method_extracts_variable_selectors() -> None:
    method = EmailDeliveryMethod(
        enabled=True,
        config=EmailDeliveryConfig(
            recipients=EmailRecipients(include_bound_group=False, items=[]),
            subject="Subject",
            body="Hello {{#start.name#}} and ignore {{#single#}}",
        ),
    )

    assert method.extract_variable_selectors() == [["start", "name"]]


def test_webapp_delivery_method_uses_empty_selector_set() -> None:
    method = WebAppDeliveryMethod(enabled=True, config=_WebAppDeliveryConfig())

    assert method.extract_variable_selectors() == ()
