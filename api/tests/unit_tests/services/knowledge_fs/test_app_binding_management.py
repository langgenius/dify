from __future__ import annotations

from collections.abc import Callable
from typing import Literal

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from typing_extensions import TypedDict

from models.knowledge_fs import (
    AppKnowledgeFSSpaceJoin,
    KnowledgeFSAppSpaceJoinStatus,
    KnowledgeFSAppSpaceJoinType,
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSCapabilityIssuanceAudit,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpacePermission,
    KnowledgeFSControlSpacePermissionRole,
    KnowledgeFSControlSpaceState,
    KnowledgeFSControlSpaceVisibility,
    KnowledgeFSExternalAccessPolicy,
    KnowledgeFSLifecycleOutbox,
)
from services.knowledge_fs.app_binding_management import (
    KnowledgeFSAppBindingAuthorizationPort,
    KnowledgeFSAppBindingManagementError,
    KnowledgeFSAppBindingManagementService,
)
from services.knowledge_fs.batch_capability import KnowledgeFSBatchCapabilityBroker
from services.knowledge_fs.product_authorization import (
    DifyKnowledgeFSProductRBACPort,
    KnowledgeFSProductNotFoundError,
)
from services.knowledge_fs.product_dto import KnowledgeFSAppBindingPayload
from services.knowledge_fs.product_operations import KnowledgeFSProductPermission
from services.knowledge_fs.product_remote import UnavailableKnowledgeFSProductRemote
from services.knowledge_fs.product_service import KnowledgeFSProductService


class _BindingSyncArgs(TypedDict, closed=True):
    tenant_id: str
    actor_account_id: str
    app_id: str
    control_space_ids: list[str]


class ProductAuthorization:
    def __init__(
        self,
        *,
        fail_on: str | None = None,
        permissions: frozenset[KnowledgeFSProductPermission] = frozenset(KnowledgeFSProductPermission),
    ) -> None:
        self.calls: list[dict[str, object]] = []
        self.fail_on = fail_on
        self.permissions = permissions

    def authorize_control_space(self, **kwargs: object) -> object:
        self.calls.append(kwargs)
        if kwargs["control_space_id"] == self.fail_on or kwargs["permission"] not in self.permissions:
            raise PermissionError("forbidden")
        return object()


class AppCatalog:
    def __init__(self, *, supported: bool = True) -> None:
        self.supported = supported

    def supports_binding(self, **kwargs: object) -> bool:
        _ = kwargs
        return self.supported


class Revocations:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def enqueue_principal_grants(self, **kwargs: object) -> None:
        self.calls.append(kwargs)


def _service(
    sqlite_session: Session,
    *,
    product: KnowledgeFSAppBindingAuthorizationPort | None = None,
    apps: AppCatalog | None = None,
    revocations: Revocations | None = None,
) -> KnowledgeFSAppBindingManagementService:
    return KnowledgeFSAppBindingManagementService(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        product=product or ProductAuthorization(),
        apps=apps or AppCatalog(),
        revocations=revocations or Revocations(),  # type: ignore[arg-type]
    )


