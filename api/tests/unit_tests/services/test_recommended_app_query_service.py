from unittest.mock import MagicMock

import pytest

from constants.languages import languages
from services.recommended_app_query_service import (
    RecommendedAppCatalogPage,
    RecommendedAppDetailRecord,
    RecommendedAppInfoRecord,
    RecommendedAppNotFoundError,
    RecommendedAppQueryService,
    RecommendedAppRecord,
)


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
    catalog: MagicMock,
    trial_apps: MagicMock | None = None,
    trial_enabled: MagicMock | None = None,
) -> tuple[RecommendedAppQueryService, MagicMock, MagicMock]:
    trial_apps = trial_apps or MagicMock()
    trial_enabled = trial_enabled or MagicMock(return_value=False)
    return (
        RecommendedAppQueryService(
            catalog=catalog,
            trial_apps=trial_apps,
            is_trial_enabled=trial_enabled,
        ),
        trial_apps,
        trial_enabled,
    )


@pytest.mark.parametrize(
    ("requested_language", "interface_language", "expected"),
    [
        ("en-US", "fr-FR", "en-US"),
        ("invalid", "fr-FR", "fr-FR"),
        (None, "custom-language", "custom-language"),
        (None, None, languages[0]),
    ],
)
def test_list_recommended_resolves_language(
    requested_language: str | None,
    interface_language: str | None,
    expected: str,
) -> None:
    catalog = MagicMock()
    catalog.list_recommended.return_value = _page("app-1")
    service, _, _ = _service(catalog=catalog)

    service.list_recommended(
        requested_language=requested_language,
        interface_language=interface_language,
    )

    catalog.list_recommended.assert_called_once_with(expected)


def test_list_recommended_falls_back_to_builtin_en_us_when_empty() -> None:
    catalog = MagicMock()
    catalog.list_recommended.return_value = _page(categories=("remote",))
    catalog.list_builtin.return_value = _page("builtin-app", categories=("builtin",))
    service, _, _ = _service(catalog=catalog)

    result = service.list_recommended(requested_language="ja-JP", interface_language=None)

    catalog.list_builtin.assert_called_once_with("en-US")
    assert [app.app_id for app in result.recommended_apps] == ["builtin-app"]
    assert result.categories == ("builtin",)


def test_list_recommended_disables_upstream_trial_without_querying_trial_apps() -> None:
    catalog = MagicMock()
    catalog.list_recommended.return_value = _page("app-1")
    service, trial_apps, _ = _service(catalog=catalog)

    result = service.list_recommended(requested_language="en-US", interface_language=None)

    assert result.recommended_apps[0].can_trial is False
    trial_apps.existing_ids.assert_not_called()


def test_list_recommended_enriches_trial_status_in_one_bulk_query() -> None:
    catalog = MagicMock()
    catalog.list_recommended.return_value = _page("app-1", "app-2")
    trial_apps = MagicMock()
    trial_apps.existing_ids.return_value = frozenset({"app-1"})
    service, _, _ = _service(
        catalog=catalog,
        trial_apps=trial_apps,
        trial_enabled=MagicMock(return_value=True),
    )

    result = service.list_recommended(requested_language="en-US", interface_language=None)

    assert [app.can_trial for app in result.recommended_apps] == [True, False]
    trial_apps.existing_ids.assert_called_once_with(["app-1", "app-2"])


def test_list_learn_dify_does_not_apply_general_builtin_fallback_or_return_categories() -> None:
    catalog = MagicMock()
    catalog.list_learn_dify.return_value = _page(categories=("ignored",))
    service, _, _ = _service(catalog=catalog)

    result = service.list_learn_dify(requested_language="invalid", interface_language="fr-FR")

    catalog.list_learn_dify.assert_called_once_with("fr-FR")
    catalog.list_builtin.assert_not_called()
    assert result.recommended_apps == ()
    assert not hasattr(result, "categories")


def test_get_detail_raises_not_found_before_reading_trial_policy() -> None:
    catalog = MagicMock()
    catalog.get_detail.return_value = None
    trial_enabled = MagicMock(side_effect=AssertionError("missing detail must not inspect trial policy"))
    service, trial_apps, _ = _service(catalog=catalog, trial_enabled=trial_enabled)

    with pytest.raises(RecommendedAppNotFoundError):
        service.get_detail("missing")
    trial_enabled.assert_not_called()
    trial_apps.existing_ids.assert_not_called()


def test_get_detail_does_not_query_trial_apps_when_disabled() -> None:
    catalog = MagicMock()
    catalog.get_detail.return_value = RecommendedAppDetailRecord(
        id="catalog-app-id",
        name="App",
        icon=None,
        icon_background=None,
        mode="chat",
        export_data="{}",
    )
    service, trial_apps, _ = _service(catalog=catalog)

    result = service.get_detail("route-app-id")

    assert result.can_trial is False
    trial_apps.existing_ids.assert_not_called()


@pytest.mark.parametrize(("existing_ids", "expected"), [(frozenset({"catalog-app-id"}), True), (frozenset(), False)])
def test_get_detail_uses_catalog_result_id_for_trial_status(existing_ids: frozenset[str], expected: bool) -> None:
    catalog = MagicMock()
    catalog.get_detail.return_value = RecommendedAppDetailRecord(
        id="catalog-app-id",
        name="App",
        icon=None,
        icon_background=None,
        mode="chat",
        export_data="{}",
    )
    trial_apps = MagicMock()
    trial_apps.existing_ids.return_value = existing_ids
    service, _, _ = _service(
        catalog=catalog,
        trial_apps=trial_apps,
        trial_enabled=MagicMock(return_value=True),
    )

    result = service.get_detail("route-app-id")

    assert result.can_trial is expected
    trial_apps.existing_ids.assert_called_once_with(("catalog-app-id",))
