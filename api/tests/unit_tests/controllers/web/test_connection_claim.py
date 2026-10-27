"""Guest Claim through real Passport verification and transactional persistence."""

import base64
import hashlib
from collections.abc import Callable, Iterator
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest
import sqlalchemy as sa
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.test import TestResponse

from constants.end_user_connections import ConnectionCredentialStatus, ConnectionCredentialType
from context.connection_execution import ConnectionExecutionContext, ExecutionConnectionSelection
from controllers.console import bp as console_bp
from controllers.console import wraps as console_wraps
from controllers.console.auth import login as console_login
from controllers.web import bp, connection_claim, connections, passport, wraps
from extensions.ext_redis import RedisClientWrapper
from libs.passport import PassportService
from models.account import Account, AccountStatus
from models.end_user_connection import (
    AppConnection,
    EndUserConnection,
    EndUserConnectionRevisionAcceptance,
    SessionConnection,
)
from models.enums import ConversationFromSource, CustomizeTokenStrategy, EndUserType, InvokeFrom
from models.model import App, AppMode, Conversation, EndUser, Site
from models.workflow import Workflow, WorkflowType
from repositories.account.repository import SQLAlchemyAccountRepository
from repositories.web_passport_repository import WebPassportRepository
from services.end_user_connections.claim import ConnectionClaimService
from services.end_user_connections.entities import WebConnectionContext
from services.end_user_connections.errors import ConnectionConflictError
from services.end_user_connections.selections import ConnectionSelectionService
from services.entities.passport_entities import WebPassportRequest
from services.web_identity_service import WebIdentityService
from services.web_login_handoff import WebLoginHandoffService
from services.web_login_handoff_adapters import RedisWebLoginGrantStore
from services.web_passport_gateways import DeploymentWebPassportAuthGateway, PassportTokenGateway
from services.web_passport_service import WebAppAuthType, WebPassportService
from tests.helpers.end_user_api_key import PROVIDER
from tests.helpers.end_user_oauth import OAuthHarness, make_oauth_harness


@dataclass
class ClaimHarness:
    oauth: OAuthHarness
    account: WebConnectionContext
    services: SimpleNamespace
    signer: PassportService
    proof: str
    guest_passport: str
    client: FlaskClient

    def headers(self, *, proof: str | None = None) -> dict[str, str]:
        return {
            "X-App-Code": self.oauth.app_code,
            "X-App-Passport": self.guest_passport,
            "Authorization": f"Bearer {proof or self.proof}",
        }

    def claim(self) -> TestResponse:
        return self.client.post(
            "/api/connections/claim",
            headers={"Authorization": f"Bearer {self.proof}"},
            json={"passports": [self.guest_passport]},
        )


def account_proof(signer: PassportService, account_id: str, *, expired: bool = False) -> str:
    return signer.issue(
        {
            "sub": "Web API Account Login",
            "token_source": "webapp_account_login",
            "auth_type": "internal",
            "user_id": account_id,
            "exp": 1 if expired else int((datetime.now(UTC) + timedelta(hours=1)).timestamp()),
        }
    )


