from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from hashlib import sha1, sha256
from unittest.mock import MagicMock, call, create_autospec, patch

import httpx
import pytest
from redis import RedisError
from redis.crc import key_slot
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import Unauthorized

from extensions.ext_redis import RedisClientWrapper
from libs.datetime_utils import naive_utc_now
from libs.helper import RateLimiter
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from services.account import adapters
from services.account.adapters import (
    AccountIdentityGateway,
    BillingAccountActivationEligibility,
    BillingAccountEducationGateway,
    BillingAccountEmailPolicyGateway,
    BillingWorkspaceMembershipCache,
    CeleryAccountDeletionVerificationNotifier,
    DeploymentWorkspaceInvitePolicy,
    RBACWorkspaceMemberAccessSync,
    RedisChangeEmailSecurityGateway,
    RedisInvitationTokenStore,
    TokenManagerAccountDeletionVerificationGateway,
    TokenManagerChangeEmailTokenGateway,
)
from services.account_errors import (
    AccountDeletionRateLimitError,
    EducationActivationFailedError,
    EducationRequestInProgressError,
    EducationVerificationFailedError,
)
from services.billing_client import billing, transport
from services.entities.account_activation_entities import InvitationLookup, InvitationToken
from services.entities.account_entities import (
    AccountChangeEmailNewEmailToken,
    AccountEducationActivation,
    AccountEducationAutocomplete,
    AccountEducationEligible,
    AccountEducationNotEligible,
    AccountEducationStatus,
    AccountEducationVerification,
)
from services.errors.billing import (
    BillingUpstreamError,
    BillingUpstreamInvalidResponseError,
    UnknownErrorReason,
)
from tests.helpers.unit.account_domain import AccountDomain
from tests.helpers.unit.redis_commands import RedisCommandEmulator


