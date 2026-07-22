"""Resource-bound KnowledgeFS service credentials and fail-closed validation."""

from __future__ import annotations

import hashlib
import secrets
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import NamedTuple, Protocol

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.knowledge_fs import (
    KnowledgeFSApiCredential,
    KnowledgeFSApiCredentialStatus,
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpaceState,
    KnowledgeFSExternalAccessPolicy,
)
from services.knowledge_fs.product_dto import (
    KnowledgeFSCredentialCreatePayload,
    KnowledgeFSCredentialCreateResponse,
    KnowledgeFSCredentialItemResponse,
    KnowledgeFSCredentialListResponse,
)
from services.knowledge_fs.product_operations import (
    KNOWLEDGE_FS_PRODUCT_OPERATIONS,
    KnowledgeFSProductPermission,
    is_product_operation_ready,
)
from services.knowledge_fs.product_service import KnowledgeFSProductService
from services.knowledge_fs.revocation_commands import (
    KnowledgeFSRevocationCommandPort,
    KnowledgeFSRevocationCommandProducer,
)
from services.knowledge_fs_capability import KNOWLEDGE_FS_CAPABILITY_OPERATIONS

_SECRET_PREFIX = "kfs_"
_DISPLAY_PREFIX_LENGTH = 12


class KnowledgeFSCredentialError(RuntimeError):
    """Base class for stable credential failures."""


class KnowledgeFSCredentialValidationError(KnowledgeFSCredentialError):
    """A bearer credential is invalid, disabled, expired, or out of scope."""


class KnowledgeFSCredentialPolicyError(KnowledgeFSCredentialError):
    """A credential management request violates the product policy."""


class KnowledgeFSServiceCredentialProfile(NamedTuple):
    tenant_id: str
    control_space_id: str
    credential_id: str
    principal_id: str
    allowed_actions: frozenset[str]
    knowledge_space_id: str
    knowledge_space_revision: int
    membership_epoch: int
    space_acl_epoch: int
    external_access_epoch: int
    content_policy_revision: int
    credential_revision: int
    expires_at: datetime | None


class KnowledgeFSCredentialProfileCache(Protocol):
    def get(self, credential_hash: str) -> KnowledgeFSServiceCredentialProfile | None: ...

    def set(self, credential_hash: str, profile: KnowledgeFSServiceCredentialProfile) -> None: ...

    def invalidate(self, credential_hash: str) -> None: ...


class NullKnowledgeFSCredentialProfileCache:
    """Safe default: no cross-request authorization state is retained."""

    def get(self, credential_hash: str) -> KnowledgeFSServiceCredentialProfile | None:
        _ = credential_hash
        return None

    def set(self, credential_hash: str, profile: KnowledgeFSServiceCredentialProfile) -> None:
        _ = (credential_hash, profile)

    def invalidate(self, credential_hash: str) -> None:
        _ = credential_hash


def knowledge_fs_service_credential_actions() -> frozenset[str]:
    """Return only actions backed by an exact P2 product-operation mapping."""

    actions: set[str] = set()
    for product_operation_id, product_operation in KNOWLEDGE_FS_PRODUCT_OPERATIONS.items():
        if not is_product_operation_ready(product_operation_id):
            continue
        capability_operation_id = product_operation.capability_operation_id
        if capability_operation_id is None:
            continue
        actions.add(KNOWLEDGE_FS_CAPABILITY_OPERATIONS[capability_operation_id].action)
    return frozenset(actions)


