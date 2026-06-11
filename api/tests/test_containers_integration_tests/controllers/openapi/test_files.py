"""Testcontainers integration tests for /openapi/v1/apps/<app_id>/files/upload.

Exercises ``AppFileUploadApi`` against the real ``FileService`` (storage write +
DB row) and a live DB. The upload contract is pinned end-to-end: a multipart
``file`` part flows through ``require_app_context`` into
``FileService.upload_file`` and back as a ``FileResponse`` — so a signature
change to ``upload_file`` surfaces here.
"""

from __future__ import annotations

from collections.abc import Callable
from inspect import unwrap
from io import BytesIO

from flask import Flask
from sqlalchemy.orm import Session

from controllers.openapi.files import AppFileUploadApi
from models import Account, App
from services.app_service import AppService, CreateAppParams
from tests.test_containers_integration_tests.controllers.openapi.conftest import auth_for


def _create_app(db_session: Session, account: Account, *, name: str = "Uploader") -> App:
    """Create a workflow app (no model_config → no ModelManager) for the upload context."""
    tenant = account.current_tenant
    params = CreateAppParams(
        name=name,
        description="",
        mode="workflow",
        icon_type="emoji",
        icon="🤖",
        icon_background="#FF6B6B",
    )
    app_model = AppService().create_app(tenant.id, params, account)
    db_session.commit()
    return app_model


class TestAppFileUpload:
    def test_upload_persists_and_returns_metadata(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        account = make_account()
        tenant = account.current_tenant
        app_model = _create_app(db_session_with_containers, account)
        content = b"hello integration world"

        api = AppFileUploadApi()
        data = {"file": (BytesIO(content), "note.txt", "text/plain")}
        with app.test_request_context(
            f"/openapi/v1/apps/{app_model.id}/files/upload",
            method="POST",
            data=data,
            content_type="multipart/form-data",
        ):
            result = unwrap(api.post)(
                api,
                app_id=app_model.id,
                auth_data=auth_for(account, app_model=app_model, caller_kind="account"),
            )

        assert result.id
        assert result.name == "note.txt"
        assert result.size == len(content)
        assert result.extension == "txt"
        assert result.mime_type == "text/plain"
        # Persisted under the caller's tenant.
        assert result.tenant_id == str(tenant.id)
