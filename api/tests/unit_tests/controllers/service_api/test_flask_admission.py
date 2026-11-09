"""Exercise Service API personal-auth admission with persisted apps and real services."""

import json
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from uuid import uuid4

import pytest
from flask import Flask
from flask_login import LoginManager, user_logged_in
from flask_restx import Namespace, Resource
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, scoped_session, sessionmaker

from controllers.service_api import bp as service_api_blueprint
from controllers.service_api import flask_admission, wraps
from controllers.service_api.flask_admission import (
    service_api_account_admission,
    service_api_app_admission,
    service_api_end_user_admission,
)
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from extensions.ext_application_services import ApplicationServices
from libs.external_api import ExternalApi
from machinery.context import AppRequestContext, ServiceApiAccountRequestContext, ServiceApiEndUserContext
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import ApiTokenType, EndUserType
from models.model import ApiToken, App, AppMode, EndUser
from models.resource_access_token import (
    ResourceAccessToken,
    ResourceAccessTokenRelation,
    ResourceAccessTokenResourceType,
)
from models.workflow import Workflow, WorkflowRun, WorkflowType


@dataclass(frozen=True)
class AdmissionApp:
    flask: Flask
    app_id: str
    tenant_id: str
    account_id: str
    token: str
    logins: list[str]
    fetch_from: WhereisUserArg


@pytest.fixture
def admission_app(
    app: Flask,
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    account_application_services: ApplicationServices,
    monkeypatch: pytest.MonkeyPatch,
    request: pytest.FixtureRequest,
) -> Iterator[AdmissionApp]:
    mode, token_kind, fetch_from = request.param
    tenant = Tenant(name="API workspace")
    account = Account(name="Owner", email="owner@example.com")
    app_model = App(tenant_id=tenant.id, name="API app", mode=mode, enable_api=True, enable_site=True)
    token = (
        ResourceAccessToken(
            tenant_id=tenant.id,
            name="API integration",
            token=f"sk-{uuid4()}",
            track_id=uuid4().hex,
            created_by=account.id,
        )
        if token_kind == "resource"
        else ApiToken(tenant_id=tenant.id, app_id=app_model.id, token=f"app-{uuid4()}", type=ApiTokenType.APP)
    )
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                tenant,
                account,
                app_model,
                token,
                TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER),
            ]
        )
        session.flush()
        if isinstance(token, ResourceAccessToken):
            session.add(
                ResourceAccessTokenRelation(
                    token_id=token.id, resource_type=ResourceAccessTokenResourceType.APP, app_id=app_model.id
                )
            )

    monkeypatch.setattr(wraps, "application_services", lambda: account_application_services)
    monkeypatch.setattr(flask_admission, "application_services", lambda: account_application_services)
    monkeypatch.setitem(wraps.db._app_engines, app, {None: sqlite_engine})
    session_proxy = scoped_session(sqlite_session_factory)
    monkeypatch.setattr(wraps.db, "session", session_proxy)
    LoginManager(app)
    logins: list[str] = []

    def record_login(sender: Flask, *, user: Account | EndUser) -> None:
        assert sender is app
        logins.append(user.id)

    user_logged_in.connect(record_login, sender=app)
    fetch_user_arg = FetchUserArg(fetch_from=fetch_from, required=False)
    namespace = Namespace("admission", path="/")

    @namespace.route("/scalar")
    class ScalarUser(Resource):
        @service_api_end_user_admission(fetch_user_arg=fetch_user_arg)
        def post(self, context: ServiceApiEndUserContext) -> dict[str, str]:
            return {"end_user_id": context.end_user_id}

    @namespace.route("/legacy")
    class LegacyUser(Resource):
        @validate_app_token(fetch_user_arg=fetch_user_arg)
        def post(self, app_model: App, end_user: EndUser) -> dict[str, str]:
            assert end_user.app_id == app_model.id
            return {"end_user_id": end_user.id}

    @namespace.route("/app-only")
    class AppOnly(Resource):
        @service_api_app_admission
        def post(self, context: AppRequestContext) -> dict[str, str]:
            return {"app_id": context.app_id}

    @namespace.route("/account-only")
    class AccountOnly(Resource):
        @service_api_account_admission
        def post(self, context: ServiceApiAccountRequestContext) -> dict[str, str]:
            return {"account_id": context.account_id}

    @namespace.route("/legacy-account-only")
    class LegacyAccountOnly(Resource):
        @validate_app_token
        def post(self, app_model: App) -> dict[str, str]:
            return {"app_id": app_model.id}

    api = ExternalApi(app)
    api.add_namespace(namespace)
    try:
        yield AdmissionApp(app, app_model.id, tenant.id, account.id, token.token, logins, fetch_from)
    finally:
        user_logged_in.disconnect(record_login, sender=app)
        session_proxy.remove()


