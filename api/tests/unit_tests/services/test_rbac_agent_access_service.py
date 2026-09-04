"""Unit tests for the RBAC bootstrap applied to a newly created agent."""

from __future__ import annotations

import logging
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
def rbac_calls(config_overrides: Callable[..., None]) -> Iterator[tuple[MagicMock, MagicMock, MagicMock]]:
    config_overrides(RBAC_ENABLED=True)
    with (
        patch(f"{MODULE}.enterprise_rbac_service.RBACService.AgentAccess.replace_whitelist") as replace_whitelist,
        patch(f"{MODULE}.initialize_created_app_rbac_access_task.delay") as seed_task,
        patch(
            f"{MODULE}.enterprise_rbac_service.RBACService.AccessPolicies.sync_creator_access_policy_member_bindings"
        ) as creator_sync,
    ):
        yield replace_whitelist, seed_task, creator_sync


def test_initialize_agent_rbac_access_seeds_scope_members_and_creator_policy(
    rbac_calls: tuple[MagicMock, MagicMock, MagicMock],
) -> None:
    replace_whitelist, seed_task, creator_sync = rbac_calls

    rbac_agent_access_service.initialize_agent_rbac_access(tenant_id=TENANT, agent_id=AGENT, creator_account_id=CREATOR)

    replace_whitelist.assert_called_once_with(
        TENANT,
        CREATOR,
        AGENT,
        enterprise_rbac_service.ReplaceMemberBindings(automatic_include_workspace_members=True),
    )
    seed_task.assert_called_once_with(TENANT, CREATOR, agent_id=AGENT)
    creator_sync.assert_called_once_with(
        TENANT,
        CREATOR,
        resource_type=enterprise_rbac_service.RBACResourceType.AGENT,
        resource_id=AGENT,
    )


def test_initialize_agent_rbac_access_does_nothing_when_rbac_is_disabled(
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(RBAC_ENABLED=False)
    with (
        patch(f"{MODULE}.enterprise_rbac_service.RBACService.AgentAccess.replace_whitelist") as replace_whitelist,
        patch(f"{MODULE}.initialize_created_app_rbac_access_task.delay") as seed_task,
        patch(
            f"{MODULE}.enterprise_rbac_service.RBACService.AccessPolicies.sync_creator_access_policy_member_bindings"
        ) as creator_sync,
    ):
        rbac_agent_access_service.initialize_agent_rbac_access(
            tenant_id=TENANT, agent_id=AGENT, creator_account_id=CREATOR
        )

    replace_whitelist.assert_not_called()
    seed_task.assert_not_called()
    creator_sync.assert_not_called()


def test_initialize_agent_rbac_access_logs_and_does_not_raise_when_rbac_is_down(
    rbac_calls: tuple[MagicMock, MagicMock, MagicMock],
    caplog: pytest.LogCaptureFixture,
) -> None:
    replace_whitelist, seed_task, creator_sync = rbac_calls
    replace_whitelist.side_effect = RuntimeError("rbac unavailable")

    with caplog.at_level(logging.WARNING, logger=MODULE):
        rbac_agent_access_service.initialize_agent_rbac_access(
            tenant_id=TENANT, agent_id=AGENT, creator_account_id=CREATOR
        )

    seed_task.assert_not_called()
    creator_sync.assert_not_called()
    assert AGENT in caplog.text