@pytest.fixture
def harness(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> Iterator[ClaimHarness]:
    config_overrides(
        SECRET_KEY="guest-connection-claim-test-key-with-32-bytes",
        END_USER_AUTH_ALLOW_ANONYMOUS=True,
        WEBAPP_ACCOUNT_PASSPORT_ENABLED=True,
        APP_WEB_URL="https://apps.example.net",
        CONSOLE_WEB_URL="https://console.example.com",
        CONSOLE_API_URL="https://console.example.com",
        COOKIE_DOMAIN="",
    )
    oauth = make_oauth_harness(sqlite_session_factory, monkeypatch)
    account = oauth.base.context
    with sqlite_session_factory.begin() as session:
        session.execute(sa.update(App).where(App.id == account.app_id).values(mode=AppMode.ADVANCED_CHAT))
        guest = EndUser(
            tenant_id=account.tenant_id,
            app_id=account.app_id,
            type=EndUserType.BROWSER,
            account_id=None,
            session_id=str(uuid4()),
            _is_anonymous=True,
        )
        session.add(guest)
        session.flush()
        guest_id, guest_session = guest.id, guest.session_id
    oauth.base.context = replace(account, end_user_id=guest_id, account_id=None)
    signer = PassportService()
    identity = WebIdentityService(
        accounts=SQLAlchemyAccountRepository(sqlite_session_factory), allow_console_login=True, allow_webapp_login=False
    )
    tokens = PassportTokenGateway(passport=signer)
    passports = WebPassportService(
        passports=WebPassportRepository(
            session_factory=sqlite_session_factory, generate_session_id=lambda: str(uuid4())
        ),
        auth=DeploymentWebPassportAuthGateway(
            webapp_auth_enabled=False,
            get_app_access_mode=lambda _: pytest.fail("No Cloud App ACL"),
            is_user_allowed=lambda _user, _app: pytest.fail("No Cloud App ACL"),
        ),
        tokens=tokens,
        identities=identity,
        account_passports_enabled=True,
        now=lambda: datetime.now(UTC),
        access_token_expire_minutes=60,
    )
    services = SimpleNamespace(
        connection_selections=ConnectionSelectionService(store=oauth.base.repository),
        web_identity=identity,
        web_passport=passports,
        end_user_connections=oauth.base.service,
        end_user_connection_claims=ConnectionClaimService(
            store=oauth.base.repository, passports=passports, tokens=tokens, identities=identity
        ),
    )
    for module in (wraps, connection_claim, connections, passport, console_login):
        monkeypatch.setattr(module, "application_services", lambda: services)
    monkeypatch.setattr(wraps.SystemFeatureService, "is_webapp_auth_enabled", lambda: False)
    monkeypatch.setattr(console_wraps, "_is_setup_completed", lambda: True)
    guest_token = passports.issue(WebPassportRequest(oauth.app_code, guest_session, None)).access_token
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    app.register_blueprint(console_bp)
    assert account.account_id is not None
    with app.test_client() as client:
        yield ClaimHarness(
            oauth, account, services, signer, account_proof(signer, account.account_id), guest_token, client
        )


def save_choices(
    harness: ClaimHarness, identity: WebConnectionContext, connection_id: str, conversation_id: str | None = None
) -> str:
    run_id = str(uuid4())
    harness.oauth.base.repository.save_run_selections(
        ConnectionExecutionContext(
            tenant_id=identity.tenant_id,
            app_id=identity.app_id,
            end_user_id=identity.end_user_id,
            account_id=identity.account_id,
            workflow_id=harness.oauth.base.workflow_id,
            connection_revision=harness.oauth.base.connection_revision,
            selections=(
                ExecutionConnectionSelection(node_id="tool-1", provider=PROVIDER, connection_id=connection_id),
            ),
        ),
        run_id,
        conversation_id,
        update_conversation=conversation_id is not None,
    )
    return run_id


@pytest.mark.parametrize("credential_type", ["api-key", "oauth2"])
@pytest.mark.parametrize("account_defaults", [False, True])
def test_claim_preserves_credentials_ids_and_independent_choices(
    harness: ClaimHarness, credential_type: str, account_defaults: bool, config_overrides: Callable[..., None]
) -> None:
    base = harness.oauth.base
    existing = base.service.create_api_key(harness.account, base.command())
    account_run = save_choices(harness, harness.account, existing.id) if account_defaults else None
    first = (
        harness.oauth.finish(harness.oauth.start())
        if credential_type == "oauth2"
        else base.service.create_api_key(base.context, base.command())
    )
    second = base.service.create_api_key(base.context, base.command("second-secret"))
    with base.sessions.begin() as session:
        conversations = [
            Conversation(
                app_id=base.context.app_id,
                mode=AppMode.ADVANCED_CHAT,
                name="Guest chat",
                from_source=ConversationFromSource.API,
                from_end_user_id=base.context.end_user_id,
                from_account_id=None,
                invoke_from=InvokeFrom.WEB_APP,
                _inputs={},
                is_deleted=False,
            )
            for _ in range(2)
        ]
        session.add_all(conversations)
        session.flush()
        ids = [row.id for row in conversations]
    save_choices(harness, base.context, first.id, ids[0])
    guest_run = save_choices(harness, base.context, second.id, ids[1])
    with base.sessions() as session:
        before = {
            row.id: (
                row.encrypted_credentials,
                row.revision,
                row.last_active_at,
                row.oauth_client_id,
                row.account_label,
                row.oauth_client_fingerprint,
                row.oauth_plugin_unique_identifier,
            )
            for row in session.scalars(sa.select(EndUserConnection))
            if row.id in (first.id, second.id)
        }
        session_refs = [
            (row.id, row.session_id, row.connection_id) for row in session.scalars(sa.select(SessionConnection))
        ]
    checks, exchanges = len(base.auth.calls), harness.oauth.handler.exchanges
    config_overrides(END_USER_AUTH_ALLOW_ANONYMOUS=False)
    preview = harness.client.post("/api/connections/claimable-passports", json={"passports": [harness.guest_passport]})
    assert preview.status_code == 200
    assert preview.get_json()["data"][0]["connection_count"] == 2
    response = harness.claim()
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.get_json()["data"][0]["claimed_connections"] == 2
    assert set(response.get_json()) == {"data"}
    assert response.get_json()["data"][0]["status"] == "success"
    claims = harness.signer.verify(response.get_json()["data"][0]["access_token"])
    assert claims["end_user_id"] == harness.account.end_user_id
    assert claims["end_user_id"] != base.context.end_user_id
    assert harness.account.account_id not in claims.values()
    assert len(base.auth.calls) == checks
    assert harness.oauth.handler.exchanges == exchanges
    with base.sessions() as session:
        for connection_id, (ciphertext, revision, activity, client_id, label, fingerprint, artifact) in before.items():
            row = session.get(EndUserConnection, connection_id)
            assert row is not None
            assert (row.account_id, row.end_user_id) == (harness.account.account_id, None)
            assert (
                row.encrypted_credentials,
                row.revision,
                row.last_active_at,
                row.oauth_client_id,
                row.account_label,
                row.oauth_client_fingerprint,
                row.oauth_plugin_unique_identifier,
            ) == (ciphertext, revision + 1, activity, client_id, label, fingerprint, artifact)
        assert [
            (row.id, row.session_id, row.connection_id) for row in session.scalars(sa.select(SessionConnection))
        ] == session_refs
        for conversation_id in ids:
            conversation = session.get(Conversation, conversation_id)
            assert conversation is not None
            assert conversation.from_end_user_id == base.context.end_user_id
        defaults = list(session.scalars(sa.select(AppConnection)))
        assert len(defaults) == 1
        assert defaults[0].end_user_id == harness.account.end_user_id
        assert defaults[0].connection_id == (existing.id if account_defaults else second.id)
        assert defaults[0].source_run_id == (account_run if account_defaults else guest_run)
    assert base.service.get_connection(harness.account, first.id).id == first.id
    assert harness.claim().get_json()["data"][0]["claimed_connections"] == 0
    config_overrides(END_USER_AUTH_ALLOW_ANONYMOUS=True)
    denied = harness.client.get(f"/api/connections/{first.id}", headers=harness.headers())
    assert denied.status_code == 404
    assert denied.get_json()["code"] == "connection_not_found"
    assert harness.client.get("/api/connections", headers=harness.headers()).get_json()["data"] == []
    assert harness.client.get("/api/connections/configuration", headers=harness.headers()).status_code == 200
    created = base.service.create_api_key(base.context, base.command("new-guest-secret"))
    assert base.service.get_connection(base.context, created.id).id == created.id
    with base.sessions() as session:
        stored = session.get(EndUserConnection, first.id)
        assert stored is not None
        assert stored.revision == before[first.id][1] + 1


def test_retries_and_other_accounts_cannot_reclaim_transferred_connections(harness: ClaimHarness) -> None:
    base = harness.oauth.base
    with base.sessions.begin() as session:
        other = Account(name="Other", email=f"{uuid4()}@example.com", status=AccountStatus.ACTIVE)
        session.add(other)
        session.flush()
        other_id = other.id
        guest = EndUser(
            tenant_id=base.context.tenant_id,
            app_id=base.context.app_id,
            type=EndUserType.BROWSER,
            account_id=None,
            session_id=str(uuid4()),
        )
        session.add(guest)
        session.flush()
        other_guest = replace(base.context, end_user_id=guest.id)
    untouched = base.service.create_api_key(other_guest, base.command())
    transferred = base.service.create_api_key(base.context, base.command())
    assert harness.claim().get_json()["data"][0]["claimed_connections"] == 1
    assert harness.claim().get_json()["data"][0]["claimed_connections"] == 0
    response = harness.client.post(
        "/api/connections/claim",
        json={"passports": [harness.guest_passport]},
        headers={"Authorization": f"Bearer {account_proof(harness.signer, other_id)}"},
    )
    assert response.status_code == 200
    assert response.get_json()["data"][0]["claimed_connections"] == 0
    assert base.service.get_connection(harness.account, transferred.id).id == transferred.id
    assert base.service.get_connection(other_guest, untouched.id).id == untouched.id


@pytest.mark.parametrize(
    "failure",
    [
        "missing_account",
        "expired_account",
        "unavailable_account",
        "guest_as_account",
        "console_as_account",
        "expired_guest",
        "account_as_guest",
        "wrong_app",
        "authority_payload",
        "handoff_payload",
    ],
)
def test_claim_requires_both_valid_scoped_identities(harness: ClaimHarness, failure: str) -> None:
    headers = harness.headers()
    passports = [harness.guest_passport]
    payload: dict[str, object] = {"passports": passports}
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    if failure == "missing_account":
        headers.pop("Authorization")
    elif failure == "expired_account":
        headers["Authorization"] = (
            f"Bearer {account_proof(harness.signer, harness.account.account_id or '', expired=True)}"
        )
    elif failure == "unavailable_account":
        with base.sessions.begin() as session:
            session.execute(
                sa.update(Account).where(Account.id == harness.account.account_id).values(status=AccountStatus.BANNED)
            )
    elif failure == "guest_as_account":
        headers["Authorization"] = f"Bearer {harness.guest_passport}"
    elif failure == "console_as_account":
        token = harness.signer.issue(
            {
                "sub": "Console API Passport",
                "user_id": harness.account.account_id,
                "exp": int((datetime.now(UTC) + timedelta(hours=1)).timestamp()),
            }
        )
        headers["Authorization"] = f"Bearer {token}"
    elif failure == "expired_guest":
        claims = harness.signer.verify(harness.guest_passport)
        claims["exp"] = 1
        passports[0] = harness.signer.issue(claims)
    elif failure == "account_as_guest":
        passports[0] = harness.services.web_passport.issue_for_account(
            app_code=harness.oauth.app_code, access_token=harness.proof
        ).access_token
    elif failure == "wrong_app":
        passports[0] = harness.signer.issue({**harness.signer.verify(harness.guest_passport), "app_code": "other-app"})
    elif failure == "handoff_payload":
        payload.update(login_code="untrusted-secret", code_verifier="v" * 43)
    else:
        payload["account_id"] = "untrusted-secret"
    response = harness.client.post("/api/connections/claim", headers=headers, json=payload)
    if failure in {"authority_payload", "handoff_payload"}:
        assert response.status_code == 422
    elif failure in {"expired_guest", "account_as_guest", "wrong_app"}:
        assert response.status_code == 400
        assert response.get_json()["code"] == "connection_claim_preflight_failed"
        item = response.get_json()["details"]["failures"][0]
        assert item["status"] == "failed"
        assert item["error"]["status"] == (404 if failure == "wrong_app" else 401)
    else:
        assert response.status_code == 401
        assert harness.proof not in response.get_data(as_text=True)
    assert base.service.get_connection(base.context, selected.id).id == selected.id


def test_guest_check_cannot_write_credentials_after_claim(harness: ClaimHarness) -> None:
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    base.auth.on_check = lambda: harness.services.end_user_connection_claims.claim(
        [harness.guest_passport], access_token=harness.proof
    )
    with pytest.raises(ConnectionConflictError):
        base.service.check_connection(base.context, selected.id, connection_revision=base.connection_revision)
    assert base.service.get_connection(harness.account, selected.id).id == selected.id


def test_claim_rolls_back_owner_and_default_changes_together(harness: ClaimHarness) -> None:
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    save_choices(harness, base.context, selected.id)
    engine = base.sessions.kw["bind"]

    def fail_defaults(
        _connection: object, _cursor: object, statement: str, _parameters: object, _context: object, _executemany: bool
    ) -> None:
        if statement.startswith("UPDATE app_connections"):
            raise RuntimeError("defaults unavailable")

    event.listen(engine, "before_cursor_execute", fail_defaults)
    try:
        response = harness.claim()
        assert response.status_code == 200
        item = response.get_json()["data"][0]
        assert item["status"] == "failed"
        assert item["error"]["code"] == "connection_claim_unavailable"
        assert item["error"]["status"] == 503
        assert "defaults unavailable" not in response.get_data(as_text=True)
    finally:
        event.remove(engine, "before_cursor_execute", fail_defaults)
    assert base.service.get_connection(base.context, selected.id).id == selected.id
    with base.sessions() as session:
        assert session.scalar(sa.select(AppConnection.end_user_id)) == base.context.end_user_id


def test_login_is_exchanged_before_delayed_claim_confirmation(
    harness: ClaimHarness, redis_transport: tuple[RedisClientWrapper, MagicMock]
) -> None:
    redis, commands = redis_transport
    records: dict[str, str] = {}

    def execute(command: str, *args: object, **_kwargs: object) -> object:
        key = str(args[0])
        if command == "SET":
            records[key] = str(args[1])
            return True
        if command == "GET":
            return records.get(key)
        if command == "GETDEL":
            return records.pop(key, None)
        raise AssertionError(command)

    commands.side_effect = execute
    services = harness.services
    clock = [datetime.now(UTC)]
    services.web_login_handoff = WebLoginHandoffService(
        grants=RedisWebLoginGrantStore(redis=redis),
        apps=WebPassportRepository(
            session_factory=harness.oauth.base.sessions, generate_session_id=lambda: str(uuid4())
        ),
        identities=services.web_identity,
        tokens=PassportTokenGateway(passport=harness.signer),
        enabled=True,
        app_web_url="https://apps.example.net",
        console_web_url="https://console.example.com",
        now=lambda: clock[0],
    )
    console_token = harness.signer.issue(
        {
            "sub": "Console API Passport",
            "user_id": harness.account.account_id,
            "exp": int((datetime.now(UTC) + timedelta(hours=1)).timestamp()),
        }
    )
    harness.client.set_cookie("__Host-access_token", console_token, domain="console.example.com", secure=True)
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    with base.sessions.begin() as session:
        app = App(
            tenant_id=base.context.tenant_id, name="Login App", mode=AppMode.WORKFLOW, enable_site=True, enable_api=True
        )
        session.add(app)
        session.flush()
        workflow = Workflow(
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=WorkflowType.WORKFLOW,
            version="published",
            graph='{"nodes": [], "edges": []}',
            _features="{}",
            created_by=harness.account.account_id or "",
        )
        login_app_code = f"login-{uuid4()}"
        session.add_all(
            [
                workflow,
                Site(
                    app_id=app.id,
                    code=login_app_code,
                    title="Login App",
                    default_language="en-US",
                    customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
                ),
            ]
        )
        session.flush()
        app.workflow_id = workflow.id
    verifier = "v" * 43
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    response = harness.client.get(
        "/console/api/login",
        base_url="https://console.example.com",
        query_string={
            "app_code": login_app_code,
            "redirect_url": f"https://apps.example.net/workflow/{login_app_code}",
            "code_challenge": challenge,
        },
    )
    assert response.status_code == 200
    code = parse_qs(urlsplit(response.get_json()["redirect_url"]).query)["login_code"][0]
    login_payload = {"login_code": code, "code_verifier": verifier}
    response = harness.client.post(
        "/api/passport", base_url="https://apps.example.net", headers={"X-App-Code": login_app_code}, json=login_payload
    )
    assert response.status_code == 200
    proof = response.get_json()["webapp_access_token"]
    assert harness.signer.verify(proof)["token_source"] == "webapp_account_login"
    assert harness.signer.verify(response.get_json()["access_token"])["app_code"] == login_app_code
    assert harness.client.get_cookie("__Host-access_token", domain="apps.example.net") is None
    assert base.service.get_connection(base.context, selected.id).id == selected.id
    clock[0] += timedelta(minutes=5)
    response = harness.client.post(
        "/api/connections/claim",
        base_url="https://apps.example.net",
        headers={"Authorization": f"Bearer {proof}"},
        json={"passports": [harness.guest_passport, harness.guest_passport]},
    )
    assert response.status_code == 200
    assert set(response.get_json()) == {"data"}
    assert [item["status"] for item in response.get_json()["data"]] == ["success", "success"]
    assert [item["claimed_connections"] for item in response.get_json()["data"]] == [1, 0]
    assert (
        harness.signer.verify(response.get_json()["data"][0]["access_token"])["end_user_id"]
        == harness.account.end_user_id
    )
    assert base.service.get_connection(harness.account, selected.id).id == selected.id
    replay = harness.client.post(
        "/api/passport", base_url="https://apps.example.net", headers={"X-App-Code": login_app_code}, json=login_payload
    )
    assert replay.status_code == 400


def test_claimed_oauth_connection_refreshes_for_account_without_reauthorization(harness: ClaimHarness) -> None:
    selected = harness.oauth.finish(harness.oauth.start())
    assert harness.claim().status_code == 200
    with harness.oauth.base.sessions.begin() as session:
        session.execute(
            sa.update(EndUserConnection)
            .where(EndUserConnection.id == selected.id)
            .values(expires_at=datetime(2000, 1, 1))
        )
    checked = harness.oauth.base.service.check_connection(
        harness.account,
        selected.id,
        connection_revision=harness.oauth.base.service.get_connection_revision(
            harness.account, selected.id
        ).connection_revision,
    )
    assert checked.connection_id == selected.id
    assert checked.check.status == "valid"
    assert harness.oauth.handler.exchanges == 1
    assert len(harness.oauth.handler.refreshes) == 1


def test_claim_creates_account_app_identity_on_first_visit(harness: ClaimHarness) -> None:
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    with base.sessions.begin() as session:
        session.execute(sa.delete(EndUser).where(EndUser.id == harness.account.end_user_id))
    response = harness.claim()
    assert response.status_code == 200
    target_id = harness.signer.verify(response.get_json()["data"][0]["access_token"])["end_user_id"]
    assert target_id != harness.account.end_user_id
    assert target_id != base.context.end_user_id
    with base.sessions() as session:
        target = session.get(EndUser, target_id)
        assert target is not None
        assert target.account_id == harness.account.account_id
        assert target.app_id == base.context.app_id
        record = session.get(EndUserConnection, selected.id)
        assert record is not None
        assert record.account_id == target.account_id
        assert (
            session.scalar(
                sa.select(sa.func.count())
                .select_from(EndUserConnectionRevisionAcceptance)
                .where(EndUserConnectionRevisionAcceptance.end_user_id == target.id)
            )
            == 0
        )
        guest_acceptance_count = session.scalar(
            sa.select(sa.func.count())
            .select_from(EndUserConnectionRevisionAcceptance)
            .where(EndUserConnectionRevisionAcceptance.end_user_id == base.context.end_user_id)
        )
        assert guest_acceptance_count is not None
        assert guest_acceptance_count > 0


def test_discovery_and_batch_claim_are_scoped_across_apps(
    harness: ClaimHarness, monkeypatch: pytest.MonkeyPatch
) -> None:
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    with base.sessions.begin() as session:
        app = App(tenant_id=str(uuid4()), name="Another App", mode=AppMode.WORKFLOW, enable_site=True, enable_api=True)
        session.add(app)
        session.flush()
        site = Site(
            app_id=app.id,
            code=f"claim-{uuid4()}",
            title="Another App",
            default_language="en-US",
            customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
        )
        workflow = Workflow(
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=WorkflowType.WORKFLOW,
            version="published",
            graph='{"nodes": [], "edges": []}',
            _features="{}",
            created_by=harness.account.account_id or "",
        )
        session.add(workflow)
        session.flush()
        app.workflow_id = workflow.id
        guest = EndUser(tenant_id=app.tenant_id, app_id=app.id, type=EndUserType.BROWSER, session_id=str(uuid4()))
        session.add_all([site, guest])
        session.flush()
        session.add(
            EndUserConnection(
                tenant_id=app.tenant_id,
                end_user_id=guest.id,
                account_id=None,
                provider=PROVIDER,
                name="Other Guest connection",
                credential_type=ConnectionCredentialType.API_KEY,
                encrypted_credentials="other-ciphertext",
                status=ConnectionCredentialStatus.CONNECTED,
                oauth_client_source=None,
                oauth_client_configuration_id=None,
                oauth_client_id=None,
                expires_at=None,
            )
        )
        other_token = harness.signer.issue(
            {"sub": "Web API Passport", "app_id": app.id, "app_code": site.code, "end_user_id": guest.id}
        )
        other_code = site.code
        before = session.scalar(sa.select(sa.func.count()).select_from(EndUser))
    claims = harness.signer.verify(harness.guest_passport)
    expired = harness.signer.issue({**claims, "exp": 1})
    wrong_scope = harness.signer.issue({**claims, "app_code": other_code})
    payload = {
        "passports": [
            "invalid",
            expired,
            harness.proof,
            wrong_scope,
            harness.guest_passport,
            other_token,
            harness.guest_passport,
        ]
    }
    response = harness.client.post("/api/connections/claimable-passports", json=payload)
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    data = response.get_json()["data"]
    assert data == [
        {"index": 4, "app_code": harness.oauth.app_code, "app_name": "App", "connection_count": 1},
        {"index": 5, "app_code": other_code, "app_name": "Another App", "connection_count": 1},
    ]
    assert harness.guest_passport not in response.get_data(as_text=True)
    with base.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUser)) == before
    assert base.service.get_connection(base.context, selected.id).id == selected.id
    response = harness.client.post(
        "/api/connections/claim",
        headers={"Authorization": f"Bearer {harness.proof}"},
        json={"passports": [harness.guest_passport, "invalid", other_token, expired]},
    )
    assert response.status_code == 400
    assert response.get_json()["code"] == "connection_claim_preflight_failed"
    failures = response.get_json()["details"]["failures"]
    assert [item["index"] for item in failures] == [1, 3]
    assert all(item["error"]["code"] == "unauthorized" for item in failures)
    assert base.service.get_connection(base.context, selected.id).id == selected.id
    with base.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUser)) == before

    auth = harness.services.web_passport._auth
    with monkeypatch.context() as patch:
        patch.setattr(auth, "is_webapp_auth_enabled", lambda: True)
        patch.setattr(
            auth,
            "get_app_auth_type",
            lambda app_id: WebAppAuthType.PUBLIC if app_id == base.context.app_id else WebAppAuthType.INTERNAL,
        )
        patch.setattr(auth, "is_account_allowed", lambda _app, _account: False)
        response = harness.client.post(
            "/api/connections/claim",
            headers={"Authorization": f"Bearer {harness.proof}"},
            json={"passports": [harness.guest_passport, other_token]},
        )
    assert response.status_code == 400
    failures = response.get_json()["details"]["failures"]
    assert len(failures) == 1
    assert failures[0]["index"] == 1
    assert failures[0]["error"]["code"] == "web_app_access_denied"
    assert base.service.get_connection(base.context, selected.id).id == selected.id
    with base.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUser)) == before

    response = harness.client.post(
        "/api/connections/claim",
        headers={"Authorization": f"Bearer {harness.proof}"},
        json={"passports": [harness.guest_passport, other_token, harness.guest_passport]},
    )
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    items = response.get_json()["data"]
    assert [item["index"] for item in items] == [0, 1, 2]
    assert all(item["status"] == "success" for item in items)
    for index, app_code, count in ((0, harness.oauth.app_code, 1), (1, other_code, 1), (2, harness.oauth.app_code, 0)):
        assert items[index]["app_code"] == app_code
        assert items[index]["claimed_connections"] == count
        assert harness.signer.verify(items[index]["access_token"])["app_code"] == app_code
    assert base.service.get_connection(harness.account, selected.id).id == selected.id
    with base.sessions() as session:
        other = session.scalar(
            sa.select(EndUserConnection).where(EndUserConnection.tenant_id != base.context.tenant_id)
        )
        assert other is not None
        assert other.account_id == harness.account.account_id
        assert other.end_user_id is None
    assert harness.client.post(
        "/api/connections/claimable-passports", json={"passports": [harness.guest_passport]}
    ).get_json() == {
        "data": [{"index": 0, "app_code": harness.oauth.app_code, "app_name": "App", "connection_count": 0}]
    }


