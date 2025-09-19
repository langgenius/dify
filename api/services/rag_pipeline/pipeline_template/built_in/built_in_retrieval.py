import json
from os import path
from pathlib import Path

from flask import current_app

from services.rag_pipeline.pipeline_template.pipeline_template_base import PipelineTemplateRetrievalBase
from services.rag_pipeline.pipeline_template.pipeline_template_type import PipelineTemplateType


class BuiltInPipelineTemplateRetrieval(PipelineTemplateRetrievalBase):
    """
    Retrieval pipeline template from built-in, the location  is constants/pipeline_templates.json
    """

    builtin_data: dict | None = None

    def get_type(self) -> str:
        return PipelineTemplateType.BUILTIN

    def get_pipeline_templates(self, language: str) -> dict:
        result = self.fetch_pipeline_templates_from_builtin(language)
        return result

    def get_pipeline_template_detail(self, template_id: str):
        result = self.fetch_pipeline_template_detail_from_builtin(template_id)
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
            Path(path.join(root_path, "constants", "pipeline_templates.json")).read_text(encoding="utf-8")
        )

        return cls.builtin_data or {}

    @classmethod
    def fetch_pipeline_templates_from_builtin(cls, language: str) -> dict:
        """
        Fetch pipeline templates from builtin.
        :param language: language
        :return:
        """
        builtin_data: dict[str, dict[str, dict]] = cls._get_builtin_data()
        return builtin_data.get("pipeline_templates", {}).get(language, {})

    @classmethod
    def fetch_pipeline_template_detail_from_builtin(cls, template_id: str) -> dict | None:
        """
        Fetch pipeline template detail from builtin.
        :param template_id: Template ID
        :return:
        """
        builtin_data: dict[str, dict[str, dict]] = cls._get_builtin_data()
        return builtin_data.get("pipeline_templates", {}).get(template_id)
