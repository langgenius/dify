from types import SimpleNamespace

import pytest
from pydantic import BaseModel

from core.workflow.human_input_adapter import (
    DeliveryMethodType,
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    EmailRecipients,
    WebAppDeliveryMethod,
    _WebAppDeliveryConfig,
    adapt_human_input_node_data_for_graph,
    adapt_node_config_for_graph,
    adapt_node_data_for_graph,
    is_human_input_webapp_enabled,
    parse_human_input_delivery_methods,
)
from graphon.enums import BuiltinNodeTypes
from graphon.nodes.base.variable_template_parser import VariableTemplateParser


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


def test_email_delivery_config_helpers_with_recipients_and_without_variable_pool() -> None:
    recipients = EmailRecipients(include_bound_group=True, items=[])
    config = EmailDeliveryConfig(
        recipients=EmailRecipients(include_bound_group=False, items=[]),
        subject="Subject",
        body="Open {{#url#}}",
    )

    updated = config.with_recipients(recipients)

    assert updated.recipients == recipients
    assert (
        EmailDeliveryConfig.render_body_template(body="Open {{#url#}}", url="https://example.com")
        == "Open https://example.com"
    )


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


def test_adapt_node_data_for_graph_only_rewrites_human_input_nodes() -> None:
    human_input = adapt_node_data_for_graph(
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
    other_node = adapt_node_data_for_graph({"type": "answer", "delivery_methods": "unchanged"})

    assert human_input["delivery_methods"][0]["config"]["recipients"]["include_bound_group"] is True
    assert other_node == {"type": "answer", "delivery_methods": "unchanged"}


def test_adapt_node_data_for_graph_migrates_legacy_tool_configurations() -> None:
    normalized = adapt_node_data_for_graph(
        {
            "type": BuiltinNodeTypes.TOOL,
            "tool_configurations": {
                "format": {"type": "mixed", "value": "%Y-%m-%d %H:%M:%S"},
                "timezone": {"type": "constant", "value": "UTC"},
                "query": {"type": "variable", "value": ["sys", "query"]},
            },
            "tool_parameters": {},
        }
    )

    assert normalized["tool_configurations"] == {
        "format": "%Y-%m-%d %H:%M:%S",
        "timezone": "UTC",
        "query": "{{#sys.query#}}",
    }
    assert normalized["tool_parameters"] == {
        "format": {"type": "mixed", "value": "%Y-%m-%d %H:%M:%S"},
        "timezone": {"type": "constant", "value": "UTC"},
        "query": {"type": "variable", "value": ["sys", "query"]},
    }


def test_adapt_node_data_for_graph_preserves_model_selector_top_level_configurations() -> None:
    normalized = adapt_node_data_for_graph(
        {
            "type": BuiltinNodeTypes.TOOL,
            "tool_configurations": {
                "vision_llm_model": {
                    "type": "constant",
                    "value": "",
                    "provider": "langgenius/tongyi/tongyi",
                    "model": "qwen3-vl-plus",
                    "model_type": "llm",
                    "mode": "chat",
                },
            },
        }
    )

    assert normalized["tool_configurations"] == {}
    assert normalized["tool_parameters"] == {
        "vision_llm_model": {
            "type": "constant",
            "value": {
                "provider": "langgenius/tongyi/tongyi",
                "model": "qwen3-vl-plus",
                "model_type": "llm",
                "mode": "chat",
            },
        }
    }


def test_adapt_node_data_for_graph_flattens_constant_model_selector_value() -> None:
    normalized = adapt_node_data_for_graph(
        {
            "type": BuiltinNodeTypes.TOOL,
            "tool_configurations": {
                "tts_model": {
                    "type": "constant",
                    "value": {
                        "provider": "langgenius/tongyi/tongyi",
                        "model": "qwen3-tts-flash",
                        "model_type": "tts",
                        "language": "Chinese",
                        "voice": "Cherry",
                    },
                },
            },
        }
    )

    assert normalized["tool_configurations"] == {}
    assert normalized["tool_parameters"] == {
        "tts_model": {
            "type": "constant",
            "value": {
                "provider": "langgenius/tongyi/tongyi",
                "model": "qwen3-tts-flash",
                "model_type": "tts",
                "language": "Chinese",
                "voice": "Cherry",
            },
        }
    }


def test_adapt_node_config_for_graph_rewrites_nested_node_data() -> None:
    normalized = adapt_node_config_for_graph(
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


def test_adapt_human_input_node_data_for_graph_accepts_models() -> None:
    class _NodeModel(BaseModel):
        delivery_methods: list[dict]

    normalized = adapt_human_input_node_data_for_graph(
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


def test_adapt_human_input_node_data_for_graph_rejects_non_mappings() -> None:
    with pytest.raises(TypeError, match="human-input node data must be a mapping"):
        adapt_human_input_node_data_for_graph(123)


def test_adapt_human_input_node_data_for_graph_preserves_non_mapping_methods() -> None:
    normalized = adapt_human_input_node_data_for_graph(
        {
            "delivery_methods": [
                "raw-method",
                {
                    "type": DeliveryMethodType.EMAIL,
                    "config": {
                        "recipients": {"items": "raw-items"},
                        "subject": "Subject",
                        "body": "Body",
                    },
                },
            ]
        }
    )

    assert normalized["delivery_methods"][0] == "raw-method"
    assert normalized["delivery_methods"][1]["config"]["recipients"]["items"] == "raw-items"


def test_adapt_human_input_node_data_for_graph_preserves_non_mapping_recipient_items() -> None:
    normalized = adapt_human_input_node_data_for_graph(
        {
            "delivery_methods": [
                {
                    "type": DeliveryMethodType.EMAIL,
                    "config": {
                        "recipients": {"items": ["raw-item"]},
                        "subject": "Subject",
                        "body": "Body",
                    },
                }
            ]
        }
    )

    assert normalized["delivery_methods"][0]["config"]["recipients"]["items"] == ["raw-item"]


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


def test_email_delivery_method_extracts_variable_selectors_skips_short_selectors(monkeypatch) -> None:
    method = EmailDeliveryMethod(
        enabled=True,
        config=EmailDeliveryConfig(
            recipients=EmailRecipients(include_bound_group=False, items=[]),
            subject="Subject",
            body="Body",
        ),
    )

    monkeypatch.setattr(
        VariableTemplateParser,
        "extract_variable_selectors",
        lambda self: [
            SimpleNamespace(value_selector=("single",)),
            SimpleNamespace(value_selector=("start", "name")),
        ],
    )

    assert method.extract_variable_selectors() == [["start", "name"]]


def test_webapp_delivery_method_uses_empty_selector_set() -> None:
    method = WebAppDeliveryMethod(enabled=True, config=_WebAppDeliveryConfig())

    assert method.extract_variable_selectors() == ()


def test_adapt_node_data_for_graph_rejects_non_mappings() -> None:
    with pytest.raises(TypeError, match="node data must be a mapping"):
        adapt_node_data_for_graph(123)


def test_adapt_node_config_for_graph_rejects_non_mapping_and_preserves_raw_data() -> None:
    with pytest.raises(TypeError, match="node config must be a mapping"):
        adapt_node_config_for_graph(123)

    assert adapt_node_config_for_graph({"data": "raw"}) == {"data": "raw"}


def test_adapt_node_data_for_graph_preserves_non_legacy_tool_configurations() -> None:
    normalized = adapt_node_data_for_graph(
        {
            "type": BuiltinNodeTypes.TOOL,
            "tool_configurations": {
                "raw": 1,
                "unsupported": {"type": "expression", "value": "{{#sys.query#}}"},
            },
        }
    )

    assert normalized["tool_configurations"] == {
        "raw": 1,
        "unsupported": {"type": "expression", "value": "{{#sys.query#}}"},
    }
    assert "tool_parameters" not in normalized


def test_adapt_node_data_for_graph_keeps_unflattenable_legacy_tool_values_in_parameters() -> None:
    normalized = adapt_node_data_for_graph(
        {
            "type": BuiltinNodeTypes.TOOL,
            "tool_configurations": {
                "query": {"type": "variable", "value": ["sys", 1]},
            },
        }
    )

    assert normalized["tool_parameters"] == {"query": {"type": "variable", "value": ["sys", 1]}}
    assert normalized["tool_configurations"] == {}


def test_adapt_node_data_for_graph_preserves_nodes_without_mapping_tool_configurations() -> None:
    normalized = adapt_node_data_for_graph(
        {
            "type": BuiltinNodeTypes.TOOL,
            "tool_configurations": "raw-tool-configurations",
        }
    )

    assert normalized["tool_configurations"] == "raw-tool-configurations"
