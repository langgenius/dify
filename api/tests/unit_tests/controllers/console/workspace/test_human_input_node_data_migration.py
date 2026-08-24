import inspect
from collections.abc import Sequence
from http import HTTPStatus
from importlib import import_module
from inspect import unwrap
from types import SimpleNamespace
from typing import Never

import pytest
from flask import Flask
from pydantic import ValidationError
from werkzeug.exceptions import Forbidden

from controllers.console.workspace.human_input import NodeDataMigrationAPI
from core.human_input_v2.shared.values import NormalizedEmail, TenantId
from core.workflow.nodes.human_input_v2.entities import HumanInputNodeData
from core.workflow.nodes.human_input_v2.migration import (
    LegacyHumanInputNodeData,
    MemberEmailSnapshot,
    MigrationBlockerCode,
    ResolvedMemberEmail,
    convert_legacy_human_input_node_data,
)
from models.account import Account, TenantAccountRole
from services.human_input_v2.node_data_migration import (
    HumanInputNodeDataMigrationService,
    MigratedNode,
    MigrationNode,
    NodeDataMigrationBlocker,
    NodeDataMigrationFailure,
    NodeDataMigrationSuccess,
)

_CONTROLLER_MODULE = import_module("controllers.console.workspace.human_input")
_OMITTED_METHOD_ID = object()


class _StaticMemberEmailLookup:
    def find_member_emails(self, tenant_id: TenantId, account_ids: Sequence[str]) -> MemberEmailSnapshot:
        del tenant_id
        return MemberEmailSnapshot(
            tuple(
                ResolvedMemberEmail(account_id, NormalizedEmail(f"{account_id}@example.com"))
                for account_id in account_ids
            )
        )


def _legacy_webapp_node(title: str = "Approval") -> LegacyHumanInputNodeData:
    return LegacyHumanInputNodeData.model_validate(
        {
            "title": title,
            "delivery_methods": [{"id": "22222222-2222-4222-8222-222222222222", "type": "webapp", "config": {}}],
        }
    )


def _migrated_webapp_node() -> HumanInputNodeData:
    conversion = convert_legacy_human_input_node_data(_legacy_webapp_node(), MemberEmailSnapshot())
    assert conversion.node_data is not None
    return conversion.node_data


