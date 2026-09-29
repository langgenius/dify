from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from flask import Flask

from controllers.inner_api.model_billing_migration import (
    ModelBillingMigrationStatusApi,
    PrepareModelBillingMigrationApi,
)
from controllers.inner_api.wraps import InnerApiUnauthorizedError
from services.model_billing_migration_service import MigrationError, ModelBillingMigrationService
from tests.unit_tests.config_override import apply_config_overrides


def test_control_write_requires_inner_auth(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, INNER_API=True, INNER_API_KEY="TEST_INTERNAL_KEY")
    service = MagicMock()
    monkeypatch.setattr(ModelBillingMigrationService, "prepare", service)
    with app.test_request_context(json={}):
        with pytest.raises(InnerApiUnauthorizedError):
            PrepareModelBillingMigrationApi().post(uuid4())
    service.assert_not_called()


def test_unknown_fields_rejected_without_side_effect(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, INNER_API=True, INNER_API_KEY="TEST_INTERNAL_KEY")
    service = MagicMock()
    monkeypatch.setattr(ModelBillingMigrationService, "prepare", service)
    with app.test_request_context(json={"org_id": "injected"}, headers={"X-Inner-Api-Key": "TEST_INTERNAL_KEY"}):
        body, code = PrepareModelBillingMigrationApi().post(uuid4())
    assert code == 400
    assert body["code"] == "invalid_request"
    service.assert_not_called()


def test_status_no_store_and_no_secret_fields(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, INNER_API=True, INNER_API_KEY="TEST_INTERNAL_KEY")
    tenant_id = uuid4()
    status: dict[str, object] = {
        "api_version": 1,
        "tenant_id": str(tenant_id),
        "migration_id": str(uuid4()),
        "phase": "prepared",
        "attention": "normal",
        "revision": 2,
        "route_epoch": 0,
        "replayed": False,
        "billing_receipt_refs": [],
        "operation_results": [],
        "commands": [],
        "cycle_decisions": [],
        "model_mapping_version": "mapping-v1",
        "inventory_hash": "sha256:" + "1" * 64,
    }
    service = MagicMock(return_value=status)
    monkeypatch.setattr(ModelBillingMigrationService, "status", service)
    with app.test_request_context(headers={"X-Inner-Api-Key": "TEST_INTERNAL_KEY"}):
        body, code, headers = ModelBillingMigrationStatusApi().get(tenant_id)
    assert code == 200
    assert headers["Cache-Control"] == "no-store"
    assert "data_plane_api_key" not in body
    service.assert_called_once_with(str(tenant_id), None)


def test_operation_not_found_remains_explicit(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, INNER_API=True, INNER_API_KEY="TEST_INTERNAL_KEY")
    monkeypatch.setattr(
        ModelBillingMigrationService,
        "status",
        MagicMock(
            side_effect=MigrationError("operation_not_found", 404),
        ),
    )
    with app.test_request_context(headers={"X-Inner-Api-Key": "TEST_INTERNAL_KEY"}):
        body, code = ModelBillingMigrationStatusApi().get(uuid4())
    assert code == 404
    assert body["code"] == "operation_not_found"
