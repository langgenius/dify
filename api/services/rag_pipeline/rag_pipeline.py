import json
import logging
import re
import threading
from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

import contexts
from configs import dify_config
from core.app.entities.app_invoke_entities import InvokeFrom
from core.helper import marketplace
from graphon.enums import BuiltinNodeTypes, NodeType
from graphon.nodes.http_request import HTTP_REQUEST_CONFIG_FILTER_KEY, build_http_request_config
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from libs.login import resolve_account_fallback, resolve_tenant_id_fallback
from models import Account
from models.dataset import (  # type: ignore
    Dataset,
    Document,
    DocumentPipelineExecutionLog,
    Pipeline,
    PipelineCustomizedTemplate,
    PipelineRecommendedPlugin,
)
from models.enums import WorkflowRunTriggeredFrom
from models.model import EndUser
from models.workflow import (
    Workflow,
    WorkflowNodeExecutionModel,
    WorkflowRun,
)
from repositories.factory import DifyAPIRepositoryFactory
from repositories.workflow.definition_repository import WorkflowDefinitionStore, workflow_record
from services.credentials.query import CredentialQuery
from services.data_source.provider_service import DatasourceProviderService
from services.entities.knowledge_entities.rag_pipeline_entities import (
    PipelineTemplateInfoEntity,
)
from services.errors.rag_pipeline import RagPipelineResourceNotFoundError
from services.rag_pipeline.pipeline_template.pipeline_template_factory import PipelineTemplateRetrievalFactory
from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelineDslService
from services.tools.builtin_tools_manage_service import BuiltinToolManageService
from services.tools.provider_queries import ToolProviders
from services.workflow.contracts import WorkflowRecord
from services.workflow.execution.adapters.node_factory import LATEST_VERSION, get_node_type_classes_mapping
from services.workflow.execution.adapters.pipeline.pipeline_generator import PipelineGenerator
from services.workflow_node_execution_trace_service import (
    WorkflowNodeExecutionTrace,
    assemble_workflow_node_execution_traces,
)
from services.workflow_ref_service import WorkflowRef

logger = logging.getLogger(__name__)


