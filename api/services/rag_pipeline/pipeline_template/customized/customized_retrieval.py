from typing import Optional

from flask_login import current_user

from extensions.ext_database import db
from models.dataset import Pipeline, PipelineCustomizedTemplate
from services.app_dsl_service import AppDslService
from services.rag_pipeline.pipeline_template.pipeline_template_base import PipelineTemplateRetrievalBase
from services.rag_pipeline.pipeline_template.pipeline_template_type import PipelineTemplateType


class CustomizedPipelineTemplateRetrieval(PipelineTemplateRetrievalBase):
    """
    Retrieval recommended app from database
    """

    def get_pipeline_templates(self, language: str) -> dict:
        result = self.fetch_pipeline_templates_from_customized(
            tenant_id=current_user.current_tenant_id, language=language
        )
        return result

    def get_pipeline_template_detail(self, template_id: str):
        result = self.fetch_pipeline_template_detail_from_db(template_id)
        return result

    def get_type(self) -> str:
        return PipelineTemplateType.CUSTOMIZED

    @classmethod
    def fetch_pipeline_templates_from_customized(cls, tenant_id: str, language: str) -> dict:
        """
        Fetch pipeline templates from db.
        :param tenant_id: tenant id
        :param language: language
        :return:
        """
        pipeline_templates = (
            db.session.query(PipelineCustomizedTemplate)
            .filter(PipelineCustomizedTemplate.tenant_id == tenant_id, PipelineCustomizedTemplate.language == language)
            .all()
        )

        return {"pipeline_templates": pipeline_templates}

    @classmethod
    def fetch_pipeline_template_detail_from_db(cls, template_id: str) -> Optional[dict]:
        """
        Fetch pipeline template detail from db.
        :param template_id: Template ID
        :return:
        """
        pipeline_template = (
            db.session.query(PipelineCustomizedTemplate).filter(PipelineCustomizedTemplate.id == template_id).first()
        )

        if not pipeline_template:
            return None

        # get pipeline detail
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
