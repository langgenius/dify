from __future__ import annotations

from unittest.mock import MagicMock, patch

from services.enterprise import rbac_service
from services.knowledge_fs.product_authorization import DifyKnowledgeFSProductRBACPort
from services.knowledge_fs.product_operations import KnowledgeFSProductPermission


def test_enterprise_knowledge_fs_permissions_use_one_batch_request() -> None:
    response = {
        "data": [
            {"control_space_id": "control-1", "permission_keys": ["knowledge_space_read"]},
            {"control_space_id": "control-2", "permission_keys": []},
        ]
    }
    with (
        patch.object(rbac_service.dify_config, "RBAC_ENABLED", True),
        patch.object(rbac_service, "_inner_call", return_value=response) as inner_call,
    ):
        permissions = rbac_service.RBACService.KnowledgeFSPermissions.batch_get(
            "tenant-1",
            "account-1",
            ["control-1", "control-2"],
            session=MagicMock(),
        )

    inner_call.assert_called_once_with(
        "POST",
        "/rbac/knowledge-fs/permission-keys/batch",
        tenant_id="tenant-1",
        account_id="account-1",
        json={"control_space_ids": ["control-1", "control-2"]},
    )
    assert permissions == {"control-1": ["knowledge_space_read"], "control-2": []}


def test_rbac_transport_failure_filters_every_control_space() -> None:
    port = DifyKnowledgeFSProductRBACPort()
    with patch.object(rbac_service.RBACService.KnowledgeFSPermissions, "batch_get", side_effect=RuntimeError("down")):
        allowed = port.filter_authorized_control_space_ids(
            session=MagicMock(),
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_ids=["control-1"],
            permission=KnowledgeFSProductPermission.READ,
        )

    assert allowed == frozenset()


def test_rbac_permission_map_ignores_unknown_keys_and_preserves_one_resource_batch() -> None:
    port = DifyKnowledgeFSProductRBACPort()
    with patch.object(
        rbac_service.RBACService.KnowledgeFSPermissions,
        "batch_get",
        return_value={
            "control-1": ["knowledge_space_read", "unknown_permission"],
            "control-2": ["knowledge_space_edit"],
        },
    ) as batch_get:
        permissions = port.permission_keys_by_control_space(
            session=MagicMock(),
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_ids=["control-1", "control-2"],
        )

    batch_get.assert_called_once()
    assert permissions == {
        "control-1": frozenset({KnowledgeFSProductPermission.READ}),
        "control-2": frozenset({KnowledgeFSProductPermission.EDIT}),
    }
