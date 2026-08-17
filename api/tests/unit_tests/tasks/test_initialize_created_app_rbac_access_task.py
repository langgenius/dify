from unittest.mock import MagicMock

import pytest

from tasks.initialize_created_app_rbac_access_task import initialize_created_app_rbac_access_task
from tests.unit_tests.config_override import apply_config_overrides

APP_RBAC_QUEUE = "app_rbac"


def test_initialize_created_app_rbac_access_task_uses_rbac_queue():
    assert initialize_created_app_rbac_access_task.queue == APP_RBAC_QUEUE


def test_sync_joined_workspace_member_rbac_access_task_uses_rbac_queue():
    from tasks.initialize_created_app_rbac_access_task import sync_joined_workspace_member_rbac_access_task

    assert sync_joined_workspace_member_rbac_access_task.queue == APP_RBAC_QUEUE


def test_initialize_created_app_rbac_access_task_batches_workspace_members(monkeypatch: pytest.MonkeyPatch):
    import tasks.initialize_created_app_rbac_access_task as task_module
    from tasks.initialize_created_app_rbac_access_task import initialize_created_app_rbac_access_task

    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    monkeypatch.setattr(
        task_module.TenantService,
        "iter_member_account_id_batches",
        lambda tenant_id, batch_size, session: iter([["acct-1", "acct-2"], ["acct-3"]]),
    )
    replace_whitelist = MagicMock()
    replace_user_access_policies = MagicMock()
    monkeypatch.setattr(
        task_module.enterprise_rbac_service.RBACService.AppAccess,
        "replace_whitelist",
        replace_whitelist,
    )
    monkeypatch.setattr(
        task_module.enterprise_rbac_service.RBACService.AppAccess,
        "replace_user_access_policies",
        replace_user_access_policies,
    )

    initialize_created_app_rbac_access_task.run("tenant-1", "actor-1", "app-1")

    replace_whitelist.assert_not_called()
    assert replace_user_access_policies.call_count == 2
    assert replace_user_access_policies.call_args_list[0].kwargs["payload"].account_ids == ["acct-1", "acct-2"]
    assert replace_user_access_policies.call_args_list[1].kwargs["payload"].account_ids == ["acct-3"]
    for call in replace_user_access_policies.call_args_list:
        assert call.kwargs["payload"].access_policy_ids == [task_module.APP_RBAC_DEFAULT_ACCESS_POLICY_ID]


def test_initialize_created_app_rbac_access_task_retries_on_failure(monkeypatch: pytest.MonkeyPatch):
    import tasks.initialize_created_app_rbac_access_task as task_module
    from tasks.initialize_created_app_rbac_access_task import initialize_created_app_rbac_access_task

    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    monkeypatch.setattr(
        task_module.TenantService,
        "iter_member_account_id_batches",
        lambda tenant_id, batch_size, session: iter([["acct-1"]]),
    )
    monkeypatch.setattr(
        task_module.enterprise_rbac_service.RBACService.AppAccess,
        "replace_user_access_policies",
        MagicMock(side_effect=ConnectionError("RBAC unavailable")),
    )
    retry = MagicMock(return_value=RuntimeError("retry requested"))
    monkeypatch.setattr(initialize_created_app_rbac_access_task, "retry", retry)

    with pytest.raises(RuntimeError, match="retry requested"):
        initialize_created_app_rbac_access_task.run("tenant-1", "actor-1", "app-1")

    retry.assert_called_once()
    assert isinstance(retry.call_args.kwargs["exc"], ConnectionError)


def test_sync_joined_workspace_member_rbac_access_task_appends_auto_included_resources(
    monkeypatch: pytest.MonkeyPatch,
):
    import tasks.initialize_created_app_rbac_access_task as task_module
    from tasks.initialize_created_app_rbac_access_task import sync_joined_workspace_member_rbac_access_task

    rbac = task_module.enterprise_rbac_service
    resources = [
        rbac.ResourceWhitelistConfigResource(resource_type=rbac.RBACResourceType.APP, resource_id="app-1"),
        rbac.ResourceWhitelistConfigResource(resource_type=rbac.RBACResourceType.DATASET, resource_id="dataset-1"),
        rbac.ResourceWhitelistConfigResource(resource_type=rbac.RBACResourceType.APP, resource_id="app-2"),
    ]
    configs = rbac.ResourceWhitelistConfigsResponse(
        data=[
            rbac.ResourceWhitelistConfigItem(
                resource_type=rbac.RBACResourceType.APP,
                resource_id="app-1",
                automatic_include_workspace_members=True,
            ),
            rbac.ResourceWhitelistConfigItem(
                resource_type=rbac.RBACResourceType.DATASET,
                resource_id="dataset-1",
                automatic_include_workspace_members=True,
            ),
            rbac.ResourceWhitelistConfigItem(
                resource_type=rbac.RBACResourceType.APP,
                resource_id="app-2",
                automatic_include_workspace_members=False,
            ),
        ]
    )
    batch_get = MagicMock(return_value=configs)
    app_append = MagicMock()
    dataset_append = MagicMock()

    monkeypatch.setattr(task_module.dify_config, "RBAC_ENABLED", True)
    monkeypatch.setattr(task_module, "_iter_resource_config_batches", lambda tenant_id, batch_size: iter([resources]))
    monkeypatch.setattr(rbac.RBACService.ResourceWhitelistConfigs, "batch_get", batch_get)
    monkeypatch.setattr(rbac.RBACService.AppAccess, "append_whitelist_members_batch", app_append)
    monkeypatch.setattr(rbac.RBACService.DatasetAccess, "append_whitelist_members_batch", dataset_append)

    sync_joined_workspace_member_rbac_access_task.run("tenant-1", "member-1", "actor-1")

    batch_get.assert_called_once_with(
        tenant_id="tenant-1",
        account_id="actor-1",
        resources=resources,
    )
    app_append.assert_called_once()
    app_call = app_append.call_args.kwargs
    assert app_call["tenant_id"] == "tenant-1"
    assert app_call["account_id"] == "actor-1"
    assert len(app_call["data"]) == 1
    assert app_call["data"][0].app_id == "app-1"
    assert app_call["data"][0].account_ids == ["member-1"]
    assert app_call["data"][0].policy_id == task_module.APP_RBAC_DEFAULT_ACCESS_POLICY_ID

    dataset_append.assert_called_once()
    dataset_call = dataset_append.call_args.kwargs
    assert dataset_call["tenant_id"] == "tenant-1"
    assert dataset_call["account_id"] == "actor-1"
    assert len(dataset_call["data"]) == 1
    assert dataset_call["data"][0].dataset_id == "dataset-1"
    assert dataset_call["data"][0].account_ids == ["member-1"]
    assert dataset_call["data"][0].policy_id == task_module.APP_RBAC_DEFAULT_ACCESS_POLICY_ID
