import logging
from typing import Optional

import requests

from configs import dify_config
from services.rag_pipeline.pipeline_template.pipeline_template_base import PipelineTemplateRetrievalBase
from services.rag_pipeline.pipeline_template.pipeline_template_type import PipelineTemplateType
from services.recommend_app.buildin.buildin_retrieval import BuildInRecommendAppRetrieval

logger = logging.getLogger(__name__)


class RemotePipelineTemplateRetrieval(PipelineTemplateRetrievalBase):
    """
    Retrieval recommended app from dify official
    """

    def get_pipeline_template_detail(self, pipeline_id: str):
        try:
            result = self.fetch_pipeline_template_detail_from_dify_official(pipeline_id)
        except Exception as e:
            logger.warning(f"fetch recommended app detail from dify official failed: {e}, switch to built-in.")
            result = BuildInRecommendAppRetrieval.fetch_recommended_app_detail_from_builtin(pipeline_id)
        return result

    def get_pipeline_templates(self, language: str) -> dict:
        try:
            result = self.fetch_pipeline_templates_from_dify_official(language)
        except Exception as e:
            logger.warning(f"fetch pipeline templates from dify official failed: {e}, switch to built-in.")
            result = BuildInRecommendAppRetrieval.fetch_recommended_apps_from_builtin(language)
        return result

    def get_type(self) -> str:
        return PipelineTemplateType.REMOTE

    @classmethod
    def fetch_pipeline_template_detail_from_dify_official(cls, pipeline_id: str) -> Optional[dict]:
        """
        Fetch pipeline template detail from dify official.
        :param pipeline_id: Pipeline ID
        :return:
        """
        domain = dify_config.HOSTED_FETCH_PIPELINE_TEMPLATES_REMOTE_DOMAIN
        url = f"{domain}/pipelines/{pipeline_id}"
        response = requests.get(url, timeout=(3, 10))
        if response.status_code != 200:
            return None
        data: dict = response.json()
        return data

    @classmethod
    def fetch_pipeline_templates_from_dify_official(cls, language: str) -> dict:
        """
        Fetch pipeline templates from dify official.
        :param language: language
        :return:
        """
        domain = dify_config.HOSTED_FETCH_PIPELINE_TEMPLATES_REMOTE_DOMAIN
        url = f"{domain}/pipelines?language={language}"
        response = requests.get(url, timeout=(3, 10))
        if response.status_code != 200:
            raise ValueError(f"fetch pipeline templates failed, status code: {response.status_code}")

        result: dict = response.json()

        return result
