"""Application service for OAuth device-flow use cases."""

from __future__ import annotations

import logging
import secrets
from collections.abc import Callable, Mapping, Sequence
from hashlib import sha256
from typing import Protocol

from constants.oauth_bearer import SubjectType
from machinery.context import RequestContext
from services.entities.account_entities import AccountSnapshot
from services.oauth_device_contracts import (
    ACCOUNT_ISSUER_SENTINEL,
    DEFAULT_POLL_INTERVAL_SECONDS,
    DEVICE_FLOW_TTL_SECONDS,
    AccessDeniedError,
    AlreadyResolvedError,
    ApprovalOutcomeUnknownError,
    ApprovalSessionConsumedError,
    ApprovalTransitionConfirmation,
    AuthorizationPendingError,
    DeviceApprovalContext,
    DeviceApprovalRecord,
    DeviceAuthorization,
    DeviceFlowStateView,
    DeviceFlowStatus,
    DeviceLookup,
    DeviceMutation,
    DeviceRequestContext,
    DeviceSSOCompletion,
    DeviceSSOInitiation,
    DeviceStateLostError,
    DeviceWorkspace,
    ExpiredOrUnknownError,
    ExpiredTokenError,
    ExternalApprovalCSRFError,
    ExternalApprovalGrant,
    ExternalApprovalRateLimitError,
    ExternalIdentityConflictError,
    ExternalSubjectAssertion,
    ExternalUserCodeMismatchError,
    ExternalUserCodeNotFoundError,
    InvalidApprovalSessionError,
    InvalidSSOAssertionError,
    InvalidTransitionError,
    InvalidUserCodeError,
    IssuedOAuthToken,
    OAuthDeviceError,
    OAuthDeviceSessionNotFoundError,
    OAuthDeviceSessionPage,
    OAuthDeviceSSOConfigurationError,
    OAuthDeviceSSOInitiationError,
    OAuthDeviceTokenRotation,
    OAuthDeviceTokenWrite,
    PollPayload,
    PollTooFastError,
    SlowDownDecision,
    StateNotFoundError,
    UnsupportedClientError,
    device_key_for,
)

logger = logging.getLogger(__name__)

_APPROVE_GUARD_TTL_SECONDS = 60
_SSO_COMPLETE_PATH = "/openapi/v1/oauth/device/sso-complete"


class DeviceFlowStore(Protocol):
    def start(
        self,
        client_id: str,
        device_label: str,
        installation_id: str,
        created_ip: str,
    ) -> tuple[str, str, int]: ...

    def load_by_user_code(self, user_code: str) -> tuple[str, DeviceFlowStateView] | None: ...

    def load_by_device_code(self, device_code: str) -> DeviceFlowStateView | None: ...

    def approve(self, device_code: str, transition_id: str, approval: DeviceApprovalRecord) -> None: ...

    def deny(self, device_code: str, transition_id: str) -> None: ...

    def confirm_approval(self, device_code: str, transition_id: str) -> ApprovalTransitionConfirmation: ...

    def consume_on_poll(self, device_code: str) -> tuple[DeviceFlowStateView, int] | None: ...

    def restore(self, device_code: str, state: DeviceFlowStateView, ttl_seconds: int) -> bool: ...

    def remaining_seconds(self, device_code: str) -> int: ...

    def record_poll(self, device_code: str, interval_seconds: int) -> SlowDownDecision: ...

    def try_acquire_approval(self, guard_id: str, owner_id: str, ttl_seconds: int) -> bool: ...

    def release_approval(self, guard_id: str, owner_id: str) -> None: ...


class DeviceWorkspaceQuery(Protocol):
    def list_for_device_flow(self, account_id: str) -> Sequence[DeviceWorkspace]: ...


class OAuthDeviceAccountQuery(Protocol):
    def get(self, account_id: str) -> AccountSnapshot | None: ...

    def has_active_email(self, email: str) -> bool: ...


