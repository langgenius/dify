"""Testcontainers integration tests for controllers.web.site endpoints."""

from __future__ import annotations

from types import ModuleType
from unittest.mock import patch

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from configs import dify_config
from constants import HEADER_NAME_APP_CODE, HEADER_NAME_PASSPORT
from extensions.storage.storage_type import StorageType
from libs.helper import build_icon_url
from libs.passport import PassportService
from models import Tenant, TenantStatus
from models.account import TenantCustomConfigDict
from models.model import App, AppMode, AppModelConfig, CustomizeTokenStrategy, EndUser, IconType, Site
from services.feature_service import FeatureModel


@pytest.fixture
def app(flask_app_with_containers: Flask) -> Flask:
    return flask_app_with_containers


@pytest.fixture
def site_module(app: Flask) -> ModuleType:
    del app
    from controllers.web import site

    return site


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


def _create_end_user(db_session: Session, tenant_id: str, app_id: str) -> EndUser:
    end_user = EndUser(
        tenant_id=tenant_id,
        app_id=app_id,
        type="browser",
        session_id=f"session-{app_id}",
    )
    db_session.add(end_user)
    db_session.commit()
    return end_user


def _passport_headers(app_model: App, site: Site, end_user: EndUser) -> dict[str, str]:
    passport = PassportService().issue(
        {
            "app_code": site.code,
            "app_id": app_model.id,
            "end_user_id": end_user.id,
        }
    )
    return {
        HEADER_NAME_APP_CODE: site.code,
        HEADER_NAME_PASSPORT: passport,
    }


