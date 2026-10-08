from collections.abc import Mapping
from typing import Any

from core.app.entities.app_invoke_entities import InvokeFrom
from models.dataset import Pipeline
from models.model import Account, EndUser
from services.app.generation.response import convert_to_event_stream
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