def _publish(
    application: AdmissionApp,
    factory: sessionmaker[Session],
    *,
    credential_source: str,
    version: str = "published",
) -> str:
    with factory.begin() as session:
        app = session.get_one(App, application.app_id)
        workflow = Workflow.new(
            tenant_id=application.tenant_id,
            app_id=application.app_id,
            type=WorkflowType.CHAT if app.mode == AppMode.ADVANCED_CHAT else WorkflowType.WORKFLOW,
            version=version,
            graph=json.dumps(
                {"nodes": [{"id": "tool", "data": {"type": "tool", "credential_source": credential_source}}]}
            ),
            features="{}",
            created_by=application.account_id,
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )
        session.add(workflow)
        if version != Workflow.VERSION_DRAFT:
            app.workflow_id = workflow.id
        return workflow.id


@pytest.mark.parametrize(
    "admission_app",
    [
        (mode, token_kind, fetch_from)
        for mode in (AppMode.WORKFLOW, AppMode.ADVANCED_CHAT)
        for token_kind in ("app", "resource")
        for fetch_from in WhereisUserArg
    ],
    indirect=True,
)
@pytest.mark.parametrize("route", ["scalar", "legacy"])
def test_end_user_auth_is_forbidden_before_identity_or_payload_resolution(
    admission_app: AdmissionApp, sqlite_session_factory: sessionmaker[Session], route: str
) -> None:
    _publish(admission_app, sqlite_session_factory, credential_source="end_user")
    existing_user = EndUser(
        tenant_id=admission_app.tenant_id,
        app_id=admission_app.app_id,
        type=EndUserType.APP_DEPLOY,
        session_id="existing-user",
    )
    with sqlite_session_factory.begin() as session:
        session.add(existing_user)

    client = admission_app.flask.test_client()
    headers = {"Authorization": f"Bearer {admission_app.token}"}
    payloads: tuple[dict[str, str], ...] = ({"user": "existing-user"}, {"user": "new-user"}, {})
    for payload in payloads:
        response = (
            client.post(f"/{route}", headers=headers, data=payload)
            if admission_app.fetch_from == WhereisUserArg.FORM
            else client.post(f"/{route}", headers=headers, query_string=payload, json=payload)
        )
        assert response.status_code == 403
        assert response.json == {
            "code": "forbidden",
            "message": "Service API end-user access is unavailable for apps that require EndUser authentication.",
            "status": 403,
        }

    response = client.post(f"/{route}", headers=headers, data="invalid json", content_type="application/json")
    assert response.status_code == 403
    assert admission_app.logins == []
    with sqlite_session_factory() as session:
        users = session.scalars(select(EndUser)).all()
        assert len(users) == 1
        assert users[0].id == existing_user.id
        assert users[0].type == EndUserType.APP_DEPLOY


