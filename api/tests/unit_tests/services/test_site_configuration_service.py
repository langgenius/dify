from datetime import UTC, datetime

import pytest
from sqlalchemy.orm import Session

from extensions.storage.storage_type import StorageType
from models.enums import CreatorUserRole, CustomizeTokenStrategy
from models.model import App, AppMode, IconType, Site, UploadFile
from services.site_configuration_service import SiteConfigurationError, SiteConfigurationService

APP_ID = "11111111-1111-1111-1111-111111111111"
TENANT_ID = "22222222-2222-2222-2222-222222222222"
OTHER_TENANT_ID = "33333333-3333-3333-3333-333333333333"
FILE_ID = "44444444-4444-4444-4444-444444444444"
ACCOUNT_ID = "55555555-5555-5555-5555-555555555555"


def _upload_file(*, tenant_id: str) -> UploadFile:
    upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=f"upload_files/{tenant_id}/icon.png",
        name="icon.png",
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=ACCOUNT_ID,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        used=True,
    )
    upload_file.id = FILE_ID
    return upload_file


def _app() -> App:
    return App(
        id=APP_ID,
        tenant_id=TENANT_ID,
        name="App",
        description="",
        mode=AppMode.ADVANCED_CHAT,
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
    )


def _site() -> Site:
    return Site(
        app_id=APP_ID,
        title="Site",
        icon_type=IconType.IMAGE,
        icon=FILE_ID,
        default_language="en-US",
        customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
        code="site-code",
    )


def test_validate_icon_reference_accepts_tenant_owned_file(sqlite_session: Session) -> None:
    sqlite_session.add(_upload_file(tenant_id=TENANT_ID))
    sqlite_session.commit()

    SiteConfigurationService.validate_icon_reference(
        session=sqlite_session,
        tenant_id=TENANT_ID,
        icon_type=IconType.IMAGE,
        icon=FILE_ID,
    )


@pytest.mark.parametrize("persisted_tenant_id", [None, OTHER_TENANT_ID], ids=["missing", "cross-tenant"])
def test_validate_icon_reference_rejects_unavailable_file(
    sqlite_session: Session,
    persisted_tenant_id: str | None,
) -> None:
    if persisted_tenant_id is not None:
        sqlite_session.add(_upload_file(tenant_id=persisted_tenant_id))
        sqlite_session.commit()

    with pytest.raises(SiteConfigurationError, match="missing or does not belong"):
        SiteConfigurationService.validate_icon_reference(
            session=sqlite_session,
            tenant_id=TENANT_ID,
            icon_type=IconType.IMAGE,
            icon=FILE_ID,
        )


def test_validate_icon_reference_rejects_empty_image_icon(sqlite_session: Session) -> None:
    with pytest.raises(SiteConfigurationError, match="missing or does not belong"):
        SiteConfigurationService.validate_icon_reference(
            session=sqlite_session,
            tenant_id=TENANT_ID,
            icon_type=IconType.IMAGE,
            icon=None,
        )


def test_validate_icon_reference_rejects_non_uuid_without_querying_database(sqlite_session: Session) -> None:
    with pytest.raises(SiteConfigurationError, match="missing or does not belong"):
        SiteConfigurationService.validate_icon_reference(
            session=sqlite_session,
            tenant_id=TENANT_ID,
            icon_type=IconType.IMAGE,
            icon="not-a-uuid",
        )


def test_validate_for_publish_rejects_cross_tenant_site_icon(sqlite_session: Session) -> None:
    app = _app()
    sqlite_session.add_all([app, _site(), _upload_file(tenant_id=OTHER_TENANT_ID)])
    sqlite_session.commit()

    with pytest.raises(SiteConfigurationError, match="missing or does not belong"):
        SiteConfigurationService.validate_for_publish(session=sqlite_session, app=app)
