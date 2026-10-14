"""Annotation setting updates through real Console admission and SQLite."""

from datetime import datetime
from uuid import uuid4

import pytest
from sqlalchemy import delete, event, text, update
from sqlalchemy.orm import Session
from werkzeug.test import TestResponse

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.common.rbac import RBAC_CHECKS_ATTR, PlainApp, RBACPermission
from controllers.console.app import annotation as annotation_module
from enums.account import TenantAccountRole
from libs.datetime_utils import naive_utc_now
from libs.external_api import ExternalApi
from libs.passport import PassportService
from libs.token import generate_csrf_token
from models import Account, App
from models.account import AccountStatus, TenantAccountJoin
from models.dataset import DatasetCollectionBinding
from models.model import AppAnnotationSetting
from tests.unit_tests.controllers.console.app import test_annotation_queries
from tests.unit_tests.controllers.console.app.test_annotation_queries import _Harness
from tests.unit_tests.model_factories import make_app

query_harness = test_annotation_queries.harness
_CREATED_AT = datetime(2026, 1, 2, 3, 4, 5)


@pytest.fixture
def harness(query_harness: _Harness) -> _Harness:
    api = ExternalApi(query_harness.app)
    api.add_resource(
        annotation_module.AppAnnotationSettingUpdateApi,
        "/apps/<uuid:app_id>/annotation-settings/<uuid:annotation_setting_id>",
        endpoint="console.annotation_setting_commands",
    )
    return query_harness


@pytest.fixture
def setting(harness: _Harness) -> AppAnnotationSetting:
    binding = DatasetCollectionBinding(
        provider_name="openai",
        model_name="text-embedding-3-small",
        collection_name="annotations",
        type="annotation",
    )
    original_author = str(uuid4())
    setting = AppAnnotationSetting(
        app_id=harness.target.id,
        score_threshold=0.75,
        collection_binding_id=binding.id,
        created_user_id=original_author,
        updated_user_id=original_author,
    )
    setting.created_at = _CREATED_AT
    setting.updated_at = _CREATED_AT
    with harness.factory.begin() as session:
        session.add_all([binding, setting])
    return setting


def _request(
    harness: _Harness,
    *,
    setting_id: str,
    payload: dict[str, object],
    app_id: str | None = None,
    authenticated: bool = True,
    csrf: bool = True,
) -> TestResponse:
    client = harness.app.test_client()
    token = generate_csrf_token(harness.account.id)
    headers = {HEADER_NAME_CSRF_TOKEN: token} if csrf else {}
    if authenticated:
        headers["Authorization"] = f"Bearer {PassportService().issue({'user_id': harness.account.id})}"
    client.set_cookie(COOKIE_NAME_CSRF_TOKEN, token)
    commits: list[Session] = []

    def record_commit(session: Session) -> None:
        commits.append(session)

    event.listen(Session, "before_commit", record_commit)
    try:
        response = client.post(
            f"/apps/{app_id or harness.target.id}/annotation-settings/{setting_id}",
            json=payload,
            headers=headers,
        )
    finally:
        event.remove(Session, "before_commit", record_commit)
    assert len(commits) == (1 if response.status_code < 400 else 0)
    assert all(not session.in_transaction() and not session.identity_map for session in harness.sessions)
    assert response.headers["Content-Type"] == "application/json"
    return response


def _assert_unchanged(harness: _Harness, setting: AppAnnotationSetting) -> None:
    with harness.factory() as session:
        stored = session.get(AppAnnotationSetting, setting.id)
        assert stored is not None
        assert (stored.score_threshold, stored.updated_user_id, stored.updated_at) == (
            0.75,
            setting.updated_user_id,
            _CREATED_AT,
        )


@pytest.mark.parametrize("threshold", [0.0, 0.9, -0.5, 1.5, "0.8"])
def test_update_preserves_threshold_validation_response_and_audit_fields(
    harness: _Harness, setting: AppAnnotationSetting, threshold: float | str
) -> None:
    before = naive_utc_now().replace(microsecond=0)

    response = _request(harness, setting_id=setting.id, payload={"score_threshold": threshold})

    assert response.status_code == 200
    assert response.get_json() == {
        "enabled": True,
        "id": setting.id,
        "score_threshold": float(threshold),
        "embedding_model": {
            "embedding_provider_name": "openai",
            "embedding_model_name": "text-embedding-3-small",
        },
    }
    with harness.factory() as session:
        stored = session.get(AppAnnotationSetting, setting.id)
        assert stored is not None
        assert stored.score_threshold == float(threshold)
        assert stored.updated_user_id == harness.account.id
        assert before <= stored.updated_at <= naive_utc_now()
        assert (stored.app_id, stored.collection_binding_id, stored.created_user_id, stored.created_at) == (
            harness.target.id,
            setting.collection_binding_id,
            setting.created_user_id,
            _CREATED_AT,
        )