@pytest.fixture
def binding_session(sqlite_session: Session) -> Session:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="owner-1",
        provisioning_key="provision-1",
        state=KnowledgeFSControlSpaceState.ACTIVE,
        knowledge_space_id="space-1",
        knowledge_space_revision=3,
    )
    sqlite_session.add(space)
    sqlite_session.flush()
    sqlite_session.add_all(
        [
            KnowledgeFSExternalAccessPolicy(
                tenant_id="tenant-1",
                control_space_id=space.id,
                agent_enabled=True,
                workflow_enabled=True,
            ),
            KnowledgeFSAuthorizationRevision(
                tenant_id="tenant-1",
                control_space_id=space.id,
                external_access_epoch=4,
            ),
        ]
    )
    sqlite_session.commit()
    return sqlite_session


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSExternalAccessPolicy,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSCapabilityIssuanceAudit,
            KnowledgeFSLifecycleOutbox,
            AppKnowledgeFSSpaceJoin,
        )
    ],
    indirect=True,
)
def test_binding_create_replay_and_reactivation_are_durable_and_epoch_guarded(binding_session: Session) -> None:
    service = _service(binding_session)
    space = binding_session.scalar(select(KnowledgeFSControlSpace))
    assert space is not None
    payload = KnowledgeFSAppBindingPayload(app_id="app-1", caller_kind=KnowledgeFSAppSpaceJoinType.AGENT)

    created = service.upsert(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=space.id,
        payload=payload,
    )
    replayed = service.upsert(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=space.id,
        payload=payload,
    )
    service.revoke(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=space.id,
        app_id="app-1",
        caller_kind=KnowledgeFSAppSpaceJoinType.AGENT,
    )
    reactivated = service.upsert(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=space.id,
        payload=payload,
    )

    revision = binding_session.scalar(select(KnowledgeFSAuthorizationRevision))
    rows = tuple(binding_session.scalars(select(AppKnowledgeFSSpaceJoin)))
    assert created.id == replayed.id == reactivated.id
    assert (created.revision, replayed.revision, reactivated.revision) == (0, 0, 2)
    assert reactivated.status is KnowledgeFSAppSpaceJoinStatus.ACTIVE
    assert len(rows) == 1
    assert revision is not None
    assert revision.external_access_epoch == 7


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSExternalAccessPolicy,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSCapabilityIssuanceAudit,
            KnowledgeFSLifecycleOutbox,
            AppKnowledgeFSSpaceJoin,
        )
    ],
    indirect=True,
)
def test_binding_rejects_cross_tenant_or_wrong_app_kind_before_mutation(binding_session: Session) -> None:
    service = _service(binding_session, apps=AppCatalog(supported=False))
    space = binding_session.scalar(select(KnowledgeFSControlSpace))
    assert space is not None

    with pytest.raises(KnowledgeFSAppBindingManagementError):
        service.upsert(
            tenant_id="tenant-1",
            actor_account_id="owner-1",
            control_space_id=space.id,
            payload=KnowledgeFSAppBindingPayload(
                app_id="other-tenant-app",
                caller_kind=KnowledgeFSAppSpaceJoinType.WORKFLOW,
            ),
        )

    assert binding_session.scalar(select(AppKnowledgeFSSpaceJoin)) is None
    revision = binding_session.scalar(select(KnowledgeFSAuthorizationRevision))
    assert revision is not None
    assert revision.external_access_epoch == 4


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSExternalAccessPolicy,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSCapabilityIssuanceAudit,
            KnowledgeFSLifecycleOutbox,
            AppKnowledgeFSSpaceJoin,
        )
    ],
    indirect=True,
)
def test_binding_revoke_is_idempotent_and_enqueues_narrow_principal_revocation(binding_session: Session) -> None:
    revocations = Revocations()
    service = _service(binding_session, revocations=revocations)
    space = binding_session.scalar(select(KnowledgeFSControlSpace))
    assert space is not None
    service.upsert(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=space.id,
        payload=KnowledgeFSAppBindingPayload(app_id="app-1", caller_kind=KnowledgeFSAppSpaceJoinType.WORKFLOW),
    )

    service.revoke(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=space.id,
        app_id="app-1",
        caller_kind=KnowledgeFSAppSpaceJoinType.WORKFLOW,
    )
    service.revoke(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=space.id,
        app_id="app-1",
        caller_kind=KnowledgeFSAppSpaceJoinType.WORKFLOW,
    )

    join = binding_session.scalar(select(AppKnowledgeFSSpaceJoin))
    assert join is not None
    assert join.status is KnowledgeFSAppSpaceJoinStatus.REVOKED
    assert join.revision == 1
    assert len(revocations.calls) == 1
    assert revocations.calls[0]["subject"] == "dify-app:app-1"
    assert revocations.calls[0]["caller_kinds"] == ("workflow",)


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSExternalAccessPolicy,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSCapabilityIssuanceAudit,
            KnowledgeFSLifecycleOutbox,
            AppKnowledgeFSSpaceJoin,
        )
    ],
    indirect=True,
)
def test_active_binding_count_is_distinct_by_app_and_requires_only_read_access(binding_session: Session) -> None:
    product = ProductAuthorization()
    service = _service(binding_session, product=product)
    space = binding_session.scalar(select(KnowledgeFSControlSpace))
    assert space is not None
    for caller_kind in (KnowledgeFSAppSpaceJoinType.AGENT, KnowledgeFSAppSpaceJoinType.WORKFLOW):
        service.upsert(
            tenant_id="tenant-1",
            actor_account_id="owner-1",
            control_space_id=space.id,
            payload=KnowledgeFSAppBindingPayload(app_id="app-1", caller_kind=caller_kind),
        )
    service.upsert(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=space.id,
        payload=KnowledgeFSAppBindingPayload(
            app_id="app-2",
            caller_kind=KnowledgeFSAppSpaceJoinType.AGENT,
        ),
    )
    service.revoke(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=space.id,
        app_id="app-2",
        caller_kind=KnowledgeFSAppSpaceJoinType.AGENT,
    )

    assert (
        service.count_active(
            tenant_id="tenant-1",
            actor_account_id="viewer-1",
            control_space_id=space.id,
        )
        == 1
    )
    assert product.calls[-1]["permission"] is KnowledgeFSProductPermission.READ


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSExternalAccessPolicy,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSCapabilityIssuanceAudit,
            KnowledgeFSLifecycleOutbox,
            AppKnowledgeFSSpaceJoin,
        )
    ],
    indirect=True,
)
def test_workflow_binding_sync_is_exact_atomic_and_revokes_removed_spaces(binding_session: Session) -> None:
    first = binding_session.scalar(select(KnowledgeFSControlSpace))
    assert first is not None
    second = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="owner-1",
        provisioning_key="provision-2",
        state=KnowledgeFSControlSpaceState.ACTIVE,
        knowledge_space_id="space-2",
        knowledge_space_revision=1,
    )
    binding_session.add(second)
    binding_session.flush()
    binding_session.add_all(
        [
            KnowledgeFSExternalAccessPolicy(
                tenant_id="tenant-1",
                control_space_id=second.id,
                agent_enabled=True,
                workflow_enabled=True,
            ),
            KnowledgeFSAuthorizationRevision(
                tenant_id="tenant-1",
                control_space_id=second.id,
                external_access_epoch=2,
            ),
        ]
    )
    binding_session.commit()
    revocations = Revocations()
    service = _service(binding_session, revocations=revocations)
    service.upsert(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=first.id,
        payload=KnowledgeFSAppBindingPayload(
            app_id="app-1",
            caller_kind=KnowledgeFSAppSpaceJoinType.WORKFLOW,
        ),
    )

    synced = service.sync_workflow_bindings(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        app_id="app-1",
        control_space_ids=[second.id, second.id],
    )

    rows = {row.control_space_id: row for row in binding_session.scalars(select(AppKnowledgeFSSpaceJoin)).all()}
    assert [binding.app_id for binding in synced] == ["app-1"]
    assert rows[first.id].status is KnowledgeFSAppSpaceJoinStatus.REVOKED
    assert rows[second.id].status is KnowledgeFSAppSpaceJoinStatus.ACTIVE
    assert len(revocations.calls) == 1
    assert revocations.calls[0]["control_space_id"] == first.id


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSExternalAccessPolicy,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSCapabilityIssuanceAudit,
            KnowledgeFSLifecycleOutbox,
            AppKnowledgeFSSpaceJoin,
        )
    ],
    indirect=True,
)
def test_workflow_binding_sync_authorizes_every_target_before_mutation(binding_session: Session) -> None:
    space = binding_session.scalar(select(KnowledgeFSControlSpace))
    assert space is not None
    service = _service(binding_session, product=ProductAuthorization(fail_on=space.id))

    with pytest.raises(PermissionError, match="forbidden"):
        service.sync_workflow_bindings(
            tenant_id="tenant-1",
            actor_account_id="owner-1",
            app_id="app-1",
            control_space_ids=[space.id],
        )

    assert binding_session.scalar(select(AppKnowledgeFSSpaceJoin)) is None


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSExternalAccessPolicy,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSCapabilityIssuanceAudit,
            KnowledgeFSLifecycleOutbox,
            AppKnowledgeFSSpaceJoin,
        )
    ],
    indirect=True,
)
def test_workflow_binding_sync_can_join_the_publish_transaction(binding_session: Session) -> None:
    space = binding_session.scalar(select(KnowledgeFSControlSpace))
    assert space is not None
    service = _service(binding_session)

    service.sync_workflow_bindings(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        app_id="app-1",
        control_space_ids=[space.id],
        session=binding_session,
    )

    assert binding_session.scalar(select(AppKnowledgeFSSpaceJoin)) is not None
    binding_session.rollback()
    assert binding_session.scalar(select(AppKnowledgeFSSpaceJoin)) is None


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSExternalAccessPolicy,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSCapabilityIssuanceAudit,
            KnowledgeFSLifecycleOutbox,
            AppKnowledgeFSSpaceJoin,
        )
    ],
    indirect=True,
)
def test_agent_sync_preserves_workflow_channel_and_rolls_back_with_publish(binding_session: Session) -> None:
    service = _service(binding_session)
    space = binding_session.scalar(select(KnowledgeFSControlSpace))
    assert space is not None
    args: _BindingSyncArgs = {
        "tenant_id": "tenant-1",
        "actor_account_id": "owner-1",
        "app_id": "app-1",
        "control_space_ids": [space.id],
    }
    service.sync_workflow_bindings(**args)
    service.sync_agent_bindings(**args, session=binding_session)
    assert len(list(binding_session.scalars(select(AppKnowledgeFSSpaceJoin)))) == 2
    binding_session.rollback()
    assert [row.join_type for row in binding_session.scalars(select(AppKnowledgeFSSpaceJoin))] == [
        KnowledgeFSAppSpaceJoinType.WORKFLOW
    ]
    service.sync_agent_bindings(**args)
    cleared: _BindingSyncArgs = {**args, "control_space_ids": []}
    service.sync_agent_bindings(**cleared)
    rows = {row.join_type: row for row in binding_session.scalars(select(AppKnowledgeFSSpaceJoin))}
    assert rows[KnowledgeFSAppSpaceJoinType.WORKFLOW].status is KnowledgeFSAppSpaceJoinStatus.ACTIVE
    assert rows[KnowledgeFSAppSpaceJoinType.AGENT].status is KnowledgeFSAppSpaceJoinStatus.REVOKED


