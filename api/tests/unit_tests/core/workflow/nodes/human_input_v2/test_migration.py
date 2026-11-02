import pytest

from core.human_input_v2.shared.values import NormalizedEmail
from core.workflow.nodes.human_input.entities import HumanInputNodeDataFull
from core.workflow.nodes.human_input_v2.migration import (
    MemberEmailSnapshot,
    ResolvedMemberEmail,
    convert_legacy_human_input_node_data,
)
from graphon.enums import BuiltinNodeTypes

_EMAIL_METHOD_ID = "11111111-1111-4111-8111-111111111111"
_WEBAPP_METHOD_ID = "22222222-2222-4222-8222-222222222222"
_SECOND_EMAIL_METHOD_ID = "33333333-3333-4333-8333-333333333333"


def _member_email_snapshot(entries: dict[str, str] | None = None) -> MemberEmailSnapshot:
    return MemberEmailSnapshot(
        tuple(
            ResolvedMemberEmail(member_id=member_id, email=NormalizedEmail(email))
            for member_id, email in (entries or {}).items()
        )
    )


@pytest.mark.parametrize(
    ("default_type", "value", "normalized_value"),
    [
        ("string", "fallback", "fallback"),
        ("number", 7, 7),
        ("number", 1.5, 1.5),
        ("number", True, True),
        ("number", "7", 7.0),
        ("object", {"nested": [None, True, 7, 1.5, "value"]}, {"nested": [None, True, 7, 1.5, "value"]}),
        ("object", '{"nested": [null, true, 7, 1.5, "value"]}', {"nested": [None, True, 7, 1.5, "value"]}),
        ("array[number]", [1, 2.5, True], [1, 2.5, True]),
        ("array[number]", "[1, 2.5, true]", [1, 2.5, True]),
        ("array[string]", ["first", "second"], ["first", "second"]),
        ("array[string]", '["first", "second"]', ["first", "second"]),
        ("array[object]", [{"first": 1}, {"second": False}], [{"first": 1}, {"second": False}]),
        ("array[object]", '[{"first": 1}, {"second": false}]', [{"first": 1}, {"second": False}]),
        (
            "array[file]",
            {
                "nested": [None, True, 7, 1.5, "value", {"deep": [False]}],
            },
            {
                "nested": [None, True, 7, 1.5, "value", {"deep": [False]}],
            },
        ),
        ("array[file]", False, False),
    ],
)
def test_canonical_default_value_matches_historical_normalization_and_converts_totally(
    default_type: str,
    value: object,
    normalized_value: object,
) -> None:
    raw_default = {"key": "fallback", "type": default_type, "value": value}
    normalized_default = {"key": "fallback", "type": default_type, "value": normalized_value}

    node_data = HumanInputNodeDataFull.model_validate(
        {
            "title": "Approval",
            "default_value": [raw_default],
            "delivery_methods": [{"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}}],
        }
    )
    conversion = convert_legacy_human_input_node_data(node_data, _member_email_snapshot())

    assert node_data.model_dump(mode="json")["default_value"] == [normalized_default]
    assert conversion.blockers == ()
    assert conversion.node_data is not None
    assert conversion.node_data.model_dump(mode="json")["default_value"] == [normalized_default]


def test_complete_canonical_v1_shared_fields_convert_to_typed_v2() -> None:
    legacy_node_data = HumanInputNodeDataFull.model_validate(
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
                    "type": "paragraph",
                    "output_variable_name": "reason",
                    "default": {"type": "constant", "value": "fallback"},
                }
            ],
            "user_actions": [{"id": "approve", "title": "Approve", "button_style": "primary"}],
            "timeout": 2,
            "timeout_unit": "day",
        }
    )

    conversion = convert_legacy_human_input_node_data(legacy_node_data, _member_email_snapshot())

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
        "message_template": {
            "subject": "Action required",
            "body": (
                "A request is waiting for your review. Please review the details and submit your decision to continue. "
                "Review and respond: {{#url#}}"
            ),
        },
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


