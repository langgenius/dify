"""Application boundary for Console app site management."""

from dataclasses import dataclass
from typing import Literal, NamedTuple, Protocol

from machinery.context import RequestContext

AppSiteTokenStrategy = Literal["must", "allow", "not_allow"]


@dataclass(frozen=True, slots=True)
class AppSiteChanges:
    title: str | None = None
    icon_type: str | None = None
    icon: str | None = None
    icon_background: str | None = None
    description: str | None = None
    default_language: str | None = None
    chat_color_theme: str | None = None
    chat_color_theme_inverted: bool | None = None
    customize_domain: str | None = None
    copyright: str | None = None
    privacy_policy: str | None = None
    input_placeholder: str | None = None
    custom_disclaimer: str | None = None
    customize_token_strategy: AppSiteTokenStrategy | None = None
    prompt_public: bool | None = None
    show_workflow_steps: bool | None = None
    use_icon_as_answer_icon: bool | None = None


class AppSiteCommandResult(NamedTuple):
    app_id: str
    code: str | None
    title: str
    icon: str | None
    icon_background: str | None
    description: str | None
    default_language: str
    customize_domain: str | None
    copyright: str | None
    privacy_policy: str | None
    input_placeholder: str | None
    custom_disclaimer: str | None
    customize_token_strategy: str
    prompt_public: bool
    show_workflow_steps: bool
    use_icon_as_answer_icon: bool


class AppSiteStore(Protocol):
    def update_site(
        self,
        *,
        workspace_id: str,
        app_id: str,
        actor_id: str,
        changes: AppSiteChanges,
    ) -> AppSiteCommandResult: ...

    def reset_access_token(
        self,
        *,
        workspace_id: str,
        app_id: str,
        actor_id: str,
    ) -> AppSiteCommandResult: ...


class AppSiteError(Exception):
    """Base class for framework-neutral app site failures."""


class AppSiteAppNotFoundError(AppSiteError):
    def __init__(self) -> None:
        super().__init__("App not found")


class AppSiteNotFoundError(AppSiteError):
    def __init__(self) -> None:
        super().__init__("Site not found")


class AppSiteService:
    def __init__(self, *, sites: AppSiteStore) -> None:
        self._sites = sites

    def update(self, context: RequestContext, app_id: str, changes: AppSiteChanges) -> AppSiteCommandResult:
        return self._sites.update_site(
            workspace_id=self._workspace_id(context),
            app_id=app_id,
            actor_id=context.account_id,
            changes=changes,
        )

    def reset_access_token(self, context: RequestContext, app_id: str) -> AppSiteCommandResult:
        return self._sites.reset_access_token(
            workspace_id=self._workspace_id(context),
            app_id=app_id,
            actor_id=context.account_id,
        )

    @staticmethod
    def _workspace_id(context: RequestContext) -> str:
        if context.active_workspace_id is None:
            raise RuntimeError("Console account admission did not resolve an active workspace")
        return context.active_workspace_id
