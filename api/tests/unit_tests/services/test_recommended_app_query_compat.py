from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session, sessionmaker

from models.model import App, AppMode, IconType
from services import recommended_app_query_compat as compat_module
from services.recommended_app_query_compat import LegacyRecommendedAppCatalogGateway
from services.recommended_app_query_service import (
    RecommendedAppCatalogPage,
    RecommendedAppDetailRecord,
    RecommendedAppInfoRecord,
    RecommendedAppRecord,
)


@pytest.fixture
def gateway_dependencies(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[LegacyRecommendedAppCatalogGateway, MagicMock, MagicMock, MagicMock]:
    session = MagicMock(spec=Session)
    session_factory = MagicMock(spec=sessionmaker)
    session_factory.return_value.__enter__.return_value = session
    retrieval = MagicMock()
    retrieval_type = MagicMock(return_value=retrieval)
    get_factory = MagicMock(return_value=retrieval_type)
    monkeypatch.setattr(compat_module.dify_config, "HOSTED_FETCH_APP_TEMPLATES_MODE", "remote")
    monkeypatch.setattr(
        compat_module.RecommendAppRetrievalFactory,
        "get_recommend_app_factory",
        get_factory,
    )
    return LegacyRecommendedAppCatalogGateway(session_factory), session, retrieval, get_factory


@pytest.mark.parametrize(("detail", "expected"), [(object(), True), (None, False)])
def test_is_recommended_uses_configured_retrieval_without_mapping_detail(
    detail: object | None,
    expected: bool,
    gateway_dependencies: tuple[LegacyRecommendedAppCatalogGateway, MagicMock, MagicMock, MagicMock],
) -> None:
    gateway, session, retrieval, get_factory = gateway_dependencies
    retrieval.get_recommend_app_detail.return_value = detail

    assert gateway.is_recommended("app-1") is expected
    get_factory.assert_called_once_with("remote")
    retrieval.get_recommend_app_detail.assert_called_once_with("app-1", session=session)


@pytest.mark.parametrize("app_source_kind", ["mapping", "orm"])
def test_list_recommended_selects_configured_retrieval_and_maps_mixed_results(
    app_source_kind: str,
    gateway_dependencies: tuple[LegacyRecommendedAppCatalogGateway, MagicMock, MagicMock, MagicMock],
) -> None:
    gateway, session, retrieval, get_factory = gateway_dependencies
    app = App(
        tenant_id="tenant-1",
        name="App",
        mode=AppMode.CHAT,
        icon_type=IconType.IMAGE,
        icon="icon.png",
        icon_background="#fff",
        enable_site=True,
        enable_api=True,
    )
    app.id = "app-1"
    app_source: object = app
    if app_source_kind == "mapping":
        app_source = {
            "id": "app-1",
            "name": "App",
            "mode": "chat",
            "icon": "icon.png",
            "icon_type": "image",
            "icon_background": "#fff",
        }
    retrieval.get_recommended_apps_and_categories.return_value = {
        "recommended_apps": [
            {
                "app": app_source,
                "app_id": "app-1",
                "description": "description",
                "copyright": None,
                "privacy_policy": None,
                "categories": ["Workflow"],
                "position": 1,
                "is_listed": True,
            }
        ],
        "categories": ["Workflow"],
    }

    result = gateway.list_recommended("en-US")

    assert result == RecommendedAppCatalogPage(
        recommended_apps=(
            RecommendedAppRecord(
                app=RecommendedAppInfoRecord(
                    id="app-1",
                    name="App",
                    mode="chat",
                    icon="icon.png",
                    icon_type="image",
                    icon_background="#fff",
                ),
                app_id="app-1",
                description="description",
                copyright=None,
                privacy_policy=None,
                custom_disclaimer=None,
                categories=("Workflow",),
                position=1,
                is_listed=True,
            ),
        ),
        categories=("Workflow",),
    )
    get_factory.assert_called_once_with("remote")
    retrieval.get_recommended_apps_and_categories.assert_called_once_with("en-US", session=session)


def test_list_builtin_uses_builtin_source(
    monkeypatch: pytest.MonkeyPatch,
    gateway_dependencies: tuple[LegacyRecommendedAppCatalogGateway, MagicMock, MagicMock, MagicMock],
) -> None:
    gateway, _, _, _ = gateway_dependencies
    builtin = MagicMock()
    builtin_result: dict[str, object] = {"recommended_apps": [], "categories": []}
    builtin.fetch_recommended_apps_from_builtin.return_value = builtin_result
    get_builtin = MagicMock(return_value=builtin)
    monkeypatch.setattr(
        compat_module.RecommendAppRetrievalFactory,
        "get_buildin_recommend_app_retrieval",
        get_builtin,
    )

    result = gateway.list_builtin("en-US")

    assert result == RecommendedAppCatalogPage(recommended_apps=(), categories=())
    builtin.fetch_recommended_apps_from_builtin.assert_called_once_with("en-US")


def test_list_learn_dify_delegates_to_configured_retrieval(
    gateway_dependencies: tuple[LegacyRecommendedAppCatalogGateway, MagicMock, MagicMock, MagicMock],
) -> None:
    gateway, session, retrieval, _ = gateway_dependencies
    learn_dify_result: dict[str, object] = {"recommended_apps": [], "categories": ["ignored"]}
    retrieval.get_learn_dify_apps.return_value = learn_dify_result

    result = gateway.list_learn_dify("fr-FR")

    assert result.categories == ()
    retrieval.get_learn_dify_apps.assert_called_once_with("fr-FR", session=session)


def test_list_recommended_maps_none_apps_to_empty_page(
    gateway_dependencies: tuple[LegacyRecommendedAppCatalogGateway, MagicMock, MagicMock, MagicMock],
) -> None:
    gateway, _, retrieval, _ = gateway_dependencies
    retrieval.get_recommended_apps_and_categories.return_value = {
        "recommended_apps": None,
        "categories": ["ignored"],
    }

    assert gateway.list_recommended("en-US") == RecommendedAppCatalogPage(recommended_apps=(), categories=())


def test_list_recommended_rejects_missing_categories_for_nonempty_page(
    gateway_dependencies: tuple[LegacyRecommendedAppCatalogGateway, MagicMock, MagicMock, MagicMock],
) -> None:
    gateway, _, retrieval, _ = gateway_dependencies
    retrieval.get_recommended_apps_and_categories.return_value = {
        "recommended_apps": [{"app_id": "app-1", "app": None}],
    }

    with pytest.raises(KeyError, match="categories"):
        gateway.list_recommended("en-US")


@pytest.mark.parametrize("categories", ["Agent", b"Agent", ["Agent", 1]])
def test_list_recommended_rejects_malformed_categories(
    categories: object,
    gateway_dependencies: tuple[LegacyRecommendedAppCatalogGateway, MagicMock, MagicMock, MagicMock],
) -> None:
    gateway, _, retrieval, _ = gateway_dependencies
    retrieval.get_recommended_apps_and_categories.return_value = {
        "recommended_apps": [{"app_id": "app-1", "app": None, "categories": list[str]()}],
        "categories": categories,
    }

    with pytest.raises(TypeError, match="categories must"):
        gateway.list_recommended("en-US")


def test_list_recommended_rejects_malformed_app_categories(
    gateway_dependencies: tuple[LegacyRecommendedAppCatalogGateway, MagicMock, MagicMock, MagicMock],
) -> None:
    gateway, _, retrieval, _ = gateway_dependencies
    retrieval.get_recommended_apps_and_categories.return_value = {
        "recommended_apps": [{"app_id": "app-1", "app": None, "categories": "Agent"}],
        "categories": ["Agent"],
    }

    with pytest.raises(TypeError, match="categories must"):
        gateway.list_recommended("en-US")


def test_get_detail_maps_result_and_preserves_nullable_contract(
    gateway_dependencies: tuple[LegacyRecommendedAppCatalogGateway, MagicMock, MagicMock, MagicMock],
) -> None:
    gateway, session, retrieval, _ = gateway_dependencies
    retrieval.get_recommend_app_detail.side_effect = [
        {
            "id": "app-1",
            "name": "App",
            "icon": None,
            "icon_background": None,
            "mode": AppMode.CHAT,
            "export_data": "{}",
        },
        None,
    ]

    assert gateway.get_detail("app-1") == RecommendedAppDetailRecord(
        id="app-1",
        name="App",
        icon=None,
        icon_background=None,
        mode="chat",
        export_data="{}",
    )
    assert gateway.get_detail("missing") is None
    assert retrieval.get_recommend_app_detail.call_args_list[0].args == ("app-1",)
    assert retrieval.get_recommend_app_detail.call_args_list[0].kwargs == {"session": session}


def test_get_detail_rejects_arbitrary_enum_like_object(
    gateway_dependencies: tuple[LegacyRecommendedAppCatalogGateway, MagicMock, MagicMock, MagicMock],
) -> None:
    gateway, _, retrieval, _ = gateway_dependencies
    retrieval.get_recommend_app_detail.return_value = {
        "id": "app-1",
        "name": "App",
        "icon": None,
        "icon_background": None,
        "mode": object(),
        "export_data": "{}",
    }

    with pytest.raises(TypeError, match="mode must be a string or string enum"):
        gateway.get_detail("app-1")


def test_get_detail_rejects_non_mapping_result(
    gateway_dependencies: tuple[LegacyRecommendedAppCatalogGateway, MagicMock, MagicMock, MagicMock],
) -> None:
    gateway, _, retrieval, _ = gateway_dependencies
    retrieval.get_recommend_app_detail.return_value = object()

    with pytest.raises(TypeError, match="recommended app detail must be a mapping"):
        gateway.get_detail("app-1")
