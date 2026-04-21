"""
Testcontainers integration tests for Service API Site controller.
"""

from __future__ import annotations

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from controllers.service_api.app.site import AppSiteApi
from models.account import Tenant, TenantStatus
from models.model import App, AppMode, Site


@pytest.fixture
def app(flask_app_with_containers) -> Flask:
    return flask_app_with_containers


def _unwrap(method):
    fn = method
    while hasattr(fn, "__wrapped__"):
        fn = fn.__wrapped__
    return fn


def _create_tenant(db_session: Session, *, status: TenantStatus = TenantStatus.NORMAL) -> Tenant:
    tenant = Tenant(name="service-api-site-tenant", status=status)
    db_session.add(tenant)
    db_session.commit()
    return tenant


def _create_app(db_session: Session, tenant_id: str) -> App:
    app_model = App(
        tenant_id=tenant_id,
        mode=AppMode.CHAT,
        name="service-api-site-app",
        enable_site=True,
        enable_api=True,
        status="normal",
    )
    db_session.add(app_model)
    db_session.commit()
    return app_model


def _create_site(db_session: Session, app_id: str) -> Site:
    site = Site(
        app_id=app_id,
        title="Service API Site",
        icon_type="emoji",
        icon="robot",
        icon_background="#ffffff",
        description="Service API test site",
        default_language="en-US",
        prompt_public=True,
        show_workflow_steps=True,
        customize_token_strategy="not_allow",
        use_icon_as_answer_icon=False,
        chat_color_theme="light",
        chat_color_theme_inverted=False,
    )
    db_session.add(site)
    db_session.commit()
    return site


class TestAppSiteApi:
    def test_get_site_success(self, app: Flask, db_session_with_containers: Session) -> None:
        tenant = _create_tenant(db_session_with_containers)
        app_model = _create_app(db_session_with_containers, tenant.id)
        _create_site(db_session_with_containers, app_model.id)

        with app.test_request_context("/site", method="GET", headers={"Authorization": "Bearer test-token"}):
            api = AppSiteApi()
            response = _unwrap(api.get)(api, app_model=app_model)

        assert response["title"] == "Service API Site"
        assert response["icon"] == "robot"
        assert response["description"] == "Service API test site"

    def test_get_site_not_found(self, app: Flask, db_session_with_containers: Session) -> None:
        tenant = _create_tenant(db_session_with_containers)
        app_model = _create_app(db_session_with_containers, tenant.id)

        with app.test_request_context("/site", method="GET", headers={"Authorization": "Bearer test-token"}):
            api = AppSiteApi()
            with pytest.raises(Forbidden):
                _unwrap(api.get)(api, app_model=app_model)

    def test_get_site_tenant_archived(self, app: Flask, db_session_with_containers: Session) -> None:
        tenant = _create_tenant(db_session_with_containers)
        app_model = _create_app(db_session_with_containers, tenant.id)
        _create_site(db_session_with_containers, app_model.id)

        archived_tenant = db_session_with_containers.get(Tenant, tenant.id)
        assert archived_tenant is not None
        archived_tenant.status = TenantStatus.ARCHIVE
        db_session_with_containers.commit()

        app_model = db_session_with_containers.get(App, app_model.id)
        assert app_model is not None

        with app.test_request_context("/site", method="GET", headers={"Authorization": "Bearer test-token"}):
            api = AppSiteApi()
            with pytest.raises(Forbidden):
                _unwrap(api.get)(api, app_model=app_model)
