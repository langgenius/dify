from __future__ import annotations

from unittest.mock import MagicMock, patch

from core.rbac.entities import RBACPermission
from services.enterprise import rbac_service
from services.knowledge_fs.product_authorization import DifyKnowledgeFSProductRBACPort
from services.knowledge_fs.product_operations import (
    KNOWLEDGE_FS_RBAC_PERMISSION_KEYS,
    RBAC_PERMISSION_BY_PRODUCT_PERMISSION,
    KnowledgeFSProductPermission,
    product_permissions_from_rbac_keys,
)
from tests.unit_tests.config_override import config_overrides_context


def test_enterprise_knowledge_fs_permissions_use_one_batch_request() -> None:
    response = {
        "data": [
            {"control_space_id": "control-1", "permission_keys": ["dataset_readonly"]},
            {"control_space_id": "control-2", "permission_keys": []},
        ]
    }
    with (
        config_overrides_context(RBAC_ENABLED=True),
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
    assert permissions == {"control-1": ["dataset_readonly"], "control-2": []}


def test_knowledge_fs_capabilities_reuse_the_legacy_dataset_permission_points() -> None:
    """Every KnowledgeFS capability is granted by exactly the dataset point the legacy console uses."""
    assert dict(RBAC_PERMISSION_BY_PRODUCT_PERMISSION) == {
        KnowledgeFSProductPermission.READ: RBACPermission.DATASET_READONLY,
        KnowledgeFSProductPermission.CREATE: RBACPermission.DATASET_CREATE_AND_MANAGEMENT,
        KnowledgeFSProductPermission.EDIT: RBACPermission.DATASET_EDIT,
        KnowledgeFSProductPermission.DELETE: RBACPermission.DATASET_DELETE,
        KnowledgeFSProductPermission.ACCESS_CONFIG: RBACPermission.DATASET_ACCESS_CONFIG,
        KnowledgeFSProductPermission.DOCUMENT_WRITE: RBACPermission.DATASET_EDIT,
        KnowledgeFSProductPermission.QUERY: RBACPermission.DATASET_RETRIEVAL_RECALL,
    }
    assert set(KnowledgeFSProductPermission) == set(RBAC_PERMISSION_BY_PRODUCT_PERMISSION)
    assert KNOWLEDGE_FS_RBAC_PERMISSION_KEYS == (
        "dataset_readonly",
        "dataset_create_and_management",
        "dataset_edit",
        "dataset_delete",
        "dataset_access_config",
        "dataset_retrieval_recall",
    )


def test_rbac_disabled_fallback_grants_every_dataset_point_knowledge_fs_consults() -> None:
    with config_overrides_context(RBAC_ENABLED=False):
        permissions = rbac_service.RBACService.KnowledgeFSPermissions.batch_get(
            "tenant-1", "account-1", ["control-1"], session=MagicMock()
        )

    assert permissions["control-1"] == list(KNOWLEDGE_FS_RBAC_PERMISSION_KEYS)
    assert product_permissions_from_rbac_keys(permissions["control-1"]) == frozenset(KnowledgeFSProductPermission)


def test_dataset_permission_keys_translate_to_capabilities() -> None:
    # dataset_edit covers both settings/content edits and document writes, like the legacy console.
    assert product_permissions_from_rbac_keys(["dataset_edit"]) == frozenset(
        {KnowledgeFSProductPermission.EDIT, KnowledgeFSProductPermission.DOCUMENT_WRITE}
    )
    assert product_permissions_from_rbac_keys(["dataset_retrieval_recall"]) == frozenset(
        {KnowledgeFSProductPermission.QUERY}
    )
    # Unrelated dataset points (or unknown keys) grant nothing.
    assert product_permissions_from_rbac_keys(["dataset_pipeline_test", "dataset_api_key_manage", "nope"]) == (
        frozenset()
    )


def test_legacy_knowledge_space_keys_are_still_accepted_during_the_transition() -> None:
    assert product_permissions_from_rbac_keys(["knowledge_space_read", "knowledge_space_query"]) == frozenset(
        {KnowledgeFSProductPermission.READ, KnowledgeFSProductPermission.QUERY}
    )


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
            "control-1": ["dataset_readonly", "unknown_permission"],
            "control-2": ["dataset_edit"],
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
        "control-2": frozenset({KnowledgeFSProductPermission.EDIT, KnowledgeFSProductPermission.DOCUMENT_WRITE}),
    }


def test_workspace_level_checks_send_the_dataset_scene_like_the_legacy_console() -> None:
    port = DifyKnowledgeFSProductRBACPort()
    with (
        config_overrides_context(RBAC_ENABLED=True),
        patch.object(rbac_service.RBACService.CheckAccess, "check", return_value=True) as check,
    ):
        allowed = port.workspace_permission_allowed(
            tenant_id="tenant-1",
            account_id="account-1",
            permission=KnowledgeFSProductPermission.CREATE,
        )

    assert allowed is True
    check.assert_called_once_with(
        "tenant-1",
        "account-1",
        scene="dataset_create_and_management",
        resource_type="dataset",
        resource_id=None,
    )
