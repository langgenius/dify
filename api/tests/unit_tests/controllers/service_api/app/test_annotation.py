"""Service API annotation contracts through real admission, SQLite and application wiring."""

import logging
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta
from io import StringIO
from typing import Literal
from uuid import uuid4

import pytest
from flask import Blueprint, Flask, Response
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from pydantic import ValidationError
from redis import Redis
from sqlalchemy import Connection, Engine, delete, event, select, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

from controllers.service_api.app import annotation as annotation_module
from controllers.service_api.app.annotation import (
    AnnotationCreatePayload,
    AnnotationListQuery,
    AnnotationReplyActionPayload,
)
from core.logging.context import clear_request_context
from core.logging.filters import IdentityContextFilter
from enums import DeploymentEdition
from enums.account import TenantAccountRole
from extensions.ext_application_services import build_application_services
from extensions.ext_redis import RedisClientWrapper
from extensions.otel.runtime import on_user_loaded, set_identity_span_attributes
from extensions.otel.semconv import DifySpanAttributes, GenAIAttributes
from libs.external_api import ExternalApi
from models import Account, App, EndUser, Tenant
from models.account import AccountStatus, TenantAccountJoin, TenantStatus
from models.dataset import Dataset
from models.model import AppAnnotationHitHistory, MessageAnnotation
from models.resource_access_token import (
    ResourceAccessToken,
    ResourceAccessTokenRelation,
    ResourceAccessTokenResourceType,
)
from tests.unit_tests.model_factories import make_account, make_app

type _Operation = Literal["list", "create", "update", "delete", "reply", "status"]
_OPERATIONS: tuple[_Operation, ...] = ("list", "create", "update", "delete", "reply", "status")
_TIME = datetime(2026, 1, 2, 3, 4, 5)
_REPLY_PAYLOAD = {"score_threshold": 0.5, "embedding_provider_name": "openai", "embedding_model_name": "embedding"}


@dataclass(frozen=True)
class _Harness:
    app: Flask
    account: Account
    target: App
    annotation: MessageAnnotation
    token: ResourceAccessToken
    factory: sessionmaker[Session]
    sessions: list[Session]

    def request(
        self,
        operation: _Operation,
        *,
        payload: dict[str, object] | None = None,
        annotation_id: str | None = None,
        action: str = "invalid",
        query: dict[str, object] | None = None,
        authorization: str | None = "default",
        requested_app_id: str | None = None,
    ) -> TestResponse:
        routes = {
            "list": ("GET", "/v1/apps/annotations"),
            "create": ("POST", "/v1/apps/annotations"),
            "update": ("PUT", f"/v1/apps/annotations/{annotation_id or self.annotation.id}"),
            "delete": ("DELETE", f"/v1/apps/annotations/{annotation_id or self.annotation.id}"),
            "reply": ("POST", f"/v1/apps/annotation-reply/{action}"),
            "status": ("GET", f"/v1/apps/annotation-reply/{action}/status/{uuid4()}"),
        }
        method, path = routes[operation]
        headers = {}
        if authorization is not None:
            headers["Authorization"] = f"Bearer {self.token.token}" if authorization == "default" else authorization
        if requested_app_id is not None:
            headers["X-Dify-App-ID"] = requested_app_id
        response = self.app.test_client().open(path, method=method, json=payload, query_string=query, headers=headers)
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)
        if response.status_code == 204:
            assert response.data == b""
        else:
            assert response.headers["Content-Type"] == "application/json"
            assert int(response.headers["Content-Length"]) == len(response.data)
        return response