def test_zero_connection_guest_remains_claimable_for_future_conversation_migration(harness: ClaimHarness) -> None:
    base = harness.oauth.base
    with base.sessions.begin() as session:
        conversation = Conversation(
            app_id=base.context.app_id,
            mode=AppMode.ADVANCED_CHAT,
            name="Guest chat",
            from_source=ConversationFromSource.API,
            from_end_user_id=base.context.end_user_id,
            from_account_id=None,
            invoke_from=InvokeFrom.WEB_APP,
            _inputs={},
            is_deleted=False,
        )
        session.add(conversation)
        session.flush()
        conversation_id = conversation.id
    payload = {"passports": [harness.guest_passport, harness.guest_passport]}
    expected = {"data": [{"index": 0, "app_code": harness.oauth.app_code, "app_name": "App", "connection_count": 0}]}
    response = harness.client.post("/api/connections/claimable-passports", json=payload)
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.get_json() == expected
    result = harness.claim()
    assert result.status_code == 200
    assert result.get_json()["data"][0]["claimed_connections"] == 0
    assert harness.client.post("/api/connections/claimable-passports", json=payload).get_json() == expected
    with base.sessions() as session:
        stored = session.get(Conversation, conversation_id)
        assert stored is not None
        assert stored.from_end_user_id == base.context.end_user_id


