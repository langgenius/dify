"""Unit tests for the RBAC bootstrap applied to a newly created agent."""

from collections.abc import Callable

import pytest

from services import rbac_agent_access_service
from tests.unit_tests.rbac_fakes import Initialization, RBACDomain


def test_initialize_agent_rbac_access_seeds_scope_members_and_creator_policy(
    rbac_domain: RBACDomain, config_overrides: Callable[..., None], monkeypatch: pytest.MonkeyPatch
) -> None:
    config_overrides(RBAC_ENABLED=True)

    def enqueue(tenant_id: str, account_id: str, **resources: str) -> None:
        # The task must be queued before any remote writes.
        assert not rbac_domain.transport.requests
        rbac_domain.tasks.delay(tenant_id, account_id, **resources)

    monkeypatch.setattr(rbac_agent_access_service.initialize_created_app_rbac_access_task, "delay", enqueue)

    rbac_agent_access_service.initialize_agent_rbac_access(
        tenant_id="tenant-1", agent_id="agent-1", creator_account_id="account-1"
    )

    assert rbac_domain.tasks.queued == [Initialization("tenant-1", "account-1", {"agent_id": "agent-1"})]
    creator, whitelist = rbac_domain.transport.requests
    assert creator.endpoint == "/rbac/access-policies/creator-member-bindings"
    assert whitelist.endpoint == "/rbac/agents/whitelist"
    for request in (creator, whitelist):
        assert request.method == "PUT"
        assert (request.tenant_id, request.account_id) == ("tenant-1", "account-1")
    assert creator.params == {"resource_type": "agent", "agent_id": "agent-1"}
    assert whitelist.params == {"agent_id": "agent-1"}
    assert whitelist.json == {"automatic_include_workspace_members": True}