@pytest.mark.parametrize(
    "admission_app",
    [(AppMode.WORKFLOW, "app", WhereisUserArg.JSON), (AppMode.ADVANCED_CHAT, "resource", WhereisUserArg.JSON)],
    indirect=True,
)
@pytest.mark.parametrize("route", ["scalar", "legacy"])
def test_draft_auth_does_not_block_workspace_publication_and_republication_takes_effect(
    admission_app: AdmissionApp, sqlite_session_factory: sessionmaker[Session], route: str
) -> None:
    _publish(admission_app, sqlite_session_factory, credential_source="workspace")
    _publish(admission_app, sqlite_session_factory, credential_source="end_user", version=Workflow.VERSION_DRAFT)
    client = admission_app.flask.test_client()
    headers = {"Authorization": f"Bearer {admission_app.token}"}

    response = client.post(f"/{route}", headers=headers, json={"user": "api-user"})
    assert response.status_code == 200
    assert response.json is not None
    end_user_id = response.json["end_user_id"]
    assert len(admission_app.logins) == 1
    with sqlite_session_factory() as session:
        user = session.get_one(EndUser, end_user_id)
        assert user.type == EndUserType.SERVICE_API
        assert user.session_id == "api-user"

    _publish(admission_app, sqlite_session_factory, credential_source="end_user", version="next")
    response = client.post(f"/{route}", headers=headers, json={"user": "api-user"})
    assert response.status_code == 403
    assert len(admission_app.logins) == 1

    _publish(admission_app, sqlite_session_factory, credential_source="workspace", version="restored")
    response = client.post(f"/{route}", headers=headers, json={"user": "api-user"})
    assert response.status_code == 200
    assert response.json is not None
    assert response.json["end_user_id"] == end_user_id


@pytest.mark.parametrize(
    "admission_app",
    [(AppMode.WORKFLOW, "app", WhereisUserArg.JSON), (AppMode.ADVANCED_CHAT, "resource", WhereisUserArg.JSON)],
    indirect=True,
)
def test_end_user_auth_preserves_app_and_account_only_access(
    admission_app: AdmissionApp, sqlite_session_factory: sessionmaker[Session]
) -> None:
    _publish(admission_app, sqlite_session_factory, credential_source="end_user")
    client = admission_app.flask.test_client()
    headers = {"Authorization": f"Bearer {admission_app.token}"}

    assert client.post("/app-only", headers=headers).json == {"app_id": admission_app.app_id}
    assert client.post("/account-only", headers=headers).json == {"account_id": admission_app.account_id}
    assert admission_app.logins == []
    assert client.post("/legacy-account-only", headers=headers).json == {"app_id": admission_app.app_id}
    assert len(admission_app.logins) == 1
    assert admission_app.logins[0] == admission_app.account_id
    with sqlite_session_factory() as session:
        assert session.scalar(select(EndUser.id)) is None


@pytest.mark.parametrize(
    "admission_app",
    [
        (mode, token_kind, WhereisUserArg.JSON)
        for mode in (AppMode.WORKFLOW, AppMode.ADVANCED_CHAT)
        for token_kind in ("app", "resource")
    ],
    indirect=True,
)
@pytest.mark.parametrize("response_mode", ["blocking", "streaming"])
def test_actual_execution_route_rejects_personal_auth_in_historical_version(
    admission_app: AdmissionApp,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
    response_mode: str,
) -> None:
    config_overrides(APP_DEFAULT_ACTIVE_REQUESTS=0, APP_MAX_ACTIVE_REQUESTS=0)
    protected_id = _publish(admission_app, sqlite_session_factory, credential_source="end_user", version="old")
    _publish(admission_app, sqlite_session_factory, credential_source="workspace", version="current")
    admission_app.flask.register_blueprint(service_api_blueprint)
    with sqlite_session_factory() as session:
        app_model = session.get_one(App, admission_app.app_id)
        mode = app_model.mode
    payload: dict[str, object] = {"inputs": {}, "user": "api-user", "response_mode": response_mode}
    if mode == AppMode.ADVANCED_CHAT:
        route = "/v1/chat-messages"
        payload.update(query="Hello", workflow_id=protected_id)
    else:
        route = f"/v1/workflows/{protected_id}/run"

    response = admission_app.flask.test_client().post(
        route, headers={"Authorization": f"Bearer {admission_app.token}"}, json=payload
    )

    assert response.status_code == 403
    assert response.json == {
        "code": "forbidden",
        "message": "Service API end-user access is unavailable for apps that require EndUser authentication.",
        "status": 403,
    }
    with sqlite_session_factory() as session:
        assert session.scalar(select(WorkflowRun.id)) is None
