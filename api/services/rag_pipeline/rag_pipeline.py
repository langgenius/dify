import json
import threading
import time
from collections.abc import Callable, Generator, Sequence
from datetime import UTC, datetime
from typing import Any, Optional, cast
from uuid import uuid4

from flask_login import current_user
from sqlalchemy import select
from sqlalchemy.orm import Session

import contexts
from configs import dify_config
from core.datasource.entities.datasource_entities import DatasourceProviderType, GetOnlineDocumentPagesRequest, GetOnlineDocumentPagesResponse, GetWebsiteCrawlRequest, GetWebsiteCrawlResponse
from core.datasource.online_document.online_document_plugin import OnlineDocumentDatasourcePlugin
from core.datasource.website_crawl.website_crawl_plugin import WebsiteCrawlDatasourcePlugin
from core.model_runtime.utils.encoders import jsonable_encoder
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.variables.variables import Variable
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.errors import WorkflowNodeRunFailedError
from core.workflow.graph_engine.entities.event import InNodeEvent
from core.workflow.nodes.base.node import BaseNode
from core.workflow.nodes.enums import ErrorStrategy, NodeType
from core.workflow.nodes.event.event import RunCompletedEvent
from core.workflow.nodes.event.types import NodeEvent
from core.workflow.nodes.node_mapping import LATEST_VERSION, NODE_TYPE_CLASSES_MAPPING
from core.workflow.repository.workflow_node_execution_repository import OrderConfig
from core.workflow.workflow_entry import WorkflowEntry
from extensions.ext_database import db
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from models.account import Account
from models.dataset import Pipeline, PipelineBuiltInTemplate, PipelineCustomizedTemplate  # type: ignore
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import EndUser
from models.workflow import (
    Workflow,
    WorkflowNodeExecution,
    WorkflowNodeExecutionStatus,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowType,
)
from services.entities.knowledge_entities.rag_pipeline_entities import PipelineTemplateInfoEntity
from services.errors.app import WorkflowHashNotEqualError
from services.rag_pipeline.pipeline_template.pipeline_template_factory import PipelineTemplateRetrievalFactory


