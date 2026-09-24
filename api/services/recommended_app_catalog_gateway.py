"""Typed remote and built-in adapters for the recommended app catalog."""

import json
import logging
import threading
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import cast, override

import httpx
from cachetools import TTLCache

from configs import dify_config
from services.recommended_app_query_service import (
    RecommendedAppCatalogPage,
    RecommendedAppCatalogQuery,
    RecommendedAppDetailRecord,
    RecommendedAppInfoRecord,
    RecommendedAppRecord,
)

logger = logging.getLogger(__name__)

_BUILTIN_FALLBACK_LANGUAGE = "en-US"
_BUILTIN_CATALOG_PATH = Path(__file__).resolve().parents[1] / "constants" / "recommended_apps.json"
_REMOTE_FETCH_CACHE_MAXSIZE = 64
_remote_fetch_cache: TTLCache[tuple[str, str], object] | None = None
_remote_fetch_cache_ttl: int | None = None
_remote_fetch_cache_lock = threading.Lock()


def _hosted_fetch_cache_ttl() -> int:
    ttl = dify_config.HOSTED_FETCH_APP_TEMPLATES_CACHE_TTL
    if isinstance(ttl, int) and not isinstance(ttl, bool):
        return ttl
    return 600


def _get_remote_fetch_cache() -> TTLCache[tuple[str, str], object] | None:
    ttl = _hosted_fetch_cache_ttl()
    if ttl <= 0:
        return None

    global _remote_fetch_cache, _remote_fetch_cache_ttl
    if _remote_fetch_cache is None or _remote_fetch_cache_ttl != ttl:
        with _remote_fetch_cache_lock:
            if _remote_fetch_cache is None or _remote_fetch_cache_ttl != ttl:
                _remote_fetch_cache = TTLCache(maxsize=_REMOTE_FETCH_CACHE_MAXSIZE, ttl=ttl)
                _remote_fetch_cache_ttl = ttl
    return _remote_fetch_cache


def clear_remote_fetch_cache() -> None:
    """Reset the in-memory remote fetch cache (used by tests)."""
    global _remote_fetch_cache, _remote_fetch_cache_ttl
    with _remote_fetch_cache_lock:
        _remote_fetch_cache = None
        _remote_fetch_cache_ttl = None


class _RecommendedAppSourceUnavailableError(Exception):
    pass


class BuiltinRecommendedAppCatalogGateway(RecommendedAppCatalogQuery):
    def __init__(self) -> None:
        self._data: Mapping[str, object] | None = None

    @override
    def list_recommended(self, language: str) -> RecommendedAppCatalogPage:
        return _map_recommended_page(self._raw_page(language))

    @override
    def list_learn_dify(self, language: str) -> RecommendedAppCatalogPage:
        return _map_learn_dify_page(self._raw_learn_dify_page(language))

    @override
    def get_detail(self, app_id: str) -> RecommendedAppDetailRecord | None:
        detail = self._raw_detail(app_id)
        if detail is None:
            return None
        return _map_detail(_as_mapping(detail, field="recommended app detail"))

    @override
    def contains(self, app_id: str) -> bool:
        return self._raw_detail(app_id) is not None

    def _raw_page(self, language: str) -> Mapping[str, object]:
        pages = _as_mapping(self._get_data().get("recommended_apps", {}), field="recommended_apps")
        return _as_mapping(pages.get(language, {}), field="recommended app page")

    def _raw_learn_dify_page(self, language: str) -> Mapping[str, object]:
        apps = self._raw_learn_dify_apps(language)
        if not apps and language != _BUILTIN_FALLBACK_LANGUAGE:
            apps = self._raw_learn_dify_apps(_BUILTIN_FALLBACK_LANGUAGE)
        return {"recommended_apps": apps}

    def _raw_learn_dify_apps(self, language: str) -> tuple[object, ...]:
        page = self._raw_page(language)
        return tuple(
            app
            for app in _as_sequence(page.get("recommended_apps", ()), field="apps")
            if _as_mapping(app, field="recommended app").get("is_learn_dify") is True
        )

    def _raw_detail(self, app_id: str) -> object | None:
        details = _as_mapping(self._get_data().get("app_details", {}), field="app_details")
        return details.get(app_id)

    def _get_data(self) -> Mapping[str, object]:
        if self._data is None:
            loaded = json.loads(_BUILTIN_CATALOG_PATH.read_text(encoding="utf-8"))
            self._data = _as_mapping(loaded, field="built-in recommended app catalog")
        return self._data


