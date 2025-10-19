from collections.abc import Mapping
from typing import Any, Union

from configs import dify_config
from core.app.apps.pipeline.pipeline_generator import PipelineGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from models.dataset import Document, Pipeline
from models.model import Account, App, EndUser
from models.workflow import Workflow
from services.rag_pipeline.rag_pipeline import RagPipelineService


class PipelineGenerateService:
    @classmethod
    def generate(
        cls,
        pipeline: Pipeline,
        user: Union[Account, EndUser],
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool = True,
    ):
        """
        Pipeline Content Generate
        :param pipeline: pipeline
        :param user: user
        :param args: args
        :param invoke_from: invoke from
        :param streaming: streaming
        :return:
        """
        try:
            workflow = cls._get_workflow(pipeline, invoke_from)
            if original_document_id := args.get("original_document_id"):
                # update document status to waiting
                cls.update_document_status(original_document_id)
            return PipelineGenerator.convert_to_event_stream(
                PipelineGenerator().generate(
                    pipeline=pipeline,
                    workflow=workflow,
                    user=user,
                    args=args,
                    invoke_from=invoke_from,
                    streaming=streaming,
                    call_depth=0,
                    workflow_thread_pool_id=None,
                ),
            )

        except Exception:
            raise

    @staticmethod
    def _get_max_active_requests(app_model: App) -> int:
        max_active_requests = app_model.max_active_requests
        if max_active_requests is None:
            max_active_requests = int(dify_config.APP_MAX_ACTIVE_REQUESTS)
        return max_active_requests

    @classmethod
    def generate_single_iteration(
        cls, pipeline: Pipeline, user: Account, node_id: str, args: Any, streaming: bool = True
    ):
        workflow = cls._get_workflow(pipeline, InvokeFrom.DEBUGGER)
        return PipelineGenerator.convert_to_event_stream(
            PipelineGenerator().single_iteration_generate(
                pipeline=pipeline, workflow=workflow, node_id=node_id, user=user, args=args, streaming=streaming
            )
        )

    @classmethod
    def generate_single_loop(cls, pipeline: Pipeline, user: Account, node_id: str, args: Any, streaming: bool = True):
        workflow = cls._get_workflow(pipeline, InvokeFrom.DEBUGGER)
        return PipelineGenerator.convert_to_event_stream(
            PipelineGenerator().single_loop_generate(
                pipeline=pipeline, workflow=workflow, node_id=node_id, user=user, args=args, streaming=streaming
            )
        )

    @classmethod
    def _get_workflow(cls, pipeline: Pipeline, invoke_from: InvokeFrom) -> Workflow:
        """
        Get workflow
        :param pipeline: pipeline
        :param invoke_from: invoke from
        :return:
        """
        rag_pipeline_service = RagPipelineService()
        if invoke_from == InvokeFrom.DEBUGGER:
            # fetch draft workflow by app_model
            workflow = rag_pipeline_service.get_draft_workflow(pipeline=pipeline)

            if not workflow:
                raise ValueError("Workflow not initialized")
        else:
            # fetch published workflow by app_model
            workflow = rag_pipeline_service.get_published_workflow(pipeline=pipeline)

            if not workflow:
                raise ValueError("Workflow not published")

        return workflow

    @classmethod
    def update_document_status(cls, document_id: str):
        """
        Update document status to waiting
        :param document_id: document id
        """
        document = db.session.query(Document).where(Document.id == document_id).first()
        if document:
            document.indexing_status = "waiting"
            db.session.add(document)
            db.session.commit()
