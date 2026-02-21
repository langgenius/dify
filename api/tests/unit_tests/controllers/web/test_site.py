"""Unit tests for controllers.web.site endpoints."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

from controllers.web.site import AppSiteApi, AppSiteInfo


def _tenant(*, status: str = "normal") -> SimpleNamespace:
    return SimpleNamespace(
        id="tenant-1",
        status=status,
        plan="basic",
        custom_config_dict={"remove_webapp_brand": False, "replace_webapp_logo": False},
    )


def _site() -> SimpleNamespace:
    return SimpleNamespace(
        title="Site",
        icon_type="emoji",
        icon="robot",
        icon_background="#fff",
        description="desc",
        default_language="en",
        chat_color_theme="light",
        chat_color_theme_inverted=False,
        copyright=None,
        privacy_policy=None,
        custom_disclaimer=None,
        prompt_public=False,
        show_workflow_steps=True,
        use_icon_as_answer_icon=False,
    )


# ---------------------------------------------------------------------------
# AppSiteApi
# ---------------------------------------------------------------------------
class TestAppSiteApi:
    @patch("controllers.web.site.FeatureService.get_features")
    @patch("controllers.web.site.db")
    def test_happy_path(self, mock_db: MagicMock, mock_features: MagicMock, app: Flask) -> None:
        app.config["RESTX_MASK_HEADER"] = "X-Fields"
        mock_features.return_value = SimpleNamespace(can_replace_logo=False)
        site_obj = _site()
        mock_db.session.query.return_value.where.return_value.first.return_value = site_obj
        tenant = _tenant()
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", tenant=tenant, enable_site=True)
        end_user = SimpleNamespace(id="eu-1")

        with app.test_request_context("/site"):
            result = AppSiteApi().get(app_model, end_user)

        # marshal_with serializes AppSiteInfo to a dict
        assert result["app_id"] == "app-1"
        assert result["plan"] == "basic"
        assert result["enable_site"] is True

    @patch("controllers.web.site.db")
    def test_missing_site_raises_forbidden(self, mock_db: MagicMock, app: Flask) -> None:
        app.config["RESTX_MASK_HEADER"] = "X-Fields"
        mock_db.session.query.return_value.where.return_value.first.return_value = None
        tenant = _tenant()
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", tenant=tenant)
        end_user = SimpleNamespace(id="eu-1")

        with app.test_request_context("/site"):
            with pytest.raises(Forbidden):
                AppSiteApi().get(app_model, end_user)

    @patch("controllers.web.site.db")
    def test_archived_tenant_raises_forbidden(self, mock_db: MagicMock, app: Flask) -> None:
        app.config["RESTX_MASK_HEADER"] = "X-Fields"
        from models.account import TenantStatus

        mock_db.session.query.return_value.where.return_value.first.return_value = _site()
        tenant = SimpleNamespace(
            id="tenant-1",
            status=TenantStatus.ARCHIVE,
            plan="basic",
            custom_config_dict={},
        )
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", tenant=tenant)
        end_user = SimpleNamespace(id="eu-1")

        with app.test_request_context("/site"):
            with pytest.raises(Forbidden):
                AppSiteApi().get(app_model, end_user)


# ---------------------------------------------------------------------------
# AppSiteInfo
# ---------------------------------------------------------------------------
class TestAppSiteInfo:
    def test_basic_fields(self) -> None:
        tenant = _tenant()
        site_obj = _site()
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
        site_obj = _site()
        info = AppSiteInfo(tenant, SimpleNamespace(id="app-1", enable_site=True), site_obj, "eu-1", True)

        assert info.can_replace_logo is True
        assert info.custom_config["remove_webapp_brand"] is True
        assert "webapp-logo" in info.custom_config["replace_webapp_logo"]
