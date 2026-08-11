from importlib.util import find_spec
from uuid import UUID

from controllers.common import human_input_v2_migration as migration_boundary
from core.workflow.nodes.human_input_v2.migration import (
    LegacyEmailDeliveryMethod,
    LegacyMemberRecipient,
    LegacyWebAppDeliveryMethod,
)

_EMAIL_METHOD_ID = "11111111-1111-4111-8111-111111111111"
_WEBAPP_METHOD_ID = "22222222-2222-4222-8222-222222222222"


def test_migration_compatibility_preflight_has_an_explicit_transport_module() -> None:
    assert find_spec("controllers.common.human_input_v2_migration") is not None


def test_migration_transport_exposes_typed_preflight_api() -> None:
    assert {"LegacyHITLv1NodeData", "preflight_legacy_human_input_node_data"} <= set(dir(migration_boundary))


def test_preflight_normalizes_compatibility_aliases_before_constructing_canonical_v1() -> None:
    transport_node_data = migration_boundary.LegacyHITLv1NodeData.model_validate(
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
                            "include_bound_group": True,
                            "items": [{"type": "member", "reference_id": "member-1"}],
                        },
                    },
                }
            ],
        }
    )

    preflight = migration_boundary.preflight_legacy_human_input_node_data(transport_node_data)

    assert preflight.issues == ()
    assert preflight.method_positions == (0,)
    method = preflight.node_data.delivery_methods[0]
    assert isinstance(method, LegacyEmailDeliveryMethod)
    assert isinstance(method.id, UUID)
    assert method.config.recipients.whole_workspace is True
    assert isinstance(method.config.recipients.items[0], LegacyMemberRecipient)
    assert method.config.recipients.items[0].user_id == "member-1"
    assert "reference_id" not in method.model_dump_json()
    assert "include_bound_group" not in method.model_dump_json()


def test_preflight_returns_ordered_typed_issues_without_constructing_invalid_methods() -> None:
    transport_node_data = migration_boundary.LegacyHITLv1NodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {
                    "id": "33333333-3333-4333-8333-333333333333",
                    "type": "im",
                    "config": {"provider": "slack", "message": "Review"},
                },
                {
                    "id": "44444444-4444-4444-8444-444444444444",
                    "type": "future-channel",
                    "enabled": False,
                    "config": {"message": "Configured"},
                },
                {
                    "id": _EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "subject": "Review",
                        "body": "Please review",
                        "recipients": [{"type": "user", "user_id": "user-1"}],
                    },
                },
                {"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}},
            ],
        }
    )

    preflight = migration_boundary.preflight_legacy_human_input_node_data(transport_node_data)

    assert preflight.method_positions == (3,)
    assert len(preflight.node_data.delivery_methods) == 1
    assert isinstance(preflight.node_data.delivery_methods[0], LegacyWebAppDeliveryMethod)
    assert [
        (issue.code, issue.method_position, issue.method_id, issue.value)
        for issue in preflight.issues
    ] == [
        ("unsupported-delivery-method", 0, "33333333-3333-4333-8333-333333333333", "im"),
        ("configured-disabled-method", 1, "44444444-4444-4444-8444-444444444444", "future-channel"),
        ("invalid-email-configuration", 2, _EMAIL_METHOD_ID, "recipients"),
    ]
    assert all(type(issue).__name__ == "LegacyDeliveryParseIssue" for issue in preflight.issues)


def test_preflight_types_malformed_recipients_without_discarding_valid_recipient_state() -> None:
    transport_node_data = migration_boundary.LegacyHITLv1NodeData.model_validate(
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
                            "items": [
                                {"type": "external", "email": 7},
                                {"type": "member"},
                                {"type": "external", "email": "approver@example.com"},
                            ]
                        },
                    },
                }
            ],
        }
    )

    preflight = migration_boundary.preflight_legacy_human_input_node_data(transport_node_data)

    assert [(issue.code, issue.method_id, issue.value) for issue in preflight.issues] == [
        ("invalid-email", _EMAIL_METHOD_ID, None),
        ("unresolved-member", _EMAIL_METHOD_ID, None),
    ]
    method = preflight.node_data.delivery_methods[0]
    assert isinstance(method, LegacyEmailDeliveryMethod)
    assert [recipient.model_dump(mode="json") for recipient in method.config.recipients.items] == [
        {"type": "external", "email": "approver@example.com"}
    ]
