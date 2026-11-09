"""Application service for OAuth device-flow use cases."""

from __future__ import annotations

import logging
import secrets
from collections.abc import Sequence
from hashlib import sha256
from typing import Protocol

from machinery.context import RequestContext
from services.entities.account_entities import AccountSnapshot
from services.oauth_device_contracts import (
    ACCOUNT_ISSUER_SENTINEL,
    DEFAULT_POLL_INTERVAL_SECONDS,
    DEVICE_FLOW_TTL_SECONDS,
    AccessDeniedError,
    AlreadyResolvedError,
    ApprovalInProgressError,
    ApprovalOutcomeUnknownError,
    ApprovalSessionConsumedError,
    ApprovalTransitionConfirmation,
    AuthorizationPendingError,
    DeviceApprovalContext,
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
)

logger = logging.getLogger(__name__)

_APPROVE_GUARD_TTL_SECONDS = 60
_SSO_COMPLETE_PATH = "/openapi/v1/oauth/device/sso-complete"


class DeviceFlowStore(Protocol):
    def start(self, client_id: str, device_label: str, created_ip: str) -> tuple[str, str, int]: ...

    def load_by_user_code(self, user_code: str) -> tuple[str, DeviceFlowStateView] | None: ...

    def load_by_device_code(self, device_code: str) -> DeviceFlowStateView | None: ...

    def approve(
        self,
        device_code: str,
        transition_id: str,
        token_id: str,
        poll_payload: PollPayload,
    ) -> None: ...

    def deny(self, device_code: str, transition_id: str) -> None: ...

    def confirm_approval(
        self,
        device_code: str,
        transition_id: str,
        token_id: str,
    ) -> ApprovalTransitionConfirmation: ...

    def consume_on_poll(self, device_code: str) -> DeviceFlowStateView | None: ...

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
    ) -> IssuedOAuthToken: ...

    def issue_external_token(
        self,
        *,
        subject_email: str,
        subject_issuer: str,
        client_id: str,
        device_label: str,
    ) -> IssuedOAuthToken: ...

    def rollback_token(self, token: IssuedOAuthToken) -> bool: ...


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

    def rollback_rotation(self, rotation: OAuthDeviceTokenRotation) -> bool: ...


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
        created_ip: str,
        request_origin: str,
    ) -> DeviceAuthorization:
        if client_id not in self._settings.known_client_ids:
            raise UnsupportedClientError

        device_code, user_code, expires_in = self._store.start(client_id, device_label, created_ip)
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

        terminal = self._store.consume_on_poll(device_code)
        if terminal is None:
            raise ExpiredTokenError
        if terminal.status is DeviceFlowStatus.DENIED:
            raise AccessDeniedError

        poll_payload = terminal.poll_payload
        if poll_payload is None or "token" not in poll_payload:
            logger.error("device_flow: approved state missing poll_payload for %s", device_code)
            raise ExpiredTokenError

        self._audit_cross_ip_if_needed(state, poll_ip)
        return poll_payload

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
        workspaces = tuple(self._workspaces.list_for_device_flow(account.id))
        transition_id = secrets.token_urlsafe(16)
        guard_id = self._rotation_guard_id(
            subject_email=account.email,
            subject_issuer=ACCOUNT_ISSUER_SENTINEL,
            client_id=state.client_id,
            device_label=state.device_label,
        )
        if not self._store.try_acquire_approval(guard_id, transition_id, _APPROVE_GUARD_TTL_SECONDS):
            raise ApprovalInProgressError

        try:
            current = self._store.load_by_user_code(user_code.strip().upper())
            if current is None or current[0] != device_code:
                raise DeviceStateLostError
            state = current[1]
            if state.status is not DeviceFlowStatus.PENDING:
                raise AlreadyResolvedError
            mint = self._tokens.issue_account_token(
                account=account,
                workspace_id=context.active_workspace_id,
                client_id=state.client_id,
                device_label=state.device_label,
            )
            try:
                poll_payload = self._build_account_poll_payload(
                    account,
                    context.active_workspace_id,
                    workspaces,
                    mint,
                )
                self._publish_approval(
                    device_code,
                    transition_id=transition_id,
                    token_id=mint.token_id,
                    poll_payload=poll_payload,
                )
            except ApprovalOutcomeUnknownError:
                raise
            except Exception as error:
                self._rollback_issued_token(mint)
                if isinstance(error, (StateNotFoundError, InvalidTransitionError)):
                    logger.exception("device_flow: approve raced on %s", device_code)
                    raise DeviceStateLostError from error
                raise
        finally:
            self._store.release_approval(guard_id, transition_id)

        self._emit_approve_audit(state, account, context.active_workspace_id, mint)
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

        transition_id = secrets.token_urlsafe(16)
        guard_id = self._rotation_guard_id(
            subject_email=claims.subject_email,
            subject_issuer=claims.subject_issuer,
            client_id=state.client_id,
            device_label=state.device_label,
        )
        if not self._store.try_acquire_approval(guard_id, transition_id, _APPROVE_GUARD_TTL_SECONDS):
            raise ApprovalInProgressError

        locked_device_code = device_code
        reservation_id = sha256(f"oauth-device-approval\0{claims.nonce}".encode()).hexdigest()
        nonce_reserved = False
        mint: IssuedOAuthToken | None = None
        try:
            current = self._store.load_by_user_code(claims.user_code)
            if current is None:
                raise ExternalUserCodeNotFoundError
            device_code, state = current
            if device_code != locked_device_code:
                raise DeviceStateLostError
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
            if not self._sso.reserve_approval_nonce(claims.nonce, reservation_id):
                raise ApprovalSessionConsumedError
            nonce_reserved = True

            mint = self._tokens.issue_external_token(
                subject_email=claims.subject_email,
                subject_issuer=claims.subject_issuer,
                client_id=state.client_id,
                device_label=state.device_label,
            )
            poll_payload: PollPayload = {
                "token": mint.token,
                "expires_at": mint.expires_at,
                "subject_type": "external_sso",
                "subject_email": claims.subject_email,
                "subject_issuer": claims.subject_issuer,
                "account": None,
                "workspaces": [],
                "default_workspace_id": None,
                "token_id": mint.token_id,
            }
            self._publish_approval(
                device_code,
                transition_id=transition_id,
                token_id=mint.token_id,
                poll_payload=poll_payload,
            )
        except ApprovalOutcomeUnknownError:
            raise
        except Exception as error:
            if mint is not None:
                self._rollback_issued_token(mint)
            if nonce_reserved:
                self._release_approval_nonce(claims.nonce, reservation_id)
            if isinstance(error, (StateNotFoundError, InvalidTransitionError)):
                logger.exception("approve-external: state transition raced")
                raise DeviceStateLostError from error
            raise
        finally:
            self._store.release_approval(guard_id, transition_id)

        assert mint is not None
        self._emit_approve_external_audit(context, state, claims, mint)
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
            "subject_type": "account",
            "account": {"id": account.id, "email": account.email, "name": account.name},
            "workspaces": [
                {"id": workspace.id, "name": workspace.name, "role": workspace.role} for workspace in workspaces
            ],
            "default_workspace_id": default_workspace_id,
            "token_id": mint.token_id,
        }

    def _rollback_issued_token(self, mint: IssuedOAuthToken) -> None:
        try:
            if not self._tokens.rollback_token(mint):
                logger.warning("OAuth token compensation skipped because rotation was already superseded")
        except Exception:
            logger.exception("OAuth token compensation failed", extra={"token_id": mint.token_id})

    def _publish_approval(
        self,
        device_code: str,
        *,
        transition_id: str,
        token_id: str,
        poll_payload: PollPayload,
    ) -> None:
        try:
            self._store.approve(
                device_code,
                transition_id=transition_id,
                token_id=token_id,
                poll_payload=poll_payload,
            )
        except (StateNotFoundError, InvalidTransitionError):
            raise
        except Exception as publish_error:
            try:
                confirmation = self._store.confirm_approval(device_code, transition_id, token_id)
            except Exception:
                logger.exception("OAuth approval transition could not be confirmed", extra={"token_id": token_id})
                raise ApprovalOutcomeUnknownError from publish_error
            if confirmation is ApprovalTransitionConfirmation.PUBLISHED:
                logger.warning("OAuth approval transition succeeded after an ambiguous Redis response")
                return
            if confirmation is ApprovalTransitionConfirmation.UNKNOWN:
                raise ApprovalOutcomeUnknownError from publish_error
            raise

    @staticmethod
    def _rotation_guard_id(
        *,
        subject_email: str,
        subject_issuer: str,
        client_id: str,
        device_label: str,
    ) -> str:
        identity = "\0".join((subject_email, subject_issuer, client_id, device_label))
        return sha256(identity.encode()).hexdigest()

    def _release_approval_nonce(self, nonce: str, reservation_id: str) -> None:
        try:
            self._sso.release_approval_nonce(nonce, reservation_id)
        except Exception:
            logger.exception("OAuth approval nonce compensation failed")

    @staticmethod
    def _audit_cross_ip_if_needed(state: DeviceFlowStateView, poll_ip: str) -> None:
        if state.created_ip and poll_ip and poll_ip != state.created_ip:
            token_id = state.poll_payload["token_id"] if state.poll_payload is not None else state.token_id
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
    def _emit_approve_audit(
        state: DeviceFlowStateView,
        account: AccountSnapshot,
        workspace_id: str,
        mint: IssuedOAuthToken,
    ) -> None:
        logger.warning(
            "audit: oauth.device_flow_approved token_id=%s subject=%s client_id=%s device_label=%s "
            "rotated=? expires_at=%s",
            mint.token_id,
            account.email,
            state.client_id,
            state.device_label,
            mint.expires_at,
            extra={
                "audit": True,
                "event": "oauth.device_flow_approved",
                "token_id": mint.token_id,
                "subject_type": "account",
                "subject_email": account.email,
                "account_id": account.id,
                "tenant_id": workspace_id,
                "client_id": state.client_id,
                "device_label": state.device_label,
                "scopes": ["full"],
                "expires_at": mint.expires_at,
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

    @staticmethod
    def _emit_approve_external_audit(
        context: DeviceRequestContext,
        state: DeviceFlowStateView,
        claims: ExternalApprovalGrant,
        mint: IssuedOAuthToken,
    ) -> None:
        logger.warning(
            "audit: oauth.device_flow_approved subject_type=external_sso subject_email=%s "
            "subject_issuer=%s token_id=%s",
            claims.subject_email,
            claims.subject_issuer,
            mint.token_id,
            extra={
                "audit": True,
                "event": "oauth.device_flow_approved",
                "request_id": context.request_id,
                "subject_type": "external_sso",
                "subject_email": claims.subject_email,
                "subject_issuer": claims.subject_issuer,
                "token_id": mint.token_id,
                "client_id": state.client_id,
                "device_label": state.device_label,
                "scopes": ["apps:run"],
                "expires_at": mint.expires_at,
            },
        )
