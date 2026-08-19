import logging
import threading
from typing import Any, override

import httpx
from cachetools import TTLCache
from flask import has_request_context, request
from sqlalchemy.orm import Session

from configs import dify_config
from services.recommend_app.buildin.buildin_retrieval import BuildInRecommendAppRetrieval
from services.recommend_app.database.database_retrieval import DatabaseRecommendAppRetrieval
from services.recommend_app.recommend_app_base import RecommendAppRetrievalBase
from services.recommend_app.recommend_app_type import RecommendAppType

logger = logging.getLogger(__name__)

_REMOTE_FETCH_CACHE_MAXSIZE = 64
_remote_fetch_cache: TTLCache[tuple[str, str], dict[str, Any]] | None = None
_remote_fetch_cache_ttl: int | None = None
_remote_fetch_cache_lock = threading.Lock()


def _current_origin_headers() -> dict[str, str]:
    origin = request.headers.get("Origin") if has_request_context() else None
    if origin:
        return {"Origin": origin}

    console_web_url = getattr(dify_config, "CONSOLE_WEB_URL", "")
    if not isinstance(console_web_url, str) or not console_web_url:
        return {}
    return {"Origin": console_web_url}


def _remote_fetch_cache_key(url: str, headers: dict[str, str]) -> tuple[str, str]:
    return url, headers.get("Origin", "")


def _hosted_fetch_cache_ttl() -> int:
    ttl = dify_config.HOSTED_FETCH_APP_TEMPLATES_CACHE_TTL
    if isinstance(ttl, int) and not isinstance(ttl, bool):
        return ttl
    return 600


def _get_remote_fetch_cache() -> TTLCache[tuple[str, str], dict[str, Any]] | None:
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


def _fetch_remote_payload(url: str) -> tuple[int, dict[str, Any] | None]:
    headers = _current_origin_headers()
    cache_key = _remote_fetch_cache_key(url, headers)
    cache = _get_remote_fetch_cache()
    if cache is not None:
        with _remote_fetch_cache_lock:
            cached = cache.get(cache_key)
            if cached is not None:
                return 200, cached

    response = httpx.get(url, headers=headers, timeout=httpx.Timeout(10.0, connect=3.0))
    status_code = response.status_code
    if status_code != 200:
        return status_code, None

    result: dict[str, Any] = response.json()
    if cache is not None:
        with _remote_fetch_cache_lock:
            cache[cache_key] = result
    return status_code, result


class RemoteRecommendAppRetrieval(RecommendAppRetrievalBase):
    """
    Retrieval recommended app from dify official.

    The remote `/apps` payload is already curated for display, including category order.
    Keep the response order intact so Explore matches the template service.
    """

    @override
    def get_recommend_app_detail(self, app_id: str, *, session: Session):
        del session
        try:
            result = self.fetch_recommended_app_detail_from_dify_official(app_id)
        except Exception as e:
            logger.warning("fetch recommended app detail from dify official failed: %s, switch to built-in.", e)
            result = BuildInRecommendAppRetrieval.fetch_recommended_app_detail_from_builtin(app_id)
        return result

    @override
    def get_recommended_apps_and_categories(self, language: str, *, session: Session):
        del session
        try:
            result = self.fetch_recommended_apps_from_dify_official(language)
        except Exception as e:
            logger.warning("fetch recommended apps from dify official failed: %s, switch to built-in.", e)
            result = BuildInRecommendAppRetrieval.fetch_recommended_apps_from_builtin(language)
        return result

    @override
    def get_learn_dify_apps(self, language: str, *, session: Session):
        try:
            result = self.fetch_learn_dify_apps_from_dify_official(language)
        except Exception as e:
            logger.warning("fetch learn dify apps from dify official failed: %s, switch to database.", e)
            result = DatabaseRecommendAppRetrieval.fetch_learn_dify_apps_from_db(language, session=session)
        return result

    @override
    def get_type(self) -> str:
        return RecommendAppType.REMOTE

    @classmethod
    def fetch_recommended_app_detail_from_dify_official(cls, app_id: str) -> dict[str, Any] | None:
        """
        Fetch recommended app detail from dify official.
        :param app_id: App ID
        :return:
        """
        domain = dify_config.HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN
        url = f"{domain}/apps/{app_id}"
        status_code, data = _fetch_remote_payload(url)
        if status_code != 200:
            return None
        return data

    @classmethod
    def fetch_recommended_apps_from_dify_official(cls, language: str):
        """
        Fetch recommended apps from dify official.
        :param language: language
        :return:
        """
        domain = dify_config.HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN
        url = f"{domain}/apps?language={language}"
        status_code, result = _fetch_remote_payload(url)
        if status_code != 200:
            raise ValueError(f"fetch recommended apps failed, status code: {status_code}")

        return result

    @classmethod
    def fetch_learn_dify_apps_from_dify_official(cls, language: str):
        """
        Fetch Learn Dify apps from dify official.
        :param language: language
        :return:
        """
        domain = dify_config.HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN
        url = f"{domain}/apps/learn-dify?language={language}"
        status_code, result = _fetch_remote_payload(url)
        if status_code != 200:
            raise ValueError(f"fetch learn dify apps failed, status code: {status_code}")

        return result
