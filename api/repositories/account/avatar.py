"""Database predicates shared by account avatar assignment and delivery."""

from sqlalchemy import ColumnElement, and_, case, cast, func, or_, select

from models.account import Account
from models.enums import CreatorUserRole
from models.model import UploadFile
from models.types import StringUUID

_RASTER_FORMATS = (
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("webp", "image/webp"),
    ("gif", "image/gif"),
    ("bmp", "image/bmp"),
)
# Older avatar crops kept the original filename when canvas fell back to PNG.
_LEGACY_RASTER_FORMATS = (("gif", "image/png"), ("webp", "image/png"))
_UUID_PATTERN = r"^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$"


def _is_raster_avatar(*, allow_legacy: bool) -> ColumnElement[bool]:
    """Match canonical raster metadata and optionally older PNG crop metadata."""
    formats = _RASTER_FORMATS + _LEGACY_RASTER_FORMATS if allow_legacy else _RASTER_FORMATS
    return or_(
        *(
            and_(func.lower(UploadFile.extension) == extension, func.lower(UploadFile.mime_type) == mime_type)
            for extension, mime_type in formats
        )
    )


def eligible_avatar_file_conditions(*, allow_legacy: bool) -> tuple[ColumnElement[bool], ...]:
    """Match account-owned-role raster uploads, leaving account and file IDs to the caller."""
    return (
        UploadFile.created_by_role == CreatorUserRole.ACCOUNT,
        _is_raster_avatar(allow_legacy=allow_legacy),
    )


def owned_avatar_file_conditions(
    *, account_id: str, file_id: str, allow_legacy: bool
) -> tuple[ColumnElement[bool], ...]:
    """Match an account's own raster upload, accepting legacy metadata only when reading avatars."""
    role_condition, raster_condition = eligible_avatar_file_conditions(allow_legacy=allow_legacy)
    return (
        UploadFile.id == file_id,
        role_condition,
        UploadFile.created_by == account_id,
        raster_condition,
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
            _is_raster_avatar(allow_legacy=True),
        )
        .correlate(Account)
        .exists()
    )
    return case((or_(avatar.startswith("http://"), avatar.startswith("https://"), owns_file), avatar), else_=None)