@pytest.mark.parametrize(
    "unavailable",
    [
        "account",
        "sso",
        "disabled_app",
        "removed_app",
        "removed_site",
        "app_status",
        "site_status",
        "unpublished",
        "draft_workflow",
        "missing_workflow",
        "wrong_workflow_app",
        "wrong_workflow_tenant",
        "unsupported_mode",
        "wrong_owner",
    ],
)
def test_claimable_passports_omit_ineligible_identities(harness: ClaimHarness, unavailable: str) -> None:
    base = harness.oauth.base
    base.service.create_api_key(base.context, base.command())
    token = harness.guest_passport
    if unavailable == "account":
        token = harness.services.web_passport.issue_for_account(
            app_code=harness.oauth.app_code, access_token=harness.proof
        ).access_token
    elif unavailable == "sso":
        token = harness.signer.issue({**harness.signer.verify(token), "token_source": "webapp"})
    else:
        with base.sessions.begin() as session:
            if unavailable == "disabled_app":
                session.execute(sa.update(App).where(App.id == base.context.app_id).values(enable_site=False))
            elif unavailable == "removed_app":
                session.execute(sa.delete(App).where(App.id == base.context.app_id))
            elif unavailable == "removed_site":
                session.execute(sa.delete(Site).where(Site.app_id == base.context.app_id))
            elif unavailable == "app_status":
                session.execute(
                    sa.text("UPDATE apps SET status = :status WHERE id = :app_id"),
                    {"status": "disabled", "app_id": base.context.app_id},
                )
            elif unavailable == "site_status":
                session.execute(
                    sa.text("UPDATE sites SET status = :status WHERE app_id = :app_id"),
                    {"status": "disabled", "app_id": base.context.app_id},
                )
            elif unavailable == "unpublished":
                session.execute(sa.update(App).where(App.id == base.context.app_id).values(workflow_id=None))
            elif unavailable == "draft_workflow":
                session.execute(sa.update(Workflow).where(Workflow.id == base.workflow_id).values(version="draft"))
            elif unavailable == "missing_workflow":
                session.execute(sa.delete(Workflow).where(Workflow.id == base.workflow_id))
            elif unavailable == "wrong_workflow_app":
                session.execute(sa.update(Workflow).where(Workflow.id == base.workflow_id).values(app_id=str(uuid4())))
            elif unavailable == "wrong_workflow_tenant":
                session.execute(
                    sa.update(Workflow).where(Workflow.id == base.workflow_id).values(tenant_id=str(uuid4()))
                )
            elif unavailable == "unsupported_mode":
                session.execute(sa.update(App).where(App.id == base.context.app_id).values(mode=AppMode.CHAT))
            else:
                session.execute(
                    sa.update(EndUser).where(EndUser.id == base.context.end_user_id).values(tenant_id=str(uuid4()))
                )
    response = harness.client.post("/api/connections/claimable-passports", json={"passports": [token]})
    assert response.status_code == 200
    assert response.get_json() == {"data": []}


