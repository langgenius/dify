"""Authorized lifecycle management for Agent and Workflow KnowledgeFS bindings."""

from __future__ import annotations

from typing import Protocol

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.enums import AppStatus
from models.knowledge_fs import (
    AppKnowledgeFSSpaceJoin,
    KnowledgeFSAppSpaceJoinStatus,
    KnowledgeFSAppSpaceJoinType,
    KnowledgeFSAuthorizationRevision,
)
from models.model import App, AppMode
from services.knowledge_fs.product_dto import (
    KnowledgeFSAppBindingListResponse,
    KnowledgeFSAppBindingPayload,
    KnowledgeFSAppBindingResponse,
)
from services.knowledge_fs.product_operations import KnowledgeFSProductPermission
from services.knowledge_fs.revocation_commands import KnowledgeFSRevocationCommandPort


class KnowledgeFSAppBindingManagementError(RuntimeError):
    """An app binding cannot be created or changed safely."""


class KnowledgeFSAppBindingAuthorizationPort(Protocol):
    def authorize_control_space(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        permission: KnowledgeFSProductPermission,
    ) -> object: ...


class KnowledgeFSAppCatalogPort(Protocol):
    def supports_binding(
        self,
        *,
        session: Session,
        tenant_id: str,
        app_id: str,
        caller_kind: KnowledgeFSAppSpaceJoinType,
    ) -> bool: ...


class SQLKnowledgeFSAppCatalog:
    _MODES_BY_CALLER = {
        KnowledgeFSAppSpaceJoinType.AGENT: (AppMode.AGENT, AppMode.AGENT_CHAT),
        KnowledgeFSAppSpaceJoinType.WORKFLOW: (AppMode.ADVANCED_CHAT, AppMode.WORKFLOW),
    }

    def supports_binding(
        self,
        *,
        session: Session,
        tenant_id: str,
        app_id: str,
        caller_kind: KnowledgeFSAppSpaceJoinType,
    ) -> bool:
        return (
            session.scalar(
                sa.select(App.id)
                .where(
                    App.id == app_id,
                    App.tenant_id == tenant_id,
                    App.status == AppStatus.NORMAL,
                    App.mode.in_(self._MODES_BY_CALLER[caller_kind]),
                )
                .limit(1)
            )
            is not None
        )