def test_invitation_token_store_reads_workspace_invitation_key(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    redis, commands = redis_transport
    commands.side_effect = lambda command, key, *_args, **_kwargs: (
        None if command == "GET" and str(key).endswith(":state") else b"account-1"
    )
    lookup = InvitationLookup(workspace_id="workspace-1", email="invitee@example.com", token="token-1")

    result = RedisInvitationTokenStore(redis=redis).find(lookup)

    assert result == InvitationToken(
        account_id="account-1",
        email="invitee@example.com",
        workspace_id="workspace-1",
    )
    email_hash = sha256(b"invitee@example.com").hexdigest()
    commands.assert_has_calls(
        [
            call(
                "GET",
                f"member_invite_token:workspace-1, {email_hash}:token-1",
                keys=[f"member_invite_token:workspace-1, {email_hash}:token-1"],
            ),
            call(
                "GET",
                "member_invite:subject:workspace-1:account-1:state",
                keys=["member_invite:subject:workspace-1:account-1:state"],
            ),
        ]
    )


def test_invitation_token_store_reads_global_invitation_payload(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    redis, commands = redis_transport
    payload = (
        b'{"account_id":"account-1","email":"invitee@example.com","workspace_id":"workspace-1",'
        b'"role":"editor","requires_setup":false}'
    )
    commands.side_effect = lambda command, key, *_args, **_kwargs: (
        None if command == "GET" and str(key).endswith(":state") else payload
    )
    lookup = InvitationLookup(workspace_id=None, email="invitee@example.com", token="token-1")

    result = RedisInvitationTokenStore(redis=redis).find(lookup)

    assert result == InvitationToken(
        account_id="account-1",
        email="invitee@example.com",
        workspace_id="workspace-1",
        role="editor",
        requires_setup=False,
    )
    commands.assert_has_calls(
        [
            call("GET", "member_invite:token:token-1", keys=["member_invite:token:token-1"]),
            call(
                "GET",
                "member_invite:subject:workspace-1:account-1:state",
                keys=["member_invite:subject:workspace-1:account-1:state"],
            ),
        ]
    )


def test_invitation_token_store_rejects_every_token_for_a_revoked_subject(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    redis, commands = redis_transport
    payload = (
        b'{"account_id":"account-1","email":"invitee@example.com","workspace_id":"workspace-1",'
        b'"role":"editor","requires_setup":false}'
    )

    def execute(command: object, key: object, *_args: object, **_kwargs: object) -> object:
        if command == "GET" and str(key).endswith(":state"):
            return b"revoked"
        if command == "GET":
            return payload
        return 1

    commands.side_effect = execute
    lookup = InvitationLookup(workspace_id=None, email=None, token="older-token")

    assert RedisInvitationTokenStore(redis=redis).find(lookup) is None


def test_new_invitation_reopens_only_its_subject_lifecycle(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    redis, commands = redis_transport
    invitation = InvitationToken(
        account_id="account-1",
        email="invitee@example.com",
        workspace_id="workspace-1",
    )

    with patch("services.account.adapters.uuid.uuid4", return_value="new-token"):
        token = RedisInvitationTokenStore(redis=redis).create(invitation)

    assert token == "new-token"
    flattened_args = tuple(str(value) for call_args in commands.call_args_list for value in call_args.args)
    assert "member_invite:token:new-token" in flattened_args
    assert "member_invite:subject:workspace-1:account-1:state" in flattened_args


def test_reinvitation_does_not_reactivate_an_older_subject_token(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    redis, commands = redis_transport
    stored: dict[str, object] = {}

    def execute(command: object, *args: object, **_kwargs: object) -> object:
        operation, key = str(command).upper(), str(args[0])
        if operation == "SETEX":
            stored[key] = args[2]
            return True
        if operation == "GET":
            return stored.get(key)
        return None

    commands.side_effect = execute
    store = RedisInvitationTokenStore(redis=redis)
    invitation = InvitationToken(
        account_id="account-1",
        email="invitee@example.com",
        workspace_id="workspace-1",
    )
    with patch("services.account.adapters.uuid.uuid4", side_effect=["token-a", "token-b"]):
        first = store.create(invitation)
        second = store.create(invitation)

    assert store.find(InvitationLookup(workspace_id=None, email=None, token=first)) is None
    assert store.find(InvitationLookup(workspace_id=None, email=None, token=second)) == invitation


class _InvitationRedis:
    """In-memory stand-in for the Redis commands the invitation store issues.

    Scripts are emulated by their SHA so the test fails if the store starts
    sending a script this fake does not know, and every command is checked to
    address a single Redis Cluster hash slot.
    """

    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.index = RedisCommandEmulator()
        self.ttls: dict[str, int] = {}
        self.script_key_counts: list[int] = []
        self.failing: set[tuple[str, str]] = set()
        self._scripts: dict[str, Callable[[str, list[str]], object]] = {
            sha1(adapters._RELEASE_INVITATION_ACCEPTANCE_LUA.encode()).hexdigest(): self._release,
            sha1(adapters._REVOKE_INVITATION_SUBJECT_LUA.encode()).hexdigest(): self._revoke,
            sha1(adapters._REVOKE_ACCEPTED_INVITATION_SUBJECT_LUA.encode()).hexdigest(): self._revoke_accepted,
        }

    def put(self, key: str, value: str, ttl: int = 60_000) -> None:
        self.values[key] = value
        self.ttls[key] = ttl

    def execute(self, command: object, *args: object, **_kwargs: object) -> object:
        operation = str(command).upper()
        if operation == "EVALSHA":
            key_count = int(str(args[1]))
            keys = [str(key) for key in args[2 : 2 + key_count]]
            self.script_key_counts.append(key_count)
            assert len({key_slot(key.encode()) for key in keys}) == 1
            self._fail_if_requested(operation, keys[0])
            return self._scripts[str(args[0])](keys[0], [str(arg) for arg in args[2 + key_count :]])
        key = str(args[0])
        self._fail_if_requested(operation, key)
        if operation.startswith("Z") or operation == "EXPIRE":
            return self.index(operation, *args)
        match operation:
            case "GET":
                value = self.values.get(key)
                return None if value is None else value.encode()
            case "PTTL":
                return self.ttls.get(key, -2)
            case "SET":
                options = [str(option).upper() for option in args[2:]]
                if "NX" in options and key in self.values:
                    return None
                self.put(key, str(args[1]), int(str(args[2:][options.index("PX") + 1])))
                return True
            case "SETEX":
                self.put(
                    key, args[2].decode() if isinstance(args[2], bytes) else str(args[2]), int(str(args[1])) * 1000
                )
                return True
            case "DEL":
                assert len(args) == 1
                self.ttls.pop(key, None)
                return 1 if self.values.pop(key, None) is not None else 0
            case _:
                raise AssertionError(f"Unexpected Redis command: {operation}")

    def _fail_if_requested(self, operation: str, key: str) -> None:
        if (operation, key) in self.failing:
            raise RedisError("redis unavailable")

    def _release(self, key: str, args: list[str]) -> object:
        if self.values.get(key) != args[0]:
            return 0
        del self.values[key]
        self.ttls.pop(key, None)
        return 1

    def _revoke(self, key: str, args: list[str]) -> object:
        ttl = self.ttls.get(key, -2)
        self.put(key, "revoked", ttl if ttl > 0 else int(args[0]))
        return ttl

    def _revoke_accepted(self, key: str, args: list[str]) -> object:
        state = self.values.get(key)
        if state is not None and state not in {args[0], "revoked"}:
            return 0
        ttl = self.ttls.get(key, -2)
        self.put(key, "revoked", ttl if ttl > 0 else int(args[1]))
        return 1


_INVITATION = InvitationToken(account_id="account-1", email="invitee@example.com", workspace_id="workspace-1")
_SUBJECT_KEY = "member_invite:subject:workspace-1:account-1:state"


@pytest.fixture
def invitation_redis(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> tuple[RedisInvitationTokenStore, _InvitationRedis]:
    redis, commands = redis_transport
    fake = _InvitationRedis()
    commands.side_effect = fake.execute
    return RedisInvitationTokenStore(redis=redis), fake


def _issued_invitation(store: RedisInvitationTokenStore) -> InvitationLookup:
    return InvitationLookup(workspace_id=None, email=None, token=store.create(_INVITATION))


def _claimed(store: RedisInvitationTokenStore, lookup: InvitationLookup, *, membership: bool) -> str:
    claim_id = store.claim(lookup, require_unused_membership=membership)
    assert claim_id is not None
    return claim_id


def test_invitation_scripts_never_span_redis_cluster_hash_slots(
    invitation_redis: tuple[RedisInvitationTokenStore, _InvitationRedis],
) -> None:
    store, fake = invitation_redis
    lookup = _issued_invitation(store)
    workspace_lookup = InvitationLookup(workspace_id="workspace-1", email="invitee@example.com", token="legacy-token")
    fake.put(RedisInvitationTokenStore._workspace_invitation_key(workspace_lookup), "account-1")

    store.complete_membership(lookup, _claimed(store, lookup, membership=True))
    store.release(lookup, _claimed(store, lookup, membership=False))
    store.complete_activation(lookup, _claimed(store, lookup, membership=False))
    store.complete_activation(workspace_lookup, _claimed(store, workspace_lookup, membership=False))
    store.revoke_subject("workspace-1", "account-1")

    # The fake asserts one hash slot per command; a script with one key cannot be cross-slot.
    assert fake.script_key_counts
    assert set(fake.script_key_counts) == {1}


def test_membership_completion_keeps_the_token_usable_for_one_activation(
    invitation_redis: tuple[RedisInvitationTokenStore, _InvitationRedis],
) -> None:
    store, fake = invitation_redis
    lookup = _issued_invitation(store)

    store.complete_membership(lookup, _claimed(store, lookup, membership=True))

    # Sign-in restored the membership; the invite-settings step still needs the token.
    assert store.find(lookup) == _INVITATION
    assert store.is_membership_consumed(lookup) is True
    assert store.is_subject_revoked("workspace-1", "account-1") is False
    assert store.claim(lookup, require_unused_membership=True) is None

    store.complete_activation(lookup, _claimed(store, lookup, membership=False))

    assert store.find(lookup) is None
    assert store.claim(lookup, require_unused_membership=False) is None
    assert f"member_invite:token:{lookup.token}:acceptance_claim" not in fake.values


def test_member_removal_after_membership_completion_still_rejects_the_token(
    invitation_redis: tuple[RedisInvitationTokenStore, _InvitationRedis],
) -> None:
    store, _fake = invitation_redis
    lookup = _issued_invitation(store)
    store.complete_membership(lookup, _claimed(store, lookup, membership=True))

    store.revoke_subject("workspace-1", "account-1")

    assert store.find(lookup) is None


def test_reinvitation_after_membership_completion_still_rejects_the_earlier_token(
    invitation_redis: tuple[RedisInvitationTokenStore, _InvitationRedis],
) -> None:
    store, _fake = invitation_redis
    earlier = _issued_invitation(store)
    store.complete_membership(earlier, _claimed(store, earlier, membership=True))

    later = _issued_invitation(store)

    assert store.find(earlier) is None
    assert store.find(later) == _INVITATION


def test_activation_completion_consumes_a_workspace_scoped_invitation(
    invitation_redis: tuple[RedisInvitationTokenStore, _InvitationRedis],
) -> None:
    store, fake = invitation_redis
    lookup = InvitationLookup(workspace_id="workspace-1", email="invitee@example.com", token="token-1")
    source_key = f"member_invite_token:workspace-1, {sha256(b'invitee@example.com').hexdigest()}:token-1"
    fake.put(source_key, "account-1", ttl=5_000)

    store.complete_activation(lookup, _claimed(store, lookup, membership=False))

    assert source_key not in fake.values
    assert "member_invite:token:token-1:acceptance_claim" not in fake.values
    # A subject without prior state is tombstoned for the source's remaining lifetime.
    assert fake.values[_SUBJECT_KEY] == "revoked"
    assert fake.ttls[_SUBJECT_KEY] == 5_000


def test_activation_completion_does_not_revoke_a_newer_invitation(
    invitation_redis: tuple[RedisInvitationTokenStore, _InvitationRedis],
) -> None:
    store, fake = invitation_redis
    earlier = _issued_invitation(store)
    claim_id = _claimed(store, earlier, membership=False)
    later = _issued_invitation(store)

    store.complete_activation(earlier, claim_id)

    assert fake.values[_SUBJECT_KEY] == later.token
    assert store.find(earlier) is None
    assert store.find(later) == _INVITATION


@pytest.mark.parametrize("membership", [True, False])
def test_completion_requires_the_owned_claim_and_writes_nothing_otherwise(
    invitation_redis: tuple[RedisInvitationTokenStore, _InvitationRedis], membership: bool
) -> None:
    store, fake = invitation_redis
    lookup = _issued_invitation(store)
    _claimed(store, lookup, membership=membership)
    before = dict(fake.values)

    with pytest.raises(RuntimeError, match="no longer owned"):
        store._complete(lookup, "claim:someone-else", membership=membership)

    assert fake.values == before
    assert store.find(lookup) == _INVITATION


def test_activation_completion_succeeds_when_cleanup_after_revocation_fails(
    invitation_redis: tuple[RedisInvitationTokenStore, _InvitationRedis],
) -> None:
    store, fake = invitation_redis
    lookup = _issued_invitation(store)
    claim_id = _claimed(store, lookup, membership=False)
    claim_key = f"member_invite:token:{lookup.token}:acceptance_claim"
    fake.failing = {("DEL", f"member_invite:token:{lookup.token}"), ("EVALSHA", claim_key)}

    store.complete_activation(lookup, claim_id)

    # The committed acceptance is reported as success and the token is already unusable.
    assert store.find(lookup) is None
    assert store.claim(lookup, require_unused_membership=False) is None


@pytest.mark.parametrize("membership", [True, False])
def test_completion_failure_before_the_decisive_write_leaves_the_invitation_retryable(
    invitation_redis: tuple[RedisInvitationTokenStore, _InvitationRedis], membership: bool
) -> None:
    store, fake = invitation_redis
    lookup = _issued_invitation(store)
    claim_id = _claimed(store, lookup, membership=membership)
    decisive = (
        ("SET", f"member_invite:token:{lookup.token}:membership_used") if membership else ("EVALSHA", _SUBJECT_KEY)
    )
    fake.failing = {decisive}

    with pytest.raises(RedisError):
        store._complete(lookup, claim_id, membership=membership)

    fake.failing = set()
    assert store.find(lookup) == _INVITATION
    assert store.is_membership_consumed(lookup) is False
    store._complete(lookup, claim_id, membership=membership)


def test_invitation_subject_revocation_uses_an_atomic_bounded_tombstone(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    redis, commands = redis_transport
    commands.return_value = 1

    store = RedisInvitationTokenStore(redis=redis)
    store.revoke_subject("workspace-1", "account-1")

    eval_call = next(call_args for call_args in commands.call_args_list if call_args.args[0] == "EVALSHA")
    assert "member_invite:subject:workspace-1:account-1:state" in eval_call.args
    assert eval_call.args[-1] == store._maximum_ttl_ms()


@pytest.mark.parametrize(("stored", "expected"), [(b"revoked", True), ("revoked", True), (None, False)])
def test_invitation_token_store_reports_subject_revocation(
    redis_transport: tuple[RedisClientWrapper, MagicMock], stored: bytes | str | None, expected: bool
) -> None:
    redis, commands = redis_transport
    commands.return_value = stored

    assert RedisInvitationTokenStore(redis=redis).is_subject_revoked("workspace-1", "account-1") is expected

    commands.assert_called_once_with(
        "GET",
        "member_invite:subject:workspace-1:account-1:state",
        keys=["member_invite:subject:workspace-1:account-1:state"],
    )


def test_invitation_token_store_claims_for_the_source_token_lifetime(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    redis, commands = redis_transport
    commands.return_value = 1
    lookup = InvitationLookup(workspace_id=None, email="invitee@example.com", token="token-1")

    with patch("services.account.adapters.uuid.uuid4", return_value="claim-uuid"):
        claim_id = RedisInvitationTokenStore(redis=redis).claim(lookup, require_unused_membership=True)

    assert claim_id == "claim:claim-uuid"
    flattened_args = tuple(str(value) for call_args in commands.call_args_list for value in call_args.args)
    assert "member_invite:token:token-1" in flattened_args
    assert "member_invite:token:token-1:acceptance_claim" in flattened_args
    assert "member_invite:token:token-1:membership_used" in flattened_args


def test_invitation_token_store_refuses_claim_without_live_source_token(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    redis, commands = redis_transport
    commands.return_value = 0
    lookup = InvitationLookup(workspace_id=None, email="invitee@example.com", token="token-1")

    assert RedisInvitationTokenStore(redis=redis).claim(lookup, require_unused_membership=True) is None


def test_invitation_token_store_rechecks_membership_after_acquiring_claim(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    redis, commands = redis_transport
    membership_reads = 0

    def execute(command: object, key: object, *_args: object, **_kwargs: object) -> object:
        nonlocal membership_reads
        if command == "GET" and str(key).endswith(":membership_used"):
            membership_reads += 1
            return None if membership_reads == 1 else b"1"
        if command == "PTTL":
            return 3600
        if command == "SET":
            return b"OK"
        return 1

    commands.side_effect = execute
    lookup = InvitationLookup(workspace_id=None, email="invitee@example.com", token="token-1")

    assert RedisInvitationTokenStore(redis=redis).claim(lookup, require_unused_membership=True) is None

    assert membership_reads == 2
    assert any(call_args.args[0] == "EVALSHA" for call_args in commands.call_args_list)


@pytest.mark.parametrize(("stored", "expected"), [(b"1", True), ("1", True), (None, False)])
def test_invitation_token_store_reports_membership_use(
    redis_transport: tuple[RedisClientWrapper, MagicMock], stored: bytes | str | None, expected: bool
) -> None:
    redis, commands = redis_transport
    commands.return_value = stored
    lookup = InvitationLookup(workspace_id="workspace-1", email="invitee@example.com", token="token-1")

    assert RedisInvitationTokenStore(redis=redis).is_membership_consumed(lookup) is expected

    commands.assert_called_once_with(
        "GET",
        "member_invite:token:token-1:membership_used",
        keys=["member_invite:token:token-1:membership_used"],
    )


def test_billing_eligibility_skips_gateway_when_disabled() -> None:
    with patch("services.account.adapters.BillingService.get_email_freeze_type") as get_freeze_type:
        result = BillingAccountActivationEligibility(enabled=False).get_freeze_type("invitee@example.com")

    assert result is None
    get_freeze_type.assert_not_called()


def test_billing_eligibility_returns_freeze_type_when_enabled() -> None:
    with patch(
        "services.account.adapters.BillingService.get_email_freeze_type",
        return_value="email_domain_suspended",
    ) as get_freeze_type:
        result = BillingAccountActivationEligibility(enabled=True).get_freeze_type("invitee@example.com")

    assert result == "email_domain_suspended"
    get_freeze_type.assert_called_once_with("invitee@example.com")


def test_membership_cache_skips_gateway_when_disabled() -> None:
    with patch("services.account.adapters.BillingService.clean_billing_info_cache") as invalidate:
        BillingWorkspaceMembershipCache(enabled=False).invalidate("workspace-1")

    invalidate.assert_not_called()


def test_workspace_policy_delegates_to_existing_policy_owner() -> None:
    with patch("services.account.adapters.check_workspace_member_invite_permission") as ensure_allowed:
        DeploymentWorkspaceInvitePolicy().ensure_allowed("workspace-1")

    ensure_allowed.assert_called_once_with("workspace-1")


def test_rbac_member_access_sync_skips_gateway_when_disabled() -> None:
    with patch(
        "tasks.initialize_created_app_rbac_access_task.sync_joined_workspace_member_rbac_access_task.delay"
    ) as delay:
        RBACWorkspaceMemberAccessSync(enabled=False).sync("workspace-1", "account-1")

    delay.assert_not_called()


def test_rbac_member_access_sync_enqueues_joined_member_sync_when_enabled() -> None:
    with patch(
        "tasks.initialize_created_app_rbac_access_task.sync_joined_workspace_member_rbac_access_task.delay"
    ) as delay:
        RBACWorkspaceMemberAccessSync(enabled=True).sync("workspace-1", "account-1")

    delay.assert_called_once_with("workspace-1", "account-1", operator_account_id=None)


@pytest.mark.parametrize(
    ("reply", "expected"),
    [
        (
            billing.VerifyEducationIdentityReply(token="education-token", status="eligible"),
            AccountEducationEligible(token="education-token"),
        ),
        (billing.VerifyEducationIdentityReply(token="", status="not_eligible"), AccountEducationNotEligible()),
    ],
)
def test_education_gateway_maps_verification_status(
    reply: billing.VerifyEducationIdentityReply, expected: AccountEducationVerification
) -> None:
    gateway = BillingAccountEducationGateway()

    with patch("services.account.adapters.BillingService.EducationIdentity.verify", return_value=reply):
        result = gateway.verify(account_id="account-1")

    assert result == expected


@pytest.mark.parametrize(
    ("read", "body"),
    [
        (lambda gateway: gateway.verify(account_id="account-1"), {"token": ""}),
        (
            lambda gateway: gateway.status("account-1"),
            {
                "result": False,
                "is_student": False,
                "expire_at": "",
                "allow_refresh": False,
                "can_redeem_discount": False,
            },
        ),
    ],
)
def test_education_gateway_rejects_invalid_billing_replies(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    read: Callable[[BillingAccountEducationGateway], object],
    body: dict[str, object],
) -> None:
    config_overrides(BILLING_API_URL="http://billing/v1")
    monkeypatch.setattr(
        transport,
        "_http_client",
        httpx.Client(transport=httpx.MockTransport(lambda _request: httpx.Response(200, json=body))),
    )

    with pytest.raises(BillingUpstreamInvalidResponseError):
        read(BillingAccountEducationGateway())


def test_education_gateway_reads_billing_status_timestamp() -> None:
    gateway = BillingAccountEducationGateway()

    with patch(
        "services.account.adapters.BillingService.EducationIdentity.status",
        return_value=billing.GetEducationIdentityStatusReply(
            result=True,
            is_student=True,
            expire_at="2027-01-01T00:00:00Z",
            allow_refresh=False,
            can_redeem_discount=False,
        ),
    ):
        result = gateway.status("account-1")

    assert result == AccountEducationStatus(
        result=True,
        is_student=True,
        expire_at=datetime(2027, 1, 1, tzinfo=UTC),
        allow_refresh=False,
        can_redeem_discount=False,
    )


def test_education_gateway_activates_with_primitive_account_context() -> None:
    gateway = BillingAccountEducationGateway()

    with patch(
        "services.account.adapters.BillingService.EducationIdentity.activate",
        return_value=billing.CreateEducationIdentityReply(message="success"),
    ) as activate:
        result = gateway.activate(
            account_id="account-1",
            tenant_id="workspace-1",
            token="education-token",
            institution="Dify University",
            role="Student",
        )

    assert result == AccountEducationActivation(message="success")
    activate.assert_called_once_with(
        account_id="account-1",
        tenant_id="workspace-1",
        token="education-token",
        institution="Dify University",
        role="Student",
    )


def test_education_gateway_maps_autocomplete_reply() -> None:
    gateway = BillingAccountEducationGateway()

    with patch(
        "services.account.adapters.BillingService.EducationIdentity.autocomplete",
        return_value=billing.AutocompleteEducationInstitutionReply(
            data=["Example University"], curr_page=0, has_next=True
        ),
    ):
        result = gateway.autocomplete(keywords="Example", page=0, limit=20)

    assert result == AccountEducationAutocomplete(data=("Example University",), curr_page=0, has_next=True)


def test_education_gateway_reads_no_identity_expiry() -> None:
    gateway = BillingAccountEducationGateway()

    with patch(
        "services.account.adapters.BillingService.EducationIdentity.status",
        return_value=billing.GetEducationIdentityStatusReply(
            result=False,
            is_student=False,
            expire_at="1997-01-01T00:00:00Z",
            allow_refresh=False,
            can_redeem_discount=False,
        ),
    ):
        assert gateway.status("account-1").expire_at == datetime(1997, 1, 1, tzinfo=UTC)


def test_billing_email_policy_preserves_suspended_domain_reason() -> None:
    gateway = BillingAccountEmailPolicyGateway(billing_enabled=True)

    with (
        patch("services.account.adapters.BillingService.is_email_in_freeze", return_value=True),
        patch(
            "services.account.adapters.BillingService.get_email_freeze_type",
            return_value="email_domain_suspended",
        ),
    ):
        assert gateway.is_frozen("user@suspended.example") == "email_domain_suspended"


def test_token_gateway_rejects_payload_without_account_binding() -> None:
    gateway = TokenManagerChangeEmailTokenGateway()

    with patch(
        "services.account.adapters.TokenManager.get_token_data",
        return_value={
            "token_type": "change_email",
            "email": "new@example.com",
            "old_email": "old@example.com",
            "code": "123456",
            "email_change_phase": "new_email",
        },
    ):
        assert gateway.get("token") is None


def test_token_gateway_issues_account_bound_state() -> None:
    gateway = TokenManagerChangeEmailTokenGateway()
    token_data = AccountChangeEmailNewEmailToken(
        account_id="account-1",
        email="new@example.com",
        old_email="old@example.com",
        code="123456",
    )

    with patch(
        "services.account.adapters.TokenManager.generate_token",
        return_value="token",
    ) as generate_token:
        assert gateway.issue(token_data) == "token"

    assert generate_token.call_args.kwargs["account_id"] == "account-1"
    assert generate_token.call_args.kwargs["email"] == "new@example.com"
    assert generate_token.call_args.kwargs["additional_data"] == {
        "old_email": "old@example.com",
        "code": "123456",
        "email_change_phase": "new_email",
    }


def test_security_gateway_counts_normal_ip_request(redis_transport: tuple[RedisClientWrapper, MagicMock]) -> None:
    redis, commands = redis_transport
    commands.side_effect = [None, None, True, True]
    gateway = RedisChangeEmailSecurityGateway(
        redis=redis,
        email_send_ip_limit_per_minute=60,
        verification_failure_limit=5,
        verification_lockout_duration=600,
    )

    assert gateway.is_ip_limited("127.0.0.1") is False

    freeze_key = "email_send_ip_limit_freeze:127.0.0.1"
    minute_key = "email_send_ip_limit_minute:127.0.0.1"
    assert commands.call_args_list == [
        call("GET", freeze_key, keys=[freeze_key]),
        call("GET", minute_key, keys=[minute_key]),
        call("SETEX", minute_key, 60, 1),
        call("EXPIRE", minute_key, 60),
    ]


def test_security_gateway_freezes_second_over_limit_ip_strike(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    redis, commands = redis_transport
    commands.side_effect = [None, 2, 1, True]
    gateway = RedisChangeEmailSecurityGateway(
        redis=redis,
        email_send_ip_limit_per_minute=1,
        verification_failure_limit=5,
        verification_lockout_duration=600,
    )

    assert gateway.is_ip_limited("127.0.0.1") is True

    freeze_key = "email_send_ip_limit_freeze:127.0.0.1"
    minute_key = "email_send_ip_limit_minute:127.0.0.1"
    hour_key = "email_send_ip_limit_hour:127.0.0.1"
    assert commands.call_args_list == [
        call("GET", freeze_key, keys=[freeze_key]),
        call("GET", minute_key, keys=[minute_key]),
        call("GET", hour_key, keys=[hour_key]),
        call("SETEX", freeze_key, 3600, 1),
    ]


def test_verification_gateway_binds_token_to_the_target_account() -> None:
    gateway = TokenManagerAccountDeletionVerificationGateway()

    with patch(
        "services.account.adapters.TokenManager.get_token_data",
        return_value={"account_id": "account-1", "code": "123456"},
    ):
        assert gateway.verify(account_id="account-1", token="token", code="123456") is True
        assert gateway.verify(account_id="account-2", token="token", code="123456") is False


def test_verification_gateway_creates_six_digit_account_bound_challenge() -> None:
    gateway = TokenManagerAccountDeletionVerificationGateway()

    with (
        patch("services.account.adapters.secrets.randbelow", side_effect=[1, 2, 3, 4, 5, 6]),
        patch(
            "services.account.adapters.TokenManager.generate_token",
            return_value="token",
        ) as generate_token,
    ):
        challenge = gateway.create(account_id="account-1", email="account@example.com")

    assert challenge.token == "token"
    assert challenge.code == "123456"
    assert generate_token.call_args.kwargs["account_id"] == "account-1"
    assert generate_token.call_args.kwargs["email"] == "account@example.com"
    assert generate_token.call_args.kwargs["additional_data"] == {"code": "123456"}


def test_verification_notifier_preserves_rate_limit_before_enqueuing_email(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    redis, commands = redis_transport
    commands.return_value = 10
    limiter = RateLimiter("deletion", 10, 60, redis_client=redis)
    notifier = CeleryAccountDeletionVerificationNotifier(rate_limiter=limiter)

    with (
        patch("services.account.adapters.send_account_deletion_verification_code") as mail_task,
        pytest.raises(AccountDeletionRateLimitError) as error,
    ):
        notifier.send(email="account@example.com", code="123456")

    assert [call.args[0] for call in commands.call_args_list] == ["ZREMRANGEBYSCORE", "ZCARD"]
    assert error.value.retry_after_minutes == 1
    mail_task.delay.assert_not_called()


@pytest.mark.parametrize("has_normal", [True, False])
def test_identity_resolves_normal_workspace_and_detaches_it(
    account_domain: AccountDomain, sqlite_session_factory: sessionmaker[Session], has_normal: bool
) -> None:
    with sqlite_session_factory.begin() as session:
        account = Account(name="User", email="u@example.com")
        archived = Tenant(name="Archived", status=TenantStatus.ARCHIVE)
        session.add_all(
            [
                account,
                archived,
                TenantAccountJoin(
                    account_id=account.id, tenant_id=archived.id, role=TenantAccountRole.NORMAL, current=True
                ),
            ]
        )
        if has_normal:
            normal = Tenant(name="Normal")
            session.add_all(
                [normal, TenantAccountJoin(account_id=account.id, tenant_id=normal.id, role=TenantAccountRole.EDITOR)]
            )
        account_id = account.id
    loaded = account_domain.repository.load_identity(account_id, now=datetime(2026, 1, 1))
    if has_normal:
        assert loaded is not None
        assert loaded.current_tenant is not None
        assert loaded.current_tenant.name == "Normal"
        assert loaded.role == TenantAccountRole.EDITOR
    else:
        assert loaded is None
    with sqlite_session_factory() as session:
        current = session.scalars(select(TenantAccountJoin).where(TenantAccountJoin.current.is_(True))).all()
        assert len(current) == int(has_normal)


@pytest.mark.parametrize("redis_claim", [True, False, RedisError("offline")])
def test_activity_refresh_is_gated_but_fails_open(
    account_domain: AccountDomain, sqlite_session: Session, redis_claim: bool | RedisError
) -> None:
    now = naive_utc_now()
    account = Account(name="User", email="u@example.com")
    account.last_active_at = now - timedelta(hours=1)
    tenant = Tenant(name="Normal")
    sqlite_session.add_all(
        [
            account,
            tenant,
            TenantAccountJoin(account_id=account.id, tenant_id=tenant.id, role=TenantAccountRole.OWNER, current=True),
        ]
    )
    sqlite_session.commit()
    account_id, old_active = account.id, account.last_active_at
    redis = create_autospec(RedisClientWrapper, instance=True)
    if isinstance(redis_claim, RedisError):
        redis.set.side_effect = redis_claim
    else:
        redis.set.return_value = redis_claim
    gateway = AccountIdentityGateway(accounts=account_domain.repository, redis=redis)
    loaded = gateway.load_user(account_id)
    assert loaded is not None
    sqlite_session.expire_all()
    assert (account.last_active_at > old_active) == (redis_claim is not False)
    assert redis.set.call_args.kwargs == {"ex": 600, "nx": True}


def test_identity_rejects_banned_and_missing_accounts(account_domain: AccountDomain, sqlite_session: Session) -> None:
    account = Account(name="Banned", email="b@example.com", status=AccountStatus.BANNED)
    sqlite_session.add(account)
    sqlite_session.commit()
    gateway = AccountIdentityGateway(
        accounts=account_domain.repository, redis=create_autospec(RedisClientWrapper, instance=True)
    )
    with pytest.raises(Unauthorized, match="banned"):
        gateway.load_user(account.id)
    assert gateway.load_user("missing") is None


@pytest.mark.parametrize(
    ("reason", "expected"),
    [
        ("EDUCATION_VERIFY_FAILED", EducationVerificationFailedError),
        ("EDUCATION_CREATE_FAILED", EducationActivationFailedError),
        ("REQUEST_IN_PROGRESS", EducationRequestInProgressError),
    ],
)
def test_education_gateway_maps_billing_reason(
    reason: billing.BillingEducationErrorReason, expected: type[Exception]
) -> None:
    error = billing.BillingEducationUpstreamInvalidResponseError(status_code=400, reason=reason)

    with (
        patch("services.account.adapters.BillingService.EducationIdentity.verify", side_effect=error),
        pytest.raises(expected) as exc_info,
    ):
        BillingAccountEducationGateway().verify(account_id="account-1")

    assert exc_info.value.__cause__ is error


@pytest.mark.parametrize(
    "error",
    [
        billing.BillingEducationUpstreamInvalidResponseError(status_code=400, reason="EDUCATION_STATUS_FAILED"),
        billing.BillingEducationUpstreamUnavailableError(status_code=500, reason=""),
        billing.BillingEducationUpstreamInvalidResponseError(
            status_code=400, reason=UnknownErrorReason("EDUCATION_SHIPPED_LATER")
        ),
        billing.BillingEducationUpstreamUnavailableError(status_code=502),
        billing.BillingEducationUpstreamUnavailableError(),
    ],
)
def test_education_gateway_leaves_generic_reasons_to_billing_errors(
    error: billing.BillingEducationUpstreamError,
) -> None:
    with (
        patch("services.account.adapters.BillingService.EducationIdentity.status", side_effect=error),
        pytest.raises(BillingUpstreamError) as exc_info,
    ):
        BillingAccountEducationGateway().status("account-1")

    assert exc_info.value is error


def _payload(email: str, role: str = "normal", *, requires_setup: bool = False) -> bytes:
    return (
        f'{{"account_id":"account-1","email":"{email}","workspace_id":"workspace-1",'
        f'"role":"{role}","requires_setup":{str(requires_setup).lower()}}}'
    ).encode()


@pytest.fixture
def redis_commands(redis_transport: tuple[RedisClientWrapper, MagicMock]) -> RedisCommandEmulator:
    commands = RedisCommandEmulator()
    redis_transport[1].side_effect = commands
    return commands


def test_pending_invitations_show_latest_live_unconsumed_link(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    redis_commands: RedisCommandEmulator,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("services.account.adapters.time", lambda: 100.0)
    key = "member_invite:pending:workspace-1"
    redis_commands.sorted_sets[key] = {
        "expired": 90.0,
        "old": 110.0,
        "latest": 120.0,
        "redeemed": 130.0,
        "revoked": 140.0,
    }
    redis_commands.values.update(
        {
            "member_invite:token:expired": _payload("expired@example.com"),
            "member_invite:token:old": _payload("invitee@example.com", "admin"),
            "member_invite:token:latest": _payload("Invitee@example.com", "editor"),
            "member_invite:token:redeemed": _payload("accepted@example.com"),
            "member_invite:token:redeemed:membership_used": b"1",
        }
    )

    (invitation,) = RedisInvitationTokenStore(redis=redis_transport[0]).list_pending("workspace-1")

    assert invitation.email == "Invitee@example.com"
    assert invitation.role == TenantAccountRole.EDITOR
    assert invitation.expires_at == datetime.fromtimestamp(120, UTC)


@pytest.mark.usefixtures("redis_commands")
def test_pending_invitations_include_new_email_invitations(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    store = RedisInvitationTokenStore(redis=redis_transport[0])
    store.create(InvitationToken("account-1", "new@example.com", "workspace-1", "normal", True))

    (invitation,) = store.list_pending("workspace-1")

    assert invitation.email == "new@example.com"
    assert invitation.role == TenantAccountRole.NORMAL


def test_issuing_a_link_fails_and_leaves_nothing_live_when_it_cannot_be_indexed(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    redis_commands: RedisCommandEmulator,
) -> None:
    redis_commands.failing.add("ZADD")
    store = RedisInvitationTokenStore(redis=redis_transport[0])

    with pytest.raises(RedisError):
        store.create(InvitationToken("account-1", "new@example.com", "workspace-1", "normal", True))

    assert redis_commands.values == {}


def test_revoking_pending_invitations_invalidates_every_link_for_the_email(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    redis_commands: RedisCommandEmulator,
) -> None:
    store = RedisInvitationTokenStore(redis=redis_transport[0])
    first = store.create(InvitationToken("account-1", "Invitee@example.com", "workspace-1", "normal", True))
    second = store.create(InvitationToken("account-1", "invitee@example.com", "workspace-1", "editor", True))
    other = store.create(InvitationToken("account-2", "other@example.com", "workspace-1", "normal", True))
    redis_commands.values["member_invite:token:legacy"] = _payload("invitee@example.com", requires_setup=True)

    store.revoke_pending("workspace-1", "INVITEE@example.com", account_id="account-1", keep_token=None)

    def live(token: str) -> bool:
        return store.find(InvitationLookup(workspace_id=None, email=None, token=token)) is not None

    assert not live(first)
    assert not live(second)
    assert not live("legacy")
    assert live(other)
    assert [invitation.email for invitation in store.list_pending("workspace-1")] == ["other@example.com"]

    reissued = store.create(InvitationToken("account-1", "invitee@example.com", "workspace-1", "normal", True))
    assert live(reissued)


def test_workspace_scoped_legacy_links_stop_working_after_revoke_or_resend(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    redis_commands: RedisCommandEmulator,
) -> None:
    store = RedisInvitationTokenStore(redis=redis_transport[0])
    lookup = InvitationLookup(workspace_id="workspace-1", email="invitee@example.com", token="legacy")
    email_hash = sha256(b"invitee@example.com").hexdigest()
    redis_commands.values[f"member_invite_token:workspace-1, {email_hash}:legacy"] = b"account-1"
    assert store.find(lookup) is not None

    store.revoke_pending("workspace-1", "invitee@example.com", account_id="account-1", keep_token=None)

    assert store.find(lookup) is None
    reissued = store.create(InvitationToken("account-1", "invitee@example.com", "workspace-1", "normal", True))
    assert store.find(InvitationLookup(workspace_id=None, email=None, token=reissued)) is not None


@pytest.mark.usefixtures("redis_commands")
def test_reissuing_keeps_the_new_link_and_retires_the_rest(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    store = RedisInvitationTokenStore(redis=redis_transport[0])
    old = store.create(InvitationToken("account-1", "invitee@example.com", "workspace-1", "normal", True))
    new = store.create(InvitationToken("account-1", "invitee@example.com", "workspace-1", "editor", True))

    store.revoke_pending("workspace-1", "invitee@example.com", account_id="account-1", keep_token=new)

    assert store.find(InvitationLookup(workspace_id=None, email=None, token=old)) is None
    assert store.find(InvitationLookup(workspace_id=None, email=None, token=new)) is not None
    assert [invitation.role for invitation in store.list_pending("workspace-1")] == [TenantAccountRole.EDITOR]


def test_discarding_a_link_removes_it_from_the_index(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    redis_commands: RedisCommandEmulator,
) -> None:
    store = RedisInvitationTokenStore(redis=redis_transport[0])
    token = store.create(InvitationToken("account-1", "invitee@example.com", "workspace-1", "normal", True))

    store.discard("workspace-1", token)

    assert store.find(InvitationLookup(workspace_id=None, email=None, token=token)) is None
    assert redis_commands.sorted_sets["member_invite:pending:workspace-1"] == {}
