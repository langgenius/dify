from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from unittest.mock import create_autospec

import pytest
from flask import Flask
from flask.testing import FlaskClient
from werkzeug.test import TestResponse

from controllers.openapi import bp as openapi_bp
from libs.helper import RateLimiter
from repositories.oauth_authorization_code_repository import RedisAuthorizationCodeRepository
from services.oauth_device_application_service import (
    DeviceWorkspaceQuery,
    ExternalApprovalLimiter,
    OAuthDeviceAccountQuery,
    OAuthDeviceApplicationService,
    OAuthDeviceSessionRepository,
    OAuthDeviceSSOGateway,
    OAuthDeviceTokenIssuer,
)
from services.oauth_device_contracts import (
    ApprovalTransitionConfirmation,
    DeviceFlowStatus,
    PollPayload,
    SlowDownDecision,
)
from services.oauth_token_contracts import GrantType
from services.oauth_token_grants import build_grant_handlers
from services.oauth_token_service import OAuthTokenService
from tests.helpers.unit.services.oauth_authorization_code_fakes import (
    DictRedis,
    FakeAccounts,
    FakeTokenIssuer,
    FakeTokenSettings,
    FakeWorkspaces,
    registry,
)

OLD_POLL_PATH = "/openapi/v1/oauth/device/token"
NEW_POLL_PATH = "/openapi/v1/oauth/token"
CODE_PATH = "/openapi/v1/oauth/device/code"
DEVICE_CODE = "device-1"
USER_CODE = "ABCD-EFGH"
CLIENT_ID = "difyctl"


class Outcome(StrEnum):
    PENDING = "authorization_pending"
    SLOW_DOWN = "slow_down"
    EXPIRED = "expired_token"
    DENIED = "access_denied"
    SUCCESS = "success"


@dataclass
class FakeState:
    client_id: str = CLIENT_ID
    device_label: str = "CLI"
    status: DeviceFlowStatus = DeviceFlowStatus.PENDING
    token_id: str | None = None
    created_ip: str = "127.0.0.1"
    poll_payload: PollPayload | None = None


@dataclass
class FakeStore:
    states: dict[str, FakeState] = field(default_factory=dict)
    poll_decision: SlowDownDecision = SlowDownDecision.OK

    def start(self, client_id: str, device_label: str, created_ip: str) -> tuple[str, str, int]:
        _ = (client_id, device_label, created_ip)
        self.states[DEVICE_CODE] = FakeState()
        return DEVICE_CODE, USER_CODE, 900

    def load_by_user_code(self, user_code: str) -> tuple[str, FakeState] | None:
        _ = user_code
        return None

    def approve(self, device_code: str, transition_id: str, token_id: str, poll_payload: PollPayload) -> None:
        _ = (device_code, transition_id, token_id, poll_payload)

    def deny(self, device_code: str, transition_id: str) -> None:
        _ = (device_code, transition_id)

    def confirm_approval(self, device_code: str, transition_id: str, token_id: str) -> ApprovalTransitionConfirmation:
        _ = (device_code, transition_id, token_id)
        return ApprovalTransitionConfirmation.UNKNOWN

    def try_acquire_approval(self, guard_id: str, owner_id: str, ttl_seconds: int) -> bool:
        _ = (guard_id, owner_id, ttl_seconds)
        return True

    def release_approval(self, guard_id: str, owner_id: str) -> None:
        _ = (guard_id, owner_id)

    def load_by_device_code(self, device_code: str) -> FakeState | None:
        return self.states.get(device_code)

    def consume_on_poll(self, device_code: str) -> FakeState | None:
        return self.states.pop(device_code, None)

    def record_poll(self, device_code: str, interval_seconds: int) -> SlowDownDecision:
        _ = (device_code, interval_seconds)
        return self.poll_decision


@dataclass
class FakeSettings:
    known_client_ids: frozenset[str] = frozenset({CLIENT_ID})
    verification_base_url: str | None = "https://console.example"
    sso_base_url: str | None = "https://api.example"


@dataclass
class _Services:
    oauth_device: OAuthDeviceApplicationService
    oauth_token: OAuthTokenService


def _poll_payload() -> PollPayload:
    return PollPayload(
        token="dfoa_secret",
        expires_at=(datetime.now(UTC) + timedelta(days=1)).isoformat(),
        subject_type="account",
        account={"id": "a1", "email": "ada@example.com", "name": "Ada"},
        workspaces=[{"id": "w1", "name": "Primary", "role": "owner"}],
        default_workspace_id="w1",
        token_id="t1",
    )


@pytest.fixture
def store() -> FakeStore:
    return FakeStore()


