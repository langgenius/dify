"""Compatibility adapter for the existing recommended app retrieval stack."""

from collections.abc import Mapping, Sequence
from typing import cast, override

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from models.model import App
from services.recommend_app.recommend_app_factory import RecommendAppRetrievalFactory
from services.recommended_app_query_service import (
    RecommendedAppCatalogGateway,
    RecommendedAppCatalogPage,
    RecommendedAppDetailRecord,
    RecommendedAppInfoRecord,
    RecommendedAppRecord,
)


class LegacyRecommendedAppCatalogGateway(RecommendedAppCatalogGateway):
    """Map the mixed dict/ORM retrieval results to persistence-neutral records."""

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def is_recommended(self, app_id: str) -> bool:
        retrieval = self._configured_retrieval()
        with self._session_factory() as session:
            return retrieval.get_recommend_app_detail(app_id, session=session) is not None

    @override
    def list_recommended(self, language: str) -> RecommendedAppCatalogPage:
        retrieval = self._configured_retrieval()
        with self._session_factory() as session:
            result = retrieval.get_recommended_apps_and_categories(language, session=session)
            return self._map_recommended_page(result)

    @override
    def list_builtin(self, language: str) -> RecommendedAppCatalogPage:
        retrieval = RecommendAppRetrievalFactory.get_buildin_recommend_app_retrieval()
        return self._map_page(retrieval.fetch_recommended_apps_from_builtin(language))

    @override
    def list_learn_dify(self, language: str) -> RecommendedAppCatalogPage:
        retrieval = self._configured_retrieval()
        with self._session_factory() as session:
            result = retrieval.get_learn_dify_apps(language, session=session)
            raw_apps = cast(Sequence[object], result["recommended_apps"])
            return RecommendedAppCatalogPage(
                recommended_apps=tuple(self._map_app(app) for app in raw_apps),
                categories=(),
            )

    @override
    def get_detail(self, app_id: str) -> RecommendedAppDetailRecord | None:
        retrieval = self._configured_retrieval()
        with self._session_factory() as session:
            result = retrieval.get_recommend_app_detail(app_id, session=session)
            if result is None:
                return None
            if not isinstance(result, Mapping):
                raise TypeError("recommended app detail must be a mapping")
            return self._map_detail(cast(Mapping[str, object], result))

    @staticmethod
    def _configured_retrieval():
        retrieval_type = RecommendAppRetrievalFactory.get_recommend_app_factory(
            dify_config.HOSTED_FETCH_APP_TEMPLATES_MODE
        )
        return retrieval_type()

    @classmethod
    def _map_page(cls, result: Mapping[str, object]) -> RecommendedAppCatalogPage:
        raw_apps = cast(Sequence[object], result["recommended_apps"])
        return RecommendedAppCatalogPage(
            recommended_apps=tuple(cls._map_app(app) for app in raw_apps),
            categories=cls._as_string_tuple(result["categories"], field="categories"),
        )

    @classmethod
    def _map_recommended_page(cls, result: Mapping[str, object]) -> RecommendedAppCatalogPage:
        if not result.get("recommended_apps"):
            return RecommendedAppCatalogPage(recommended_apps=(), categories=())
        return cls._map_page(result)

    @classmethod
    def _map_app(cls, source: object) -> RecommendedAppRecord:
        if not isinstance(source, Mapping):
            raise TypeError("recommended app must be a mapping")

        source = cast(Mapping[str, object], source)
        app_id = source["app_id"]
        if not isinstance(app_id, str):
            raise TypeError("app_id must be a string")
        app_source = source.get("app")
        if app_source is not None and not isinstance(app_source, (Mapping, App)):
            raise TypeError("app must be a mapping or App")

        return RecommendedAppRecord(
            app=cls._map_app_info(cast(Mapping[str, object] | App | None, app_source)),
            app_id=app_id,
            description=cast(str | None, source.get("description")),
            copyright=cast(str | None, source.get("copyright")),
            privacy_policy=cast(str | None, source.get("privacy_policy")),
            custom_disclaimer=cast(str | None, source.get("custom_disclaimer")),
            categories=cls._as_string_tuple(source.get("categories", ()), field="categories"),
            position=cast(int | None, source.get("position")),
            is_listed=cast(bool | None, source.get("is_listed")),
        )

    @classmethod
    def _map_app_info(cls, source: Mapping[str, object] | App | None) -> RecommendedAppInfoRecord | None:
        if source is None:
            return None

        app_id: object
        name: object
        mode: object
        icon: object
        icon_type: object
        icon_background: object
        if isinstance(source, App):
            app_id = source.id
            name = source.name
            mode = source.mode
            icon = source.icon
            icon_type = source.icon_type
            icon_background = source.icon_background
        else:
            app_id = source["id"]
            name = source.get("name")
            mode = source.get("mode")
            icon = source.get("icon")
            icon_type = source.get("icon_type")
            icon_background = source.get("icon_background")

        if not isinstance(app_id, str):
            raise TypeError("app.id must be a string")

        return RecommendedAppInfoRecord(
            id=app_id,
            name=cast(str | None, name),
            mode=cls._enum_string(mode, field="app.mode"),
            icon=cast(str | None, icon),
            icon_type=cls._enum_string(icon_type, field="app.icon_type"),
            icon_background=cast(str | None, icon_background),
        )

    @classmethod
    def _map_detail(cls, source: Mapping[str, object]) -> RecommendedAppDetailRecord:
        app_id = source["id"]
        name = source["name"]
        export_data = source["export_data"]
        if not isinstance(app_id, str):
            raise TypeError("id must be a string")
        if not isinstance(name, str):
            raise TypeError("name must be a string")
        if not isinstance(export_data, str):
            raise TypeError("export_data must be a string")

        mode = cls._enum_string(source["mode"], field="mode")
        if mode is None:
            raise TypeError("mode must be a string or string enum")

        return RecommendedAppDetailRecord(
            id=app_id,
            name=name,
            icon=cast(str | None, source.get("icon")),
            icon_background=cast(str | None, source.get("icon_background")),
            mode=mode,
            export_data=export_data,
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

    @staticmethod
    def _enum_string(value: object, *, field: str) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            return str(value)
        raise TypeError(f"{field} must be a string or string enum")
