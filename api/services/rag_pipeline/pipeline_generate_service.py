from collections.abc import Mapping
from typing import Any

from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from models.dataset import Pipeline
from models.enums import IndexingStatus
from models.model import Account, EndUser
from repositories.knowledge.dataset_read_repository import get_pipeline_dataset
from services.app.generation.response import convert_to_event_stream
from services.knowledge.dataset_service import DocumentService
from services.knowledge.resource_scope import DatasetRef, DocumentRef
from services.workflow.execution.adapters.pipeline.pipeline_generator import PipelineGenerator


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
        generator: PipelineGenerator,
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
            workflow = generator.load_workflow(pipeline, invoke_from)
            if original_document_id := args.get("original_document_id"):
                dataset = get_pipeline_dataset(pipeline, session)
                if dataset is None or dataset.tenant_id != pipeline.tenant_id:
                    raise ValueError("Pipeline dataset is required")
                document_ref = DatasetRef(tenant_id=dataset.tenant_id, dataset_id=dataset.id).document(
                    original_document_id
                )
                cls.update_document_status(document_ref, session=session)
            return convert_to_event_stream(
                generator.generate(
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

    @classmethod
    def update_document_status(cls, document_ref: DocumentRef, *, session: Session) -> None:
        """Set an owner-bound pipeline document to waiting before regeneration."""
        document = next(
            iter(DocumentService.get_documents_by_ids(document_ref.dataset, [document_ref.document_id], session)), None
        )
        if document is None:
            raise ValueError("Pipeline document not found")
        document.indexing_status = IndexingStatus.WAITING
        session.add(document)

    @classmethod
    def generate_single_iteration(
        cls,
        pipeline: Pipeline,
        user: Account,
        node_id: str,
        args: Any,
        streaming: bool = True,
        *,
        generator: PipelineGenerator,
    ):
        workflow = generator.load_workflow(pipeline, InvokeFrom.DEBUGGER)
        return convert_to_event_stream(
            generator.single_iteration_generate(
                pipeline=pipeline,
                workflow=workflow,
                node_id=node_id,
                user=user,
                args=args,
                streaming=streaming,
            )
        )

    @classmethod
    def generate_single_loop(
        cls,
        pipeline: Pipeline,
        user: Account,
        node_id: str,
        args: Any,
        streaming: bool = True,
        *,
        generator: PipelineGenerator,
    ):
        workflow = generator.load_workflow(pipeline, InvokeFrom.DEBUGGER)
        return convert_to_event_stream(
            generator.single_loop_generate(
                pipeline=pipeline,
                workflow=workflow,
                node_id=node_id,
                user=user,
                args=args,
                streaming=streaming,
            )
        )