class KnowledgeFSCredentialService:
    def __init__(
        self,
        session_maker: sessionmaker[Session],
        *,
        product: KnowledgeFSProductService,
        cache: KnowledgeFSCredentialProfileCache | None = None,
        revocations: KnowledgeFSRevocationCommandPort | None = None,
    ) -> None:
        self._session_maker = session_maker
        self._product = product
        self._cache = cache or NullKnowledgeFSCredentialProfileCache()
        self._revocations = revocations or KnowledgeFSRevocationCommandProducer()

    def create(
        self,
        *,
        tenant_id: str,
        actor_account_id: str,
        control_space_id: str,
        payload: KnowledgeFSCredentialCreatePayload,
    ) -> KnowledgeFSCredentialCreateResponse:
        self._product.authorize_control_space(
            tenant_id=tenant_id,
            account_id=actor_account_id,
            control_space_id=control_space_id,
            permission=KnowledgeFSProductPermission.API_KEY_MANAGE,
            require_active=True,
        )
        allowed_actions = _validate_allowed_actions(payload.allowed_actions)
        expires_at = _normalize_expiry(payload.expires_at)
        if expires_at is not None and expires_at <= naive_utc_now():
            raise KnowledgeFSCredentialPolicyError("Credential expiry must be in the future")

        raw_credential = f"{_SECRET_PREFIX}{secrets.token_urlsafe(32)}"
        credential_hash = hash_knowledge_fs_credential(raw_credential)
        credential = KnowledgeFSApiCredential(
            tenant_id=tenant_id,
            control_space_id=control_space_id,
            credential_hash=credential_hash,
            credential_prefix=raw_credential[:_DISPLAY_PREFIX_LENGTH],
            credential_last4=raw_credential[-4:],
            principal="pending",
            allowed_actions=list(allowed_actions),
            expires_at=expires_at,
            created_by_account_id=actor_account_id,
        )
        credential.principal = credential.id
        with self._session_maker.begin() as session:
            session.add(credential)
        return KnowledgeFSCredentialCreateResponse(
            id=credential.id,
            credential=raw_credential,
            credential_prefix=credential.credential_prefix,
            credential_last4=credential.credential_last4,
            principal=credential.principal,
            allowed_actions=list(allowed_actions),
            expires_at=credential.expires_at,
        )

    def list(
        self,
        *,
        tenant_id: str,
        actor_account_id: str,
        control_space_id: str,
    ) -> KnowledgeFSCredentialListResponse:
        self._product.authorize_control_space(
            tenant_id=tenant_id,
            account_id=actor_account_id,
            control_space_id=control_space_id,
            permission=KnowledgeFSProductPermission.API_KEY_MANAGE,
        )
        with self._session_maker() as session:
            credentials = tuple(
                session.scalars(
                    sa.select(KnowledgeFSApiCredential)
                    .where(
                        KnowledgeFSApiCredential.tenant_id == tenant_id,
                        KnowledgeFSApiCredential.control_space_id == control_space_id,
                    )
                    .order_by(KnowledgeFSApiCredential.created_at.desc(), KnowledgeFSApiCredential.id.desc())
                )
            )
        return KnowledgeFSCredentialListResponse(data=[_credential_item(item) for item in credentials])

    def revoke(
        self,
        *,
        tenant_id: str,
        actor_account_id: str,
        control_space_id: str,
        credential_id: str,
        reason: str = "revoked_by_user",
    ) -> None:
        self._product.authorize_control_space(
            tenant_id=tenant_id,
            account_id=actor_account_id,
            control_space_id=control_space_id,
            permission=KnowledgeFSProductPermission.API_KEY_MANAGE,
        )
        credential_hash: str | None = None
        with self._session_maker.begin() as session:
            credential = session.scalar(
                sa.select(KnowledgeFSApiCredential)
                .where(
                    KnowledgeFSApiCredential.tenant_id == tenant_id,
                    KnowledgeFSApiCredential.control_space_id == control_space_id,
                    KnowledgeFSApiCredential.id == credential_id,
                )
                .with_for_update()
            )
            if credential is None:
                raise KnowledgeFSCredentialPolicyError("KnowledgeFS credential was not found")
            credential_hash = credential.credential_hash
            if credential.status is KnowledgeFSApiCredentialStatus.ACTIVE:
                credential.status = KnowledgeFSApiCredentialStatus.REVOKED
                credential.revision += 1
                credential.revoked_at = naive_utc_now()
                credential.revoked_by_account_id = actor_account_id
                credential.revoke_reason = reason[:255]
                self._revocations.enqueue_principal_grants(
                    session=session,
                    tenant_id=tenant_id,
                    control_space_id=control_space_id,
                    subject=f"dify-kfs-credential:{credential.principal}",
                    reason_code="credential_revoked",
                    caller_kinds=("service",),
                )
        if credential_hash is not None:
            self._cache.invalidate(credential_hash)

    def validate_service_credential(
        self,
        *,
        raw_credential: str,
        required_action: str,
    ) -> KnowledgeFSServiceCredentialProfile:
        if not raw_credential.startswith(_SECRET_PREFIX) or len(raw_credential) < 32:
            raise KnowledgeFSCredentialValidationError("Invalid KnowledgeFS service credential")
        credential_hash = hash_knowledge_fs_credential(raw_credential)
        cached = self._cache.get(credential_hash)
        if cached is not None:
            if cached.expires_at is not None and cached.expires_at <= naive_utc_now():
                self._cache.invalidate(credential_hash)
                raise KnowledgeFSCredentialValidationError("Invalid KnowledgeFS service credential")
            if required_action not in cached.allowed_actions:
                raise KnowledgeFSCredentialValidationError("Credential action is not allowed")
            return cached

        with self._session_maker.begin() as session:
            row = session.execute(
                sa.select(
                    KnowledgeFSApiCredential,
                    KnowledgeFSControlSpace,
                    KnowledgeFSExternalAccessPolicy,
                    KnowledgeFSAuthorizationRevision,
                )
                .join(
                    KnowledgeFSControlSpace,
                    sa.and_(
                        KnowledgeFSControlSpace.tenant_id == KnowledgeFSApiCredential.tenant_id,
                        KnowledgeFSControlSpace.id == KnowledgeFSApiCredential.control_space_id,
                    ),
                )
                .outerjoin(
                    KnowledgeFSExternalAccessPolicy,
                    sa.and_(
                        KnowledgeFSExternalAccessPolicy.tenant_id == KnowledgeFSApiCredential.tenant_id,
                        KnowledgeFSExternalAccessPolicy.control_space_id == KnowledgeFSApiCredential.control_space_id,
                    ),
                )
                .join(
                    KnowledgeFSAuthorizationRevision,
                    sa.and_(
                        KnowledgeFSAuthorizationRevision.tenant_id == KnowledgeFSApiCredential.tenant_id,
                        KnowledgeFSAuthorizationRevision.control_space_id == KnowledgeFSApiCredential.control_space_id,
                    ),
                )
                .where(KnowledgeFSApiCredential.credential_hash == credential_hash)
                .with_for_update(of=KnowledgeFSApiCredential)
            ).one_or_none()
            if row is None:
                raise KnowledgeFSCredentialValidationError("Invalid KnowledgeFS service credential")
            credential, control_space, policy, revision = row._t
            now = naive_utc_now()
            if credential.expires_at is not None and credential.expires_at <= now:
                raise KnowledgeFSCredentialValidationError("Invalid KnowledgeFS service credential")
            if (
                credential.status is not KnowledgeFSApiCredentialStatus.ACTIVE
                or control_space.state is not KnowledgeFSControlSpaceState.ACTIVE
                or control_space.knowledge_space_id is None
                or policy is None
                or not policy.service_api_enabled
                or required_action not in credential.allowed_actions
            ):
                raise KnowledgeFSCredentialValidationError("Invalid KnowledgeFS service credential")
            credential.last_used_at = now
            profile = KnowledgeFSServiceCredentialProfile(
                tenant_id=credential.tenant_id,
                control_space_id=credential.control_space_id,
                credential_id=credential.id,
                principal_id=credential.principal,
                allowed_actions=frozenset(credential.allowed_actions),
                knowledge_space_id=control_space.knowledge_space_id,
                knowledge_space_revision=control_space.knowledge_space_revision,
                membership_epoch=revision.membership_epoch,
                space_acl_epoch=revision.space_acl_epoch,
                external_access_epoch=revision.external_access_epoch,
                content_policy_revision=revision.content_policy_revision,
                credential_revision=credential.revision,
                expires_at=credential.expires_at,
            )
        self._cache.set(credential_hash, profile)
        return profile