class KnowledgeFSAppBindingManagementService:
    def __init__(
        self,
        session_maker: sessionmaker[Session],
        *,
        product: KnowledgeFSAppBindingAuthorizationPort,
        apps: KnowledgeFSAppCatalogPort,
        revocations: KnowledgeFSRevocationCommandPort,
    ) -> None:
        self._session_maker = session_maker
        self._product = product
        self._apps = apps
        self._revocations = revocations

    def count_active(
        self,
        *,
        tenant_id: str,
        actor_account_id: str,
        control_space_id: str,
    ) -> int:
        self._authorize(
            tenant_id=tenant_id,
            actor_account_id=actor_account_id,
            control_space_id=control_space_id,
            permission=KnowledgeFSProductPermission.READ,
        )
        with self._session_maker() as session:
            count = session.scalar(
                sa.select(sa.func.count(sa.distinct(AppKnowledgeFSSpaceJoin.app_id))).where(
                    AppKnowledgeFSSpaceJoin.tenant_id == tenant_id,
                    AppKnowledgeFSSpaceJoin.control_space_id == control_space_id,
                    AppKnowledgeFSSpaceJoin.status == KnowledgeFSAppSpaceJoinStatus.ACTIVE,
                )
            )
        return count or 0

    def list(
        self,
        *,
        tenant_id: str,
        actor_account_id: str,
        control_space_id: str,
    ) -> KnowledgeFSAppBindingListResponse:
        self._authorize(
            tenant_id=tenant_id,
            actor_account_id=actor_account_id,
            control_space_id=control_space_id,
        )
        with self._session_maker() as session:
            bindings = tuple(
                session.scalars(
                    sa.select(AppKnowledgeFSSpaceJoin)
                    .where(
                        AppKnowledgeFSSpaceJoin.tenant_id == tenant_id,
                        AppKnowledgeFSSpaceJoin.control_space_id == control_space_id,
                    )
                    .order_by(AppKnowledgeFSSpaceJoin.app_id, AppKnowledgeFSSpaceJoin.join_type)
                )
            )
        return KnowledgeFSAppBindingListResponse(data=[_response(binding) for binding in bindings])

    def upsert(
        self,
        *,
        tenant_id: str,
        actor_account_id: str,
        control_space_id: str,
        payload: KnowledgeFSAppBindingPayload,
    ) -> KnowledgeFSAppBindingResponse:
        self._authorize(
            tenant_id=tenant_id,
            actor_account_id=actor_account_id,
            control_space_id=control_space_id,
        )
        with self._session_maker.begin() as session:
            if not self._apps.supports_binding(
                session=session,
                tenant_id=tenant_id,
                app_id=payload.app_id,
                caller_kind=payload.caller_kind,
            ):
                raise KnowledgeFSAppBindingManagementError("App is not eligible for this KnowledgeFS caller channel")
            authorization_revision = _authorization_revision(
                session,
                tenant_id=tenant_id,
                control_space_id=control_space_id,
            )
            binding = session.scalar(
                sa.select(AppKnowledgeFSSpaceJoin)
                .where(
                    AppKnowledgeFSSpaceJoin.tenant_id == tenant_id,
                    AppKnowledgeFSSpaceJoin.control_space_id == control_space_id,
                    AppKnowledgeFSSpaceJoin.app_id == payload.app_id,
                    AppKnowledgeFSSpaceJoin.join_type == payload.caller_kind,
                )
                .with_for_update()
            )
            if binding is None:
                binding = AppKnowledgeFSSpaceJoin(
                    tenant_id=tenant_id,
                    control_space_id=control_space_id,
                    app_id=payload.app_id,
                    join_type=payload.caller_kind,
                    created_by_account_id=actor_account_id,
                )
                session.add(binding)
                session.flush()
                authorization_revision.external_access_epoch += 1
            elif binding.status is KnowledgeFSAppSpaceJoinStatus.REVOKED:
                binding.status = KnowledgeFSAppSpaceJoinStatus.ACTIVE
                binding.revision += 1
                binding.revoked_at = None
                binding.revoked_by_account_id = None
                authorization_revision.external_access_epoch += 1
            return _response(binding)

    def sync_workflow_bindings(
        self,
        *,
        tenant_id: str,
        actor_account_id: str,
        app_id: str,
        control_space_ids: list[str] | tuple[str, ...],
        session: Session | None = None,
    ) -> list[KnowledgeFSAppBindingResponse]:
        """Make published Workflow bindings exactly match one validated graph snapshot."""

        normalized_space_ids = list(dict.fromkeys(space_id.strip() for space_id in control_space_ids))
        if any(not space_id for space_id in normalized_space_ids):
            raise KnowledgeFSAppBindingManagementError("KnowledgeFS control-space ids must be non-empty")
        if len(normalized_space_ids) > 10:
            raise KnowledgeFSAppBindingManagementError("A workflow can bind at most 10 KnowledgeFS Spaces")

        # Authorize every desired target before opening the mutation transaction. A failure therefore
        # cannot leave a partially updated set of published Workflow bindings.
        for control_space_id in normalized_space_ids:
            self._authorize(
                tenant_id=tenant_id,
                actor_account_id=actor_account_id,
                control_space_id=control_space_id,
            )

        if session is not None:
            return self._sync_workflow_bindings_in_session(
                session=session,
                tenant_id=tenant_id,
                actor_account_id=actor_account_id,
                app_id=app_id,
                normalized_space_ids=normalized_space_ids,
            )

        with self._session_maker.begin() as managed_session:
            return self._sync_workflow_bindings_in_session(
                session=managed_session,
                tenant_id=tenant_id,
                actor_account_id=actor_account_id,
                app_id=app_id,
                normalized_space_ids=normalized_space_ids,
            )

    def _sync_workflow_bindings_in_session(
        self,
        *,
        session: Session,
        tenant_id: str,
        actor_account_id: str,
        app_id: str,
        normalized_space_ids: list[str],
    ) -> list[KnowledgeFSAppBindingResponse]:
        desired = set(normalized_space_ids)
        responses_by_space: dict[str, KnowledgeFSAppBindingResponse] = {}
        if not self._apps.supports_binding(
            session=session,
            tenant_id=tenant_id,
            app_id=app_id,
            caller_kind=KnowledgeFSAppSpaceJoinType.WORKFLOW,
        ):
            raise KnowledgeFSAppBindingManagementError("App is not eligible for the KnowledgeFS workflow channel")
        existing = tuple(
            session.scalars(
                sa.select(AppKnowledgeFSSpaceJoin)
                .where(
                    AppKnowledgeFSSpaceJoin.tenant_id == tenant_id,
                    AppKnowledgeFSSpaceJoin.app_id == app_id,
                    AppKnowledgeFSSpaceJoin.join_type == KnowledgeFSAppSpaceJoinType.WORKFLOW,
                )
                .with_for_update()
            )
        )
        bindings_by_space = {binding.control_space_id: binding for binding in existing}

        for control_space_id in normalized_space_ids:
            binding = bindings_by_space.get(control_space_id)
            if binding is None:
                authorization_revision = _authorization_revision(
                    session,
                    tenant_id=tenant_id,
                    control_space_id=control_space_id,
                )
                binding = AppKnowledgeFSSpaceJoin(
                    tenant_id=tenant_id,
                    control_space_id=control_space_id,
                    app_id=app_id,
                    join_type=KnowledgeFSAppSpaceJoinType.WORKFLOW,
                    created_by_account_id=actor_account_id,
                )
                session.add(binding)
                session.flush()
                authorization_revision.external_access_epoch += 1
                bindings_by_space[control_space_id] = binding
            elif binding.status is KnowledgeFSAppSpaceJoinStatus.REVOKED:
                authorization_revision = _authorization_revision(
                    session,
                    tenant_id=tenant_id,
                    control_space_id=control_space_id,
                )
                binding.status = KnowledgeFSAppSpaceJoinStatus.ACTIVE
                binding.revision += 1
                binding.revoked_at = None
                binding.revoked_by_account_id = None
                authorization_revision.external_access_epoch += 1
            responses_by_space[control_space_id] = _response(binding)

        for binding in existing:
            if binding.control_space_id in desired or binding.status is KnowledgeFSAppSpaceJoinStatus.REVOKED:
                continue
            authorization_revision = _authorization_revision(
                session,
                tenant_id=tenant_id,
                control_space_id=binding.control_space_id,
            )
            binding.status = KnowledgeFSAppSpaceJoinStatus.REVOKED
            binding.revision += 1
            binding.revoked_at = naive_utc_now()
            binding.revoked_by_account_id = actor_account_id
            authorization_revision.external_access_epoch += 1
            self._revocations.enqueue_principal_grants(
                session=session,
                tenant_id=tenant_id,
                control_space_id=binding.control_space_id,
                subject=f"dify-app:{app_id}",
                reason_code="app_binding_revoked",
                caller_kinds=(KnowledgeFSAppSpaceJoinType.WORKFLOW.value,),
            )

        return [responses_by_space[space_id] for space_id in normalized_space_ids]

    def revoke(
        self,
        *,
        tenant_id: str,
        actor_account_id: str,
        control_space_id: str,
        app_id: str,
        caller_kind: KnowledgeFSAppSpaceJoinType,
    ) -> None:
        self._authorize(
            tenant_id=tenant_id,
            actor_account_id=actor_account_id,
            control_space_id=control_space_id,
        )
        with self._session_maker.begin() as session:
            authorization_revision = _authorization_revision(
                session,
                tenant_id=tenant_id,
                control_space_id=control_space_id,
            )
            binding = session.scalar(
                sa.select(AppKnowledgeFSSpaceJoin)
                .where(
                    AppKnowledgeFSSpaceJoin.tenant_id == tenant_id,
                    AppKnowledgeFSSpaceJoin.control_space_id == control_space_id,
                    AppKnowledgeFSSpaceJoin.app_id == app_id,
                    AppKnowledgeFSSpaceJoin.join_type == caller_kind,
                )
                .with_for_update()
            )
            if binding is None:
                raise KnowledgeFSAppBindingManagementError("KnowledgeFS app binding was not found")
            if binding.status is KnowledgeFSAppSpaceJoinStatus.REVOKED:
                return
            binding.status = KnowledgeFSAppSpaceJoinStatus.REVOKED
            binding.revision += 1
            binding.revoked_at = naive_utc_now()
            binding.revoked_by_account_id = actor_account_id
            authorization_revision.external_access_epoch += 1
            self._revocations.enqueue_principal_grants(
                session=session,
                tenant_id=tenant_id,
                control_space_id=control_space_id,
                subject=f"dify-app:{app_id}",
                reason_code="app_binding_revoked",
                caller_kinds=(caller_kind.value,),
            )

    def _authorize(
        self,
        *,
        tenant_id: str,
        actor_account_id: str,
        control_space_id: str,
        permission: KnowledgeFSProductPermission = KnowledgeFSProductPermission.ACCESS_CONFIG,
    ) -> None:
        self._product.authorize_control_space(
            tenant_id=tenant_id,
            account_id=actor_account_id,
            control_space_id=control_space_id,
            permission=permission,
        )


def _authorization_revision(
    session: Session,
    *,
    tenant_id: str,
    control_space_id: str,
) -> KnowledgeFSAuthorizationRevision:
    revision = session.scalar(
        sa.select(KnowledgeFSAuthorizationRevision)
        .where(
            KnowledgeFSAuthorizationRevision.tenant_id == tenant_id,
            KnowledgeFSAuthorizationRevision.control_space_id == control_space_id,
        )
        .with_for_update()
    )
    if revision is None:
        raise KnowledgeFSAppBindingManagementError("KnowledgeFS authorization revision is missing")
    return revision


def _response(binding: AppKnowledgeFSSpaceJoin) -> KnowledgeFSAppBindingResponse:
    return KnowledgeFSAppBindingResponse(
        id=binding.id,
        app_id=binding.app_id,
        caller_kind=binding.join_type,
        status=binding.status,
        revision=binding.revision,
    )


__all__ = [
    "KnowledgeFSAppBindingManagementError",
    "KnowledgeFSAppBindingManagementService",
    "SQLKnowledgeFSAppCatalog",
]
