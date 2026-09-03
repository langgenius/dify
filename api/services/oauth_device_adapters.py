"""Outer adapters for the OAuth device external-SSO use cases."""

import logging
import os
import secrets
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Protocol, override

from pydantic import BaseModel, Field, ValidationError

from configs import dify_config
from constants.oauth_bearer import MINTABLE_PROFILES, SubjectType
from extensions.ext_redis import RedisClientWrapper
from libs import jws
from libs.device_flow_security import (
    NONCE_KEY_FMT,
    NONCE_TTL_SECONDS,
    consume_sso_assertion_nonce,
    mint_approval_grant,
    verify_approval_grant,
)
from libs.helper import RateLimiter
from libs.oauth_bearer import sha256_hex
from libs.rate_limit import LIMIT_APPROVE_EXT_PER_EMAIL
from services.entities.account_entities import AccountSnapshot
from services.oauth_device_application_service import (
    ExternalApprovalLimiter,
    OAuthDeviceSettings,
    OAuthDeviceSSOGateway,
    OAuthDeviceTokenIssuer,
    OAuthDeviceTokenPersistence,
    OAuthDeviceTokenTTLPolicy,
)
from services.oauth_device_contracts import (
    ACCOUNT_ISSUER_SENTINEL,
    ExternalApprovalGrant,
    ExternalSubjectAssertion,
    InvalidApprovalSessionError,
    InvalidSSOAssertionError,
    IssuedOAuthToken,
    OAuthDeviceSSOInitiationError,
    OAuthDeviceTokenWrite,
)

logger = logging.getLogger(__name__)

