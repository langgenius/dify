import logging
from typing import Any, override

import httpx
from flask import has_request_context, request
from sqlalchemy.orm import Session

from configs import dify_config
from services.recommend_app.buildin.buildin_retrieval import BuildInRecommendAppRetrieval
from services.recommend_app.database.database_retrieval import DatabaseRecommendAppRetrieval
from services.recommend_app.recommend_app_base import RecommendAppRetrievalBase
from services.recommend_app.recommend_app_type import RecommendAppType

logger = logging.getLogger(__name__)


def _current_origin_headers() -> dict[str, str]:
    origin = request.headers.get("Origin") if has_request_context() else None
    if origin:
        return {"Origin": origin}

    console_web_url = getattr(dify_config, "CONSOLE_WEB_URL", "")
    if not isinstance(console_web_url, str) or not console_web_url:
        return {}
    return {"Origin": console_web_url}


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
        response = httpx.get(url, headers=_current_origin_headers(), timeout=httpx.Timeout(10.0, connect=3.0))
        if response.status_code != 200:
            return None
        data: dict[str, Any] = response.json()
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
        response = httpx.get(url, headers=_current_origin_headers(), timeout=httpx.Timeout(10.0, connect=3.0))
        if response.status_code != 200:
            raise ValueError(f"fetch recommended apps failed, status code: {response.status_code}")

        result: dict[str, Any] = response.json()
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
        response = httpx.get(url, headers=_current_origin_headers(), timeout=httpx.Timeout(10.0, connect=3.0))
        if response.status_code != 200:
            raise ValueError(f"fetch learn dify apps failed, status code: {response.status_code}")

        result: dict[str, Any] = response.json()
        return result
