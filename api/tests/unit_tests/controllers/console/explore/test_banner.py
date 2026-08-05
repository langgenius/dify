from collections.abc import Iterator
from datetime import datetime
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

import controllers.console.explore.banner as banner_module
from models.base import TypeBase
from models.enums import BannerStatus
from models.model import ExporleBanner


@pytest.fixture
def banner_session(sqlite_engine: Engine) -> Iterator[Session]:
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

    with Session(sqlite_engine, expire_on_commit=False) as session:
        yield session


def _banner(*, title: str, language: str, link: str, created_at: datetime) -> ExporleBanner:
    banner = ExporleBanner(
        content={
            "category": "Featured",
            "title": title,
            "description": "Banner description",
            "img-src": "https://example.com/banner.png",
        },
        link=link,
        sort=1,
        status=BannerStatus.ENABLED,
        language=language,
    )
    banner.id = str(uuid4())
    banner.created_at = created_at
    return banner


class TestBannerApi:
    def test_get_banners_with_requested_language(
        self,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        banner_session: Session,
    ):
        api = banner_module.BannerApi()

        banner = _banner(
            title="hello",
            language="fr-FR",
            link="https://example.com",
            created_at=datetime(2024, 1, 1),
        )
        banner_session.add(banner)
        banner_session.commit()
        monkeypatch.setattr(banner_module.db, "session", banner_session)
        monkeypatch.setattr(banner_module.FeatureService, "is_explore_banner_enabled", lambda: True)

        with app.test_request_context("/?language=fr-FR"):
            result = api.get()

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

    def test_get_banners_fallback_to_en_us(
        self,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        banner_session: Session,
    ):
        api = banner_module.BannerApi()

        banner = _banner(
            title="fallback",
            language="en-US",
            link="https://example.com/fallback",
            created_at=datetime(2024, 1, 2),
        )
        banner_session.add(banner)
        banner_session.commit()
        monkeypatch.setattr(banner_module.db, "session", banner_session)
        monkeypatch.setattr(banner_module.FeatureService, "is_explore_banner_enabled", lambda: True)

        with app.test_request_context("/?language=es-ES"):
            result = api.get()

        assert result == [
            {
                "id": banner.id,
                "content": {
                    "category": "Featured",
                    "title": "fallback",
                    "description": "Banner description",
                    "img-src": "https://example.com/banner.png",
                },
                "link": "https://example.com/fallback",
                "sort": 1,
                "status": "enabled",
                "created_at": "2024-01-02T00:00:00",
            }
        ]

    def test_get_banners_default_language_en_us(
        self,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        banner_session: Session,
    ):
        api = banner_module.BannerApi()
        monkeypatch.setattr(banner_module.db, "session", banner_session)
        monkeypatch.setattr(banner_module.FeatureService, "is_explore_banner_enabled", lambda: True)

        with app.test_request_context("/"):
            result = api.get()

        assert result == []

    def test_get_banners_allows_empty_supporting_copy(
        self,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        banner_session: Session,
    ):
        api = banner_module.BannerApi()
        banner = _banner(
            title="title only",
            language="en-US",
            link="https://example.com",
            created_at=datetime(2024, 1, 3),
        )
        banner.content["category"] = ""
        banner.content["description"] = ""
        banner_session.add(banner)
        banner_session.commit()
        monkeypatch.setattr(banner_module.db, "session", banner_session)
        monkeypatch.setattr(banner_module.FeatureService, "is_explore_banner_enabled", lambda: True)

        with app.test_request_context("/?language=en-US"):
            result = api.get()

        assert result[0]["content"] == {
            "category": "",
            "title": "title only",
            "description": "",
            "img-src": "https://example.com/banner.png",
        }

    def test_get_banners_returns_empty_without_querying_when_disabled(
        self,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
    ):
        api = banner_module.BannerApi()
        session = MagicMock()
        monkeypatch.setattr(banner_module.db, "session", session)
        monkeypatch.setattr(banner_module.FeatureService, "is_explore_banner_enabled", lambda: False)

        with app.test_request_context("/"):
            result = api.get()

        assert result == []
        session.scalars.assert_not_called()

    def test_get_banners_rejects_invalid_content(
        self,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        banner_session: Session,
    ):
        api = banner_module.BannerApi()
        banner = _banner(
            title="invalid",
            language="en-US",
            link="https://example.com",
            created_at=datetime(2024, 1, 4),
        )
        banner.content = {"title": "invalid"}
        banner_session.add(banner)
        banner_session.commit()
        monkeypatch.setattr(banner_module.db, "session", banner_session)
        monkeypatch.setattr(banner_module.FeatureService, "is_explore_banner_enabled", lambda: True)

        with app.test_request_context("/"):
            with pytest.raises(ValidationError):
                api.get()
