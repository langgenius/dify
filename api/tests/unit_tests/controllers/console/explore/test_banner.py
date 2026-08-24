from datetime import datetime
from typing import NamedTuple
from uuid import uuid4

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy.orm import Session, sessionmaker

import controllers.console.explore.banner as banner_module
from models.enums import BannerStatus
from models.model import ExporleBanner
from repositories.explore_banner_query_repository import ExploreBannerQueryRepository
from services.explore_banner_query_service import ExploreBannerQueryService, ExploreBannerRecord


class FakeExploreBannerQuery:
    def __init__(self, responses: dict[str, tuple[ExploreBannerRecord, ...]] | None = None) -> None:
        self.responses = responses or {}
        self.requested_languages: list[str] = []

    def list_enabled(self, language: str) -> tuple[ExploreBannerRecord, ...]:
        self.requested_languages.append(language)
        return self.responses.get(language, ())


class _ApplicationServicesStub(NamedTuple):
    explore_banner_queries: ExploreBannerQueryService


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


def _use_sqlite_banner_service(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    service = ExploreBannerQueryService(
        banners=ExploreBannerQueryRepository(sqlite_session_factory),
        enabled=True,
    )
    monkeypatch.setattr(
        banner_module,
        "application_services",
        lambda: _ApplicationServicesStub(explore_banner_queries=service),
    )


class TestExploreBannerQueryService:
    def test_returns_empty_without_querying_when_disabled(self) -> None:
        banners = FakeExploreBannerQuery()
        service = ExploreBannerQueryService(banners=banners, enabled=False)

        assert service.list_for_language("fr-FR") == ()
        assert banners.requested_languages == []

    def test_returns_requested_language(self) -> None:
        record = _record()
        banners = FakeExploreBannerQuery({"fr-FR": (record,)})
        service = ExploreBannerQueryService(banners=banners, enabled=True)

        assert service.list_for_language("fr-FR") == (record,)
        assert banners.requested_languages == ["fr-FR"]

    def test_falls_back_to_en_us(self) -> None:
        record = _record(title="fallback")
        banners = FakeExploreBannerQuery({"en-US": (record,)})
        service = ExploreBannerQueryService(banners=banners, enabled=True)

        assert service.list_for_language("es-ES") == (record,)
        assert banners.requested_languages == ["es-ES", "en-US"]

    def test_does_not_repeat_default_language_query(self) -> None:
        banners = FakeExploreBannerQuery()
        service = ExploreBannerQueryService(banners=banners, enabled=True)

        assert service.list_for_language("en-US") == ()
        assert banners.requested_languages == ["en-US"]


class TestExploreBannerQueryRepository:
    def test_filters_language_and_status_and_orders_by_sort(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
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
        sqlite_session.add_all([second, first, disabled, english])
        sqlite_session.commit()

        repository = ExploreBannerQueryRepository(sqlite_session_factory)
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
    def test_get_serializes_requested_language(
        self,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        banner = _banner(
            title="hello",
            language="fr-FR",
            link="https://example.com",
            created_at=datetime(2024, 1, 1),
        )
        sqlite_session.add(banner)
        sqlite_session.commit()
        _use_sqlite_banner_service(monkeypatch, sqlite_session_factory)

        with app.test_request_context("/?language=fr-FR"):
            result = banner_module.BannerApi().get()

        assert result == [
            {
                "id": banner.id,
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

    def test_get_uses_default_language(
        self,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        banner = _banner(
            title="default",
            language="en-US",
            link="https://example.com/default",
            created_at=datetime(2024, 1, 2),
        )
        sqlite_session.add(banner)
        sqlite_session.commit()
        _use_sqlite_banner_service(monkeypatch, sqlite_session_factory)

        with app.test_request_context("/"):
            result = banner_module.BannerApi().get()

        assert result[0]["id"] == banner.id
        assert result[0]["content"]["title"] == "default"

    def test_get_allows_empty_supporting_copy(
        self,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        banner = _banner(
            title="hello",
            language="en-US",
            link="https://example.com",
            created_at=datetime(2024, 1, 3),
        )
        banner.content["category"] = ""
        banner.content["description"] = ""
        sqlite_session.add(banner)
        sqlite_session.commit()
        _use_sqlite_banner_service(monkeypatch, sqlite_session_factory)

        with app.test_request_context("/"):
            result = banner_module.BannerApi().get()

        assert result[0]["content"] == {
            "category": "",
            "title": "hello",
            "description": "",
            "img-src": "https://example.com/banner.png",
        }

    def test_get_rejects_invalid_content(
        self,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        banner = _banner(
            title="invalid",
            language="en-US",
            link="https://example.com",
            created_at=datetime(2024, 1, 4),
        )
        banner.content = {"title": "invalid"}
        sqlite_session.add(banner)
        sqlite_session.commit()
        _use_sqlite_banner_service(monkeypatch, sqlite_session_factory)

        with app.test_request_context("/"), pytest.raises(ValidationError):
            banner_module.BannerApi().get()
