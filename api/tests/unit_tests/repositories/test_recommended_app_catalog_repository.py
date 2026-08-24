import json
from unittest.mock import MagicMock, patch
from uuid import uuid4

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_redis import RedisClientWrapper
from models.model import App, AppMode, RecommendedApp, Site
from repositories.recommended_app_catalog_repository import DatabaseRecommendedAppCatalogRepository
from services.recommended_app_query_service import RecommendedAppDetailRecord


def _add_catalog_app(
    session: Session,
    *,
    categories: list[str] | None = None,
    language: str = "en-US",
    is_public: bool = True,
    is_listed: bool = True,
    is_learn_dify: bool = False,
    with_site: bool = True,
) -> App:
    app = App(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        name="Recommended App",
        mode=AppMode.CHAT,
        icon_type=None,
        icon=None,
        icon_background="#fff",
        enable_site=True,
        enable_api=True,
        is_public=is_public,
    )
    recommended_app = RecommendedApp(
        app_id=app.id,
        description={},
        copyright="copyright",
        privacy_policy="privacy",
        category="Workflow",
        categories=["Workflow"] if categories is None else categories,
        custom_disclaimer="catalog disclaimer",
        position=1,
        is_listed=is_listed,
        is_learn_dify=is_learn_dify,
        language=language,
    )
    session.add_all([app, recommended_app])
    if with_site:
        session.add(
            Site(
                app_id=app.id,
                title="Recommended App",
                description="site description",
                copyright="site copyright",
                privacy_policy="site privacy",
                custom_disclaimer="site disclaimer",
                default_language="en-US",
                customize_token_strategy="not_allow",
            )
        )
    session.commit()
    return app


def _redis() -> MagicMock:
    redis = MagicMock(spec=RedisClientWrapper)
    redis.get.return_value = None
    return redis


def _repository(
    session_factory: sessionmaker[Session],
    *,
    redis: RedisClientWrapper | None = None,
) -> DatabaseRecommendedAppCatalogRepository:
    return DatabaseRecommendedAppCatalogRepository(
        session_factory,
        redis=redis if redis is not None else _redis(),
    )


def test_list_recommended_returns_typed_records_and_falls_back_language(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory() as session:
        app = _add_catalog_app(session)

    repository = _repository(sqlite_session_factory)
    page = repository.list_recommended("fr-FR")

    assert page.categories == ("Workflow",)
    assert len(page.recommended_apps) == 1
    record = page.recommended_apps[0]
    assert record.app_id == app.id
    assert record.app is not None
    assert record.app.id == app.id
    assert record.app.mode == "chat"
    assert record.description == "site description"
    assert record.custom_disclaimer == "site disclaimer"
    assert record.categories == ("Workflow",)


def test_list_recommended_skips_private_apps_and_apps_without_sites(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory() as session:
        _add_catalog_app(session, is_public=False)
        _add_catalog_app(session, with_site=False)

    repository = _repository(sqlite_session_factory)

    assert repository.list_recommended("en-US").recommended_apps == ()


def test_list_recommended_does_not_restore_legacy_category_when_categories_are_empty(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory() as session:
        app = _add_catalog_app(session, categories=[])

    page = _repository(sqlite_session_factory).list_recommended("en-US")

    record = next(item for item in page.recommended_apps if item.app_id == app.id)
    assert record.categories == ()
    assert "Workflow" not in page.categories


def test_list_recommended_uses_redis_category_order(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory() as session:
        _add_catalog_app(session, categories=["A", "B", "C", "D"])

    checked_out_connections = 0

    def record_checkout(_dbapi_connection, _connection_record, _connection_proxy) -> None:
        nonlocal checked_out_connections
        checked_out_connections += 1

    def record_checkin(_dbapi_connection, _connection_record) -> None:
        nonlocal checked_out_connections
        checked_out_connections -= 1

    def get_category_order(_key: str) -> bytes:
        assert checked_out_connections == 0
        return json.dumps(["C", "A", "B"]).encode()

    redis = _redis()
    redis.get.side_effect = get_category_order
    event.listen(sqlite_engine, "checkout", record_checkout)
    event.listen(sqlite_engine, "checkin", record_checkin)
    try:
        page = _repository(sqlite_session_factory, redis=redis).list_recommended("en-US")
    finally:
        event.remove(sqlite_engine, "checkout", record_checkout)
        event.remove(sqlite_engine, "checkin", record_checkin)

    assert page.categories == ("C", "A", "B")
    redis.get.assert_called_once_with("explore:apps:category_order:en-US")


def test_list_recommended_sorts_categories_without_redis_order(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    redis = _redis()
    with sqlite_session_factory() as session:
        _add_catalog_app(session, categories=["B", "A", "C"])

    page = _repository(sqlite_session_factory, redis=redis).list_recommended("en-US")

    assert page.categories == ("A", "B", "C")


def test_list_learn_dify_filters_flag_and_hides_page_categories(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory() as session:
        learn_app = _add_catalog_app(session, is_learn_dify=True)
        _add_catalog_app(session, is_learn_dify=False)

    redis = _redis()
    repository = _repository(sqlite_session_factory, redis=redis)
    page = repository.list_learn_dify("fr-FR")

    assert [app.app_id for app in page.recommended_apps] == [learn_app.id]
    assert page.recommended_apps[0].categories == ("Workflow",)
    assert page.categories == ()
    redis.get.assert_not_called()


def test_membership_does_not_export_dsl(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory() as session:
        app = _add_catalog_app(session)

    repository = _repository(sqlite_session_factory)
    with patch(
        "repositories.recommended_app_catalog_repository.AppDslService.export_dsl",
        return_value="exported yaml",
    ) as export_dsl:
        detail = repository.get_detail(app.id)
        is_in_catalog = repository.contains(app.id)

    assert detail == RecommendedAppDetailRecord(
        id=app.id,
        name="Recommended App",
        icon=None,
        icon_background="#fff",
        mode="chat",
        export_data="exported yaml",
    )
    assert is_in_catalog is True
    export_dsl.assert_called_once()


def test_detail_rejects_unlisted_or_private_apps(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory() as session:
        private_app = _add_catalog_app(session, is_public=False)
        unlisted_app = _add_catalog_app(session, is_listed=False)
        missing_app_id = str(uuid4())

    repository = _repository(sqlite_session_factory)

    assert repository.get_detail(private_app.id) is None
    assert repository.get_detail(unlisted_app.id) is None
    assert repository.get_detail(missing_app_id) is None
    assert repository.contains(private_app.id) is False
    assert repository.contains(unlisted_app.id) is False
    assert repository.contains(missing_app_id) is False


def test_detail_does_not_require_site(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory() as session:
        app = _add_catalog_app(session, with_site=False)

    repository = _repository(sqlite_session_factory)
    with patch(
        "repositories.recommended_app_catalog_repository.AppDslService.export_dsl",
        return_value="exported yaml",
    ):
        detail = repository.get_detail(app.id)

    assert detail is not None
    assert detail.id == app.id
