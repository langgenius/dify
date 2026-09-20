"""Infrastructure gateways for Console account OAuth sign-in."""

import logging
from collections.abc import Generator
from contextlib import AbstractContextManager, contextmanager
from hashlib import sha256
from threading import Event, Thread
from typing import Protocol, override

import httpx
from redis import RedisError
from redis.exceptions import LockError

from extensions.ext_redis import RedisClientWrapper
from libs.oauth import OAuth
from services.account.oauth_service import (
    OAuthAccountClaimLease,
    OAuthAccountClaimLock,
    OAuthAccountRegistrationGateway,
    OAuthInvitationGateway,
    OAuthProviderGateway,
    OAuthRegistrationPolicyGateway,
    OAuthSessionGateway,
    OAuthWorkspaceGateway,
    OAuthWorkspacePolicyGateway,
)
from services.account.service import AccountService
from services.account_activation_service import AccountActivationRepository, InvitationTokenStore
from services.account_errors import (
    AccountEmailDomainSuspendedError,
    AccountNotFoundError,
    AccountRegisterError,
    OAuthAccountNotFoundError,
    OAuthIdentityLockUnavailableError,
    OAuthProviderAuthorizationError,
    OAuthProviderRequestError,
    OAuthRegistrationError,
    OAuthSeatsLimitExceededError,
    OAuthWorkspaceCreationNotAllowedError,
    SeatsLimitExceededError,
)
from services.billing_service import BillingService
from services.enterprise.enterprise_service import try_join_default_workspace
from services.entities.account_activation_entities import InvitationLookup
from services.entities.account_entities import AccountSessionTokens
from services.entities.account_oauth_entities import (
    OAuthAccountRegistration,
    OAuthAuthorizationRequest,
    OAuthIdentity,
    OAuthInvitation,
)
from services.errors.workspace import WorkSpaceNotAllowedCreateError, WorkspacesLimitExceededError
from services.system_feature_service import SystemFeatureService
from services.workspace.provisioning_service import WorkspaceProvisioningService

logger = logging.getLogger(__name__)

_OAUTH_ACCOUNT_CLAIM_LOCK_PREFIX = "oauth:account-claim:"
_OAUTH_ACCOUNT_CLAIM_LOCK_TIMEOUT_SECONDS = 60
_OAUTH_ACCOUNT_CLAIM_LOCK_BLOCKING_TIMEOUT_SECONDS = 10
_OAUTH_ACCOUNT_CLAIM_LOCK_RENEW_INTERVAL_SECONDS = 20
_OAUTH_ACCOUNT_CLAIM_LOCK_HEARTBEAT_JOIN_TIMEOUT_SECONDS = 2


class _RedisLock(Protocol):
    def acquire(self) -> bool: ...

    def reacquire(self) -> bool: ...

    def release(self) -> None: ...


class _RedisOAuthAccountClaimLease(OAuthAccountClaimLease):
    def __init__(self, *, locks: tuple[_RedisLock, ...], lost: Event) -> None:
        self._locks = locks
        self._lost = lost

    @override
    def ensure_owned(self) -> None:
        if self._lost.is_set():
            raise OAuthIdentityLockUnavailableError
        try:
            for lock in self._locks:
                lock.reacquire()
        except (LockError, RedisError) as exc:
            self._lost.set()
            raise OAuthIdentityLockUnavailableError from exc
        except Exception as exc:
            self._lost.set()
            raise OAuthIdentityLockUnavailableError from exc

    def mark_lost(self) -> None:
        self._lost.set()


class DifyOAuthProviderGateway(OAuthProviderGateway):
    def __init__(self, *, provider_name: str, client: OAuth) -> None:
        self._provider_name = provider_name
        self._client = client

    @override
    def get_authorization_url(self, request: OAuthAuthorizationRequest) -> str:
        return self._client.get_authorization_url(
            invite_token=request.invite_token,
            timezone=request.timezone,
            language=request.language,
            redirect_url=request.redirect_url,
        )

    @override
    def get_identity(self, code: str) -> OAuthIdentity:
        try:
            token = self._client.get_access_token(code)
            user_info = self._client.get_user_info(token)
        except httpx.HTTPError as exc:
            error_text = exc.response.text if isinstance(exc, httpx.HTTPStatusError) else str(exc)
            logger.exception(
                "An error occurred during the OAuth process with %s: %s",
                self._provider_name,
                error_text,
            )
            raise OAuthProviderRequestError from exc
        except ValueError as exc:
            logger.warning("OAuth error with %s", self._provider_name, exc_info=True)
            raise OAuthProviderAuthorizationError(str(exc)) from exc
        return OAuthIdentity(id=user_info.id, name=user_info.name, email=user_info.email)