_EMAIL_FIELD = Field(min_length=3, max_length=320, pattern=r"^[^@\s]+@[^@\s]+$")
_DEFAULT_OAUTH_TTL_DAYS = 14
_MIN_OAUTH_TTL_DAYS = 1
_MAX_OAUTH_TTL_DAYS = 365
_TTL_ENV_VAR = "OAUTH_TTL_DAYS"
_OAUTH_TOKEN_BODY_BYTES = 32
_RESERVE_APPROVAL_NONCE_LUA = """
local current = redis.call('GET', KEYS[1])
if current == ARGV[1] then return 1 end
if current then return 0 end
local stored = redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2], 'NX')
if stored then return 1 end
return 0
"""
_RELEASE_APPROVAL_NONCE_LUA = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
"""


class EnterpriseDeviceSSOService(Protocol):
    def initiate_device_flow_sso(self, signed_state: str) -> Mapping[str, object] | None: ...


class DifyConfigOAuthDeviceSettings(OAuthDeviceSettings):
    @property
    @override
    def known_client_ids(self) -> frozenset[str]:
        return dify_config.OPENAPI_KNOWN_CLIENT_IDS

    @property
    @override
    def verification_base_url(self) -> str | None:
        return dify_config.CONSOLE_WEB_URL

    @property
    @override
    def sso_base_url(self) -> str | None:
        return dify_config.CONSOLE_API_URL


class EnvironmentOAuthDeviceTokenTTLPolicy(OAuthDeviceTokenTTLPolicy):
    @override
    def ttl_days(self, workspace_id: str | None) -> int:
        # Reserved for a future tenant-specific policy, which should take
        # precedence over the deployment-wide environment value.
        _ = workspace_id
        raw = os.environ.get(_TTL_ENV_VAR)
        if raw is None:
            return _DEFAULT_OAUTH_TTL_DAYS
        try:
            value = int(raw)
        except ValueError:
            logger.warning(
                "%s=%r is not an int; falling back to %d",
                _TTL_ENV_VAR,
                raw,
                _DEFAULT_OAUTH_TTL_DAYS,
            )
            return _DEFAULT_OAUTH_TTL_DAYS
        if value < _MIN_OAUTH_TTL_DAYS:
            logger.warning("%s=%d below min %d; clamping", _TTL_ENV_VAR, value, _MIN_OAUTH_TTL_DAYS)
            return _MIN_OAUTH_TTL_DAYS
        if value > _MAX_OAUTH_TTL_DAYS:
            logger.warning("%s=%d above max %d; clamping", _TTL_ENV_VAR, value, _MAX_OAUTH_TTL_DAYS)
            return _MAX_OAUTH_TTL_DAYS
        return value


class OAuthDeviceTokenIssuanceGateway(OAuthDeviceTokenIssuer):
    def __init__(
        self,
        *,
        tokens: OAuthDeviceTokenPersistence,
        ttl_policy: OAuthDeviceTokenTTLPolicy,
    ) -> None:
        self._tokens = tokens
        self._ttl_policy = ttl_policy

    @override
    def issue_account_token(
        self,
        *,
        account: AccountSnapshot,
        workspace_id: str,
        client_id: str,
        device_label: str,
    ) -> IssuedOAuthToken:
        return self._issue_token(
            subject_type=SubjectType.ACCOUNT,
            subject_email=account.email,
            subject_issuer=ACCOUNT_ISSUER_SENTINEL,
            account_id=account.id,
            client_id=client_id,
            device_label=device_label,
            workspace_id=workspace_id,
        )

    @override
    def issue_external_token(
        self,
        *,
        subject_email: str,
        subject_issuer: str,
        client_id: str,
        device_label: str,
    ) -> IssuedOAuthToken:
        if not subject_issuer.strip():
            raise ValueError("external-SSO token requires non-empty subject_issuer")
        return self._issue_token(
            subject_type=SubjectType.EXTERNAL_SSO,
            subject_email=subject_email,
            subject_issuer=subject_issuer,
            account_id=None,
            client_id=client_id,
            device_label=device_label,
            workspace_id=None,
        )

    def _issue_token(
        self,
        *,
        subject_type: SubjectType,
        subject_email: str,
        subject_issuer: str,
        account_id: str | None,
        client_id: str,
        device_label: str,
        workspace_id: str | None,
    ) -> IssuedOAuthToken:
        profile = MINTABLE_PROFILES[subject_type]
        plaintext = profile.prefix + secrets.token_urlsafe(_OAUTH_TOKEN_BODY_BYTES)
        expires_at = datetime.now(UTC) + timedelta(days=self._ttl_policy.ttl_days(workspace_id))
        rotation = self._tokens.rotate_token(
            OAuthDeviceTokenWrite(
                subject_email=subject_email,
                subject_issuer=subject_issuer,
                account_id=account_id,
                client_id=client_id,
                device_label=device_label,
                prefix=profile.prefix,
                token_hash=sha256_hex(plaintext),
                expires_at=expires_at,
            )
        )
        return IssuedOAuthToken(token=plaintext, expires_at=expires_at.isoformat(), rotation=rotation)

    @override
    def rollback_token(self, token: IssuedOAuthToken) -> bool:
        return self._tokens.rollback_rotation(token.rotation)


class _ExternalSubjectAssertionPayload(BaseModel):
    email: str = _EMAIL_FIELD
    issuer: str = Field(min_length=1, max_length=255)
    user_code: str = Field(min_length=1, max_length=32)
    nonce: str = Field(min_length=1, max_length=128)


class EnterpriseOAuthDeviceSSOGateway(OAuthDeviceSSOGateway):
    def __init__(
        self,
        *,
        redis: RedisClientWrapper,
        enterprise_service: EnterpriseDeviceSSOService,
    ) -> None:
        self._redis = redis
        self._enterprise_service = enterprise_service

    @override
    def initiate(self, *, user_code: str, callback_url: str, ttl_seconds: int) -> str:
        keyset = jws.KeySet.from_shared_secret()
        signed_state = jws.sign(
            keyset,
            payload={
                "redirect_url": "",
                "app_code": "",
                "intent": "device_flow",
                "user_code": user_code,
                "nonce": secrets.token_urlsafe(16),
                "return_to": "",
                "idp_callback_url": callback_url,
            },
            aud=jws.AUD_STATE_ENVELOPE,
            ttl_seconds=ttl_seconds,
        )
        try:
            reply = self._enterprise_service.initiate_device_flow_sso(signed_state)
        except Exception as error:
            logger.warning("oauth device SSO initiation failed: %s", error)
            raise OAuthDeviceSSOInitiationError("sso_initiate_failed") from error

        redirect_url = (reply or {}).get("url")
        if not isinstance(redirect_url, str) or not redirect_url:
            raise OAuthDeviceSSOInitiationError("sso_initiate_missing_url")
        return redirect_url

    @override
    def verify_assertion(self, assertion: str) -> ExternalSubjectAssertion:
        keyset = jws.KeySet.from_shared_secret()
        try:
            raw_claims = jws.verify(keyset, assertion, expected_aud=jws.AUD_EXT_SUBJECT_ASSERTION)
            claims = _ExternalSubjectAssertionPayload.model_validate(raw_claims)
        except (jws.VerifyError, ValidationError) as error:
            raise InvalidSSOAssertionError(str(error)) from error
        return ExternalSubjectAssertion(
            subject_email=claims.email,
            subject_issuer=claims.issuer,
            user_code=claims.user_code,
            nonce=claims.nonce,
        )

    @override
    def mint_approval_grant(
        self,
        *,
        issuer: str,
        subject_email: str,
        subject_issuer: str,
        user_code: str,
    ) -> str:
        token, _claims = mint_approval_grant(
            keyset=jws.KeySet.from_shared_secret(),
            iss=issuer,
            subject_email=subject_email,
            subject_issuer=subject_issuer,
            user_code=user_code,
        )
        return token

    @override
    def verify_approval_grant(self, token: str) -> ExternalApprovalGrant:
        try:
            claims = verify_approval_grant(jws.KeySet.from_shared_secret(), token)
        except jws.VerifyError as error:
            raise InvalidApprovalSessionError(str(error)) from error
        return ExternalApprovalGrant(
            subject_email=claims.subject_email,
            subject_issuer=claims.subject_issuer,
            user_code=claims.user_code,
            nonce=claims.nonce,
            csrf_token=claims.csrf_token,
            expires_at=claims.expires_at,
        )

    @override
    def consume_assertion_nonce(self, nonce: str) -> bool:
        return consume_sso_assertion_nonce(self._redis, nonce)

    @override
    def reserve_approval_nonce(self, nonce: str, reservation_id: str) -> bool:
        if not nonce or not reservation_id:
            return False
        reserve_script = self._redis.register_script(_RESERVE_APPROVAL_NONCE_LUA)
        return bool(
            reserve_script(
                keys=[NONCE_KEY_FMT.format(nonce=nonce)],
                args=[reservation_id, NONCE_TTL_SECONDS],
            )
        )

    @override
    def release_approval_nonce(self, nonce: str, reservation_id: str) -> None:
        if not nonce or not reservation_id:
            return
        release_script = self._redis.register_script(_RELEASE_APPROVAL_NONCE_LUA)
        release_script(
            keys=[NONCE_KEY_FMT.format(nonce=nonce)],
            args=[reservation_id],
        )


class RedisExternalApprovalLimiter(ExternalApprovalLimiter):
    def __init__(self, *, redis: RedisClientWrapper) -> None:
        self._rate_limiter = RateLimiter(
            prefix="rl:subject_email",
            max_attempts=LIMIT_APPROVE_EXT_PER_EMAIL.limit,
            time_window=int(LIMIT_APPROVE_EXT_PER_EMAIL.window.total_seconds()),
            redis_client=redis,
        )

    @override
    def is_rate_limited(self, subject_email: str) -> bool:
        return self._rate_limiter.is_rate_limited(f"subject:{subject_email}")

    @override
    def record(self, subject_email: str) -> None:
        self._rate_limiter.increment_rate_limit(f"subject:{subject_email}")
