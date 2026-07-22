from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.knowledge_fs import (
    KnowledgeFSApiCredential,
    KnowledgeFSApiCredentialStatus,
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSCapabilityIssuanceAudit,
    KnowledgeFSCapabilityIssuanceReservation,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpaceState,
    KnowledgeFSExternalAccessPolicy,
    KnowledgeFSLifecycleOutbox,
)
from services.knowledge_fs.credential_service import (
    KnowledgeFSCredentialPolicyError,
    KnowledgeFSCredentialService,
    KnowledgeFSCredentialValidationError,
    KnowledgeFSServiceCredentialProfile,
    NullKnowledgeFSCredentialProfileCache,
    hash_knowledge_fs_credential,
)
from services.knowledge_fs.product_dto import KnowledgeFSCredentialCreatePayload
from services.knowledge_fs.product_operations import KnowledgeFSProductPermission
from services.knowledge_fs.product_service import AuthorizedKnowledgeFSControlSpace


class FakeProduct:
    def __init__(self, control_space: KnowledgeFSControlSpace):
        self.control_space = control_space
        self.calls: list[KnowledgeFSProductPermission] = []

    def authorize_control_space(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        permission: KnowledgeFSProductPermission,
        require_active: bool = False,
    ) -> AuthorizedKnowledgeFSControlSpace:
        _ = (tenant_id, account_id, control_space_id, require_active)
        self.calls.append(permission)
        return AuthorizedKnowledgeFSControlSpace(self.control_space, permission, (permission,))


class MemoryCache:
    def __init__(self) -> None:
        self.items: dict[str, KnowledgeFSServiceCredentialProfile] = {}
        self.invalidated: list[str] = []

    def get(self, credential_hash: str) -> KnowledgeFSServiceCredentialProfile | None:
        return self.items.get(credential_hash)

    def set(self, credential_hash: str, profile: KnowledgeFSServiceCredentialProfile) -> None:
        self.items[credential_hash] = profile

    def invalidate(self, credential_hash: str) -> None:
        self.invalidated.append(credential_hash)
        self.items.pop(credential_hash, None)


def _service(
    sqlite_session: Session,
    control_space: KnowledgeFSControlSpace,
    *,
    cache: MemoryCache | None = None,
) -> KnowledgeFSCredentialService:
    return KnowledgeFSCredentialService(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        product=FakeProduct(control_space),  # type: ignore[arg-type]
        cache=cache,
    )


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSApiCredential,
            KnowledgeFSExternalAccessPolicy,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSCapabilityIssuanceAudit,
            KnowledgeFSCapabilityIssuanceReservation,
            KnowledgeFSLifecycleOutbox,
        )
    ],
    indirect=True,
)
def test_service_credential_is_returned_once_hashed_and_resource_bound(sqlite_session: Session) -> None:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="owner-1",
        provisioning_key="provision-1",
        knowledge_space_id="space-1",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    sqlite_session.add_all(
        [
            space,
            KnowledgeFSAuthorizationRevision(
                tenant_id="tenant-1",
                control_space_id=space.id,
                space_acl_epoch=3,
                external_access_epoch=4,
            ),
            KnowledgeFSExternalAccessPolicy(
                tenant_id="tenant-1",
                control_space_id=space.id,
                service_api_enabled=True,
            ),
        ]
    )
    sqlite_session.commit()
    cache = MemoryCache()
    service = _service(sqlite_session, space, cache=cache)

    created = service.create(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=space.id,
        payload=KnowledgeFSCredentialCreatePayload(
            allowed_actions=["documents.list"],
            expires_at=naive_utc_now() + timedelta(hours=1),
        ),
    )
    profile = service.validate_service_credential(
        raw_credential=created.credential,
        required_action="documents.list",
    )

    stored = sqlite_session.scalar(select(KnowledgeFSApiCredential).where(KnowledgeFSApiCredential.id == created.id))
    assert stored is not None
    assert created.credential.startswith("kfs_")
    assert created.credential not in stored.credential_hash
    assert stored.credential_hash.startswith("sha256:")
    assert profile.control_space_id == space.id
    assert profile.knowledge_space_id == "space-1"
    assert profile.space_acl_epoch == 3
    assert profile.external_access_epoch == 4
    assert profile.credential_revision == 0

    sqlite_session.add(
        KnowledgeFSCapabilityIssuanceAudit(
            tenant_id="tenant-1",
            control_space_id=space.id,
            trace_id="trace-credential",
            jti_hash=f"sha256:{'b' * 64}",
            claims_summary={
                "caller_kind": "service",
                "grant_id": "20000000-0000-4000-8000-000000000002",
                "subject": f"dify-kfs-credential:{created.principal}",
            },
        )
    )
    sqlite_session.commit()

    service.revoke(
        tenant_id="tenant-1",
        actor_account_id="owner-1",
        control_space_id=space.id,
        credential_id=created.id,
    )

    assert cache.invalidated == [stored.credential_hash]
    command = sqlite_session.scalar(select(KnowledgeFSLifecycleOutbox))
    assert command is not None
    assert command.command_payload["principal"] == f"dify-kfs-credential:{created.principal}"
    assert command.command_payload["reason_code"] == "credential_revoked"
    with pytest.raises(KnowledgeFSCredentialValidationError):
        service.validate_service_credential(raw_credential=created.credential, required_action="documents.list")


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSApiCredential)],
    indirect=True,
)
def test_credential_rejects_manifest_gap_before_persistence(sqlite_session: Session) -> None:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="owner-1",
        provisioning_key="provision-1",
        knowledge_space_id="space-1",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    sqlite_session.add(space)
    sqlite_session.commit()
    service = _service(sqlite_session, space)

    with pytest.raises(KnowledgeFSCredentialPolicyError, match="not registered"):
        service.create(
            tenant_id="tenant-1",
            actor_account_id="owner-1",
            control_space_id=space.id,
            payload=KnowledgeFSCredentialCreatePayload(allowed_actions=["documents.create"]),
        )

    assert sqlite_session.scalar(select(KnowledgeFSApiCredential)) is None


