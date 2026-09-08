from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.model import IconType, UploadFile

DEFAULT_ICON_TYPE = IconType.EMOJI
DEFAULT_ICON = "🤖"
DEFAULT_ICON_BACKGROUND = "#FFEAD5"


class IconConfigurationError(ValueError):
    """Raised when an image icon does not resolve within its owning workspace."""


class IconConfigurationService:
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
            raise IconConfigurationError(
                "The site icon is missing or does not belong to this workspace. Please upload it again."
            )
