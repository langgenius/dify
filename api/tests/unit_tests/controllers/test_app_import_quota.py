"""Quota failures retain their HTTP semantics across both app import surfaces."""

from collections.abc import Callable
from inspect import unwrap
from typing import Protocol, cast
from uuid import uuid4

import httpx
import pytest
from flask import Flask
from flask_restx import Resource
from sqlalchemy import select
from sqlalchemy.orm import Session

from constants.dsl_version import CURRENT_APP_DSL_VERSION
from controllers.console.app import app_import as console
from controllers.openapi import app_dsl as openapi
from controllers.openapi._errors import OpenApiErrorFormatter
from controllers.openapi._models import AppDslImportPayload
from enums import DeploymentEdition
from extensions.ext_redis import redis_client
from libs.external_api import ExternalApi
from machinery.context import RequestContext
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.model import App
from services.app_dsl_service import AppDslService, PendingData
from services.billing_service import BillingService, _BillingHTTPStatusError
from services.entities.feature_entities import FeatureModel, LimitationModel
from services.feature_service import FeatureService
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.controllers.conftest import ControllerTestServices


class _EndpointView(Protocol):
    __handler__: Callable[..., tuple[object, int]]


@pytest.mark.parametrize("surface", ["console", "openapi"])
@pytest.mark.parametrize("confirm", [False, True])
@pytest.mark.parametrize("failure", ["timeout", "upstream_503", "invalid_response", "quota_exhausted"])
def test_import_quota_failure_http_status(
    app_query_services: ControllerTestServices,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    surface: str,
    confirm: bool,
    failure: str,
) -> None:
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    account = Account(name="Importer", email="importer@example.com")
    tenant = Tenant(name="Workspace")
    account.id, tenant.id = str(uuid4()), str(uuid4())
    sqlite_session.add_all(
        [
            account,
            tenant,
            TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER),
        ]
    )
    sqlite_session.commit()
    context = RequestContext("request-1", None, account.id, tenant.id)
    content = (
        f"version: {CURRENT_APP_DSL_VERSION}\napp: {{name: Imported, mode: workflow}}\n"
        "workflow: {graph: {nodes: [], edges: []}, features: {}}\n"
    )
    pending = PendingData(tenant_id=tenant.id, account_id=account.id, import_mode="yaml-content", yaml_content=content)
    monkeypatch.setattr(redis_client, "get", lambda _: pending.model_dump_json())

    def unexpected_side_effect(*_args: object, **_kwargs: object) -> None:
        pytest.fail("A failed quota check must preserve pending data and avoid database writes")

    monkeypatch.setattr(redis_client, "delete", unexpected_side_effect)
    monkeypatch.setattr(AppDslService, "_create_or_update_app", unexpected_side_effect)
    if failure == "quota_exhausted":
        monkeypatch.setattr(
            FeatureService,
            "get_features",
            lambda *_args, **_kwargs: FeatureModel(apps=LimitationModel(size=5, limit=5)),
        )
    else:

        def failed_billing(*_args: object, **_kwargs: object) -> dict[str, str]:
            if failure == "timeout":
                raise httpx.ReadTimeout("Private billing timeout details")
            if failure == "upstream_503":
                raise _BillingHTTPStatusError("Private billing failure details", 503)
            return {"subscription": "Private invalid billing response"}

        monkeypatch.setattr(BillingService, "_send_request", failed_billing)

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.extensions["application_services"] = app_query_services
    api = ExternalApi(app, error_body_formatter=OpenApiErrorFormatter() if surface == "openapi" else None)

    class AdmittedImport(Resource):
        def post(self) -> tuple[object, int]:
            if surface == "console":
                if confirm:
                    controller = console.AppImportConfirmApi()
                    return unwrap(controller.post)(controller, context, import_id="pending-1")
                controller = console.AppImportApi()
                return unwrap(controller.post)(controller, context)
            if confirm:
                controller = openapi.AppDslImportConfirmApi()
                return cast(_EndpointView, controller.post).__handler__(
                    controller, context, workspace_id=tenant.id, import_id="pending-1"
                )
            controller = openapi.AppDslImportApi()
            return cast(_EndpointView, controller.post).__handler__(
                controller,
                context,
                workspace_id=tenant.id,
                body=AppDslImportPayload(mode="yaml-content", yaml_content=content),
            )

    api.add_resource(AdmittedImport, "/imports")
    response = app.test_client().post("/imports", json={"mode": "yaml-content", "yaml_content": content})

    assert response.status_code == (403 if failure == "quota_exhausted" else 500)
    assert "Private" not in response.get_data(as_text=True)
    assert sqlite_session.scalar(select(App.id).where(App.tenant_id == tenant.id)) is None