class RemoteRecommendedAppCatalogGateway(RecommendedAppCatalogQuery):
    @override
    def list_recommended(self, language: str) -> RecommendedAppCatalogPage:
        result = self._fetch(lambda: self._fetch_page(language))
        return _map_recommended_page(_as_mapping(result, field="recommended app page"))

    @override
    def list_learn_dify(self, language: str) -> RecommendedAppCatalogPage:
        result = self._fetch(lambda: self._fetch_learn_dify_page(language))
        return _map_learn_dify_page(_as_mapping(result, field="Learn Dify app page"))

    @override
    def get_detail(self, app_id: str) -> RecommendedAppDetailRecord | None:
        detail = self._fetch(lambda: self._fetch_detail(app_id))
        if detail is None:
            return None
        return _map_detail(_as_mapping(detail, field="recommended app detail"))

    @override
    def contains(self, app_id: str) -> bool:
        detail = self._fetch(lambda: self._fetch_detail(app_id))
        return detail is not None

    def _fetch_detail(self, app_id: str) -> object | None:
        status_code, detail = self._get_payload(f"/apps/{app_id}")
        if status_code != 200:
            # Preserve the legacy detail contract: only request or decoding
            # failures use the bundled fallback; HTTP responses are authoritative.
            return None
        return detail

    def _fetch_page(self, language: str) -> object:
        status_code, page = self._get_payload(f"/apps?language={language}")
        if status_code != 200:
            raise ValueError(f"fetch recommended apps failed, status code: {status_code}")
        return page

    def _fetch_learn_dify_page(self, language: str) -> object:
        status_code, page = self._get_payload(f"/apps/learn-dify?language={language}")
        if status_code != 200:
            raise ValueError(f"fetch learn dify apps failed, status code: {status_code}")
        return page

    @staticmethod
    def _get_payload(path: str) -> tuple[int, object]:
        origin = dify_config.CONSOLE_WEB_URL

        url = f"{dify_config.HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN}{path}"
        headers = {"Origin": origin} if origin else {}
        cache_key = (url, origin)
        cache = _get_remote_fetch_cache()
        if cache is not None:
            with _remote_fetch_cache_lock:
                cached = cache.get(cache_key)
                if cached is not None:
                    return 200, cached

        response = httpx.get(
            url,
            headers=headers,
            timeout=httpx.Timeout(10.0, connect=3.0),
        )
        if response.status_code != 200:
            return response.status_code, None

        result = response.json()
        if cache is not None:
            with _remote_fetch_cache_lock:
                cache[cache_key] = result
        return response.status_code, result

    @staticmethod
    def _fetch[T](fetch: Callable[[], T]) -> T:
        try:
            return fetch()
        except Exception as error:
            raise _RecommendedAppSourceUnavailableError(str(error)) from error


class RecommendedAppCatalogRouter(RecommendedAppCatalogQuery):
    def __init__(
        self,
        *,
        remote: RecommendedAppCatalogQuery,
        database: RecommendedAppCatalogQuery,
        builtin: RecommendedAppCatalogQuery,
    ) -> None:
        self._remote = remote
        self._builtin = builtin
        self._sources: dict[str, RecommendedAppCatalogQuery] = {
            "remote": remote,
            "db": database,
            "builtin": builtin,
        }

    @override
    def list_recommended(self, language: str) -> RecommendedAppCatalogPage:
        source = self._source()
        if source is not self._remote:
            page = source.list_recommended(language)
        else:
            try:
                page = self._remote.list_recommended(language)
            except _RecommendedAppSourceUnavailableError as error:
                logger.warning("fetch recommended apps from dify official failed: %s, switch to built-in.", error)
                page = self._builtin.list_recommended(language)

        if not page.recommended_apps:
            return self._builtin.list_recommended(_BUILTIN_FALLBACK_LANGUAGE)
        return page

    @override
    def list_learn_dify(self, language: str) -> RecommendedAppCatalogPage:
        source = self._source()
        if source is not self._remote:
            return source.list_learn_dify(language)
        try:
            return self._remote.list_learn_dify(language)
        except _RecommendedAppSourceUnavailableError as error:
            logger.warning("fetch learn dify apps from dify official failed: %s, switch to built-in.", error)
            return self._builtin.list_learn_dify(language)

    @override
    def get_detail(self, app_id: str) -> RecommendedAppDetailRecord | None:
        source = self._source()
        if source is not self._remote:
            return source.get_detail(app_id)
        try:
            return self._remote.get_detail(app_id)
        except _RecommendedAppSourceUnavailableError as error:
            logger.warning("fetch recommended app detail from dify official failed: %s, switch to built-in.", error)
            return self._builtin.get_detail(app_id)

    @override
    def contains(self, app_id: str) -> bool:
        source = self._source()
        if source is not self._remote:
            return source.contains(app_id)
        try:
            return self._remote.contains(app_id)
        except _RecommendedAppSourceUnavailableError as error:
            logger.warning("fetch recommended app detail from dify official failed: %s, switch to built-in.", error)
            return self._builtin.contains(app_id)

    def _source(self) -> RecommendedAppCatalogQuery:
        mode = dify_config.HOSTED_FETCH_APP_TEMPLATES_MODE
        try:
            return self._sources[mode]
        except KeyError:
            raise ValueError(f"invalid fetch recommended apps mode: {mode}") from None


