"""Import admission validates identity, app scope and transport without touching Redis."""

from collections.abc import Callable
from io import BytesIO
from typing import Literal
from uuid import uuid4

import pytest
from sqlalchemy import text, update
from werkzeug.datastructures import MultiDict
from werkzeug.test import TestResponse

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.common.rbac import RBAC_CHECKS_ATTR, PlainApp, RBACPermission
from controllers.console.app import annotation as annotation_module
from enums.account import TenantAccountRole
from libs.external_api import ExternalApi
from libs.helper import dump_response
from libs.passport import PassportService
from libs.token import generate_csrf_token
from models import Account
from models.account import AccountStatus, TenantAccountJoin
from services.annotation_import_service import (
    AnnotationImportResult,
    AnnotationImportValidationError,
    parse_annotation_csv,
)
from tests.unit_tests.controllers.console.app import test_annotation_queries
from tests.unit_tests.controllers.console.app.test_annotation_queries import _Harness
from tests.unit_tests.model_factories import make_app

query_harness = test_annotation_queries.harness

type _Operation = Literal["import", "status"]
_CSV = b"question,answer\nQuestion,Answer\n"


@pytest.fixture
def harness(query_harness: _Harness) -> _Harness:
    api = ExternalApi(query_harness.app)
    api.add_resource(
        annotation_module.AnnotationBatchImportApi,
        "/apps/<uuid:app_id>/annotations/batch-import",
        endpoint="console.annotation_import",
    )
    api.add_resource(
        annotation_module.AnnotationBatchImportStatusApi,
        "/apps/<uuid:app_id>/annotations/batch-import-status/<uuid:job_id>",
        endpoint="console.annotation_import_status",
    )
    return query_harness


def _request(
    harness: _Harness,
    operation: _Operation,
    *,
    app_id: str | None = None,
    files: tuple[tuple[str, str, bytes], ...] = (("file", "annotations.csv", _CSV),),
    authenticated: bool = True,
    csrf: bool = True,
) -> TestResponse:
    client = harness.app.test_client()
    token = generate_csrf_token(harness.account.id)
    headers = {HEADER_NAME_CSRF_TOKEN: token} if csrf else {}
    if authenticated:
        headers["Authorization"] = f"Bearer {PassportService().issue({'user_id': harness.account.id})}"
    client.set_cookie(COOKIE_NAME_CSRF_TOKEN, token)
    path = f"/apps/{app_id or harness.target.id}/annotations/batch-import"
    if operation == "status":
        response = client.get(f"{path}-status/{uuid4()}", headers=headers)
    else:
        data = MultiDict((field, (BytesIO(content), filename)) for field, filename, content in files)
        response = client.post(path, data=data, content_type="multipart/form-data", headers=headers)
    assert response.headers["Content-Type"] == "application/json"
    assert int(response.headers["Content-Length"]) == len(response.data)
    assert all(not session.in_transaction() and not session.identity_map for session in harness.sessions)
    return response


@pytest.mark.parametrize("operation", ["import", "status"])
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


@pytest.mark.parametrize(
    ("files", "code"),
    [
        ((), "no_file_uploaded"),
        ((("other", "annotations.csv", _CSV),), "no_file_uploaded"),
        ((("file", "first.csv", _CSV), ("second", "second.csv", _CSV)), "too_many_files"),
        ((("file", "first.csv", _CSV), ("file", "second.csv", _CSV)), "too_many_files"),
        ((("file", "annotations.txt", _CSV),), "invalid_param"),
        ((("file", "", _CSV),), "invalid_param"),
        ((("file", "annotations.csv", b""),), "invalid_param"),
    ],
)
def test_invalid_upload_rejects_before_rate_or_concurrency_checks(
    harness: _Harness, files: tuple[tuple[str, str, bytes], ...], code: str
) -> None:
    response = _request(harness, "import", files=files)

    assert response.status_code == 400
    assert response.get_json()["code"] == code