def hash_knowledge_fs_credential(raw_credential: str) -> str:
    return f"sha256:{hashlib.sha256(raw_credential.encode()).hexdigest()}"


def _validate_allowed_actions(actions: Sequence[str]) -> tuple[str, ...]:
    normalized = tuple(dict.fromkeys(action.strip() for action in actions if action.strip()))
    if not normalized or len(normalized) != len(actions):
        raise KnowledgeFSCredentialPolicyError("Credential actions must be unique and non-empty")
    supported = knowledge_fs_service_credential_actions()
    if not set(normalized).issubset(supported):
        raise KnowledgeFSCredentialPolicyError("Credential action is not registered for the service profile")
    return tuple(sorted(normalized))


def _normalize_expiry(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None or value.utcoffset() is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def _credential_item(credential: KnowledgeFSApiCredential) -> KnowledgeFSCredentialItemResponse:
    status = credential.status
    if (
        status is KnowledgeFSApiCredentialStatus.ACTIVE
        and credential.expires_at is not None
        and credential.expires_at <= naive_utc_now()
    ):
        status = KnowledgeFSApiCredentialStatus.EXPIRED
    return KnowledgeFSCredentialItemResponse(
        id=credential.id,
        credential_prefix=credential.credential_prefix,
        credential_last4=credential.credential_last4,
        principal=credential.principal,
        allowed_actions=list(credential.allowed_actions),
        status=status.value,
        revision=credential.revision,
        expires_at=credential.expires_at,
        last_used_at=credential.last_used_at,
    )


__all__ = [
    "KnowledgeFSCredentialError",
    "KnowledgeFSCredentialPolicyError",
    "KnowledgeFSCredentialProfileCache",
    "KnowledgeFSCredentialService",
    "KnowledgeFSCredentialValidationError",
    "KnowledgeFSServiceCredentialProfile",
    "NullKnowledgeFSCredentialProfileCache",
    "hash_knowledge_fs_credential",
    "knowledge_fs_service_credential_actions",
]