@pytest.fixture
def client(store: FakeStore, monkeypatch: pytest.MonkeyPatch) -> FlaskClient:
    monkeypatch.setattr(RateLimiter, "is_rate_limited", lambda _self, _key: False)
    monkeypatch.setattr(RateLimiter, "increment_rate_limit", lambda _self, _key: None)
    device = OAuthDeviceApplicationService(
        store=store,
        accounts=create_autospec(OAuthDeviceAccountQuery, instance=True),
        workspaces=create_autospec(DeviceWorkspaceQuery, instance=True),
        tokens=create_autospec(OAuthDeviceTokenIssuer, instance=True),
        sessions=create_autospec(OAuthDeviceSessionRepository, instance=True),
        sso=create_autospec(OAuthDeviceSSOGateway, instance=True),
        external_approval_limiter=create_autospec(ExternalApprovalLimiter, instance=True),
        settings=FakeSettings(),
    )
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(openapi_bp)
    app.extensions["application_services"] = _Services(
        oauth_device=device,
        oauth_token=OAuthTokenService(
            handlers=build_grant_handlers(
                device=device,
                clients=registry(),
                codes=RedisAuthorizationCodeRepository(DictRedis()),
                accounts=FakeAccounts(),
                workspaces=FakeWorkspaces(),
                tokens=FakeTokenIssuer(),
                settings=FakeTokenSettings(authorization_code_enabled=False),
            )
        ),
    )
    return app.test_client()


def _seed(store: FakeStore, outcome: Outcome) -> None:
    store.states[DEVICE_CODE] = FakeState()
    match outcome:
        case Outcome.PENDING:
            pass
        case Outcome.SLOW_DOWN:
            store.poll_decision = SlowDownDecision.SLOW_DOWN
        case Outcome.EXPIRED:
            store.states.clear()
        case Outcome.DENIED:
            store.states[DEVICE_CODE].status = DeviceFlowStatus.DENIED
        case Outcome.SUCCESS:
            store.states[DEVICE_CODE].status = DeviceFlowStatus.APPROVED
            store.states[DEVICE_CODE].poll_payload = _poll_payload()


def _poll_old(client: FlaskClient, *, client_id: str = CLIENT_ID) -> TestResponse:
    return client.post(OLD_POLL_PATH, json={"device_code": DEVICE_CODE, "client_id": client_id})


def _poll_new(client: FlaskClient, *, client_id: str = CLIENT_ID) -> TestResponse:
    return client.post(
        NEW_POLL_PATH,
        data={"grant_type": GrantType.DEVICE_CODE, "device_code": DEVICE_CODE, "client_id": client_id},
    )


@pytest.mark.parametrize(
    "outcome", [Outcome.PENDING, Outcome.SLOW_DOWN, Outcome.EXPIRED, Outcome.DENIED], ids=lambda o: o.value
)
def test_error_outcomes_match_between_routes(outcome: Outcome, store: FakeStore, client: FlaskClient) -> None:
    _seed(store, outcome)
    old = _poll_old(client)
    _seed(store, outcome)
    new = _poll_new(client)

    assert old.status_code == new.status_code == 400
    assert old.get_json() == new.get_json() == {"error": outcome.value}


def test_success_matches_between_routes(store: FakeStore, client: FlaskClient) -> None:
    _seed(store, Outcome.SUCCESS)
    old = _poll_old(client)
    _seed(store, Outcome.SUCCESS)
    new = _poll_new(client)

    assert old.status_code == new.status_code == 200
    old_body = old.get_json()
    new_body = new.get_json()
    assert new_body["access_token"] == old_body["token"] == "dfoa_secret"
    assert new_body["token_type"] == "Bearer"
    for extra in ("subject_type", "account", "workspaces", "default_workspace_id", "token_id"):
        assert new_body[extra] == old_body[extra]


def test_mismatched_client_id_succeeds_on_old_route_and_fails_on_new(store: FakeStore, client: FlaskClient) -> None:
    _seed(store, Outcome.SUCCESS)
    old = _poll_old(client, client_id="other-client")
    _seed(store, Outcome.SUCCESS)
    new = _poll_new(client, client_id="other-client")

    assert old.status_code == 200
    assert old.get_json()["token"] == "dfoa_secret"
    assert new.status_code == 401
    assert new.headers["WWW-Authenticate"] == 'Basic realm="dify-openapi"'
    assert new.get_json() == {"error": "invalid_client"}
    assert DEVICE_CODE in store.states


def test_unknown_client_id_on_device_code_stays_unsupported_client(client: FlaskClient) -> None:
    response = client.post(CODE_PATH, json={"client_id": "nobody"})

    assert response.status_code == 400
    assert response.get_json() == {"error": "unsupported_client"}
