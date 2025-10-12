import logging

import httpx

from configs import dify_config
from services.rag_pipeline.pipeline_template.database.database_retrieval import DatabasePipelineTemplateRetrieval
from services.rag_pipeline.pipeline_template.pipeline_template_base import PipelineTemplateRetrievalBase
from services.rag_pipeline.pipeline_template.pipeline_template_type import PipelineTemplateType

logger = logging.getLogger(__name__)


class RemotePipelineTemplateRetrieval(PipelineTemplateRetrievalBase):
    """
    Retrieval recommended app from dify official
    """

    def get_pipeline_template_detail(self, template_id: str):
        try:
            result = self.fetch_pipeline_template_detail_from_dify_official(template_id)
        except Exception as e:
            logger.warning("fetch recommended app detail from dify official failed: %r, switch to database.", e)
            result = DatabasePipelineTemplateRetrieval.fetch_pipeline_template_detail_from_db(template_id)
        return result

    def get_pipeline_templates(self, language: str) -> dict:
        try:
            result = self.fetch_pipeline_templates_from_dify_official(language)
        except Exception as e:
            logger.warning("fetch pipeline templates from dify official failed: %r, switch to database.", e)
            result = DatabasePipelineTemplateRetrieval.fetch_pipeline_templates_from_db(language)
        return result

    def get_type(self) -> str:
        return PipelineTemplateType.REMOTE

    @classmethod
    def fetch_pipeline_template_detail_from_dify_official(cls, template_id: str) -> dict | None:
        """
        Fetch pipeline template detail from dify official.
        :param template_id: Pipeline ID
        :return:
        """
        domain = dify_config.HOSTED_FETCH_PIPELINE_TEMPLATES_REMOTE_DOMAIN
        url = f"{domain}/pipeline-templates/{template_id}"
        response = httpx.get(url, timeout=httpx.Timeout(10.0, connect=3.0))
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
        url = f"{domain}/pipeline-templates?language={language}"
        response = httpx.get(url, timeout=httpx.Timeout(10.0, connect=3.0))
        if response.status_code != 200:
            raise ValueError(f"fetch pipeline templates failed, status code: {response.status_code}")

        result: dict = response.json()

        return result
