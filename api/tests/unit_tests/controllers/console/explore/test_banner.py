from collections.abc import Iterator
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, call
from uuid import uuid4

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, scoped_session, sessionmaker

import controllers.console.explore.banner as banner_module
from models.base import TypeBase
from models.enums import BannerStatus
from models.model import ExporleBanner
from repositories.explore_banner_query_repository import ExploreBannerQueryRepository
from services.explore_banner_query_service import ExploreBannerQueryService, ExploreBannerRecord


@pytest.fixture
def banner_session(sqlite_engine: Engine) -> Iterator[scoped_session[Session]]:
    """Create the banner table without its PostgreSQL-cast server defaults."""
    table = TypeBase.metadata.tables[ExporleBanner.__tablename__]
    status_default = table.c.status.server_default
    language_default = table.c.language.server_default
    table.c.status.server_default = None
    table.c.language.server_default = None
    try:
        TypeBase.metadata.create_all(sqlite_engine, tables=[table])
    finally:
        table.c.status.server_default = status_default
        table.c.language.server_default = language_default

    session = scoped_session(sessionmaker(bind=sqlite_engine, expire_on_commit=False))
    try:
        yield session
    finally:
        session.remove()


def _content(
    title: str,
    *,
    category: str = "Featured",
    description: str = "Banner description",
) -> dict[str, str]:
    return {
        "category": category,
        "title": title,
        "description": description,
        "img-src": "https://example.com/banner.png",
    }


def _banner(
    *,
    title: str,
    language: str,
    link: str,
    created_at: datetime,
    sort: int = 1,
    status: BannerStatus = BannerStatus.ENABLED,
) -> ExporleBanner:
    banner = ExporleBanner(
        content=_content(title),
        link=link,
        sort=sort,
        status=status,
        language=language,
    )
    banner.id = str(uuid4())
    banner.created_at = created_at
    return banner


def _record(
    *,
    title: str = "hello",
    category: str = "Featured",
    description: str = "Banner description",
) -> ExploreBannerRecord:
    return ExploreBannerRecord(
        id="banner-1",
        content=_content(title, category=category, description=description),
        link="https://example.com",
        sort=1,
        status=BannerStatus.ENABLED.value,
        created_at=datetime(2024, 1, 1),
    )


class TestExploreBannerQueryService:
    def test_returns_empty_without_querying_when_disabled(self) -> None:
        banners = MagicMock()
        service = ExploreBannerQueryService(banners=banners, is_enabled=lambda: False)

        assert service.list_for_language("fr-FR") == ()
        banners.list_enabled.assert_not_called()

    def test_returns_requested_language(self) -> None:
        record = _record()
        banners = MagicMock()
        banners.list_enabled.return_value = (record,)
        service = ExploreBannerQueryService(banners=banners, is_enabled=lambda: True)

        assert service.list_for_language("fr-FR") == (record,)
        banners.list_enabled.assert_called_once_with("fr-FR")

    def test_falls_back_to_en_us(self) -> None:
        record = _record(title="fallback")
        banners = MagicMock()
        banners.list_enabled.side_effect = [(), (record,)]
        service = ExploreBannerQueryService(banners=banners, is_enabled=lambda: True)

        assert service.list_for_language("es-ES") == (record,)
        assert banners.list_enabled.call_args_list == [
            call("es-ES"),
            call("en-US"),
        ]

    def test_does_not_repeat_default_language_query(self) -> None:
        banners = MagicMock()
        banners.list_enabled.return_value = ()
        service = ExploreBannerQueryService(banners=banners, is_enabled=lambda: True)

        assert service.list_for_language("en-US") == ()
        banners.list_enabled.assert_called_once_with("en-US")


class TestExploreBannerQueryRepository:
    def test_filters_language_and_status_and_orders_by_sort(self, banner_session: scoped_session[Session]) -> None:
        created_at = datetime(2024, 1, 1)
        second = _banner(
            title="second",
            language="fr-FR",
            link="https://example.com/second",
            created_at=created_at,
            sort=2,
        )
        first = _banner(
            title="first",
            language="fr-FR",
            link="https://example.com/first",
            created_at=created_at,
        )
        disabled = _banner(
            title="disabled",
            language="fr-FR",
            link="https://example.com/disabled",
            created_at=created_at,
            sort=0,
            status=BannerStatus.DISABLED,
        )
        english = _banner(
            title="english",
            language="en-US",
            link="https://example.com/english",
            created_at=created_at,
        )
        banner_session.add_all([second, first, disabled, english])
        banner_session.commit()

        repository = ExploreBannerQueryRepository(banner_session.session_factory)
        result = repository.list_enabled("fr-FR")

        assert [banner.id for banner in result] == [first.id, second.id]
        assert result[0] == ExploreBannerRecord(
            id=first.id,
            content=_content("first"),
            link="https://example.com/first",
            sort=1,
            status=BannerStatus.ENABLED.value,
            created_at=created_at,
        )


class TestBannerApi:
    def test_get_serializes_requested_language(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        queries = MagicMock()
        queries.list_for_language.return_value = (_record(),)
        monkeypatch.setattr(
            banner_module,
            "application_services",
            lambda: SimpleNamespace(explore_banner_queries=queries),
        )

        with app.test_request_context("/?language=fr-FR"):
            result = banner_module.BannerApi().get()

        assert result == [
            {
                "id": "banner-1",
                "content": {
                    "category": "Featured",
                    "title": "hello",
                    "description": "Banner description",
                    "img-src": "https://example.com/banner.png",
                },
                "link": "https://example.com",
                "sort": 1,
                "status": "enabled",
                "created_at": "2024-01-01T00:00:00",
            }
        ]
        queries.list_for_language.assert_called_once_with("fr-FR")

    def test_get_uses_default_language(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        queries = MagicMock()
        queries.list_for_language.return_value = ()
        monkeypatch.setattr(
            banner_module,
            "application_services",
            lambda: SimpleNamespace(explore_banner_queries=queries),
        )

        with app.test_request_context("/"):
            result = banner_module.BannerApi().get()

        assert result == []
        queries.list_for_language.assert_called_once_with("en-US")

    def test_get_allows_empty_supporting_copy(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        queries = MagicMock()
        queries.list_for_language.return_value = (_record(category="", description=""),)
        monkeypatch.setattr(
            banner_module,
            "application_services",
            lambda: SimpleNamespace(explore_banner_queries=queries),
        )

        with app.test_request_context("/"):
            result = banner_module.BannerApi().get()

        assert result[0]["content"] == {
            "category": "",
            "title": "hello",
            "description": "",
            "img-src": "https://example.com/banner.png",
        }

    def test_get_rejects_invalid_content(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        queries = MagicMock()
        queries.list_for_language.return_value = (_record()._replace(content={"title": "invalid"}),)
        monkeypatch.setattr(
            banner_module,
            "application_services",
            lambda: SimpleNamespace(explore_banner_queries=queries),
        )

        with app.test_request_context("/"):
            with pytest.raises(ValidationError):
                banner_module.BannerApi().get()
