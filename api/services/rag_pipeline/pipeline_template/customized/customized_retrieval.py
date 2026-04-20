from typing import Any, TypedDict

import yaml
from sqlalchemy import select

from extensions.ext_database import db
from libs.login import current_account_with_tenant
from models.dataset import PipelineCustomizedTemplate
from services.rag_pipeline.pipeline_template.pipeline_template_base import PipelineTemplateRetrievalBase
from services.rag_pipeline.pipeline_template.pipeline_template_type import PipelineTemplateType


class CustomizedTemplateItemDict(TypedDict):
    id: str
    name: str
    description: str
    icon: dict[str, Any]
    position: int
    chunk_structure: str


class CustomizedTemplatesResultDict(TypedDict):
    pipeline_templates: list[CustomizedTemplateItemDict]


class CustomizedTemplateDetailDict(TypedDict):
    id: str
    name: str
    icon_info: dict[str, Any]
    description: str
    chunk_structure: str
    export_data: str
    graph: dict[str, Any]
    created_by: str


class CustomizedPipelineTemplateRetrieval(PipelineTemplateRetrievalBase):
    """
    Retrieval recommended app from database
    """

    def get_pipeline_templates(self, language: str) -> dict[str, Any]:
        _, current_tenant_id = current_account_with_tenant()
        return self.fetch_pipeline_templates_from_customized(tenant_id=current_tenant_id, language=language)

    def get_pipeline_template_detail(self, template_id: str) -> dict[str, Any] | None:
        return self.fetch_pipeline_template_detail_from_db(template_id)

    def get_type(self) -> str:
        return PipelineTemplateType.CUSTOMIZED

    @classmethod
    def fetch_pipeline_templates_from_customized(cls, tenant_id: str, language: str) -> dict[str, Any]:
        """
        Fetch pipeline templates from db.
        :param tenant_id: tenant id
        :param language: language
        :return:
        """
        pipeline_customized_templates = db.session.scalars(
            select(PipelineCustomizedTemplate)
            .where(PipelineCustomizedTemplate.tenant_id == tenant_id, PipelineCustomizedTemplate.language == language)
            .order_by(PipelineCustomizedTemplate.position.asc(), PipelineCustomizedTemplate.created_at.desc())
        ).all()
        recommended_pipelines_results: list[CustomizedTemplateItemDict] = []
        for pipeline_customized_template in pipeline_customized_templates:
            recommended_pipeline_result: CustomizedTemplateItemDict = {
                "id": pipeline_customized_template.id,
                "name": pipeline_customized_template.name,
                "description": pipeline_customized_template.description,
                "icon": pipeline_customized_template.icon,
                "position": pipeline_customized_template.position,
                "chunk_structure": pipeline_customized_template.chunk_structure,
            }
            recommended_pipelines_results.append(recommended_pipeline_result)

        return {"pipeline_templates": recommended_pipelines_results}

    @classmethod
    def fetch_pipeline_template_detail_from_db(cls, template_id: str) -> dict[str, Any] | None:
        """
        Fetch pipeline template detail from db.
        :param template_id: Template ID
        :return:
        """
        pipeline_template = db.session.get(PipelineCustomizedTemplate, template_id)
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
            "created_by": pipeline_template.created_user_name,
        }