def test_claimable_passports_validate_batch_and_capability(
    harness: ClaimHarness, config_overrides: Callable[..., None]
) -> None:
    assert (
        harness.client.post("/api/connections/claimable-passports", json={"passports": ["candidate"] * 51}).status_code
        == 422
    )
    config_overrides(WEBAPP_ACCOUNT_PASSPORT_ENABLED=False)
    assert (
        harness.client.post(
            "/api/connections/claimable-passports", json={"passports": [harness.guest_passport]}
        ).status_code
        == 403
    )


def test_batch_retry_transfers_remaining_connections_only(harness: ClaimHarness) -> None:
    base = harness.oauth.base
    first = base.service.create_api_key(base.context, base.command())
    with base.sessions.begin() as session:
        guest = EndUser(
            tenant_id=base.context.tenant_id,
            app_id=base.context.app_id,
            type=EndUserType.BROWSER,
            session_id=str(uuid4()),
        )
        session.add(guest)
        session.flush()
        second_context = replace(base.context, end_user_id=guest.id)
    second = base.service.create_api_key(second_context, base.command("second-secret"))
    second_token = harness.signer.issue(
        {**harness.signer.verify(harness.guest_passport), "end_user_id": second_context.end_user_id}
    )
    engine = base.sessions.kw["bind"]

    def fail_second(
        _connection: object, _cursor: object, statement: str, parameters: object, _context: object, _executemany: bool
    ) -> None:
        if statement.startswith("UPDATE end_user_connections") and isinstance(parameters, tuple):
            if second_context.end_user_id in parameters:
                raise RuntimeError("private database failure")

    payload = {"passports": [harness.guest_passport, second_token, harness.guest_passport]}
    event.listen(engine, "before_cursor_execute", fail_second)
    try:
        response = harness.client.post(
            "/api/connections/claim",
            headers={"Authorization": f"Bearer {harness.proof}"},
            json=payload,
        )
    finally:
        event.remove(engine, "before_cursor_execute", fail_second)
    assert response.status_code == 200
    items = response.get_json()["data"]
    assert [item["status"] for item in items] == ["success", "failed", "success"]
    assert items[0]["claimed_connections"] == 1
    assert items[1]["error"]["code"] == "connection_claim_unavailable"
    assert items[2]["claimed_connections"] == 0
    assert "private database failure" not in response.get_data(as_text=True)
    assert base.service.get_connection(harness.account, first.id).id == first.id
    assert base.service.get_connection(second_context, second.id).id == second.id
    retry = harness.client.post(
        "/api/connections/claim",
        headers={"Authorization": f"Bearer {harness.proof}"},
        json=payload,
    )
    assert [item["claimed_connections"] for item in retry.get_json()["data"]] == [0, 1, 0]
    assert base.service.get_connection(harness.account, second.id).id == second.id
    newest = base.service.create_api_key(base.context, base.command("new-guest-secret"))
    again = harness.client.post(
        "/api/connections/claim", headers={"Authorization": f"Bearer {harness.proof}"}, json=payload
    )
    assert [item["claimed_connections"] for item in again.get_json()["data"]] == [1, 0, 0]
    assert base.service.get_connection(harness.account, newest.id).id == newest.id


