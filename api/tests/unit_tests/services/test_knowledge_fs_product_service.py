from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import (
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpacePermission,
    KnowledgeFSControlSpacePermissionRole,
    KnowledgeFSControlSpaceState,
    KnowledgeFSControlSpaceVisibility,
)
from services.knowledge_fs.batch_capability import (
    KnowledgeFSBatchSpaceBinding,
    KnowledgeFSIssuedBatchCapability,
)
from services.knowledge_fs.product_authorization import (
    KnowledgeFSProductNotFoundError,
)
from services.knowledge_fs.product_dto import KnowledgeFSTechnicalSummary
from services.knowledge_fs.product_operations import KnowledgeFSProductPermission
from services.knowledge_fs.product_remote import (
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSRemoteJSONRequest,
)
from services.knowledge_fs.product_service import KnowledgeFSProductService


class FakeRBAC:
    def __init__(self, denied_ids: set[str] | None = None):
        self.denied_ids = denied_ids or set()
        self.batch_calls: list[tuple[str, ...]] = []

    def permission_keys_by_control_space(
        self,
        *,
        session: Session,
        tenant_id: str,
        account_id: str,
        control_space_ids: Sequence[str],
    ) -> dict[str, frozenset[KnowledgeFSProductPermission]]:
        _ = (session, tenant_id, account_id)
        self.batch_calls.append(tuple(control_space_ids))
        return {
            control_space_id: frozenset(KnowledgeFSProductPermission)
            for control_space_id in control_space_ids
            if control_space_id not in self.denied_ids
        }

    def filter_authorized_control_space_ids(
        self,
        *,
        session: Session,
        tenant_id: str,
        account_id: str,
        control_space_ids: Sequence[str],
        permission: KnowledgeFSProductPermission,
    ) -> frozenset[str]:
        permissions = self.permission_keys_by_control_space(
            session=session,
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_ids=control_space_ids,
        )
        return frozenset(
            control_space_id
            for control_space_id, permission_keys in permissions.items()
            if permission in permission_keys
        )

    def workspace_permission_allowed(
        self,
        *,
        tenant_id: str,
        account_id: str,
        permission: KnowledgeFSProductPermission,
    ) -> bool:
        _ = (tenant_id, account_id, permission)
        return True


class FakeRemote:
    def __init__(self, summaries: dict[str, KnowledgeFSTechnicalSummary]):
        self.summaries = summaries
        self.batch_calls: list[tuple[str, ...]] = []
        self.json_calls: list[KnowledgeFSRemoteJSONRequest] = []

    def batch_space_summaries(
        self,
        *,
        namespace_id: str,
        knowledge_space_ids: tuple[str, ...],
        capability_token: str,
        trace_id: str,
    ) -> dict[str, KnowledgeFSTechnicalSummary]:
        _ = (namespace_id, trace_id)
        assert capability_token == "batch-capability"
        self.batch_calls.append(knowledge_space_ids)
        return dict(self.summaries)

    def execute_json(self, request: KnowledgeFSRemoteJSONRequest):
        self.json_calls.append(request)
        raise AssertionError("not used")


class FakeBatchCapabilities:
    def __init__(self, *, fail: bool = False) -> None:
        self.calls: list[tuple[KnowledgeFSBatchSpaceBinding, ...]] = []
        self.fail = fail

    def issue_interactive(
        self,
        *,
        tenant_id: str,
        account_id: str,
        bindings: tuple[KnowledgeFSBatchSpaceBinding, ...],
        trace_id: str,
    ) -> KnowledgeFSIssuedBatchCapability:
        assert tenant_id == "tenant-1"
        assert account_id == "account-1"
        self.calls.append(bindings)
        if self.fail:
            raise RuntimeError("issuer unavailable")
        return KnowledgeFSIssuedBatchCapability(
            token="batch-capability",
            expires_at=datetime(2030, 1, 1, tzinfo=UTC),
            knowledge_space_ids=tuple(binding.knowledge_space_id for binding in bindings),
            trace_id=trace_id,
        )


class FakeCutoverGate:
    def __init__(self, *, enabled: bool = True) -> None:
        self.enabled = enabled
        self.calls: list[str] = []

    def require_product_routes(self, *, tenant_id: str) -> None:
        self.calls.append(tenant_id)
        if not self.enabled:
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS Workspace is not cut over for product traffic")

    def require_capability_v2(self, *, tenant_id: str) -> None:
        _ = tenant_id