class OAuthDeviceTokenIssuer(Protocol):
    def issue_account_token(
        self,
        *,
        account: AccountSnapshot,
        workspace_id: str,
        client_id: str,
        device_label: str,
        device_key: str,
    ) -> IssuedOAuthToken: ...

    def issue_external_token(
        self,
        *,
        subject_email: str,
        subject_issuer: str,
        client_id: str,
        device_label: str,
        device_key: str,
    ) -> IssuedOAuthToken: ...


class OAuthDeviceSessionRepository(Protocol):
    def list_account_sessions(
        self,
        *,
        account_id: str,
        page: int,
        limit: int,
    ) -> OAuthDeviceSessionPage: ...

    def revoke_account_session(self, *, account_id: str, token_id: str) -> bool: ...


class OAuthDeviceTokenPersistence(Protocol):
    def rotate_token(self, token: OAuthDeviceTokenWrite) -> OAuthDeviceTokenRotation: ...


class OAuthDeviceTokenTTLPolicy(Protocol):
    def ttl_days(self, workspace_id: str | None) -> int: ...


class OAuthDeviceSSOGateway(Protocol):
    def initiate(self, *, user_code: str, callback_url: str, ttl_seconds: int) -> str: ...

    def verify_assertion(self, assertion: str) -> ExternalSubjectAssertion: ...

    def mint_approval_grant(
        self,
        *,
        issuer: str,
        subject_email: str,
        subject_issuer: str,
        user_code: str,
    ) -> str: ...

    def verify_approval_grant(self, token: str) -> ExternalApprovalGrant: ...

    def consume_assertion_nonce(self, nonce: str) -> bool: ...

    def reserve_approval_nonce(self, nonce: str, reservation_id: str) -> bool: ...

    def release_approval_nonce(self, nonce: str, reservation_id: str) -> None: ...


class ExternalApprovalLimiter(Protocol):
    def is_rate_limited(self, subject_email: str) -> bool: ...

    def record(self, subject_email: str) -> None: ...


class OAuthDeviceSettings(Protocol):
    @property
    def known_client_ids(self) -> frozenset[str]: ...

    @property
    def verification_base_url(self) -> str | None: ...

    @property
    def sso_base_url(self) -> str | None: ...


_TokenMinter = Callable[[DeviceFlowStateView, DeviceApprovalRecord, str], PollPayload]


