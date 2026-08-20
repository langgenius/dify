from unittest.mock import MagicMock, patch
from uuid import uuid4

from sqlalchemy.orm import Session, object_session, sessionmaker

from extensions.ext_redis import RedisClientWrapper
from models.model import App, RecommendedApp, Site
from repositories.recommended_app_catalog_repository import DatabaseRecommendedAppCatalogRepository
from services.recommended_app_query_service import RecommendedAppDetailRecord


def _add_catalog_app(
    session: Session,
    *,
    categories: list[str] | None = None,
    language: str = "en-US",
    is_public: bool = True,
    with_site: bool = True,
) -> App:
    app = App(
        tenant_id=str(uuid4()),
        name=f"app-{uuid4()}",
        mode="chat",
        enable_site=True,
        enable_api=True,
        is_public=is_public,
    )
    app.id = str(uuid4())
    session.add(app)
    session.add(
        RecommendedApp(
            app_id=app.id,
            description={"en-US": "test"},
            copyright="copy",
            privacy_policy="privacy",
            category="writing",
            categories=["writing"] if categories is None else categories,
            language=language,
            is_listed=True,
            position=1,
        )
    )
    if with_site:
        session.add(
            Site(
                app_id=app.id,
                title=f"site-{uuid4()}",
                default_language="en-US",
                customize_token_strategy="not_allow",
                description="description",
                copyright="copyright",
                privacy_policy="privacy",
                custom_disclaimer="disclaimer",
            )
        )
    session.commit()
    return app


def _repository(session: Session) -> DatabaseRecommendedAppCatalogRepository:
    redis = MagicMock(spec=RedisClientWrapper)
    redis.get.return_value = None
    return DatabaseRecommendedAppCatalogRepository(
        sessionmaker(bind=session.get_bind(), expire_on_commit=False),
        redis=redis,
    )


def test_list_maps_postgres_models_with_owned_session(
    db_session_with_containers: Session,
) -> None:
    app = _add_catalog_app(
        db_session_with_containers,
        categories=["writing", "assistant"],
    )
    private_app = _add_catalog_app(db_session_with_containers, is_public=False)
    no_site_app = _add_catalog_app(db_session_with_containers, with_site=False)

    page = _repository(db_session_with_containers).list_recommended("fr-FR")

    record = next(item for item in page.recommended_apps if item.app_id == app.id)
    assert record.app is not None
    assert record.app.id == app.id
    assert record.app.mode == "chat"
    assert record.description == "description"
    assert record.categories == ("writing", "assistant")
    assert {"writing", "assistant"} <= set(page.categories)
    assert private_app.id not in {item.app_id for item in page.recommended_apps}
    assert no_site_app.id not in {item.app_id for item in page.recommended_apps}


def test_membership_does_not_export_dsl_with_owned_session(
    db_session_with_containers: Session,
) -> None:
    app = _add_catalog_app(db_session_with_containers, with_site=False)
    repository = _repository(db_session_with_containers)

    def export_dsl(*, app_model: App, session: Session) -> str:
        assert object_session(app_model) is session
        assert session is not db_session_with_containers
        return "exported_yaml"

    with patch(
        "repositories.recommended_app_catalog_repository.AppDslService.export_dsl",
        side_effect=export_dsl,
    ) as mock_export_dsl:
        detail = repository.get_detail(app.id)
        is_in_catalog = repository.contains(app.id)

    assert detail == RecommendedAppDetailRecord(
        id=app.id,
        name=app.name,
        icon=app.icon,
        icon_background=app.icon_background,
        mode="chat",
        export_data="exported_yaml",
    )
    assert is_in_catalog is True
    mock_export_dsl.assert_called_once()
