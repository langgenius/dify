"""Retrieval and DSL export adapters for pipeline template use cases."""

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.dataset import Pipeline
from services.knowledge.pipeline_templates.application import PipelineTemplateNotFoundError
from services.rag_pipeline.pipeline_template.pipeline_template_factory import PipelineTemplateRetrievalFactory
from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelineDslService

logger = logging.getLogger(__name__)


class PipelineTemplateCatalogAdapter:
    def __init__(self, session_factory: sessionmaker[Session], *, built_in_mode: str) -> None:
        self._session_factory = session_factory
        self._built_in_mode = built_in_mode

    def list_templates(self, workspace_id: str, template_type: str, language: str) -> dict[str, Any]:
        mode = self._built_in_mode if template_type == "built-in" else "customized"
        retrieval = PipelineTemplateRetrievalFactory.get_pipeline_template_factory(mode)()
        with self._session_factory() as session:
            result = retrieval.get_pipeline_templates(language, workspace_id, session=session)
        if template_type == "built-in" and not result.get("pipeline_templates") and language != "en-US":
            builtin = PipelineTemplateRetrievalFactory.get_built_in_pipeline_template_retrieval()
            return builtin.fetch_pipeline_templates_from_builtin("en-US")
        return result

    def get_template(self, workspace_id: str, template_id: str, template_type: str) -> dict[str, Any] | None:
        mode = self._built_in_mode if template_type == "built-in" else "customized"
        retrieval = PipelineTemplateRetrievalFactory.get_pipeline_template_factory(mode)()
        with self._session_factory() as session:
            result = retrieval.get_pipeline_template_detail(template_id, workspace_id, session=session)
        if result is None and template_type == "built-in":
            logger.warning(
                "pipeline template retrieval returned empty result, template_id: %s, mode: %s", template_id, mode
            )
        return result


class PipelineTemplateDslExporter:
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def export(self, workspace_id: str, pipeline_id: str) -> str:
        # The existing exporter resolves the draft, dataset and plugin dependencies
        # through one read session. No template write transaction spans that work.
        with self._session_factory() as session:
            pipeline = session.scalar(
                select(Pipeline).where(Pipeline.id == pipeline_id, Pipeline.tenant_id == workspace_id)
            )
            if pipeline is None:
                raise PipelineTemplateNotFoundError("Pipeline not found.")
            return RagPipelineDslService(session).export_rag_pipeline_dsl(pipeline=pipeline, include_secret=True)
