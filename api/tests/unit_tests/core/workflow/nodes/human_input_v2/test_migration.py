import inspect
import json
from collections.abc import Sequence
from types import MappingProxyType
from typing import get_type_hints
from uuid import UUID

import pytest
from pydantic import TypeAdapter, ValidationError

from core.workflow.nodes.human_input_v2 import migration as migration_module
from core.workflow.nodes.human_input_v2.migration import (
    LegacyHumanInputNodeData,
    convert_legacy_human_input_node_data,
)
from graphon.enums import BuiltinNodeTypes

_EMAIL_METHOD_ID = "11111111-1111-4111-8111-111111111111"
_WEBAPP_METHOD_ID = "22222222-2222-4222-8222-222222222222"
_SECOND_EMAIL_METHOD_ID = "33333333-3333-4333-8333-333333333333"


def test_canonical_v1_models_are_exposed() -> None:
    expected_model_names = {
        "LegacyDeliveryChannelConfig",
        "LegacyEmailDeliveryMethod",
        "LegacyEmailRecipients",
        "LegacyExternalRecipient",
        "LegacyFormInput",
        "LegacyFormInputDefault",
        "LegacyMemberRecipient",
        "LegacyUserAction",
        "LegacyWebAppDeliveryMethod",
    }

    assert expected_model_names <= set(dir(migration_module))


def test_canonical_v1_schema_matches_historical_base_form_and_action_fields() -> None:
    node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Manager approval",
            "desc": "Preserve historical fields",
            "version": "1",
            "error_strategy": "fail-branch",
            "default_value": [{"key": "reason", "type": "string", "value": "fallback"}],
            "retry_config": {"retry_enabled": True, "max_retries": 2, "retry_interval": 1000},
            "delivery_methods": [{"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}}],
            "form_content": "Decision: {{#$output.reason#}}",
            "inputs": [
                {
                    "type": "text_input",
                    "output_variable_name": "reason",
                    "default": {"type": "variable", "selector": ["start", "reason"], "value": "fallback"},
                }
            ],
            "user_actions": [{"id": "approve", "title": "Approve", "button_style": "primary"}],
            "timeout": 2,
            "timeout_unit": "day",
        }
    )

    assert set(LegacyHumanInputNodeData.model_fields) == {
        "title",
        "desc",
        "version",
        "error_strategy",
        "default_value",
        "retry_config",
        "delivery_methods",
        "form_content",
        "inputs",
        "user_actions",
        "timeout",
        "timeout_unit",
    }
    assert isinstance(node_data.inputs[0], migration_module.LegacyFormInput)
    assert isinstance(node_data.inputs[0].default, migration_module.LegacyFormInputDefault)
    assert isinstance(node_data.user_actions[0], migration_module.LegacyUserAction)
    assert node_data.model_dump(mode="json")["inputs"] == [
        {
            "type": "text_input",
            "output_variable_name": "reason",
            "default": {"type": "variable", "selector": ["start", "reason"], "value": "fallback"},
        }
    ]


def test_canonical_v1_form_default_preserves_historical_selector_annotation() -> None:
    annotations = get_type_hints(migration_module.LegacyFormInputDefault)

    assert annotations["selector"] == Sequence[str]


