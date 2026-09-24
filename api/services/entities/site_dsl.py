"""Portable, presentation-only Site settings for App DSL exports."""

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy.orm import Session

from constants.languages import supported_language
from models.model import App, IconType, Site
from services.icon_configuration import is_valid_image_icon


class SiteDsl(BaseModel):
    """Keep deployment identity and access policy owned by the destination Site.

    The allowlist deliberately excludes database and owner ids, the site code,
    custom domain, token strategy, public prompt setting, and status. The App's
    enable_site flag is also outside this schema. These values identify or
    expose the destination deployment, so an import must not replace them.
    """

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=255)
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

    @field_validator("default_language")
    @classmethod
    def validate_language(cls, value: str | None) -> str | None:
        return supported_language(value) if value is not None else None

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


def apply_site_dsl(*, site: Site, app: App, data: SiteDsl, session: Session) -> None:
    """Apply supplied Site fields and silently discard inaccessible image ids."""
    values = data.model_dump(exclude_unset=True)
    icon_type = values.get("icon_type", site.icon_type)
    icon = values.get("icon", site.icon)
    if {"icon_type", "icon"} & values.keys() and not is_valid_image_icon(
        session=session, tenant_id=app.tenant_id, icon_type=icon_type, icon=icon
    ):
        # Standalone YAML cannot carry uploaded image bytes across workspaces.
        # Match App DSL imports: discard a foreign image id without a warning.
        values.update(icon_type=app.icon_type, icon=app.icon, icon_background=app.icon_background)
    for name, value in values.items():
        setattr(site, name, value)
