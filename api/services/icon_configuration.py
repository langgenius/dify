from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.model import IconType, UploadFile

DEFAULT_ICON_TYPE = IconType.EMOJI
DEFAULT_ICON = "🤖"
DEFAULT_ICON_BACKGROUND = "#FFEAD5"


def is_valid_image_icon(
    *,
    session: Session,
    tenant_id: str,
    icon_type: IconType | str | None,
    icon: str | None,
) -> bool:
    icon_type_value = icon_type.value if isinstance(icon_type, IconType) else icon_type
    if icon_type_value != IconType.IMAGE.value:
        return True

    if not icon:
        return False
    try:
        UUID(icon)
    except ValueError:
        return False
    return (
        session.scalar(
            select(UploadFile.id)
            .where(
                UploadFile.id == icon,
                UploadFile.tenant_id == tenant_id,
            )
            .limit(1)
        )
        is not None
    )