@pytest.mark.parametrize("payload", [{"passports": []}, {"passports": ["candidate"] * 51}])
def test_claim_rejects_invalid_batch_sizes(harness: ClaimHarness, payload: dict[str, object]) -> None:
    assert (
        harness.client.post(
            "/api/connections/claim", headers={"Authorization": f"Bearer {harness.proof}"}, json=payload
        ).status_code
        == 422
    )


def test_claim_rejects_disabled_capability_before_any_transfer(
    harness: ClaimHarness, config_overrides: Callable[..., None]
) -> None:
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    config_overrides(WEBAPP_ACCOUNT_PASSPORT_ENABLED=False)
    assert harness.claim().status_code == 403
    assert base.service.get_connection(base.context, selected.id).id == selected.id


@pytest.mark.parametrize("auth_type", [WebAppAuthType.INTERNAL, WebAppAuthType.EXTERNAL])
def test_batch_claim_preserves_enterprise_app_admission(
    harness: ClaimHarness, monkeypatch: pytest.MonkeyPatch, auth_type: WebAppAuthType
) -> None:
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    auth = harness.services.web_passport._auth
    monkeypatch.setattr(auth, "is_webapp_auth_enabled", lambda: True)
    monkeypatch.setattr(auth, "get_app_auth_type", lambda _app: auth_type)
    monkeypatch.setattr(auth, "is_account_allowed", lambda _app, _account: False)
    response = harness.claim()
    assert response.status_code == 400
    assert response.get_json()["code"] == "connection_claim_preflight_failed"
    item = response.get_json()["details"]["failures"][0]
    assert item["status"] == "failed"
    assert item["error"]["code"] == (
        "web_app_access_denied" if auth_type == WebAppAuthType.INTERNAL else "end_user_login_required"
    )
    assert base.service.get_connection(base.context, selected.id).id == selected.id


def test_preflight_dependency_failure_starts_no_transfer(harness: ClaimHarness) -> None:
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    engine = base.sessions.kw["bind"]

    def fail_preflight(
        _connection: object, _cursor: object, statement: str, _parameters: object, _context: object, _executemany: bool
    ) -> None:
        if statement.startswith("SELECT apps.tenant_id, apps.name, count(end_user_connections.id)"):
            raise RuntimeError("private database failure")

    event.listen(engine, "before_cursor_execute", fail_preflight)
    try:
        response = harness.claim()
    finally:
        event.remove(engine, "before_cursor_execute", fail_preflight)
    assert response.status_code == 503
    assert response.get_json()["code"] == "connection_claim_unavailable"
    assert "private database failure" not in response.get_data(as_text=True)
    assert base.service.get_connection(base.context, selected.id).id == selected.id
