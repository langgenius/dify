"""Task behavior with real workspace queries and an explicit RBAC transport."""

from collections.abc import Callable, Iterator
from typing import Protocol, cast

import pytest
from flask import Flask

import tasks.initialize_created_app_rbac_access_task as task_module
from enums import DeploymentEdition
from enums.account import TenantAccountRole
from extensions.ext_application_services import build_application_services
from extensions.ext_redis import redis_client
from models import TenantAccountJoin
from services.rbac import contracts as dto
from tasks.initialize_created_app_rbac_access_task import (
    initialize_created_app_rbac_access_task,
    sync_joined_workspace_member_rbac_access_task,
)
from tests.unit_tests.rbac_fakes import RBACDomain


class _TaskWithQueue(Protocol):
    queue: str


@pytest.fixture(autouse=True)
def workspace_services(
    monkeypatch: pytest.MonkeyPatch,
    app: Flask,
    rbac_domain: RBACDomain,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(RBAC_ENABLED=True)
    services = build_application_services(
        database_client=rbac_domain.sessions,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=redis_client,
    )
    monkeypatch.setitem(app.extensions, "application_services", services)


def _seed_members(domain: RBACDomain, members: tuple[str, ...]) -> None:
    with domain.sessions.begin() as session:
        for account_id in members:
            membership = TenantAccountJoin(tenant_id="tenant-1", account_id=account_id, role=TenantAccountRole.NORMAL)
            membership.id = account_id
            session.add(membership)
        session.add(TenantAccountJoin(tenant_id="other", account_id="foreign", role=TenantAccountRole.NORMAL))


def test_initialize_created_app_rbac_access_task_uses_rbac_queue() -> None:
    task = cast(_TaskWithQueue, initialize_created_app_rbac_access_task)
    assert task.queue == "app_rbac"


def test_sync_joined_workspace_member_rbac_access_task_uses_rbac_queue() -> None:
    task = cast(_TaskWithQueue, sync_joined_workspace_member_rbac_access_task)
    assert task.queue == "app_rbac"


def test_initialize_created_app_rbac_access_task_batches_workspace_members(
    monkeypatch: pytest.MonkeyPatch, rbac_domain: RBACDomain
) -> None:
    _seed_members(rbac_domain, ("acct-1", "acct-2", "acct-3"))
    monkeypatch.setattr(task_module, "APP_RBAC_ACCOUNT_POLICY_BATCH_SIZE", 2)

    initialize_created_app_rbac_access_task.run("tenant-1", "actor-1", "app-1")

    first, second = rbac_domain.transport.requests
    for request, account_ids in ((first, ["acct-1", "acct-2"]), (second, ["acct-3"])):
        assert request.method == "PUT"
        assert request.endpoint == "/rbac/apps/user-access-policies"
        assert (request.tenant_id, request.account_id) == ("tenant-1", "actor-1")
        assert request.params == {"app_id": "app-1", "account_id": None}
        assert request.json == {
            "account_ids": account_ids,
            "access_policy_ids": [task_module.APP_RBAC_DEFAULT_ACCESS_POLICY_ID],
        }


@pytest.mark.parametrize("kind", ["app", "dataset", "agent"])
def test_initialize_created_app_rbac_access_task_targets_the_resource_that_was_passed(
    rbac_domain: RBACDomain, kind: str
) -> None:
    _seed_members(rbac_domain, ("acct-1",))
    resource_id = f"{kind}-1"

    initialize_created_app_rbac_access_task.run("tenant-1", "actor-1", **{f"{kind}_id": resource_id})

    request = rbac_domain.transport.only_request
    assert (request.method, request.endpoint) == ("PUT", f"/rbac/{kind}s/user-access-policies")
    assert (request.tenant_id, request.account_id) == ("tenant-1", "actor-1")
    assert request.params == {f"{kind}_id": resource_id, "account_id": None}
    assert request.json == {"account_ids": ["acct-1"], "access_policy_ids": ["default"]}


def test_initialize_created_app_rbac_access_task_retries_on_failure(
    monkeypatch: pytest.MonkeyPatch, rbac_domain: RBACDomain
) -> None:
    _seed_members(rbac_domain, ("acct-1",))
    failure = ConnectionError("RBAC unavailable")
    rbac_domain.transport.failure = failure
    retries: list[Exception] = []

    def retry(*, exc: Exception) -> RuntimeError:
        retries.append(exc)
        return RuntimeError("retry requested")

    monkeypatch.setattr(initialize_created_app_rbac_access_task, "retry", retry)

    with pytest.raises(RuntimeError, match="retry requested"):
        initialize_created_app_rbac_access_task.run("tenant-1", "actor-1", "app-1")

    assert retries == [failure]
    assert rbac_domain.transport.only_request.endpoint == "/rbac/apps/user-access-policies"


def test_sync_joined_workspace_member_rbac_access_task_appends_auto_included_resources(
    monkeypatch: pytest.MonkeyPatch, rbac_domain: RBACDomain
) -> None:
    resources = [
        dto.ResourceWhitelistConfigResource(resource_type=kind, resource_id=resource_id)
        for kind, resource_id in (
            (dto.RBACResourceType.APP, "app-1"),
            (dto.RBACResourceType.DATASET, "dataset-1"),
            (dto.RBACResourceType.APP, "app-2"),
            (dto.RBACResourceType.AGENT, "agent-1"),
            (dto.RBACResourceType.AGENT, "agent-2"),
        )
    ]

    def resource_batches(tenant_id: str, batch_size: int) -> Iterator[list[dto.ResourceWhitelistConfigResource]]:
        assert tenant_id == "tenant-1"
        assert batch_size == task_module.APP_RBAC_RESOURCE_CONFIG_BATCH_SIZE
        yield resources

    configs = dto.ResourceWhitelistConfigsResponse(
        data=[
            dto.ResourceWhitelistConfigItem(
                resource_type=resource.resource_type,
                resource_id=resource.resource_id,
                automatic_include_workspace_members=resource.resource_id.endswith("-1"),
            )
            for resource in resources
        ]
    )
    rbac_domain.transport.responses["/rbac/whitelist/configs"] = configs.model_dump(mode="json")
    monkeypatch.setattr(task_module, "_iter_resource_config_batches", resource_batches)

    sync_joined_workspace_member_rbac_access_task.run("tenant-1", "member-1", "actor-1")

    lookup, *appends = rbac_domain.transport.requests
    assert (lookup.method, lookup.endpoint) == ("POST", "/rbac/whitelist/configs")
    assert lookup.json == {"resources": [resource.model_dump(mode="json") for resource in resources]}
    assert len(appends) == 3
    for kind, request in zip(("app", "dataset", "agent"), appends, strict=True):
        assert (request.method, request.endpoint) == ("POST", f"/rbac/{kind}s/whitelist/members/batch")
        assert request.json == {
            "data": [{f"{kind}_id": f"{kind}-1", "account_ids": ["member-1"], "policy_id": "default"}]
        }
    for request in (lookup, *appends):
        assert (request.tenant_id, request.account_id) == ("tenant-1", "actor-1")
