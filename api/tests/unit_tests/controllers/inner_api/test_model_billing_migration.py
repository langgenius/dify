from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session

from controllers.inner_api.model_billing_migration import (
    ClaimFreeModelBillingMigrationApi,
    CurrentMigrationStatusResponse,
    ModelBillingMigrationStatusApi,
    PrepareModelBillingMigrationApi,
)
from controllers.inner_api.wraps import InnerApiUnauthorizedError
from extensions.ext_application_services import ApplicationServices
from services.model_billing_migration_service import MigrationError, ModelBillingMigrationService
from tests.helpers.unit.config_override import apply_config_overrides
from tests.unit_tests.services.test_model_billing_free_migration_service import claim_request, prepare_free


@pytest.fixture
def free_prepared(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> tuple[str, str]:
    return prepare_free(sqlite_session, monkeypatch, source_ownership={})


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


def test_free_claim_uses_admitted_application_service_and_serializes_separate_manifest(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    account_application_services: ApplicationServices,
    free_prepared: tuple[str, str],
) -> None:
    tenant, migration = free_prepared
    apply_config_overrides(monkeypatch, INNER_API=True, INNER_API_KEY="TEST_INTERNAL_KEY")
    monkeypatch.setitem(app.extensions, "application_services", account_application_services)
    payload = claim_request(tenant, migration).model_dump(mode="json")
    with app.test_request_context(json=payload, headers={"X-Inner-Api-Key": "TEST_INTERNAL_KEY"}):
        body, status, headers = ClaimFreeModelBillingMigrationApi().post(tenant, migration)
    assert status == 200
    assert headers["Cache-Control"] == "no-store"
    parsed = CurrentMigrationStatusResponse.model_validate(body)
    assert parsed.phase == "claimed"
    assert parsed.free_grant_manifest is not None
    assert parsed.eligibility_policy_version == "free-legacy-v1"
    assert parsed.free_grant_manifest.grant_id == f"trial.v1.{tenant}"
    assert "manifest" not in body
    assert "data_plane_api_key" not in body


def test_free_claim_rejects_browser_or_unauthenticated_requests_before_state_change(
    app: Flask, monkeypatch: pytest.MonkeyPatch, free_prepared: tuple[str, str]
) -> None:
    tenant, migration = free_prepared
    before = ModelBillingMigrationService.status(tenant)
    apply_config_overrides(monkeypatch, INNER_API=True, INNER_API_KEY="TEST_INTERNAL_KEY")
    with app.test_request_context(json=claim_request(tenant, migration).model_dump(mode="json")):
        with pytest.raises(InnerApiUnauthorizedError):
            ClaimFreeModelBillingMigrationApi().post(tenant, migration)
    assert ModelBillingMigrationService.status(tenant) == before


def test_free_claim_rejects_unknown_money_or_routing_fields_without_side_effect(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    account_application_services: ApplicationServices,
    free_prepared: tuple[str, str],
) -> None:
    tenant, migration = free_prepared
    before = ModelBillingMigrationService.status(tenant)
    apply_config_overrides(monkeypatch, INNER_API=True, INNER_API_KEY="TEST_INTERNAL_KEY")
    monkeypatch.setitem(app.extensions, "application_services", account_application_services)
    payload = {
        **claim_request(tenant, migration).model_dump(mode="json"),
        "allow_empty": True,
        "api_key": "DO_NOT_ECHO",
    }
    with app.test_request_context(json=payload, headers={"X-Inner-Api-Key": "TEST_INTERNAL_KEY"}):
        body, status = ClaimFreeModelBillingMigrationApi().post(tenant, migration)
    assert status == 400
    assert body == {
        "code": "invalid_request",
        "message": "Invalid migration request",
        "retryable": False,
    }
    assert ModelBillingMigrationService.status(tenant) == before