def test_converter_preserves_historically_accepted_action_id_with_trailing_line_feed() -> None:
    historical_action_id = f"{'a' * 19}\n"
    legacy_node_data = HumanInputNodeDataFull.model_validate(
        {
            "title": "Manager approval",
            "delivery_methods": [{"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}}],
            "user_actions": [{"id": historical_action_id, "title": "Approve"}],
        }
    )

    conversion = convert_legacy_human_input_node_data(legacy_node_data, _member_email_snapshot())

    assert conversion.blockers == ()
    assert conversion.node_data is not None
    assert conversion.node_data.user_actions[0].id == historical_action_id


def test_converter_preserves_repeated_historical_output_slots() -> None:
    legacy_node_data = HumanInputNodeDataFull.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [{"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}}],
            "form_content": "{{#$output.reason#}} / {{#$output.reason#}}",
            "inputs": [{"type": "paragraph", "output_variable_name": "reason"}],
        }
    )

    conversion = convert_legacy_human_input_node_data(legacy_node_data, _member_email_snapshot())

    assert conversion.blockers == ()
    assert conversion.node_data is not None
    assert conversion.node_data.form_content == "{{#$output.reason#}} / {{#$output.reason#}}"
    assert conversion.node_data.output_variable_names() == ("reason", "reason")


def test_external_and_member_email_sources_become_normalized_onetime_email() -> None:
    legacy_node_data = HumanInputNodeDataFull.model_validate(
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
        _member_email_snapshot({"member-1": "  MEMBER@Example.COM "}),
    )

    assert conversion.blockers == ()
    assert conversion.node_data is not None
    assert [recipient.model_dump(mode="json") for recipient in conversion.node_data.recipients_spec] == [
        {"type": "onetime_email", "email": "approver@example.com"},
        {"type": "onetime_email", "email": "member@example.com"},
    ]


def test_member_user_id_has_safe_resolution_blocker_value() -> None:
    legacy_node_data = HumanInputNodeDataFull.model_validate(
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
                            "items": [{"type": "member", "reference_id": "member-1"}],
                        },
                    },
                }
            ],
        }
    )

    resolved = convert_legacy_human_input_node_data(
        legacy_node_data,
        _member_email_snapshot({"member-1": "member@example.com"}),
    )
    unresolved = convert_legacy_human_input_node_data(legacy_node_data, _member_email_snapshot())

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
    legacy_node_data = HumanInputNodeDataFull.model_validate(
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
            ],
        }
    )

    without_directory_entries = convert_legacy_human_input_node_data(legacy_node_data, _member_email_snapshot())
    with_unrelated_entries = convert_legacy_human_input_node_data(
        legacy_node_data,
        _member_email_snapshot({"unrelated-account": "approver@example.com"}),
    )

    assert without_directory_entries == with_unrelated_entries


def test_whole_workspace_marker_preserves_overlap_source_order_and_deduplicates() -> None:
    legacy_node_data = HumanInputNodeDataFull.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {
                    "id": _EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "recipients": {
                            "include_bound_group": True,
                            "items": [{"type": "member", "reference_id": "member-1"}],
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
                        "recipients": {"include_bound_group": True},
                        "subject": "Review request",
                        "body": "Please review",
                    },
                },
            ],
        }
    )

    conversion = convert_legacy_human_input_node_data(
        legacy_node_data,
        _member_email_snapshot({"member-1": "member@example.com"}),
    )

    assert conversion.blockers == ()
    assert conversion.node_data is not None
    assert [recipient.model_dump(mode="json") for recipient in conversion.node_data.recipients_spec] == [
        {"type": "onetime_email", "email": "member@example.com"},
        {"type": "all_workspace_contacts"},
        {"type": "initiator"},
    ]


def test_matching_email_templates_debug_mode_and_canonical_dedupe_are_deterministic() -> None:
    legacy_node_data = HumanInputNodeDataFull.model_validate(
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

    conversion = convert_legacy_human_input_node_data(legacy_node_data, _member_email_snapshot())

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
    legacy_node_data = HumanInputNodeDataFull.model_validate(
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
                                {"type": "member", "reference_id": "missing-member"},
                            ]
                        },
                    },
                },
            ],
        }
    )

    conversion = convert_legacy_human_input_node_data(legacy_node_data, _member_email_snapshot())

    assert conversion.node_data is None
    assert [(blocker.code, blocker.method_id, blocker.value) for blocker in conversion.blockers] == [
        ("configured-disabled-method", _SECOND_EMAIL_METHOD_ID, "email"),
        ("invalid-email-configuration", _EMAIL_METHOD_ID, "subject"),
        ("invalid-email", _EMAIL_METHOD_ID, "not-an-email"),
        ("unresolved-member", _EMAIL_METHOD_ID, "missing-member"),
        ("missing-recipients", None, None),
    ]


