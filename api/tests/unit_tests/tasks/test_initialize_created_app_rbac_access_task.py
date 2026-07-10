from unittest.mock import MagicMock

import pytest

APP_RBAC_QUEUE = "app_rbac"


def test_initialize_created_app_rbac_access_task_uses_rbac_queue():
    from tasks.initialize_created_app_rbac_access_task import initialize_created_app_rbac_access_task

    assert initialize_created_app_rbac_access_task.queue == APP_RBAC_QUEUE


def test_initialize_created_app_rbac_access_task_batches_workspace_members(monkeypatch):
    import tasks.initialize_created_app_rbac_access_task as task_module
    from tasks.initialize_created_app_rbac_access_task import initialize_created_app_rbac_access_task

    monkeypatch.setattr(task_module.dify_config, "RBAC_ENABLED", True)
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

    replace_whitelist.assert_called_once()
    assert replace_whitelist.call_args.kwargs["payload"].scope is task_module.RBACResourceWhitelistScope.ALL
    assert replace_user_access_policies.call_count == 2
    assert replace_user_access_policies.call_args_list[0].kwargs["payload"].account_ids == ["acct-1", "acct-2"]
    assert replace_user_access_policies.call_args_list[1].kwargs["payload"].account_ids == ["acct-3"]
    for call in replace_user_access_policies.call_args_list:
        assert call.kwargs["payload"].access_policy_ids == [task_module.APP_RBAC_DEFAULT_ACCESS_POLICY_ID]


def test_initialize_created_app_rbac_access_task_retries_on_failure(monkeypatch):
    import tasks.initialize_created_app_rbac_access_task as task_module
    from tasks.initialize_created_app_rbac_access_task import initialize_created_app_rbac_access_task

    monkeypatch.setattr(task_module.dify_config, "RBAC_ENABLED", True)
    monkeypatch.setattr(
        task_module.enterprise_rbac_service.RBACService.AppAccess,
        "replace_whitelist",
        MagicMock(side_effect=ConnectionError("RBAC unavailable")),
    )
    retry = MagicMock(return_value=RuntimeError("retry requested"))
    monkeypatch.setattr(initialize_created_app_rbac_access_task, "retry", retry)

    with pytest.raises(RuntimeError, match="retry requested"):
        initialize_created_app_rbac_access_task.run("tenant-1", "actor-1", "app-1")

    retry.assert_called_once()
    assert isinstance(retry.call_args.kwargs["exc"], ConnectionError)