def test_canonical_v1_delivery_and_recipient_discriminators_are_exact() -> None:
    email_method = TypeAdapter(migration_module.LegacyDeliveryChannelConfig).validate_python(
        {
            "id": _EMAIL_METHOD_ID,
            "type": "email",
            "config": {
                "recipients": {
                    "whole_workspace": True,
                    "items": [
                        {"type": "member", "user_id": "member-1"},
                        {"type": "external", "email": "approver@example.com"},
                    ],
                },
                "subject": "Review",
                "body": "Please review",
            },
        }
    )
    webapp_method = TypeAdapter(migration_module.LegacyDeliveryChannelConfig).validate_python(
        {"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}}
    )

    assert isinstance(email_method, migration_module.LegacyEmailDeliveryMethod)
    assert isinstance(email_method.id, UUID)
    assert isinstance(email_method.config.recipients, migration_module.LegacyEmailRecipients)
    assert isinstance(email_method.config.recipients.items[0], migration_module.LegacyMemberRecipient)
    assert isinstance(email_method.config.recipients.items[1], migration_module.LegacyExternalRecipient)
    assert isinstance(webapp_method, migration_module.LegacyWebAppDeliveryMethod)
    assert set(migration_module.LegacyEmailRecipients.model_fields) == {"whole_workspace", "items"}
    assert set(migration_module.LegacyMemberRecipient.model_fields) == {"type", "user_id"}
    assert set(migration_module.LegacyExternalRecipient.model_fields) == {"type", "email"}

    delivery_schema = TypeAdapter(migration_module.LegacyDeliveryChannelConfig).json_schema()
    assert delivery_schema["discriminator"]["mapping"] == {
        "email": "#/$defs/LegacyEmailDeliveryMethod",
        "webapp": "#/$defs/LegacyWebAppDeliveryMethod",
    }
    recipient_schema = migration_module.LegacyEmailRecipients.model_json_schema()
    assert recipient_schema["$defs"]["LegacyMemberRecipient"]["required"] == ["user_id"]
    assert recipient_schema["$defs"]["LegacyExternalRecipient"]["required"] == ["email"]

    with pytest.raises(ValidationError):
        migration_module.LegacyMemberRecipient.model_validate({"type": "member", "reference_id": "member-1"})


def test_canonical_v1_and_pure_converter_have_no_raw_json_annotations_or_schema() -> None:
    canonical_schema = json.dumps(LegacyHumanInputNodeData.model_json_schema(), sort_keys=True)
    converter_annotations = repr(get_type_hints(convert_legacy_human_input_node_data))
    converter_signature = str(inspect.signature(convert_legacy_human_input_node_data))

    for forbidden_name in ("JsonValue", "reference_id", "include_bound_group"):
        assert forbidden_name not in canonical_schema
        assert forbidden_name not in converter_annotations
        assert forbidden_name not in converter_signature


def test_complete_canonical_v1_shared_fields_convert_to_typed_v2() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Manager approval",
            "desc": "Preserve historical fields",
            "version": "1",
            "error_strategy": "fail-branch",
            "default_value": [{"key": "reason", "type": "string", "value": "fallback"}],
            "retry_config": {"retry_enabled": True, "max_retries": 2, "retry_interval": 1000},
            "delivery_methods": [{"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}}],
            "form_content": "Decision: {{#$output.reason#}}",
            "inputs": [
                {
                    "type": "text_input",
                    "output_variable_name": "reason",
                    "default": {"type": "constant", "value": "fallback"},
                }
            ],
            "user_actions": [{"id": "approve", "title": "Approve", "button_style": "primary"}],
            "timeout": 2,
            "timeout_unit": "day",
        }
    )

    conversion = convert_legacy_human_input_node_data(legacy_node_data, MappingProxyType({}))

    assert conversion.blockers == ()
    assert conversion.node_data is not None
    assert conversion.node_data.model_dump(mode="json") == {
        "type": "human-input",
        "title": "Manager approval",
        "desc": "Preserve historical fields",
        "version": "2",
        "error_strategy": "fail-branch",
        "default_value": [{"key": "reason", "type": "string", "value": "fallback"}],
        "retry_config": {"retry_enabled": True, "max_retries": 2, "retry_interval": 1000},
        "recipients_spec": [{"type": "initiator"}],
        "message_template": {"subject": "", "body": ""},
        "debug_mode": {"enabled": False, "channels": []},
        "form_content": "Decision: {{#$output.reason#}}",
        "inputs": [
            {
                "type": "paragraph",
                "output_variable_name": "reason",
                "default": {"type": "constant", "selector": [], "value": "fallback"},
            }
        ],
        "user_actions": [{"id": "approve", "title": "Approve", "button_style": "primary"}],
        "timeout": 2,
        "timeout_unit": "day",
    }


def test_external_and_member_email_sources_become_normalized_onetime_email() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {
                    "id": _EMAIL_METHOD_ID,
                    "type": "email",
                    "enabled": True,
                    "config": {
                        "recipients": {
                            "items": [
                                {"type": "external", "email": "  APPROVER@Example.COM "},
                                {"type": "member", "user_id": "member-1"},
                            ]
                        },
                        "subject": "Review request",
                        "body": "Please review {{#url#}}",
                    },
                }
            ],
        }
    )

    conversion = convert_legacy_human_input_node_data(
        legacy_node_data,
        MappingProxyType({"member-1": "  MEMBER@Example.COM "}),
    )

    assert conversion.blockers == ()
    assert conversion.node_data is not None
    assert [recipient.model_dump(mode="json") for recipient in conversion.node_data.recipients_spec] == [
        {"type": "onetime_email", "email": "approver@example.com"},
        {"type": "onetime_email", "email": "member@example.com"},
    ]