class OAuthDeviceApplicationService:
    def __init__(
        self,
        *,
        store: DeviceFlowStore,
        accounts: OAuthDeviceAccountQuery,
        workspaces: DeviceWorkspaceQuery,
        tokens: OAuthDeviceTokenIssuer,
        sessions: OAuthDeviceSessionRepository,
        sso: OAuthDeviceSSOGateway,
        external_approval_limiter: ExternalApprovalLimiter,
        settings: OAuthDeviceSettings,
    ) -> None:
        self._store = store
        self._accounts = accounts
        self._workspaces = workspaces
        self._tokens = tokens
        self._sessions = sessions
        self._sso = sso
        self._external_approval_limiter = external_approval_limiter
        self._settings = settings
        self._minters: Mapping[SubjectType, _TokenMinter] = {
            SubjectType.ACCOUNT: self._mint_account_token,
            SubjectType.EXTERNAL_SSO: self._mint_external_token,
        }

    def list_account_sessions(self, *, account_id: str, page: int, limit: int) -> OAuthDeviceSessionPage:
        return self._sessions.list_account_sessions(account_id=account_id, page=page, limit=limit)

    def revoke_account_session(self, *, account_id: str, token_id: str) -> DeviceMutation:
        if not self._sessions.revoke_account_session(account_id=account_id, token_id=token_id):
            raise OAuthDeviceSessionNotFoundError(token_id)
        return DeviceMutation(status="revoked")

    def start(
        self,
        *,
        client_id: str,
        device_label: str,
        installation_id: str,
        created_ip: str,
        request_origin: str,
    ) -> DeviceAuthorization:
        if client_id not in self._settings.known_client_ids:
            raise UnsupportedClientError

        device_code, user_code, expires_in = self._store.start(
            client_id=client_id,
            device_label=device_label,
            installation_id=installation_id,
            created_ip=created_ip,
        )
        base_url = self._settings.verification_base_url or request_origin
        return DeviceAuthorization(
            device_code=device_code,
            user_code=user_code,
            verification_uri=f"{base_url.rstrip('/')}/device",
            expires_in=expires_in,
            interval=DEFAULT_POLL_INTERVAL_SECONDS,
        )

    def poll(self, *, device_code: str, poll_ip: str) -> PollPayload:
        if self._store.record_poll(device_code, DEFAULT_POLL_INTERVAL_SECONDS) is SlowDownDecision.SLOW_DOWN:
            raise PollTooFastError

        state = self._store.load_by_device_code(device_code)
        if state is None:
            raise ExpiredTokenError
        if state.status is DeviceFlowStatus.PENDING:
            raise AuthorizationPendingError
        if state.status is DeviceFlowStatus.DENIED:
            if self._store.consume_on_poll(device_code) is None:
                raise ExpiredTokenError
            raise AccessDeniedError
        if state.approval is None:
            return self._collect_legacy_payload(device_code, poll_ip)
        return self._mint_on_poll(device_code, state, state.approval, poll_ip)

    def _mint_on_poll(
        self,
        device_code: str,
        state: DeviceFlowStateView,
        approval: DeviceApprovalRecord,
        poll_ip: str,
    ) -> PollPayload:
        minter = self._minters.get(approval["subject_type"])
        if minter is None:
            logger.error(
                "device_flow: no token minter for subject type %s on %s", approval["subject_type"], device_code
            )
            raise ExpiredTokenError

        device_key = device_key_for(installation_id=state.installation_id, device_label=state.device_label)
        guard_id = self._rotation_guard_id(
            subject_email=approval["subject_email"],
            subject_issuer=approval["subject_issuer"],
            client_id=state.client_id,
            device_key=device_key,
        )
        owner_id = secrets.token_urlsafe(16)
        if not self._store.try_acquire_approval(guard_id, owner_id, _APPROVE_GUARD_TTL_SECONDS):
            raise AuthorizationPendingError

        try:
            consumed = self._store.consume_on_poll(device_code)
            if consumed is None:
                raise ExpiredTokenError
            claimed, ttl_seconds = consumed
            try:
                poll_payload = minter(claimed, approval, device_key)
            except OAuthDeviceError:
                raise
            except Exception:
                # Until the restore lands, a concurrent poll finds no state and gets expired_token.
                self._restore_approval(device_code, claimed, ttl_seconds)
                raise
        finally:
            self._store.release_approval(guard_id, owner_id)

        self._audit_cross_ip_if_needed(state, poll_ip, poll_payload["token_id"])
        self._emit_token_issued_audit(state, approval, poll_payload)
        return poll_payload

    # TODO(ENG-1302): remove one release after this ships. Older workers minted at approve.
    def _collect_legacy_payload(self, device_code: str, poll_ip: str) -> PollPayload:
        consumed = self._store.consume_on_poll(device_code)
        if consumed is None:
            raise ExpiredTokenError
        state, _ttl_seconds = consumed
        poll_payload = state.poll_payload
        if poll_payload is None or "token" not in poll_payload:
            logger.error("device_flow: approved state missing poll_payload for %s", device_code)
            raise ExpiredTokenError

        self._audit_cross_ip_if_needed(state, poll_ip, poll_payload["token_id"])
        return poll_payload

    def _mint_account_token(
        self,
        state: DeviceFlowStateView,
        approval: DeviceApprovalRecord,
        device_key: str,
    ) -> PollPayload:
        account_id = approval["account_id"]
        if account_id is None:
            raise AccessDeniedError
        workspace_id = approval["workspace_id"]
        if workspace_id is None:
            raise AccessDeniedError
        account = self._accounts.get(account_id)
        if account is None:
            raise AccessDeniedError

        # Query before minting: a failure after the mint would restore the approval and a retry would mint again.
        workspaces = tuple(self._workspaces.list_for_device_flow(account.id))
        mint = self._tokens.issue_account_token(
            account=account,
            workspace_id=workspace_id,
            client_id=state.client_id,
            device_label=state.device_label,
            device_key=device_key,
        )
        return self._build_account_poll_payload(account, workspace_id, workspaces, mint)

    def _mint_external_token(
        self,
        state: DeviceFlowStateView,
        approval: DeviceApprovalRecord,
        device_key: str,
    ) -> PollPayload:
        if self._accounts.has_active_email(approval["subject_email"]):
            raise AccessDeniedError

        mint = self._tokens.issue_external_token(
            subject_email=approval["subject_email"],
            subject_issuer=approval["subject_issuer"],
            client_id=state.client_id,
            device_label=state.device_label,
            device_key=device_key,
        )
        return {
            "token": mint.token,
            "expires_at": mint.expires_at,
            "subject_type": SubjectType.EXTERNAL_SSO,
            "subject_email": approval["subject_email"],
            "subject_issuer": approval["subject_issuer"],
            "account": None,
            "workspaces": [],
            "default_workspace_id": None,
            "token_id": mint.token_id,
        }

    def lookup(self, *, user_code: str) -> DeviceLookup:
        found = self._store.load_by_user_code(user_code.strip().upper())
        if found is None:
            return DeviceLookup(valid=False, expires_in_remaining=0, client_id=None)

        _device_code, state = found
        if state.status is not DeviceFlowStatus.PENDING:
            return DeviceLookup(valid=False, expires_in_remaining=0, client_id=state.client_id)
        return DeviceLookup(valid=True, expires_in_remaining=DEVICE_FLOW_TTL_SECONDS, client_id=state.client_id)

    def approve(self, context: RequestContext, *, user_code: str) -> DeviceMutation:
        device_code, state = self._pending_state(user_code)
        account = self._accounts.get(context.account_id)
        if account is None or context.active_workspace_id is None:
            raise DeviceStateLostError
        approval: DeviceApprovalRecord = {
            "subject_type": SubjectType.ACCOUNT,
            "account_id": account.id,
            "workspace_id": context.active_workspace_id,
            "subject_email": account.email,
            "subject_issuer": ACCOUNT_ISSUER_SENTINEL,
        }
        self._publish_approval(device_code, approval)

        self._emit_approve_audit(context.request_id, state, approval)
        return DeviceMutation(status="approved")

    def deny(self, *, user_code: str) -> DeviceMutation:
        device_code, state = self._pending_state(user_code)
        try:
            self._store.deny(device_code, secrets.token_urlsafe(16))
        except (StateNotFoundError, InvalidTransitionError) as error:
            logger.exception("device_flow: deny raced on %s", device_code)
            raise DeviceStateLostError from error

        self._emit_deny_audit(state)
        return DeviceMutation(status="denied")

    def initiate_sso(self, context: DeviceRequestContext, *, user_code: str) -> DeviceSSOInitiation:
        normalized_user_code = user_code.strip().upper()
        self._pending_external_state(normalized_user_code)
        base_url = self._sso_origin()
        redirect_url = self._sso.initiate(
            user_code=normalized_user_code,
            callback_url=f"{base_url}{_SSO_COMPLETE_PATH}",
            ttl_seconds=DEVICE_FLOW_TTL_SECONDS,
        )
        if not redirect_url:
            raise OAuthDeviceSSOInitiationError
        logger.info(
            "oauth device SSO initiated",
            extra={"request_id": context.request_id},
        )
        return DeviceSSOInitiation(redirect_url=redirect_url)

    def complete_sso(
        self,
        context: DeviceRequestContext,
        *,
        inbound_error: str | None,
        inbound_user_code: str | None,
        assertion: str | None,
    ) -> DeviceSSOCompletion:
        if inbound_error:
            return DeviceSSOCompletion(error_code=inbound_error, user_code=inbound_user_code)
        if not assertion:
            return DeviceSSOCompletion(error_code="sso_failed")

        try:
            claims = self._sso.verify_assertion(assertion)
        except InvalidSSOAssertionError as error:
            logger.warning(
                "oauth device SSO assertion rejected: %s",
                error,
                extra={"request_id": context.request_id},
            )
            return DeviceSSOCompletion(error_code="sso_failed")

        user_code = claims.user_code.strip().upper()
        if not self._sso.consume_assertion_nonce(claims.nonce):
            return DeviceSSOCompletion(error_code="sso_failed", user_code=user_code)

        try:
            _device_code, state = self._pending_external_state(user_code)
        except InvalidUserCodeError:
            return DeviceSSOCompletion(error_code="sso_failed", user_code=user_code)

        if self._accounts.has_active_email(claims.subject_email):
            self._emit_external_rejection_audit(
                context,
                state,
                claims.subject_email,
                claims.subject_issuer,
                reason="email_belongs_to_dify_account",
            )
            return DeviceSSOCompletion(
                error_code="email_belongs_to_dify_account",
                user_code=user_code,
            )

        try:
            approval_grant = self._sso.mint_approval_grant(
                issuer=self._sso_origin(),
                subject_email=claims.subject_email,
                subject_issuer=claims.subject_issuer,
                user_code=user_code,
            )
        except OAuthDeviceSSOConfigurationError:
            return DeviceSSOCompletion(error_code="sso_failed", user_code=user_code)
        return DeviceSSOCompletion(user_code=user_code, approval_grant=approval_grant)

    def get_approval_context(
        self,
        _context: DeviceRequestContext,
        *,
        approval_grant: str,
    ) -> DeviceApprovalContext:
        if not approval_grant:
            raise InvalidApprovalSessionError
        claims = self._sso.verify_approval_grant(approval_grant)
        return DeviceApprovalContext(
            subject_email=claims.subject_email,
            subject_issuer=claims.subject_issuer,
            user_code=claims.user_code,
            csrf_token=claims.csrf_token,
            expires_at=claims.expires_at,
        )

    def approve_external(
        self,
        context: DeviceRequestContext,
        *,
        approval_grant: str,
        csrf_token: str,
        user_code: str,
    ) -> DeviceMutation:
        if not approval_grant:
            raise InvalidApprovalSessionError
        claims = self._sso.verify_approval_grant(approval_grant)

        if self._external_approval_limiter.is_rate_limited(claims.subject_email):
            raise ExternalApprovalRateLimitError
        self._external_approval_limiter.record(claims.subject_email)

        if not csrf_token or not secrets.compare_digest(csrf_token, claims.csrf_token):
            raise ExternalApprovalCSRFError
        if user_code.strip().upper() != claims.user_code:
            raise ExternalUserCodeMismatchError

        found = self._store.load_by_user_code(claims.user_code)
        if found is None:
            raise ExternalUserCodeNotFoundError
        device_code, state = found
        if state.status is not DeviceFlowStatus.PENDING:
            raise AlreadyResolvedError
        if self._accounts.has_active_email(claims.subject_email):
            self._emit_external_rejection_audit(
                context,
                state,
                claims.subject_email,
                claims.subject_issuer,
                reason="email_belongs_to_dify_account",
            )
            raise ExternalIdentityConflictError

        reservation_id = sha256(f"oauth-device-approval\0{claims.nonce}".encode()).hexdigest()
        if not self._sso.reserve_approval_nonce(claims.nonce, reservation_id):
            raise ApprovalSessionConsumedError
        approval: DeviceApprovalRecord = {
            "subject_type": SubjectType.EXTERNAL_SSO,
            "account_id": None,
            "workspace_id": None,
            "subject_email": claims.subject_email,
            "subject_issuer": claims.subject_issuer,
        }
        try:
            self._publish_approval(device_code, approval)
        except ApprovalOutcomeUnknownError:
            raise
        except Exception:
            self._release_approval_nonce(claims.nonce, reservation_id)
            raise

        self._emit_approve_audit(context.request_id, state, approval)
        return DeviceMutation(status="approved")

    def _sso_origin(self) -> str:
        base_url = (self._settings.sso_base_url or "").rstrip("/")
        if not base_url:
            raise OAuthDeviceSSOConfigurationError
        return base_url

    def _pending_external_state(self, user_code: str) -> tuple[str, DeviceFlowStateView]:
        found = self._store.load_by_user_code(user_code.strip().upper())
        if found is None or found[1].status is not DeviceFlowStatus.PENDING:
            raise InvalidUserCodeError
        return found

    def _pending_state(self, user_code: str) -> tuple[str, DeviceFlowStateView]:
        found = self._store.load_by_user_code(user_code.strip().upper())
        if found is None:
            raise ExpiredOrUnknownError
        device_code, state = found
        if state.status is not DeviceFlowStatus.PENDING:
            raise AlreadyResolvedError
        return device_code, state

    def _build_account_poll_payload(
        self,
        account: AccountSnapshot,
        active_workspace_id: str,
        workspaces: Sequence[DeviceWorkspace],
        mint: IssuedOAuthToken,
    ) -> PollPayload:
        default_workspace_id = next(
            (workspace.id for workspace in workspaces if workspace.id == active_workspace_id),
            None,
        )
        if default_workspace_id is None:
            default_workspace_id = next((workspace.id for workspace in workspaces if workspace.current), None)
        if default_workspace_id is None and workspaces:
            default_workspace_id = workspaces[0].id

        return {
            "token": mint.token,
            "expires_at": mint.expires_at,
            "subject_type": SubjectType.ACCOUNT,
            "account": {"id": account.id, "email": account.email, "name": account.name},
            "workspaces": [
                {"id": workspace.id, "name": workspace.name, "role": workspace.role} for workspace in workspaces
            ],
            "default_workspace_id": default_workspace_id,
            "token_id": mint.token_id,
        }

    def _publish_approval(self, device_code: str, approval: DeviceApprovalRecord) -> None:
        transition_id = secrets.token_urlsafe(16)
        try:
            self._store.approve(device_code, transition_id=transition_id, approval=approval)
        except (StateNotFoundError, InvalidTransitionError) as error:
            logger.exception("device_flow: approve raced on %s", device_code)
            raise DeviceStateLostError from error
        except Exception as publish_error:
            try:
                confirmation = self._store.confirm_approval(device_code, transition_id)
            except Exception:
                logger.exception("OAuth approval transition could not be confirmed")
                raise ApprovalOutcomeUnknownError from publish_error
            if confirmation is ApprovalTransitionConfirmation.PUBLISHED:
                logger.warning("OAuth approval transition succeeded after an ambiguous Redis response")
                return
            if confirmation is ApprovalTransitionConfirmation.UNKNOWN:
                raise ApprovalOutcomeUnknownError from publish_error
            raise

    def _restore_approval(self, device_code: str, state: DeviceFlowStateView, ttl_seconds: int) -> None:
        try:
            if not self._store.restore(device_code, state, ttl_seconds):
                logger.warning("device_flow: approval for %s not restored because the state exists again", device_code)
        except Exception:
            logger.exception("device_flow: failed to restore approval for %s", device_code)

    @staticmethod
    def _rotation_guard_id(
        *,
        subject_email: str,
        subject_issuer: str,
        client_id: str,
        device_key: str,
    ) -> str:
        identity = "\0".join((subject_email, subject_issuer, client_id, device_key))
        return sha256(identity.encode()).hexdigest()

    def _release_approval_nonce(self, nonce: str, reservation_id: str) -> None:
        try:
            self._sso.release_approval_nonce(nonce, reservation_id)
        except Exception:
            logger.exception("OAuth approval nonce compensation failed")

    @staticmethod
    def _audit_cross_ip_if_needed(state: DeviceFlowStateView, poll_ip: str, token_id: str) -> None:
        if state.created_ip and poll_ip and poll_ip != state.created_ip:
            logger.warning(
                "audit: oauth.device_code_cross_ip_poll token_id=%s creation_ip=%s poll_ip=%s",
                token_id,
                state.created_ip,
                poll_ip,
                extra={
                    "audit": True,
                    "token_id": token_id,
                    "creation_ip": state.created_ip,
                    "poll_ip": poll_ip,
                },
            )

    @staticmethod
    def _approval_audit_fields(state: DeviceFlowStateView, approval: DeviceApprovalRecord) -> dict[str, object]:
        return {
            "audit": True,
            "subject_type": approval["subject_type"],
            "subject_email": approval["subject_email"],
            "account_id": approval["account_id"],
            "tenant_id": approval["workspace_id"],
            "client_id": state.client_id,
            "device_label": state.device_label,
            "scopes": sorted(approval["subject_type"].scopes),
        }

    @classmethod
    def _emit_approve_audit(
        cls,
        request_id: str,
        state: DeviceFlowStateView,
        approval: DeviceApprovalRecord,
    ) -> None:
        logger.warning(
            "audit: oauth.device_flow_approved subject_type=%s subject=%s client_id=%s device_label=%s",
            approval["subject_type"],
            approval["subject_email"],
            state.client_id,
            state.device_label,
            extra={
                **cls._approval_audit_fields(state, approval),
                "event": "oauth.device_flow_approved",
                "request_id": request_id,
                "subject_issuer": approval["subject_issuer"],
            },
        )

    @classmethod
    def _emit_token_issued_audit(
        cls,
        state: DeviceFlowStateView,
        approval: DeviceApprovalRecord,
        poll_payload: PollPayload,
    ) -> None:
        logger.warning(
            "audit: oauth.device_token_issued token_id=%s subject_type=%s subject=%s client_id=%s device_label=%s "
            "expires_at=%s",
            poll_payload["token_id"],
            approval["subject_type"],
            approval["subject_email"],
            state.client_id,
            state.device_label,
            poll_payload["expires_at"],
            extra={
                **cls._approval_audit_fields(state, approval),
                "event": "oauth.device_token_issued",
                "token_id": poll_payload["token_id"],
                "expires_at": poll_payload["expires_at"],
            },
        )

    @staticmethod
    def _emit_deny_audit(state: DeviceFlowStateView) -> None:
        logger.warning(
            "audit: oauth.device_flow_denied client_id=%s device_label=%s",
            state.client_id,
            state.device_label,
            extra={
                "audit": True,
                "event": "oauth.device_flow_denied",
                "client_id": state.client_id,
                "device_label": state.device_label,
            },
        )

    @staticmethod
    def _emit_external_rejection_audit(
        context: DeviceRequestContext,
        state: DeviceFlowStateView,
        subject_email: str,
        subject_issuer: str,
        *,
        reason: str,
    ) -> None:
        logger.warning(
            "audit: oauth.device_flow_rejected subject_type=external_sso subject_email=%s subject_issuer=%s reason=%s",
            subject_email,
            subject_issuer,
            reason,
            extra={
                "audit": True,
                "event": "oauth.device_flow_rejected",
                "request_id": context.request_id,
                "subject_type": "external_sso",
                "subject_email": subject_email,
                "subject_issuer": subject_issuer,
                "reason": reason,
                "client_id": state.client_id,
                "device_label": state.device_label,
            },
        )
