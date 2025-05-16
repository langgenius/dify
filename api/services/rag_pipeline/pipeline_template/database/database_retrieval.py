from typing import Optional

from extensions.ext_database import db
from models.dataset import Dataset, Pipeline, PipelineBuiltInTemplate
from services.rag_pipeline.pipeline_template.pipeline_template_base import PipelineTemplateRetrievalBase
from services.rag_pipeline.pipeline_template.pipeline_template_type import PipelineTemplateType


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
            
        pipeline_built_in_templates: list[PipelineBuiltInTemplate] = db.session.query(PipelineBuiltInTemplate).filter(
            PipelineBuiltInTemplate.language == language
        ).all()

        recommended_pipelines_results = []
        for pipeline_built_in_template in pipeline_built_in_templates:
            pipeline_model: Pipeline = pipeline_built_in_template.pipeline

            recommended_pipeline_result = {
                'id': pipeline_built_in_template.id,
                'name': pipeline_built_in_template.name,
                'pipeline_id': pipeline_model.id,
                'description': pipeline_built_in_template.description,
                'icon': pipeline_built_in_template.icon,
                'copyright': pipeline_built_in_template.copyright,
                'privacy_policy': pipeline_built_in_template.privacy_policy,
                'position': pipeline_built_in_template.position,
            }
            dataset: Dataset = pipeline_model.dataset
            if dataset:
                recommended_pipeline_result['chunk_structure'] = dataset.chunk_structure
                recommended_pipelines_results.append(recommended_pipeline_result)

        return {'pipeline_templates': recommended_pipelines_results}


    @classmethod
    def fetch_pipeline_template_detail_from_db(cls, pipeline_id: str) -> Optional[dict]:
        """
        Fetch pipeline template detail from db.
        :param pipeline_id: Pipeline ID
        :return:
        """
        from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelineDslService
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
