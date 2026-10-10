"""Reply admission rejects invalid requests before opening any Redis connection."""

from typing import Literal
from uuid import uuid4

import pytest
from sqlalchemy import text, update
from werkzeug.test import TestResponse

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.common.rbac import RBAC_CHECKS_ATTR, PlainApp, RBACPermission
from controllers.console.app import annotation as annotation_module
from enums.account import TenantAccountRole
from libs.external_api import ExternalApi
from libs.passport import PassportService
from libs.token import generate_csrf_token
from models import Account
from models.account import AccountStatus, TenantAccountJoin
from tests.unit_tests.controllers.console.app import test_annotation_queries
from tests.unit_tests.controllers.console.app.test_annotation_queries import _Harness
from tests.unit_tests.model_factories import make_app

query_harness = test_annotation_queries.harness

_PAYLOAD: dict[str, object] = {
    "score_threshold": 0.5,
    "embedding_provider_name": "openai",
    "embedding_model_name": "text-embedding-3-small",
}
type _Operation = Literal["enable", "disable", "status"]


@pytest.fixture
def harness(query_harness: _Harness) -> _Harness:
    api = ExternalApi(query_harness.app)
    api.add_resource(
        annotation_module.AnnotationReplyActionApi,
        "/apps/<uuid:app_id>/annotation-reply/<string:action>",
        endpoint="console.annotation_reply",
    )
    api.add_resource(
        annotation_module.AnnotationReplyActionStatusApi,
        "/apps/<uuid:app_id>/annotation-reply/<string:action>/status/<uuid:job_id>",
        endpoint="console.annotation_reply_status",
    )
    return query_harness


def _request(
    harness: _Harness,
    operation: _Operation,
    *,
    app_id: str | None = None,
    action: str | None = None,
    payload: dict[str, object] | None = None,
    authenticated: bool = True,
    csrf: bool = True,
) -> TestResponse:
    client = harness.app.test_client()
    token = generate_csrf_token(harness.account.id)
    headers = {HEADER_NAME_CSRF_TOKEN: token} if csrf else {}
    if authenticated:
        headers["Authorization"] = f"Bearer {PassportService().issue({'user_id': harness.account.id})}"
    client.set_cookie(COOKIE_NAME_CSRF_TOKEN, token)
    resolved_action = action or ("enable" if operation == "status" else operation)
    path = f"/apps/{app_id or harness.target.id}/annotation-reply/{resolved_action}"
    if operation == "status":
        response = client.get(f"{path}/status/{uuid4()}", headers=headers)
    else:
        response = client.post(path, json=_PAYLOAD if payload is None else payload, headers=headers)
    assert response.headers["Content-Type"] == "application/json"
    assert all(not session.in_transaction() and not session.identity_map for session in harness.sessions)
    return response


@pytest.mark.parametrize("operation", ["enable", "disable", "status"])
@pytest.mark.parametrize("reason", ["missing", "other_tenant", "disabled"])
def test_unavailable_app_rejects_before_reading_or_writing_jobs(
    harness: _Harness, operation: _Operation, reason: str
) -> None:
    app_id = str(uuid4())
    with harness.factory.begin() as session:
        if reason == "other_tenant":
            session.add(make_app(app_id=app_id, tenant_id=str(uuid4())))
        elif reason == "disabled":
            app_id = harness.target.id
            session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :id"), {"id": app_id})

    response = _request(harness, operation, app_id=app_id)

    assert response.status_code == 404
    assert response.get_json()["code"] == "not_found"
    assert response.get_json()["message"] == "App not found"


@pytest.mark.parametrize("operation", ["enable", "disable", "status"])
def test_unknown_action_is_validation_error_without_dispatch(harness: _Harness, operation: _Operation) -> None:
    response = _request(harness, operation, action="unknown")

    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_param"


@pytest.mark.parametrize("operation", ["enable", "disable"])
@pytest.mark.parametrize("payload", [{}, {"score_threshold": "invalid", "embedding_provider_name": "openai"}])
def test_both_actions_require_valid_embedding_payload(
    harness: _Harness, operation: _Operation, payload: dict[str, object]
) -> None:
    response = _request(harness, operation, payload=payload)

    assert response.status_code == 422
    assert response.get_json()["code"] == "unprocessable_entity"


@pytest.mark.parametrize("operation", ["enable", "disable", "status"])
@pytest.mark.parametrize("role", [TenantAccountRole.NORMAL, TenantAccountRole.DATASET_OPERATOR])
def test_read_and_write_actions_preserve_editor_requirement(
    harness: _Harness, operation: _Operation, role: TenantAccountRole
) -> None:
    with harness.factory.begin() as session:
        session.execute(
            update(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account.id).values(role=role)
        )

    response = _request(harness, operation)

    assert response.status_code == 403
    assert response.get_json()["code"] == "forbidden"


@pytest.mark.parametrize("operation", ["enable", "disable", "status"])
@pytest.mark.parametrize(("authenticated", "csrf"), [(False, True), (True, False)])
def test_admission_requires_authentication_and_csrf(
    harness: _Harness, operation: _Operation, authenticated: bool, csrf: bool
) -> None:
    response = _request(harness, operation, authenticated=authenticated, csrf=csrf)

    assert response.status_code == 401
    assert response.get_json()["code"] == "unauthorized"


@pytest.mark.parametrize("operation", ["enable", "disable", "status"])
def test_uninitialized_account_cannot_read_or_dispatch_jobs(harness: _Harness, operation: _Operation) -> None:
    with harness.factory.begin() as session:
        session.execute(
            update(Account).where(Account.id == harness.account.id).values(status=AccountStatus.UNINITIALIZED)
        )

    response = _request(harness, operation)

    assert response.status_code == 400
    assert response.get_json()["code"] == "account_not_initialized"


def test_reply_actions_preserve_distinct_rbac_permissions() -> None:
    [write_check] = vars(annotation_module.AnnotationReplyActionApi.post)[RBAC_CHECKS_ATTR]
    [read_check] = vars(annotation_module.AnnotationReplyActionStatusApi.get)[RBAC_CHECKS_ATTR]
    assert write_check.scene == RBACPermission.APP_EDIT
    assert read_check.scene == RBACPermission.APP_VIEW_LAYOUT
    assert isinstance(write_check.locator, PlainApp)
    assert isinstance(read_check.locator, PlainApp)
