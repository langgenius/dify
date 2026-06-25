"""Testcontainers integration tests for controllers.web.site endpoints."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from controllers.web.site import AppSiteApi, WebAppSiteResponse, WebModelConfigResponse
from models import Tenant, TenantStatus
from models.account import TenantCustomConfigDict
from models.model import App, AppMode, AppModelConfig, CustomizeTokenStrategy, EndUser, Site
from services.feature_service import FeatureModel


@pytest.fixture
def app(flask_app_with_containers: Flask) -> Flask:
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
    site = _site_model(app_id=app_id)
    db_session.add(site)
    db_session.commit()
    return site


def _end_user(tenant_id: str, app_id: str) -> EndUser:
    return EndUser(
        tenant_id=tenant_id,
        app_id=app_id,
        type="browser",
        session_id=f"session-{app_id}",
    )


def _site_model(*, app_id: str) -> Site:
    return Site(
        app_id=app_id,
        title="Site",
        icon_type="emoji",
        icon="robot",
        icon_background="#fff",
        description="desc",
        default_language="en",
        chat_color_theme="light",
        chat_color_theme_inverted=False,
        custom_disclaimer="",
        customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
        code=f"code-{app_id[-6:]}",
        prompt_public=False,
        show_workflow_steps=True,
        use_icon_as_answer_icon=False,
    )


class TestAppSiteApi:
    @patch("controllers.web.site.FeatureService.get_features")
    def test_happy_path(self, mock_features: MagicMock, app: Flask, db_session_with_containers: Session) -> None:
        app.config["RESTX_MASK_HEADER"] = "X-Fields"
        tenant = _create_tenant(db_session_with_containers)
        app_model = _create_app(db_session_with_containers, tenant.id)
        _create_site(db_session_with_containers, app_model.id)
        end_user = _end_user(tenant.id, app_model.id)
        mock_features.return_value = FeatureModel(can_replace_logo=False)

        with app.test_request_context("/site"):
            result = AppSiteApi().get(app_model, end_user)

        assert result["app_id"] == app_model.id
        assert result["end_user_id"] == end_user.id
        assert result["plan"] == "basic"
        assert result["enable_site"] is True

    def test_missing_site_raises_forbidden(self, app: Flask, db_session_with_containers: Session) -> None:
        app.config["RESTX_MASK_HEADER"] = "X-Fields"
        tenant = _create_tenant(db_session_with_containers)
        app_model = _create_app(db_session_with_containers, tenant.id)
        end_user = _end_user(tenant.id, app_model.id)

        with app.test_request_context("/site"):
            with pytest.raises(Forbidden):
                AppSiteApi().get(app_model, end_user)

    def test_archived_tenant_raises_forbidden(self, app: Flask, db_session_with_containers: Session) -> None:
        app.config["RESTX_MASK_HEADER"] = "X-Fields"
        tenant = _create_tenant(db_session_with_containers, status=TenantStatus.ARCHIVE)
        app_model = _create_app(db_session_with_containers, tenant.id)
        _create_site(db_session_with_containers, app_model.id)
        end_user = _end_user(tenant.id, app_model.id)

        with app.test_request_context("/site"):
            with pytest.raises(Forbidden):
                AppSiteApi().get(app_model, end_user)


def _tenant_model(*, plan: str = "basic", custom_config: TenantCustomConfigDict | None = None) -> Tenant:
    tenant = Tenant(name="test-tenant", plan=plan)
    tenant.custom_config_dict = custom_config or {}
    return tenant


def _app_model(*, tenant: Tenant, enable_site: bool = True) -> App:
    app_model = App(
        tenant_id=tenant.id,
        mode=AppMode.CHAT,
        name="test-app",
        enable_site=enable_site,
        enable_api=True,
    )
    app_model.id = "app-test"
    return app_model


class TestWebAppSiteResponse:
    def test_basic_fields(self) -> None:
        tenant = _tenant_model()
        app_model = _app_model(tenant=tenant)
        response = WebAppSiteResponse.from_app_site(
            tenant=tenant,
            app_model=app_model,
            site=_site_model(app_id=app_model.id),
            end_user_id="eu-1",
            can_replace_logo=False,
        )

        assert response.app_id == app_model.id
        assert response.end_user_id == "eu-1"
        assert response.enable_site is True
        assert response.plan == "basic"
        assert response.can_replace_logo is False
        assert response.model_config_ is None
        assert response.custom_config is None
        assert response.site.custom_disclaimer == ""

    def test_nullable_site_fields_preserve_none(self) -> None:
        tenant = _tenant_model()
        app_model = _app_model(tenant=tenant)
        site = _site_model(app_id=app_model.id)
        site.chat_color_theme = None
        site.icon_type = None
        site.icon = None
        site.icon_background = None
        site.description = None
        site.copyright = None
        site.privacy_policy = None

        response = WebAppSiteResponse.from_app_site(
            tenant=tenant,
            app_model=app_model,
            site=site,
            end_user_id=None,
            can_replace_logo=False,
        )

        dumped = response.model_dump(mode="json")
        assert dumped["end_user_id"] is None
        assert dumped["site"]["chat_color_theme"] is None
        assert dumped["site"]["icon_type"] is None
        assert dumped["site"]["icon"] is None
        assert dumped["site"]["icon_background"] is None
        assert dumped["site"]["description"] is None
        assert dumped["site"]["copyright"] is None
        assert dumped["site"]["privacy_policy"] is None
        assert dumped["site"]["custom_disclaimer"] == ""

    @patch("controllers.web.site.dify_config.FILES_URL", "https://files.example.com")
    def test_can_replace_logo_sets_custom_config(self) -> None:
        tenant = _tenant_model(
            plan="pro",
            custom_config={"remove_webapp_brand": True, "replace_webapp_logo": "enabled"},
        )
        app_model = _app_model(tenant=tenant)
        response = WebAppSiteResponse.from_app_site(
            tenant=tenant,
            app_model=app_model,
            site=_site_model(app_id=app_model.id),
            end_user_id="eu-1",
            can_replace_logo=True,
        )

        assert response.can_replace_logo is True
        assert response.custom_config is not None
        assert response.custom_config.remove_webapp_brand is True
        assert response.custom_config.replace_webapp_logo is not None
        assert "webapp-logo" in response.custom_config.replace_webapp_logo


class TestWebModelConfigResponse:
    def test_serializes_internal_model_config_properties_to_public_keys(self) -> None:
        model_config = AppModelConfig(
            app_id="app-test",
            opening_statement="Hello",
            suggested_questions='["Question?"]',
            suggested_questions_after_answer='{"enabled": true}',
            more_like_this='{"enabled": false}',
            model='{"provider": "openai", "name": "gpt-4o", "mode": "chat"}',
            user_input_form='[{"text-input": {"label": "Name", "variable": "name", "required": true}}]',
            pre_prompt="System prompt",
            created_by="account-1",
            updated_by="account-1",
        )

        dumped = WebModelConfigResponse.model_validate(model_config, from_attributes=True).model_dump(mode="json")

        assert dumped == {
            "opening_statement": "Hello",
            "suggested_questions": ["Question?"],
            "suggested_questions_after_answer": {"enabled": True},
            "more_like_this": {"enabled": False},
            "model": {"provider": "openai", "name": "gpt-4o", "mode": "chat"},
            "user_input_form": [{"text-input": {"label": "Name", "variable": "name", "required": True}}],
            "pre_prompt": "System prompt",
        }
