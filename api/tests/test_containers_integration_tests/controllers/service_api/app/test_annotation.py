"""Real Service API HTTP admission, PostgreSQL, Redis and Celery publications.

Workers are not executed: the memory broker verifies published messages without
calling embedding providers or vector stores. Container execution belongs to CI.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, replace
from queue import Empty
from typing import Literal
from uuid import UUID, uuid4

import pytest
from celery import Celery, Task
from celery.signals import before_task_publish
from flask import Flask, g
from flask_login import user_logged_in
from kombu.simple import SimpleQueue
from sqlalchemy import Connection, ExecutionContext, delete, event, func, select, text, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from constants.resource_access_token import ResourceAccessTokenResourceType
from controllers.console.wraps import _is_setup_completed
from enums import DeploymentEdition
from enums.account import TenantAccountRole
from extensions.ext_application_services import ApplicationServices
from extensions.ext_database import db
from extensions.ext_redis import RedisClientWrapper
from libs.datetime_utils import naive_utc_now
from libs.passport import PassportService
from libs.token import generate_csrf_token
from machinery.context import RequestContext
from models import Account, App, Tenant
from models.account import AccountStatus, TenantAccountJoin, TenantStatus
from models.enums import ApiTokenType
from models.model import ApiToken, AppAnnotationSetting, DifySetup, EndUser, MessageAnnotation
from repositories.annotation_reply_job_repository import (
    RedisAnnotationReplyJobRepository,
    annotation_reply_job_owner_key,
)
from repositories.annotation_repository import AnnotationRepository
from services.annotation_command_service import AnnotationCommandService
from services.annotation_reply_service import AnnotationReplyAction, AnnotationReplyService
from services.api_token_service import ApiTokenCache
from services.auth.resource_access_token_contracts import ResourceAccessTokenCreateResult, ResourceAccessTokenResource
from tasks.annotation.add_annotation_to_index_task import add_annotation_to_index_task
from tasks.annotation.delete_annotation_index_task import delete_annotation_index_task
from tasks.annotation.disable_annotation_reply_task import disable_annotation_reply_task
from tasks.annotation.enable_annotation_reply_task import enable_annotation_reply_task
from tasks.annotation.update_annotation_to_index_task import update_annotation_to_index_task
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.model_factories import make_account, make_app

_REPLY_PAYLOAD: dict[str, object] = {
    "score_threshold": 0.75,
    "embedding_provider_name": "openai",
    "embedding_model_name": "text-embedding-3-small",
}
_ANNOTATION_PAYLOAD: dict[str, object] = {"question": "Question", "answer": "Answer"}
_ENDPOINTS = [
    ("GET", "/annotations"),
    ("POST", "/annotations"),
    ("PUT", "/annotations/{id}"),
    ("DELETE", "/annotations/{id}"),
    ("POST", "/annotation-reply/enable"),
    ("GET", "/annotation-reply/enable/status/{id}"),
]
type Credential = Literal["key", "resource"]


@dataclass(frozen=True)
class _Harness:
    app: Flask
    services: ApplicationServices
    account: Account
    target: App
    other: App
    foreign: App
    api_key: ApiToken
    other_key: ApiToken
    factory: sessionmaker[Session]
    redis: RedisClientWrapper
    celery: Celery
    tasks: dict[str, Task[..., None]]
    queue: str
    sessions: list[Session]
    publications: list[bool]
    logins: list[object]
    token_reads: list[str]

    @property
    def context(self) -> RequestContext:
        return RequestContext("annotation-test", None, self.account.id, self.target.tenant_id)

    def request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, object] | None = None,
        token: str | None = None,
        authorization: str | None = None,
        app_id: str | None = None,
    ) -> TestResponse:
        headers = {
            "Authorization": authorization if authorization is not None else f"Bearer {token or self.api_key.token}"
        }
        if authorization == "":
            headers.clear()
        if app_id is not None:
            headers["X-Dify-App-ID"] = app_id
        with self.app.test_client() as client:
            response = client.open(f"/v1/apps{path}", method=method, json=payload, headers=headers)
            assert not isinstance(g.get("_login_user"), (Account, EndUser))
        with self.factory() as session:
            assert session.scalar(select(func.count()).select_from(EndUser)) == 0
        if response.status_code != 204:
            assert response.headers["Content-Type"] == "application/json"
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)
        assert self.logins == []
        return response

    def resource_token(self, *app_ids: str) -> ResourceAccessTokenCreateResult:
        return self.services.resource_access_tokens.create(
            self.context,
            name="Annotation integration key",
            resources=tuple(
                ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.APP, id=app_id)
                for app_id in app_ids or (self.target.id,)
            ),
        )

    def credential(self, kind: Credential) -> str:
        return self.api_key.token if kind == "key" else self.resource_token().token

    def consume_task(self, name: str, expected: dict[str, object]) -> None:
        with self.celery.connection_for_read() as connection, SimpleQueue(connection, self.queue) as messages:
            message = messages.get(block=False)
            assert message.headers["task"] == self.tasks[name].name
            assert message.payload[0] == []
            assert message.payload[1] == expected
            message.ack()
            with pytest.raises(Empty):
                messages.get(block=False)


@pytest.fixture
def harness(flask_app_with_containers: Flask) -> Iterator[_Harness]:
    app = flask_app_with_containers
    services = app.extensions["application_services"]
    assert isinstance(services, ApplicationServices)
    redis = app.extensions["redis"]
    assert isinstance(redis, RedisClientWrapper)
    with app.app_context():
        engine = db.engine
        factory = sessionmaker(bind=engine, expire_on_commit=False)
    workspace = Tenant(name="Service API annotation workspace")
    foreign_workspace = Tenant(name="Other annotation workspace")
    account = make_account(account_id=str(uuid4()), email=f"{uuid4()}@example.com")
    account.last_active_at = naive_utc_now()
    target = make_app(app_id=str(uuid4()), tenant_id=workspace.id)
    other = make_app(app_id=str(uuid4()), tenant_id=workspace.id)
    foreign = make_app(app_id=str(uuid4()), tenant_id=foreign_workspace.id)
    api_key = ApiToken(app_id=target.id, tenant_id=workspace.id, type=ApiTokenType.APP, token=f"app-{uuid4()}")
    other_key = ApiToken(app_id=other.id, tenant_id=workspace.id, type=ApiTokenType.APP, token=f"app-{uuid4()}")
    with factory.begin() as session:
        session.add_all(
            [
                workspace,
                foreign_workspace,
                account,
                target,
                other,
                foreign,
                api_key,
                other_key,
                TenantAccountJoin(
                    tenant_id=workspace.id, account_id=account.id, role=TenantAccountRole.OWNER, current=True
                ),
                DifySetup(version="test"),
            ]
        )
    queue = f"service-api-annotation-{uuid4()}"
    celery = Celery(queue, broker="memory://", set_as_current=False)
    celery.conf.update(task_default_queue=queue, task_ignore_result=True, task_publish_retry=False)
    tasks: dict[str, Task[..., None]] = {
        "add": celery.task(name=add_annotation_to_index_task.name, shared=False)(add_annotation_to_index_task.run),
        "update": celery.task(name=update_annotation_to_index_task.name, shared=False)(
            update_annotation_to_index_task.run
        ),
        "delete": celery.task(name=delete_annotation_index_task.name, shared=False)(delete_annotation_index_task.run),
        "enable": celery.task(name=enable_annotation_reply_task.name, shared=False)(enable_annotation_reply_task.run),
        "disable": celery.task(name=disable_annotation_reply_task.name, shared=False)(
            disable_annotation_reply_task.run
        ),
    }
    annotations = AnnotationRepository(session_factory=factory)
    app.extensions["application_services"] = replace(
        services,
        annotation_queries=annotations,
        annotation_commands=AnnotationCommandService(
            annotations=annotations,
            add_index=tasks["add"].delay,
            update_index=tasks["update"].delay,
            delete_index=tasks["delete"].delay,
        ),
        annotation_reply=AnnotationReplyService(
            apps=annotations,
            jobs=RedisAnnotationReplyJobRepository(redis=redis),
            enable_task=tasks["enable"].delay,
            disable_task=tasks["disable"].delay,
        ),
    )
    sessions: list[Session] = []
    publications: list[bool] = []
    logins: list[object] = []
    token_reads: list[str] = []

    def track(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    def observe_publish(**_kwargs: object) -> None:
        publications.append(all(not session.in_transaction() and not session.identity_map for session in sessions))

    def observe_login(_sender: object, user: object) -> None:
        logins.append(user)

    def observe_query(
        _connection: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: ExecutionContext,
        _executemany: bool,
    ) -> None:
        if statement.lstrip().upper().startswith("SELECT") and "api_tokens" in statement:
            token_reads.append(statement)

    event.listen(Session, "after_begin", track)
    event.listen(engine, "before_cursor_execute", observe_query)
    before_task_publish.connect(observe_publish, weak=True)
    user_logged_in.connect(observe_login, weak=True)
    _is_setup_completed.reset_success()
    try:
        with config_overrides_context(
            DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
            SECRET_KEY="service-api-annotation-passport-key-32-bytes",
            LOGIN_DISABLED=False,
            INIT_PASSWORD="",
            CONSOLE_API_URL="http://localhost",
            CONSOLE_WEB_URL="http://localhost",
            COOKIE_DOMAIN="",
            RBAC_ENABLED=False,
        ):
            with app.app_context():
                assert _is_setup_completed()
                db.session.remove()
            yield _Harness(
                app,
                services,
                account,
                target,
                other,
                foreign,
                api_key,
                other_key,
                factory,
                redis,
                celery,
                tasks,
                queue,
                sessions,
                publications,
                logins,
                token_reads,
            )
    finally:
        app.extensions["application_services"] = services
        del observe_publish
        user_logged_in.disconnect(observe_login)
        event.remove(Session, "after_begin", track)
        event.remove(engine, "before_cursor_execute", observe_query)
        with celery.connection_for_read() as connection, SimpleQueue(connection, queue) as messages:
            messages.clear()
        celery.close()
        _is_setup_completed.reset_success()
        with app.app_context():
            db.session.remove()


@pytest.mark.parametrize("credential", ["key", "resource"])
def test_crud_publishes_scoped_index_tasks_after_sessions_close(harness: _Harness, credential: Credential) -> None:
    token = harness.credential(credential)
    binding_id = str(uuid4())
    with harness.factory.begin() as session:
        session.add(
            AppAnnotationSetting(
                app_id=harness.target.id,
                score_threshold=0.75,
                collection_binding_id=binding_id,
                created_user_id=harness.account.id,
                updated_user_id=harness.account.id,
            )
        )

    created = harness.request("POST", "/annotations", payload=_ANNOTATION_PAYLOAD, token=token)

    assert created.status_code == 201
    body = created.get_json()
    annotation_id = body["id"]
    assert str(UUID(annotation_id)) == annotation_id
    assert body == {
        "id": annotation_id,
        "question": "Question",
        "answer": "Answer",
        "hit_count": 0,
        "created_at": body["created_at"],
    }
    assert isinstance(body["created_at"], int)
    task_scope: dict[str, object] = {
        "annotation_id": annotation_id,
        "tenant_id": harness.target.tenant_id,
        "app_id": harness.target.id,
        "collection_binding_id": binding_id,
    }
    harness.consume_task("add", {**task_scope, "question": "Question"})
    listed = harness.request("GET", "/annotations", token=token)
    assert listed.status_code == 200
    assert listed.get_json() == {"data": [body], "has_more": False, "limit": 20, "total": 1, "page": 1}
    updated = harness.request(
        "PUT", f"/annotations/{annotation_id}", payload={"question": "", "answer": "Updated answer"}, token=token
    )
    assert updated.status_code == 200
    assert updated.get_json() == {**body, "question": "", "answer": "Updated answer"}
    harness.consume_task("update", {**task_scope, "question": "Updated answer"})
    with harness.factory() as session:
        annotation = session.get(MessageAnnotation, annotation_id)
        assert annotation is not None
        assert (annotation.question, annotation.content, annotation.account_id) == (
            "",
            "Updated answer",
            harness.account.id,
        )

    removed = harness.request("DELETE", f"/annotations/{annotation_id}", token=token)

    assert removed.status_code == 204
    assert removed.data == b""
    harness.consume_task("delete", task_scope)
    assert harness.publications == [True, True, True]
    with harness.factory() as session:
        assert session.get(MessageAnnotation, annotation_id) is None
    assert harness.request("GET", "/annotations", token=token).get_json()["total"] == 0


@pytest.mark.parametrize(("question", "answer"), [("", ""), ("", "Answer"), ("Question", "")])
def test_create_preserves_service_api_empty_strings(harness: _Harness, question: str, answer: str) -> None:
    response = harness.request("POST", "/annotations", payload={"question": question, "answer": answer})

    assert response.status_code == 201
    body = response.get_json()
    assert body["question"] == question
    assert body["answer"] == answer
    with harness.factory() as session:
        annotation = session.get(MessageAnnotation, body["id"])
        assert annotation is not None
        assert (annotation.question, annotation.content, annotation.account_id) == (
            question,
            answer,
            harness.account.id,
        )
    assert harness.publications == []


def test_list_scopes_annotations_and_preserves_pagination_and_literal_search(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.add_all(
            MessageAnnotation(app_id=app_id, question=question, content="Answer", account_id=harness.account.id)
            for app_id, question in (
                (harness.target.id, "100% complete"),
                (harness.target.id, "Ordinary question"),
                (harness.other.id, "Other app 100% complete"),
                (harness.foreign.id, "Foreign workspace 100% complete"),
            )
        )

    first = harness.request("GET", "/annotations?page=1&limit=1").get_json()
    second = harness.request("GET", "/annotations?page=2&limit=1").get_json()
    assert (first["total"], first["page"], first["limit"], first["has_more"]) == (2, 1, 1, True)
    assert (second["total"], second["page"], second["limit"], second["has_more"]) == (2, 2, 1, False)
    assert first["data"][0]["id"] != second["data"][0]["id"]
    filtered = harness.request("GET", "/annotations?keyword=%25&limit=999").get_json()
    assert (filtered["total"], filtered["limit"], filtered["has_more"]) == (1, 100, False)
    assert filtered["data"][0]["question"] == "100% complete"


@pytest.mark.parametrize("method", ["PUT", "DELETE"])
@pytest.mark.parametrize("scope", ["app", "tenant"])
def test_annotation_mutations_reject_other_owners(harness: _Harness, method: str, scope: str) -> None:
    annotation = MessageAnnotation(
        app_id=harness.other.id if scope == "app" else harness.foreign.id,
        question="Other question",
        content="Other answer",
        account_id=harness.account.id,
    )
    with harness.factory.begin() as session:
        session.add(annotation)

    response = harness.request(method, f"/annotations/{annotation.id}", payload=_ANNOTATION_PAYLOAD)

    assert response.status_code == 404
    assert response.get_json()["code"] == "not_found"
    assert harness.publications == []
    with harness.factory() as session:
        preserved = session.get(MessageAnnotation, annotation.id)
        assert preserved is not None
        assert (preserved.question, preserved.content) == ("Other question", "Other answer")


@pytest.mark.parametrize(("method", "path"), _ENDPOINTS)
@pytest.mark.parametrize("credential_state", ["missing", "invalid", "revoked"])
def test_every_handler_requires_a_valid_bearer_key(
    harness: _Harness, method: str, path: str, credential_state: str
) -> None:
    authorization = "" if credential_state == "missing" else f"Bearer app-{uuid4()}"
    if credential_state == "revoked":
        assert harness.request("GET", "/annotations").status_code == 200
        harness.services.app_api_keys.delete_key(harness.context, harness.target.id, harness.api_key.id)
        authorization = f"Bearer {harness.api_key.token}"

    response = harness.request(
        method, path.format(id=uuid4()), payload={**_ANNOTATION_PAYLOAD, **_REPLY_PAYLOAD}, authorization=authorization
    )

    assert response.status_code == 401
    assert response.get_json()["code"] == "unauthorized"
    assert harness.publications == []


def test_api_key_cache_hit_avoids_token_query_and_revocation_invalidates_cache(harness: _Harness) -> None:
    assert harness.request("GET", "/annotations").status_code == 200
    assert len(harness.token_reads) == 1
    cached = ApiTokenCache.get(harness.api_key.token, "app")
    assert cached is not None
    assert (cached.id, cached.app_id) == (harness.api_key.id, harness.target.id)

    assert harness.request("GET", "/annotations").status_code == 200
    assert len(harness.token_reads) == 1
    harness.services.app_api_keys.delete_key(harness.context, harness.target.id, harness.api_key.id)

    response = harness.request("GET", "/annotations")
    assert response.status_code == 401
    assert response.get_json()["code"] == "unauthorized"


@pytest.mark.parametrize(
    ("state", "status"),
    [
        ("app_missing", 403),
        ("api_disabled", 403),
        ("app_abnormal", 403),
        ("tenant_missing", 400),
        ("tenant_archived", 403),
        ("owner_role", 401),
        ("owner_missing", 401),
    ],
)
def test_cached_key_rechecks_application_workspace_and_owner(harness: _Harness, state: str, status: int) -> None:
    assert harness.request("GET", "/annotations").status_code == 200
    with harness.factory.begin() as session:
        match state:
            case "app_missing":
                session.execute(delete(App).where(App.id == harness.target.id))
            case "api_disabled":
                session.execute(update(App).where(App.id == harness.target.id).values(enable_api=False))
            case "app_abnormal":
                session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :id"), {"id": harness.target.id})
            case "tenant_missing":
                session.execute(delete(Tenant).where(Tenant.id == harness.target.tenant_id))
            case "tenant_archived":
                session.execute(
                    update(Tenant).where(Tenant.id == harness.target.tenant_id).values(status=TenantStatus.ARCHIVE)
                )
            case "owner_role":
                session.execute(
                    update(TenantAccountJoin)
                    .where(TenantAccountJoin.account_id == harness.account.id)
                    .values(role=TenantAccountRole.EDITOR)
                )
            case "owner_missing":
                session.execute(delete(Account).where(Account.id == harness.account.id))

    response = harness.request("GET", "/annotations")

    assert response.status_code == status
    assert harness.publications == []


def test_api_key_admission_does_not_require_console_account_login_state(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(update(Account).where(Account.id == harness.account.id).values(status=AccountStatus.BANNED))
        session.execute(
            update(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account.id).values(current=False)
        )

    response = harness.request("POST", "/annotations", payload=_ANNOTATION_PAYLOAD)

    assert response.status_code == 201
    assert harness.publications == []


def test_resource_token_selection_and_revocation(harness: _Harness) -> None:
    resource = harness.resource_token(harness.target.id, harness.other.id)
    assert harness.request("GET", "/annotations", token=resource.token).status_code == 400
    assert harness.request("GET", "/annotations", token=resource.token, app_id=harness.foreign.id).status_code == 403
    created = harness.request(
        "POST", "/annotations", token=resource.token, app_id=harness.other.id, payload=_ANNOTATION_PAYLOAD
    )
    assert created.status_code == 201
    assert (
        harness.request("GET", "/annotations", token=resource.token, app_id=harness.target.id).get_json()["total"] == 0
    )
    assert (
        harness.request("GET", "/annotations", token=resource.token, app_id=harness.other.id).get_json()["total"] == 1
    )

    harness.services.resource_access_tokens.delete_relation(
        harness.context, token_id=resource.token_id, relation_id=resource.rows[0].relation_id
    )

    assert harness.request("GET", "/annotations", token=resource.token, app_id=harness.other.id).status_code == 401


@pytest.mark.parametrize("action", ["enable", "disable"])
@pytest.mark.parametrize("credential", ["key", "resource"])
def test_reply_jobs_share_console_ownership_and_publish_after_sessions_close(
    harness: _Harness, action: AnnotationReplyAction, credential: Credential
) -> None:
    token = harness.credential(credential)
    response = harness.request("POST", f"/annotation-reply/{action}", payload=_REPLY_PAYLOAD, token=token)

    assert response.status_code == 200
    body = response.get_json()
    job_id = body["job_id"]
    assert str(UUID(job_id)) == job_id
    assert body == {"job_id": job_id, "job_status": "waiting"}
    assert harness.redis.get(annotation_reply_job_owner_key(action=action, job_id=job_id)) == (
        f"{harness.target.tenant_id}:{harness.target.id}".encode()
    )
    expected: dict[str, object] = {"job_id": job_id, "app_id": harness.target.id, "tenant_id": harness.target.tenant_id}
    if action == "enable":
        expected.update(_REPLY_PAYLOAD, user_id=harness.account.id)
    harness.consume_task(action, expected)
    assert harness.publications == [True]
    status = harness.request("GET", f"/annotation-reply/{action}/status/{job_id}", token=token)
    assert status.status_code == 200
    expected_status = {"job_id": job_id, "job_status": "waiting", "error_msg": ""}
    assert status.get_json() == expected_status

    client = harness.app.test_client()
    csrf = generate_csrf_token(harness.account.id)
    client.set_cookie(COOKIE_NAME_CSRF_TOKEN, csrf)
    console_status = client.get(
        f"/console/api/apps/{harness.target.id}/annotation-reply/{action}/status/{job_id}",
        headers={
            HEADER_NAME_CSRF_TOKEN: csrf,
            "Authorization": f"Bearer {PassportService().issue({'user_id': harness.account.id})}",
        },
    )
    assert console_status.status_code == 200
    assert console_status.get_json() == expected_status


@pytest.mark.parametrize("action", ["enable", "disable"])
@pytest.mark.parametrize("mismatch", ["app", "tenant", "action", "legacy", "missing"])
def test_reply_status_rejects_unverifiable_ownership(
    harness: _Harness, action: AnnotationReplyAction, mismatch: str
) -> None:
    job_id = str(uuid4())
    stored_action: AnnotationReplyAction = (
        ("disable" if action == "enable" else "enable") if mismatch == "action" else action
    )
    if mismatch != "missing":
        harness.redis.set(f"{stored_action}_app_annotation_job_{job_id}", "completed")
    if mismatch not in {"legacy", "missing"}:
        tenant_id = str(uuid4()) if mismatch == "tenant" else harness.target.tenant_id
        harness.redis.set(
            annotation_reply_job_owner_key(action=stored_action, job_id=job_id), f"{tenant_id}:{harness.target.id}"
        )

    response = harness.request(
        "GET",
        f"/annotation-reply/{action}/status/{job_id}",
        token=harness.other_key.token if mismatch == "app" else harness.api_key.token,
    )

    assert response.status_code == 404
    assert response.get_json()["code"] == "not_found"
    assert response.get_json()["message"] == "The job does not exist."
    assert harness.publications == []
