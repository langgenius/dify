import yaml

from extensions.ext_database import db
from models.dataset import PipelineBuiltInTemplate
from services.rag_pipeline.pipeline_template.pipeline_template_base import PipelineTemplateRetrievalBase
from services.rag_pipeline.pipeline_template.pipeline_template_type import PipelineTemplateType


class DatabasePipelineTemplateRetrieval(PipelineTemplateRetrievalBase):
    """
    Retrieval pipeline   template from database
    """

    def get_pipeline_templates(self, language: str) -> dict:
        result = self.fetch_pipeline_templates_from_db(language)
        return result

    def get_pipeline_template_detail(self, template_id: str):
        result = self.fetch_pipeline_template_detail_from_db(template_id)
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

        pipeline_built_in_templates: list[PipelineBuiltInTemplate] = (
            db.session.query(PipelineBuiltInTemplate).where(PipelineBuiltInTemplate.language == language).all()
        )

        recommended_pipelines_results = []
        for pipeline_built_in_template in pipeline_built_in_templates:
            recommended_pipeline_result = {
                "id": pipeline_built_in_template.id,
                "name": pipeline_built_in_template.name,
                "description": pipeline_built_in_template.description,
                "icon": pipeline_built_in_template.icon,
                "copyright": pipeline_built_in_template.copyright,
                "privacy_policy": pipeline_built_in_template.privacy_policy,
                "position": pipeline_built_in_template.position,
                "chunk_structure": pipeline_built_in_template.chunk_structure,
            }
            recommended_pipelines_results.append(recommended_pipeline_result)

        return {"pipeline_templates": recommended_pipelines_results}

    @classmethod
    def fetch_pipeline_template_detail_from_db(cls, template_id: str) -> dict | None:
        """
        Fetch pipeline template detail from db.
        :param pipeline_id: Pipeline ID
        :return:
        """
        # is in public recommended list
        pipeline_template = (
            db.session.query(PipelineBuiltInTemplate).where(PipelineBuiltInTemplate.id == template_id).first()
        )

        if not pipeline_template:
            return None
        dsl_data = yaml.safe_load(pipeline_template.yaml_content)
        graph_data = dsl_data.get("workflow", {}).get("graph", {})
        return {
            "id": pipeline_template.id,
            "name": pipeline_template.name,
            "icon_info": pipeline_template.icon,
            "description": pipeline_template.description,
            "chunk_structure": pipeline_template.chunk_structure,
            "export_data": pipeline_template.yaml_content,
            "graph": graph_data,
        }
