"""Workspace orchestration without Flask or ORM dependencies."""

from dataclasses import replace
from datetime import datetime
from unittest.mock import Mock

import pytest

from enums import CloudPlan
from machinery.context import RequestContext
from services.errors.file import UnsupportedFileTypeError
from services.errors.workspace import WorkspaceArchivedError, WorkspaceNotFoundError
from services.workspace.contracts import (
    EffectiveCreditPool,
    WorkspaceCustomConfig,
    WorkspaceCustomConfigChanges,
    WorkspaceFeatures,
    WorkspaceSnapshot,
)
from services.workspace.service import (
    WorkspaceFeatureGateway,
    WorkspaceLogoGateway,
    WorkspaceService,
    WorkspaceStore,
)

CONTEXT = RequestContext("request", None, "account", "workspace")
WORKSPACE = WorkspaceSnapshot(
    "workspace", "Test", "normal", datetime(2026, 1, 1), "editor", WorkspaceCustomConfig(True, "stored-logo"), True
)


@pytest.fixture
def dependencies() -> tuple[WorkspaceService, Mock, Mock, Mock]:
    store = Mock(spec=WorkspaceStore)
    features = Mock(spec=WorkspaceFeatureGateway)
    logos = Mock(spec=WorkspaceLogoGateway)
    store.get_for_account.return_value = WORKSPACE
    features.logo_url.return_value = "https://files/workspaces/workspace/webapp-logo"
    features.get_features.return_value = WorkspaceFeatures(True, EffectiveCreditPool())
    return (WorkspaceService(workspaces=store, features=features, logos=logos), store, features, logos)


@pytest.mark.parametrize(
    ("plan", "limit", "used", "remaining"),
    [
        (CloudPlan.SANDBOX, 100, 30, 70),
        (CloudPlan.TEAM, -1, 999, -1),
        (CloudPlan.TEAM, 10, 20, 0),
        (None, None, None, None),
    ],
)
def test_summary_uses_context_identity_and_credit_snapshot(
    dependencies: tuple[WorkspaceService, Mock, Mock, Mock],
    plan: CloudPlan | None,
    limit: int | None,
    used: int | None,
    remaining: int | None,
) -> None:
    service, store, features, _ = dependencies
    features.get_effective_credit_pool.return_value = EffectiveCreditPool(plan=plan, quota_limit=limit, quota_used=used)
    assert service.current_summary(CONTEXT) == {
        "id": "workspace",
        "name": "Test",
        "role": "editor",
        "plan": plan,
        "credits": remaining,
    }
    store.get_for_account.assert_called_once_with("workspace", "account")


def test_archived_workspace_does_not_read_billing(dependencies: tuple[WorkspaceService, Mock, Mock, Mock]) -> None:
    service, store, features, _ = dependencies
    store.get_for_account.return_value = replace(WORKSPACE, status="archive")
    with pytest.raises(WorkspaceArchivedError):
        service.current_summary(CONTEXT)
    features.get_effective_credit_pool.assert_not_called()


def test_missing_workspace(dependencies: tuple[WorkspaceService, Mock, Mock, Mock]) -> None:
    service, store, _, _ = dependencies
    store.get_for_account.return_value = None
    with pytest.raises(WorkspaceNotFoundError):
        service.custom_config(CONTEXT)


@pytest.mark.parametrize(
    ("changes", "expected"),
    [
        (WorkspaceCustomConfigChanges(None, None), WorkspaceCustomConfig(True, "stored-logo")),
        (WorkspaceCustomConfigChanges(False, None), WorkspaceCustomConfig(False, "stored-logo")),
        (WorkspaceCustomConfigChanges(None, ""), WorkspaceCustomConfig(True, "")),
        (WorkspaceCustomConfigChanges(None, "new-logo"), WorkspaceCustomConfig(True, "new-logo")),
    ],
)
def test_config_patch_preserves_omitted_fields_and_honors_false_and_empty(
    dependencies: tuple[WorkspaceService, Mock, Mock, Mock],
    changes: WorkspaceCustomConfigChanges,
    expected: WorkspaceCustomConfig,
) -> None:
    service, store, _, _ = dependencies
    store.update_custom_config.return_value = replace(WORKSPACE, custom_config=expected)
    service.update_custom_config(CONTEXT, changes)
    store.update_custom_config.assert_called_once_with(workspace_id="workspace", account_id="account", changes=expected)


@pytest.mark.parametrize(
    ("can_replace", "has_manager", "includes_config"), [(True, True, True), (True, False, False), (False, True, False)]
)
def test_tenant_info_preserves_workspace_brand_visibility(
    dependencies: tuple[WorkspaceService, Mock, Mock, Mock], can_replace: bool, has_manager: bool, includes_config: bool
) -> None:
    service, store, features, _ = dependencies
    store.rename.return_value = replace(WORKSPACE, has_privileged_member=has_manager)
    features.get_features.return_value = WorkspaceFeatures(can_replace, EffectiveCreditPool())
    result = service.rename(CONTEXT, "New")
    assert ("custom_config" in result) is includes_config
    assert result["plan"] is None
    assert "trial_credits" not in result


def test_switch_serializes_effective_exhausted_pool(dependencies: tuple[WorkspaceService, Mock, Mock, Mock]) -> None:
    service, store, features, _ = dependencies
    store.switch.return_value = WORKSPACE
    features.get_features.return_value = WorkspaceFeatures(
        True, EffectiveCreditPool(CloudPlan.TEAM, "trial", 100, 100, 1770000000, 1780000000)
    )
    result = service.switch(CONTEXT, "target")
    assert result["trial_credits"] == 100
    assert result["trial_credits_used"] == 100
    assert result["trial_credits_exhausted_at"] == 1770000000
    assert result["next_credit_reset_date"] == 1780000000
    store.switch.assert_called_once_with(account_id="account", workspace_id="target")


@pytest.mark.parametrize("filename", ["logo.jpg", "file.txt", "logo"])
def test_invalid_logo_never_reaches_storage(
    dependencies: tuple[WorkspaceService, Mock, Mock, Mock], filename: str
) -> None:
    service, _, _, logos = dependencies
    with pytest.raises(UnsupportedFileTypeError):
        service.upload_logo(CONTEXT, filename=filename, content=b"data", mimetype="image/jpeg")
    logos.upload.assert_not_called()


def test_logo_delegation(dependencies: tuple[WorkspaceService, Mock, Mock, Mock]) -> None:
    service, _, _, logos = dependencies
    logos.upload.return_value = "file-id"
    assert service.upload_logo(CONTEXT, filename="logo.SVG", content=b"<svg/>", mimetype="image/svg+xml") == "file-id"
    logos.upload.assert_called_once_with(CONTEXT, filename="logo.SVG", content=b"<svg/>", mimetype="image/svg+xml")