def test_conversion_forces_untrusted_legacy_node_type_to_human_input() -> None:
    legacy_node_data = HumanInputNodeDataFull.model_validate(
        {
            "title": "Approval",
            "type": "code",
            "delivery_methods": [{"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}}],
        }
    )

    conversion = convert_legacy_human_input_node_data(legacy_node_data, _member_email_snapshot())

    assert conversion.blockers == ()
    assert conversion.node_data is not None
    assert conversion.node_data.type == BuiltinNodeTypes.HUMAN_INPUT
    assert conversion.node_data.model_dump(mode="json")["type"] == "human-input"


def test_conflicting_email_templates_block_after_recipient_preflight() -> None:
    legacy_node_data = HumanInputNodeDataFull.model_validate(
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
            ],
        }
    )

    conversion = convert_legacy_human_input_node_data(legacy_node_data, _member_email_snapshot())

    assert conversion.node_data is None
    assert [(blocker.code, blocker.method_id) for blocker in conversion.blockers] == [
        ("invalid-email", _SECOND_EMAIL_METHOD_ID),
        ("conflicting-email-templates", _SECOND_EMAIL_METHOD_ID),
    ]


@pytest.mark.parametrize(
    ("subject", "body", "enabled", "conflicting", "expected_blocker"),
    [
        (" ", "Open {{#url#}}", True, False, "invalid-email-configuration"),
        ("Review", " ", True, False, "invalid-email-configuration"),
        ("Review", "Open {{#url#}}", False, False, "configured-disabled-method"),
        ("Review", "Open {{#url#}}", True, True, "conflicting-email-templates"),
    ],
)
def test_webapp_default_does_not_mask_email_blockers(
    subject: str, body: str, enabled: bool, conflicting: bool, expected_blocker: str
) -> None:
    legacy = HumanInputNodeDataFull.model_validate(
        {
            "delivery_methods": [
                {"type": "webapp"},
                {
                    "type": "email",
                    "enabled": enabled,
                    "config": {
                        "subject": subject,
                        "body": body,
                        "recipients": {"items": [{"type": "external", "email": "approver@example.com"}]},
                    },
                },
            ]
            + (
                [
                    {
                        "type": "email",
                        "config": {
                            "subject": "Conflicting subject",
                            "body": "Open {{#url#}}",
                            "recipients": {"items": [{"type": "external", "email": "second@example.com"}]},
                        },
                    }
                ]
                if conflicting
                else []
            ),
        }
    )

    conversion = convert_legacy_human_input_node_data(legacy, MemberEmailSnapshot())

    assert conversion.node_data is None
    assert [blocker.code for blocker in conversion.blockers] == [expected_blocker]


def test_shared_fields_input_immutability_and_repeated_conversion_are_preserved() -> None:
    legacy_node_data = HumanInputNodeDataFull.model_validate(
        {
            "title": "Manager approval",
            "desc": "Preserve this description",
            "form_content": "Decision: {{#$output.reason#}}",
            "inputs": [{"type": "paragraph", "output_variable_name": "reason"}],
            "user_actions": [{"id": "approve", "title": "Approve", "button_style": "primary"}],
            "timeout": 2,
            "timeout_unit": "day",
            "delivery_methods": [{"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}}],
        }
    )
    original_legacy_value = legacy_node_data.model_dump(mode="json")

    first = convert_legacy_human_input_node_data(legacy_node_data, _member_email_snapshot())
    second = convert_legacy_human_input_node_data(legacy_node_data, _member_email_snapshot())

    assert first == second
    assert legacy_node_data.model_dump(mode="json") == original_legacy_value
    assert first.node_data is not None
    assert first.node_data.model_dump(mode="json") == {
        **{key: value for key, value in original_legacy_value.items() if key not in {"delivery_methods", "version"}},
        "type": "human-input",
        "version": "2",
        "recipients_spec": [{"type": "initiator"}],
        "message_template": {
            "subject": "Action required",
            "body": (
                "A request is waiting for your review. Please review the details and submit your decision to continue. "
                "Review and respond: {{#url#}}"
            ),
        },
        "debug_mode": {"enabled": False, "channels": []},
    }


def test_formal_v1_im_delivery_keeps_unsupported_delivery_blocker() -> None:
    v1 = HumanInputNodeDataFull.model_validate(
        {
            "delivery_methods": [
                {"type": "webapp"},
                {"type": "im", "id": _EMAIL_METHOD_ID, "config": {"provider": "slack"}},
            ]
        }
    )
    conversion = convert_legacy_human_input_node_data(v1, MemberEmailSnapshot())
    assert conversion.node_data is None
    assert [(blocker.code, blocker.method_id, blocker.value) for blocker in conversion.blockers] == [
        ("unsupported-delivery-method", _EMAIL_METHOD_ID, "im"),
    ]