class ReadyWorkspace:
    def require_product_routes(self, *, tenant_id: str) -> None:
        assert tenant_id == "tenant-1"

    def require_capability_v2(self, *, tenant_id: str) -> None:
        raise AssertionError(f"Binding a space must not issue a capability for {tenant_id}")


@pytest.fixture
def shared_binding_service(
    binding_session: Session, config_overrides: Callable[..., None]
) -> KnowledgeFSAppBindingManagementService:
    config_overrides(RBAC_ENABLED=False)
    maker = sessionmaker(bind=binding_session.get_bind(), expire_on_commit=False)
    gate = ReadyWorkspace()
    product = KnowledgeFSProductService(
        maker,
        batch_capabilities=KnowledgeFSBatchCapabilityBroker(maker, cutover_gate=gate, issuer=None),
        cutover_gate=gate,
        remote=UnavailableKnowledgeFSProductRemote(),
        rbac=DifyKnowledgeFSProductRBACPort(),
    )
    return _service(binding_session, product=product)


def _bind_for_app(
    service: KnowledgeFSAppBindingManagementService,
    *,
    space_id: str,
    operation: Literal["draft", "workflow", "agent"],
) -> None:
    if operation == "draft":
        service.upsert_for_app(
            tenant_id="tenant-1",
            actor_account_id="member-1",
            control_space_id=space_id,
            payload=KnowledgeFSAppBindingPayload(app_id="app-1", caller_kind=KnowledgeFSAppSpaceJoinType.WORKFLOW),
        )
    else:
        sync = service.sync_workflow_bindings if operation == "workflow" else service.sync_agent_bindings
        sync(
            tenant_id="tenant-1",
            actor_account_id="member-1",
            app_id="app-1",
            control_space_ids=[space_id],
        )


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSControlSpacePermission,
            KnowledgeFSExternalAccessPolicy,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSCapabilityIssuanceAudit,
            KnowledgeFSLifecycleOutbox,
            AppKnowledgeFSSpaceJoin,
        )
    ],
    indirect=True,
)
class TestSharedSpaceBindings:
    @pytest.mark.parametrize("operation", ["draft", "workflow", "agent"])
    @pytest.mark.parametrize(
        "visibility",
        [KnowledgeFSControlSpaceVisibility.ALL_TEAM_MEMBERS, KnowledgeFSControlSpaceVisibility.PARTIAL_MEMBERS],
    )
    def test_shared_viewer_can_bind_for_debugging_and_publishing(
        self,
        binding_session: Session,
        shared_binding_service: KnowledgeFSAppBindingManagementService,
        operation: Literal["draft", "workflow", "agent"],
        visibility: KnowledgeFSControlSpaceVisibility,
    ) -> None:
        space = binding_session.scalar(select(KnowledgeFSControlSpace))
        assert space is not None
        space.visibility = visibility
        if visibility is KnowledgeFSControlSpaceVisibility.PARTIAL_MEMBERS:
            binding_session.add(
                KnowledgeFSControlSpacePermission(
                    tenant_id="tenant-1",
                    control_space_id=space.id,
                    account_id="member-1",
                    role=KnowledgeFSControlSpacePermissionRole.VIEWER,
                )
            )
        binding_session.commit()

        _bind_for_app(shared_binding_service, space_id=space.id, operation=operation)

        binding = binding_session.scalar(select(AppKnowledgeFSSpaceJoin))
        assert binding is not None
        assert binding.control_space_id == space.id
        assert binding.created_by_account_id == "member-1"
        assert binding.status is KnowledgeFSAppSpaceJoinStatus.ACTIVE
        assert binding.join_type is (
            KnowledgeFSAppSpaceJoinType.AGENT if operation == "agent" else KnowledgeFSAppSpaceJoinType.WORKFLOW
        )

    @pytest.mark.parametrize("operation", ["draft", "workflow", "agent"])
    @pytest.mark.parametrize("access", ["private", "unlisted", "other_tenant"])
    def test_unshared_or_cross_tenant_spaces_cannot_be_bound(
        self,
        binding_session: Session,
        shared_binding_service: KnowledgeFSAppBindingManagementService,
        operation: Literal["draft", "workflow", "agent"],
        access: str,
    ) -> None:
        space = binding_session.scalar(select(KnowledgeFSControlSpace))
        assert space is not None
        if access == "unlisted":
            space.visibility = KnowledgeFSControlSpaceVisibility.PARTIAL_MEMBERS
        elif access == "other_tenant":
            space.tenant_id = "other-tenant"
            space.visibility = KnowledgeFSControlSpaceVisibility.ALL_TEAM_MEMBERS
        binding_session.commit()

        with pytest.raises(KnowledgeFSProductNotFoundError):
            _bind_for_app(shared_binding_service, space_id=space.id, operation=operation)

        assert binding_session.scalar(select(AppKnowledgeFSSpaceJoin)) is None

    @pytest.mark.parametrize("operation", ["draft", "workflow", "agent"])
    @pytest.mark.parametrize(
        "missing_permission", [KnowledgeFSProductPermission.READ, KnowledgeFSProductPermission.QUERY]
    )
    def test_binding_requires_both_read_and_query_even_with_access_configuration(
        self,
        binding_session: Session,
        operation: Literal["draft", "workflow", "agent"],
        missing_permission: KnowledgeFSProductPermission,
    ) -> None:
        space = binding_session.scalar(select(KnowledgeFSControlSpace))
        assert space is not None
        service = _service(
            binding_session,
            product=ProductAuthorization(permissions=frozenset(KnowledgeFSProductPermission) - {missing_permission}),
        )

        with pytest.raises(PermissionError, match="forbidden"):
            _bind_for_app(service, space_id=space.id, operation=operation)

        assert binding_session.scalar(select(AppKnowledgeFSSpaceJoin)) is None

    @pytest.mark.parametrize("operation", ["list", "upsert", "revoke"])
    def test_shared_viewer_cannot_manage_space_grants(
        self,
        binding_session: Session,
        shared_binding_service: KnowledgeFSAppBindingManagementService,
        operation: str,
    ) -> None:
        space = binding_session.scalar(select(KnowledgeFSControlSpace))
        assert space is not None
        space.visibility = KnowledgeFSControlSpaceVisibility.ALL_TEAM_MEMBERS
        binding_session.commit()

        if operation == "list":
            with pytest.raises(PermissionError):
                shared_binding_service.list(
                    tenant_id="tenant-1", actor_account_id="member-1", control_space_id=space.id
                )
        elif operation == "upsert":
            with pytest.raises(PermissionError):
                shared_binding_service.upsert(
                    tenant_id="tenant-1",
                    actor_account_id="member-1",
                    control_space_id=space.id,
                    payload=KnowledgeFSAppBindingPayload(
                        app_id="app-1", caller_kind=KnowledgeFSAppSpaceJoinType.WORKFLOW
                    ),
                )
        else:
            with pytest.raises(PermissionError):
                shared_binding_service.revoke(
                    tenant_id="tenant-1",
                    actor_account_id="member-1",
                    control_space_id=space.id,
                    app_id="app-1",
                    caller_kind=KnowledgeFSAppSpaceJoinType.WORKFLOW,
                )

        assert binding_session.scalar(select(AppKnowledgeFSSpaceJoin)) is None
