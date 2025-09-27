import logging

import httpx

from configs import dify_config
from services.recommend_app.buildin.buildin_retrieval import BuildInRecommendAppRetrieval
from services.recommend_app.recommend_app_base import RecommendAppRetrievalBase
from services.recommend_app.recommend_app_type import RecommendAppType

logger = logging.getLogger(__name__)


class RemoteRecommendAppRetrieval(RecommendAppRetrievalBase):
    """
    Retrieval recommended app from dify official
    """

    def get_recommend_app_detail(self, app_id: str):
        try:
            result = self.fetch_recommended_app_detail_from_dify_official(app_id)
        except Exception as e:
            logger.warning("fetch recommended app detail from dify official failed: %s, switch to built-in.", e)
            result = BuildInRecommendAppRetrieval.fetch_recommended_app_detail_from_builtin(app_id)
        return result

    def get_recommended_apps_and_categories(self, language: str):
        try:
            result = self.fetch_recommended_apps_from_dify_official(language)
        except Exception as e:
            logger.warning("fetch recommended apps from dify official failed: %s, switch to built-in.", e)
            result = BuildInRecommendAppRetrieval.fetch_recommended_apps_from_builtin(language)
        return result

    def get_type(self) -> str:
        return RecommendAppType.REMOTE

    @classmethod
    def fetch_recommended_app_detail_from_dify_official(cls, app_id: str) -> dict | None:
        """
        Fetch recommended app detail from dify official.
        :param app_id: App ID
        :return:
        """
        domain = dify_config.HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN
        url = f"{domain}/apps/{app_id}"
        response = httpx.get(url, timeout=httpx.Timeout(10.0, connect=3.0))
        if response.status_code != 200:
            return None
        data: dict = response.json()
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
        response = httpx.get(url, timeout=httpx.Timeout(10.0, connect=3.0))
        if response.status_code != 200:
            raise ValueError(f"fetch recommended apps failed, status code: {response.status_code}")

        result: dict = response.json()

        if "categories" in result:
            result["categories"] = sorted(result["categories"])

        return result
