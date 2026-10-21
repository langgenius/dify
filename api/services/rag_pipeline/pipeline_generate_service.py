from typing import Any

from sqlalchemy.orm import Session

from core.app.apps.pipeline.pipeline_generator import PipelineGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from models.dataset import Pipeline
from models.model import Account
from models.workflow import Workflow
from services.rag_pipeline.rag_pipeline import RagPipelineService


class PipelineGenerateService:
    @classmethod
    def generate_single_iteration(
        cls,
        pipeline: Pipeline,
        user: Account,
        node_id: str,
        args: Any,
        session: Session,
        streaming: bool = True,
        *,
        generator: PipelineGenerator,
    ):
        workflow = cls.get_workflow(pipeline, InvokeFrom.DEBUGGER, session)
        return PipelineGenerator.convert_to_event_stream(
            generator.single_iteration_generate(
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
        cls,
        pipeline: Pipeline,
        user: Account,
        node_id: str,
        args: Any,
        session: Session,
        streaming: bool = True,
        *,
        generator: PipelineGenerator,
    ):
        workflow = cls.get_workflow(pipeline, InvokeFrom.DEBUGGER, session)
        return PipelineGenerator.convert_to_event_stream(
            generator.single_loop_generate(
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
    def get_workflow(cls, pipeline: Pipeline, invoke_from: InvokeFrom, session: Session) -> Workflow:
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
