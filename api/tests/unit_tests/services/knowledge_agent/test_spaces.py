"""The SQL-backed view of which knowledge bases a member's agent connection may read."""

from __future__ import annotations

from collections.abc import Sequence
from typing import override

from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import KnowledgeFSExternalAccessPolicy
from services.knowledge_agent.spaces import SQLKnowledgeAgentSpacePort
from services.knowledge_fs.product_authorization import DifyKnowledgeFSProductRBACPort
from services.knowledge_fs.product_operations import KnowledgeFSProductPermission


class StrictRBAC(DifyKnowledgeFSProductRBACPort):
    """Records lookups and accepts exactly the keyword arguments the RBAC port declares."""

    def __init__(self) -> None:
        self.lookups: list[tuple[str, str, list[str]]] = []

    @override
    def permission_keys_by_control_space(
        self, *, tenant_id: str, account_id: str, control_space_ids: Sequence[str]
    ) -> dict[str, frozenset[KnowledgeFSProductPermission]]:
        self.lookups.append((tenant_id, account_id, list(control_space_ids)))
        return {}


def test_readable_asks_rbac_with_the_arguments_the_port_declares(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """Regression: a stray `session=` argument made every lookup raise TypeError."""
    rbac = StrictRBAC()
    port = SQLKnowledgeAgentSpacePort(sqlite_session_factory, rbac=rbac)
    unknown = "00000000-0000-7000-8000-000000000001"
    assert port.readable(tenant_id="tenant", account_id="account", control_space_ids=[unknown]) == set()
    assert rbac.lookups == [("tenant", "account", [])]
    # No ids means no lookup at all.
    assert port.readable(tenant_id="tenant", account_id="account", control_space_ids=[]) == set()
    assert len(rbac.lookups) == 1


def test_blocked_is_empty_without_policies(sqlite_session_factory: sessionmaker[Session]) -> None:
    port = SQLKnowledgeAgentSpacePort(sqlite_session_factory, rbac=StrictRBAC())
    assert port.blocked(tenant_id="tenant") == set()
    assert port.blocked(tenant_id="tenant", control_space_ids=[]) == set()


def test_blocked_names_the_bases_switched_off_for_personal_agents_in_this_workspace_only(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    tenant, other_tenant = "00000000-0000-7000-8000-0000000000a1", "00000000-0000-7000-8000-0000000000a2"
    off, also_off, on, elsewhere = (f"00000000-0000-7000-8000-00000000000{number}" for number in range(1, 5))
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                KnowledgeFSExternalAccessPolicy(tenant_id=tenant, control_space_id=off, personal_agent_enabled=False),
                KnowledgeFSExternalAccessPolicy(
                    tenant_id=tenant, control_space_id=also_off, personal_agent_enabled=False
                ),
                KnowledgeFSExternalAccessPolicy(tenant_id=tenant, control_space_id=on, personal_agent_enabled=True),
                KnowledgeFSExternalAccessPolicy(
                    tenant_id=other_tenant, control_space_id=elsewhere, personal_agent_enabled=False
                ),
            ]
        )
    port = SQLKnowledgeAgentSpacePort(sqlite_session_factory, rbac=StrictRBAC())
    assert port.blocked(tenant_id=tenant) == {off, also_off}
    # Asked about some bases only, the answer is limited to them, and never crosses workspaces.
    assert port.blocked(tenant_id=tenant, control_space_ids=[off, on, elsewhere]) == {off}
    assert port.blocked(tenant_id=tenant, control_space_ids=[on]) == set()
    assert port.blocked(tenant_id=other_tenant, control_space_ids=[off, elsewhere]) == {elsewhere}