def test_upload_size_limit_is_413_before_rate_or_concurrency_checks(
    harness: _Harness, config_overrides: Callable[..., None]
) -> None:
    config_overrides(ANNOTATION_IMPORT_FILE_SIZE_LIMIT=1)

    response = _request(harness, "import", files=(("file", "annotations.csv", b"x" * (1024 * 1024 + 1)),))

    assert response.status_code == 413
    assert response.get_json()["code"] == "file_too_large"


@pytest.mark.parametrize("role", [TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR])
def test_editing_roles_reach_file_validation(harness: _Harness, role: TenantAccountRole) -> None:
    with harness.factory.begin() as session:
        session.execute(
            update(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account.id).values(role=role)
        )

    response = _request(harness, "import", files=())

    assert response.status_code == 400
    assert response.get_json()["code"] == "no_file_uploaded"


@pytest.mark.parametrize("operation", ["import", "status"])
@pytest.mark.parametrize("role", [TenantAccountRole.NORMAL, TenantAccountRole.DATASET_OPERATOR])
def test_import_and_status_preserve_editor_requirement(
    harness: _Harness, operation: _Operation, role: TenantAccountRole
) -> None:
    with harness.factory.begin() as session:
        session.execute(
            update(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account.id).values(role=role)
        )

    response = _request(harness, operation)

    assert response.status_code == 403
    assert response.get_json()["code"] == "forbidden"


@pytest.mark.parametrize("operation", ["import", "status"])
@pytest.mark.parametrize(("authenticated", "csrf"), [(False, True), (True, False)])
def test_import_and_status_require_authentication_and_csrf(
    harness: _Harness, operation: _Operation, authenticated: bool, csrf: bool
) -> None:
    response = _request(harness, operation, authenticated=authenticated, csrf=csrf)

    assert response.status_code == 401
    assert response.get_json()["code"] == "unauthorized"


@pytest.mark.parametrize("operation", ["import", "status"])
def test_uninitialized_account_cannot_import_or_read_jobs(harness: _Harness, operation: _Operation) -> None:
    with harness.factory.begin() as session:
        session.execute(
            update(Account).where(Account.id == harness.account.id).values(status=AccountStatus.UNINITIALIZED)
        )

    response = _request(harness, operation)

    assert response.status_code == 400
    assert response.get_json()["code"] == "account_not_initialized"


def test_import_and_status_preserve_distinct_rbac_permissions() -> None:
    [write_check] = vars(annotation_module.AnnotationBatchImportApi.post)[RBAC_CHECKS_ATTR]
    [read_check] = vars(annotation_module.AnnotationBatchImportStatusApi.get)[RBAC_CHECKS_ATTR]
    assert write_check.scene == RBACPermission.APP_EDIT
    assert read_check.scene == RBACPermission.APP_VIEW_LAYOUT
    assert isinstance(write_check.locator, PlainApp)
    assert isinstance(read_check.locator, PlainApp)


def test_import_result_serialization_preserves_legacy_nullable_error_field() -> None:
    job_id = str(uuid4())
    legacy_result = {"job_id": job_id, "job_status": "waiting", "record_count": 2}
    result = AnnotationImportResult(job_id=job_id, job_status="waiting", record_count=2)

    assert dump_response(annotation_module.AnnotationBatchImportResponse, result) == {
        "job_id": job_id,
        "job_status": "waiting",
        "record_count": 2,
        "error_msg": None,
    }
    assert dump_response(annotation_module.AnnotationBatchImportResponse, result) == dump_response(
        annotation_module.AnnotationBatchImportResponse, legacy_result
    )


def test_csv_validation_error_serialization_preserves_nullable_success_fields() -> None:
    with pytest.raises(AnnotationImportValidationError, match="can't decode byte") as error:
        parse_annotation_csv(BytesIO(b"question,answer\n\xff,Answer\n"), min_records=1, max_records=2)

    assert dump_response(annotation_module.AnnotationBatchImportResponse, {"error_msg": str(error.value)}) == {
        "job_id": None,
        "job_status": None,
        "record_count": None,
        "error_msg": str(error.value),
    }
