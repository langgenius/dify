from collections.abc import Mapping
from typing import Any

from sqlalchemy.orm import Session

from configs import dify_config
from core.app.apps.pipeline.pipeline_generator import PipelineGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from models.dataset import Pipeline
from models.enums import IndexingStatus
from models.model import Account, App, EndUser
from models.workflow import Workflow
from services.dataset_ref_service import DatasetRefService, DocumentRef
from services.rag_pipeline.rag_pipeline import RagPipelineService


class PipelineGenerateService:
    @classmethod
    def generate(
        cls,
        pipeline: Pipeline,
        user: Account | EndUser,
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool = True,
        *,
        session: Session,
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
            workflow = cls._get_workflow(pipeline, invoke_from, session)
            if original_document_id := args.get("original_document_id"):
                dataset = pipeline.retrieve_dataset(session)
                if dataset is None or dataset.tenant_id != pipeline.tenant_id:
                    raise ValueError("Pipeline dataset is required")
                dataset_ref = DatasetRefService.create_dataset_ref(dataset)
                document_ref = DatasetRefService.create_document_ref_from_id(dataset_ref, original_document_id)
                cls.update_document_status(document_ref, session=session)
            return PipelineGenerator.convert_to_event_stream(
                PipelineGenerator().generate(
                    session=session,
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
        app_limit = app_model.max_active_requests or dify_config.APP_DEFAULT_ACTIVE_REQUESTS
        config_limit = dify_config.APP_MAX_ACTIVE_REQUESTS
        # Filter out infinite (0) values and return the minimum, or 0 if both are infinite
        limits = [limit for limit in [app_limit, config_limit] if limit > 0]
        return min(limits) if limits else 0

    @classmethod
    def generate_single_iteration(
        cls, pipeline: Pipeline, user: Account, node_id: str, args: Any, session: Session, streaming: bool = True
    ):
        workflow = cls._get_workflow(pipeline, InvokeFrom.DEBUGGER, session)
        return PipelineGenerator.convert_to_event_stream(
            PipelineGenerator().single_iteration_generate(
                pipeline=pipeline,
                workflow=workflow,
                node_id=node_id,
                user=user,
                args=args,
                streaming=streaming,
                session=session,
            )
        )

    @classmethod
    def generate_single_loop(
        cls, pipeline: Pipeline, user: Account, node_id: str, args: Any, session: Session, streaming: bool = True
    ):
        workflow = cls._get_workflow(pipeline, InvokeFrom.DEBUGGER, session)
        return PipelineGenerator.convert_to_event_stream(
            PipelineGenerator().single_loop_generate(
                pipeline=pipeline,
                workflow=workflow,
                node_id=node_id,
                user=user,
                args=args,
                streaming=streaming,
                session=session,
            )
        )

    @classmethod
    def _get_workflow(cls, pipeline: Pipeline, invoke_from: InvokeFrom, session: Session) -> Workflow:
        """
        Get workflow
        :param pipeline: pipeline
        :param invoke_from: invoke from
        :return:
        """
        rag_pipeline_service = RagPipelineService(session)
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
    def update_document_status(cls, document_ref: DocumentRef, *, session: Session) -> None:
        """Set a document in the owner-bound dataset to waiting, if it exists."""
        document = DatasetRefService.get_document_by_ref(document_ref, session=session)
        if document:
            document.indexing_status = IndexingStatus.WAITING
            session.add(document)
