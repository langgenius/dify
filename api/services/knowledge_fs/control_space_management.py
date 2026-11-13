"""Operator-only registration, backfill, repair, and dry-run helpers."""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from typing import NamedTuple

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import (
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpacePermission,
    KnowledgeFSControlSpacePermissionRole,
    KnowledgeFSControlSpaceState,
)
from repositories.sqlalchemy_knowledge_fs_control_space_repository import (
    SQLAlchemyKnowledgeFSControlSpaceRepository,
)
from services.knowledge_fs.control_space_commands import KnowledgeFSControlSpaceIntentConflictError
from services.knowledge_fs.control_space_lifecycle import KnowledgeFSControlSpaceLifecycleService


class KnowledgeFSControlSpaceRegistration(NamedTuple):
    tenant_id: str
    owner_account_id: str
    provisioning_key: str
    knowledge_space_id: str
    knowledge_space_revision: int


class KnowledgeFSControlSpaceDryRunReport(NamedTuple):
    total: int
    by_state: dict[str, int]
    irreversible_deletions: int


class KnowledgeFSControlSpaceBackfillReport(NamedTuple):
    candidates: int
    registered: int
    replays: int


class KnowledgeFSControlSpaceManagementService:
    def __init__(self, session_maker: sessionmaker[Session]):
        self._session_maker = session_maker

    def dry_run(self, *, tenant_id: str | None = None) -> KnowledgeFSControlSpaceDryRunReport:
        with self._session_maker() as session:
            if tenant_id is None:
                from sqlalchemy import select

                control_spaces = tuple(session.scalars(select(KnowledgeFSControlSpace)))
            else:
                control_spaces = SQLAlchemyKnowledgeFSControlSpaceRepository(session).list_for_tenant(
                    tenant_id=tenant_id
                )
        counts = Counter(control_space.state.value for control_space in control_spaces)
        return KnowledgeFSControlSpaceDryRunReport(
            total=len(control_spaces),
            by_state=dict(sorted(counts.items())),
            irreversible_deletions=sum(
                control_space.deletion_irreversible_at is not None for control_space in control_spaces
            ),
        )

    def register(self, registration: KnowledgeFSControlSpaceRegistration) -> tuple[KnowledgeFSControlSpace, bool]:
        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSControlSpaceRepository(session)
            by_key = repository.find_by_provisioning_key(provisioning_key=registration.provisioning_key)
            by_space = repository.find_by_knowledge_space_id(
                tenant_id=registration.tenant_id,
                knowledge_space_id=registration.knowledge_space_id,
            )
            existing = by_key or by_space
            if existing is not None:
                if (
                    existing.tenant_id != registration.tenant_id
                    or existing.owner_account_id != registration.owner_account_id
                    or existing.provisioning_key != registration.provisioning_key
                    or existing.knowledge_space_id != registration.knowledge_space_id
                ):
                    raise KnowledgeFSControlSpaceIntentConflictError(
                        "KnowledgeFS registration conflicts with an existing local identity"
                    )
                self._ensure_owner_permission(session, control_space=existing)
                return existing, True
            control_space = repository.add(
                KnowledgeFSControlSpace(
                    tenant_id=registration.tenant_id,
                    owner_account_id=registration.owner_account_id,
                    provisioning_key=registration.provisioning_key,
                    knowledge_space_id=registration.knowledge_space_id,
                    knowledge_space_revision=registration.knowledge_space_revision,
                    state=KnowledgeFSControlSpaceState.ACTIVE,
                    lifecycle_operation_id="management-register",
                )
            )
            session.add(
                KnowledgeFSAuthorizationRevision(
                    tenant_id=registration.tenant_id,
                    control_space_id=control_space.id,
                )
            )
            self._ensure_owner_permission(session, control_space=control_space)
            return control_space, False

    @staticmethod
    def _ensure_owner_permission(session: Session, *, control_space: KnowledgeFSControlSpace) -> None:
        permission = session.scalar(
            sa.select(KnowledgeFSControlSpacePermission).where(
                KnowledgeFSControlSpacePermission.tenant_id == control_space.tenant_id,
                KnowledgeFSControlSpacePermission.control_space_id == control_space.id,
                KnowledgeFSControlSpacePermission.account_id == control_space.owner_account_id,
            )
        )
        if permission is None:
            session.add(
                KnowledgeFSControlSpacePermission(
                    tenant_id=control_space.tenant_id,
                    control_space_id=control_space.id,
                    account_id=control_space.owner_account_id,
                    role=KnowledgeFSControlSpacePermissionRole.OWNER,
                    granted_by_account_id=control_space.owner_account_id,
                )
            )

    def backfill(
        self,
        registrations: Iterable[KnowledgeFSControlSpaceRegistration],
        *,
        apply: bool,
    ) -> KnowledgeFSControlSpaceBackfillReport:
        candidates = tuple(registrations)
        if not apply:
            return KnowledgeFSControlSpaceBackfillReport(len(candidates), 0, 0)
        registered = 0
        replays = 0
        for registration in candidates:
            _, replayed = self.register(registration)
            registered += not replayed
            replays += replayed
        return KnowledgeFSControlSpaceBackfillReport(len(candidates), registered, replays)

    def repair_registration(
        self,
        *,
        tenant_id: str,
        control_space_id: str,
        expected_resource_version: int,
        knowledge_space_id: str,
        knowledge_space_revision: int,
    ) -> KnowledgeFSControlSpace:
        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSControlSpaceRepository(session)
            return KnowledgeFSControlSpaceLifecycleService(repository).transition(
                tenant_id=tenant_id,
                control_space_id=control_space_id,
                expected_resource_version=expected_resource_version,
                new_state=KnowledgeFSControlSpaceState.ACTIVE,
                lifecycle_operation_id="management-repair",
                knowledge_space_id=knowledge_space_id,
                knowledge_space_revision=knowledge_space_revision,
            )


__all__ = [
    "KnowledgeFSControlSpaceBackfillReport",
    "KnowledgeFSControlSpaceDryRunReport",
    "KnowledgeFSControlSpaceManagementService",
    "KnowledgeFSControlSpaceRegistration",
]
