from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import override

import pytest

from extensions.ext_redis import RedisClientWrapper
from libs import jws
from libs.rate_limit import LIMIT_APPROVE_EXT_PER_EMAIL
from services.oauth_device_adapters import (
    DifyConfigOAuthDeviceSettings,
    EnterpriseDeviceSSOService,
    EnterpriseOAuthDeviceSSOGateway,
    EnvironmentOAuthDeviceTokenTTLPolicy,
    RedisExternalApprovalLimiter,
)
from services.oauth_device_contracts import OAuthDeviceSSOInitiationError


@dataclass
class _EnterpriseService(EnterpriseDeviceSSOService):
    response: Mapping[str, object] | None
    signed_states: list[str] = field(default_factory=list)

    @override
    def initiate_device_flow_sso(self, signed_state: str) -> Mapping[str, object] | None:
        self.signed_states.append(signed_state)
        return self.response


class _FailingEnterpriseService(EnterpriseDeviceSSOService):
    @override
    def initiate_device_flow_sso(self, signed_state: str) -> Mapping[str, object] | None:
        _ = signed_state
        raise RuntimeError("enterprise unavailable")


@dataclass
class _NonceRedis:
    values: dict[str | bytes, object] = field(default_factory=dict)

    def set(
        self,
        name: str | bytes,
        value: object,
        *,
        nx: bool = False,
        ex: int | None = None,
        **_kwargs: object,
    ) -> bool:
        _ = ex
        if nx and name in self.values:
            return False
        self.values[name] = value
        return True

    def register_script(self, script: str) -> Callable[..., int]:
        def execute(
            *,
            keys: list[str | bytes],
            args: list[object],
            client: object | None = None,
        ) -> int:
            _ = client
            key = keys[0]
            if "local current" in script:
                current = self.values.get(key)
                if current == args[0]:
                    return 1
                if current is not None:
                    return 0
                self.values[key] = args[0]
                return 1
            if self.values.get(key) != args[0]:
                return 0
            del self.values[key]
            return 1

        return execute


def _gateway(
    config_overrides: Callable[..., None],
    enterprise_service: EnterpriseDeviceSSOService,
) -> EnterpriseOAuthDeviceSSOGateway:
    config_overrides(SECRET_KEY="test-secret-key-that-is-at-least-32-bytes")
    return EnterpriseOAuthDeviceSSOGateway(
        redis=RedisClientWrapper(),
        enterprise_service=enterprise_service,
    )


def test_initiate_uses_injected_enterprise_operation(config_overrides: Callable[..., None]) -> None:
    enterprise_service = _EnterpriseService(response={"url": "https://idp.example.com/authorize"})
    gateway = _gateway(config_overrides, enterprise_service)

    redirect_url = gateway.initiate(
        user_code="ABCD-1234",
        callback_url="https://api.example.com/openapi/v1/oauth/device/sso-complete",
        ttl_seconds=300,
    )

    assert redirect_url == "https://idp.example.com/authorize"
    assert len(enterprise_service.signed_states) == 1
    claims = jws.verify(
        jws.KeySet.from_shared_secret(),
        enterprise_service.signed_states[0],
        expected_aud=jws.AUD_STATE_ENVELOPE,
    )
    assert claims["user_code"] == "ABCD-1234"
    assert claims["idp_callback_url"] == "https://api.example.com/openapi/v1/oauth/device/sso-complete"


@pytest.mark.parametrize("response", [None, {}, {"url": ""}, {"url": 123}])
def test_initiate_rejects_missing_or_invalid_redirect_url(
    config_overrides: Callable[..., None],
    response: Mapping[str, object] | None,
) -> None:
    gateway = _gateway(config_overrides, _EnterpriseService(response=response))

    with pytest.raises(OAuthDeviceSSOInitiationError, match="sso_initiate_missing_url"):
        gateway.initiate(user_code="ABCD-1234", callback_url="https://api.example.com/callback", ttl_seconds=300)


def test_initiate_maps_injected_enterprise_failure(config_overrides: Callable[..., None]) -> None:
    gateway = _gateway(config_overrides, _FailingEnterpriseService())

    with pytest.raises(OAuthDeviceSSOInitiationError, match="sso_initiate_failed"):
        gateway.initiate(user_code="ABCD-1234", callback_url="https://api.example.com/callback", ttl_seconds=300)


def test_settings_adapter_owns_oauth_device_configuration(config_overrides: Callable[..., None]) -> None:
    config_overrides(
        inner_OPENAPI_KNOWN_CLIENT_IDS="client-a,client-b",
        CONSOLE_WEB_URL="https://console.example.com",
        CONSOLE_API_URL="https://api.example.com",
    )

    settings = DifyConfigOAuthDeviceSettings()

    assert settings.known_client_ids == frozenset({"client-a", "client-b"})
    assert settings.verification_base_url == "https://console.example.com"
    assert settings.sso_base_url == "https://api.example.com"


def test_external_approval_limiter_owns_rate_limit_policy() -> None:
    limiter = RedisExternalApprovalLimiter(redis=RedisClientWrapper())

    assert limiter._rate_limiter.prefix == "rl:subject_email"
    assert limiter._rate_limiter.max_attempts == LIMIT_APPROVE_EXT_PER_EMAIL.limit
    assert limiter._rate_limiter.time_window == int(LIMIT_APPROVE_EXT_PER_EMAIL.window.total_seconds())


def test_approval_nonce_release_only_removes_matching_reservation(config_overrides: Callable[..., None]) -> None:
    config_overrides(REDIS_KEY_PREFIX="")
    raw_redis = _NonceRedis()
    redis = RedisClientWrapper()
    redis.initialize(raw_redis)  # type: ignore[arg-type]
    gateway = EnterpriseOAuthDeviceSSOGateway(
        redis=redis,
        enterprise_service=_EnterpriseService(response=None),
    )

    assert gateway.reserve_approval_nonce("nonce-1", "reservation-1") is True
    assert gateway.reserve_approval_nonce("nonce-1", "reservation-1") is True
    assert gateway.reserve_approval_nonce("nonce-1", "reservation-2") is False

    gateway.release_approval_nonce("nonce-1", "reservation-2")
    assert gateway.reserve_approval_nonce("nonce-1", "reservation-2") is False

    gateway.release_approval_nonce("nonce-1", "reservation-1")
    assert gateway.reserve_approval_nonce("nonce-1", "reservation-2") is True


@pytest.mark.parametrize(
    ("configured", "expected"),
    [(None, 14), ("invalid", 14), ("0", 1), ("500", 365), ("30", 30)],
)
def test_token_ttl_policy_owns_environment_parsing(
    monkeypatch: pytest.MonkeyPatch,
    configured: str | None,
    expected: int,
) -> None:
    if configured is None:
        monkeypatch.delenv("OAUTH_TTL_DAYS", raising=False)
    else:
        monkeypatch.setenv("OAUTH_TTL_DAYS", configured)

    assert EnvironmentOAuthDeviceTokenTTLPolicy().ttl_days("workspace-1") == expected
