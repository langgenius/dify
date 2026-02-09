from datetime import datetime
from unittest.mock import MagicMock, patch

import controllers.console.explore.banner as banner_module


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestBannerApi:
    def test_get_banners_with_requested_language(self, app):
        api = banner_module.BannerApi()
        method = unwrap(api.get)

        banner = MagicMock()
        banner.id = "b1"
        banner.content = {"text": "hello"}
        banner.link = "https://example.com"
        banner.sort = 1
        banner.status = "enabled"
        banner.created_at = datetime(2024, 1, 1)

        query = MagicMock()
        query.where.return_value = query
        query.order_by.return_value = query
        query.all.return_value = [banner]

        session = MagicMock()
        session.query.return_value = query

        with app.test_request_context("/?language=fr-FR"), patch.object(banner_module.db, "session", session):
            result = method(api)

        assert result == [
            {
                "id": "b1",
                "content": {"text": "hello"},
                "link": "https://example.com",
                "sort": 1,
                "status": "enabled",
                "created_at": "2024-01-01T00:00:00",
            }
        ]

    def test_get_banners_fallback_to_en_us(self, app):
        api = banner_module.BannerApi()
        method = unwrap(api.get)

        banner = MagicMock()
        banner.id = "b2"
        banner.content = {"text": "fallback"}
        banner.link = None
        banner.sort = 1
        banner.status = "enabled"
        banner.created_at = None

        query = MagicMock()
        query.where.return_value = query
        query.order_by.return_value = query
        query.all.side_effect = [
            [],
            [banner],
        ]

        session = MagicMock()
        session.query.return_value = query

        with app.test_request_context("/?language=es-ES"), patch.object(banner_module.db, "session", session):
            result = method(api)

        assert result == [
            {
                "id": "b2",
                "content": {"text": "fallback"},
                "link": None,
                "sort": 1,
                "status": "enabled",
                "created_at": None,
            }
        ]

    def test_get_banners_default_language_en_us(self, app):
        api = banner_module.BannerApi()
        method = unwrap(api.get)

        query = MagicMock()
        query.where.return_value = query
        query.order_by.return_value = query
        query.all.return_value = []

        session = MagicMock()
        session.query.return_value = query

        with app.test_request_context("/"), patch.object(banner_module.db, "session", session):
            result = method(api)

        assert result == []
