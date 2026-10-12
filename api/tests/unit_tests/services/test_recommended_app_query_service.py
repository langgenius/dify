from collections.abc import Sequence

import pytest

from services.recommended_app_query_service import (
    RecommendedAppCatalogPage,
    RecommendedAppCatalogQuery,
    RecommendedAppDetailRecord,
    RecommendedAppInfoRecord,
    RecommendedAppNotFoundError,
    RecommendedAppQueryService,
    RecommendedAppRecord,
    TrialAppQuery,
)


class Catalog(RecommendedAppCatalogQuery):
    def __init__(self) -> None:
        self.page = RecommendedAppCatalogPage((), ())
        self.detail: RecommendedAppDetailRecord | None = None
        self.app_ids: set[str] = set()
        self.contains_calls: list[str] = []
        self.detail_calls: list[str] = []
        self.recommended_calls: list[str] = []
        self.learn_calls: list[str] = []

    def list_recommended(self, language: str) -> RecommendedAppCatalogPage:
        self.recommended_calls.append(language)
        return self.page

    def list_learn_dify(self, language: str) -> RecommendedAppCatalogPage:
        self.learn_calls.append(language)
        return self.page

    def get_detail(self, app_id: str) -> RecommendedAppDetailRecord | None:
        self.detail_calls.append(app_id)
        return self.detail

    def contains(self, app_id: str) -> bool:
        self.contains_calls.append(app_id)
        return app_id in self.app_ids


class TrialApps(TrialAppQuery):
    def __init__(self) -> None:
        self.app_ids: frozenset[str] = frozenset()
        self.calls: list[Sequence[str]] = []

    def existing_ids(self, app_ids: Sequence[str]) -> frozenset[str]:
        self.calls.append(app_ids)
        return self.app_ids.intersection(app_ids)


def _app(app_id: str) -> RecommendedAppRecord:
    return RecommendedAppRecord(
        app=RecommendedAppInfoRecord(
            id=app_id,
            name=f"App {app_id}",
            mode="chat",
            icon="icon.png",
            icon_type="image",
            icon_background="#fff",
        ),
        app_id=app_id,
        description="description",
        copyright=None,
        privacy_policy=None,
        custom_disclaimer=None,
        categories=("Workflow",),
        position=1,
        is_listed=True,
    )


def _page(*app_ids: str, categories: tuple[str, ...] = ("Workflow",)) -> RecommendedAppCatalogPage:
    return RecommendedAppCatalogPage(
        recommended_apps=tuple(_app(app_id) for app_id in app_ids),
        categories=categories,
    )


def _service(
    *,
    catalog: Catalog,
    trial_apps: TrialApps | None = None,
    trial_enabled: bool = False,
) -> tuple[RecommendedAppQueryService, TrialApps]:
    trial_apps = trial_apps if trial_apps is not None else TrialApps()
    return (
        RecommendedAppQueryService(
            catalog=catalog,
            trial_apps=trial_apps,
            trial_enabled=trial_enabled,
        ),
        trial_apps,
    )


def test_is_previewable_accepts_trial_registration_without_querying_catalog() -> None:
    catalog = Catalog()
    trial_apps = TrialApps()
    trial_apps.app_ids = frozenset({"app-1"})
    service, _ = _service(catalog=catalog, trial_apps=trial_apps)

    assert service.is_previewable("app-1") is True
    assert trial_apps.calls == [("app-1",)]
    assert catalog.contains_calls == []


@pytest.mark.parametrize("expected", [True, False])
def test_is_previewable_falls_back_to_catalog(expected: bool) -> None:
    catalog = Catalog()
    catalog.app_ids = {"app-1"} if expected else set()
    trial_apps = TrialApps()
    service, _ = _service(catalog=catalog, trial_apps=trial_apps)

    assert service.is_previewable("app-1") is expected
    assert trial_apps.calls == [("app-1",)]
    assert catalog.contains_calls == ["app-1"]


@pytest.mark.parametrize(
    ("language", "expected"),
    [
        ("fr-FR", "fr-FR"),
        ("invalid", "en-US"),
    ],
)
def test_list_recommended_resolves_language(
    language: str,
    expected: str,
) -> None:
    catalog = Catalog()
    catalog.page = _page("app-1")
    service, _ = _service(catalog=catalog)

    service.list_recommended(
        language=language,
    )

    assert catalog.recommended_calls == [expected]


def test_list_recommended_disables_upstream_trial_without_querying_trial_apps() -> None:
    catalog = Catalog()
    catalog.page = _page("app-1")
    service, trial_apps = _service(catalog=catalog)

    result = service.list_recommended(language="en-US")

    assert result.recommended_apps[0].can_trial is False
    assert trial_apps.calls == []


def test_list_recommended_enriches_trial_status_in_one_bulk_query() -> None:
    catalog = Catalog()
    catalog.page = _page("app-1", "app-2")
    trial_apps = TrialApps()
    trial_apps.app_ids = frozenset({"app-1"})
    service, _ = _service(
        catalog=catalog,
        trial_apps=trial_apps,
        trial_enabled=True,
    )

    result = service.list_recommended(language="en-US")

    assert [app.can_trial for app in result.recommended_apps] == [True, False]
    assert trial_apps.calls == [["app-1", "app-2"]]


def test_list_learn_dify_does_not_return_categories() -> None:
    catalog = Catalog()
    catalog.page = _page(categories=("ignored",))
    service, _ = _service(catalog=catalog)

    result = service.list_learn_dify(language="invalid")

    assert catalog.learn_calls == ["en-US"]
    assert result.recommended_apps == ()
    assert not hasattr(result, "categories")


def test_get_detail_raises_not_found_without_querying_trial_apps() -> None:
    catalog = Catalog()
    service, trial_apps = _service(catalog=catalog, trial_enabled=True)

    with pytest.raises(RecommendedAppNotFoundError):
        service.get_detail("missing")
    assert trial_apps.calls == []


def test_get_detail_does_not_query_trial_apps_when_disabled() -> None:
    catalog = Catalog()
    catalog.detail = RecommendedAppDetailRecord(
        id="catalog-app-id",
        name="App",
        icon=None,
        icon_background=None,
        mode="chat",
        export_data="{}",
    )
    service, trial_apps = _service(catalog=catalog)

    result = service.get_detail("route-app-id")

    assert result.can_trial is False
    assert trial_apps.calls == []


@pytest.mark.parametrize(("existing_ids", "expected"), [(frozenset({"catalog-app-id"}), True), (frozenset(), False)])
def test_get_detail_uses_catalog_result_id_for_trial_status(existing_ids: frozenset[str], expected: bool) -> None:
    catalog = Catalog()
    catalog.detail = RecommendedAppDetailRecord(
        id="catalog-app-id",
        name="App",
        icon=None,
        icon_background=None,
        mode="agent",
        export_data="",
        package_url="https://templates.example/agent.ifpkg",
        version_id="published-version",
    )
    trial_apps = TrialApps()
    trial_apps.app_ids = existing_ids
    service, _ = _service(
        catalog=catalog,
        trial_apps=trial_apps,
        trial_enabled=True,
    )

    result = service.get_detail("route-app-id")

    assert result.can_trial is expected
    assert result.package_url == "https://templates.example/agent.ifpkg"
    assert result.version_id == "published-version"
    assert trial_apps.calls == [("catalog-app-id",)]