def test_null_cache_and_hash_are_deterministic_without_retaining_authorization_state() -> None:
    cache = NullKnowledgeFSCredentialProfileCache()
    profile = KnowledgeFSServiceCredentialProfile(
        "tenant-1",
        "control-1",
        "credential-1",
        "principal-1",
        frozenset({"documents.list"}),
        "space-1",
        1,
        0,
        0,
        0,
        0,
        0,
        None,
    )

    assert cache.get("hash-1") is None
    cache.set("hash-1", profile)
    cache.invalidate("hash-1")
    assert cache.get("hash-1") is None
    assert hash_knowledge_fs_credential("kfs_secret") == hash_knowledge_fs_credential("kfs_secret")
    assert hash_knowledge_fs_credential("kfs_secret") != hash_knowledge_fs_credential("kfs_other")


def test_cached_credential_validation_expires_denies_and_accepts_without_database_io() -> None:
    raw_credential = f"kfs_{'a' * 40}"
    credential_hash = hash_knowledge_fs_credential(raw_credential)
    cache = MemoryCache()
    session_maker = MagicMock()
    service = KnowledgeFSCredentialService(session_maker, product=MagicMock(), cache=cache)

    with pytest.raises(KnowledgeFSCredentialValidationError, match="Invalid"):
        service.validate_service_credential(raw_credential="not-kfs", required_action="documents.list")

    expired = KnowledgeFSServiceCredentialProfile(
        "tenant-1",
        "control-1",
        "credential-1",
        "principal-1",
        frozenset({"documents.list"}),
        "space-1",
        1,
        0,
        0,
        0,
        0,
        0,
        naive_utc_now() - timedelta(seconds=1),
    )
    cache.items[credential_hash] = expired
    with pytest.raises(KnowledgeFSCredentialValidationError, match="Invalid"):
        service.validate_service_credential(raw_credential=raw_credential, required_action="documents.list")
    assert cache.invalidated == [credential_hash]

    active = expired._replace(expires_at=naive_utc_now() + timedelta(hours=1))
    cache.items[credential_hash] = active
    with pytest.raises(KnowledgeFSCredentialValidationError, match="action"):
        service.validate_service_credential(raw_credential=raw_credential, required_action="sources.list")
    assert (
        service.validate_service_credential(raw_credential=raw_credential, required_action="documents.list") is active
    )
    session_maker.begin.assert_not_called()


def _database_validation_service(
    row: object | None,
    *,
    cache: MemoryCache | None = None,
) -> KnowledgeFSCredentialService:
    session = MagicMock()
    session.execute.return_value.one_or_none.return_value = row
    transaction = MagicMock()
    transaction.__enter__.return_value = session
    session_maker = MagicMock()
    session_maker.begin.return_value = transaction
    return KnowledgeFSCredentialService(session_maker, product=MagicMock(), cache=cache)