def _site_model(*, app_id: str) -> Site:
    return Site(
        app_id=app_id,
        title="Site",
        icon_type="emoji",
        icon="robot",
        icon_background="#fff",
        description="desc",
        input_placeholder="Ask the app",
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
    def test_happy_path(
        self,
        site_module: ModuleType,
        test_client_with_containers: FlaskClient,
        transactional_db_session: Session,
    ) -> None:
        tenant = _create_tenant(transactional_db_session)
        app_model = _create_app(transactional_db_session, tenant.id)
        site = _create_site(transactional_db_session, app_model.id)
        end_user = _create_end_user(transactional_db_session, tenant.id, app_model.id)

        with patch.object(
            site_module.FeatureService,
            "get_features",
            return_value=FeatureModel(can_replace_logo=False),
        ):
            response = test_client_with_containers.get(
                "/api/site",
                headers=_passport_headers(app_model, site, end_user),
            )

        assert response.status_code == 200
        assert response.json is not None
        assert response.json == {
            "app_id": app_model.id,
            "end_user_id": end_user.id,
            "enable_site": True,
            "site": {
                "title": "Site",
                "chat_color_theme": "light",
                "chat_color_theme_inverted": False,
                "icon_type": "emoji",
                "icon": "robot",
                "icon_background": "#fff",
                "description": "desc",
                "copyright": None,
                "privacy_policy": None,
                "input_placeholder": "Ask the app",
                "custom_disclaimer": "",
                "default_language": "en",
                "prompt_public": False,
                "show_workflow_steps": True,
                "use_icon_as_answer_icon": False,
                "icon_url": build_icon_url("emoji", "robot"),
            },
            "model_config": None,
            "plan": "basic",
            "can_replace_logo": False,
            "custom_config": None,
        }

    def test_image_icon_uses_s3_presigned_url(
        self,
        site_module: ModuleType,
        test_client_with_containers: FlaskClient,
        transactional_db_session: Session,
    ) -> None:
        tenant = _create_tenant(transactional_db_session)
        app_model = _create_app(transactional_db_session, tenant.id)
        site = _create_site(transactional_db_session, app_model.id)
        site.icon_type = IconType.IMAGE
        site.icon = "11111111-1111-4111-8111-111111111111"
        transactional_db_session.commit()
        end_user = _create_end_user(transactional_db_session, tenant.id, app_model.id)

        with (
            patch.object(
                site_module.FeatureService,
                "get_features",
                return_value=FeatureModel(can_replace_logo=False),
            ),
            patch.object(site_module, "FileService", autospec=True) as mock_file_service,
            patch.object(dify_config, "EDITION", "CLOUD"),
            patch.object(dify_config, "STORAGE_TYPE", StorageType.S3),
        ):
            mock_get_file_presigned_url = mock_file_service.return_value.get_file_presigned_url
            mock_get_file_presigned_url.return_value = "https://s3.example.com/icon.png?signature=test"
            response = test_client_with_containers.get(
                "/api/site",
                headers=_passport_headers(app_model, site, end_user),
            )

        assert response.status_code == 200
        assert response.json is not None
        assert response.json["site"]["icon_url"] == "https://s3.example.com/icon.png?signature=test"
        mock_get_file_presigned_url.assert_called_once_with(
            file_id="11111111-1111-4111-8111-111111111111",
            tenant_id=tenant.id,
        )

    def test_archived_tenant_raises_forbidden(
        self,
        test_client_with_containers: FlaskClient,
        transactional_db_session: Session,
    ) -> None:
        tenant = _create_tenant(transactional_db_session, status=TenantStatus.ARCHIVE)
        app_model = _create_app(transactional_db_session, tenant.id)
        site = _create_site(transactional_db_session, app_model.id)
        end_user = _create_end_user(transactional_db_session, tenant.id, app_model.id)

        response = test_client_with_containers.get(
            "/api/site",
            headers=_passport_headers(app_model, site, end_user),
        )

        assert response.status_code == 403


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
    def test_basic_fields(self, site_module: ModuleType) -> None:
        tenant = _tenant_model()
        app_model = _app_model(tenant=tenant)
        response = site_module.WebAppSiteResponse.from_app_site(
            tenant=tenant,
            app_model=app_model,
            site=_site_model(app_id=app_model.id),
            end_user_id="eu-1",
            features=FeatureModel(can_replace_logo=False, webapp_copyright_enabled=True),
            can_replace_logo=False,
        )

        assert response.app_id == app_model.id
        assert response.end_user_id == "eu-1"
        assert response.enable_site is True
        assert response.plan == "basic"
        assert response.can_replace_logo is False
        assert response.model_config_ is None
        assert response.custom_config is None
        assert response.site.input_placeholder == "Ask the app"
        assert response.site.custom_disclaimer == ""

    def test_nullable_site_fields_preserve_none(self, site_module: ModuleType) -> None:
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

        response = site_module.WebAppSiteResponse.from_app_site(
            tenant=tenant,
            app_model=app_model,
            site=site,
            end_user_id=None,
            features=FeatureModel(can_replace_logo=False, webapp_copyright_enabled=True),
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

    def test_can_replace_logo_sets_custom_config(self, site_module: ModuleType) -> None:
        tenant = _tenant_model(
            plan="pro",
            custom_config={"remove_webapp_brand": True, "replace_webapp_logo": "enabled"},
        )
        app_model = _app_model(tenant=tenant)
        with patch.object(site_module.dify_config, "FILES_URL", "https://files.example.com"):
            response = site_module.WebAppSiteResponse.from_app_site(
                tenant=tenant,
                app_model=app_model,
                site=_site_model(app_id=app_model.id),
                end_user_id="eu-1",
                features=FeatureModel(can_replace_logo=True, webapp_copyright_enabled=True),
                can_replace_logo=True,
            )

        assert response.can_replace_logo is True
        assert response.custom_config is not None
        assert response.custom_config.remove_webapp_brand is True
        assert response.custom_config.replace_webapp_logo is not None
        assert "webapp-logo" in response.custom_config.replace_webapp_logo


class TestWebModelConfigResponse:
    def test_serializes_internal_model_config_properties_to_public_keys(self, site_module: ModuleType) -> None:
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

        dumped = site_module.WebModelConfigResponse.model_validate(model_config, from_attributes=True).model_dump(
            mode="json"
        )

        assert dumped == {
            "opening_statement": "Hello",
            "suggested_questions": ["Question?"],
            "suggested_questions_after_answer": {"enabled": True},
            "more_like_this": {"enabled": False},
            "model": {"provider": "openai", "name": "gpt-4o", "mode": "chat"},
            "user_input_form": [{"text-input": {"label": "Name", "variable": "name", "required": True}}],
            "pre_prompt": "System prompt",
        }
