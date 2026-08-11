from importlib.util import find_spec
from uuid import UUID

import pytest
from pydantic import ValidationError

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


def test_migration_transport_requires_historical_node_title() -> None:
    with pytest.raises(ValidationError):
        migration_boundary.LegacyHITLv1NodeData.model_validate({"delivery_methods": []})


def test_preflight_preserves_historical_delivery_method_id_factory() -> None:
    transport_node_data = migration_boundary.LegacyHITLv1NodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [{"type": "webapp", "config": {}}],
        }
    )

    preflight = migration_boundary.preflight_legacy_human_input_node_data(transport_node_data)

    assert preflight.issues == ()
    assert preflight.method_positions == (0,)
    assert preflight.recipient_positions == ((),)
    method = preflight.node_data.delivery_methods[0]
    assert isinstance(method, LegacyWebAppDeliveryMethod)
    assert isinstance(method.id, UUID)


def test_preflight_rejects_explicit_null_delivery_ids_without_invoking_the_factory() -> None:
    transport_node_data = migration_boundary.LegacyHITLv1NodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {"id": None, "type": "webapp", "config": {}},
                {"type": "webapp", "config": {}},
                {"id": None, "type": "email", "enabled": False, "config": {}},
            ],
        }
    )

    preflight = migration_boundary.preflight_legacy_human_input_node_data(transport_node_data)

    assert preflight.method_positions == (1,)
    assert [(issue.code, issue.method_position, issue.method_id, issue.value) for issue in preflight.issues] == [
        ("unsupported-delivery-method", 0, None, "webapp"),
        ("unsupported-delivery-method", 2, None, "email"),
    ]


@pytest.mark.parametrize(
    "empty_config",
    [
        {},
        {
            "recipients": {"whole_workspace": False, "items": []},
            "subject": "",
            "body": "",
            "debug_mode": False,
        },
    ],
)
def test_preflight_ignores_disabled_email_with_only_default_empty_configuration(
    empty_config: dict[str, object],
) -> None:
    transport_node_data = migration_boundary.LegacyHITLv1NodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {"type": "email", "enabled": False, "config": empty_config},
                {"type": "webapp", "config": {}},
            ],
        }
    )

    preflight = migration_boundary.preflight_legacy_human_input_node_data(transport_node_data)

    assert preflight.issues == ()
    assert preflight.method_positions == (1,)
    assert len(preflight.node_data.delivery_methods) == 1
    assert isinstance(preflight.node_data.delivery_methods[0], LegacyWebAppDeliveryMethod)


@pytest.mark.parametrize(
    ("method_type", "malformed_config"),
    [
        ("email", None),
        ("email", False),
        ("email", ""),
        ("email", []),
        ("email", 0),
        ("email", {"recipients": False}),
        ("email", {"subject": None}),
        ("email", {"debug_mode": None}),
        ("email", {"unknown": False}),
        ("email", {"recipients": {"items": False}}),
        ("email", {"recipients": {"whole_workspace": None}}),
        ("webapp", None),
        ("webapp", False),
        ("webapp", ""),
        ("webapp", []),
        ("webapp", 0),
    ],
)
def test_preflight_blocks_explicit_malformed_falsy_disabled_delivery_config(
    method_type: str,
    malformed_config: object,
) -> None:
    transport_node_data = migration_boundary.LegacyHITLv1NodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {"type": method_type, "enabled": False, "config": malformed_config},
                {"type": "webapp", "config": {}},
            ],
        }
    )

    preflight = migration_boundary.preflight_legacy_human_input_node_data(transport_node_data)

    assert preflight.method_positions == (1,)
    assert [(issue.code, issue.method_position, issue.value) for issue in preflight.issues] == [
        ("configured-disabled-method", 0, method_type)
    ]


@pytest.mark.parametrize("include_config", [False, True], ids=["omitted-config", "empty-config"])
def test_preflight_rejects_disabled_unknown_method_before_empty_config_exemption(include_config: bool) -> None:
    unknown_method: dict[str, object] = {
        "id": "33333333-3333-4333-8333-333333333333",
        "type": "future-channel",
        "enabled": False,
    }
    if include_config:
        unknown_method["config"] = dict[str, object]()
    transport_node_data = migration_boundary.LegacyHITLv1NodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [unknown_method, {"type": "webapp", "config": {}}],
        }
    )

    preflight = migration_boundary.preflight_legacy_human_input_node_data(transport_node_data)

    assert preflight.method_positions == (1,)
    assert [(issue.code, issue.method_position, issue.method_id, issue.value) for issue in preflight.issues] == [
        (
            "unsupported-delivery-method",
            0,
            "33333333-3333-4333-8333-333333333333",
            "future-channel",
        )
    ]


@pytest.mark.parametrize(
    "invalid_default",
    [
        {"key": "fallback", "type": "object", "value": False},
        {"key": "fallback", "type": "array[number]", "value": 7},
    ],
)
def test_preflight_types_invalid_historical_default_values_without_constructing_invalid_canonical_state(
    invalid_default: dict[str, object],
) -> None:
    transport_node_data = migration_boundary.LegacyHITLv1NodeData.model_validate(
        {
            "title": "Approval",
            "default_value": [invalid_default],
            "delivery_methods": [{"type": "webapp", "config": {}}],
        }
    )

    preflight = migration_boundary.preflight_legacy_human_input_node_data(transport_node_data)

    assert preflight.node_data.default_value is None
    assert [(issue.code, issue.method_position, issue.method_id, issue.value) for issue in preflight.issues] == [
        ("invalid-default-value", None, None, "default_value")
    ]


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
    assert [(issue.code, issue.method_position, issue.method_id, issue.value) for issue in preflight.issues] == [
        ("unsupported-delivery-method", 0, "33333333-3333-4333-8333-333333333333", "im"),
        ("unsupported-delivery-method", 1, "44444444-4444-4444-8444-444444444444", "future-channel"),
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
    assert [issue.recipient_position for issue in preflight.issues] == [0, 1]
    assert preflight.recipient_positions == ((2,),)
    method = preflight.node_data.delivery_methods[0]
    assert isinstance(method, LegacyEmailDeliveryMethod)
    assert [recipient.model_dump(mode="json") for recipient in method.config.recipients.items] == [
        {"type": "external", "email": "approver@example.com"}
    ]