def test_controller_returns_typed_ordered_success_data(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    migrated_node_data = _migrated_webapp_node()

    class Service:
        def migrate(self, *, tenant_id: TenantId, nodes: Sequence[MigrationNode]) -> NodeDataMigrationSuccess:
            assert tenant_id == "workspace-1"
            assert [(node.node_id, node.node_data.title) for node in nodes] == [("node-1", "Approval")]
            return NodeDataMigrationSuccess((MigratedNode("node-1", migrated_node_data),))

    monkeypatch.setattr(_CONTROLLER_MODULE, "build_human_input_node_data_migration_service", Service)
    handler = unwrap(NodeDataMigrationAPI.post)

    with app.test_request_context(
        method="POST",
        json={
            "nodes": [
                {
                    "node_id": "node-1",
                    "node_data": {
                        "title": "Approval",
                        "delivery_methods": [
                            {"id": "22222222-2222-4222-8222-222222222222", "type": "webapp", "config": {}}
                        ],
                    },
                }
            ]
        },
    ):
        response = handler(NodeDataMigrationAPI(), "workspace-1")

    assert response == {
        "data": [
            {
                "node_id": "node-1",
                "node_data": migrated_node_data.model_dump(mode="json"),
            }
        ]
    }


@pytest.mark.parametrize(
    ("method_id", "expected_method_id"),
    [(_OMITTED_METHOD_ID, None), (None, None), ("invalid-id", "invalid-id")],
    ids=["omitted", "null", "invalid-uuid"],
)
def test_controller_maps_invalid_delivery_method_ids_to_typed_failure_without_partial_data(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    method_id: object,
    expected_method_id: str | None,
) -> None:
    invalid_method: dict[str, object] = {"type": "webapp", "config": {}}
    if method_id is not _OMITTED_METHOD_ID:
        invalid_method["id"] = method_id
    service = HumanInputNodeDataMigrationService(member_email_lookup=_StaticMemberEmailLookup())
    monkeypatch.setattr(_CONTROLLER_MODULE, "build_human_input_node_data_migration_service", lambda: service)
    handler = unwrap(NodeDataMigrationAPI.post)

    with app.test_request_context(
        method="POST",
        json={
            "nodes": [
                {
                    "node_id": "node-1",
                    "node_data": {
                        "title": "Approval",
                        "delivery_methods": [
                            invalid_method,
                            {"id": "22222222-2222-4222-8222-222222222222", "type": "webapp", "config": {}},
                        ],
                    },
                }
            ]
        },
    ):
        response = handler(NodeDataMigrationAPI(), "workspace-1")

    assert isinstance(response, tuple)
    body, status = response
    assert status == HTTPStatus.BAD_REQUEST
    assert "data" not in body
    assert [(blocker["code"], blocker["method_id"], blocker["value"]) for blocker in body["blockers"]] == [
        ("unsupported-delivery-method", expected_method_id, "webapp")
    ]


def test_controller_preserves_historically_accepted_action_id_with_trailing_line_feed(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    historical_action_id = f"{'a' * 19}\n"
    service = HumanInputNodeDataMigrationService(member_email_lookup=_StaticMemberEmailLookup())
    monkeypatch.setattr(_CONTROLLER_MODULE, "build_human_input_node_data_migration_service", lambda: service)
    handler = unwrap(NodeDataMigrationAPI.post)

    with app.test_request_context(
        method="POST",
        json={
            "nodes": [
                {
                    "node_id": "node-1",
                    "node_data": {
                        "title": "Approval",
                        "delivery_methods": [
                            {
                                "id": "22222222-2222-4222-8222-222222222222",
                                "type": "webapp",
                                "config": {},
                            }
                        ],
                        "user_actions": [{"id": historical_action_id, "title": "Approve"}],
                    },
                }
            ]
        },
    ):
        response = handler(NodeDataMigrationAPI(), "workspace-1")

    assert response["data"][0]["node_data"]["user_actions"] == [
        {"id": historical_action_id, "title": "Approve", "button_style": "default"}
    ]


def test_controller_normalizes_compatibility_member_id_before_service(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = HumanInputNodeDataMigrationService(member_email_lookup=_StaticMemberEmailLookup())
    monkeypatch.setattr(_CONTROLLER_MODULE, "build_human_input_node_data_migration_service", lambda: service)
    handler = unwrap(NodeDataMigrationAPI.post)

    with app.test_request_context(
        method="POST",
        json={
            "nodes": [
                {
                    "node_id": "node-1",
                    "node_data": {
                        "title": "Approval",
                        "delivery_methods": [
                            {
                                "id": "11111111-1111-4111-8111-111111111111",
                                "type": "email",
                                "config": {
                                    "subject": "Review",
                                    "body": "Please review",
                                    "recipients": {"items": [{"type": "member", "reference_id": "member-1"}]},
                                },
                            }
                        ],
                    },
                }
            ]
        },
    ):
        response = handler(NodeDataMigrationAPI(), "workspace-1")

    assert response["data"][0]["node_data"]["recipients_spec"] == [
        {"type": "onetime_email", "email": "member-1@example.com"}
    ]


def test_controller_maps_unsupported_methods_to_ordered_blockers_regardless_of_enabled_state(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = HumanInputNodeDataMigrationService(member_email_lookup=_StaticMemberEmailLookup())
    monkeypatch.setattr(_CONTROLLER_MODULE, "build_human_input_node_data_migration_service", lambda: service)
    handler = unwrap(NodeDataMigrationAPI.post)

    with app.test_request_context(
        method="POST",
        json={
            "nodes": [
                {
                    "node_id": "node-1",
                    "node_data": {
                        "title": "Approval",
                        "delivery_methods": [
                            {
                                "id": "im-1",
                                "type": "im",
                                "config": {
                                    "provider": "slack",
                                    "message": "Review",
                                    "recipients": {"items": [{"type": "user", "user_id": "user-1"}]},
                                },
                            },
                            {
                                "id": "future-1",
                                "type": "future-channel",
                                "enabled": False,
                                "config": {"message": "Configured"},
                            },
                        ],
                    },
                }
            ]
        },
    ):
        response = handler(NodeDataMigrationAPI(), "workspace-1")

    assert isinstance(response, tuple)
    body, status = response
    assert status == HTTPStatus.BAD_REQUEST
    assert [(blocker["code"], blocker["method_id"], blocker["value"]) for blocker in body["blockers"]] == [
        ("unsupported-delivery-method", "im-1", "im"),
        ("unsupported-delivery-method", "future-1", "future-channel"),
        ("missing-recipients", None, None),
    ]


def test_controller_rejects_disabled_unknown_method_with_empty_config_without_partial_data(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = HumanInputNodeDataMigrationService(member_email_lookup=_StaticMemberEmailLookup())
    monkeypatch.setattr(_CONTROLLER_MODULE, "build_human_input_node_data_migration_service", lambda: service)
    handler = unwrap(NodeDataMigrationAPI.post)

    with app.test_request_context(
        method="POST",
        json={
            "nodes": [
                {
                    "node_id": "node-1",
                    "node_data": {
                        "title": "Approval",
                        "delivery_methods": [
                            {
                                "id": "future-1",
                                "type": "future-channel",
                                "enabled": False,
                                "config": {},
                            },
                            {
                                "id": "22222222-2222-4222-8222-222222222222",
                                "type": "webapp",
                                "config": {},
                            },
                        ],
                    },
                }
            ]
        },
    ):
        response = handler(NodeDataMigrationAPI(), "workspace-1")

    assert isinstance(response, tuple)
    body, status = response
    assert status == HTTPStatus.BAD_REQUEST
    assert "data" not in body
    assert [(blocker["code"], blocker["method_id"], blocker["value"]) for blocker in body["blockers"]] == [
        ("unsupported-delivery-method", "future-1", "future-channel")
    ]


def test_controller_maps_invalid_default_value_to_typed_all_or_error_response(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = HumanInputNodeDataMigrationService(member_email_lookup=_StaticMemberEmailLookup())
    monkeypatch.setattr(_CONTROLLER_MODULE, "build_human_input_node_data_migration_service", lambda: service)
    handler = unwrap(NodeDataMigrationAPI.post)

    with app.test_request_context(
        method="POST",
        json={
            "nodes": [
                {
                    "node_id": "node-invalid",
                    "node_data": {
                        "title": "Invalid",
                        "default_value": [{"key": "fallback", "type": "object", "value": False}],
                        "delivery_methods": [
                            {
                                "id": "22222222-2222-4222-8222-222222222222",
                                "type": "webapp",
                                "config": {},
                            }
                        ],
                    },
                },
                {
                    "node_id": "node-valid",
                    "node_data": {
                        "title": "Valid",
                        "delivery_methods": [
                            {
                                "id": "22222222-2222-4222-8222-222222222222",
                                "type": "webapp",
                                "config": {},
                            }
                        ],
                    },
                },
            ]
        },
    ):
        body, status = handler(NodeDataMigrationAPI(), "workspace-1")

    assert status == HTTPStatus.BAD_REQUEST
    assert "data" not in body
    assert [(blocker["node_id"], blocker["code"], blocker["value"]) for blocker in body["blockers"]] == [
        ("node-invalid", "invalid-default-value", "default_value")
    ]


def test_controller_maps_blocked_batch_without_partial_data(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    blocker = NodeDataMigrationBlocker(
        node_id="node-1",
        node_title="Approval",
        code=MigrationBlockerCode.UNRESOLVED_MEMBER,
        method_id="email-1",
        value="member-1",
    )

    class Service:
        def migrate(self, *, tenant_id: TenantId, nodes: Sequence[MigrationNode]) -> NodeDataMigrationFailure:
            del tenant_id, nodes
            return NodeDataMigrationFailure((blocker,))

    monkeypatch.setattr(_CONTROLLER_MODULE, "build_human_input_node_data_migration_service", Service)
    handler = unwrap(NodeDataMigrationAPI.post)

    with app.test_request_context(
        method="POST",
        json={"nodes": [{"node_id": "node-1", "node_data": {"title": "Approval", "delivery_methods": []}}]},
    ):
        body, status = handler(NodeDataMigrationAPI(), "workspace-1")

    assert status == HTTPStatus.BAD_REQUEST
    assert body == {
        "code": "hitl_node_data_migration_failure",
        "message": "Human Input node-data migration failed.",
        "status": HTTPStatus.BAD_REQUEST,
        "blockers": [
            {
                "node_id": "node-1",
                "node_title": "Approval",
                "code": "unresolved-member",
                "method_id": "email-1",
                "value": "member-1",
            }
        ],
    }
    assert "data" not in body


def test_controller_validates_request_before_building_service(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        _CONTROLLER_MODULE,
        "build_human_input_node_data_migration_service",
        lambda: (_ for _ in ()).throw(AssertionError("service must not be built")),
    )
    handler = unwrap(NodeDataMigrationAPI.post)

    with app.test_request_context(method="POST", json={"nodes": []}), pytest.raises(ValidationError):
        handler(NodeDataMigrationAPI(), "workspace-1")


def test_controller_does_not_disguise_unexpected_service_errors(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    class Service:
        def migrate(self, *, tenant_id: TenantId, nodes: Sequence[MigrationNode]) -> Never:
            del tenant_id, nodes
            raise RuntimeError("unexpected")

    monkeypatch.setattr(_CONTROLLER_MODULE, "build_human_input_node_data_migration_service", Service)
    handler = unwrap(NodeDataMigrationAPI.post)

    with (
        app.test_request_context(
            method="POST",
            json={"nodes": [{"node_id": "node-1", "node_data": {"title": "Approval", "delivery_methods": []}}]},
        ),
        pytest.raises(RuntimeError, match="unexpected"),
    ):
        handler(NodeDataMigrationAPI(), "workspace-1")


def test_endpoint_preserves_auth_scope_decorators_and_rejects_before_service(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    endpoint_source = inspect.getsource(NodeDataMigrationAPI)
    for decorator_name in (
        "setup_required",
        "login_required",
        "account_initialization_required",
        "edit_permission_required",
        "with_current_tenant_id",
    ):
        assert f"@{decorator_name}" in endpoint_source

    monkeypatch.setattr(
        _CONTROLLER_MODULE,
        "build_human_input_node_data_migration_service",
        lambda: (_ for _ in ()).throw(AssertionError("service must not be built")),
    )
    account = Account(name="Viewer", email="viewer@example.com")
    account.role = TenantAccountRole.NORMAL
    login_module = import_module("libs.login")
    wraps_module = import_module("controllers.console.wraps")
    monkeypatch.setattr(
        login_module,
        "current_user",
        SimpleNamespace(_get_current_object=lambda: account, has_edit_permission=False),
    )
    monkeypatch.setattr(wraps_module.dify_config, "RBAC_ENABLED", False)

    edit_wrapped_handler = NodeDataMigrationAPI.post.__wrapped__.__wrapped__.__wrapped__
    with app.test_request_context(method="POST"), pytest.raises(Forbidden):
        edit_wrapped_handler(NodeDataMigrationAPI())


def test_controller_class_has_no_persistence_or_contact_dependencies() -> None:
    endpoint_source = inspect.getsource(NodeDataMigrationAPI).lower()

    for forbidden_dependency in (
        "sqlalchemy",
        "repositories.",
        "models.",
        "contact_repository",
        "contact_lookup",
    ):
        assert forbidden_dependency not in endpoint_source
