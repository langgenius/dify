"""Annotation reads through real Console admission, application wiring and SQLite."""

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal
from uuid import uuid4

import pytest
from flask import Blueprint, Flask
from redis import Redis
from sqlalchemy import Connection, Engine, delete, event, text, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.common.rbac import RBAC_CHECKS_ATTR, PlainApp, RBACPermission
from controllers.console.app import annotation as annotation_module
from controllers.console.wraps import _is_setup_completed
from enums import DeploymentEdition
from enums.account import TenantAccountRole
from extensions.ext_application_services import build_application_services
from extensions.ext_database import db
from extensions.ext_login import DifyLoginManager, bind_account_loader, load_user_from_request, unauthorized_handler
from extensions.ext_redis import RedisClientWrapper
from libs.datetime_utils import naive_utc_now
from libs.external_api import ExternalApi
from libs.passport import PassportService
from libs.token import generate_csrf_token
from models import Account, App, AppMode, Tenant
from models.account import AccountStatus, TenantAccountJoin
from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from models.dataset import DatasetCollectionBinding
from models.model import AppAnnotationHitHistory, AppAnnotationSetting, DifySetup, MessageAnnotation
from tests.unit_tests.model_factories import make_account, make_app

type _Endpoint = Literal["count", "list", "setting", "history"]
_ENDPOINTS: tuple[_Endpoint, ...] = ("count", "list", "setting", "history")
_TIME = datetime(2026, 1, 2, 3, 4, 5)


@dataclass(frozen=True)
class _Harness:
    app: Flask
    account: Account
    target: App
    annotation: MessageAnnotation
    factory: sessionmaker[Session]
    sessions: list[Session]

    def get(
        self,
        endpoint: _Endpoint,
        *,
        app_id: str | None = None,
        annotation_id: str | None = None,
        query: dict[str, object] | None = None,
        authenticated: bool = True,
        csrf: bool = True,
    ) -> TestResponse:
        prefix = f"/apps/{app_id or self.target.id}"
        routes = {
            "count": f"{prefix}/annotations/count",
            "list": f"{prefix}/annotations",
            "setting": f"{prefix}/annotation-setting",
            "history": f"{prefix}/annotations/{annotation_id or self.annotation.id}/hit-histories",
        }
        client = self.app.test_client()
        token = generate_csrf_token(self.account.id)
        headers = {HEADER_NAME_CSRF_TOKEN: token} if csrf else {}
        if authenticated:
            headers["Authorization"] = f"Bearer {PassportService().issue({'user_id': self.account.id})}"
        client.set_cookie(COOKIE_NAME_CSRF_TOKEN, token)
        commits: list[Session] = []

        def record_commit(session: Session) -> None:
            commits.append(session)

        event.listen(Session, "before_commit", record_commit)
        try:
            response = client.get(routes[endpoint], query_string=query, headers=headers)
        finally:
            event.remove(Session, "before_commit", record_commit)
        assert not commits
        assert response.headers["Content-Type"] == "application/json"
        assert int(response.headers["Content-Length"]) == len(response.data)
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)
        return response


