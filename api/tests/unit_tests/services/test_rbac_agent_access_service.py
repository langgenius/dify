"""Unit tests for the RBAC bootstrap applied to a newly created agent."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from unittest.mock import MagicMock, patch

import pytest

from services import rbac_agent_access_service
from services.enterprise import rbac_service as enterprise_rbac_service

MODULE = "services.rbac_agent_access_service"

TENANT = "tenant-1"
AGENT = "agent-1"
CREATOR = "account-1"


@pytest.fixture
def rbac_calls(config_overrides: Callable[..., None]) -> Iterator[MagicMock]:
    config_overrides(RBAC_ENABLED=True)
    recorder = MagicMock()
    with (
        patch(f"{MODULE}.enterprise_rbac_service.RBACService.AgentAccess.replace_whitelist") as replace_whitelist,
        patch(f"{MODULE}.initialize_created_app_rbac_access_task.delay") as seed_task,
        patch(
            f"{MODULE}.enterprise_rbac_service.RBACService.AccessPolicies.sync_creator_access_policy_member_bindings"
        ) as creator_sync,
    ):
        recorder.attach_mock(replace_whitelist, "replace_whitelist")
        recorder.attach_mock(seed_task, "seed_task")
        recorder.attach_mock(creator_sync, "creator_sync")
        yield recorder


def test_initialize_agent_rbac_access_seeds_scope_members_and_creator_policy(
    rbac_calls: MagicMock,
) -> None:
    rbac_agent_access_service.initialize_agent_rbac_access(tenant_id=TENANT, agent_id=AGENT, creator_account_id=CREATOR)

    rbac_calls.replace_whitelist.assert_called_once_with(
        TENANT,
        CREATOR,
        AGENT,
        enterprise_rbac_service.ReplaceMemberBindings(automatic_include_workspace_members=True),
    )
    rbac_calls.seed_task.assert_called_once_with(TENANT, CREATOR, agent_id=AGENT)
    rbac_calls.creator_sync.assert_called_once_with(
        TENANT,
        CREATOR,
        resource_type=enterprise_rbac_service.RBACResourceType.AGENT,
        resource_id=AGENT,
    )

    assert [call[0] for call in rbac_calls.mock_calls] == ["seed_task", "creator_sync", "replace_whitelist"]
