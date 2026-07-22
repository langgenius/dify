"""Fail-closed Agent and Workflow admission for KnowledgeFS control-spaces."""

from __future__ import annotations

from typing import NamedTuple

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.knowledge_fs import (
    AppKnowledgeFSSpaceJoin,
    KnowledgeFSAppSpaceJoinStatus,
    KnowledgeFSAppSpaceJoinType,
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpaceState,
    KnowledgeFSExternalAccessPolicy,
)
from services.knowledge_fs.product_operations import product_operation_action
from services.knowledge_fs.revocation_commands import (
    KnowledgeFSRevocationCommandPort,
    KnowledgeFSRevocationCommandProducer,
)


class KnowledgeFSAppAdmissionError(RuntimeError):
    """The app is not explicitly bound to an enabled KnowledgeFS channel."""


class KnowledgeFSAppPrincipalProfile(NamedTuple):
    tenant_id: str
    control_space_id: str
    app_id: str
    join_id: str
    caller_kind: KnowledgeFSAppSpaceJoinType
    action: str
    knowledge_space_id: str
    knowledge_space_revision: int
    membership_epoch: int
    space_acl_epoch: int
    external_access_epoch: int
    content_policy_revision: int


class KnowledgeFSAppAdmissionService:
    def __init__(
        self,
        session_maker: sessionmaker[Session],
        *,
        revocations: KnowledgeFSRevocationCommandPort | None = None,
    ) -> None:
        self._session_maker = session_maker
        self._revocations = revocations or KnowledgeFSRevocationCommandProducer()

    def revoke_binding(
        self,
        *,
        tenant_id: str,
        app_id: str,
        control_space_id: str,
        caller_kind: KnowledgeFSAppSpaceJoinType,
        revoked_by_account_id: str,
    ) -> None:
        with self._session_maker.begin() as session:
            join = session.scalar(
                sa.select(AppKnowledgeFSSpaceJoin)
                .where(
                    AppKnowledgeFSSpaceJoin.tenant_id == tenant_id,
                    AppKnowledgeFSSpaceJoin.app_id == app_id,
                    AppKnowledgeFSSpaceJoin.control_space_id == control_space_id,
                    AppKnowledgeFSSpaceJoin.join_type == caller_kind,
                )
                .with_for_update()
            )
            if join is None:
                raise KnowledgeFSAppAdmissionError("KnowledgeFS app binding was not found")
            if join.status is not KnowledgeFSAppSpaceJoinStatus.ACTIVE:
                return
            join.status = KnowledgeFSAppSpaceJoinStatus.REVOKED
            join.revision += 1
            join.revoked_at = naive_utc_now()
            join.revoked_by_account_id = revoked_by_account_id
            revision = session.scalar(
                sa.select(KnowledgeFSAuthorizationRevision)
                .where(
                    KnowledgeFSAuthorizationRevision.tenant_id == tenant_id,
                    KnowledgeFSAuthorizationRevision.control_space_id == control_space_id,
                )
                .with_for_update()
            )
            if revision is None:
                raise KnowledgeFSAppAdmissionError("KnowledgeFS authorization revision is missing")
            revision.external_access_epoch += 1
            self._revocations.enqueue_principal_grants(
                session=session,
                tenant_id=tenant_id,
                control_space_id=control_space_id,
                subject=f"dify-app:{app_id}",
                reason_code="app_binding_revoked",
                caller_kinds=(caller_kind.value,),
            )

    def admit(
        self,
        *,
        tenant_id: str,
        app_id: str,
        control_space_id: str,
        caller_kind: KnowledgeFSAppSpaceJoinType,
        operation_id: str,
    ) -> KnowledgeFSAppPrincipalProfile:
        try:
            action = product_operation_action(operation_id)
        except KeyError as exc:
            raise KnowledgeFSAppAdmissionError("KnowledgeFS operation is not registered") from exc
        with self._session_maker() as session:
            row = session.execute(
                sa.select(
                    AppKnowledgeFSSpaceJoin,
                    KnowledgeFSControlSpace,
                    KnowledgeFSExternalAccessPolicy,
                    KnowledgeFSAuthorizationRevision,
                )
                .join(
                    KnowledgeFSControlSpace,
                    sa.and_(
                        KnowledgeFSControlSpace.tenant_id == AppKnowledgeFSSpaceJoin.tenant_id,
                        KnowledgeFSControlSpace.id == AppKnowledgeFSSpaceJoin.control_space_id,
                    ),
                )
                .join(
                    KnowledgeFSExternalAccessPolicy,
                    sa.and_(
                        KnowledgeFSExternalAccessPolicy.tenant_id == AppKnowledgeFSSpaceJoin.tenant_id,
                        KnowledgeFSExternalAccessPolicy.control_space_id == AppKnowledgeFSSpaceJoin.control_space_id,
                    ),
                )
                .join(
                    KnowledgeFSAuthorizationRevision,
                    sa.and_(
                        KnowledgeFSAuthorizationRevision.tenant_id == AppKnowledgeFSSpaceJoin.tenant_id,
                        KnowledgeFSAuthorizationRevision.control_space_id == AppKnowledgeFSSpaceJoin.control_space_id,
                    ),
                )
                .where(
                    AppKnowledgeFSSpaceJoin.tenant_id == tenant_id,
                    AppKnowledgeFSSpaceJoin.app_id == app_id,
                    AppKnowledgeFSSpaceJoin.control_space_id == control_space_id,
                    AppKnowledgeFSSpaceJoin.join_type == caller_kind,
                    AppKnowledgeFSSpaceJoin.status == KnowledgeFSAppSpaceJoinStatus.ACTIVE,
                )
            ).one_or_none()
            if row is None:
                raise KnowledgeFSAppAdmissionError("KnowledgeFS app binding is not enabled")
            join, control_space, policy, revision = row._t
            channel_enabled = (
                policy.agent_enabled if caller_kind is KnowledgeFSAppSpaceJoinType.AGENT else policy.workflow_enabled
            )
            if (
                not channel_enabled
                or control_space.state is not KnowledgeFSControlSpaceState.ACTIVE
                or control_space.knowledge_space_id is None
            ):
                raise KnowledgeFSAppAdmissionError("KnowledgeFS app binding is not enabled")
            return KnowledgeFSAppPrincipalProfile(
                tenant_id=tenant_id,
                control_space_id=control_space_id,
                app_id=app_id,
                join_id=join.id,
                caller_kind=caller_kind,
                action=action,
                knowledge_space_id=control_space.knowledge_space_id,
                knowledge_space_revision=control_space.knowledge_space_revision,
                membership_epoch=revision.membership_epoch,
                space_acl_epoch=revision.space_acl_epoch,
                external_access_epoch=revision.external_access_epoch,
                content_policy_revision=revision.content_policy_revision,
            )


__all__ = [
    "KnowledgeFSAppAdmissionError",
    "KnowledgeFSAppAdmissionService",
    "KnowledgeFSAppPrincipalProfile",
]
