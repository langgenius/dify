from typing import Any, TypedDict, override

import yaml
from sqlalchemy import select

from core.db.session_factory import session_factory
from models.dataset import PipelineBuiltInTemplate
from services.rag_pipeline.pipeline_template.pipeline_template_base import PipelineTemplateRetrievalBase
from services.rag_pipeline.pipeline_template.pipeline_template_type import PipelineTemplateType


class PipelineTemplateItemDict(TypedDict):
    id: str
    name: str
    description: str
    icon: dict[str, Any]
    copyright: str
    privacy_policy: str
    position: int
    chunk_structure: str


class PipelineTemplatesResultDict(TypedDict):
    pipeline_templates: list[PipelineTemplateItemDict]


class PipelineTemplateDetailDict(TypedDict):
    id: str
    name: str
    icon_info: dict[str, Any]
    description: str
    chunk_structure: str
    export_data: str
    graph: dict[str, Any]


class DatabasePipelineTemplateRetrieval(PipelineTemplateRetrievalBase):
    """
    Retrieval pipeline   template from database
    """

    @override
    def get_pipeline_templates(self, language: str, current_tenant_id: str | None = None) -> dict[str, Any]:
        del current_tenant_id
        return self.fetch_pipeline_templates_from_db(language)

    @override
    def get_pipeline_template_detail(self, template_id: str) -> dict[str, Any] | None:
        return self.fetch_pipeline_template_detail_from_db(template_id)

    @override
    def get_type(self) -> str:
        return PipelineTemplateType.DATABASE

    @classmethod
    def fetch_pipeline_templates_from_db(cls, language: str) -> dict[str, Any]:
        """
        Fetch pipeline templates from db.
        :param language: language
        :return:
        """

        with session_factory.get_session_maker()() as session:
            pipeline_built_in_templates = list(
                session.scalars(
                    select(PipelineBuiltInTemplate).where(PipelineBuiltInTemplate.language == language)
                ).all()
            )

        recommended_pipelines_results: list[PipelineTemplateItemDict] = []
        for pipeline_built_in_template in pipeline_built_in_templates:
            recommended_pipeline_result: PipelineTemplateItemDict = {
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
    def fetch_pipeline_template_detail_from_db(cls, template_id: str) -> dict[str, Any] | None:
        """
        Fetch pipeline template detail from db.
        :param pipeline_id: Pipeline ID
        :return:
        """
        # is in public recommended list
        with session_factory.get_session_maker()() as session:
            pipeline_template = session.get(PipelineBuiltInTemplate, template_id)

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
