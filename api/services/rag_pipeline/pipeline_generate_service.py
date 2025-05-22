from collections.abc import Mapping
from typing import Any, Union

from configs import dify_config
from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.apps.pipeline.pipeline_generator import PipelineGenerator
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from models.dataset import Pipeline
from models.model import Account, App, AppMode, EndUser
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
    def generate_single_iteration(cls, app_model: App, user: Account, node_id: str, args: Any, streaming: bool = True):
        if app_model.mode == AppMode.ADVANCED_CHAT.value:
            workflow = cls._get_workflow(app_model, InvokeFrom.DEBUGGER)
            return AdvancedChatAppGenerator.convert_to_event_stream(
                AdvancedChatAppGenerator().single_iteration_generate(
                    app_model=app_model, workflow=workflow, node_id=node_id, user=user, args=args, streaming=streaming
                )
            )
        elif app_model.mode == AppMode.WORKFLOW.value:
            workflow = cls._get_workflow(app_model, InvokeFrom.DEBUGGER)
            return AdvancedChatAppGenerator.convert_to_event_stream(
                WorkflowAppGenerator().single_iteration_generate(
                    app_model=app_model, workflow=workflow, node_id=node_id, user=user, args=args, streaming=streaming
                )
            )
        else:
            raise ValueError(f"Invalid app mode {app_model.mode}")

    @classmethod
    def generate_single_loop(cls, pipeline: Pipeline, user: Account, node_id: str, args: Any, streaming: bool = True):
        workflow = cls._get_workflow(pipeline, InvokeFrom.DEBUGGER)
        return WorkflowAppGenerator.convert_to_event_stream(
            WorkflowAppGenerator().single_loop_generate(
                app_model=pipeline, workflow=workflow, node_id=node_id, user=user, args=args, streaming=streaming
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