def _map_recommended_page(source: Mapping[str, object]) -> RecommendedAppCatalogPage:
    if not source.get("recommended_apps"):
        return RecommendedAppCatalogPage(recommended_apps=(), categories=())
    return _map_page(source)


def _map_page(source: Mapping[str, object]) -> RecommendedAppCatalogPage:
    return RecommendedAppCatalogPage(
        recommended_apps=tuple(_map_app(app) for app in _as_sequence(source["recommended_apps"], field="apps")),
        categories=_as_string_tuple(source["categories"], field="categories"),
    )


def _map_learn_dify_page(source: Mapping[str, object]) -> RecommendedAppCatalogPage:
    return RecommendedAppCatalogPage(
        recommended_apps=tuple(_map_app(app) for app in _as_sequence(source["recommended_apps"], field="apps")),
        categories=(),
    )


def _map_app(source: object) -> RecommendedAppRecord:
    source = _as_mapping(source, field="recommended app")
    app_id = source["app_id"]
    if not isinstance(app_id, str):
        raise TypeError("app_id must be a string")

    app_source = source.get("app")
    if app_source is not None:
        app_source = _as_mapping(app_source, field="app")

    return RecommendedAppRecord(
        app=_map_app_info(app_source),
        app_id=app_id,
        description=cast(str | None, source.get("description")),
        copyright=cast(str | None, source.get("copyright")),
        privacy_policy=cast(str | None, source.get("privacy_policy")),
        custom_disclaimer=cast(str | None, source.get("custom_disclaimer")),
        categories=_as_string_tuple(source.get("categories", ()), field="categories"),
        position=cast(int | None, source.get("position")),
        is_listed=cast(bool | None, source.get("is_listed")),
    )


def _map_app_info(source: Mapping[str, object] | None) -> RecommendedAppInfoRecord | None:
    if source is None:
        return None
    app_id = source["id"]
    if not isinstance(app_id, str):
        raise TypeError("app.id must be a string")
    return RecommendedAppInfoRecord(
        id=app_id,
        name=cast(str | None, source.get("name")),
        mode=_enum_string(source.get("mode"), field="app.mode"),
        icon=cast(str | None, source.get("icon")),
        icon_type=_enum_string(source.get("icon_type"), field="app.icon_type"),
        icon_background=cast(str | None, source.get("icon_background")),
    )


def _map_detail(source: Mapping[str, object]) -> RecommendedAppDetailRecord:
    app_id = source["id"]
    name = source["name"]
    export_data = source["export_data"]
    if not isinstance(app_id, str):
        raise TypeError("id must be a string")
    if not isinstance(name, str):
        raise TypeError("name must be a string")
    if not isinstance(export_data, str):
        raise TypeError("export_data must be a string")

    mode = _enum_string(source["mode"], field="mode")
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


def _as_mapping(value: object, *, field: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise TypeError(f"{field} must be a mapping")
    return cast(Mapping[str, object], value)


def _as_sequence(value: object, *, field: str) -> Sequence[object]:
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        raise TypeError(f"{field} must be a sequence")
    return cast(Sequence[object], value)


def _as_string_tuple(value: object, *, field: str) -> tuple[str, ...]:
    values = _as_sequence(value, field=field)
    if not all(isinstance(item, str) for item in values):
        raise TypeError(f"{field} must contain only strings")
    return cast(tuple[str, ...], tuple(values))


def _enum_string(value: object, *, field: str) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return str(value)
    raise TypeError(f"{field} must be a string or string enum")