@pytest.fixture
def harness(
    config_overrides: Callable[..., None], sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]
) -> Iterator[_Harness]:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
        SECRET_KEY="annotation-read-passport-test-key-32-bytes",
        LOGIN_DISABLED=False,
        INIT_PASSWORD="",
        CONSOLE_API_URL="http://localhost",
        CONSOLE_WEB_URL="http://localhost",
        COOKIE_DOMAIN="",
        RBAC_ENABLED=False,
    )
    workspace = Tenant(name="Annotation workspace")
    account = make_account(account_id=str(uuid4()))
    account.last_active_at = naive_utc_now()
    target = make_app(app_id=str(uuid4()), tenant_id=workspace.id)
    annotation = MessageAnnotation(
        app_id=target.id, question="First question", content="First answer", account_id=account.id
    )
    annotation.created_at = _TIME
    annotation.hit_count = 3
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                account,
                target,
                annotation,
                TenantAccountJoin(
                    tenant_id=workspace.id, account_id=account.id, role=TenantAccountRole.OWNER, current=True
                ),
                DifySetup(version="test"),
            ]
        )
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(app)
    login_manager = DifyLoginManager()
    login_manager.request_loader(load_user_from_request)
    login_manager.unauthorized_handler(unauthorized_handler)
    login_manager.init_app(app)
    redis_client = Redis()
    redis = RedisClientWrapper()
    redis.initialize(redis_client)
    services = build_application_services(
        database_client=factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=redis,
    )
    app.extensions["application_services"] = services
    bind_account_loader(app, services.accounts.identity.load_user)
    blueprint = Blueprint("console", __name__)
    api = ExternalApi(blueprint)
    api.add_resource(annotation_module.MessageAnnotationCountApi, "/apps/<uuid:app_id>/annotations/count")
    api.add_resource(annotation_module.AnnotationApi, "/apps/<uuid:app_id>/annotations")
    api.add_resource(annotation_module.AppAnnotationSettingDetailApi, "/apps/<uuid:app_id>/annotation-setting")
    api.add_resource(
        annotation_module.AnnotationHitHistoryListApi,
        "/apps/<uuid:app_id>/annotations/<uuid:annotation_id>/hit-histories",
    )
    app.register_blueprint(blueprint)
    _is_setup_completed.reset_success()
    with app.app_context():
        assert _is_setup_completed()
        db.session.remove()
    sessions: list[Session] = []

    def track(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    factories = (factory, sqlite_session_factory, db.session.session_factory)
    for observed in factories:
        event.listen(observed, "after_begin", track)
    try:
        yield _Harness(app, account, target, annotation, factory, sessions)
    finally:
        for observed in factories:
            event.remove(observed, "after_begin", track)
        assert redis_client.connection_pool._created_connections == 0
        redis_client.close()
        _is_setup_completed.reset_success()
        with app.app_context():
            db.session.remove()
            db.engine.dispose()


def _annotation(
    harness: _Harness, *, index: int, app_id: str | None = None, question: str | None = None
) -> MessageAnnotation:
    row = MessageAnnotation(
        app_id=app_id or harness.target.id,
        question=question or f"Question {index}",
        content=f"Answer {index}",
        account_id=harness.account.id,
    )
    row.created_at = _TIME + timedelta(seconds=index)
    row.hit_count = index
    return row


def _history(harness: _Harness, *, index: int, app_id: str | None = None) -> AppAnnotationHitHistory:
    row = AppAnnotationHitHistory(
        app_id=app_id or harness.target.id,
        annotation_id=harness.annotation.id,
        source="hit-testing",
        question=f"Asked {index}",
        account_id=harness.account.id,
        score=0.9,
        message_id=str(uuid4()),
        annotation_question=f"Matched {index}",
        annotation_content=f"Responded {index}",
    )
    row.created_at = _TIME + timedelta(seconds=index)
    return row


def _error(response: TestResponse, *, status: int, code: str, message: str | None = None) -> None:
    assert response.status_code == status
    body = response.get_json()
    assert body["code"] == code
    assert body["status"] == status
    if message is not None:
        assert body["message"] == message


def test_count_and_list_preserve_shape_order_scope_and_last_page(harness: _Harness) -> None:
    second = _annotation(harness, index=1)
    with harness.factory.begin() as session:
        session.add_all([second, _annotation(harness, index=2, app_id=str(uuid4()))])
    assert harness.get("count").get_json() == {"count": 2}
    response = harness.get("list", query={"page": 1, "limit": 2})
    assert response.status_code == 200
    assert response.get_json() == {
        "data": [
            {
                "id": second.id,
                "question": second.question,
                "answer": second.content,
                "hit_count": 1,
                "created_at": int(second.created_at.timestamp()),
            },
            {
                "id": harness.annotation.id,
                "question": "First question",
                "answer": "First answer",
                "hit_count": 3,
                "created_at": int(_TIME.timestamp()),
            },
        ],
        "has_more": False,
        "limit": 2,
        "total": 2,
        "page": 1,
    }
    assert harness.get("list", query={"page": 1, "limit": 1}).get_json()["has_more"] is True
    assert harness.get("list", query={"page": 2, "limit": 1}).get_json()["data"][0]["id"] == harness.annotation.id
    assert harness.get("list", query={"page": 3, "limit": 1}).get_json() == {
        "data": [],
        "has_more": False,
        "limit": 1,
        "total": 2,
        "page": 3,
    }


def test_list_keyword_is_literal_case_insensitive_and_searches_answers(harness: _Harness) -> None:
    question = _annotation(harness, index=1, question="Keep 50%_Case\\ marker")
    answer = _annotation(harness, index=2)
    answer.content = "Answer has 50%_case\\ marker"
    decoy = _annotation(harness, index=3, question="Keep 500XCase marker")
    with harness.factory.begin() as session:
        session.add_all([question, answer, decoy])
    body = harness.get("list", query={"keyword": "50%_case\\"}).get_json()
    assert body["total"] == 2
    assert [row["id"] for row in body["data"]] == [answer.id, question.id]


@pytest.mark.parametrize("endpoint", ["list", "history"])
def test_page_size_cap_and_exact_last_page(harness: _Harness, endpoint: _Endpoint) -> None:
    with harness.factory.begin() as session:
        if endpoint == "list":
            session.add_all([_annotation(harness, index=index) for index in range(1, 101)])
        else:
            session.add_all([_history(harness, index=index) for index in range(101)])
    first = harness.get(endpoint, query={"limit": 200}).get_json()
    assert (first["page"], first["limit"], first["total"], first["has_more"]) == (1, 100, 101, True)
    assert len(first["data"]) == 100
    last = harness.get(endpoint, query={"limit": 100, "page": 2}).get_json()
    assert len(last["data"]) == 1
    assert last["has_more"] is False


@pytest.mark.parametrize("query", [{"page": 0}, {"limit": 0}, {"page": "bad"}, {"limit": "bad"}])
def test_list_rejects_invalid_pagination(harness: _Harness, query: dict[str, object]) -> None:
    _error(harness.get("list", query=query), status=422, code="unprocessable_entity")


@pytest.mark.parametrize(
    ("query", "page", "limit"),
    [({"page": 0, "limit": 0}, 1, 1), ({"page": -2, "limit": -3}, 1, 1), ({"page": "bad", "limit": "bad"}, 1, 20)],
)
def test_history_retains_forgiving_pagination(
    harness: _Harness, query: dict[str, object], page: int, limit: int
) -> None:
    with harness.factory.begin() as session:
        session.add(_history(harness, index=0))
    body = harness.get("history", query=query).get_json()
    assert (body["page"], body["limit"], body["total"], body["has_more"]) == (page, limit, 1, False)


def test_hit_history_aliases_order_and_complete_owner_chain(harness: _Harness) -> None:
    first, second = _history(harness, index=0), _history(harness, index=1)
    with harness.factory.begin() as session:
        session.add_all([first, second, _history(harness, index=2, app_id=str(uuid4()))])
    body = harness.get("history", query={"limit": 1}).get_json()
    assert body == {
        "data": [
            {
                "id": second.id,
                "source": "hit-testing",
                "score": 0.9,
                "question": "Asked 1",
                "created_at": int(second.created_at.timestamp()),
                "match": "Matched 1",
                "response": "Responded 1",
            }
        ],
        "has_more": True,
        "page": 1,
        "limit": 1,
        "total": 2,
    }
    last = harness.get("history", query={"page": 2, "limit": 1}).get_json()
    assert last["data"][0]["id"] == first.id
    assert last["has_more"] is False


@pytest.mark.parametrize("binding", ["disabled", "present", "missing"])
def test_settings_preserve_disabled_and_missing_binding_nulls(harness: _Harness, binding: str) -> None:
    if binding == "disabled":
        expected = {"enabled": False, "id": None, "score_threshold": None, "embedding_model": None}
    else:
        collection = DatasetCollectionBinding(
            provider_name="openai",
            model_name="text-embedding-3-small",
            collection_name="annotations",
            type="annotation",
        )
        setting = AppAnnotationSetting(
            app_id=harness.target.id,
            score_threshold=0.75,
            collection_binding_id=collection.id,
            created_user_id=harness.account.id,
            updated_user_id=harness.account.id,
        )
        with harness.factory.begin() as session:
            session.add(setting)
            if binding == "present":
                session.add(collection)
        expected = {
            "enabled": True,
            "id": setting.id,
            "score_threshold": 0.75,
            "embedding_model": {
                "embedding_provider_name": "openai" if binding == "present" else None,
                "embedding_model_name": "text-embedding-3-small" if binding == "present" else None,
            },
        }
    response = harness.get("setting")
    assert response.status_code == 200
    assert response.get_json() == expected


@pytest.mark.parametrize("endpoint", _ENDPOINTS)
@pytest.mark.parametrize("role", list(TenantAccountRole))
def test_count_allows_members_while_other_reads_require_edit_role(
    harness: _Harness, endpoint: _Endpoint, role: TenantAccountRole
) -> None:
    with harness.factory.begin() as session:
        session.execute(
            update(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account.id).values(role=role)
        )
    response = harness.get(endpoint)
    if endpoint == "count" or TenantAccountRole.is_editing_role(role):
        assert response.status_code == 200
    else:
        _error(response, status=403, code="forbidden")


@pytest.mark.parametrize("endpoint", _ENDPOINTS)
@pytest.mark.parametrize("scope", ["missing", "other_tenant", "disabled"])
def test_app_scope_errors_preserve_endpoint_contract(harness: _Harness, endpoint: _Endpoint, scope: str) -> None:
    app_id = harness.target.id
    if scope == "missing":
        app_id = str(uuid4())
    else:
        with harness.factory.begin() as session:
            if scope == "other_tenant":
                session.execute(update(App).where(App.id == app_id).values(tenant_id=str(uuid4())))
            else:
                # Current model writes allow only NORMAL; exercise persisted historical state.
                session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :app_id"), {"app_id": app_id})
    _error(
        harness.get(endpoint, app_id=app_id),
        status=404,
        code="app_not_found" if endpoint == "count" else "not_found",
        message="App not found." if endpoint == "count" else "App not found",
    )


@pytest.mark.parametrize("scope", ["missing", "other_app"])
def test_history_rejects_missing_or_other_app_annotation(harness: _Harness, scope: str) -> None:
    annotation_id = str(uuid4())
    if scope == "other_app":
        with harness.factory.begin() as session:
            row = _annotation(harness, index=1, app_id=str(uuid4()))
            session.add(row)
        annotation_id = row.id
    _error(
        harness.get("history", annotation_id=annotation_id),
        status=404,
        code="not_found",
        message="Annotation not found",
    )


@pytest.mark.parametrize("status", [AgentStatus.ACTIVE, AgentStatus.ARCHIVED])
def test_workflow_only_backing_app_is_hidden_only_from_count(harness: _Harness, status: AgentStatus) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=AppMode.AGENT))
        session.add(
            Agent(
                tenant_id=harness.target.tenant_id,
                name="Workflow-local agent",
                scope=AgentScope.WORKFLOW_ONLY,
                source=AgentSource.WORKFLOW,
                app_id=str(uuid4()),
                backing_app_id=harness.target.id,
                workflow_id=str(uuid4()),
                workflow_node_id="agent-node",
                status=status,
            )
        )
    _error(harness.get("count"), status=404, code="app_not_found", message="App not found.")
    for endpoint in ("list", "setting", "history"):
        assert harness.get(endpoint).status_code == 200


