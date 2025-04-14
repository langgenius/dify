import datetime
import hashlib
import os
import uuid
from typing import Any, List, Literal, Union

from flask_login import current_user

from models.dataset import PipelineBuiltInTemplate, PipelineCustomizedTemplate  # type: ignore
from configs import dify_config

class RagPipelineService:
    @staticmethod
    def get_pipeline_templates(
        type: Literal["built-in", "customized"] = "built-in",
    ) -> list[PipelineBuiltInTemplate | PipelineCustomizedTemplate]:
        if type == "built-in":
            return PipelineBuiltInTemplate.query.all()
        else:
            return PipelineCustomizedTemplate.query.all()

    @staticmethod
    def get_pipeline_templates(cls, type: Literal["built-in", "customized"] = "built-in", language: str) -> dict:
        """
        Get pipeline templates.
        :param type: type
        :param language: language
        :return:
        """
        mode = dify_config.HOSTED_FETCH_APP_TEMPLATES_MODE
        retrieval_instance = RecommendAppRetrievalFactory.get_recommend_app_factory(mode)()
        result = retrieval_instance.get_recommended_apps_and_categories(language)
        if not result.get("recommended_apps") and language != "en-US":
            result = (
                RecommendAppRetrievalFactory.get_buildin_recommend_app_retrieval().fetch_recommended_apps_from_builtin(
                    "en-US"
                )
            )

        return result

    @classmethod
    def get_recommend_app_detail(cls, app_id: str) -> Optional[dict]:
        """
        Get recommend app detail.
        :param app_id: app id
        :return:
        """
        mode = dify_config.HOSTED_FETCH_APP_TEMPLATES_MODE
        retrieval_instance = RecommendAppRetrievalFactory.get_recommend_app_factory(mode)()
        result: dict = retrieval_instance.get_recommend_app_detail(app_id)
        return result
