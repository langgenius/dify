"""Database predicates shared by account avatar assignment and delivery."""

from sqlalchemy import ColumnElement, and_, case, cast, func, or_, select

from models.account import Account
from models.enums import CreatorUserRole
from models.model import UploadFile
from models.types import StringUUID

_AVATAR_RASTER_FORMATS = (
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("webp", "image/webp"),
    ("gif", "image/gif"),
    ("bmp", "image/bmp"),
)
_UUID_PATTERN = r"^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$"


def _is_raster_avatar() -> ColumnElement[bool]:
    return or_(
        *(
            and_(func.lower(UploadFile.extension) == extension, func.lower(UploadFile.mime_type) == mime_type)
            for extension, mime_type in _AVATAR_RASTER_FORMATS
        )
    )


def owned_avatar_file_conditions(*, account_id: str, file_id: str) -> tuple[ColumnElement[bool], ...]:
    """Match one account's raster upload without granting access to another creator's file."""
    return (
        UploadFile.id == file_id,
        UploadFile.created_by_role == CreatorUserRole.ACCOUNT,
        UploadFile.created_by == account_id,
        _is_raster_avatar(),
    )


def validated_account_avatar() -> ColumnElement[str | None]:
    """Project only owned account uploads or existing external avatar URLs for legacy readers."""
    avatar = Account.avatar
    # Guard the cast of legacy values while leaving the upload primary key available for indexed lookup.
    file_id = case((avatar.regexp_match(_UUID_PATTERN), cast(avatar, StringUUID())), else_=None)
    owns_file = (
        select(UploadFile.id)
        .where(
            UploadFile.id == file_id,
            UploadFile.created_by == Account.id,
            UploadFile.created_by_role == CreatorUserRole.ACCOUNT,
            _is_raster_avatar(),
        )
        .correlate(Account)
        .exists()
    )
    return case((or_(avatar.startswith("http://"), avatar.startswith("https://"), owns_file), avatar), else_=None)