@pytest.mark.parametrize("endpoint", _ENDPOINTS)
def test_admission_requires_authentication_csrf_and_initialization(harness: _Harness, endpoint: _Endpoint) -> None:
    _error(harness.get(endpoint, authenticated=False), status=401, code="unauthorized")
    _error(harness.get(endpoint, csrf=False), status=401, code="unauthorized")
    with harness.factory.begin() as session:
        session.execute(
            update(Account).where(Account.id == harness.account.id).values(status=AccountStatus.UNINITIALIZED)
        )
    _error(harness.get(endpoint), status=400, code="account_not_initialized")


@pytest.mark.parametrize("endpoint", _ENDPOINTS)
def test_empty_owned_app_returns_complete_empty_shape(harness: _Harness, endpoint: _Endpoint) -> None:
    if endpoint != "history":
        with harness.factory.begin() as session:
            session.execute(delete(MessageAnnotation).where(MessageAnnotation.id == harness.annotation.id))
    response = harness.get(endpoint)
    assert response.status_code == 200
    if endpoint == "count":
        assert response.get_json() == {"count": 0}
    elif endpoint in {"list", "history"}:
        assert response.get_json() == {"data": [], "has_more": False, "page": 1, "limit": 20, "total": 0}
    else:
        assert response.get_json() == {"enabled": False, "id": None, "score_threshold": None, "embedding_model": None}


def test_all_read_routes_keep_app_layout_rbac_declaration() -> None:
    for resource in (
        annotation_module.MessageAnnotationCountApi,
        annotation_module.AnnotationApi,
        annotation_module.AppAnnotationSettingDetailApi,
        annotation_module.AnnotationHitHistoryListApi,
    ):
        [check] = getattr(resource.get, RBAC_CHECKS_ATTR)
        assert check.scene == RBACPermission.APP_VIEW_LAYOUT
        assert isinstance(check.locator, PlainApp)
