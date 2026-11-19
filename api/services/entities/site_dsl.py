"""Portable, presentation-only Site settings for App DSL exports."""

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from constants.languages import get_valid_language, supported_language
from models.model import App, IconType, Site
from repositories.file.upload_file_repository import lock_and_validate_owned_upload_files_in_session
from services.icon_configuration import is_valid_image_icon

_SITE_EXPORT_CONTEXT = object()


class SiteDsl(BaseModel):
    """Keep deployment identity and access policy owned by the destination Site.

    The allowlist deliberately excludes database and owner ids, the site code,
    custom domain, token strategy, public prompt setting, and status. The App's
    enable_site flag is also outside this schema. These values identify or
    expose the destination deployment, so an import must not replace them.
    """

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=255)
    description: str | None = None
    icon_type: IconType | None = None
    icon: str | None = None
    icon_background: str | None = None
    default_language: str | None = Field(default=None, min_length=1, max_length=255)
    chat_color_theme: str | None = None
    chat_color_theme_inverted: bool | None = None
    copyright: str | None = None
    privacy_policy: str | None = None
    input_placeholder: str | None = None
    custom_disclaimer: str | None = Field(default=None, max_length=512)
    show_workflow_steps: bool | None = None
    use_icon_as_answer_icon: bool | None = None

    @classmethod
    def from_site(cls, site: Site) -> "SiteDsl":
        """Export persisted Site values as an importable DSL, including legacy locales."""
        return cls.model_validate(site, from_attributes=True, context=_SITE_EXPORT_CONTEXT)

    @field_validator("default_language")
    @classmethod
    def validate_language(cls, value: str | None, info: ValidationInfo) -> str | None:
        if value is None:
            return None
        if info.context is _SITE_EXPORT_CONTEXT:
            return get_valid_language(value)
        return supported_language(value)

    @model_validator(mode="after")
    def validate_required_values(self) -> "SiteDsl":
        required = {
            "title",
            "default_language",
            "chat_color_theme_inverted",
            "custom_disclaimer",
            "show_workflow_steps",
            "use_icon_as_answer_icon",
        }
        values = self.model_dump(exclude_unset=True)
        if any(values[name] is None for name in required & values.keys()):
            raise ValueError("Required Site settings cannot be null")
        return self


def apply_site_dsl(*, site: Site, app: App, data: SiteDsl, session: Session, allow_premium_settings: bool) -> None:
    """Apply portable Site fields, omitting unavailable paid settings and image ids."""
    previous_image_id = site.icon if site.icon_type == IconType.IMAGE else None
    values = data.model_dump(exclude_unset=True)
    if not allow_premium_settings:
        # Cloud free workspaces must not retain paid Site settings after import.
        values.pop("copyright", None)
        values.pop("input_placeholder", None)
    icon_type = values.get("icon_type", site.icon_type)
    icon = values.get("icon", site.icon)
    if {"icon_type", "icon"} & values.keys() and not is_valid_image_icon(
        session=session, tenant_id=app.tenant_id, icon_type=icon_type, icon=icon
    ):
        # Standalone YAML cannot carry uploaded image bytes across workspaces.
        # Match App DSL imports: discard a foreign image id without a warning.
        values.update(icon_type=app.icon_type, icon=app.icon, icon_background=app.icon_background)
    current_icon_type = values.get("icon_type", site.icon_type)
    current_icon = values.get("icon", site.icon)
    current_image_id = current_icon if current_icon_type == IconType.IMAGE else None
    if isinstance(current_image_id, str) and current_image_id and current_image_id != previous_image_id:
        locked_site = session.scalar(
            select(Site)
            .where(Site.id == site.id, Site.app_id == app.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if locked_site is None:
            raise ValueError("App Site is unavailable")
        site = locked_site
        previous_image_id = site.icon if site.icon_type == IconType.IMAGE else None
        current_icon_type = values.get("icon_type", site.icon_type)
        current_icon = values.get("icon", site.icon)
        current_image_id = current_icon if current_icon_type == IconType.IMAGE else None
    if isinstance(current_image_id, str) and current_image_id and current_image_id != previous_image_id:
        lock_and_validate_owned_upload_files_in_session(
            session,
            tenant_id=app.tenant_id,
            upload_file_ids=(current_image_id,),
        )
    for name, value in values.items():
        setattr(site, name, value)