def test_missing_binding_preserves_enabled_setting_and_null_model_names(
    harness: _Harness, setting: AppAnnotationSetting
) -> None:
    with harness.factory.begin() as session:
        session.execute(
            delete(DatasetCollectionBinding).where(DatasetCollectionBinding.id == setting.collection_binding_id)
        )

    response = _request(harness, setting_id=setting.id, payload={"score_threshold": 0.0})

    assert response.status_code == 200
    assert response.get_json() == {
        "enabled": True,
        "id": setting.id,
        "score_threshold": 0.0,
        "embedding_model": {"embedding_provider_name": None, "embedding_model_name": None},
    }


@pytest.mark.parametrize("payload", [{}, {"score_threshold": None}, {"score_threshold": "invalid"}])
def test_invalid_payload_does_not_write(
    harness: _Harness, setting: AppAnnotationSetting, payload: dict[str, object]
) -> None:
    response = _request(harness, setting_id=setting.id, payload=payload)

    assert response.status_code == 422
    assert response.get_json()["code"] == "unprocessable_entity"
    _assert_unchanged(harness, setting)


@pytest.mark.parametrize("scope", ["missing", "other_tenant", "disabled"])
def test_update_requires_available_app_in_admitted_tenant(
    harness: _Harness, setting: AppAnnotationSetting, scope: str
) -> None:
    app_id = harness.target.id
    if scope == "missing":
        app_id = str(uuid4())
    else:
        with harness.factory.begin() as session:
            if scope == "other_tenant":
                session.execute(update(App).where(App.id == app_id).values(tenant_id=str(uuid4())))
            else:
                session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :app_id"), {"app_id": app_id})

    response = _request(harness, setting_id=setting.id, app_id=app_id, payload={"score_threshold": 0.9})

    assert response.status_code == 404
    assert response.get_json() == {"code": "not_found", "message": "App not found", "status": 404}
    _assert_unchanged(harness, setting)


@pytest.mark.parametrize("scope", ["missing", "other_app", "other_tenant"])
def test_update_requires_setting_in_admitted_app(harness: _Harness, setting: AppAnnotationSetting, scope: str) -> None:
    setting_id = str(uuid4())
    if scope != "missing":
        other = make_app(
            app_id=str(uuid4()),
            tenant_id=harness.target.tenant_id if scope == "other_app" else str(uuid4()),
        )
        with harness.factory.begin() as session:
            session.add(other)
            session.execute(
                update(AppAnnotationSetting)
                .where(AppAnnotationSetting.id == setting.id)
                .values(app_id=other.id, updated_at=_CREATED_AT)
            )
        setting_id = setting.id

    response = _request(harness, setting_id=setting_id, payload={"score_threshold": 0.9})

    assert response.status_code == 404
    assert response.get_json() == {"code": "not_found", "message": "App annotation not found", "status": 404}
    _assert_unchanged(harness, setting)


@pytest.mark.parametrize("role", list(TenantAccountRole))
def test_setting_update_requires_editing_role(
    harness: _Harness, setting: AppAnnotationSetting, role: TenantAccountRole
) -> None:
    with harness.factory.begin() as session:
        session.execute(
            update(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account.id).values(role=role)
        )

    response = _request(harness, setting_id=setting.id, payload={"score_threshold": 0.9})

    if TenantAccountRole.is_editing_role(role):
        assert response.status_code == 200
        assert response.get_json()["score_threshold"] == 0.9
    else:
        assert response.status_code == 403
        assert response.get_json()["code"] == "forbidden"
        _assert_unchanged(harness, setting)


def test_setting_update_requires_authentication_csrf_and_initialization(
    harness: _Harness, setting: AppAnnotationSetting
) -> None:
    for authenticated, csrf in ((False, True), (True, False)):
        response = _request(
            harness,
            setting_id=setting.id,
            payload={"score_threshold": 0.9},
            authenticated=authenticated,
            csrf=csrf,
        )
        assert response.status_code == 401
        assert response.get_json()["code"] == "unauthorized"
    with harness.factory.begin() as session:
        session.execute(
            update(Account).where(Account.id == harness.account.id).values(status=AccountStatus.UNINITIALIZED)
        )
    response = _request(harness, setting_id=setting.id, payload={"score_threshold": 0.9})
    assert response.status_code == 400
    assert response.get_json()["code"] == "account_not_initialized"
    _assert_unchanged(harness, setting)


def test_setting_update_preserves_app_edit_rbac_declaration() -> None:
    [check] = vars(annotation_module.AppAnnotationSettingUpdateApi.post)[RBAC_CHECKS_ATTR]
    assert check.scene == RBACPermission.APP_EDIT
    assert isinstance(check.locator, PlainApp)
