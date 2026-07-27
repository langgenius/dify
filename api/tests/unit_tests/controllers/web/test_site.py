from unittest.mock import MagicMock, patch

from configs import dify_config
from controllers.web import site as site_module
from extensions.storage.storage_type import StorageType
from models.model import AppMode, IconType, Site
from services.feature_service import FeatureModel


def test_app_site_api_returns_legacy_agent_compatible_mode() -> None:
    app_model = MagicMock()
    app_model.id = "app-id"
    app_model.tenant_id = "tenant-id"
    app_model.tenant = MagicMock(id="tenant-id", status="normal")
    app_model.mode_compatible_with_agent_with_session.return_value = AppMode.AGENT_CHAT
    end_user = MagicMock(id="end-user-id")
    site = MagicMock(spec=Site)
    response = MagicMock()
    response.model_dump.return_value = {"mode": AppMode.AGENT_CHAT}

    with (
        patch.object(site_module, "db") as mock_db,
        patch.object(site_module.FeatureService, "get_features", return_value=FeatureModel(can_replace_logo=False)),
        patch.object(site_module, "_build_site_icon_url", return_value=None),
        patch.object(site_module.WebAppSiteResponse, "from_app_site", return_value=response) as mock_from_app_site,
    ):
        mock_db.session.scalar.return_value = site
        result = site_module.AppSiteApi().get(app_model, end_user)

    assert result["mode"] == AppMode.AGENT_CHAT
    app_model.mode_compatible_with_agent_with_session.assert_called_once_with(session=mock_db.session())
    mock_from_app_site.assert_called_once_with(
        tenant=app_model.tenant,
        app_model=app_model,
        mode=AppMode.AGENT_CHAT,
        site=site,
        end_user_id=end_user.id,
        features=FeatureModel(can_replace_logo=False),
        can_replace_logo=False,
        icon_url=None,
    )


def test_build_site_icon_url_uses_s3_presigned_url() -> None:
    site = MagicMock(spec=Site)
    site.icon_type = IconType.IMAGE
    site.icon = "11111111-1111-4111-8111-111111111111"

    with (
        patch.object(dify_config, "EDITION", "CLOUD"),
        patch.object(dify_config, "STORAGE_TYPE", StorageType.S3),
        patch.object(site_module, "db") as mock_db,
        patch.object(site_module, "FileService") as mock_file_service,
        patch.object(site_module, "build_icon_url") as mock_build_icon_url,
    ):
        mock_file_service.return_value.get_file_presigned_url.return_value = (
            "https://s3.example.com/icon.png?signature=test"
        )

        result = site_module._build_site_icon_url(site=site, tenant_id="tenant-id")

    assert result == "https://s3.example.com/icon.png?signature=test"
    mock_file_service.assert_called_once_with(mock_db.engine)
    mock_file_service.return_value.get_file_presigned_url.assert_called_once_with(
        file_id="11111111-1111-4111-8111-111111111111",
        tenant_id="tenant-id",
    )
    mock_build_icon_url.assert_not_called()


def test_build_site_icon_url_keeps_preview_url_for_self_hosted_s3() -> None:
    site = MagicMock(spec=Site)
    site.icon_type = IconType.IMAGE
    site.icon = "11111111-1111-4111-8111-111111111111"

    with (
        patch.object(dify_config, "EDITION", "SELF_HOSTED"),
        patch.object(dify_config, "STORAGE_TYPE", StorageType.S3),
        patch.object(site_module, "FileService") as mock_file_service,
        patch.object(site_module, "build_icon_url", return_value="https://api.example.com/files/icon/file-preview"),
    ):
        result = site_module._build_site_icon_url(site=site, tenant_id="tenant-id")

    assert result == "https://api.example.com/files/icon/file-preview"
    mock_file_service.assert_not_called()


def test_build_site_icon_url_keeps_preview_url_for_non_s3_storage() -> None:
    site = MagicMock(spec=Site)
    site.icon_type = IconType.IMAGE
    site.icon = "11111111-1111-4111-8111-111111111111"

    with (
        patch.object(dify_config, "EDITION", "CLOUD"),
        patch.object(dify_config, "STORAGE_TYPE", StorageType.LOCAL),
        patch.object(site_module, "FileService") as mock_file_service,
        patch.object(site_module, "build_icon_url", return_value="https://api.example.com/files/icon/file-preview"),
    ):
        result = site_module._build_site_icon_url(site=site, tenant_id="tenant-id")

    assert result == "https://api.example.com/files/icon/file-preview"
    mock_file_service.assert_not_called()