def test_member_user_id_has_safe_resolution_blocker_value() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {
                    "id": _EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "subject": "Review",
                        "body": "Please review",
                        "recipients": {
                            "items": [{"type": "member", "user_id": "member-1"}],
                        },
                    },
                }
            ]
        }
    )

    resolved = convert_legacy_human_input_node_data(
        legacy_node_data,
        MappingProxyType({"member-1": "member@example.com"}),
    )
    unresolved = convert_legacy_human_input_node_data(legacy_node_data, MappingProxyType({}))

    assert resolved.blockers == ()
    assert resolved.node_data is not None
    assert resolved.node_data.recipients_spec[0].model_dump(mode="json") == {
        "type": "onetime_email",
        "email": "member@example.com",
    }
    assert [(blocker.code, blocker.method_id, blocker.value) for blocker in unresolved.blockers] == [
        ("unresolved-member", _EMAIL_METHOD_ID, "member-1"),
        ("missing-recipients", None, None),
    ]


def test_external_email_conversion_is_independent_of_unrelated_directory_state() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {
                    "id": _EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "recipients": {
                            "items": [{"type": "external", "email": "approver@example.com"}],
                        },
                        "subject": "Review request",
                        "body": "Please review",
                    },
                }
            ]
        }
    )

    without_directory_entries = convert_legacy_human_input_node_data(legacy_node_data, MappingProxyType({}))
    with_unrelated_entries = convert_legacy_human_input_node_data(
        legacy_node_data,
        MappingProxyType({"unrelated-account": "approver@example.com"}),
    )

    assert without_directory_entries == with_unrelated_entries


def test_whole_workspace_marker_preserves_overlap_source_order_and_deduplicates() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {
                    "id": _EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "recipients": {
                            "whole_workspace": True,
                            "items": [{"type": "member", "user_id": "member-1"}],
                        },
                        "subject": "Review request",
                        "body": "Please review",
                    },
                },
                {"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}},
                {
                    "id": _SECOND_EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "recipients": {"whole_workspace": True},
                        "subject": "Review request",
                        "body": "Please review",
                    },
                },
            ],
        }
    )

    conversion = convert_legacy_human_input_node_data(
        legacy_node_data,
        MappingProxyType({"member-1": "member@example.com"}),
    )

    assert conversion.blockers == ()
    assert conversion.node_data is not None
    assert [recipient.model_dump(mode="json") for recipient in conversion.node_data.recipients_spec] == [
        {"type": "onetime_email", "email": "member@example.com"},
        {"type": "all_workspace_contacts"},
        {"type": "initiator"},
    ]


def test_matching_email_templates_debug_mode_and_canonical_dedupe_are_deterministic() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {
                    "id": _EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "recipients": {
                            "items": [{"type": "external", "email": " First@Example.com "}],
                        },
                        "subject": "  Review request  ",
                        "body": "  Please review {{#url#}}  ",
                    },
                },
                {
                    "id": _SECOND_EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "recipients": {
                            "items": [
                                {"type": "external", "email": "first@example.COM"},
                                {"type": "external", "email": "second@example.com"},
                            ],
                        },
                        "subject": "  Review request  ",
                        "body": "  Please review {{#url#}}  ",
                        "debug_mode": True,
                    },
                },
            ],
        }
    )

    conversion = convert_legacy_human_input_node_data(legacy_node_data, MappingProxyType({}))

    assert conversion.blockers == ()
    assert conversion.node_data is not None
    assert conversion.node_data.message_template.model_dump() == {
        "subject": "  Review request  ",
        "body": "  Please review {{#url#}}  ",
    }
    assert conversion.node_data.debug_mode.model_dump(mode="json") == {
        "enabled": True,
        "channels": ["email"],
    }
    assert [recipient.model_dump(mode="json") for recipient in conversion.node_data.recipients_spec] == [
        {"type": "onetime_email", "email": "first@example.com"},
        {"type": "onetime_email", "email": "second@example.com"},
    ]