class RagPipelineService:
    _session: Session

    def __init__(self, session: Session, session_maker: sessionmaker | None = None):
        """Initialize RagPipelineService with repository dependencies."""
        self._session = session
        if session_maker is None:
            session_maker = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
        self._node_execution_service_repo = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
            session_maker
        )
        self._workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)

    @staticmethod
    def get_pipeline_by_id(pipeline_id: str, tenant_id: str, *, session: Session) -> Pipeline | None:
        return session.scalar(
            select(Pipeline).where(Pipeline.id == pipeline_id, Pipeline.tenant_id == tenant_id).limit(1)
        )

    @classmethod
    def get_pipeline_templates(
        cls,
        type: str = "built-in",
        language: str = "en-US",
        current_tenant_id: str | None = None,
        *,
        session: Session,
    ) -> dict[str, Any]:
        if type == "built-in":
            mode = dify_config.HOSTED_FETCH_PIPELINE_TEMPLATES_MODE
            retrieval_instance = PipelineTemplateRetrievalFactory.get_pipeline_template_factory(mode)()
            result = retrieval_instance.get_pipeline_templates(language, current_tenant_id, session=session)
            if not result.get("pipeline_templates") and language != "en-US":
                template_retrieval = PipelineTemplateRetrievalFactory.get_built_in_pipeline_template_retrieval()
                result = template_retrieval.fetch_pipeline_templates_from_builtin("en-US")
            return result
        else:
            mode = "customized"
            retrieval_instance = PipelineTemplateRetrievalFactory.get_pipeline_template_factory(mode)()
            result = retrieval_instance.get_pipeline_templates(language, current_tenant_id, session=session)
            return result

    @classmethod
    def get_pipeline_template_detail(
        cls,
        template_id: str,
        current_tenant_id: str,
        type: str = "built-in",
        *,
        session: Session,
    ) -> dict[str, Any] | None:
        """
        Get pipeline template detail.

        :param template_id: template id
        :param type: template type, "built-in" or "customized"
        :return: template detail dict, or None if not found
        """
        if type == "built-in":
            mode = dify_config.HOSTED_FETCH_PIPELINE_TEMPLATES_MODE
            retrieval_instance = PipelineTemplateRetrievalFactory.get_pipeline_template_factory(mode)()
            built_in_result: dict[str, Any] | None = retrieval_instance.get_pipeline_template_detail(
                template_id, current_tenant_id, session=session
            )
            if built_in_result is None:
                logger.warning(
                    "pipeline template retrieval returned empty result, template_id: %s, mode: %s",
                    template_id,
                    mode,
                )
            return built_in_result
        else:
            mode = "customized"
            retrieval_instance = PipelineTemplateRetrievalFactory.get_pipeline_template_factory(mode)()
            customized_result: dict[str, Any] | None = retrieval_instance.get_pipeline_template_detail(
                template_id, current_tenant_id, session=session
            )
            return customized_result

    @staticmethod
    def get_customized_pipeline_template_yaml(template_id: str, current_tenant_id: str, *, session: Session) -> str:
        yaml_content = session.scalar(
            select(PipelineCustomizedTemplate.yaml_content).where(
                PipelineCustomizedTemplate.id == template_id,
                PipelineCustomizedTemplate.tenant_id == current_tenant_id,
            )
        )
        if yaml_content is None:
            raise RagPipelineResourceNotFoundError("Customized pipeline template not found.")
        return yaml_content

    @classmethod
    def update_customized_pipeline_template(
        cls,
        template_id: str,
        template_info: PipelineTemplateInfoEntity,
        current_user: Account | None = None,
        current_tenant_id: str | None = None,
        *,
        session: Session,
    ):
        """
        Update pipeline template.
        :param template_id: template id
        :param template_info: template info
        """
        current_user, current_tenant_id = resolve_account_fallback(current_user, current_tenant_id)
        customized_template: PipelineCustomizedTemplate | None = session.scalar(
            select(PipelineCustomizedTemplate)
            .where(
                PipelineCustomizedTemplate.id == template_id,
                PipelineCustomizedTemplate.tenant_id == current_tenant_id,
            )
            .limit(1)
        )
        if not customized_template:
            raise ValueError("Customized pipeline template not found.")
        # check template name is exist
        template_name = template_info.name
        if template_name:
            template = session.scalar(
                select(PipelineCustomizedTemplate)
                .where(
                    PipelineCustomizedTemplate.name == template_name,
                    PipelineCustomizedTemplate.tenant_id == current_tenant_id,
                    PipelineCustomizedTemplate.id != template_id,
                )
                .limit(1)
            )
            if template:
                raise ValueError("Template name is already exists")
        customized_template.name = template_info.name
        customized_template.description = template_info.description
        customized_template.icon = template_info.icon_info.model_dump()
        customized_template.updated_by = current_user.id
        session.commit()
        return customized_template

    @classmethod
    def delete_customized_pipeline_template(
        cls, template_id: str, current_tenant_id: str | None = None, *, session: Session
    ):
        """
        Delete customized pipeline template.
        """
        current_tenant_id = resolve_tenant_id_fallback(current_tenant_id)
        customized_template: PipelineCustomizedTemplate | None = session.scalar(
            select(PipelineCustomizedTemplate)
            .where(
                PipelineCustomizedTemplate.id == template_id,
                PipelineCustomizedTemplate.tenant_id == current_tenant_id,
            )
            .limit(1)
        )
        if not customized_template:
            raise ValueError("Customized pipeline template not found.")
        session.delete(customized_template)
        session.commit()

    def get_draft_workflow(self, pipeline: Pipeline) -> Workflow | None:
        """
        Get draft workflow
        """
        return WorkflowDefinitionStore.get_draft_workflow(pipeline, session=self._session)

    def get_draft_workflow_record(self, pipeline: Pipeline) -> WorkflowRecord | None:
        workflow = self.get_draft_workflow(pipeline)
        return workflow_record(workflow, self._session) if workflow is not None else None

    def get_published_workflow(self, pipeline: Pipeline) -> Workflow | None:
        """
        Get published workflow
        """

        return WorkflowDefinitionStore.get_published_workflow(pipeline, session=self._session)

    def get_published_workflow_record(self, pipeline: Pipeline) -> WorkflowRecord | None:
        workflow = self.get_published_workflow(pipeline)
        return workflow_record(workflow, self._session) if workflow is not None else None

    def get_all_published_workflow(
        self,
        *,
        session: Session,
        pipeline: Pipeline,
        page: int,
        limit: int,
        user_id: str | None,
        named_only: bool = False,
    ) -> tuple[Sequence[WorkflowRecord], bool]:
        """
        Get published workflow with pagination
        """
        workflows, has_more = WorkflowDefinitionStore.get_all_published_workflow(
            session=session,
            app_model=pipeline,
            page=page,
            limit=limit,
            user_id=user_id,
            named_only=named_only,
        )

        return [workflow_record(workflow, session) for workflow in workflows], has_more

    def get_default_block_configs(self) -> list[dict]:
        """
        Get default block configs
        """
        # return default block config
        default_block_configs: list[dict[str, Any]] = []
        for node_type, node_class_mapping in get_node_type_classes_mapping().items():
            node_class = node_class_mapping[LATEST_VERSION]
            filters = None
            if node_type == BuiltinNodeTypes.HTTP_REQUEST:
                filters = {
                    HTTP_REQUEST_CONFIG_FILTER_KEY: build_http_request_config(
                        max_connect_timeout=dify_config.HTTP_REQUEST_MAX_CONNECT_TIMEOUT,
                        max_read_timeout=dify_config.HTTP_REQUEST_MAX_READ_TIMEOUT,
                        max_write_timeout=dify_config.HTTP_REQUEST_MAX_WRITE_TIMEOUT,
                        max_binary_size=dify_config.HTTP_REQUEST_NODE_MAX_BINARY_SIZE,
                        max_text_size=dify_config.HTTP_REQUEST_NODE_MAX_TEXT_SIZE,
                        ssl_verify=dify_config.HTTP_REQUEST_NODE_SSL_VERIFY,
                        ssrf_default_max_retries=dify_config.SSRF_DEFAULT_MAX_RETRIES,
                    )
                }
            default_config = node_class.get_default_config(filters=filters)
            if default_config:
                default_block_configs.append(dict(default_config))

        return default_block_configs

    def get_default_block_config(
        self, node_type: str, filters: dict[str, Any] | None = None
    ) -> Mapping[str, object] | None:
        """
        Get default config of node.
        :param node_type: node type
        :param filters: filter by node config parameters.
        :return:
        """
        node_type_enum: NodeType = node_type
        node_mapping = get_node_type_classes_mapping()

        # return default block config
        if node_type_enum not in node_mapping:
            return None

        node_class = node_mapping[node_type_enum][LATEST_VERSION]
        final_filters = dict(filters) if filters else {}
        if node_type_enum == BuiltinNodeTypes.HTTP_REQUEST and HTTP_REQUEST_CONFIG_FILTER_KEY not in final_filters:
            final_filters[HTTP_REQUEST_CONFIG_FILTER_KEY] = build_http_request_config(
                max_connect_timeout=dify_config.HTTP_REQUEST_MAX_CONNECT_TIMEOUT,
                max_read_timeout=dify_config.HTTP_REQUEST_MAX_READ_TIMEOUT,
                max_write_timeout=dify_config.HTTP_REQUEST_MAX_WRITE_TIMEOUT,
                max_binary_size=dify_config.HTTP_REQUEST_NODE_MAX_BINARY_SIZE,
                max_text_size=dify_config.HTTP_REQUEST_NODE_MAX_TEXT_SIZE,
                ssl_verify=dify_config.HTTP_REQUEST_NODE_SSL_VERIFY,
                ssrf_default_max_retries=dify_config.SSRF_DEFAULT_MAX_RETRIES,
            )
        default_config = node_class.get_default_config(filters=final_filters or None)
        if not default_config:
            return None

        return default_config

    def update_workflow(
        self,
        *,
        session: Session,
        account_id: str,
        data: dict[str, Any],
        workflow_ref: WorkflowRef,
    ) -> WorkflowRecord | None:
        """
        Update workflow attributes

        :param session: SQLAlchemy database session
        :param account_id: Account ID (for permission check)
        :param data: Dictionary containing fields to update
        :param workflow_ref: Owner-bound workflow reference
        :return: Updated workflow or None if not found
        """
        workflow = WorkflowDefinitionStore.update_workflow(
            session=session, account_id=account_id, data=data, workflow_ref=workflow_ref
        )
        return workflow_record(workflow, session) if workflow is not None else None

    def get_first_step_parameters(self, pipeline: Pipeline, node_id: str, is_draft: bool = False) -> list[dict]:
        """
        Get first step parameters of rag pipeline
        """

        workflow = (
            self.get_draft_workflow(pipeline=pipeline) if is_draft else self.get_published_workflow(pipeline=pipeline)
        )
        if not workflow:
            raise ValueError("Workflow not initialized")

        datasource_node_data = None
        datasource_nodes = workflow.graph_dict.get("nodes", [])
        for datasource_node in datasource_nodes:
            if datasource_node.get("id") == node_id:
                datasource_node_data = datasource_node.get("data", {})
                break
        if not datasource_node_data:
            raise ValueError("Datasource node data not found")
        variables = workflow.rag_pipeline_variables
        if variables:
            variables_map = {item["variable"]: item for item in variables}
        else:
            return []
        datasource_parameters = datasource_node_data.get("datasource_parameters", {})
        user_input_variables_keys = []
        user_input_variables = []

        for _, value in datasource_parameters.items():
            if value.get("value") and isinstance(value.get("value"), str):
                pattern = r"\{\{#([a-zA-Z0-9_]{1,50}(?:\.[a-zA-Z0-9_][a-zA-Z0-9_]{0,29}){1,10})#\}\}"
                match = re.match(pattern, value["value"])
                if match:
                    full_path = match.group(1)
                    last_part = full_path.split(".")[-1]
                    user_input_variables_keys.append(last_part)
            elif value.get("value") and isinstance(value.get("value"), list):
                last_part = value.get("value")[-1]
                user_input_variables_keys.append(last_part)
        for key, value in variables_map.items():
            if key in user_input_variables_keys:
                user_input_variables.append(value)

        return user_input_variables

    def get_second_step_parameters(self, pipeline: Pipeline, node_id: str, is_draft: bool = False) -> list[dict]:
        """
        Get second step parameters of rag pipeline
        """

        workflow = (
            self.get_draft_workflow(pipeline=pipeline) if is_draft else self.get_published_workflow(pipeline=pipeline)
        )
        if not workflow:
            raise ValueError("Workflow not initialized")

        # get second step node
        rag_pipeline_variables = workflow.rag_pipeline_variables
        if not rag_pipeline_variables:
            return []
        variables_map = {item["variable"]: item for item in rag_pipeline_variables}

        # get datasource node data
        datasource_node_data = None
        datasource_nodes = workflow.graph_dict.get("nodes", [])
        for datasource_node in datasource_nodes:
            if datasource_node.get("id") == node_id:
                datasource_node_data = datasource_node.get("data", {})
                break
        if datasource_node_data:
            datasource_parameters = datasource_node_data.get("datasource_parameters", {})

            for _, value in datasource_parameters.items():
                if value.get("value") and isinstance(value.get("value"), str):
                    pattern = r"\{\{#([a-zA-Z0-9_]{1,50}(?:\.[a-zA-Z0-9_][a-zA-Z0-9_]{0,29}){1,10})#\}\}"
                    match = re.match(pattern, value["value"])
                    if match:
                        full_path = match.group(1)
                        last_part = full_path.split(".")[-1]
                        variables_map.pop(last_part, None)
                elif value.get("value") and isinstance(value.get("value"), list):
                    last_part = value.get("value")[-1]
                    variables_map.pop(last_part, None)
        all_second_step_variables = list(variables_map.values())
        datasource_provider_variables = [
            item
            for item in all_second_step_variables
            if item.get("belong_to_node_id") == node_id or item.get("belong_to_node_id") == "shared"
        ]
        return datasource_provider_variables

    def get_rag_pipeline_paginate_workflow_runs(
        self, pipeline: Pipeline, args: dict[str, Any]
    ) -> InfiniteScrollPagination:
        """
        Get debug workflow run list
        Only return triggered_from == debugging

        :param app_model: app model
        :param args: request args
        """
        limit = int(args.get("limit", 20))
        last_id = args.get("last_id")

        triggered_from_values = [
            WorkflowRunTriggeredFrom.RAG_PIPELINE_RUN,
            WorkflowRunTriggeredFrom.RAG_PIPELINE_DEBUGGING,
        ]

        return self._workflow_run_repo.get_paginated_workflow_runs(
            tenant_id=pipeline.tenant_id,
            app_id=pipeline.id,
            triggered_from=triggered_from_values,
            limit=limit,
            last_id=last_id,
        )

    def get_rag_pipeline_workflow_run(self, pipeline: Pipeline, run_id: str) -> WorkflowRun | None:
        """
        Get workflow run detail

        :param app_model: app model
        :param run_id: workflow run id
        """
        return self._workflow_run_repo.get_workflow_run_by_id(
            tenant_id=pipeline.tenant_id,
            app_id=pipeline.id,
            run_id=run_id,
        )

    def get_rag_pipeline_workflow_run_node_executions(
        self, pipeline: Pipeline, run_id: str, user: Account | EndUser, *, tool_providers: ToolProviders
    ) -> list[WorkflowNodeExecutionTrace]:
        """
        Get workflow run node execution list
        """
        workflow_run = self.get_rag_pipeline_workflow_run(pipeline, run_id)

        contexts.plugin_tool_providers.set({})
        contexts.plugin_tool_providers_lock.set(threading.Lock())

        if not workflow_run:
            return []

        node_executions = self._node_execution_service_repo.get_executions_by_workflow_run(
            tenant_id=pipeline.tenant_id,
            app_id=pipeline.id,
            workflow_run_id=run_id,
        )
        return assemble_workflow_node_execution_traces(
            node_executions, self._node_execution_service_repo, session=self._session, tool_providers=tool_providers
        )

    @staticmethod
    def publish_customized_pipeline_template(
        pipeline: Pipeline,
        dataset: Dataset,
        args: dict[str, Any],
        current_user: Account,
        *,
        session: Session,
    ) -> None:
        """Publish a customized template from a caller-validated pipeline and dataset."""
        if not pipeline.workflow_id:
            raise RagPipelineResourceNotFoundError("Pipeline workflow not found")
        workflow = session.scalar(
            select(Workflow).where(
                Workflow.id == pipeline.workflow_id,
                Workflow.tenant_id == pipeline.tenant_id,
                Workflow.app_id == pipeline.id,
            )
        )
        if not workflow:
            raise RagPipelineResourceNotFoundError("Workflow not found")
        draft_workflow_id = session.scalar(
            select(Workflow.id).where(
                Workflow.tenant_id == pipeline.tenant_id,
                Workflow.app_id == pipeline.id,
                Workflow.version == Workflow.VERSION_DRAFT,
            )
        )
        if not draft_workflow_id:
            raise RagPipelineResourceNotFoundError("Draft workflow not found")

        # check template name is exist
        template = session.scalar(
            select(PipelineCustomizedTemplate)
            .where(
                PipelineCustomizedTemplate.name == args["name"],
                PipelineCustomizedTemplate.tenant_id == pipeline.tenant_id,
            )
            .limit(1)
        )
        if template:
            raise ValueError("Template name is already exists")

        max_position = session.scalar(
            select(func.max(PipelineCustomizedTemplate.position)).where(
                PipelineCustomizedTemplate.tenant_id == pipeline.tenant_id
            )
        )

        rag_pipeline_dsl_service = RagPipelineDslService(session)
        dsl = rag_pipeline_dsl_service.export_rag_pipeline_dsl(pipeline=pipeline, include_secret=True)
        pipeline_customized_template = PipelineCustomizedTemplate(
            name=args["name"],
            description=args["description"],
            icon=args["icon_info"],
            tenant_id=pipeline.tenant_id,
            yaml_content=dsl,
            install_count=0,
            position=max_position + 1 if max_position else 1,
            chunk_structure=dataset.chunk_structure,
            language="en-US",
            created_by=current_user.id,
        )
        session.add(pipeline_customized_template)
        session.commit()

    def get_node_last_run(
        self, pipeline: Pipeline, workflow: Workflow, node_id: str
    ) -> WorkflowNodeExecutionModel | None:
        node_exec = self._node_execution_service_repo.get_node_last_execution(
            tenant_id=pipeline.tenant_id,
            app_id=pipeline.id,
            workflow_id=workflow.id,
            node_id=node_id,
        )
        return node_exec

    def _fetch_recommended_plugin_manifests(self, plugin_ids: list[str]) -> list[Any]:
        if not dify_config.MARKETPLACE_ENABLED:
            logger.info("Marketplace disabled; recommended-plugins list empty")
            return []
        return marketplace.batch_fetch_plugin_by_ids(plugin_ids)

    def get_recommended_plugins(
        self, type: str, current_user: Account, current_tenant_id: str, *, tool_providers: ToolProviders
    ) -> dict[str, Any]:
        # Query active recommended plugins
        stmt = select(PipelineRecommendedPlugin).where(PipelineRecommendedPlugin.active == True)
        if type and type != "all":
            stmt = stmt.where(PipelineRecommendedPlugin.type == type)

        pipeline_recommended_plugins = self._session.scalars(
            stmt.order_by(PipelineRecommendedPlugin.position.asc())
        ).all()

        if not pipeline_recommended_plugins:
            return {
                "installed_recommended_plugins": [],
                "uninstalled_recommended_plugins": [],
            }

        # Batch fetch plugin manifests
        plugin_ids = [plugin.plugin_id for plugin in pipeline_recommended_plugins]
        providers = BuiltinToolManageService.list_builtin_tools(
            user_id=current_user.id, tenant_id=current_tenant_id, tool_providers=tool_providers
        )
        providers_map = {provider.plugin_id: provider.to_dict() for provider in providers}

        plugin_manifests = self._fetch_recommended_plugin_manifests(plugin_ids)
        plugin_manifests_map = {manifest["plugin_id"]: manifest for manifest in plugin_manifests}

        installed_plugin_list = []
        uninstalled_plugin_list = []
        for plugin_id in plugin_ids:
            if providers_map.get(plugin_id):
                installed_plugin_list.append(providers_map.get(plugin_id))
            else:
                plugin_manifest = plugin_manifests_map.get(plugin_id)
                if plugin_manifest:
                    uninstalled_plugin_list.append(plugin_manifest)

        # Build recommended plugins list
        return {
            "installed_recommended_plugins": installed_plugin_list,
            "uninstalled_recommended_plugins": uninstalled_plugin_list,
        }

    def retry_error_document(
        self, dataset: Dataset, document: Document, user: Account | EndUser, *, generator: PipelineGenerator
    ):
        """
        Retry error document
        """
        document_pipeline_execution_log = self._session.scalar(
            select(DocumentPipelineExecutionLog).where(DocumentPipelineExecutionLog.document_id == document.id).limit(1)
        )
        if not document_pipeline_execution_log:
            raise ValueError("Document pipeline execution log not found")
        pipeline = self._session.get(Pipeline, document_pipeline_execution_log.pipeline_id)
        if not pipeline:
            raise ValueError("Pipeline not found")
        # convert to app config
        workflow = self.get_published_workflow(pipeline)
        if not workflow:
            raise ValueError("Workflow not found")
        generator.generate(
            pipeline=pipeline,
            workflow=workflow,
            user=user,
            args={
                "inputs": document_pipeline_execution_log.input_data,
                "start_node_id": document_pipeline_execution_log.datasource_node_id,
                "datasource_type": document_pipeline_execution_log.datasource_type,
                "datasource_info_list": [json.loads(document_pipeline_execution_log.datasource_info)],
                "original_document_id": document.id,
            },
            invoke_from=InvokeFrom.PUBLISHED_PIPELINE,
            streaming=False,
            call_depth=0,
            workflow_thread_pool_id=None,
            is_retry=True,
        )

    def get_datasource_plugins(
        self,
        tenant_id: str,
        dataset_id: str,
        is_published: bool,
        *,
        credential_query: CredentialQuery,
        datasource_providers: DatasourceProviderService,
    ) -> list[dict]:
        """
        Get datasource plugins
        """
        dataset: Dataset | None = self._session.scalar(
            select(Dataset)
            .where(
                Dataset.id == dataset_id,
                Dataset.tenant_id == tenant_id,
            )
            .limit(1)
        )
        if not dataset:
            raise ValueError("Dataset not found")
        pipeline: Pipeline | None = self._session.scalar(
            select(Pipeline)
            .where(
                Pipeline.id == dataset.pipeline_id,
                Pipeline.tenant_id == tenant_id,
            )
            .limit(1)
        )
        if not pipeline:
            raise ValueError("Pipeline not found")

        workflow: Workflow | None = None
        if is_published:
            workflow = self.get_published_workflow(pipeline=pipeline)
        else:
            workflow = self.get_draft_workflow(pipeline=pipeline)
        if not pipeline or not workflow:
            raise ValueError("Pipeline or workflow not found")

        datasource_nodes = workflow.graph_dict.get("nodes", [])
        datasource_plugins = []
        for datasource_node in datasource_nodes:
            if datasource_node.get("data", {}).get("type") == "datasource":
                datasource_node_data = datasource_node["data"]
                if not datasource_node_data:
                    continue

                variables = workflow.rag_pipeline_variables
                if variables:
                    variables_map = {item["variable"]: item for item in variables}
                else:
                    variables_map = {}

                datasource_parameters = datasource_node_data.get("datasource_parameters", {})
                user_input_variables_keys = []
                user_input_variables = []

                for _, value in datasource_parameters.items():
                    if value.get("value") and isinstance(value.get("value"), str):
                        pattern = r"\{\{#([a-zA-Z0-9_]{1,50}(?:\.[a-zA-Z0-9_][a-zA-Z0-9_]{0,29}){1,10})#\}\}"
                        match = re.match(pattern, value["value"])
                        if match:
                            full_path = match.group(1)
                            last_part = full_path.split(".")[-1]
                            user_input_variables_keys.append(last_part)
                    elif value.get("value") and isinstance(value.get("value"), list):
                        last_part = value.get("value")[-1]
                        user_input_variables_keys.append(last_part)
                for key, value in variables_map.items():
                    if key in user_input_variables_keys:
                        user_input_variables.append(value)

                # get credentials
                credentials: list[dict[Any, Any]] = datasource_providers.list_datasource_credentials(
                    tenant_id=tenant_id,
                    provider=datasource_node_data.get("provider_name"),
                    plugin_id=datasource_node_data.get("plugin_id"),
                    credential_query=credential_query,
                )
                credential_info_list: list[Any] = []
                for credential in credentials:
                    credential_info_list.append(
                        {
                            "id": credential.get("id"),
                            "name": credential.get("name"),
                            "type": credential.get("type"),
                            "is_default": credential.get("is_default"),
                        }
                    )

                datasource_plugins.append(
                    {
                        "node_id": datasource_node.get("id"),
                        "plugin_id": datasource_node_data.get("plugin_id"),
                        "provider_name": datasource_node_data.get("provider_name"),
                        "datasource_type": datasource_node_data.get("provider_type"),
                        "title": datasource_node_data.get("title"),
                        "user_input_variables": user_input_variables,
                        "credentials": credential_info_list,
                    }
                )

        return datasource_plugins

    def get_pipeline(self, tenant_id: str, dataset_id: str) -> Pipeline:
        """
        Get pipeline
        """
        dataset: Dataset | None = self._session.scalar(
            select(Dataset)
            .where(
                Dataset.id == dataset_id,
                Dataset.tenant_id == tenant_id,
            )
            .limit(1)
        )
        if not dataset:
            raise ValueError("Dataset not found")
        pipeline: Pipeline | None = self._session.scalar(
            select(Pipeline)
            .where(
                Pipeline.id == dataset.pipeline_id,
                Pipeline.tenant_id == tenant_id,
            )
            .limit(1)
        )
        if not pipeline:
            raise ValueError("Pipeline not found")
        return pipeline
