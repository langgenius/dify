"""Trusted trigger upload keeps storage and ownership in the file grant service."""

import inspect
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from flask import Flask

from controllers.inner_api.app.file_grants import EnterpriseTriggerFileApi, InvalidGrantRequestError
from services.entities.file_grant_entities import FileGrantClaims, FileGrantContext, FileGrantScope

MODULE = "controllers.inner_api.app.file_grants"


def test_trigger_upload_uses_grant_owner_and_existing_produced_store(app: Flask):
    service = Mock()
    service.store_produced.return_value = (
        SimpleNamespace(id="tool-id", name="report.txt", mime_type="text/plain", size=5),
        SimpleNamespace(external_url="secret-url"),
    )
    grant = FileGrantClaims(
        sub="trigger-owner", tenant_id="tenant", app_id="app", scopes=[FileGrantScope.PRODUCE], exp=9999999999
    )
    with app.test_request_context("/", method="POST", json={}):
        with (
            patch(f"{MODULE}.inner_api_ns") as namespace,
            patch(f"{MODULE}.application_services", return_value=SimpleNamespace(file_grants=service)),
        ):
            namespace.payload = {"filename": "report.txt", "mime_type": "text/plain", "content": "aGVsbG8="}
            response, status = inspect.unwrap(EnterpriseTriggerFileApi.post)(EnterpriseTriggerFileApi(), grant=grant)
    assert status == 201
    assert response == {"id": "tool-id", "name": "report.txt", "mime_type": "text/plain", "size": 5}
    call = service.store_produced.call_args.kwargs
    assert call["context"] == FileGrantContext(tenant_id="tenant", app_id="app", end_user_id="trigger-owner")
    assert isinstance(call["stream"], BytesIO)
    assert call["stream"].read() == b"hello"


def test_trigger_upload_rejects_invalid_base64_before_storage(app: Flask):
    service = Mock()
    grant = FileGrantClaims(
        sub="owner", tenant_id="tenant", app_id="app", scopes=[FileGrantScope.PRODUCE], exp=9999999999
    )
    with app.test_request_context("/", method="POST", json={}):
        with (
            patch(f"{MODULE}.inner_api_ns") as namespace,
            patch(f"{MODULE}.application_services", return_value=SimpleNamespace(file_grants=service)),
        ):
            namespace.payload = {"filename": "report.txt", "mime_type": "text/plain", "content": "%%%"}
            with pytest.raises(InvalidGrantRequestError):
                inspect.unwrap(EnterpriseTriggerFileApi.post)(EnterpriseTriggerFileApi(), grant=grant)
    service.store_produced.assert_not_called()
