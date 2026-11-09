"""Guest migration through real Passport verification and transactional persistence."""

import base64
import hashlib
from collections.abc import Callable, Iterator
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest
import sqlalchemy as sa
from flask import Flask
from flask.testing import FlaskClient
from redis.client import Pipeline
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.test import TestResponse

from constants.end_user_connections import ConnectionCredentialStatus, ConnectionCredentialType
from controllers.console import bp as console_bp
from controllers.console import wraps as console_wraps
from controllers.console.auth import login as console_login
from controllers.web import bp, connections, migration, passport, wraps
from core.app.app_config.entities import (
    AppAdditionalFeatures,
    EasyUIBasedAppConfig,
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.app.entities.app_invoke_entities import ChatAppGenerateEntity
from core.app.entities.app_invoke_entities import InvokeFrom as AppInvokeFrom
from extensions.ext_redis import RedisClientWrapper, redis_client
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
from repositories.web_migration_repository import WebMigrationRepository
from repositories.web_passport_repository import WebPassportRepository
from services.app_task_service import AppTaskControlService
from services.end_user_connections.entities import WebConnectionContext
from services.end_user_connections.errors import ConnectionConflictError
from services.end_user_connections.management import ConnectionService
from services.end_user_connections.selections import ConnectionSelectionService, SaveConnectionConfigurationInput
from services.entities.passport_entities import WebPassportRequest
from services.web_identity_service import WebIdentityService
from services.web_login_handoff import WebLoginHandoffService
from services.web_login_handoff_adapters import RedisWebLoginGrantStore
from services.web_migration_service import WebMigrationService
from services.web_passport_gateways import DeploymentWebPassportAuthGateway, PassportTokenGateway
from services.web_passport_service import WebAppAuthType, WebPassportService
from tests.helpers.end_user_api_key import PROVIDER
from tests.helpers.end_user_conversation import make_selection_service
from tests.helpers.end_user_oauth import OAuthHarness, make_oauth_harness
from tests.helpers.unit.core.model_fixtures import make_model_config


@dataclass
class MigrationServices:
    connection_selections: ConnectionSelectionService
    web_identity: WebIdentityService
    web_passport: WebPassportService
    end_user_connections: ConnectionService
    web_migration: WebMigrationService
    web_login_handoff: WebLoginHandoffService


@dataclass
class ClaimHarness:
    oauth: OAuthHarness
    account: WebConnectionContext
    services: MigrationServices
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
            "/api/migration/claim",
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
    redis_transport: tuple[RedisClientWrapper, MagicMock],
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
    from services import app_task_service, web_migration_service

    def execute_pipeline(pipeline: "Pipeline[bytes]") -> list[object]:
        for command, _options in pipeline.command_stack:
            redis_transport[1](*command)
        pipeline.command_stack.clear()
        return []

    monkeypatch.setattr(Pipeline, "execute", execute_pipeline)
    monkeypatch.setattr(type(app_task_service.db), "engine", property(lambda _: sqlite_session_factory.kw["bind"]))
    oauth = make_oauth_harness(sqlite_session_factory, monkeypatch)

    def finish_cancelled_runs(_delay: float) -> None:
        from graphon.enums import WorkflowExecutionStatus
        from models.workflow import WorkflowRun

        with sqlite_session_factory.begin() as session:
            session.execute(
                sa.update(WorkflowRun)
                .where(
                    WorkflowRun.status == WorkflowExecutionStatus.RUNNING,
                    WorkflowRun.stop_requested_at.is_not(None),
                )
                .values(status=WorkflowExecutionStatus.STOPPED, finished_at=datetime.now(UTC))
            )

    monkeypatch.setattr(web_migration_service, "sleep", finish_cancelled_runs)
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
    services = MigrationServices(
        connection_selections=make_selection_service(oauth),
        web_identity=identity,
        web_passport=passports,
        end_user_connections=oauth.base.service,
        web_migration=WebMigrationService(
            store=WebMigrationRepository(session_factory=sqlite_session_factory),
            passports=passports,
            tokens=tokens,
            identities=identity,
            tasks=AppTaskControlService(redis_client=redis_transport[0]),
        ),
        web_login_handoff=WebLoginHandoffService(
            grants=RedisWebLoginGrantStore(redis=redis_client),
            apps=WebPassportRepository(
                session_factory=sqlite_session_factory, generate_session_id=lambda: str(uuid4())
            ),
            identities=identity,
            tokens=tokens,
            enabled=True,
            app_web_url="https://apps.example.net",
            console_web_url="https://console.example.com",
            now=lambda: datetime.now(UTC),
        ),
    )
    for module in (wraps, migration, connections, passport, console_login):
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
) -> None:
    harness.services.connection_selections.save(
        identity,
        SaveConnectionConfigurationInput.model_validate(
            {
                "connection_revision": harness.oauth.base.connection_revision,
                "conversation_id": conversation_id,
                "connections": {"tool-1": connection_id},
            }
        ),
    )


@pytest.mark.parametrize("credential_type", ["api-key", "oauth2"])
@pytest.mark.parametrize("account_defaults", [False, True])
def test_claim_preserves_credentials_ids_and_independent_choices(
    harness: ClaimHarness, credential_type: str, account_defaults: bool, config_overrides: Callable[..., None]
) -> None:
    base = harness.oauth.base
    existing = base.service.create_api_key(harness.account, base.command())
    if account_defaults:
        save_choices(harness, harness.account, existing.id)
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
    save_choices(harness, base.context, second.id, ids[1])
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
    preview = harness.client.post("/api/migration/claimable-passports", json={"passports": [harness.guest_passport]})
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
            assert conversation.from_end_user_id == harness.account.end_user_id
        defaults = list(session.scalars(sa.select(AppConnection)))
        assert len(defaults) == 1
        assert defaults[0].end_user_id == harness.account.end_user_id
        assert defaults[0].connection_id == (existing.id if account_defaults else second.id)
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
        "/api/migration/claim",
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
    response = harness.client.post("/api/migration/claim", headers=headers, json=payload)
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

    def claim_during_check() -> None:
        harness.services.web_migration.claim([harness.guest_passport], access_token=harness.proof)

    base.auth.on_check = claim_during_check
    with pytest.raises(ConnectionConflictError):
        base.service.check_connection_result(base.context, selected.id, connection_revision=base.connection_revision)
    assert base.service.get_connection(harness.account, selected.id).id == selected.id


def test_claim_rolls_back_owner_and_default_changes_together(harness: ClaimHarness) -> None:
    from models.model import UploadFile

    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    conversation_id, _, _, upload_id = persist_migration_history(harness, base.context)
    save_choices(harness, base.context, selected.id, conversation_id)
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
        assert (
            session.scalar(sa.select(Conversation.from_end_user_id).where(Conversation.id == conversation_id))
            == base.context.end_user_id
        )
        assert (
            session.scalar(sa.select(UploadFile.created_by).where(UploadFile.id == upload_id))
            == base.context.end_user_id
        )


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
    assert set(response.get_json()) == {"access_token"}
    login_cookie = harness.client.get_cookie("__Host-webapp_access_token", domain="apps.example.net")
    assert login_cookie is not None
    assert login_cookie.http_only
    assert login_cookie.secure
    assert harness.signer.verify(login_cookie.value)["token_source"] == "webapp_account_login"
    assert harness.signer.verify(response.get_json()["access_token"])["app_code"] == login_app_code
    assert harness.client.get_cookie("__Host-access_token", domain="apps.example.net") is None
    assert base.service.get_connection(base.context, selected.id).id == selected.id
    clock[0] += timedelta(minutes=5)
    response = harness.client.post(
        "/api/migration/claim",
        base_url="https://apps.example.net",
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
    checked = harness.oauth.base.service.check_connection_result(
        harness.account,
        selected.id,
        connection_revision=harness.oauth.base.service.get_connection_revision(
            harness.account, selected.id
        ).connection_revision,
    )
    assert checked.view.connection_id == selected.id
    assert checked.view.check.status == "valid"
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
    response = harness.client.post("/api/migration/claimable-passports", json=payload)
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    data = response.get_json()["data"]
    assert data == [
        {
            "index": 4,
            "app_code": harness.oauth.app_code,
            "app_name": "App",
            "connection_count": 1,
            "conversation_count": 0,
        },
        {"index": 5, "app_code": other_code, "app_name": "Another App", "connection_count": 1, "conversation_count": 0},
    ]
    assert harness.guest_passport not in response.get_data(as_text=True)
    with base.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(EndUser)) == before
    assert base.service.get_connection(base.context, selected.id).id == selected.id
    response = harness.client.post(
        "/api/migration/claim",
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
            "/api/migration/claim",
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
        "/api/migration/claim",
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
        "/api/migration/claimable-passports", json={"passports": [harness.guest_passport]}
    ).get_json() == {
        "data": [
            {
                "index": 0,
                "app_code": harness.oauth.app_code,
                "app_name": "App",
                "connection_count": 0,
                "conversation_count": 0,
            }
        ]
    }