class RagPipelineService:
    @staticmethod
    def get_pipeline_templates(
        type: str = "built-in", language: str = "en-US"
    ) -> list[PipelineBuiltInTemplate | PipelineCustomizedTemplate]:
        if type == "built-in":
            mode = dify_config.HOSTED_FETCH_PIPELINE_TEMPLATES_MODE
            retrieval_instance = PipelineTemplateRetrievalFactory.get_pipeline_template_factory(mode)()
            result = retrieval_instance.get_pipeline_templates(language)
            if not result.get("pipeline_templates") and language != "en-US":
                template_retrieval = PipelineTemplateRetrievalFactory.get_built_in_pipeline_template_retrieval()
                result = template_retrieval.fetch_pipeline_templates_from_builtin("en-US")
            return result.get("pipeline_templates")
        else:
            mode = "customized"
            retrieval_instance = PipelineTemplateRetrievalFactory.get_pipeline_template_factory(mode)()
            result = retrieval_instance.get_pipeline_templates(language)
            return result.get("pipeline_templates")

    @classmethod
    def get_pipeline_template_detail(cls, template_id: str) -> Optional[dict]:
        """
        Get pipeline template detail.
        :param template_id: template id
        :return:
        """
        mode = dify_config.HOSTED_FETCH_PIPELINE_TEMPLATES_MODE
        retrieval_instance = PipelineTemplateRetrievalFactory.get_pipeline_template_factory(mode)()
        result: Optional[dict] = retrieval_instance.get_pipeline_template_detail(template_id)
        return result

    @classmethod
    def update_customized_pipeline_template(cls, template_id: str, template_info: PipelineTemplateInfoEntity):
        """
        Update pipeline template.
        :param template_id: template id
        :param template_info: template info
        """
        customized_template: PipelineCustomizedTemplate | None = (
            db.query(PipelineCustomizedTemplate)
            .filter(
                PipelineCustomizedTemplate.id == template_id,
                PipelineCustomizedTemplate.tenant_id == current_user.current_tenant_id,
            )
            .first()
        )
        if not customized_template:
            raise ValueError("Customized pipeline template not found.")
        customized_template.name = template_info.name
        customized_template.description = template_info.description
        customized_template.icon = template_info.icon_info.model_dump()
        db.commit()
        return customized_template

    @classmethod
    def delete_customized_pipeline_template(cls, template_id: str):
        """
        Delete customized pipeline template.
        """
        customized_template: PipelineCustomizedTemplate | None = (
            db.query(PipelineCustomizedTemplate)
            .filter(
                PipelineCustomizedTemplate.id == template_id,
                PipelineCustomizedTemplate.tenant_id == current_user.current_tenant_id,
            )
            .first()
        )
        if not customized_template:
            raise ValueError("Customized pipeline template not found.")
        db.delete(customized_template)
        db.commit()

    def get_draft_workflow(self, pipeline: Pipeline) -> Optional[Workflow]:
        """
        Get draft workflow
        """
        # fetch draft workflow by rag pipeline
        workflow = (
            db.session.query(Workflow)
            .filter(
                Workflow.tenant_id == pipeline.tenant_id,
                Workflow.app_id == pipeline.id,
                Workflow.version == "draft",
            )
            .first()
        )

        # return draft workflow
        return workflow

    def get_published_workflow(self, pipeline: Pipeline) -> Optional[Workflow]:
        """
        Get published workflow
        """

        if not pipeline.workflow_id:
            return None

        # fetch published workflow by workflow_id
        workflow = (
            db.session.query(Workflow)
            .filter(
                Workflow.tenant_id == pipeline.tenant_id,
                Workflow.app_id == pipeline.id,
                Workflow.id == pipeline.workflow_id,
            )
            .first()
        )

        return workflow

    def get_all_published_workflow(
        self,
        *,
        session: Session,
        pipeline: Pipeline,
        page: int,
        limit: int,
        user_id: str | None,
        named_only: bool = False,
    ) -> tuple[Sequence[Workflow], bool]:
        """
        Get published workflow with pagination
        """
        if not pipeline.workflow_id:
            return [], False

        stmt = (
            select(Workflow)
            .where(Workflow.app_id == pipeline.id)
            .order_by(Workflow.version.desc())
            .limit(limit + 1)
            .offset((page - 1) * limit)
        )

        if user_id:
            stmt = stmt.where(Workflow.created_by == user_id)

        if named_only:
            stmt = stmt.where(Workflow.marked_name != "")

        workflows = session.scalars(stmt).all()

        has_more = len(workflows) > limit
        if has_more:
            workflows = workflows[:-1]

        return workflows, has_more

    def sync_draft_workflow(
        self,
        *,
        pipeline: Pipeline,
        graph: dict,
        unique_hash: Optional[str],
        account: Account,
        environment_variables: Sequence[Variable],
        conversation_variables: Sequence[Variable],
        rag_pipeline_variables: list,
    ) -> Workflow:
        """
        Sync draft workflow
        :raises WorkflowHashNotEqualError
        """
        # fetch draft workflow by app_model
        workflow = self.get_draft_workflow(pipeline=pipeline)

        if workflow and workflow.unique_hash != unique_hash:
            raise WorkflowHashNotEqualError()

        # create draft workflow if not found
        if not workflow:
            workflow = Workflow(
                tenant_id=pipeline.tenant_id,
                app_id=pipeline.id,
                features="{}",
                type=WorkflowType.RAG_PIPELINE.value,
                version="draft",
                graph=json.dumps(graph),
                created_by=account.id,
                environment_variables=environment_variables,
                conversation_variables=conversation_variables,
                rag_pipeline_variables=rag_pipeline_variables,
            )
            db.session.add(workflow)
            db.session.flush()
            pipeline.workflow_id = workflow.id
        # update draft workflow if found
        else:
            workflow.graph = json.dumps(graph)
            workflow.updated_by = account.id
            workflow.updated_at = datetime.now(UTC).replace(tzinfo=None)
            workflow.environment_variables = environment_variables
            workflow.conversation_variables = conversation_variables
            workflow.rag_pipeline_variables = rag_pipeline_variables
        # commit db session changes
        db.session.commit()

        # trigger  workflow events TODO
        # app_draft_workflow_was_synced.send(pipeline, synced_draft_workflow=workflow)

        # return draft workflow
        return workflow

    def publish_workflow(
        self,
        *,
        session: Session,
        pipeline: Pipeline,
        account: Account,
        marked_name: str = "",
        marked_comment: str = "",
    ) -> Workflow:
        draft_workflow_stmt = select(Workflow).where(
            Workflow.tenant_id == pipeline.tenant_id,
            Workflow.app_id == pipeline.id,
            Workflow.version == "draft",
        )
        draft_workflow = session.scalar(draft_workflow_stmt)
        if not draft_workflow:
            raise ValueError("No valid workflow found.")

        # create new workflow
        workflow = Workflow.new(
            tenant_id=pipeline.tenant_id,
            app_id=pipeline.id,
            type=draft_workflow.type,
            version=str(datetime.now(UTC).replace(tzinfo=None)),
            graph=draft_workflow.graph,
            features=draft_workflow.features,
            created_by=account.id,
            environment_variables=draft_workflow.environment_variables,
            conversation_variables=draft_workflow.conversation_variables,
            marked_name=marked_name,
            marked_comment=marked_comment,
        )

        # commit db session changes
        session.add(workflow)

        # trigger app workflow events TODO
        # app_published_workflow_was_updated.send(pipeline, published_workflow=workflow)

        # return new workflow
        return workflow

    def get_default_block_configs(self) -> list[dict]:
        """
        Get default block configs
        """
        # return default block config
        default_block_configs = []
        for node_class_mapping in NODE_TYPE_CLASSES_MAPPING.values():
            node_class = node_class_mapping[LATEST_VERSION]
            default_config = node_class.get_default_config()
            if default_config:
                default_block_configs.append(default_config)

        return default_block_configs

    def get_default_block_config(self, node_type: str, filters: Optional[dict] = None) -> Optional[dict]:
        """
        Get default config of node.
        :param node_type: node type
        :param filters: filter by node config parameters.
        :return:
        """
        node_type_enum = NodeType(node_type)

        # return default block config
        if node_type_enum not in NODE_TYPE_CLASSES_MAPPING:
            return None

        node_class = NODE_TYPE_CLASSES_MAPPING[node_type_enum][LATEST_VERSION]
        default_config = node_class.get_default_config(filters=filters)
        if not default_config:
            return None

        return default_config

    def run_draft_workflow_node(
        self, pipeline: Pipeline, node_id: str, user_inputs: dict, account: Account
    ) -> WorkflowNodeExecution:
        """
        Run draft workflow node
        """
        # fetch draft workflow by app_model
        draft_workflow = self.get_draft_workflow(pipeline=pipeline)
        if not draft_workflow:
            raise ValueError("Workflow not initialized")

        # run draft workflow node
        start_at = time.perf_counter()

        workflow_node_execution = self._handle_node_run_result(
            getter=lambda: WorkflowEntry.single_step_run(
                workflow=draft_workflow,
                node_id=node_id,
                user_inputs=user_inputs,
                user_id=account.id,
            ),
            start_at=start_at,
            tenant_id=pipeline.tenant_id,
            node_id=node_id,
        )

        workflow_node_execution.app_id = pipeline.id
        workflow_node_execution.created_by = account.id
        workflow_node_execution.workflow_id = draft_workflow.id

        db.session.add(workflow_node_execution)
        db.session.commit()

        return workflow_node_execution

    def run_published_workflow_node(
        self, pipeline: Pipeline, node_id: str, user_inputs: dict, account: Account
    ) -> WorkflowNodeExecution:
        """
        Run published workflow node
        """
        # fetch published workflow by app_model
        published_workflow = self.get_published_workflow(pipeline=pipeline)
        if not published_workflow:
            raise ValueError("Workflow not initialized")

        # run draft workflow node
        start_at = time.perf_counter()

        workflow_node_execution = self._handle_node_run_result(
            getter=lambda: WorkflowEntry.single_step_run(
                workflow=published_workflow,
                node_id=node_id,
                user_inputs=user_inputs,
                user_id=account.id,
            ),
            start_at=start_at,
            tenant_id=pipeline.tenant_id,
            node_id=node_id,
        )

        workflow_node_execution.app_id = pipeline.id
        workflow_node_execution.created_by = account.id
        workflow_node_execution.workflow_id = published_workflow.id

        db.session.add(workflow_node_execution)
        db.session.commit()

        return workflow_node_execution

    def run_datasource_workflow_node(
        self, pipeline: Pipeline, node_id: str, user_inputs: dict, account: Account, datasource_type: str
    ) -> dict:
        """
        Run published workflow datasource
        """
        # fetch published workflow by app_model
        published_workflow = self.get_published_workflow(pipeline=pipeline)
        if not published_workflow:
            raise ValueError("Workflow not initialized")

        # run draft workflow node
        start_at = time.perf_counter()

        datasource_node_data = published_workflow.graph_dict.get("nodes", {}).get(node_id, {}).get("data", {})
        if not datasource_node_data:
            raise ValueError("Datasource node data not found")
        from core.datasource.datasource_manager import DatasourceManager

        datasource_runtime = DatasourceManager.get_datasource_runtime(
            provider_id=datasource_node_data.get("provider_id"),
            datasource_name=datasource_node_data.get("datasource_name"),
            tenant_id=pipeline.tenant_id,
            datasource_type=DatasourceProviderType(datasource_type),
        )
        if datasource_runtime.datasource_provider_type() == DatasourceProviderType.ONLINE_DOCUMENT:
            datasource_runtime = cast(OnlineDocumentDatasourcePlugin, datasource_runtime)
            online_document_result: GetOnlineDocumentPagesResponse = (
                datasource_runtime._get_online_document_pages(
                    user_id=account.id,
                    datasource_parameters=user_inputs,
                    provider_type=datasource_runtime.datasource_provider_type(),
                )
            )
            return {
                "result": [page.model_dump() for page in online_document_result.result],
                "provider_type": datasource_node_data.get("provider_type"),
            }

        elif datasource_runtime.datasource_provider_type == DatasourceProviderType.WEBSITE_CRAWL:
            datasource_runtime = cast(WebsiteCrawlDatasourcePlugin, datasource_runtime)
            website_crawl_result: GetWebsiteCrawlResponse = datasource_runtime._get_website_crawl(
                user_id=account.id,
                datasource_parameters=user_inputs,
                provider_type=datasource_runtime.datasource_provider_type(),
            )
            return {
                "result": [result.model_dump() for result in website_crawl_result.result],
                "provider_type": datasource_node_data.get("provider_type"),
            }
        else:
            raise ValueError(f"Unsupported datasource provider: {datasource_runtime.datasource_provider_type}")


    def run_free_workflow_node(
        self, node_data: dict, tenant_id: str, user_id: str, node_id: str, user_inputs: dict[str, Any]
    ) -> WorkflowNodeExecution:
        """
        Run draft workflow node
        """
        # run draft workflow node
        start_at = time.perf_counter()

        workflow_node_execution = self._handle_node_run_result(
            getter=lambda: WorkflowEntry.run_free_node(
                node_id=node_id,
                node_data=node_data,
                tenant_id=tenant_id,
                user_id=user_id,
                user_inputs=user_inputs,
            ),
            start_at=start_at,
            tenant_id=tenant_id,
            node_id=node_id,
        )

        return workflow_node_execution

    def _handle_node_run_result(
        self,
        getter: Callable[[], tuple[BaseNode, Generator[NodeEvent | InNodeEvent, None, None]]],
        start_at: float,
        tenant_id: str,
        node_id: str,
    ) -> WorkflowNodeExecution:
        """
        Handle node run result

        :param getter: Callable[[], tuple[BaseNode, Generator[RunEvent | InNodeEvent, None, None]]]
        :param start_at: float
        :param tenant_id: str
        :param node_id: str
        """
        try:
            node_instance, generator = getter()

            node_run_result: NodeRunResult | None = None
            for event in generator:
                if isinstance(event, RunCompletedEvent):
                    node_run_result = event.run_result

                    # sign output files
                    node_run_result.outputs = WorkflowEntry.handle_special_values(node_run_result.outputs)
                    break

            if not node_run_result:
                raise ValueError("Node run failed with no run result")
            # single step debug mode error handling return
            if node_run_result.status == WorkflowNodeExecutionStatus.FAILED and node_instance.should_continue_on_error:
                node_error_args: dict[str, Any] = {
                    "status": WorkflowNodeExecutionStatus.EXCEPTION,
                    "error": node_run_result.error,
                    "inputs": node_run_result.inputs,
                    "metadata": {"error_strategy": node_instance.node_data.error_strategy},
                }
                if node_instance.node_data.error_strategy is ErrorStrategy.DEFAULT_VALUE:
                    node_run_result = NodeRunResult(
                        **node_error_args,
                        outputs={
                            **node_instance.node_data.default_value_dict,
                            "error_message": node_run_result.error,
                            "error_type": node_run_result.error_type,
                        },
                    )
                else:
                    node_run_result = NodeRunResult(
                        **node_error_args,
                        outputs={
                            "error_message": node_run_result.error,
                            "error_type": node_run_result.error_type,
                        },
                    )
            run_succeeded = node_run_result.status in (
                WorkflowNodeExecutionStatus.SUCCEEDED,
                WorkflowNodeExecutionStatus.EXCEPTION,
            )
            error = node_run_result.error if not run_succeeded else None
        except WorkflowNodeRunFailedError as e:
            node_instance = e.node_instance
            run_succeeded = False
            node_run_result = None
            error = e.error

        workflow_node_execution = WorkflowNodeExecution()
        workflow_node_execution.id = str(uuid4())
        workflow_node_execution.tenant_id = tenant_id
        workflow_node_execution.triggered_from = WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP.value
        workflow_node_execution.index = 1
        workflow_node_execution.node_id = node_id
        workflow_node_execution.node_type = node_instance.node_type
        workflow_node_execution.title = node_instance.node_data.title
        workflow_node_execution.elapsed_time = time.perf_counter() - start_at
        workflow_node_execution.created_by_role = CreatorUserRole.ACCOUNT.value
        workflow_node_execution.created_at = datetime.now(UTC).replace(tzinfo=None)
        workflow_node_execution.finished_at = datetime.now(UTC).replace(tzinfo=None)
        if run_succeeded and node_run_result:
            # create workflow node execution
            inputs = WorkflowEntry.handle_special_values(node_run_result.inputs) if node_run_result.inputs else None
            process_data = (
                WorkflowEntry.handle_special_values(node_run_result.process_data)
                if node_run_result.process_data
                else None
            )
            outputs = WorkflowEntry.handle_special_values(node_run_result.outputs) if node_run_result.outputs else None

            workflow_node_execution.inputs = json.dumps(inputs)
            workflow_node_execution.process_data = json.dumps(process_data)
            workflow_node_execution.outputs = json.dumps(outputs)
            workflow_node_execution.execution_metadata = (
                json.dumps(jsonable_encoder(node_run_result.metadata)) if node_run_result.metadata else None
            )
            if node_run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED:
                workflow_node_execution.status = WorkflowNodeExecutionStatus.SUCCEEDED.value
            elif node_run_result.status == WorkflowNodeExecutionStatus.EXCEPTION:
                workflow_node_execution.status = WorkflowNodeExecutionStatus.EXCEPTION.value
                workflow_node_execution.error = node_run_result.error
        else:
            # create workflow node execution
            workflow_node_execution.status = WorkflowNodeExecutionStatus.FAILED.value
            workflow_node_execution.error = error

        return workflow_node_execution

    def update_workflow(
        self, *, session: Session, workflow_id: str, tenant_id: str, account_id: str, data: dict
    ) -> Optional[Workflow]:
        """
        Update workflow attributes

        :param session: SQLAlchemy database session
        :param workflow_id: Workflow ID
        :param tenant_id: Tenant ID
        :param account_id: Account ID (for permission check)
        :param data: Dictionary containing fields to update
        :return: Updated workflow or None if not found
        """
        stmt = select(Workflow).where(Workflow.id == workflow_id, Workflow.tenant_id == tenant_id)
        workflow = session.scalar(stmt)

        if not workflow:
            return None

        allowed_fields = ["marked_name", "marked_comment"]

        for field, value in data.items():
            if field in allowed_fields:
                setattr(workflow, field, value)

        workflow.updated_by = account_id
        workflow.updated_at = datetime.now(UTC).replace(tzinfo=None)

        return workflow

    def get_published_second_step_parameters(self, pipeline: Pipeline, node_id: str) -> list[dict]:
        """
        Get second step parameters of rag pipeline
        """

        workflow = self.get_published_workflow(pipeline=pipeline)
        if not workflow:
            raise ValueError("Workflow not initialized")

        # get second step node
        rag_pipeline_variables = workflow.rag_pipeline_variables
        if not rag_pipeline_variables:
            return []

        # get datasource provider
        datasource_provider_variables = [
            item
            for item in rag_pipeline_variables
            if item.get("belong_to_node_id") == node_id or item.get("belong_to_node_id") == "shared"
        ]
        return datasource_provider_variables

    def get_draft_second_step_parameters(self, pipeline: Pipeline, node_id: str) -> list[dict]:
        """
        Get second step parameters of rag pipeline
        """

        workflow = self.get_draft_workflow(pipeline=pipeline)
        if not workflow:
            raise ValueError("Workflow not initialized")

        # get second step node
        rag_pipeline_variables = workflow.rag_pipeline_variables
        if not rag_pipeline_variables:
            return []

        # get datasource provider
        datasource_provider_variables = [
            item
            for item in rag_pipeline_variables
            if item.get("belong_to_node_id") == node_id or item.get("belong_to_node_id") == "shared"
        ]
        return datasource_provider_variables

    def get_rag_pipeline_paginate_workflow_runs(self, pipeline: Pipeline, args: dict) -> InfiniteScrollPagination:
        """
        Get debug workflow run list
        Only return triggered_from == debugging

        :param app_model: app model
        :param args: request args
        """
        limit = int(args.get("limit", 20))

        base_query = db.session.query(WorkflowRun).filter(
            WorkflowRun.tenant_id == pipeline.tenant_id,
            WorkflowRun.app_id == pipeline.id,
            WorkflowRun.triggered_from == WorkflowRunTriggeredFrom.DEBUGGING.value,
        )

        if args.get("last_id"):
            last_workflow_run = base_query.filter(
                WorkflowRun.id == args.get("last_id"),
            ).first()

            if not last_workflow_run:
                raise ValueError("Last workflow run not exists")

            workflow_runs = (
                base_query.filter(
                    WorkflowRun.created_at < last_workflow_run.created_at, WorkflowRun.id != last_workflow_run.id
                )
                .order_by(WorkflowRun.created_at.desc())
                .limit(limit)
                .all()
            )
        else:
            workflow_runs = base_query.order_by(WorkflowRun.created_at.desc()).limit(limit).all()

        has_more = False
        if len(workflow_runs) == limit:
            current_page_first_workflow_run = workflow_runs[-1]
            rest_count = base_query.filter(
                WorkflowRun.created_at < current_page_first_workflow_run.created_at,
                WorkflowRun.id != current_page_first_workflow_run.id,
            ).count()

            if rest_count > 0:
                has_more = True

        return InfiniteScrollPagination(data=workflow_runs, limit=limit, has_more=has_more)

    def get_rag_pipeline_workflow_run(self, pipeline: Pipeline, run_id: str) -> Optional[WorkflowRun]:
        """
        Get workflow run detail

        :param app_model: app model
        :param run_id: workflow run id
        """
        workflow_run = (
            db.session.query(WorkflowRun)
            .filter(
                WorkflowRun.tenant_id == pipeline.tenant_id,
                WorkflowRun.app_id == pipeline.id,
                WorkflowRun.id == run_id,
            )
            .first()
        )

        return workflow_run

    def get_rag_pipeline_workflow_run_node_executions(
        self,
        pipeline: Pipeline,
        run_id: str,
        user: Account | EndUser,
    ) -> list[WorkflowNodeExecution]:
        """
        Get workflow run node execution list
        """
        workflow_run = self.get_rag_pipeline_workflow_run(pipeline, run_id)

        contexts.plugin_tool_providers.set({})
        contexts.plugin_tool_providers_lock.set(threading.Lock())

        if not workflow_run:
            return []

        # Use the repository to get the node execution
        repository = SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=db.engine,
            app_id=pipeline.id,
            user=user,
            triggered_from=None
        )

        # Use the repository to get the node executions with ordering
        order_config = OrderConfig(order_by=["index"], order_direction="desc")
        node_executions = repository.get_by_workflow_run(workflow_run_id=run_id, order_config=order_config)
      # Convert domain models to database models
        workflow_node_executions = [repository.to_db_model(node_execution) for node_execution in node_executions]

        return workflow_node_executions
