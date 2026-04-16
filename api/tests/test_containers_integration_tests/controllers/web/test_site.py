"""Testcontainers integration tests for controllers.web.site endpoints."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from controllers.web.site import AppSiteApi, AppSiteInfo
from models import Tenant, TenantStatus
from models.model import App, AppMode, CustomizeTokenStrategy, Site


@pytest.fixture
def app(flask_app_with_containers) -> Flask:
    return flask_app_with_containers


def _create_tenant(db_session: Session, *, status: TenantStatus = TenantStatus.NORMAL) -> Tenant:
    tenant = Tenant(name="test-tenant", status=status)
    db_session.add(tenant)
    db_session.commit()
    return tenant


def _create_app(db_session: Session, tenant_id: str, *, enable_site: bool = True) -> App:
    app_model = App(
        tenant_id=tenant_id,
        mode=AppMode.CHAT,
        name="test-app",
        enable_site=enable_site,
        enable_api=True,
    )
    db_session.add(app_model)
    db_session.commit()
    return app_model


def _create_site(db_session: Session, app_id: str) -> Site:
    site = Site(
        app_id=app_id,
        title="Site",
        icon_type="emoji",
        icon="robot",
        icon_background="#fff",
        description="desc",
        default_language="en",
        chat_color_theme="light",
        chat_color_theme_inverted=False,
        customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
        code=f"code-{app_id[-6:]}",
        prompt_public=False,
        show_workflow_steps=True,
        use_icon_as_answer_icon=False,
    )
    db_session.add(site)
    db_session.commit()
    return site


class TestAppSiteApi:
    @patch("controllers.web.site.FeatureService.get_features")
    def test_happy_path(self, mock_features, app: Flask, db_session_with_containers: Session) -> None:
        app.config["RESTX_MASK_HEADER"] = "X-Fields"
        tenant = _create_tenant(db_session_with_containers)
        app_model = _create_app(db_session_with_containers, tenant.id)
        _create_site(db_session_with_containers, app_model.id)
        end_user = SimpleNamespace(id="eu-1")
        mock_features.return_value = SimpleNamespace(can_replace_logo=False)

        with app.test_request_context("/site"):
            result = AppSiteApi().get(app_model, end_user)

        assert result["app_id"] == app_model.id
        assert result["plan"] == "basic"
        assert result["enable_site"] is True

    def test_missing_site_raises_forbidden(self, app: Flask, db_session_with_containers: Session) -> None:
        app.config["RESTX_MASK_HEADER"] = "X-Fields"
        tenant = _create_tenant(db_session_with_containers)
        app_model = _create_app(db_session_with_containers, tenant.id)
        end_user = SimpleNamespace(id="eu-1")

        with app.test_request_context("/site"):
            with pytest.raises(Forbidden):
                AppSiteApi().get(app_model, end_user)

    @patch("controllers.web.site.FeatureService.get_features")
    def test_archived_tenant_raises_forbidden(
        self, mock_features, app: Flask, db_session_with_containers: Session
    ) -> None:
        app.config["RESTX_MASK_HEADER"] = "X-Fields"
        tenant = _create_tenant(db_session_with_containers, status=TenantStatus.ARCHIVE)
        app_model = _create_app(db_session_with_containers, tenant.id)
        _create_site(db_session_with_containers, app_model.id)
        end_user = SimpleNamespace(id="eu-1")
        mock_features.return_value = SimpleNamespace(can_replace_logo=False)

        with app.test_request_context("/site"):
            with pytest.raises(Forbidden):
                AppSiteApi().get(app_model, end_user)


class TestAppSiteInfo:
    def test_basic_fields(self) -> None:
        tenant = SimpleNamespace(id="tenant-1", plan="basic", custom_config_dict={})
        site_obj = SimpleNamespace()
        info = AppSiteInfo(tenant, SimpleNamespace(id="app-1", enable_site=True), site_obj, "eu-1", False)

        assert info.app_id == "app-1"
        assert info.end_user_id == "eu-1"
        assert info.enable_site is True
        assert info.plan == "basic"
        assert info.can_replace_logo is False
        assert info.model_config is None

    @patch("controllers.web.site.dify_config", SimpleNamespace(FILES_URL="https://files.example.com"))
    def test_can_replace_logo_sets_custom_config(self) -> None:
        tenant = SimpleNamespace(
            id="tenant-1",
            plan="pro",
            custom_config_dict={"remove_webapp_brand": True, "replace_webapp_logo": True},
        )
        site_obj = SimpleNamespace()
        info = AppSiteInfo(tenant, SimpleNamespace(id="app-1", enable_site=True), site_obj, "eu-1", True)

        assert info.can_replace_logo is True
        assert info.custom_config["remove_webapp_brand"] is True
        assert "webapp-logo" in info.custom_config["replace_webapp_logo"]