class RedisOAuthAccountClaimLock(OAuthAccountClaimLock):
    def __init__(self, *, client: RedisClientWrapper) -> None:
        self._client = client

    @override
    def acquire(self, *, provider: str, open_id: str, email: str) -> AbstractContextManager[OAuthAccountClaimLease]:
        return self._acquire(
            lock_names=(
                self._lock_name("identity", provider, open_id),
                self._lock_name("email", email),
            )
        )

    @override
    def acquire_account(self, account_id: str) -> AbstractContextManager[OAuthAccountClaimLease]:
        return self._acquire(lock_names=(self._lock_name("account", account_id),))

    @contextmanager
    def _acquire(self, *, lock_names: tuple[str, ...]) -> Generator[OAuthAccountClaimLease, None, None]:
        sorted_lock_names = sorted(set(lock_names))
        locks: list[_RedisLock] = []
        try:
            for lock_name in sorted_lock_names:
                lock = self._client.lock(
                    lock_name,
                    timeout=_OAUTH_ACCOUNT_CLAIM_LOCK_TIMEOUT_SECONDS,
                    blocking_timeout=_OAUTH_ACCOUNT_CLAIM_LOCK_BLOCKING_TIMEOUT_SECONDS,
                    thread_local=False,
                )
                if not lock.acquire():
                    raise OAuthIdentityLockUnavailableError
                locks.append(lock)
        except (LockError, RedisError) as exc:
            self._release(locks)
            raise OAuthIdentityLockUnavailableError from exc
        except OAuthIdentityLockUnavailableError:
            self._release(locks)
            raise

        stop_heartbeat = Event()
        lease = _RedisOAuthAccountClaimLease(locks=tuple(locks), lost=Event())
        heartbeat = Thread(
            target=self._renew_while_held,
            args=(lease, stop_heartbeat),
            daemon=True,
            name=f"OAuthAccountClaimLock({sha256(''.join(sorted_lock_names).encode()).hexdigest()[:12]})",
        )
        heartbeat.start()
        try:
            yield lease
            lease.ensure_owned()
        finally:
            stop_heartbeat.set()
            heartbeat.join(timeout=_OAUTH_ACCOUNT_CLAIM_LOCK_HEARTBEAT_JOIN_TIMEOUT_SECONDS)
            if heartbeat.is_alive():
                logger.warning("OAuth account claim lock heartbeat did not stop before release")
            self._release(locks)

    @staticmethod
    def _lock_name(kind: str, *parts: str) -> str:
        digest = sha256("\0".join((kind, *parts)).encode()).hexdigest()
        return f"{_OAUTH_ACCOUNT_CLAIM_LOCK_PREFIX}{digest}"

    @staticmethod
    def _release(locks: list[_RedisLock]) -> None:
        for lock in reversed(locks):
            try:
                lock.release()
            except (LockError, RedisError):
                logger.warning("Failed to release OAuth account claim lock", exc_info=True)

    @staticmethod
    def _renew_while_held(lease: _RedisOAuthAccountClaimLease, stop_heartbeat: Event) -> None:
        while not stop_heartbeat.wait(_OAUTH_ACCOUNT_CLAIM_LOCK_RENEW_INTERVAL_SECONDS):
            try:
                lease.ensure_owned()
            except OAuthIdentityLockUnavailableError:
                lease.mark_lost()
                logger.error("OAuth account claim lock ownership was lost; stop renewing", exc_info=True)
                return


class DeploymentOAuthPolicyGateway(OAuthRegistrationPolicyGateway, OAuthWorkspacePolicyGateway):
    def __init__(self, *, billing_enabled: bool) -> None:
        self._billing_enabled = billing_enabled

    @override
    def is_registration_allowed(self) -> bool:
        return SystemFeatureService.is_registration_allowed()

    @override
    def get_freeze_type(self, email: str) -> str | None:
        if not self._billing_enabled:
            return None
        return BillingService.get_email_freeze_type(email)

    @override
    def is_creation_allowed(self) -> bool:
        return SystemFeatureService.is_workspace_creation_allowed()


class AccountActivationOAuthInvitationGateway(OAuthInvitationGateway):
    def __init__(self, *, tokens: InvitationTokenStore, accounts: AccountActivationRepository) -> None:
        self._tokens = tokens
        self._accounts = accounts

    def resolve(self, invite_token: str) -> OAuthInvitation | None:
        token = self._tokens.find(InvitationLookup(workspace_id=None, email=None, token=invite_token))
        if token is None:
            return None
        invitation = self._accounts.resolve(token)
        if invitation is None:
            return None
        return OAuthInvitation(invitation.account_id, invitation.account_email, invitation.account_status)


class AccountLifecycleOAuthRegistrationGateway(OAuthAccountRegistrationGateway):
    def __init__(self, *, accounts: AccountService) -> None:
        self._accounts = accounts

    def register(self, registration: OAuthAccountRegistration) -> str:
        try:
            account = self._accounts.create_account(
                email=registration.email,
                name=registration.name,
                interface_language=registration.language,
                password=None,
                timezone=registration.timezone,
                ip_address=registration.ip_address,
                check_normalized_email=True,
                status="active",
                initialized=True,
            )
        except AccountEmailDomainSuspendedError:
            raise
        except SeatsLimitExceededError as exc:
            raise OAuthSeatsLimitExceededError from exc
        except AccountRegisterError as exc:
            raise OAuthRegistrationError(exc.description) from exc
        except Exception as exc:
            raise OAuthRegistrationError(f"Registration failed: {exc}") from exc
        return account.id


class WorkspaceProvisioningOAuthGateway(OAuthWorkspaceGateway):
    def __init__(self, *, workspaces: WorkspaceProvisioningService) -> None:
        self._workspaces = workspaces

    def create_owner_workspace(self, account_id: str) -> None:
        try:
            self._workspaces.create_owner_workspace(account_id)
        except AccountNotFoundError as exc:
            raise OAuthAccountNotFoundError from exc
        except (WorkSpaceNotAllowedCreateError, WorkspacesLimitExceededError) as exc:
            raise OAuthWorkspaceCreationNotAllowedError from exc

    def try_join_default_workspace(self, account_id: str) -> None:
        try_join_default_workspace(account_id)


class AccountLifecycleOAuthSessionGateway(OAuthSessionGateway):
    def __init__(self, *, accounts: AccountService) -> None:
        self._accounts = accounts

    def login(self, account_id: str, *, ip_address: str) -> AccountSessionTokens:
        try:
            return self._accounts.login(account_id, ip_address=ip_address)
        except AccountNotFoundError as exc:
            raise OAuthAccountNotFoundError from exc
