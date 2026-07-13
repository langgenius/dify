from collections.abc import Iterator
from datetime import datetime
from inspect import unwrap
from uuid import uuid4

import pytest
from flask import Flask
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


def _banner(*, text: str, language: str, link: str, created_at: datetime) -> ExporleBanner:
    banner = ExporleBanner(
        content={"text": text},
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
        method = unwrap(api.get)

        banner = _banner(
            text="hello",
            language="fr-FR",
            link="https://example.com",
            created_at=datetime(2024, 1, 1),
        )
        banner_session.add(banner)
        banner_session.commit()
        monkeypatch.setattr(banner_module.db, "session", banner_session)

        with app.test_request_context("/?language=fr-FR"):
            result = method(api)

        assert result == [
            {
                "id": banner.id,
                "content": {"text": "hello"},
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
        method = unwrap(api.get)

        banner = _banner(
            text="fallback",
            language="en-US",
            link="https://example.com/fallback",
            created_at=datetime(2024, 1, 2),
        )
        banner_session.add(banner)
        banner_session.commit()
        monkeypatch.setattr(banner_module.db, "session", banner_session)

        with app.test_request_context("/?language=es-ES"):
            result = method(api)

        assert result == [
            {
                "id": banner.id,
                "content": {"text": "fallback"},
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
        method = unwrap(api.get)
        monkeypatch.setattr(banner_module.db, "session", banner_session)

        with app.test_request_context("/"):
            result = method(api)

        assert result == []