@pytest.fixture
def harness(
    config_overrides: Callable[..., None], sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]
) -> Iterator[_Harness]:
    clear_request_context()
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, RBAC_ENABLED=False)
    tenant = Tenant(name="Service API annotation workspace")
    account = make_account(account_id=str(uuid4()))
    target = make_app(app_id=str(uuid4()), tenant_id=tenant.id)
    annotation = MessageAnnotation(
        app_id=target.id, question="First question", content="First answer", account_id=account.id
    )
    annotation.created_at = _TIME
    annotation.hit_count = 3
    token = ResourceAccessToken(
        id=str(uuid4()),
        tenant_id=tenant.id,
        name="Annotation integration",
        track_id=uuid4().hex,
        token=f"sk-{uuid4()}",
        created_by=account.id,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                tenant,
                account,
                target,
                annotation,
                token,
                TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER),
                ResourceAccessTokenRelation(
                    token_id=token.id, resource_type=ResourceAccessTokenResourceType.APP, app_id=target.id
                ),
            ]
        )
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
    client = Redis()
    redis = RedisClientWrapper()
    redis.initialize(client)
    app.extensions["application_services"] = build_application_services(
        database_client=factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=redis,
    )
    blueprint = Blueprint("service_api_annotations", __name__, url_prefix="/v1")
    api = ExternalApi(blueprint)
    api.add_resource(annotation_module.AnnotationListApi, "/apps/annotations")
    api.add_resource(annotation_module.AnnotationUpdateDeleteApi, "/apps/annotations/<uuid:annotation_id>")
    api.add_resource(annotation_module.AnnotationReplyActionApi, "/apps/annotation-reply/<string:action>")
    api.add_resource(
        annotation_module.AnnotationReplyActionStatusApi, "/apps/annotation-reply/<string:action>/status/<uuid:job_id>"
    )
    app.register_blueprint(blueprint)
    sessions: list[Session] = []

    def track(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    event.listen(factory, "after_begin", track)
    try:
        yield _Harness(app, account, target, annotation, token, factory, sessions)
    finally:
        event.remove(factory, "after_begin", track)
        assert client.connection_pool._created_connections == 0
        client.close()
        clear_request_context()


def _error(response: TestResponse, *, status: int, code: str, message: str | None = None) -> None:
    assert response.status_code == status
    body = response.get_json()
    assert body["code"] == code
    assert body["status"] == status
    if message is not None:
        assert body["message"] == message
    if status == 401:
        assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'


def _annotation(harness: _Harness, index: int, *, app_id: str | None = None) -> MessageAnnotation:
    annotation = MessageAnnotation(
        app_id=app_id or harness.target.id,
        question=f"Question {index}",
        content=f"Answer {index}",
        account_id=harness.account.id,
    )
    annotation.created_at = _TIME + timedelta(seconds=index)
    return annotation


def test_list_preserves_shape_order_pagination_and_app_scope(harness: _Harness) -> None:
    second = _annotation(harness, 1)
    other = make_app(app_id=str(uuid4()), tenant_id=harness.target.tenant_id)
    foreign = make_app(app_id=str(uuid4()), tenant_id=str(uuid4()))
    with harness.factory.begin() as session:
        session.add_all(
            [
                second,
                other,
                foreign,
                _annotation(harness, 2, app_id=other.id),
                _annotation(harness, 3, app_id=foreign.id),
            ]
        )
    response = harness.request("list", query={"limit": 1})
    assert response.status_code == 200
    assert response.get_json() == {
        "data": [
            {
                "id": second.id,
                "question": "Question 1",
                "answer": "Answer 1",
                "hit_count": 0,
                "created_at": int(second.created_at.timestamp()),
            }
        ],
        "has_more": True,
        "limit": 1,
        "total": 2,
        "page": 1,
    }
    last = harness.request("list", query={"limit": 1, "page": 2}).get_json()
    assert last["data"][0]["id"] == harness.annotation.id
    assert last["has_more"] is False
    assert harness.request("list", query={"limit": 1, "page": 3}).get_json() == {
        "data": [],
        "has_more": False,
        "limit": 1,
        "total": 2,
        "page": 3,
    }


def test_list_caps_limit_at_100(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.add_all(_annotation(harness, index) for index in range(1, 102))
    body = harness.request("list", query={"limit": 1000}).get_json()
    assert (body["page"], body["limit"], body["total"], body["has_more"]) == (1, 100, 102, True)
    assert len(body["data"]) == 100


def test_keyword_escapes_wildcards_and_searches_question_and_answer(harness: _Harness) -> None:
    question, answer, decoy = (_annotation(harness, index) for index in range(1, 4))
    question.question = "50%_Case\\ marker"
    answer.content = "Answer has 50%_case\\ marker"
    decoy.question = "500XCase marker"
    with harness.factory.begin() as session:
        session.add_all([question, answer, decoy])
    body = harness.request("list", query={"keyword": "50%_case\\"}).get_json()
    assert body["total"] == 2
    assert [row["id"] for row in body["data"]] == [answer.id, question.id]


@pytest.mark.parametrize("field", ["page", "limit"])
@pytest.mark.parametrize("value", ["abc", "1.5", "1e2", "", "0", "-1"])
def test_list_rejects_invalid_pagination(harness: _Harness, field: str, value: str) -> None:
    _error(harness.request("list", query={field: value}), status=422, code="unprocessable_entity")


@pytest.mark.parametrize(("question", "answer"), [("什么是人工智能？", "AI & ML <b>100%</b>"), ("", "")])
def test_create_persists_owner_and_preserves_empty_strings(harness: _Harness, question: str, answer: str) -> None:
    response = harness.request("create", payload={"question": question, "answer": answer})
    assert response.status_code == 201
    body = response.get_json()
    with harness.factory() as session:
        stored = session.get(MessageAnnotation, body["id"])
        assert stored is not None
        assert (stored.app_id, stored.account_id, stored.conversation_id, stored.message_id) == (
            harness.target.id,
            harness.account.id,
            None,
            None,
        )
        assert body == {
            "id": stored.id,
            "question": question,
            "answer": answer,
            "hit_count": 0,
            "created_at": int(stored.created_at.timestamp()),
        }
        assert (stored.question, stored.content) == (question, answer)


@pytest.mark.parametrize(("question", "answer"), [("Updated question", "Updated answer"), ("", "")])
def test_update_preserves_annotation_identity_and_hit_count(harness: _Harness, question: str, answer: str) -> None:
    response = harness.request("update", payload={"question": question, "answer": answer})
    assert response.status_code == 200
    assert response.get_json() == {
        "id": harness.annotation.id,
        "question": question,
        "answer": answer,
        "hit_count": 3,
        "created_at": int(_TIME.timestamp()),
    }
    with harness.factory() as session:
        stored = session.get(MessageAnnotation, harness.annotation.id)
        assert stored is not None
        assert (stored.question, stored.content, stored.account_id) == (question, answer, harness.account.id)


@pytest.mark.parametrize("operation", ["create", "update"])
@pytest.mark.parametrize(
    "payload",
    [{}, {"question": "Q"}, {"answer": "A"}, {"question": None, "answer": "A"}, {"question": "Q", "answer": 42}],
)
def test_writes_validate_payload_without_changing_annotation(
    harness: _Harness, operation: _Operation, payload: dict[str, object]
) -> None:
    _error(harness.request(operation, payload=payload), status=422, code="unprocessable_entity")
    with harness.factory() as session:
        stored = session.scalars(select(MessageAnnotation)).one()
        assert (stored.question, stored.content) == ("First question", "First answer")


def test_delete_removes_annotation_and_only_its_owned_hit_histories(harness: _Harness) -> None:
    histories = [
        AppAnnotationHitHistory(
            app_id=app_id,
            annotation_id=annotation_id,
            source="hit-testing",
            question="Asked",
            account_id=harness.account.id,
            score=0.9,
            message_id=str(uuid4()),
            annotation_question="Matched",
            annotation_content="Responded",
        )
        for app_id, annotation_id in [
            (harness.target.id, harness.annotation.id),
            (str(uuid4()), harness.annotation.id),
            (harness.target.id, str(uuid4())),
        ]
    ]
    with harness.factory.begin() as session:
        session.add_all(histories)
    assert harness.request("delete").status_code == 204
    with harness.factory() as session:
        assert session.get(MessageAnnotation, harness.annotation.id) is None
        assert set(session.scalars(select(AppAnnotationHitHistory.id))) == {histories[1].id, histories[2].id}


@pytest.mark.parametrize("operation", ["update", "delete"])
@pytest.mark.parametrize("scope", ["missing", "other_app", "other_tenant"])
def test_annotation_mutation_enforces_app_and_tenant_scope(
    harness: _Harness, operation: _Operation, scope: str
) -> None:
    annotation_id = str(uuid4())
    if scope != "missing":
        other = make_app(
            app_id=str(uuid4()), tenant_id=harness.target.tenant_id if scope == "other_app" else str(uuid4())
        )
        with harness.factory.begin() as session:
            session.add(other)
            session.execute(
                update(MessageAnnotation).where(MessageAnnotation.id == harness.annotation.id).values(app_id=other.id)
            )
        annotation_id = harness.annotation.id
    _error(
        harness.request(operation, annotation_id=annotation_id, payload={"question": "Changed", "answer": "Changed"}),
        status=404,
        code="not_found",
        message="Annotation not found",
    )
    with harness.factory() as session:
        stored = session.get(MessageAnnotation, harness.annotation.id)
        assert stored is not None
        assert (stored.question, stored.content) == ("First question", "First answer")


@pytest.mark.parametrize("operation", _OPERATIONS)
@pytest.mark.parametrize(
    "authorization", [None, "", "Bearer", "Bearer ", "Bearer    ", "Basic secret", "Bearer sk-missing"]
)
def test_every_handler_rejects_missing_malformed_or_unknown_credentials(
    harness: _Harness, operation: _Operation, authorization: str | None
) -> None:
    _error(
        harness.request(operation, authorization=authorization, payload=_REPLY_PAYLOAD), status=401, code="unauthorized"
    )


@pytest.mark.parametrize("operation", _OPERATIONS)
@pytest.mark.parametrize(
    ("gate", "status", "message"),
    [
        ("missing_app", 403, "The app no longer exists."),
        ("foreign_tenant", 403, "The app no longer exists."),
        ("api_disabled", 403, "The app's API service has been disabled."),
        ("missing_tenant", 400, "Tenant does not exist."),
        ("archived_tenant", 403, "The workspace's status is archived."),
        ("missing_owner", 401, "Tenant owner account not found or tenant is not active."),
        ("missing_account", 401, "Tenant owner account not found or tenant is not active."),
    ],
)
def test_every_handler_checks_app_workspace_and_owner(
    harness: _Harness, operation: _Operation, gate: str, status: int, message: str
) -> None:
    with harness.factory.begin() as session:
        if gate == "missing_app":
            session.execute(delete(App).where(App.id == harness.target.id))
        elif gate == "foreign_tenant":
            session.execute(update(App).where(App.id == harness.target.id).values(tenant_id=str(uuid4())))
        elif gate == "api_disabled":
            session.execute(update(App).where(App.id == harness.target.id).values(enable_api=False))
        elif gate == "missing_tenant":
            session.execute(delete(Tenant).where(Tenant.id == harness.target.tenant_id))
        elif gate == "archived_tenant":
            session.execute(
                update(Tenant).where(Tenant.id == harness.target.tenant_id).values(status=TenantStatus.ARCHIVE)
            )
        elif gate == "missing_owner":
            session.execute(
                update(TenantAccountJoin)
                .where(TenantAccountJoin.account_id == harness.account.id)
                .values(role=TenantAccountRole.ADMIN)
            )
        else:
            session.execute(delete(Account).where(Account.id == harness.account.id))
    _error(
        harness.request(operation, payload=_REPLY_PAYLOAD),
        status=status,
        code={400: "invalid_param", 401: "unauthorized", 403: "forbidden"}[status],
        message=message,
    )


@pytest.mark.parametrize("account_status", list(AccountStatus))
def test_account_console_status_does_not_disable_machine_access(
    harness: _Harness, account_status: AccountStatus
) -> None:
    with harness.factory.begin() as session:
        session.execute(update(Account).where(Account.id == harness.account.id).values(status=account_status))
        session.execute(
            update(App).where(App.id == harness.target.id).values(is_demo=True, is_public=True, is_universal=True)
        )
    assert harness.request("create", payload={"question": "Q", "answer": "A"}).status_code == 201


@pytest.mark.parametrize("revocation", ["token", "binding"])
def test_resource_token_revocation_is_effective_on_the_next_request(harness: _Harness, revocation: str) -> None:
    assert harness.request("list").status_code == 200
    with harness.factory.begin() as session:
        if revocation == "token":
            session.execute(delete(ResourceAccessToken).where(ResourceAccessToken.id == harness.token.id))
        else:
            session.execute(
                delete(ResourceAccessTokenRelation).where(ResourceAccessTokenRelation.token_id == harness.token.id)
            )
    _error(
        harness.request("list"),
        status=401 if revocation == "token" else 403,
        code="unauthorized" if revocation == "token" else "forbidden",
    )


def test_resource_token_creator_does_not_replace_the_workspace_owner(harness: _Harness) -> None:
    creator = make_account(account_id=str(uuid4()), email="integration@example.com")
    with harness.factory.begin() as session:
        session.add_all(
            [
                creator,
                TenantAccountJoin(
                    tenant_id=harness.target.tenant_id,
                    account_id=creator.id,
                    role=TenantAccountRole.NORMAL,
                ),
            ]
        )
        session.execute(
            update(ResourceAccessToken).where(ResourceAccessToken.id == harness.token.id).values(created_by=creator.id)
        )
    response = harness.request("create", payload={"question": "Q", "answer": "A"})
    assert response.status_code == 201
    with harness.factory() as session:
        annotation = session.get(MessageAnnotation, response.get_json()["id"])
        assert annotation is not None
        assert annotation.account_id == harness.account.id


def test_knowledge_binding_never_authorizes_annotation_access(harness: _Harness) -> None:
    dataset = Dataset(
        id=str(uuid4()), tenant_id=harness.target.tenant_id, name="Knowledge", created_by=harness.account.id
    )
    with harness.factory.begin() as session:
        session.add(dataset)
        session.execute(
            update(ResourceAccessTokenRelation)
            .where(ResourceAccessTokenRelation.token_id == harness.token.id)
            .values(resource_type=ResourceAccessTokenResourceType.KNOWLEDGE, app_id=None, dataset_id=dataset.id)
        )
    _error(harness.request("list"), status=403, code="forbidden")


def test_resource_token_requires_explicit_selection_for_multiple_bound_apps(harness: _Harness) -> None:
    other = make_app(app_id=str(uuid4()), tenant_id=harness.target.tenant_id)
    annotation = _annotation(harness, 1, app_id=other.id)
    with harness.factory.begin() as session:
        session.add_all(
            [
                other,
                annotation,
                ResourceAccessTokenRelation(
                    token_id=harness.token.id,
                    resource_type=ResourceAccessTokenResourceType.APP,
                    app_id=other.id,
                ),
            ]
        )
    _error(harness.request("list"), status=400, code="invalid_param")
    for app, expected in [(harness.target, harness.annotation), (other, annotation)]:
        response = harness.request("list", requested_app_id=app.id)
        assert response.status_code == 200
        assert [row["id"] for row in response.get_json()["data"]] == [expected.id]
    _error(harness.request("list", requested_app_id=str(uuid4())), status=403, code="forbidden")


@pytest.mark.parametrize("operation", ["reply", "status"])
def test_reply_rejects_invalid_action_before_touching_jobs(harness: _Harness, operation: _Operation) -> None:
    _error(harness.request(operation, action="invalid", payload=_REPLY_PAYLOAD), status=400, code="invalid_param")


@pytest.mark.parametrize("action", ["enable", "disable"])
@pytest.mark.parametrize("payload", [None, {}, {"score_threshold": 0.5}])
def test_reply_enable_and_disable_require_the_payload(
    harness: _Harness, action: str, payload: dict[str, object] | None
) -> None:
    _error(harness.request("reply", action=action, payload=payload), status=422, code="unprocessable_entity")


def test_payload_models_preserve_defaults_numeric_strings_and_zero_threshold() -> None:
    assert AnnotationListQuery.model_validate({}).model_dump() == {"page": 1, "limit": 20, "keyword": ""}
    assert AnnotationListQuery.model_validate({"page": "2", "limit": "5", "keyword": "refund"}).model_dump() == {
        "page": 2,
        "limit": 5,
        "keyword": "refund",
    }
    assert AnnotationCreatePayload(question="", answer="").model_dump() == {"question": "", "answer": ""}
    assert (
        AnnotationReplyActionPayload.model_validate({**_REPLY_PAYLOAD, "score_threshold": 0.0}).score_threshold == 0.0
    )
    with pytest.raises(ValidationError):
        AnnotationCreatePayload.model_validate({"question": "Q"})


@pytest.mark.parametrize("otel_enabled", [False, True])
@pytest.mark.parametrize("authenticated", [False, True])
def test_admission_preserves_logging_and_trace_identity(
    harness: _Harness, config_overrides: Callable[..., None], otel_enabled: bool, authenticated: bool
) -> None:
    config_overrides(ENABLE_OTEL=otel_enabled)
    output = StringIO()
    handler = logging.StreamHandler(output)
    handler.addFilter(IdentityContextFilter())
    handler.setFormatter(logging.Formatter("%(tenant_id)s|%(user_id)s|%(user_type)s"))
    logger = logging.Logger("annotation-admission-identity", logging.INFO)
    logger.addHandler(handler)

    @harness.app.after_request
    def log_response(response: Response) -> Response:
        logger.info("Annotation response")
        return response

    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    try:
        with provider.get_tracer(__name__).start_as_current_span("annotation request"):
            response = harness.request("list", authorization="default" if authenticated else None)
        assert response.status_code == (200 if authenticated else 401)
        expected_log = f"{harness.target.tenant_id}|{harness.account.id}|account" if authenticated else "||"
        assert output.getvalue().strip() == expected_log
        [span] = exporter.get_finished_spans()
        assert span.attributes == (
            {DifySpanAttributes.TENANT_ID: harness.target.tenant_id, GenAIAttributes.USER_ID: harness.account.id}
            if otel_enabled and authenticated
            else {}
        )
    finally:
        provider.shutdown()
        handler.close()


@pytest.mark.parametrize("user_type", ["account", "end_user"])
def test_legacy_login_signal_preserves_identity_span_attributes(
    config_overrides: Callable[..., None], user_type: str
) -> None:
    config_overrides(ENABLE_OTEL=True)
    tenant = Tenant(name="Tracing workspace")
    account = make_account(account_id=str(uuid4()), tenant=tenant)
    user = account if user_type == "account" else EndUser(id=str(uuid4()), tenant_id=tenant.id, type="browser")
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    try:
        with provider.get_tracer(__name__).start_as_current_span("legacy login"):
            on_user_loaded(None, user)
        [span] = exporter.get_finished_spans()
        assert span.attributes == {DifySpanAttributes.TENANT_ID: tenant.id, GenAIAttributes.USER_ID: user.id}
    finally:
        provider.shutdown()


@pytest.mark.parametrize("unavailable", ["tenant", "recording_span"])
def test_span_identity_skips_missing_tenant_and_ended_spans(
    config_overrides: Callable[..., None], caplog: pytest.LogCaptureFixture, unavailable: str
) -> None:
    config_overrides(ENABLE_OTEL=True)
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    span = provider.get_tracer(__name__).start_span("unavailable identity context")
    try:
        if unavailable == "recording_span":
            span.end()
        with trace.use_span(span, end_on_exit=False), caplog.at_level(logging.WARNING):
            set_identity_span_attributes(tenant_id=None if unavailable == "tenant" else "workspace", user_id="account")
        if unavailable != "recording_span":
            span.end()
        [finished] = exporter.get_finished_spans()
        assert finished.attributes == {}
        assert "Setting attribute on ended span" not in caplog.text
        assert "Error setting tenant and user attributes" not in caplog.text
    finally:
        provider.shutdown()