def test_zero_connection_guest_migrates_conversations(harness: ClaimHarness) -> None:
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
    expected = {
        "data": [
            {
                "index": 0,
                "app_code": harness.oauth.app_code,
                "app_name": "App",
                "connection_count": 0,
                "conversation_count": 1,
            }
        ]
    }
    response = harness.client.post("/api/migration/claimable-passports", json=payload)
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.get_json() == expected
    result = harness.claim()
    assert result.status_code == 200
    assert result.get_json()["data"][0]["claimed_connections"] == 0
    assert result.get_json()["data"][0]["claimed_conversations"] == 1
    expected["data"][0]["conversation_count"] = 0
    assert harness.client.post("/api/migration/claimable-passports", json=payload).get_json() == expected
    with base.sessions() as session:
        stored = session.get(Conversation, conversation_id)
        assert stored is not None
        assert stored.from_end_user_id == harness.account.end_user_id


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
                session.execute(sa.update(App).where(App.id == base.context.app_id).values(mode=AppMode.COMPLETION))
            else:
                session.execute(
                    sa.update(EndUser).where(EndUser.id == base.context.end_user_id).values(tenant_id=str(uuid4()))
                )
    response = harness.client.post("/api/migration/claimable-passports", json={"passports": [token]})
    assert response.status_code == 200
    assert response.get_json() == {"data": []}


