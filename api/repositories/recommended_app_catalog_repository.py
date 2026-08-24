"""Database-backed recommended app catalog adapter."""

import json
import logging
from collections.abc import Sequence
from typing import cast, override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from constants.languages import languages
from extensions.ext_redis import RedisClientWrapper
from models.model import App, RecommendedApp
from services.app_dsl_service import AppDslService
from services.recommended_app_query_service import (
    RecommendedAppCatalogPage,
    RecommendedAppCatalogQuery,
    RecommendedAppDetailRecord,
    RecommendedAppInfoRecord,
    RecommendedAppRecord,
)

logger = logging.getLogger(__name__)

# Keep the legacy "explore" Redis key: Explore was the former UI name for this recommended-app surface.
_CATEGORY_ORDER_KEY_PREFIX = "explore:apps:category_order"


class DatabaseRecommendedAppCatalogRepository(RecommendedAppCatalogQuery):
    def __init__(self, session_factory: sessionmaker[Session], *, redis: RedisClientWrapper) -> None:
        self._session_factory = session_factory
        self._redis = redis

    @override
    def list_recommended(self, language: str) -> RecommendedAppCatalogPage:
        with self._session_factory() as session:
            recommended_apps = self._list_rows(language, session=session)
            if not recommended_apps:
                recommended_apps = self._list_rows(languages[0], session=session)
            records, categories = self._map_rows(recommended_apps, session=session)
        return RecommendedAppCatalogPage(
            recommended_apps=records,
            categories=tuple(self._order_categories(categories, language)),
        )

    @override
    def list_learn_dify(self, language: str) -> RecommendedAppCatalogPage:
        with self._session_factory() as session:
            recommended_apps = self._list_rows(language, session=session, is_learn_dify=True)
            if not recommended_apps and language != languages[0]:
                recommended_apps = self._list_rows(languages[0], session=session, is_learn_dify=True)
            records, _ = self._map_rows(recommended_apps, session=session)
        return RecommendedAppCatalogPage(recommended_apps=records, categories=())

    @override
    def get_detail(self, app_id: str) -> RecommendedAppDetailRecord | None:
        with self._session_factory() as session:
            return self._get_detail(app_id, session=session)

    @override
    def contains(self, app_id: str) -> bool:
        with self._session_factory() as session:
            return (
                session.scalar(
                    select(RecommendedApp.app_id)
                    .join(App, App.id == RecommendedApp.app_id)
                    .where(
                        RecommendedApp.app_id == app_id,
                        RecommendedApp.is_listed.is_(True),
                        App.is_public.is_(True),
                    )
                    .limit(1)
                )
                is not None
            )

    def _order_categories(self, categories: set[str], language: str) -> list[str]:
        try:
            raw_categories = self._redis.get(f"{_CATEGORY_ORDER_KEY_PREFIX}:{language}")
        except Exception:
            logger.exception("Failed to read recommended app category order from Redis.")
            return sorted(categories)

        if not raw_categories:
            return sorted(categories)
        if isinstance(raw_categories, bytes):
            raw_categories = raw_categories.decode("utf-8")

        try:
            configured_order = json.loads(raw_categories)
        except (TypeError, json.JSONDecodeError):
            logger.warning("Invalid recommended app category order payload for language %s.", language)
            return sorted(categories)

        if not isinstance(configured_order, list):
            return sorted(categories)

        string_order = [category for category in configured_order if isinstance(category, str)]
        return string_order or sorted(categories)

    @staticmethod
    def _list_rows(
        language: str,
        *,
        session: Session,
        is_learn_dify: bool | None = None,
    ) -> list[RecommendedApp]:
        filters = [RecommendedApp.is_listed.is_(True), RecommendedApp.language == language]
        if is_learn_dify is not None:
            filters.append(RecommendedApp.is_learn_dify.is_(is_learn_dify))
        return list(session.scalars(select(RecommendedApp).where(*filters)).all())

    @classmethod
    def _map_rows(
        cls,
        recommended_apps: Sequence[RecommendedApp],
        *,
        session: Session,
    ) -> tuple[tuple[RecommendedAppRecord, ...], set[str]]:
        categories: set[str] = set()
        records: list[RecommendedAppRecord] = []
        for recommended_app in recommended_apps:
            app = session.get(App, recommended_app.app_id)
            if app is None or not app.is_public:
                continue

            site = app.site_with_session(session=session)
            if site is None:
                continue

            app_categories = cls._as_string_tuple(recommended_app.categories or (), field="categories")
            records.append(
                RecommendedAppRecord(
                    app=RecommendedAppInfoRecord(
                        id=app.id,
                        name=app.name,
                        mode=app.mode.value,
                        icon=cast(str | None, app.icon),
                        icon_type=app.icon_type.value if app.icon_type is not None else None,
                        icon_background=app.icon_background,
                    ),
                    app_id=recommended_app.app_id,
                    description=cast(str | None, site.description),
                    copyright=cast(str | None, site.copyright),
                    privacy_policy=cast(str | None, site.privacy_policy),
                    custom_disclaimer=cast(str | None, site.custom_disclaimer),
                    categories=app_categories,
                    position=recommended_app.position,
                    is_listed=recommended_app.is_listed,
                )
            )
            categories.update(app_categories)

        return tuple(records), categories

    @staticmethod
    def _get_detail(app_id: str, *, session: Session) -> RecommendedAppDetailRecord | None:
        recommended_app = session.scalar(
            select(RecommendedApp)
            .where(
                RecommendedApp.is_listed.is_(True),
                RecommendedApp.app_id == app_id,
            )
            .limit(1)
        )
        if recommended_app is None:
            return None

        app = session.get(App, app_id)
        if app is None or not app.is_public:
            return None

        return RecommendedAppDetailRecord(
            id=app.id,
            name=app.name,
            icon=cast(str | None, app.icon),
            icon_background=app.icon_background,
            mode=app.mode.value,
            export_data=AppDslService.export_dsl(app_model=app, session=session),
        )

    @staticmethod
    def _as_string_tuple(value: object, *, field: str) -> tuple[str, ...]:
        if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
            raise TypeError(f"{field} must be a sequence of strings")
        items: list[str] = []
        for item in value:
            if not isinstance(item, str):
                raise TypeError(f"{field} must contain only strings")
            items.append(item)
        return tuple(items)