def test_database_credential_validation_rejects_missing_row() -> None:
    service = _database_validation_service(None)

    with pytest.raises(KnowledgeFSCredentialValidationError, match="Invalid"):
        service.validate_service_credential(
            raw_credential=f"kfs_{'b' * 40}",
            required_action="documents.list",
        )


@pytest.mark.parametrize(
    "invalid_update",
    [
        {"expires_at": naive_utc_now() - timedelta(seconds=1)},
        {"status": KnowledgeFSApiCredentialStatus.REVOKED},
        {"control_state": KnowledgeFSControlSpaceState.ERROR},
        {"knowledge_space_id": None},
        {"policy": None},
        {"service_api_enabled": False},
        {"allowed_actions": ["sources.list"]},
    ],
)
def test_database_credential_validation_fails_closed_for_every_authorization_dimension(
    invalid_update: dict[str, object],
) -> None:
    credential = SimpleNamespace(
        id="credential-1",
        tenant_id="tenant-1",
        control_space_id="control-1",
        principal="principal-1",
        allowed_actions=["documents.list"],
        expires_at=None,
        revision=2,
        status=KnowledgeFSApiCredentialStatus.ACTIVE,
        last_used_at=None,
    )
    control_space = SimpleNamespace(
        state=KnowledgeFSControlSpaceState.ACTIVE,
        knowledge_space_id="space-1",
        knowledge_space_revision=3,
    )
    policy = SimpleNamespace(service_api_enabled=True)
    revision = SimpleNamespace(
        membership_epoch=1,
        space_acl_epoch=2,
        external_access_epoch=3,
        content_policy_revision=4,
    )
    if "control_state" in invalid_update:
        control_space.state = invalid_update["control_state"]
    elif "knowledge_space_id" in invalid_update:
        control_space.knowledge_space_id = invalid_update["knowledge_space_id"]
    elif "policy" in invalid_update:
        policy = invalid_update["policy"]
    elif "service_api_enabled" in invalid_update:
        policy.service_api_enabled = invalid_update["service_api_enabled"]
    else:
        for name, value in invalid_update.items():
            setattr(credential, name, value)
    row = SimpleNamespace(_t=(credential, control_space, policy, revision))
    service = _database_validation_service(row)

    with pytest.raises(KnowledgeFSCredentialValidationError, match="Invalid"):
        service.validate_service_credential(
            raw_credential=f"kfs_{'c' * 40}",
            required_action="documents.list",
        )


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSApiCredential)],
    indirect=True,
)
def test_credential_policy_rejects_duplicate_and_past_expiry_and_lists_expired_items(
    sqlite_session: Session,
) -> None:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="owner-1",
        provisioning_key="provision-1",
        knowledge_space_id="space-1",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    expired = KnowledgeFSApiCredential(
        tenant_id="tenant-1",
        control_space_id=space.id,
        credential_hash=hash_knowledge_fs_credential(f"kfs_{'d' * 40}"),
        credential_prefix="kfs_dddddddd",
        credential_last4="dddd",
        principal="credential-expired",
        allowed_actions=["documents.list"],
        expires_at=naive_utc_now() - timedelta(seconds=1),
        created_by_account_id="owner-1",
    )
    sqlite_session.add_all([space, expired])
    sqlite_session.commit()
    service = _service(sqlite_session, space)

    with pytest.raises(KnowledgeFSCredentialPolicyError, match="unique and non-empty"):
        service.create(
            tenant_id="tenant-1",
            actor_account_id="owner-1",
            control_space_id=space.id,
            payload=KnowledgeFSCredentialCreatePayload(
                allowed_actions=["documents.list", "documents.list"],
            ),
        )
    with pytest.raises(KnowledgeFSCredentialPolicyError, match="future"):
        service.create(
            tenant_id="tenant-1",
            actor_account_id="owner-1",
            control_space_id=space.id,
            payload=KnowledgeFSCredentialCreatePayload(
                allowed_actions=["documents.list"],
                expires_at=datetime.now(UTC) - timedelta(hours=1),
            ),
        )

    listed = service.list(tenant_id="tenant-1", actor_account_id="owner-1", control_space_id=space.id)
    assert listed.data[0].status == "expired"
    with pytest.raises(KnowledgeFSCredentialPolicyError, match="not found"):
        service.revoke(
            tenant_id="tenant-1",
            actor_account_id="owner-1",
            control_space_id=space.id,
            credential_id="missing-credential",
        )