def test_claimable_passports_validate_batch_and_capability(
    harness: ClaimHarness, config_overrides: Callable[..., None]
) -> None:
    assert (
        harness.client.post("/api/migration/claimable-passports", json={"passports": ["candidate"] * 51}).status_code
        == 422
    )
    config_overrides(WEBAPP_ACCOUNT_PASSPORT_ENABLED=False)
    assert (
        harness.client.post(
            "/api/migration/claimable-passports", json={"passports": [harness.guest_passport]}
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
            "/api/migration/claim",
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
        "/api/migration/claim",
        headers={"Authorization": f"Bearer {harness.proof}"},
        json=payload,
    )
    assert [item["claimed_connections"] for item in retry.get_json()["data"]] == [0, 1, 0]
    assert base.service.get_connection(harness.account, second.id).id == second.id
    newest = base.service.create_api_key(base.context, base.command("new-guest-secret"))
    again = harness.client.post(
        "/api/migration/claim", headers={"Authorization": f"Bearer {harness.proof}"}, json=payload
    )
    assert [item["claimed_connections"] for item in again.get_json()["data"]] == [1, 0, 0]
    assert base.service.get_connection(harness.account, newest.id).id == newest.id


@pytest.mark.parametrize("payload", [{"passports": []}, {"passports": ["candidate"] * 51}])
def test_claim_rejects_invalid_batch_sizes(harness: ClaimHarness, payload: dict[str, object]) -> None:
    assert (
        harness.client.post(
            "/api/migration/claim", headers={"Authorization": f"Bearer {harness.proof}"}, json=payload
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
        if statement.startswith("SELECT apps.tenant_id, apps.name"):
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


def persist_migration_history(harness: ClaimHarness, owner: WebConnectionContext) -> tuple[str, str, str, str]:
    from graphon.enums import WorkflowExecutionStatus
    from graphon.variables import StringVariable
    from models.enums import CreatorUserRole, FeedbackFromSource, FeedbackRating, WorkflowRunTriggeredFrom
    from models.model import Message, MessageFeedback
    from models.web import PinnedConversation, SavedMessage
    from models.workflow import ConversationVariable, WorkflowRun
    from tests.helpers.unit.model_factories import make_upload_file

    with harness.oauth.base.sessions.begin() as session:
        upload = make_upload_file(
            tenant_id=owner.tenant_id, created_by=owner.end_user_id, created_by_role=CreatorUserRole.END_USER
        )
        session.add(upload)
        session.flush()
        conversation = Conversation(
            app_id=owner.app_id,
            mode=AppMode.ADVANCED_CHAT,
            name="Migrated history",
            from_source=ConversationFromSource.API,
            from_end_user_id=owner.end_user_id,
            from_account_id=None,
            invoke_from=InvokeFrom.WEB_APP,
            _inputs={"attachment": {"transfer_method": "local_file", "upload_file_id": upload.id}},
            is_deleted=False,
        )
        run = WorkflowRun(
            id=str(uuid4()),
            task_id=str(uuid4()),
            tenant_id=owner.tenant_id,
            app_id=owner.app_id,
            workflow_id=harness.oauth.base.workflow_id,
            type=WorkflowType.CHAT,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            version="published",
            graph='{"nodes": [], "edges": []}',
            inputs="{}",
            outputs="{}",
            status=WorkflowExecutionStatus.SUCCEEDED,
            finished_at=datetime.now(UTC),
            error=None,
            elapsed_time=0,
            total_tokens=0,
            total_steps=0,
            created_by_role=CreatorUserRole.END_USER,
            created_by=owner.end_user_id,
        )
        session.add_all([conversation, run])
        session.flush()
        message = Message(
            app_id=owner.app_id,
            conversation_id=conversation.id,
            query="hello",
            message="",
            answer="original",
            from_source=ConversationFromSource.API,
            from_end_user_id=owner.end_user_id,
            from_account_id=None,
            invoke_from=InvokeFrom.WEB_APP,
            workflow_run_id=run.id,
        )
        session.add(message)
        session.flush()
        session.add_all(
            [
                PinnedConversation(
                    app_id=owner.app_id,
                    conversation_id=conversation.id,
                    created_by_role=CreatorUserRole.END_USER,
                    created_by=owner.end_user_id,
                ),
                ConversationVariable.from_variable(
                    app_id=owner.app_id,
                    conversation_id=conversation.id,
                    variable=StringVariable(name="remembered", value="state", selector=["conversation", "remembered"]),
                ),
                MessageFeedback(
                    app_id=owner.app_id,
                    conversation_id=conversation.id,
                    message_id=message.id,
                    rating=FeedbackRating.LIKE,
                    from_source=FeedbackFromSource.USER,
                    from_end_user_id=owner.end_user_id,
                    from_account_id=None,
                ),
                SavedMessage(
                    app_id=owner.app_id,
                    message_id=message.id,
                    created_by_role=CreatorUserRole.END_USER,
                    created_by=owner.end_user_id,
                ),
            ]
        )
        return conversation.id, message.id, run.id, upload.id


def configure_chatbot(harness: ClaimHarness) -> str:
    """Publish an ordinary Chatbot and convert the fixture's retained history."""
    from models.model import AppModelConfig

    base = harness.oauth.base
    with base.sessions.begin() as session:
        config = AppModelConfig(app_id=base.context.app_id)
        session.add(config)
        session.flush()
        session.execute(
            sa.update(App).where(App.id == base.context.app_id).values(mode=AppMode.CHAT, app_model_config_id=config.id)
        )
        session.execute(
            sa.update(Conversation)
            .where(Conversation.app_id == base.context.app_id)
            .values(mode=AppMode.CHAT, app_model_config_id=config.id)
        )
        return config.id


def chatbot_entity(harness: ClaimHarness) -> ChatAppGenerateEntity:
    """Keep the admitted Guest actor independent of any later ownership transfer."""
    guest = harness.oauth.base.context
    with harness.oauth.base.sessions() as session:
        config_id = session.scalar(
            sa.select(App.app_model_config_id).where(App.id == guest.app_id, App.tenant_id == guest.tenant_id)
        )
        assert config_id is not None
    return ChatAppGenerateEntity(
        task_id=str(uuid4()),
        app_config=EasyUIBasedAppConfig(
            tenant_id=guest.tenant_id,
            app_id=guest.app_id,
            app_mode=AppMode.CHAT,
            app_model_config_id=config_id,
            app_model_config_from=EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG,
            app_model_config_dict={},
            model=ModelConfigEntity(provider="test-provider", model="test-model"),
            prompt_template=PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.SIMPLE),
            additional_features=AppAdditionalFeatures(),
        ),
        model_conf=make_model_config(provider="test-provider", model="test-model", mode="chat"),
        inputs={},
        files=[],
        user_id=guest.end_user_id,
        stream=True,
        invoke_from=AppInvokeFrom.WEB_APP,
    )


@pytest.mark.parametrize("mode", [AppMode.ADVANCED_CHAT, AppMode.CHAT])
def test_full_passport_claim_preserves_provenance_and_transfers_history_access(
    harness: ClaimHarness, mode: AppMode
) -> None:
    from models.enums import CreatorUserRole, FeedbackRating
    from models.model import Message, MessageFeedback
    from models.web import PinnedConversation, SavedMessage
    from models.workflow import WorkflowRun
    from repositories.conversation_access import (
        ConversationAccessDeniedError,
        may_read_conversation_run,
        require_web_message_access,
    )
    from repositories.conversation_repository import ConversationRepository
    from repositories.conversation_variable_repository import ConversationVariableRepository
    from repositories.message_repository import MessageRepository
    from repositories.saved_message_repository import SQLAlchemySavedMessageRepository
    from services.app_ref_service import AppRef, MessageRef
    from services.audio_service import AudioService
    from services.entities.conversation_entities import EndUserConversationRef
    from services.entities.message_entities import MessageEndUser
    from services.errors.conversation import ConversationNotExistsError
    from services.errors.message import MessageNotExistsError
    from services.saved_message_service import SavedMessageActor

    base = harness.oauth.base
    connection = base.service.create_api_key(base.context, base.command())
    conversation_id, message_id, run_id, upload_id = persist_migration_history(harness, base.context)
    existing_id, _, _, _ = persist_migration_history(harness, harness.account)
    save_choices(harness, base.context, connection.id, conversation_id)
    if mode == AppMode.CHAT:
        configure_chatbot(harness)
    preview = harness.client.post("/api/migration/claimable-passports", json={"passports": [harness.guest_passport]})
    assert preview.get_json()["data"][0]["conversation_count"] == 1
    response = harness.claim()
    item = response.get_json()["data"][0]
    assert (item["claimed_connections"], item["claimed_conversations"]) == (1, 1)
    with base.sessions() as session:
        app = session.get(App, base.context.app_id)
        guest = session.get(EndUser, base.context.end_user_id)
        account = session.get(EndUser, harness.account.end_user_id)
        assert app is not None
        assert guest is not None
        assert account is not None
        conversations = ConversationRepository(session_factory=base.sessions)
        account_ref = EndUserConversationRef(
            app_id=app.id,
            tenant_id=app.tenant_id,
            end_user_id=account.id,
            conversation_id=conversation_id,
        )
        guest_ref = replace(account_ref, end_user_id=guest.id)
        assert conversations.get(ref=account_ref).id == conversation_id
        assert conversations.get(ref=replace(account_ref, conversation_id=existing_id)).id == existing_id
        with pytest.raises(ConversationNotExistsError):
            conversations.get(ref=guest_ref)
        messages = MessageRepository(session_factory=base.sessions)
        page = messages.get_message_page(
            app_id=app.id,
            app_owner_tenant_id=app.tenant_id,
            actor=MessageEndUser(end_user_id=account.id),
            conversation_id=conversation_id,
            first_id=None,
            limit=10,
            installed_app=None,
        )
        assert page.data[0].record.id == message_id
        message = session.get(Message, message_id)
        assert message is not None
        assert message.from_end_user_id == guest.id
        assert (
            session.scalar(sa.select(MessageFeedback.from_end_user_id).where(MessageFeedback.message_id == message_id))
            == account.id
        )
        variables = ConversationVariableRepository(session_factory=base.sessions)
        variable_page = variables.get_page(ref=account_ref, last_id=None, limit=10, variable_name=None)
        assert variable_page.data[0].variable.value == "state"
        with pytest.raises(ConversationNotExistsError):
            variables.get_page(ref=guest_ref, last_id=None, limit=10, variable_name=None)
        with pytest.raises(ConversationNotExistsError):
            messages.get_message_page(
                app_id=app.id,
                app_owner_tenant_id=app.tenant_id,
                actor=MessageEndUser(end_user_id=guest.id),
                conversation_id=conversation_id,
                first_id=None,
                limit=10,
                installed_app=None,
            )
        assert (
            AudioService._get_message_by_ref(
                session, MessageRef(AppRef(app.tenant_id, app.id), message_id, end_user_id=account.id)
            )
            is not None
        )
        assert (
            AudioService._get_message_by_ref(
                session, MessageRef(AppRef(app.tenant_id, app.id), message_id, end_user_id=guest.id)
            )
            is None
        )
        assert may_read_conversation_run(
            session, app_id=app.id, user=account, run_id=run_id, original_end_user_id=guest.id
        )
        assert not may_read_conversation_run(
            session, app_id=app.id, user=guest, run_id=run_id, original_end_user_id=guest.id
        )
        with pytest.raises(ConversationAccessDeniedError):
            require_web_message_access(
                session, tenant_id=app.tenant_id, app_id=app.id, end_user_id=guest.id, conversation_id=conversation_id
            )
        require_web_message_access(
            session, tenant_id=app.tenant_id, app_id=app.id, end_user_id=account.id, conversation_id=conversation_id
        )
        assert (
            session.scalar(
                sa.select(PinnedConversation.created_by).where(PinnedConversation.conversation_id == conversation_id)
            )
            == account.id
        )
        assert (
            session.scalar(sa.select(SavedMessage.created_by).where(SavedMessage.message_id == message_id))
            == account.id
        )
        run = session.get(WorkflowRun, run_id)
        assert run is not None
        assert run.created_by_role == CreatorUserRole.END_USER
        assert run.created_by == guest.id
    feedback = messages.set_feedback(
        app_id=base.context.app_id,
        app_owner_tenant_id=base.context.tenant_id,
        actor=MessageEndUser(end_user_id=harness.account.end_user_id),
        message_id=message_id,
        rating=FeedbackRating.DISLIKE,
        content="Updated after migration",
        app_wide=False,
        installed_app=None,
    )
    assert feedback is not None
    assert feedback.from_end_user_id == harness.account.end_user_id
    with pytest.raises(MessageNotExistsError):
        messages.set_feedback(
            app_id=base.context.app_id,
            app_owner_tenant_id=base.context.tenant_id,
            actor=MessageEndUser(end_user_id=base.context.end_user_id),
            message_id=message_id,
            rating=FeedbackRating.LIKE,
            content=None,
            app_wide=False,
            installed_app=None,
        )
    saved = SQLAlchemySavedMessageRepository(session_factory=base.sessions)
    assert (
        saved.pagination_by_last_id(
            app_id=base.context.app_id,
            actor=SavedMessageActor.end_user(base.context.end_user_id),
            last_id=None,
            limit=10,
        ).data
        == ()
    )
    assert message_id in {
        row.id
        for row in saved.pagination_by_last_id(
            app_id=base.context.app_id,
            actor=SavedMessageActor.end_user(harness.account.end_user_id),
            last_id=None,
            limit=10,
        ).data
    }
    repeat = harness.claim().get_json()["data"][0]
    assert (repeat["claimed_connections"], repeat["claimed_conversations"]) == (0, 0)


@pytest.mark.parametrize("terminal", ["answer", "error"])
def test_chatbot_claim_rejects_inflight_answer_and_error_writes(
    harness: ClaimHarness,
    terminal: str,
    monkeypatch: pytest.MonkeyPatch,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    from core.app.apps import base_app_queue_manager
    from core.app.apps.base_app_queue_manager import PublishFrom
    from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
    from core.app.entities.queue_entities import QueueErrorEvent, QueueMessageEndEvent
    from core.app.entities.task_entities import ErrorStreamResponse
    from core.app.task_pipeline.easy_ui_based_generate_task_pipeline import EasyUIBasedGenerateTaskPipeline
    from models.model import Message
    from repositories.conversation_access import ConversationAccessDeniedError

    base = harness.oauth.base
    monkeypatch.setattr(base_app_queue_manager, "redis_client", redis_transport[0])
    conversation_id, message_id, _, _ = persist_migration_history(harness, base.context)
    configure_chatbot(harness)
    entity = chatbot_entity(harness)
    queue = MessageBasedAppQueueManager(
        task_id=entity.task_id,
        user_id=entity.user_id,
        invoke_from=entity.invoke_from,
        conversation_id=conversation_id,
        app_mode=AppMode.CHAT,
        message_id=message_id,
    )
    with base.sessions() as session:
        conversation = session.get(Conversation, conversation_id)
        message = session.get(Message, message_id)
        assert conversation is not None
        assert message is not None
        original = (message.answer, message.status, message.error)
    pipeline = EasyUIBasedGenerateTaskPipeline(entity, queue, conversation, message, stream=True)
    queue.publish(
        QueueMessageEndEvent() if terminal == "answer" else QueueErrorEvent(error=ValueError("Late failure")),
        PublishFrom.APPLICATION_MANAGER,
    )

    result = harness.claim().get_json()["data"][0]
    assert (result["status"], result["claimed_conversations"], result["stop_requested_run_count"]) == ("success", 1, 0)
    responses = list(pipeline._wrapper_process_stream_response())
    assert len(responses) == 1
    assert isinstance(responses[0], ErrorStreamResponse)
    assert isinstance(responses[0].err, ConversationAccessDeniedError)
    with base.sessions() as session:
        stored = session.get(Message, message_id)
        assert stored is not None
        assert (stored.answer, stored.status, stored.error) == original
        assert session.scalar(sa.select(Conversation.from_end_user_id).where(Conversation.id == conversation_id)) == (
            harness.account.end_user_id
        )


def test_chatbot_completion_releases_ownership_fence_before_notifying_subscribers(
    harness: ClaimHarness,
    monkeypatch: pytest.MonkeyPatch,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    from core.app.apps import base_app_queue_manager
    from core.app.apps.base_app_queue_manager import PublishFrom
    from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
    from core.app.entities.queue_entities import QueueMessageEndEvent
    from core.app.entities.task_entities import MessageEndStreamResponse
    from core.app.task_pipeline.easy_ui_based_generate_task_pipeline import EasyUIBasedGenerateTaskPipeline
    from events.message_event import message_was_created
    from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
    from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
    from models.model import Message

    base = harness.oauth.base
    conversation_id, message_id, _, _ = persist_migration_history(harness, base.context)
    configure_chatbot(harness)
    entity = chatbot_entity(harness)
    monkeypatch.setattr(base_app_queue_manager, "redis_client", redis_transport[0])
    queue = MessageBasedAppQueueManager(
        task_id=entity.task_id,
        user_id=entity.user_id,
        invoke_from=entity.invoke_from,
        conversation_id=conversation_id,
        app_mode=AppMode.CHAT,
        message_id=message_id,
    )
    with base.sessions() as session:
        conversation = session.get(Conversation, conversation_id)
        message = session.get(Message, message_id)
        assert conversation is not None
        assert message is not None
    pipeline = EasyUIBasedGenerateTaskPipeline(entity, queue, conversation, message, stream=True)
    queue.publish(
        QueueMessageEndEvent(
            llm_result=LLMResult(
                model="test-model",
                prompt_messages=[],
                message=AssistantPromptMessage(content="Committed answer"),
                usage=LLMUsage.empty_usage(),
            )
        ),
        PublishFrom.APPLICATION_MANAGER,
    )
    notifications: list[str] = []

    def after_save(sender: Message, **_kwargs: object) -> None:
        with base.sessions() as session:
            assert session.scalar(sa.select(Message.answer).where(Message.id == sender.id)) == "Committed answer"
        assert harness.claim().get_json()["data"][0]["status"] == "success"
        notifications.append(sender.id)

    with message_was_created.connected_to(after_save):
        responses = list(pipeline._wrapper_process_stream_response())
    assert isinstance(responses[-1], MessageEndStreamResponse)
    assert notifications == [message_id]


@pytest.mark.parametrize("granted", [False, True])
def test_chatbot_admission_preserves_trusted_app_default_file_grants(harness: ClaimHarness, granted: bool) -> None:
    from core.app.apps.chat.app_generator import ChatAppGenerator
    from core.app.entities.app_invoke_entities import UserFrom
    from core.app.file_access import FileAccessScope, bind_file_access_scope
    from core.workflow.file_reference import build_file_reference
    from graphon.file import File, FileTransferMethod, FileType
    from models.enums import CreatorUserRole
    from repositories.entities.web_execution import WebExecutionResourcesChangedError
    from tests.helpers.unit.model_factories import make_upload_file

    base = harness.oauth.base
    configure_chatbot(harness)
    entity = chatbot_entity(harness)
    assert harness.account.account_id is not None
    with base.sessions.begin() as session:
        upload = make_upload_file(
            tenant_id=base.context.tenant_id,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=harness.account.account_id,
        )
        session.add(upload)
        session.flush()
        upload_id, storage_key = upload.id, upload.key
    entity.files = [
        File(
            file_type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            reference=build_file_reference(record_id=upload_id),
            filename="default.txt",
            extension=".txt",
            mime_type="text/plain",
            size=1,
            storage_key=storage_key,
        )
    ]
    scope = FileAccessScope(
        tenant_id=base.context.tenant_id,
        user_id=entity.user_id,
        user_from=UserFrom.END_USER,
        invoke_from=entity.invoke_from,
        granted_upload_file_ids=frozenset({upload_id}) if granted else frozenset(),
    )
    with bind_file_access_scope(scope), base.sessions() as session:
        if granted:
            _, message = ChatAppGenerator()._init_generate_records(entity, session=session)
            assert message.from_end_user_id == entity.user_id
        else:
            with pytest.raises(WebExecutionResourcesChangedError):
                ChatAppGenerator()._init_generate_records(entity, session=session)


def test_chatbot_claim_rejects_stale_message_creation_and_history_reads(harness: ClaimHarness) -> None:
    from core.app.apps.chat.app_generator import ChatAppGenerator
    from core.memory.token_buffer_memory import TokenBufferMemory
    from core.model_manager import ModelInstance
    from models.model import Message
    from repositories.conversation_access import ConversationAccessDeniedError
    from services.errors.conversation import ConversationNotExistsError

    base = harness.oauth.base
    conversation_id, _, _, _ = persist_migration_history(harness, base.context)
    configure_chatbot(harness)
    entity = chatbot_entity(harness)
    with base.sessions() as session:
        conversation = session.get(Conversation, conversation_id)
        assert conversation is not None
    assert harness.claim().get_json()["data"][0]["status"] == "success"
    with base.sessions() as session, pytest.raises(ConversationNotExistsError):
        ChatAppGenerator()._init_generate_records(entity, conversation, session=session)
    memory = TokenBufferMemory(
        conversation=conversation,
        model_instance=ModelInstance(
            entity.model_conf.provider_model_bundle, entity.model_conf.model, credentials=entity.model_conf.credentials
        ),
        tenant_id=entity.app_config.tenant_id,
        end_user_id=entity.user_id,
    )
    with pytest.raises(ConversationAccessDeniedError):
        memory.get_history_prompt_messages()
    with base.sessions() as session:
        assert (
            session.scalar(
                sa.select(sa.func.count()).select_from(Message).where(Message.conversation_id == conversation_id)
            )
            == 1
        )
    account_entity = chatbot_entity(harness)
    account_entity.user_id = harness.account.end_user_id
    with base.sessions() as session:
        current = session.get(Conversation, conversation_id)
        assert current is not None
        _, accepted = ChatAppGenerator()._init_generate_records(account_entity, current, session=session)
        assert accepted.from_end_user_id == harness.account.end_user_id


def test_chatbot_generated_attachment_cannot_be_added_after_claim(
    harness: ClaimHarness,
    monkeypatch: pytest.MonkeyPatch,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    from core.app.apps import base_app_queue_manager
    from core.app.apps.base_app_runner import AppRunner
    from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
    from core.tools import tool_file_manager
    from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent
    from models.model import MessageFile
    from models.tools import ToolFile
    from repositories.conversation_access import ConversationAccessDeniedError

    base = harness.oauth.base
    conversation_id, message_id, _, _ = persist_migration_history(harness, base.context)
    configure_chatbot(harness)
    entity = chatbot_entity(harness)
    monkeypatch.setattr(base_app_queue_manager, "redis_client", redis_transport[0])
    queue = MessageBasedAppQueueManager(
        task_id=entity.task_id,
        user_id=entity.user_id,
        invoke_from=entity.invoke_from,
        conversation_id=conversation_id,
        app_mode=AppMode.CHAT,
        message_id=message_id,
    )

    def save_after_claim(_key: str, _data: bytes) -> None:
        assert harness.claim().get_json()["data"][0]["status"] == "success"

    storage = MagicMock()
    storage.save.side_effect = save_after_claim
    monkeypatch.setattr(tool_file_manager, "storage", storage)
    with base.sessions() as session, pytest.raises(ConversationAccessDeniedError):
        AppRunner()._handle_multimodal_image_content(
            content=ImagePromptMessageContent(
                base64_data=base64.b64encode(b"generated-image").decode(), format="png", mime_type="image/png"
            ),
            message_id=message_id,
            user_id=entity.user_id,
            tenant_id=base.context.tenant_id,
            queue_manager=queue,
            session=session,
            app_id=entity.app_config.app_id,
        )
    with base.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(MessageFile)) == 0
        file = session.scalar(sa.select(ToolFile).where(ToolFile.user_id == entity.user_id))
        assert file is not None
        tool_id = file.id
    assert harness.claim().get_json()["data"][0]["claimed_conversations"] == 0
    with base.sessions() as session:
        assert session.scalar(sa.select(ToolFile.user_id).where(ToolFile.id == tool_id)) == harness.account.end_user_id


def test_chatbot_title_generated_during_claim_is_discarded(
    harness: ClaimHarness,
    monkeypatch: pytest.MonkeyPatch,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    from core.app.entities.task_entities import EasyUITaskState
    from core.app.task_pipeline import message_cycle_manager
    from core.app.task_pipeline.message_cycle_manager import MessageCycleManager
    from core.llm_generator.llm_generator import LLMGenerator
    from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
    from graphon.model_runtime.entities.message_entities import AssistantPromptMessage

    base = harness.oauth.base
    monkeypatch.setattr(message_cycle_manager, "redis_client", redis_transport[0])
    conversation_id, message_id, _, _ = persist_migration_history(harness, base.context)
    configure_chatbot(harness)
    entity = chatbot_entity(harness)
    manager = MessageCycleManager(
        application_generate_entity=entity,
        task_state=EasyUITaskState(
            llm_result=LLMResult(
                model="test-model",
                prompt_messages=[],
                message=AssistantPromptMessage(content=""),
                usage=LLMUsage.empty_usage(),
            )
        ),
    )

    def complete_model_call(*_args: object, **_kwargs: object) -> str:
        assert harness.claim().get_json()["data"][0]["status"] == "success"
        with base.sessions.begin() as session:
            session.execute(
                sa.update(Conversation).where(Conversation.id == conversation_id).values(name="Account title")
            )
        return "Late Guest title"

    monkeypatch.setattr(LLMGenerator, "generate_conversation_name", complete_model_call)
    manager._generate_conversation_name_worker(
        harness.client.application, conversation_id, "Original query", message_id
    )
    with base.sessions() as session:
        assert session.scalar(sa.select(Conversation.name).where(Conversation.id == conversation_id)) == "Account title"


@pytest.mark.parametrize("unsupported", ["agent_config", "agent_history"])
def test_chatbot_claim_excludes_legacy_agent_writers(harness: ClaimHarness, unsupported: str) -> None:
    import json

    from models.model import AppModelConfig

    base = harness.oauth.base
    conversation_id, _, _, _ = persist_migration_history(harness, base.context)
    config_id = configure_chatbot(harness)
    with base.sessions.begin() as session:
        if unsupported == "agent_config":
            session.execute(
                sa.update(AppModelConfig)
                .where(AppModelConfig.id == config_id)
                .values(agent_mode=json.dumps({"enabled": True, "strategy": "function_call"}))
            )
        else:
            session.execute(
                sa.update(Conversation).where(Conversation.id == conversation_id).values(mode=AppMode.AGENT_CHAT)
            )
    preview = harness.client.post("/api/migration/claimable-passports", json={"passports": [harness.guest_passport]})
    assert preview.get_json()["data"] == []
    assert harness.claim().status_code == 400
    with base.sessions() as session:
        assert (
            session.scalar(sa.select(Conversation.from_end_user_id).where(Conversation.id == conversation_id))
            == base.context.end_user_id
        )


def test_conversation_failure_rolls_back_entire_passport(harness: ClaimHarness) -> None:
    from graphon.enums import WorkflowExecutionStatus
    from models.model import UploadFile
    from models.web import PinnedConversation, SavedMessage
    from models.workflow import WorkflowRun

    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    conversation_id, message_id, run_id, upload_id = persist_migration_history(harness, base.context)
    save_choices(harness, base.context, selected.id, conversation_id)
    with base.sessions.begin() as session:
        session.execute(
            sa.update(WorkflowRun)
            .where(WorkflowRun.id == run_id)
            .values(status=WorkflowExecutionStatus.RUNNING, finished_at=None)
        )
    engine = base.sessions.kw["bind"]

    def fail_conversation(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if statement.startswith("UPDATE conversations SET"):
            raise RuntimeError("conversation transfer unavailable")

    event.listen(engine, "before_cursor_execute", fail_conversation)
    try:
        result = harness.claim().get_json()["data"][0]
    finally:
        event.remove(engine, "before_cursor_execute", fail_conversation)
    assert result["status"] == "failed"
    assert base.service.get_connection(base.context, selected.id).id == selected.id
    with base.sessions() as session:
        assert session.scalar(sa.select(WorkflowRun.stop_requested_at).where(WorkflowRun.id == run_id)) is not None
        assert (
            session.scalar(sa.select(UploadFile.created_by).where(UploadFile.id == upload_id))
            == base.context.end_user_id
        )
        assert (
            session.scalar(sa.select(Conversation.from_end_user_id).where(Conversation.id == conversation_id))
            == base.context.end_user_id
        )
        assert session.scalar(sa.select(AppConnection.end_user_id)) == base.context.end_user_id
        assert session.scalar(sa.select(PinnedConversation.created_by)) == base.context.end_user_id
        assert (
            session.scalar(sa.select(SavedMessage.created_by).where(SavedMessage.message_id == message_id))
            == base.context.end_user_id
        )
    retry = harness.claim().get_json()["data"][0]
    assert (retry["claimed_connections"], retry["claimed_conversations"]) == (1, 1)


def test_full_claim_rejects_resource_selection(harness: ClaimHarness) -> None:
    response = harness.client.post(
        "/api/migration/claim",
        headers=harness.headers(),
        json={"passports": [harness.guest_passport], "resources": ["connections"]},
    )
    assert response.status_code == 422


@pytest.mark.parametrize("with_connections", [False, True])
@pytest.mark.parametrize("state", ["running", "paused"])
def test_claim_stops_unfinished_runs_and_transfers_all_conversations(
    harness: ClaimHarness, with_connections: bool, state: str
) -> None:
    from graphon.enums import WorkflowExecutionStatus
    from models.model import MessageFeedback, UploadFile
    from models.web import PinnedConversation, SavedMessage
    from models.workflow import WorkflowRun

    base = harness.oauth.base
    connection = base.service.create_api_key(base.context, base.command()) if with_connections else None
    active_id, active_message, run_id, active_file = persist_migration_history(harness, base.context)
    idle_id, idle_message, _, idle_file = persist_migration_history(harness, base.context)
    with base.sessions.begin() as session:
        session.execute(
            sa.update(WorkflowRun)
            .where(WorkflowRun.id == run_id)
            .values(
                status=WorkflowExecutionStatus(state),
                finished_at=None,
            )
        )
    response = harness.claim()
    assert response.status_code == 200
    result = response.get_json()["data"][0]
    assert result["status"] == "success"
    assert (result["claimed_connections"], result["claimed_conversations"]) == (int(with_connections), 2)
    assert result["stop_requested_run_count"] == 1
    with base.sessions() as session:
        assert (
            session.scalar(sa.select(Conversation.from_end_user_id).where(Conversation.id == active_id))
            == harness.account.end_user_id
        )
        assert (
            session.scalar(sa.select(Conversation.from_end_user_id).where(Conversation.id == idle_id))
            == harness.account.end_user_id
        )
        for file_id in (active_file, idle_file):
            assert (
                session.scalar(sa.select(UploadFile.created_by).where(UploadFile.id == file_id))
                == harness.account.end_user_id
            )
        for conversation_id, owner in (
            (active_id, harness.account.end_user_id),
            (idle_id, harness.account.end_user_id),
        ):
            assert (
                session.scalar(
                    sa.select(PinnedConversation.created_by).where(
                        PinnedConversation.conversation_id == conversation_id
                    )
                )
                == owner
            )
        for message_id, owner in (
            (active_message, harness.account.end_user_id),
            (idle_message, harness.account.end_user_id),
        ):
            assert (
                session.scalar(sa.select(SavedMessage.created_by).where(SavedMessage.message_id == message_id)) == owner
            )
            assert (
                session.scalar(
                    sa.select(MessageFeedback.from_end_user_id).where(MessageFeedback.message_id == message_id)
                )
                == owner
            )
        assert (
            session.scalar(sa.select(WorkflowRun.created_by).where(WorkflowRun.id == run_id))
            == base.context.end_user_id
        )
    if connection is not None:
        assert base.service.get_connection(harness.account, connection.id).id == connection.id
    with base.sessions() as session:
        run = session.get(WorkflowRun, run_id)
        assert run is not None
        assert run.stop_requested_at is not None
        assert run.status == WorkflowExecutionStatus.STOPPED
        assert run.created_by == base.context.end_user_id
    repeated = harness.claim().get_json()["data"][0]
    assert (repeated["claimed_connections"], repeated["claimed_conversations"]) == (0, 0)


def test_claim_transfers_persistent_file_ownership(harness: ClaimHarness) -> None:
    from core.app.entities.app_invoke_entities import InvokeFrom as AppInvokeFrom
    from core.app.entities.app_invoke_entities import UserFrom
    from core.app.file_access import DatabaseFileAccessController, FileAccessScope
    from models.enums import CreatorUserRole
    from models.model import UploadFile
    from models.tools import ToolFile
    from tests.helpers.unit.model_factories import make_upload_file

    base = harness.oauth.base
    _, _, _, upload_id = persist_migration_history(harness, base.context)
    with base.sessions.begin() as session:
        unattached = make_upload_file(
            tenant_id=base.context.tenant_id,
            created_by=base.context.end_user_id,
            created_by_role=CreatorUserRole.END_USER,
        )
        tool = ToolFile(
            tenant_id=base.context.tenant_id,
            user_id=base.context.end_user_id,
            conversation_id=None,
            file_key="tools/original.txt",
            mimetype="text/plain",
        )
        session.add_all([unattached, tool])
        session.flush()
        unattached_id, tool_id, original_key = unattached.id, tool.id, unattached.key
    assert harness.claim().get_json()["data"][0]["claimed_conversations"] == 1
    controller = DatabaseFileAccessController()
    scope = FileAccessScope(
        tenant_id=base.context.tenant_id,
        user_id=harness.account.end_user_id,
        user_from=UserFrom.END_USER,
        invoke_from=AppInvokeFrom.WEB_APP,
    )
    with base.sessions() as session:
        for file_id in (upload_id, unattached_id):
            file = controller.get_upload_file(session=session, file_id=file_id, scope=scope)
            assert file is not None
            assert file.created_by == harness.account.end_user_id
            assert file.created_by_role == CreatorUserRole.END_USER
            assert (
                controller.get_upload_file(
                    session=session, file_id=file_id, scope=replace(scope, user_id=base.context.end_user_id)
                )
                is None
            )
        stored = session.get(UploadFile, unattached_id)
        assert stored is not None
        assert stored.key == original_key
        file = controller.get_tool_file(session=session, file_id=tool_id, scope=scope)
        assert file is not None
        assert file.user_id == harness.account.end_user_id
        assert file.file_key == "tools/original.txt"
        assert (
            controller.get_tool_file(
                session=session, file_id=tool_id, scope=replace(scope, user_id=base.context.end_user_id)
            )
            is None
        )
    assert harness.claim().get_json()["data"][0]["claimed_conversations"] == 0


def test_claim_transfers_choices_without_transferring_app_authorization(harness: ClaimHarness) -> None:
    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    save_choices(harness, base.context, selected.id)
    response = harness.claim()
    assert response.status_code == 200
    assert response.get_json()["data"][0]["claimed_connections"] == 1
    saved = base.repository.configuration(harness.account, None)
    assert saved[0].connection_id == selected.id
    assert base.repository.configuration(base.context, None) == ()
    service = harness.services.connection_selections
    assert service.get(harness.account, None).reauthorization_required
    save_choices(harness, harness.account, selected.id)
    assert not service.get(harness.account, None).reauthorization_required


@pytest.mark.parametrize("mode", [AppMode.AGENT_CHAT, AppMode.COMPLETION, AppMode.AGENT])
def test_migration_excludes_app_modes_without_supported_run_tracking(harness: ClaimHarness, mode: AppMode) -> None:
    from models.end_user_connection import EndUserConnection
    from models.model import AppModelConfig

    base = harness.oauth.base
    connection = base.service.create_api_key(base.context, base.command())
    with base.sessions.begin() as session:
        config = AppModelConfig(app_id=base.context.app_id)
        session.add(config)
        session.flush()
        session.execute(
            sa.update(App).where(App.id == base.context.app_id).values(mode=mode, app_model_config_id=config.id)
        )
    response = harness.client.post("/api/migration/claimable-passports", json={"passports": [harness.guest_passport]})
    assert response.status_code == 200
    assert response.get_json()["data"] == []
    assert harness.claim().status_code == 400
    with base.sessions() as session:
        assert (
            session.scalar(sa.select(EndUserConnection.end_user_id).where(EndUserConnection.id == connection.id))
            == base.context.end_user_id
        )


@pytest.mark.parametrize("enabled", [False, True])
@pytest.mark.parametrize("operation", ["rename", "feedback", "unsave", "save"])
def test_history_write_locks_are_skipped_without_account_login(
    harness: ClaimHarness, monkeypatch: pytest.MonkeyPatch, enabled: bool, operation: str
) -> None:
    from sqlalchemy.dialects import postgresql
    from sqlalchemy.orm import ORMExecuteState

    from configs import dify_config
    from models.enums import FeedbackRating
    from repositories.conversation_repository import ConversationRepository
    from repositories.message_repository import MessageRepository
    from repositories.saved_message_repository import SQLAlchemySavedMessageRepository
    from services.entities.conversation_entities import EndUserConversationRef
    from services.entities.message_entities import MessageEndUser
    from services.saved_message_service import SavedMessageActor

    base = harness.oauth.base
    conversation_id, message_id, _, _ = persist_migration_history(harness, base.context)
    monkeypatch.setattr(dify_config, "WEBAPP_ACCOUNT_PASSPORT_ENABLED", enabled)
    if operation == "save":
        SQLAlchemySavedMessageRepository(session_factory=base.sessions).delete(
            app_id=base.context.app_id,
            actor=SavedMessageActor.end_user(base.context.end_user_id),
            message_id=message_id,
        )
    statements: list[str] = []

    def record(state: ORMExecuteState) -> None:
        if isinstance(state.statement, sa.sql.Select):
            statements.append(str(state.statement.compile(dialect=postgresql.dialect())))

    event.listen(Session, "do_orm_execute", record)
    try:
        if operation == "rename":
            ConversationRepository(session_factory=base.sessions).rename(
                ref=EndUserConversationRef(
                    app_id=base.context.app_id,
                    tenant_id=base.context.tenant_id,
                    end_user_id=base.context.end_user_id,
                    conversation_id=conversation_id,
                ),
                name="Renamed history",
                updated_at=None,
            )
        elif operation == "feedback":
            MessageRepository(session_factory=base.sessions).set_feedback(
                app_id=base.context.app_id,
                app_owner_tenant_id=base.context.tenant_id,
                actor=MessageEndUser(end_user_id=base.context.end_user_id),
                message_id=message_id,
                rating=FeedbackRating.LIKE,
                content=None,
                app_wide=False,
                installed_app=None,
            )
        else:
            saved = SQLAlchemySavedMessageRepository(session_factory=base.sessions)
            mutation = saved.delete if operation == "unsave" else saved.save
            mutation(
                app_id=base.context.app_id,
                actor=SavedMessageActor.end_user(base.context.end_user_id),
                message_id=message_id,
            )
    finally:
        event.remove(Session, "do_orm_execute", record)
    assert any("FOR UPDATE" in statement for statement in statements) is enabled


@pytest.mark.parametrize("enabled", [False, True])
@pytest.mark.parametrize("operation", ["rename", "delete", "pin", "unpin", "feedback", "variable"])
def test_current_history_writes_fence_guest_migration(
    harness: ClaimHarness, monkeypatch: pytest.MonkeyPatch, enabled: bool, operation: str
) -> None:
    from sqlalchemy.dialects import postgresql
    from sqlalchemy.orm import ORMExecuteState

    from configs import dify_config
    from models.enums import FeedbackRating
    from models.workflow import ConversationVariable
    from repositories.conversation_repository import ConversationRepository
    from repositories.conversation_variable_repository import ConversationVariableRepository
    from repositories.message_repository import MessageRepository
    from services.entities.conversation_entities import EndUserConversationRef
    from services.entities.message_entities import MessageEndUser

    base = harness.oauth.base
    conversation_id, message_id, _, _ = persist_migration_history(harness, base.context)
    with base.sessions.begin() as session:
        session.execute(sa.update(App).where(App.id == base.context.app_id).values(mode=AppMode.ADVANCED_CHAT))
        variable_id = session.scalar(
            sa.select(ConversationVariable.id).where(ConversationVariable.conversation_id == conversation_id)
        )
    assert variable_id is not None
    monkeypatch.setattr(dify_config, "WEBAPP_ACCOUNT_PASSPORT_ENABLED", enabled)
    ref = EndUserConversationRef(
        tenant_id=base.context.tenant_id,
        app_id=base.context.app_id,
        end_user_id=base.context.end_user_id,
        conversation_id=conversation_id,
    )
    conversations = ConversationRepository(session_factory=base.sessions)
    statements: list[str] = []

    def record(state: ORMExecuteState) -> None:
        if isinstance(state.statement, sa.sql.Select):
            statements.append(str(state.statement.compile(dialect=postgresql.dialect())))

    event.listen(Session, "do_orm_execute", record)
    try:
        if operation == "rename":
            conversations.rename(ref=ref, name="Renamed", updated_at=None)
        elif operation == "delete":
            conversations.delete(ref=ref)
        elif operation in {"pin", "unpin"}:
            conversations.set_pinned(ref=ref, is_pinned=operation == "pin")
        elif operation == "feedback":
            MessageRepository(session_factory=base.sessions).set_feedback(
                app_id=ref.app_id,
                app_owner_tenant_id=ref.tenant_id,
                actor=MessageEndUser(ref.end_user_id),
                message_id=message_id,
                rating=FeedbackRating.LIKE,
                content=None,
                app_wide=False,
                installed_app=None,
            )
        else:
            ConversationVariableRepository(session_factory=base.sessions).update(
                ref=ref, variable_id=variable_id, transform=lambda variable: variable
            )
    finally:
        event.remove(Session, "do_orm_execute", record)
    assert any("FOR UPDATE OF conversations" in statement for statement in statements) is enabled


@pytest.mark.parametrize("enabled", [False, True])
def test_migrated_message_page_uses_current_conversation_owner(
    harness: ClaimHarness, monkeypatch: pytest.MonkeyPatch, enabled: bool
) -> None:
    from configs import dify_config
    from models.enums import FeedbackRating
    from repositories.message_repository import MessageRepository
    from services.entities.message_entities import MessageEndUser
    from services.errors.conversation import ConversationNotExistsError
    from services.errors.message import MessageNotExistsError

    base = harness.oauth.base
    conversation_id, message_id, _, _ = persist_migration_history(harness, base.context)
    assert harness.claim().status_code == 200
    monkeypatch.setattr(dify_config, "WEBAPP_ACCOUNT_PASSPORT_ENABLED", enabled)
    messages = MessageRepository(session_factory=base.sessions)
    page = messages.get_message_page(
        app_id=base.context.app_id,
        app_owner_tenant_id=base.context.tenant_id,
        actor=MessageEndUser(harness.account.end_user_id),
        conversation_id=conversation_id,
        first_id=None,
        limit=10,
        installed_app=None,
    )
    assert [source.record.id for source in page.data] == [message_id]
    messages.set_feedback(
        app_id=base.context.app_id,
        app_owner_tenant_id=base.context.tenant_id,
        actor=MessageEndUser(harness.account.end_user_id),
        message_id=message_id,
        rating=FeedbackRating.LIKE,
        content=None,
        app_wide=False,
        installed_app=None,
    )
    with pytest.raises(MessageNotExistsError):
        messages.set_feedback(
            app_id=base.context.app_id,
            app_owner_tenant_id=base.context.tenant_id,
            actor=MessageEndUser(base.context.end_user_id),
            message_id=message_id,
            rating=FeedbackRating.LIKE,
            content=None,
            app_wide=False,
            installed_app=None,
        )
    with pytest.raises(ConversationNotExistsError):
        messages.get_message_page(
            app_id=base.context.app_id,
            app_owner_tenant_id=base.context.tenant_id,
            actor=MessageEndUser(base.context.end_user_id),
            conversation_id=conversation_id,
            first_id=None,
            limit=10,
            installed_app=None,
        )


def test_preparation_without_an_admitted_run_does_not_block_claim(harness: ClaimHarness) -> None:
    from models.workflow import WorkflowRun

    base = harness.oauth.base
    _, _, run_id, _ = persist_migration_history(harness, base.context)
    with base.sessions.begin() as session:
        session.execute(sa.delete(WorkflowRun).where(WorkflowRun.id == run_id))
    assert harness.claim().status_code == 200


def test_claim_stops_active_run_and_handles_more_than_one_conversation_chunk(harness: ClaimHarness) -> None:
    from graphon.enums import WorkflowExecutionStatus
    from models.workflow import WorkflowRun

    base = harness.oauth.base
    active_id, _, run_id, _ = persist_migration_history(harness, base.context)
    with base.sessions.begin() as session:
        session.execute(
            sa.update(WorkflowRun)
            .where(WorkflowRun.id == run_id)
            .values(
                status=WorkflowExecutionStatus.RUNNING,
                finished_at=None,
            )
        )
        session.add_all(
            [
                Conversation(
                    app_id=base.context.app_id,
                    mode=AppMode.ADVANCED_CHAT,
                    name=f"Idle {index}",
                    from_source=ConversationFromSource.API,
                    from_end_user_id=base.context.end_user_id,
                    invoke_from=InvokeFrom.WEB_APP,
                    _inputs={},
                )
                for index in range(501)
            ]
        )
    result = harness.claim().get_json()["data"][0]
    assert result["claimed_conversations"] == 502
    assert result["stop_requested_run_count"] == 1
    with base.sessions() as session:
        assert (
            session.scalar(
                sa.select(sa.func.count())
                .select_from(Conversation)
                .where(
                    Conversation.app_id == base.context.app_id,
                    Conversation.from_end_user_id == harness.account.end_user_id,
                )
            )
            == 502
        )


def test_batch_preflight_failure_still_prevents_all_transfers_with_an_active_run(harness: ClaimHarness) -> None:
    from graphon.enums import WorkflowExecutionStatus
    from models.model import UploadFile
    from models.workflow import WorkflowRun

    base = harness.oauth.base
    connection = base.service.create_api_key(base.context, base.command())
    conversation_id, _, run_id, file_id = persist_migration_history(harness, base.context)
    with base.sessions.begin() as session:
        session.execute(
            sa.update(WorkflowRun)
            .where(WorkflowRun.id == run_id)
            .values(
                status=WorkflowExecutionStatus.RUNNING,
                finished_at=None,
            )
        )
    response = harness.client.post(
        "/api/migration/claim",
        headers={"Authorization": f"Bearer {harness.proof}"},
        json={"passports": [harness.guest_passport, "invalid"]},
    )
    assert response.status_code == 400
    assert response.get_json()["code"] == "connection_claim_preflight_failed"
    assert base.service.get_connection(base.context, connection.id).id == connection.id
    with base.sessions() as session:
        assert session.scalar(sa.select(WorkflowRun.stop_requested_at).where(WorkflowRun.id == run_id)) is None
        assert (
            session.scalar(sa.select(Conversation.from_end_user_id).where(Conversation.id == conversation_id))
            == base.context.end_user_id
        )
        assert (
            session.scalar(sa.select(UploadFile.created_by).where(UploadFile.id == file_id)) == base.context.end_user_id
        )


@pytest.mark.parametrize("stop_failure", [False, True])
def test_batch_continues_after_stopping_or_rejecting_an_active_passport(
    harness: ClaimHarness, stop_failure: bool
) -> None:
    from graphon.enums import WorkflowExecutionStatus
    from models.workflow import WorkflowRun

    base = harness.oauth.base
    active_id, _, run_id, _ = persist_migration_history(harness, base.context)
    with base.sessions.begin() as session:
        session.execute(
            sa.update(WorkflowRun)
            .where(WorkflowRun.id == run_id)
            .values(
                status=WorkflowExecutionStatus.RUNNING,
                task_id=None if stop_failure else str(uuid4()),
                finished_at=None,
            )
        )
        second_guest = EndUser(
            tenant_id=base.context.tenant_id,
            app_id=base.context.app_id,
            type=EndUserType.BROWSER,
            session_id=str(uuid4()),
        )
        session.add(second_guest)
        session.flush()
        second_id = second_guest.id
    second_context = replace(base.context, end_user_id=second_id)
    second_conversation, _, _, _ = persist_migration_history(harness, second_context)
    second_token = harness.signer.issue(
        {
            "sub": "Web API Passport",
            "app_id": base.context.app_id,
            "app_code": harness.oauth.app_code,
            "end_user_id": second_id,
        }
    )
    response = harness.client.post(
        "/api/migration/claim",
        headers={"Authorization": f"Bearer {harness.proof}"},
        json={"passports": [harness.guest_passport, second_token]},
    )
    assert response.status_code == 200
    first, second = response.get_json()["data"]
    if stop_failure:
        assert first["status"] == "failed"
        assert first["error"]["code"] == "connection_claim_unavailable"
    else:
        assert (first["status"], first["stop_requested_run_count"], first["claimed_conversations"]) == ("success", 1, 1)
    assert (second["status"], second["stop_requested_run_count"], second["claimed_conversations"]) == (
        "success",
        0,
        1,
    )
    with base.sessions() as session:
        assert session.scalar(sa.select(Conversation.from_end_user_id).where(Conversation.id == active_id)) == (
            base.context.end_user_id if stop_failure else harness.account.end_user_id
        )
        assert (
            session.scalar(sa.select(Conversation.from_end_user_id).where(Conversation.id == second_conversation))
            == harness.account.end_user_id
        )


@pytest.mark.parametrize("failure", ["missing_task", "transport", "scheduled"])
def test_stop_failure_keeps_guest_resources_and_allows_retry(
    harness: ClaimHarness,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    failure: str,
) -> None:
    from redis.exceptions import ConnectionError as RedisConnectionError

    from graphon.enums import WorkflowExecutionStatus
    from models.model import UploadFile
    from models.workflow import WorkflowRun

    base = harness.oauth.base
    selected = base.service.create_api_key(base.context, base.command())
    conversation_id, _, run_id, file_id = persist_migration_history(harness, base.context)
    task_id = str(uuid4())
    with base.sessions.begin() as session:
        session.execute(
            sa.update(WorkflowRun)
            .where(WorkflowRun.id == run_id)
            .values(
                status=WorkflowExecutionStatus.SCHEDULED if failure == "scheduled" else WorkflowExecutionStatus.RUNNING,
                task_id=None if failure == "missing_task" else task_id,
                finished_at=None,
            )
        )
    if failure == "transport":
        redis_transport[1].side_effect = RedisConnectionError("Cancellation transport unavailable")
    result = harness.claim().get_json()["data"][0]
    assert result["status"] == "failed"
    assert result["error"]["code"] == "connection_claim_unavailable"
    assert base.service.get_connection(base.context, selected.id).id == selected.id
    with base.sessions() as session:
        assert (
            session.scalar(sa.select(Conversation.from_end_user_id).where(Conversation.id == conversation_id))
            == base.context.end_user_id
        )
        assert (
            session.scalar(sa.select(UploadFile.created_by).where(UploadFile.id == file_id)) == base.context.end_user_id
        )
    redis_transport[1].side_effect = None
    with base.sessions.begin() as session:
        session.execute(
            sa.update(WorkflowRun)
            .where(WorkflowRun.id == run_id)
            .values(task_id=task_id, status=WorkflowExecutionStatus.RUNNING)
        )
    retried = harness.claim().get_json()["data"][0]
    assert (
        retried["status"],
        retried["claimed_connections"],
        retried["claimed_conversations"],
        retried["stop_requested_run_count"],
    ) == ("success", 1, 1, 1)


def test_claim_stops_only_source_guest_runs(harness: ClaimHarness) -> None:
    from graphon.enums import WorkflowExecutionStatus
    from models.workflow import WorkflowRun

    base = harness.oauth.base
    _, _, guest_run, _ = persist_migration_history(harness, base.context)
    _, _, account_run, _ = persist_migration_history(harness, harness.account)
    with base.sessions.begin() as session:
        session.execute(
            sa.update(WorkflowRun)
            .where(WorkflowRun.id.in_((guest_run, account_run)))
            .values(status=WorkflowExecutionStatus.RUNNING, finished_at=None)
        )
    result = harness.claim().get_json()["data"][0]
    assert result["stop_requested_run_count"] == 1
    with base.sessions() as session:
        assert session.scalar(sa.select(WorkflowRun.stop_requested_at).where(WorkflowRun.id == guest_run)) is not None
        assert session.scalar(sa.select(WorkflowRun.stop_requested_at).where(WorkflowRun.id == account_run)) is None


def test_claim_stops_standalone_workflow_run(harness: ClaimHarness) -> None:
    from graphon.enums import WorkflowExecutionStatus
    from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
    from models.workflow import WorkflowRun

    base = harness.oauth.base
    run_id = str(uuid4())
    with base.sessions.begin() as session:
        session.execute(sa.update(App).where(App.id == base.context.app_id).values(mode=AppMode.WORKFLOW))
        session.add(
            WorkflowRun(
                id=run_id,
                task_id=str(uuid4()),
                tenant_id=base.context.tenant_id,
                app_id=base.context.app_id,
                workflow_id=base.workflow_id,
                type=WorkflowType.WORKFLOW,
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                version="published",
                graph="{}",
                inputs="{}",
                outputs="{}",
                status=WorkflowExecutionStatus.RUNNING,
                created_by_role=CreatorUserRole.END_USER,
                created_by=base.context.end_user_id,
            )
        )
    result = harness.claim().get_json()["data"][0]
    assert (result["status"], result["claimed_conversations"], result["stop_requested_run_count"]) == ("success", 0, 1)
    with base.sessions() as session:
        assert session.scalar(sa.select(WorkflowRun.stop_requested_at).where(WorkflowRun.id == run_id)) is not None


def test_claim_waits_for_run_completion_before_transferring(
    harness: ClaimHarness, monkeypatch: pytest.MonkeyPatch
) -> None:
    from graphon.enums import WorkflowExecutionStatus
    from models.workflow import WorkflowRun
    from services import web_migration_service

    base = harness.oauth.base
    connection = base.service.create_api_key(base.context, base.command())
    conversation_id, _, run_id, _ = persist_migration_history(harness, base.context)
    with base.sessions.begin() as session:
        session.execute(
            sa.update(WorkflowRun)
            .where(WorkflowRun.id == run_id)
            .values(status=WorkflowExecutionStatus.RUNNING, finished_at=None)
        )
    finish = web_migration_service.sleep
    now = [0.0]
    delays: list[float] = []

    def wait(delay: float) -> None:
        delays.append(delay)
        now[0] += delay
        assert base.service.get_connection(base.context, connection.id).id == connection.id
        with base.sessions() as session:
            assert (
                session.scalar(sa.select(Conversation.from_end_user_id).where(Conversation.id == conversation_id))
                == base.context.end_user_id
            )
        if len(delays) == 2:
            finish(delay)

    monkeypatch.setattr(web_migration_service, "monotonic", lambda: now[0])
    monkeypatch.setattr(web_migration_service, "sleep", wait)
    item = harness.claim().get_json()["data"][0]
    assert (
        item["status"],
        item["claimed_connections"],
        item["claimed_conversations"],
        item["stop_requested_run_count"],
    ) == ("success", 1, 1, 1)
    assert delays == [0.1, 0.1]
    with base.sessions() as session:
        assert (
            session.scalar(sa.select(WorkflowRun.status).where(WorkflowRun.id == run_id))
            == WorkflowExecutionStatus.STOPPED
        )


@pytest.mark.parametrize("second_active", [False, True])
def test_readiness_timeout_preserves_resources_and_shares_one_batch_budget(
    harness: ClaimHarness, monkeypatch: pytest.MonkeyPatch, second_active: bool
) -> None:
    from graphon.enums import WorkflowExecutionStatus
    from models.model import UploadFile
    from models.workflow import WorkflowRun
    from services import web_migration_service

    base = harness.oauth.base
    connection = base.service.create_api_key(base.context, base.command())
    conversation_id, _, run_id, file_id = persist_migration_history(harness, base.context)
    with base.sessions.begin() as session:
        second_guest = EndUser(
            tenant_id=base.context.tenant_id,
            app_id=base.context.app_id,
            type=EndUserType.BROWSER,
            session_id=str(uuid4()),
        )
        session.add(second_guest)
        session.flush()
        second_id = second_guest.id
    second_context = replace(base.context, end_user_id=second_id)
    second_conversation, _, second_run, _ = persist_migration_history(harness, second_context)
    with base.sessions.begin() as session:
        run_ids = (run_id, second_run) if second_active else (run_id,)
        session.execute(
            sa.update(WorkflowRun)
            .where(WorkflowRun.id.in_(run_ids))
            .values(status=WorkflowExecutionStatus.RUNNING, finished_at=None)
        )
    second_token = harness.signer.issue(
        {
            "sub": "Web API Passport",
            "app_id": base.context.app_id,
            "app_code": harness.oauth.app_code,
            "end_user_id": second_id,
        }
    )
    now = [0.0]
    delays: list[float] = []

    def wait(delay: float) -> None:
        delays.append(delay)
        now[0] += delay

    monkeypatch.setattr(web_migration_service, "monotonic", lambda: now[0])
    monkeypatch.setattr(web_migration_service, "sleep", wait)
    response = harness.client.post(
        "/api/migration/claim",
        headers={"Authorization": f"Bearer {harness.proof}"},
        json={"passports": [harness.guest_passport, second_token]},
    )
    assert response.status_code == 200
    first, second = response.get_json()["data"]
    assert first["status"] == "failed"
    assert first["error"]["code"] == "migration_not_ready"
    assert first["error"]["status"] == 409
    if second_active:
        assert second["status"] == "failed"
        assert second["error"]["code"] == "migration_not_ready"
    else:
        assert (second["status"], second["claimed_conversations"]) == ("success", 1)
    assert sum(delays) == pytest.approx(5.0)
    assert all(0 < delay <= 0.1 for delay in delays)
    assert base.service.get_connection(base.context, connection.id).id == connection.id
    with base.sessions() as session:
        assert session.scalar(sa.select(WorkflowRun.stop_requested_at).where(WorkflowRun.id == run_id)) is not None
        assert (
            session.scalar(sa.select(Conversation.from_end_user_id).where(Conversation.id == conversation_id))
            == base.context.end_user_id
        )
        assert (
            session.scalar(sa.select(UploadFile.created_by).where(UploadFile.id == file_id)) == base.context.end_user_id
        )
        assert session.scalar(
            sa.select(Conversation.from_end_user_id).where(Conversation.id == second_conversation)
        ) == (second_id if second_active else harness.account.end_user_id)
    with base.sessions.begin() as session:
        session.execute(
            sa.update(WorkflowRun)
            .where(WorkflowRun.id == run_id)
            .values(status=WorkflowExecutionStatus.STOPPED, finished_at=datetime.now(UTC))
        )
    retried = harness.claim().get_json()["data"][0]
    assert (
        retried["status"],
        retried["claimed_connections"],
        retried["claimed_conversations"],
        retried["stop_requested_run_count"],
    ) == ("success", 1, 1, 0)


def test_transfer_rejects_run_started_after_readiness(harness: ClaimHarness) -> None:
    from graphon.enums import WorkflowExecutionStatus
    from models.model import UploadFile
    from models.workflow import WorkflowRun
    from services.web_migration_service import GuestMigrationNotReadyError

    base = harness.oauth.base
    conversation_id, _, run_id, file_id = persist_migration_history(harness, base.context)
    repository = WebMigrationRepository(session_factory=base.sessions)
    source = repository.get_claim_source(
        app_code=harness.oauth.app_code, app_id=base.context.app_id, end_user_id=base.context.end_user_id
    )
    assert source is not None
    assert repository.active_task_ids(source) == ()
    with base.sessions.begin() as session:
        session.execute(
            sa.update(WorkflowRun)
            .where(WorkflowRun.id == run_id)
            .values(status=WorkflowExecutionStatus.RUNNING, finished_at=None)
        )
    with pytest.raises(GuestMigrationNotReadyError):
        repository.claim_guest(source, account_end_user_id=harness.account.end_user_id)
    with base.sessions() as session:
        assert (
            session.scalar(sa.select(Conversation.from_end_user_id).where(Conversation.id == conversation_id))
            == base.context.end_user_id
        )
        assert (
            session.scalar(sa.select(UploadFile.created_by).where(UploadFile.id == file_id)) == base.context.end_user_id
        )
