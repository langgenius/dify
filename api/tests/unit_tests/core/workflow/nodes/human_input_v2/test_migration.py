from types import MappingProxyType

import pytest

from core.workflow.nodes.human_input_v2.migration import (
    LegacyHumanInputNodeData,
    convert_legacy_human_input_node_data,
)
from graphon.enums import BuiltinNodeTypes


def test_external_and_member_email_sources_become_normalized_onetime_email() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {
                    "id": "email-1",
                    "type": "email",
                    "enabled": True,
                    "config": {
                        "recipients": {
                            "items": [
                                {"type": "external", "email": "  APPROVER@Example.COM "},
                                {"type": "member", "reference_id": "member-1"},
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


@pytest.mark.parametrize("member_id_field", ["user_id", "reference_id"])
def test_real_and_compatibility_member_ids_share_resolution_and_safe_blocker_value(member_id_field: str) -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "delivery_methods": [
                {
                    "id": "email-1",
                    "type": "email",
                    "config": {
                        "subject": "Review",
                        "body": "Please review",
                        "recipients": {
                            "items": [{"type": "member", member_id_field: "member-1"}],
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
        ("unresolved-member", "email-1", "member-1"),
        ("missing-recipients", None, None),
    ]


def test_external_email_conversion_is_independent_of_unrelated_directory_state() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "delivery_methods": [
                {
                    "id": "email-1",
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
                    "id": "email-1",
                    "type": "email",
                    "config": {
                        "recipients": {
                            "whole_workspace": True,
                            "items": [{"type": "member", "reference_id": "member-1"}],
                        },
                        "subject": "Review request",
                        "body": "Please review",
                    },
                },
                {"id": "webapp-1", "type": "webapp", "config": {}},
                {
                    "id": "email-2",
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
            "delivery_methods": [
                {
                    "id": "email-1",
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
                    "id": "email-2",
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
            "delivery_methods": [
                {
                    "id": "disabled-1",
                    "type": "email",
                    "enabled": False,
                    "config": {"subject": "Configured", "body": "Configured"},
                },
                {"id": "im-1", "type": "im", "enabled": True, "config": {}},
                {
                    "id": "email-1",
                    "type": "email",
                    "enabled": True,
                    "config": {
                        "subject": " ",
                        "body": 7,
                        "recipients": {
                            "items": [
                                {"type": "external", "email": "not-an-email"},
                                {"type": "member", "reference_id": "missing-member"},
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
        ("configured-disabled-method", "disabled-1", "email"),
        ("unsupported-delivery-method", "im-1", "im"),
        ("invalid-email-configuration", "email-1", "subject"),
        ("invalid-email", "email-1", "not-an-email"),
        ("unresolved-member", "email-1", "missing-member"),
        ("missing-recipients", None, None),
    ]


def test_real_im_and_unknown_disabled_configuration_produce_semantic_blockers_in_method_order() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "delivery_methods": [
                {
                    "id": "im-enabled",
                    "type": "im",
                    "enabled": True,
                    "config": {
                        "provider": "slack",
                        "message": "Review",
                        "recipients": {
                            "items": [
                                {"type": "channel", "channel_id": "channel-1"},
                                {"type": "user", "user_id": "user-1"},
                            ]
                        },
                    },
                },
                {
                    "id": "slack-disabled",
                    "type": "slack",
                    "enabled": False,
                    "config": {
                        "message": "Configured",
                        "recipients": [{"type": "user", "user_id": "user-2"}],
                    },
                },
                {
                    "id": "future-disabled",
                    "type": "future-channel",
                    "enabled": False,
                    "config": {"message": "Configured"},
                },
            ]
        }
    )

    conversion = convert_legacy_human_input_node_data(legacy_node_data, MappingProxyType({}))

    assert conversion.node_data is None
    assert [(blocker.code, blocker.method_id, blocker.value) for blocker in conversion.blockers] == [
        ("unsupported-delivery-method", "im-enabled", "im"),
        ("configured-disabled-method", "slack-disabled", "slack"),
        ("configured-disabled-method", "future-disabled", "future-channel"),
        ("missing-recipients", None, None),
    ]


def test_non_email_recipient_shape_on_email_method_is_a_semantic_configuration_blocker() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "delivery_methods": [
                {
                    "id": "email-1",
                    "type": "email",
                    "config": {
                        "subject": "Review",
                        "body": "Please review",
                        "recipients": [{"type": "user", "user_id": "user-1"}],
                    },
                }
            ]
        }
    )

    conversion = convert_legacy_human_input_node_data(legacy_node_data, MappingProxyType({}))

    assert [(blocker.code, blocker.method_id, blocker.value) for blocker in conversion.blockers] == [
        ("invalid-email-configuration", "email-1", "recipients"),
        ("missing-recipients", None, None),
    ]


def test_conversion_forces_untrusted_legacy_node_type_to_human_input() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "type": "code",
            "delivery_methods": [{"id": "webapp-1", "type": "webapp", "config": {}}],
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
            "delivery_methods": [
                {
                    "id": "email-1",
                    "type": "email",
                    "config": {
                        "recipients": {"items": [{"type": "external", "email": "first@example.com"}]},
                        "subject": "First subject",
                        "body": "Shared body",
                    },
                },
                {
                    "id": "email-2",
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
        ("invalid-email", "email-2"),
        ("conflicting-email-templates", "email-2"),
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
            "delivery_methods": [{"id": "webapp-1", "type": "webapp", "config": {}}],
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
        "version": "2",
        "recipients_spec": [{"type": "initiator"}],
        "message_template": {"subject": "", "body": ""},
        "debug_mode": {"enabled": False, "channels": []},
    }
