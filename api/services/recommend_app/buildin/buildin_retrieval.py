import json
from os import path
from pathlib import Path
from typing import Optional

from flask import current_app

from services.recommend_app.recommend_app_base import RecommendAppRetrievalBase
from services.recommend_app.recommend_app_type import RecommendAppType


class BuildInRecommendAppRetrieval(RecommendAppRetrievalBase):
    """
    Retrieval recommended app from buildin, the location  is constants/recommended_apps.json
    """

    builtin_data: Optional[dict] = None

    def get_type(self) -> str:
        return RecommendAppType.BUILDIN

    def get_recommended_apps_and_categories(self, language: str) -> dict:
        result = self.fetch_recommended_apps_from_builtin(language)
        return result

    def get_recommend_app_detail(self, app_id: str):
        result = self.fetch_recommended_app_detail_from_builtin(app_id)
        return result

    @classmethod
    def _get_builtin_data(cls) -> dict:
        """
        Get builtin data.
        :return:
        """
        if cls.builtin_data:
            return cls.builtin_data

        root_path = current_app.root_path
        cls.builtin_data = json.loads(
            Path(path.join(root_path, "constants", "recommended_apps.json")).read_text(encoding="utf-8")
        )

        return cls.builtin_data

    @classmethod
    def fetch_recommended_apps_from_builtin(cls, language: str) -> dict:
        """
        Fetch recommended apps from builtin.
        :param language: language
        :return:
        """
        builtin_data = cls._get_builtin_data()
        return builtin_data.get("recommended_apps", {}).get(language)

    @classmethod
    def fetch_recommended_app_detail_from_builtin(cls, app_id: str) -> Optional[dict]:
        """
        Fetch recommended app detail from builtin.
        :param app_id: App ID
        :return:
        """
        builtin_data = cls._get_builtin_data()
        return builtin_data.get("app_details", {}).get(app_id)
