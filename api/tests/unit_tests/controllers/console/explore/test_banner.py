from datetime import datetime
from unittest.mock import MagicMock

from flask import Flask

import controllers.console.explore.banner as banner_module
from models.enums import BannerStatus


class TestBannerApi:
    def test_get_banners_with_requested_language(self, app: Flask):
        api = banner_module.BannerApi()
        method = unwrap(api.get)

        banner = MagicMock()
        banner.id = "b1"
        banner.content = {"text": "hello"}
        banner.link = "https://example.com"
        banner.sort = 1
        banner.status = BannerStatus.ENABLED
        banner.created_at = datetime(2024, 1, 1)

        session = MagicMock()
        session.scalars.return_value.all.return_value = [banner]

        with app.test_request_context("/?language=fr-FR"):
            result = method(api, session)

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

    def test_get_banners_fallback_to_en_us(self, app: Flask):
        api = banner_module.BannerApi()
        method = unwrap(api.get)

        banner = MagicMock()
        banner.id = "b2"
        banner.content = {"text": "fallback"}
        banner.link = None
        banner.sort = 1
        banner.status = BannerStatus.ENABLED
        banner.created_at = None

        scalars_result = MagicMock()
        scalars_result.all.side_effect = [
            [],
            [banner],
        ]

        session = MagicMock()
        session.scalars.return_value = scalars_result

        with app.test_request_context("/?language=es-ES"):
            result = method(api, session)

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

    def test_get_banners_default_language_en_us(self, app: Flask):
        api = banner_module.BannerApi()
        method = unwrap(api.get)

        session = MagicMock()
        session.scalars.return_value.all.return_value = []

        with app.test_request_context("/"):
            result = method(api, session)

        assert result == []
