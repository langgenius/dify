"""Application service for querying the recommended app catalog."""

from collections.abc import Sequence, Set
from typing import NamedTuple, Protocol

from constants.languages import languages


class RecommendedAppInfoRecord(NamedTuple):
    id: str
    name: str | None
    mode: str | None
    icon: str | None
    icon_type: str | None
    icon_background: str | None


class RecommendedAppRecord(NamedTuple):
    app: RecommendedAppInfoRecord | None
    app_id: str
    description: str | None
    copyright: str | None
    privacy_policy: str | None
    custom_disclaimer: str | None
    categories: tuple[str, ...]
    position: int | None
    is_listed: bool | None


class RecommendedAppCatalogPage(NamedTuple):
    recommended_apps: tuple[RecommendedAppRecord, ...]
    categories: tuple[str, ...]


class RecommendedAppDetailRecord(NamedTuple):
    id: str
    name: str
    icon: str | None
    icon_background: str | None
    mode: str
    export_data: str


class RecommendedAppCatalogQuery(Protocol):
    """Read from the recommended-app catalog."""

    def list_recommended(self, language: str) -> RecommendedAppCatalogPage: ...

    def list_learn_dify(self, language: str) -> RecommendedAppCatalogPage: ...

    def get_detail(self, app_id: str) -> RecommendedAppDetailRecord | None: ...

    def contains(self, app_id: str) -> bool: ...


class TrialAppQuery(Protocol):
    def existing_ids(self, app_ids: Sequence[str]) -> Set[str]: ...


class RecommendedAppSummary(NamedTuple):
    app: RecommendedAppInfoRecord | None
    app_id: str
    description: str | None
    copyright: str | None
    privacy_policy: str | None
    custom_disclaimer: str | None
    categories: tuple[str, ...]
    position: int | None
    is_listed: bool | None
    can_trial: bool


class RecommendedAppListResult(NamedTuple):
    recommended_apps: tuple[RecommendedAppSummary, ...]
    categories: tuple[str, ...]


class LearnDifyAppListResult(NamedTuple):
    recommended_apps: tuple[RecommendedAppSummary, ...]


class RecommendedAppDetailSummary(NamedTuple):
    id: str
    name: str
    icon: str | None
    icon_background: str | None
    mode: str
    export_data: str
    can_trial: bool


class RecommendedAppNotFoundError(Exception):
    pass


class RecommendedAppQueryService:
    def __init__(
        self,
        *,
        catalog: RecommendedAppCatalogQuery,
        trial_apps: TrialAppQuery,
        trial_enabled: bool,
    ) -> None:
        self._catalog = catalog
        self._trial_apps = trial_apps
        self._trial_enabled = trial_enabled

    def is_trial_enabled(self) -> bool:
        return self._trial_enabled

    def is_previewable(self, app_id: str) -> bool:
        if app_id in self._trial_apps.existing_ids((app_id,)):
            return True
        return self._catalog.contains(app_id)

    def list_recommended(
        self,
        *,
        requested_language: str | None,
        interface_language: str | None,
    ) -> RecommendedAppListResult:
        language = self._resolve_language(requested_language, interface_language)
        page = self._catalog.list_recommended(language)

        return RecommendedAppListResult(
            recommended_apps=self._with_trial_status(page.recommended_apps),
            categories=page.categories,
        )

    def list_learn_dify(
        self,
        *,
        requested_language: str | None,
        interface_language: str | None,
    ) -> LearnDifyAppListResult:
        language = self._resolve_language(requested_language, interface_language)
        page = self._catalog.list_learn_dify(language)
        return LearnDifyAppListResult(recommended_apps=self._with_trial_status(page.recommended_apps))

    def get_detail(self, app_id: str) -> RecommendedAppDetailSummary:
        detail = self._catalog.get_detail(app_id)
        if detail is None:
            raise RecommendedAppNotFoundError

        can_trial = False
        if self._trial_enabled:
            can_trial = detail.id in self._trial_apps.existing_ids((detail.id,))

        return RecommendedAppDetailSummary(
            id=detail.id,
            name=detail.name,
            icon=detail.icon,
            icon_background=detail.icon_background,
            mode=detail.mode,
            export_data=detail.export_data,
            can_trial=can_trial,
        )

    def _with_trial_status(self, apps: Sequence[RecommendedAppRecord]) -> tuple[RecommendedAppSummary, ...]:
        trial_app_ids: Set[str] = set()
        if self._trial_enabled:
            trial_app_ids = self._trial_apps.existing_ids([app.app_id for app in apps])

        return tuple(
            RecommendedAppSummary(
                app=app.app,
                app_id=app.app_id,
                description=app.description,
                copyright=app.copyright,
                privacy_policy=app.privacy_policy,
                custom_disclaimer=app.custom_disclaimer,
                categories=app.categories,
                position=app.position,
                is_listed=app.is_listed,
                can_trial=app.app_id in trial_app_ids,
            )
            for app in apps
        )

    @staticmethod
    def _resolve_language(requested_language: str | None, interface_language: str | None) -> str:
        if requested_language and requested_language in languages:
            return requested_language
        if interface_language:
            return interface_language
        return languages[0]