def test_lossy_delivery_configuration_produces_stably_ordered_blockers() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {
                    "id": _SECOND_EMAIL_METHOD_ID,
                    "type": "email",
                    "enabled": False,
                    "config": {
                        "subject": "Configured",
                        "body": "Configured",
                        "recipients": {"items": []},
                    },
                },
                {
                    "id": _EMAIL_METHOD_ID,
                    "type": "email",
                    "enabled": True,
                    "config": {
                        "subject": " ",
                        "body": "7",
                        "recipients": {
                            "items": [
                                {"type": "external", "email": "not-an-email"},
                                {"type": "member", "user_id": "missing-member"},
                            ]
                        },
                    },
                },
            ]
        }
    )

    conversion = convert_legacy_human_input_node_data(legacy_node_data, MappingProxyType({}))

    assert conversion.node_data is None
    assert [(blocker.code, blocker.method_id, blocker.value) for blocker in conversion.blockers] == [
        ("configured-disabled-method", _SECOND_EMAIL_METHOD_ID, "email"),
        ("invalid-email-configuration", _EMAIL_METHOD_ID, "subject"),
        ("invalid-email", _EMAIL_METHOD_ID, "not-an-email"),
        ("unresolved-member", _EMAIL_METHOD_ID, "missing-member"),
        ("missing-recipients", None, None),
    ]


def test_conversion_forces_untrusted_legacy_node_type_to_human_input() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "type": "code",
            "delivery_methods": [{"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}}],
        }
    )

    conversion = convert_legacy_human_input_node_data(legacy_node_data, MappingProxyType({}))

    assert conversion.blockers == ()
    assert conversion.node_data is not None
    assert conversion.node_data.type == BuiltinNodeTypes.HUMAN_INPUT
    assert conversion.node_data.model_dump(mode="json")["type"] == "human-input"


def test_conflicting_email_templates_block_after_recipient_preflight() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {
                    "id": _EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "recipients": {"items": [{"type": "external", "email": "first@example.com"}]},
                        "subject": "First subject",
                        "body": "Shared body",
                    },
                },
                {
                    "id": _SECOND_EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "recipients": {"items": [{"type": "external", "email": "invalid-email"}]},
                        "subject": "Second subject",
                        "body": "Shared body",
                    },
                },
            ]
        }
    )

    conversion = convert_legacy_human_input_node_data(legacy_node_data, MappingProxyType({}))

    assert conversion.node_data is None
    assert [(blocker.code, blocker.method_id) for blocker in conversion.blockers] == [
        ("invalid-email", _SECOND_EMAIL_METHOD_ID),
        ("conflicting-email-templates", _SECOND_EMAIL_METHOD_ID),
    ]


def test_shared_fields_input_immutability_and_repeated_conversion_are_preserved() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Manager approval",
            "desc": "Preserve this description",
            "form_content": "Decision: {{#$output.reason#}}",
            "inputs": [{"type": "paragraph", "output_variable_name": "reason"}],
            "user_actions": [{"id": "approve", "title": "Approve", "button_style": "primary"}],
            "timeout": 2,
            "timeout_unit": "day",
            "future_legacy_field": "ignored",
            "delivery_methods": [{"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}}],
        }
    )
    original_legacy_value = legacy_node_data.model_dump(mode="json")

    first = convert_legacy_human_input_node_data(legacy_node_data, MappingProxyType({}))
    second = convert_legacy_human_input_node_data(legacy_node_data, MappingProxyType({}))

    assert first == second
    assert legacy_node_data.model_dump(mode="json") == original_legacy_value
    assert first.node_data is not None
    assert first.node_data.model_dump(mode="json") == {
        **{key: value for key, value in original_legacy_value.items() if key not in {"delivery_methods", "version"}},
        "type": "human-input",
        "version": "2",
        "recipients_spec": [{"type": "initiator"}],
        "message_template": {"subject": "", "body": ""},
        "debug_mode": {"enabled": False, "channels": []},
    }
