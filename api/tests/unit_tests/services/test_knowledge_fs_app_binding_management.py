from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import (
    AppKnowledgeFSSpaceJoin,
    KnowledgeFSAppSpaceJoinStatus,
    KnowledgeFSAppSpaceJoinType,
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSCapabilityIssuanceAudit,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpaceState,
    KnowledgeFSExternalAccessPolicy,
    KnowledgeFSLifecycleOutbox,
)
from services.knowledge_fs.app_binding_management import (
    KnowledgeFSAppBindingManagementError,
    KnowledgeFSAppBindingManagementService,
)
from services.knowledge_fs.product_dto import KnowledgeFSAppBindingPayload


class ProductAuthorization:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def authorize_control_space(self, **kwargs: object) -> object:
        self.calls.append(kwargs)
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
    product: ProductAuthorization | None = None,
    apps: AppCatalog | None = None,
    revocations: Revocations | None = None,
) -> KnowledgeFSAppBindingManagementService:
    return KnowledgeFSAppBindingManagementService(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        product=product or ProductAuthorization(),  # type: ignore[arg-type]
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
