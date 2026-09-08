from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.model import App, IconType, Site, UploadFile


class SiteConfigurationError(ValueError):
    """Raised when an app's public site configuration cannot be served safely."""


class SiteConfigurationService:
    @staticmethod
    def validate_icon_reference(
        *,
        session: Session,
        tenant_id: str,
        icon_type: IconType | str | None,
        icon: str | None,
    ) -> None:
        icon_type_value = icon_type.value if isinstance(icon_type, IconType) else icon_type
        if icon_type_value != IconType.IMAGE.value:
            return

        upload_file_id = None
        if icon:
            try:
                UUID(icon)
            except ValueError:
                pass
            else:
                upload_file_id = session.scalar(
                    select(UploadFile.id)
                    .where(
                        UploadFile.id == icon,
                        UploadFile.tenant_id == tenant_id,
                    )
                    .limit(1)
                )
        if upload_file_id is None:
            raise SiteConfigurationError(
                "The site icon is missing or does not belong to this workspace. Please upload it again."
            )

    @classmethod
    def validate_for_publish(cls, *, session: Session, app: App) -> None:
        site = session.scalar(select(Site).where(Site.app_id == app.id).limit(1))
        if site is None:
            raise SiteConfigurationError("The site configuration is missing. Please contact support.")

        cls.validate_icon_reference(
            session=session,
            tenant_id=app.tenant_id,
            icon_type=site.icon_type,
            icon=site.icon,
        )
