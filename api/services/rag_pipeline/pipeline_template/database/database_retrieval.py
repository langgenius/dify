from typing import Optional

from extensions.ext_database import db
from models.dataset import Pipeline, PipelineBuiltInTemplate
from services.app_dsl_service import AppDslService
from services.recommend_app.recommend_app_base import RecommendAppRetrievalBase
from services.recommend_app.recommend_app_type import RecommendAppType


class DatabasePipelineTemplateRetrieval(RecommendAppRetrievalBase):
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
        return RecommendAppType.DATABASE

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
            "export_data": AppDslService.export_dsl(app_model=pipeline),
        }
