from typing import Optional

from extensions.ext_database import db
from models.dataset import Pipeline, PipelineBuiltInTemplate
from services.rag_pipeline.pipeline_template.pipeline_template_base import PipelineTemplateRetrievalBase
from services.rag_pipeline.pipeline_template.pipeline_template_type import PipelineTemplateType
#from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelineDslService


class DatabasePipelineTemplateRetrieval(PipelineTemplateRetrievalBase):
    """
    Retrieval pipeline   template from database
    """

    def get_pipeline_templates(self, language: str) -> dict:
        result = self.fetch_pipeline_templates_from_db(language)
        return result

    def get_pipeline_template_detail(self, pipeline_id: str):
        result = self.fetch_pipeline_template_detail_from_db(pipeline_id)
        return result

    def get_type(self) -> str:
        return PipelineTemplateType.DATABASE

    @classmethod
    def fetch_pipeline_templates_from_db(cls, language: str) -> dict:
        """
        Fetch pipeline templates from db.
        :param language: language
        :return:
        """
        pipeline_templates = (
            db.session.query(PipelineBuiltInTemplate).filter(PipelineBuiltInTemplate.language == language).all()
        )

        return {"pipeline_templates": pipeline_templates}

    @classmethod
    def fetch_pipeline_template_detail_from_db(cls, pipeline_id: str) -> Optional[dict]:
        """
        Fetch pipeline template detail from db.
        :param pipeline_id: Pipeline ID
        :return:
        """
        # is in public recommended list
        pipeline_template = (
            db.session.query(PipelineBuiltInTemplate).filter(PipelineBuiltInTemplate.id == pipeline_id).first()
        )

        if not pipeline_template:
            return None

        # get app detail
        pipeline = db.session.query(Pipeline).filter(Pipeline.id == pipeline_template.pipeline_id).first()
        if not pipeline or not pipeline.is_public:
            return None

        return {
            "id": pipeline.id,
            "name": pipeline.name,
            "icon": pipeline.icon,
            "mode": pipeline.mode,
            "export_data": RagPipelineDslService.export_rag_pipeline_dsl(pipeline=pipeline),
        }
