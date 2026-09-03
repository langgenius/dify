"""Workspace Dataset API key authorization for KnowledgeFS Service API calls."""

from __future__ import annotations

from typing import NamedTuple

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from models.enums import ApiTokenType
from models.knowledge_fs import (
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpaceState,
    KnowledgeFSExternalAccessPolicy,
)
from models.model import ApiToken
from services import dataset_api_key_service


class KnowledgeFSServiceApiAuthorizationError(RuntimeError):
    """A Dataset API key cannot access the requested KnowledgeFS control space."""


class KnowledgeFSServiceApiScopeError(KnowledgeFSServiceApiAuthorizationError):
    """A valid Dataset API key is bound to other knowledge bases than the requested space.

    Distinct from the base error so the Service API can answer 403 (the credential is
    real but out of scope) instead of 401 (unknown credential).
    """


class KnowledgeFSServiceApiProfile(NamedTuple):
    tenant_id: str
    control_space_id: str
    api_token_id: str
    principal_id: str
    knowledge_space_id: str
    knowledge_space_revision: int
    membership_epoch: int
    space_acl_epoch: int
    external_access_epoch: int
    content_policy_revision: int


class KnowledgeFSServiceApiAuthorizationService:
    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker = session_maker

    def authorize(
        self,
        *,
        api_token_id: str,
        tenant_id: str,
        control_space_id: str,
    ) -> KnowledgeFSServiceApiProfile:
        with self._session_maker() as session:
            row = session.execute(
                sa.select(
                    ApiToken,
                    KnowledgeFSControlSpace,
                    KnowledgeFSExternalAccessPolicy,
                    KnowledgeFSAuthorizationRevision,
                )
                .join(
                    KnowledgeFSControlSpace,
                    KnowledgeFSControlSpace.tenant_id == ApiToken.tenant_id,
                )
                .outerjoin(
                    KnowledgeFSExternalAccessPolicy,
                    sa.and_(
                        KnowledgeFSExternalAccessPolicy.tenant_id == KnowledgeFSControlSpace.tenant_id,
                        KnowledgeFSExternalAccessPolicy.control_space_id == KnowledgeFSControlSpace.id,
                    ),
                )
                .join(
                    KnowledgeFSAuthorizationRevision,
                    sa.and_(
                        KnowledgeFSAuthorizationRevision.tenant_id == KnowledgeFSControlSpace.tenant_id,
                        KnowledgeFSAuthorizationRevision.control_space_id == KnowledgeFSControlSpace.id,
                    ),
                )
                .where(
                    ApiToken.id == api_token_id,
                    ApiToken.tenant_id == tenant_id,
                    ApiToken.type == ApiTokenType.DATASET,
                    KnowledgeFSControlSpace.id == control_space_id,
                )
            ).one_or_none()
            if row is None:
                raise KnowledgeFSServiceApiAuthorizationError("Invalid Dataset API key or KnowledgeFS space")
            # Per-knowledge-base scoping (DatasetApiTokenBinding): an unbound key reaches every
            # space in its tenant; a bound key only the KnowledgeFS spaces it is bound to.
            # Legacy dataset bindings never grant access here because the two knowledge base
            # kinds live in different tables.
            scope = dataset_api_key_service.get_key_scope(session, api_token_id)
            if not scope.allows_knowledge_space(control_space_id):
                raise KnowledgeFSServiceApiScopeError("Dataset API key is not authorized for this KnowledgeFS space")
        api_token, control_space, policy, revision = row._t
        if (
            control_space.state is not KnowledgeFSControlSpaceState.ACTIVE
            or control_space.knowledge_space_id is None
            or policy is None
            or not policy.service_api_enabled
        ):
            raise KnowledgeFSServiceApiAuthorizationError("KnowledgeFS Service API access is not enabled")
        return KnowledgeFSServiceApiProfile(
            tenant_id=tenant_id,
            control_space_id=control_space_id,
            api_token_id=api_token.id,
            principal_id=api_token.id,
            knowledge_space_id=control_space.knowledge_space_id,
            knowledge_space_revision=control_space.knowledge_space_revision,
            membership_epoch=revision.membership_epoch,
            space_acl_epoch=revision.space_acl_epoch,
            external_access_epoch=revision.external_access_epoch,
            content_policy_revision=revision.content_policy_revision,
        )


__all__ = [
    "KnowledgeFSServiceApiAuthorizationError",
    "KnowledgeFSServiceApiAuthorizationService",
    "KnowledgeFSServiceApiProfile",
    "KnowledgeFSServiceApiScopeError",
]
