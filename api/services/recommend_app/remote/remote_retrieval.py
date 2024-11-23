import logging
from typing import Optional

import requests

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
            logger.warning(f"fetch recommended app detail from dify official failed: {e}, switch to built-in.")
            result = BuildInRecommendAppRetrieval.fetch_recommended_app_detail_from_builtin(app_id)
        return result

    def get_recommended_apps_and_categories(self, language: str) -> dict:
        try:
            result = self.fetch_recommended_apps_from_dify_official(language)
        except Exception as e:
            logger.warning(f"fetch recommended apps from dify official failed: {e}, switch to built-in.")
            result = BuildInRecommendAppRetrieval.fetch_recommended_apps_from_builtin(language)
        return result

    def get_type(self) -> str:
        return RecommendAppType.REMOTE

    @classmethod
    def fetch_recommended_app_detail_from_dify_official(cls, app_id: str) -> Optional[dict]:
        """
        Fetch recommended app detail from dify official.
        :param app_id: App ID
        :return:
        """
        domain = dify_config.HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN
        url = f"{domain}/apps/{app_id}"
        response = requests.get(url, timeout=(3, 10))
        if response.status_code != 200:
            return None

        return response.json()

    @classmethod
    def fetch_recommended_apps_from_dify_official(cls, language: str) -> dict:
        """
        Fetch recommended apps from dify official.
        :param language: language
        :return:
        """
        domain = dify_config.HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN
        url = f"{domain}/apps?language={language}"
        response = requests.get(url, timeout=(3, 10))
        if response.status_code != 200:
            raise ValueError(f"fetch recommended apps failed, status code: {response.status_code}")

        result = response.json()

        if "categories" in result:
            result["categories"] = sorted(result["categories"])

        return result
