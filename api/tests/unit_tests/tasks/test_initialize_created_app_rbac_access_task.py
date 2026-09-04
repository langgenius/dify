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


@pytest.mark.parametrize(
    ("id_kwarg", "resource_id", "access_class"),
    [
        ("app_id", "app-1", "AppAccess"),
        ("dataset_id", "dataset-1", "DatasetAccess"),
        ("agent_id", "agent-1", "AgentAccess"),
    ],
)
def test_initialize_created_app_rbac_access_task_targets_the_resource_that_was_passed(
    monkeypatch: pytest.MonkeyPatch, id_kwarg: str, resource_id: str, access_class: str
):
    import tasks.initialize_created_app_rbac_access_task as task_module

    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    monkeypatch.setattr(
        task_module.TenantService,
        "iter_member_account_id_batches",
        lambda tenant_id, batch_size, session: iter([["acct-1"]]),
    )
    rbac_service = task_module.enterprise_rbac_service.RBACService
    access_clients = {
        "AppAccess": rbac_service.AppAccess,
        "DatasetAccess": rbac_service.DatasetAccess,
        "AgentAccess": rbac_service.AgentAccess,
    }
    replace_calls = {}
    for name, client in access_clients.items():
        replace_calls[name] = MagicMock()
        monkeypatch.setattr(client, "replace_user_access_policies", replace_calls[name])

    initialize_created_app_rbac_access_task.run("tenant-1", "actor-1", **{id_kwarg: resource_id})

    for name, mock in replace_calls.items():
        if name != access_class:
            mock.assert_not_called()

    called = replace_calls[access_class]
    called.assert_called_once()
    assert called.call_args.kwargs[id_kwarg] == resource_id
    assert called.call_args.kwargs["target_account_id"] is None
    assert called.call_args.kwargs["payload"].account_ids == ["acct-1"]


@pytest.mark.parametrize(
    "kwargs",
    [
        {},
        {"app_id": "app-1", "dataset_id": "dataset-1"},
        {"app_id": "app-1", "agent_id": "agent-1"},
        {"app_id": "app-1", "dataset_id": "dataset-1", "agent_id": "agent-1"},
    ],
)
def test_initialize_created_app_rbac_access_task_rejects_anything_but_one_resource_id(
    monkeypatch: pytest.MonkeyPatch, kwargs: dict[str, str]
):
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)

    with pytest.raises(ValueError, match="exactly one of"):
        initialize_created_app_rbac_access_task.run("tenant-1", "actor-1", **kwargs)


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
        rbac.ResourceWhitelistConfigResource(resource_type=rbac.RBACResourceType.AGENT, resource_id="agent-1"),
        rbac.ResourceWhitelistConfigResource(resource_type=rbac.RBACResourceType.AGENT, resource_id="agent-2"),
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
            rbac.ResourceWhitelistConfigItem(
                resource_type=rbac.RBACResourceType.AGENT,
                resource_id="agent-1",
                automatic_include_workspace_members=True,
            ),
            rbac.ResourceWhitelistConfigItem(
                resource_type=rbac.RBACResourceType.AGENT,
                resource_id="agent-2",
                automatic_include_workspace_members=False,
            ),
        ]
    )
    batch_get = MagicMock(return_value=configs)
    app_append = MagicMock()
    dataset_append = MagicMock()
    agent_append = MagicMock()

    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    monkeypatch.setattr(task_module, "_iter_resource_config_batches", lambda tenant_id, batch_size: iter([resources]))
    monkeypatch.setattr(rbac.RBACService.ResourceWhitelistConfigs, "batch_get", batch_get)
    monkeypatch.setattr(rbac.RBACService.AppAccess, "append_whitelist_members_batch", app_append)
    monkeypatch.setattr(rbac.RBACService.DatasetAccess, "append_whitelist_members_batch", dataset_append)
    monkeypatch.setattr(rbac.RBACService.AgentAccess, "append_whitelist_members_batch", agent_append)

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

    agent_append.assert_called_once()
    agent_call = agent_append.call_args.kwargs
    assert agent_call["tenant_id"] == "tenant-1"
    assert agent_call["account_id"] == "actor-1"
    assert [item.agent_id for item in agent_call["data"]] == ["agent-1"]
    assert agent_call["data"][0].account_ids == ["member-1"]
    assert agent_call["data"][0].policy_id == task_module.APP_RBAC_DEFAULT_ACCESS_POLICY_ID


def test_agent_whitelist_append_targets_agent_inner_route(monkeypatch: pytest.MonkeyPatch):
    from services.enterprise import rbac_service as rbac

    inner_call = MagicMock(return_value=None)
    monkeypatch.setattr(rbac, "_inner_call", inner_call)
    item = rbac.AppendAgentWhitelistMembersBatchItem(agent_id="agent-1", account_ids=["member-1"], policy_id="default")

    rbac.RBACService.AgentAccess.append_whitelist_members_batch(tenant_id="tenant-1", account_id="actor-1", data=[item])

    inner_call.assert_called_once()
    assert inner_call.call_args.args[1].endswith("/agents/whitelist/members/batch")
    assert inner_call.call_args.kwargs["json"] == {"data": [item.model_dump(mode="json")]}
