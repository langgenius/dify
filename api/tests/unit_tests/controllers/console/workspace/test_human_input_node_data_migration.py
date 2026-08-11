import inspect
from http import HTTPStatus
from importlib import import_module
from inspect import unwrap
from types import MappingProxyType, SimpleNamespace

import pytest
from flask import Flask
from pydantic import ValidationError
from werkzeug.exceptions import Forbidden

from controllers.console.workspace.human_input import NodeDataMigrationAPI
from core.workflow.nodes.human_input_v2.migration import (
    LegacyHumanInputNodeData,
    MigrationBlockerCode,
    convert_legacy_human_input_node_data,
)
from models.account import Account, TenantAccountRole
from services.human_input_v2.node_data_migration import (
    HumanInputNodeDataMigrationService,
    MigratedNode,
    NodeDataMigrationBlocker,
    NodeDataMigrationFailure,
    NodeDataMigrationSuccess,
)

_CONTROLLER_MODULE = import_module("controllers.console.workspace.human_input")


class _StaticMemberEmailLookup:
    def find_member_emails(self, _workspace_id, account_ids):
        return {account_id: f"{account_id}@example.com" for account_id in account_ids}


def _legacy_webapp_node(title: str = "Approval") -> LegacyHumanInputNodeData:
    return LegacyHumanInputNodeData.model_validate(
        {
            "title": title,
            "delivery_methods": [
                {"id": "22222222-2222-4222-8222-222222222222", "type": "webapp", "config": {}}
            ],
        }
    )


def _migrated_webapp_node():
    conversion = convert_legacy_human_input_node_data(_legacy_webapp_node(), MappingProxyType({}))
    assert conversion.node_data is not None
    return conversion.node_data


def test_controller_returns_typed_ordered_success_data(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    migrated_node_data = _migrated_webapp_node()

    class Service:
        def migrate(self, *, workspace_id, nodes):
            assert workspace_id == "workspace-1"
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
                        ]
                    },
                }
            ]
        },
    ):
        response = handler(NodeDataMigrationAPI(), "workspace-1")

    assert response["data"][0]["node_data"]["recipients_spec"] == [
        {"type": "onetime_email", "email": "member-1@example.com"}
    ]


def test_controller_maps_real_im_and_disabled_unknown_config_to_ordered_blockers(
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
        body, status = handler(NodeDataMigrationAPI(), "workspace-1")

    assert status == HTTPStatus.BAD_REQUEST
    assert [(blocker["code"], blocker["method_id"], blocker["value"]) for blocker in body["blockers"]] == [
        ("unsupported-delivery-method", "im-1", "im"),
        ("configured-disabled-method", "future-1", "future-channel"),
        ("missing-recipients", None, None),
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
        def migrate(self, **_kwargs):
            return NodeDataMigrationFailure((blocker,))

    monkeypatch.setattr(_CONTROLLER_MODULE, "build_human_input_node_data_migration_service", Service)
    handler = unwrap(NodeDataMigrationAPI.post)

    with app.test_request_context(
        method="POST",
        json={"nodes": [{"node_id": "node-1", "node_data": {"delivery_methods": []}}]},
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
        def migrate(self, **_kwargs):
            raise RuntimeError("unexpected")

    monkeypatch.setattr(_CONTROLLER_MODULE, "build_human_input_node_data_migration_service", Service)
    handler = unwrap(NodeDataMigrationAPI.post)

    with (
        app.test_request_context(
            method="POST",
            json={"nodes": [{"node_id": "node-1", "node_data": {"delivery_methods": []}}]},
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
    monkeypatch.setattr(
        login_module,
        "current_user",
        SimpleNamespace(_get_current_object=lambda: account, has_edit_permission=False),
    )
    monkeypatch.setattr(_CONTROLLER_MODULE.dify_config, "RBAC_ENABLED", False)

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