def _space(
    *,
    tenant_id: str = "tenant-1",
    owner: str = "owner-1",
    visibility: KnowledgeFSControlSpaceVisibility,
    key: str,
    remote_id: str,
) -> KnowledgeFSControlSpace:
    return KnowledgeFSControlSpace(
        tenant_id=tenant_id,
        owner_account_id=owner,
        provisioning_key=key,
        knowledge_space_id=remote_id,
        state=KnowledgeFSControlSpaceState.ACTIVE,
        visibility=visibility,
    )


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSControlSpacePermission)],
    indirect=True,
)
def test_list_filters_locally_then_fetches_one_explicit_authorized_batch(sqlite_session: Session) -> None:
    owner = _space(
        owner="account-1",
        visibility=KnowledgeFSControlSpaceVisibility.ONLY_ME,
        key="owner",
        remote_id="space-owner",
    )
    all_team = _space(
        visibility=KnowledgeFSControlSpaceVisibility.ALL_TEAM_MEMBERS,
        key="all",
        remote_id="space-all",
    )
    partial = _space(
        visibility=KnowledgeFSControlSpaceVisibility.PARTIAL_MEMBERS,
        key="partial",
        remote_id="space-partial",
    )
    hidden = _space(
        visibility=KnowledgeFSControlSpaceVisibility.PARTIAL_MEMBERS,
        key="hidden",
        remote_id="space-hidden",
    )
    cross_tenant = _space(
        tenant_id="tenant-2",
        visibility=KnowledgeFSControlSpaceVisibility.ALL_TEAM_MEMBERS,
        key="cross",
        remote_id="space-cross",
    )
    sqlite_session.add_all([owner, all_team, partial, hidden, cross_tenant])
    sqlite_session.flush()
    sqlite_session.add(
        KnowledgeFSControlSpacePermission(
            tenant_id="tenant-1",
            control_space_id=partial.id,
            account_id="account-1",
            role=KnowledgeFSControlSpacePermissionRole.VIEWER,
        )
    )
    sqlite_session.commit()
    summary = KnowledgeFSTechnicalSummary(
        knowledge_space_id="space-owner",
        revision=1,
        name="Owner space",
        slug="owner-space",
    )
    remote = FakeRemote({"space-owner": summary, "space-hidden": summary})
    batch_capabilities = FakeBatchCapabilities()
    rbac = FakeRBAC()
    metrics = MagicMock()
    clock = iter((10.0, 10.25))
    service = KnowledgeFSProductService(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        batch_capabilities=batch_capabilities,
        cutover_gate=FakeCutoverGate(),
        remote=remote,
        rbac=rbac,
        metrics=metrics,
        clock=lambda: next(clock),
    )

    response = service.list_spaces(tenant_id="tenant-1", account_id="account-1", page=1, limit=20)

    returned_ids = {item.control_space_id for item in response.data}
    assert returned_ids == {owner.id, all_team.id, partial.id}
    assert len(rbac.batch_calls) == 1
    assert len(remote.batch_calls) == 1
    assert {binding.knowledge_space_id for binding in batch_capabilities.calls[0]} == {
        "space-owner",
        "space-all",
        "space-partial",
    }
    assert set(remote.batch_calls[0]) == {"space-owner", "space-all", "space-partial"}
    assert "space-hidden" not in remote.batch_calls[0]
    assert "space-cross" not in remote.batch_calls[0]
    statuses = {item.knowledge_space_id: item.technical_status for item in response.data}
    assert statuses["space-owner"] == "available"
    assert statuses["space-all"] == "unavailable"
    assert statuses["space-partial"] == "unavailable"
    permission_keys = {item.knowledge_space_id: set(item.permission_keys) for item in response.data}
    assert KnowledgeFSProductPermission.EDIT in permission_keys["space-owner"]
    assert permission_keys["space-all"] == {
        KnowledgeFSProductPermission.READ,
        KnowledgeFSProductPermission.QUERY,
    }
    assert permission_keys["space-partial"] == {
        KnowledgeFSProductPermission.READ,
        KnowledgeFSProductPermission.QUERY,
    }
    assert metrics.record_batch_status.call_args.args[0] == (0.25, 2, "degraded", 3, 1)
    assert "tenant-1" not in str(metrics.record_batch_status.call_args_list)


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSControlSpacePermission)],
    indirect=True,
)
def test_detail_conceals_unauthorized_space_without_remote_io(sqlite_session: Session) -> None:
    hidden = _space(
        visibility=KnowledgeFSControlSpaceVisibility.ONLY_ME,
        key="hidden",
        remote_id="space-hidden",
    )
    sqlite_session.add(hidden)
    sqlite_session.commit()
    remote = FakeRemote({})
    batch_capabilities = FakeBatchCapabilities()
    service = KnowledgeFSProductService(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        batch_capabilities=batch_capabilities,
        cutover_gate=FakeCutoverGate(),
        remote=remote,
        rbac=FakeRBAC(),
    )

    with pytest.raises(KnowledgeFSProductNotFoundError):
        service.get_space(tenant_id="tenant-1", account_id="account-1", control_space_id=hidden.id)

    assert remote.batch_calls == []
    assert batch_capabilities.calls == []


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSControlSpacePermission)],
    indirect=True,
)
def test_list_applies_rbac_before_pagination(sqlite_session: Session) -> None:
    spaces = [
        _space(
            visibility=KnowledgeFSControlSpaceVisibility.ALL_TEAM_MEMBERS,
            key=f"key-{index}",
            remote_id=f"space-{index}",
        )
        for index in range(2)
    ]
    sqlite_session.add_all(spaces)
    sqlite_session.commit()
    denied_first_id = max(space.id for space in spaces)
    remote = FakeRemote({})
    batch_capabilities = FakeBatchCapabilities()
    rbac = FakeRBAC({denied_first_id})
    service = KnowledgeFSProductService(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        batch_capabilities=batch_capabilities,
        cutover_gate=FakeCutoverGate(),
        remote=remote,
        rbac=rbac,
    )

    response = service.list_spaces(tenant_id="tenant-1", account_id="account-1", page=1, limit=1)

    assert len(response.data) == 1
    assert response.data[0].control_space_id != denied_first_id
    assert response.has_more is False
    assert set(rbac.batch_calls[0]) == {space.id for space in spaces}
    assert remote.batch_calls == [(response.data[0].knowledge_space_id,)]
    knowledge_space_id = response.data[0].knowledge_space_id
    assert knowledge_space_id is not None
    assert batch_capabilities.calls == [
        (KnowledgeFSBatchSpaceBinding(response.data[0].control_space_id, knowledge_space_id),)
    ]


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSControlSpacePermission)],
    indirect=True,
)
def test_list_fails_closed_without_remote_io_when_batch_capability_cannot_be_issued(
    sqlite_session: Session,
) -> None:
    space = _space(
        visibility=KnowledgeFSControlSpaceVisibility.ALL_TEAM_MEMBERS,
        key="capability-failure",
        remote_id="space-1",
    )
    sqlite_session.add(space)
    sqlite_session.commit()
    summary = KnowledgeFSTechnicalSummary(
        knowledge_space_id="space-1",
        revision=1,
        name="Space",
        slug="space",
    )
    remote = FakeRemote({"space-1": summary})
    batch_capabilities = FakeBatchCapabilities(fail=True)
    metrics = MagicMock()
    clock = iter((20.0, 20.5))
    service = KnowledgeFSProductService(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        batch_capabilities=batch_capabilities,
        cutover_gate=FakeCutoverGate(),
        remote=remote,
        rbac=FakeRBAC(),
        metrics=metrics,
        clock=lambda: next(clock),
    )

    response = service.list_spaces(tenant_id="tenant-1", account_id="account-1", page=1, limit=20)

    assert response.data[0].technical_status == "unavailable"
    assert len(batch_capabilities.calls) == 1
    assert remote.batch_calls == []
    assert metrics.record_batch_status.call_args.args[0] == (0.5, 1, "failed", 1, 0)


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSControlSpacePermission)],
    indirect=True,
)
def test_list_rejects_an_uncutover_workspace_before_product_or_remote_io(sqlite_session: Session) -> None:
    remote = FakeRemote({})
    batch_capabilities = FakeBatchCapabilities()
    cutover_gate = FakeCutoverGate(enabled=False)
    service = KnowledgeFSProductService(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        batch_capabilities=batch_capabilities,
        cutover_gate=cutover_gate,
        remote=remote,
        rbac=FakeRBAC(),
    )

    with pytest.raises(KnowledgeFSOperationUnavailableError, match="not cut over"):
        service.list_spaces(tenant_id="tenant-1", account_id="account-1", page=1, limit=20)

    assert cutover_gate.calls == ["tenant-1"]
    assert batch_capabilities.calls == []
    assert remote.batch_calls == []
