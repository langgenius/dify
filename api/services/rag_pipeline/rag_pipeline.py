import json
import logging
import re
import threading
import time
from collections.abc import Callable, Generator, Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, cast
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

import contexts
from configs import dify_config
from core.app.entities.app_invoke_entities import InvokeFrom
from core.datasource.datasource_manager import DatasourceManager
from core.datasource.entities.datasource_entities import (
    DatasourceMessage,
    DatasourceProviderType,
    GetOnlineDocumentPageContentRequest,
    OnlineDocumentPagesMessage,
    OnlineDriveBrowseFilesRequest,
    OnlineDriveBrowseFilesResponse,
    WebsiteCrawlMessage,
)
from core.datasource.online_document.online_document_plugin import OnlineDocumentDatasourcePlugin
from core.datasource.online_drive.online_drive_plugin import OnlineDriveDatasourcePlugin
from core.datasource.website_crawl.website_crawl_plugin import WebsiteCrawlDatasourcePlugin
from core.helper import marketplace
from core.rag.entities import DatasourceCompletedEvent, DatasourceErrorEvent, DatasourceProcessingEvent
from core.repositories.factory import DifyCoreRepositoryFactory
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.llm_environment_variable import validate_llm_environment_model_references
from core.workflow.node_factory import LATEST_VERSION, get_node_type_classes_mapping
from core.workflow.system_variables import (
    SystemVariableKey,
    build_bootstrap_variables,
    build_system_variables,
    default_system_variables,
    get_system_segment,
)
from core.workflow.variable_pool_initializer import add_variables_to_pool
from core.workflow.workflow_entry import WorkflowEntry
from enterprise.telemetry.draft_trace import enqueue_draft_node_execution_trace
from extensions.ext_database import db
from graphon.engine_events import NodeEvent, NodeRunFailedEvent, NodeRunSucceededEvent
from graphon.entities import WorkflowNodeExecution
from graphon.enums import BuiltinNodeTypes, ErrorStrategy, NodeType, WorkflowNodeExecutionStatus
from graphon.errors import WorkflowNodeRunFailedError
from graphon.node_events import NodeRunResult
from graphon.nodes.base.node import Node
from graphon.nodes.container_effects import ContainerAwaitRequest
from graphon.nodes.http_request import HTTP_REQUEST_CONFIG_FILTER_KEY, build_http_request_config
from graphon.runtime import VariablePool
from graphon.variables.variables import Variable, VariableBase
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from libs.login import resolve_account_fallback, resolve_tenant_id_fallback
from models import Account
from models.dataset import (  # type: ignore
    Dataset,
    Pipeline,
    PipelineCustomizedTemplate,
    PipelineRecommendedPlugin,
)
from models.enums import IndexingStatus, WorkflowRunTriggeredFrom
from models.model import EndUser
from models.workflow import (
    Workflow,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowType,
)
from repositories.factory import DifyAPIRepositoryFactory
from repositories.knowledge.document_query_repository import get_documents_by_ids
from services.entities.knowledge_entities.rag_pipeline_entities import (
    PipelineTemplateInfoEntity,
)
from services.errors.app import IsDraftWorkflowError, WorkflowHashNotEqualError, WorkflowNotFoundError
from services.errors.rag_pipeline import RagPipelineResourceNotFoundError
from services.knowledge.entities.pipeline_workflows import PreparedDatasourceWorkflowNode
from services.rag_pipeline.pipeline_template.pipeline_template_factory import PipelineTemplateRetrievalFactory
from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelineDslService
from services.tools.builtin_tools_manage_service import BuiltinToolManageService
from services.workflow_draft_variable_service import DraftVariableSaver, DraftVarLoader
from services.workflow_node_execution_trace_service import (
    WorkflowNodeExecutionTrace,
    assemble_workflow_node_execution_traces,
)
from services.workflow_ref_service import WorkflowRef
from services.workflow_restore import apply_published_workflow_snapshot_to_draft
from services.workflow_run_agg import WorkflowRunAgg

logger = logging.getLogger(__name__)


def _build_seeded_variable_pool(variables: Sequence[Variable]) -> VariablePool:
    variable_pool = VariablePool()
    add_variables_to_pool(variable_pool, variables)
    return variable_pool


class RagPipelineService:
    _session: Session

    def __init__(self, session: Session, session_maker: sessionmaker | None = None):
        """Initialize RagPipelineService with repository dependencies."""
        self._session = session
        if session_maker is None:
            session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
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
        # fetch draft workflow by rag pipeline
        workflow = self._session.scalar(
            select(Workflow)
            .where(
                Workflow.tenant_id == pipeline.tenant_id,
                Workflow.app_id == pipeline.id,
                Workflow.version == "draft",
            )
            .limit(1)
        )

        # return draft workflow
        return workflow

    def get_published_workflow(self, pipeline: Pipeline) -> Workflow | None:
        """
        Get published workflow
        """

        if not pipeline.workflow_id:
            return None

        # fetch published workflow by workflow_id
        workflow = self._session.scalar(
            select(Workflow)
            .where(
                Workflow.tenant_id == pipeline.tenant_id,
                Workflow.app_id == pipeline.id,
                Workflow.id == pipeline.workflow_id,
            )
            .limit(1)
        )

        return workflow

    def get_published_workflow_by_id(self, pipeline: Pipeline, workflow_id: str) -> Workflow | None:
        """Fetch and lock a published Workflow snapshot for restoration.

        The source lock is held until the service transaction ends, preventing
        concurrent deletion while restore copies its Workflow snapshot fields.
        """
        workflow = self._session.scalar(
            select(Workflow)
            .where(
                Workflow.tenant_id == pipeline.tenant_id,
                Workflow.app_id == pipeline.id,
                Workflow.id == workflow_id,
            )
            .limit(1)
            .with_for_update()
        )
        if workflow and workflow.version == Workflow.VERSION_DRAFT:
            raise IsDraftWorkflowError("source workflow must be published")
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
        graph: dict[str, Any],
        unique_hash: str | None,
        account: Account,
        environment_variables: Sequence[VariableBase],
        conversation_variables: Sequence[VariableBase],
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
            self._session.add(workflow)
            self._session.flush()
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
        self._session.commit()

        # trigger  workflow events TODO
        # app_draft_workflow_was_synced.send(pipeline, synced_draft_workflow=workflow)

        # return draft workflow
        return workflow

    def restore_published_workflow_to_draft(
        self,
        *,
        pipeline: Pipeline,
        workflow_id: str,
        account: Account,
    ) -> Workflow:
        """Restore a published pipeline workflow snapshot into the draft workflow.

        Pipelines reuse the shared draft-restore field copy helper, but still own
        the pipeline-specific flush/link step that wires a newly created draft
        back onto ``pipeline.workflow_id``. The source version remains locked
        through snapshot-field copy and commit.
        """
        source_workflow = self.get_published_workflow_by_id(pipeline=pipeline, workflow_id=workflow_id)
        if not source_workflow:
            raise WorkflowNotFoundError("Workflow not found.")

        draft_workflow = self.get_draft_workflow(pipeline=pipeline)
        draft_workflow, is_new_draft = apply_published_workflow_snapshot_to_draft(
            tenant_id=pipeline.tenant_id,
            app_id=pipeline.id,
            source_workflow=source_workflow,
            draft_workflow=draft_workflow,
            account=account,
            updated_at_factory=lambda: datetime.now(UTC).replace(tzinfo=None),
        )

        if is_new_draft:
            self._session.add(draft_workflow)
            self._session.flush()
            pipeline.workflow_id = draft_workflow.id

        self._session.commit()

        return draft_workflow

    def publish_workflow(
        self,
        *,
        session: Session,
        pipeline: Pipeline,
        account: Account,
    ) -> Workflow:
        draft_workflow_stmt = select(Workflow).where(
            Workflow.tenant_id == pipeline.tenant_id,
            Workflow.app_id == pipeline.id,
            Workflow.version == "draft",
        )
        draft_workflow = session.scalar(draft_workflow_stmt)
        if not draft_workflow:
            raise ValueError("No valid workflow found.")

        validate_llm_environment_model_references(
            graph=draft_workflow.graph_dict,
            environment_variables=draft_workflow.environment_variables,
        )

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
            rag_pipeline_variables=draft_workflow.rag_pipeline_variables,
            marked_name="",
            marked_comment="",
        )
        # commit db session changes
        session.add(workflow)
        # return new workflow
        return workflow

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

    def run_draft_workflow_node(
        self, pipeline: Pipeline, node_id: str, user_inputs: dict[str, Any], account: Account
    ) -> WorkflowNodeExecutionModel | None:
        """
        Run draft workflow node
        """
        # fetch draft workflow by app_model
        draft_workflow = self.get_draft_workflow(pipeline=pipeline)
        if not draft_workflow:
            raise ValueError("Workflow not initialized")

        # run draft workflow node
        start_at = time.perf_counter()
        node_config = draft_workflow.get_node_config_by_id(node_id)

        eclosing_node_type_and_id = draft_workflow.get_enclosing_node_type_and_id(node_config)
        if eclosing_node_type_and_id:
            _, enclosing_node_id = eclosing_node_type_and_id
        else:
            enclosing_node_id = None

        workflow_node_execution = self._handle_node_run_result(
            getter=lambda: WorkflowEntry.single_step_run(
                execution_driver=WorkflowRunAgg.run,
                workflow=draft_workflow,
                node_id=node_id,
                user_inputs=user_inputs,
                user_id=account.id,
                variable_pool=_build_seeded_variable_pool(
                    build_bootstrap_variables(
                        system_variables=default_system_variables(),
                        environment_variables=draft_workflow.environment_variables,
                    )
                ),
                variable_loader=DraftVarLoader(
                    engine=db.engine,
                    app_id=pipeline.id,
                    tenant_id=pipeline.tenant_id,
                    user_id=account.id,
                ),
            ),
            start_at=start_at,
            tenant_id=pipeline.tenant_id,
            node_id=node_id,
        )
        workflow_node_execution.workflow_id = draft_workflow.id

        # Create repository and save the node execution

        repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
            session_factory=db.engine,
            tenant_id=pipeline.tenant_id,
            user=account,
            app_id=pipeline.id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
        )
        repository.save(workflow_node_execution)

        # Convert node_execution to WorkflowNodeExecution after save
        workflow_node_execution_db_model = self._node_execution_service_repo.get_execution_by_id(
            workflow_node_execution.id
        )

        with sessionmaker(bind=db.engine).begin() as session:
            draft_var_saver = DraftVariableSaver(
                session=session,
                tenant_id=pipeline.tenant_id,
                app_id=pipeline.id,
                node_id=workflow_node_execution.node_id,
                node_type=workflow_node_execution.node_type,
                enclosing_node_id=enclosing_node_id,
                node_execution_id=workflow_node_execution.id,
                user=account,
            )
            draft_var_saver.save(
                process_data=workflow_node_execution.process_data,
                outputs=workflow_node_execution.outputs,
            )
        if isinstance(workflow_node_execution_db_model, WorkflowNodeExecutionModel):
            enqueue_draft_node_execution_trace(
                execution=workflow_node_execution_db_model,
                outputs=workflow_node_execution.outputs,
                workflow_execution_id=None,
                user_id=account.id,
            )
        return workflow_node_execution_db_model

    def prepare_datasource_workflow_node(
        self,
        *,
        pipeline: Pipeline,
        workflow: Workflow,
        node_id: str,
        user_inputs: Mapping[str, Any],
        account: Account,
        datasource_type: str,
        credential_id: str | None,
    ) -> PreparedDatasourceWorkflowNode:
        """Load and detach all database state needed by datasource provider execution."""
        datasource_node_data = next(
            (node.get("data", {}) for node in workflow.graph_dict.get("nodes", []) if node.get("id") == node_id),
            None,
        )
        if not datasource_node_data:
            raise ValueError("Datasource node data not found")
        plugin_id = datasource_node_data.get("plugin_id")
        provider_name = datasource_node_data.get("provider_name")
        datasource_name = datasource_node_data.get("datasource_name")
        if not isinstance(plugin_id, str) or not plugin_id:
            raise ValueError("Datasource plugin id is required")
        if not isinstance(provider_name, str) or not provider_name:
            raise ValueError("Datasource provider name is required")
        if not isinstance(datasource_name, str) or not datasource_name:
            raise ValueError("Datasource name is required")

        variables_map: dict[str, Any] = {}
        for key, value in datasource_node_data.get("datasource_parameters", {}).items():
            param_value = value.get("value")
            match param_value:
                case None | "" | [] | {}:
                    variables_map[key] = param_value
                case str():
                    pattern = r"\{\{#([a-zA-Z0-9_]{1,50}(?:\.[a-zA-Z0-9_][a-zA-Z0-9_]{0,29}){1,10})#\}\}"
                    match_result = re.match(pattern, param_value)
                    if match_result:
                        variables_map[key] = user_inputs.get(match_result.group(1).split(".")[-1], param_value)
                    else:
                        variables_map[key] = param_value
                case list() if param_value:
                    variables_map[key] = user_inputs.get(param_value[-1], param_value)
                case _:
                    variables_map[key] = param_value

        return PreparedDatasourceWorkflowNode(
            tenant_id=pipeline.tenant_id,
            account_id=account.id,
            plugin_id=plugin_id,
            provider_name=provider_name,
            datasource_name=datasource_name,
            variables_map=variables_map,
            user_inputs=dict(user_inputs),
            datasource_type=datasource_type,
            credential_id=credential_id,
        )

    @staticmethod
    def run_prepared_datasource_workflow_node(
        prepared: PreparedDatasourceWorkflowNode,
        *,
        credentials: Mapping[str, object],
    ) -> Generator[Mapping[str, Any]]:
        """Execute provider I/O from detached values only."""
        try:
            datasource_runtime = DatasourceManager.get_datasource_runtime(
                provider_id=f"{prepared.plugin_id}/{prepared.provider_name}",
                datasource_name=prepared.datasource_name,
                tenant_id=prepared.tenant_id,
                datasource_type=DatasourceProviderType(prepared.datasource_type),
            )
            if credentials:
                datasource_runtime.runtime.credentials = dict(credentials)
            match prepared.datasource_type:
                case DatasourceProviderType.ONLINE_DOCUMENT:
                    datasource_runtime = cast(OnlineDocumentDatasourcePlugin, datasource_runtime)
                    online_document_result: Generator[OnlineDocumentPagesMessage] = (
                        datasource_runtime.get_online_document_pages(
                            user_id=prepared.account_id,
                            datasource_parameters=dict(prepared.user_inputs),
                            provider_type=datasource_runtime.datasource_provider_type(),
                        )
                    )
                    start_time = time.time()
                    start_event = DatasourceProcessingEvent(
                        total=0,
                        completed=0,
                    )
                    yield start_event.model_dump()
                    try:
                        for online_document_message in online_document_result:
                            end_time = time.time()
                            online_document_event = DatasourceCompletedEvent(
                                data=online_document_message.result, time_consuming=round(end_time - start_time, 2)
                            )
                            yield online_document_event.model_dump()
                    except Exception as e:
                        logger.exception("Error during online document.")
                        yield DatasourceErrorEvent(error=str(e)).model_dump()
                case DatasourceProviderType.ONLINE_DRIVE:
                    datasource_runtime = cast(OnlineDriveDatasourcePlugin, datasource_runtime)
                    online_drive_result: Generator[OnlineDriveBrowseFilesResponse] = (
                        datasource_runtime.online_drive_browse_files(
                            user_id=prepared.account_id,
                            request=OnlineDriveBrowseFilesRequest(
                                bucket=prepared.user_inputs.get("bucket"),
                                prefix=prepared.user_inputs.get("prefix", ""),
                                max_keys=prepared.user_inputs.get("max_keys", 20),
                                next_page_parameters=prepared.user_inputs.get("next_page_parameters"),
                            ),
                            provider_type=datasource_runtime.datasource_provider_type(),
                        )
                    )
                    start_time = time.time()
                    start_event = DatasourceProcessingEvent(
                        total=0,
                        completed=0,
                    )
                    yield start_event.model_dump()
                    for online_drive_message in online_drive_result:
                        end_time = time.time()
                        online_drive_event = DatasourceCompletedEvent(
                            data=online_drive_message.result,
                            time_consuming=round(end_time - start_time, 2),
                            total=None,
                            completed=None,
                        )
                        yield online_drive_event.model_dump()
                case DatasourceProviderType.WEBSITE_CRAWL:
                    datasource_runtime = cast(WebsiteCrawlDatasourcePlugin, datasource_runtime)
                    website_crawl_result: Generator[WebsiteCrawlMessage] = datasource_runtime.get_website_crawl(
                        user_id=prepared.account_id,
                        datasource_parameters=dict(prepared.variables_map),
                        provider_type=datasource_runtime.datasource_provider_type(),
                    )
                    start_time = time.time()
                    try:
                        for website_crawl_message in website_crawl_result:
                            end_time = time.time()
                            crawl_event: DatasourceCompletedEvent | DatasourceProcessingEvent
                            if website_crawl_message.result.status == "completed":
                                crawl_event = DatasourceCompletedEvent(
                                    data=website_crawl_message.result.web_info_list or [],
                                    total=website_crawl_message.result.total,
                                    completed=website_crawl_message.result.completed,
                                    time_consuming=round(end_time - start_time, 2),
                                )
                            else:
                                crawl_event = DatasourceProcessingEvent(
                                    total=website_crawl_message.result.total,
                                    completed=website_crawl_message.result.completed,
                                )
                            yield crawl_event.model_dump()
                    except Exception as e:
                        logger.exception("Error during website crawl.")
                        yield DatasourceErrorEvent(error=str(e)).model_dump()
                case _:
                    raise ValueError(f"Unsupported datasource provider: {datasource_runtime.datasource_provider_type}")
        except Exception as e:
            logger.exception("Error in run_datasource_workflow_node.")
            yield DatasourceErrorEvent(error=str(e)).model_dump()

    @staticmethod
    def preview_prepared_datasource_workflow_node(
        prepared: PreparedDatasourceWorkflowNode,
        *,
        credentials: Mapping[str, object],
    ) -> Mapping[str, Any]:
        """Read datasource content using an actor-authorized credential and detached workflow values."""
        try:
            datasource_runtime = DatasourceManager.get_datasource_runtime(
                provider_id=f"{prepared.plugin_id}/{prepared.provider_name}",
                datasource_name=prepared.datasource_name,
                tenant_id=prepared.tenant_id,
                datasource_type=DatasourceProviderType(prepared.datasource_type),
            )
            if credentials:
                datasource_runtime.runtime.credentials = dict(credentials)
            inputs = {**prepared.variables_map, **prepared.user_inputs}
            match prepared.datasource_type:
                case DatasourceProviderType.ONLINE_DOCUMENT:
                    datasource_runtime = cast(OnlineDocumentDatasourcePlugin, datasource_runtime)
                    online_document_result: Generator[DatasourceMessage] = (
                        datasource_runtime.get_online_document_page_content(
                            user_id=prepared.account_id,
                            datasource_parameters=GetOnlineDocumentPageContentRequest(
                                workspace_id=inputs.get("workspace_id", ""),
                                page_id=inputs.get("page_id", ""),
                                type=inputs.get("type", ""),
                            ),
                            provider_type=prepared.datasource_type,
                        )
                    )
                    try:
                        variables: dict[str, Any] = {}
                        for online_document_message in online_document_result:
                            if online_document_message.type == DatasourceMessage.MessageType.VARIABLE:
                                assert isinstance(online_document_message.message, DatasourceMessage.VariableMessage)
                                variable_name = online_document_message.message.variable_name
                                variable_value = online_document_message.message.variable_value
                                if online_document_message.message.stream:
                                    if not isinstance(variable_value, str):
                                        raise ValueError("When 'stream' is True, 'variable_value' must be a string.")
                                    if variable_name not in variables:
                                        variables[variable_name] = ""
                                    variables[variable_name] += variable_value
                                else:
                                    variables[variable_name] = variable_value
                        return variables
                    except Exception as e:
                        logger.exception("Error during get online document content.")
                        raise RuntimeError(str(e)) from e
                # TODO Online Drive
                case _:
                    raise ValueError(f"Unsupported datasource provider: {datasource_runtime.datasource_provider_type}")
        except Exception as e:
            logger.exception("Error in preview_prepared_datasource_workflow_node.")
            raise RuntimeError(str(e)) from e

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
        getter: Callable[
            [],
            tuple[Node, Generator[NodeEvent | ContainerAwaitRequest]],
        ],
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
                if isinstance(event, (NodeRunSucceededEvent, NodeRunFailedEvent)):
                    node_run_result = event.node_run_result
                    if node_run_result:
                        # sign output files
                        node_run_result.outputs = WorkflowEntry.handle_special_values(node_run_result.outputs) or {}
                    break

            if not node_run_result:
                raise ValueError("Node run failed with no run result")
            # single step debug mode error handling return
            if node_run_result.status == WorkflowNodeExecutionStatus.FAILED and node_instance.error_strategy:
                node_error_args: dict[str, Any] = {
                    "status": WorkflowNodeExecutionStatus.EXCEPTION,
                    "error": node_run_result.error,
                    "inputs": node_run_result.inputs,
                    "metadata": {"error_strategy": node_instance.error_strategy},
                }
                if node_instance.error_strategy is ErrorStrategy.DEFAULT_VALUE:
                    node_run_result = NodeRunResult(
                        **node_error_args,
                        outputs={
                            **node_instance.default_value_dict,
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
            node_instance = e._node  # type: ignore
            run_succeeded = False
            node_run_result = None
            error = e._error  # type: ignore

        workflow_node_execution = WorkflowNodeExecution(
            id=str(uuid4()),
            workflow_id=node_instance.workflow_id,
            index=1,
            node_id=node_id,
            node_type=node_instance.node_type,
            title=node_instance.title,
            elapsed_time=time.perf_counter() - start_at,
            finished_at=datetime.now(UTC).replace(tzinfo=None),
            created_at=datetime.now(UTC).replace(tzinfo=None),
        )
        if run_succeeded and node_run_result:
            # create workflow node execution
            inputs = WorkflowEntry.handle_special_values(node_run_result.inputs) if node_run_result.inputs else None
            process_data = (
                WorkflowEntry.handle_special_values(node_run_result.process_data)
                if node_run_result.process_data
                else None
            )
            outputs = WorkflowEntry.handle_special_values(node_run_result.outputs) if node_run_result.outputs else None

            workflow_node_execution.inputs = inputs
            workflow_node_execution.process_data = process_data
            workflow_node_execution.outputs = outputs
            workflow_node_execution.metadata = node_run_result.metadata
            if node_run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED:
                workflow_node_execution.status = WorkflowNodeExecutionStatus.SUCCEEDED
            elif node_run_result.status == WorkflowNodeExecutionStatus.EXCEPTION:
                workflow_node_execution.status = WorkflowNodeExecutionStatus.EXCEPTION
                workflow_node_execution.error = node_run_result.error
        else:
            # create workflow node execution
            workflow_node_execution.status = WorkflowNodeExecutionStatus.FAILED
            workflow_node_execution.error = error
            # update document status
            variable_pool = node_instance.runtime_state.variable_pool
            invoke_from = get_system_segment(variable_pool, SystemVariableKey.INVOKE_FROM)
            if invoke_from:
                if invoke_from.value == InvokeFrom.PUBLISHED_PIPELINE:
                    document_id = get_system_segment(variable_pool, SystemVariableKey.DOCUMENT_ID)
                    dataset_id = get_system_segment(variable_pool, SystemVariableKey.DATASET_ID)
                    pipeline_id = get_system_segment(variable_pool, SystemVariableKey.APP_ID)
                    if document_id and dataset_id and pipeline_id:
                        dataset = self._session.scalar(
                            select(Dataset)
                            .where(
                                Dataset.id == dataset_id.value,
                                Dataset.tenant_id == tenant_id,
                                Dataset.pipeline_id == pipeline_id.value,
                            )
                            .limit(1)
                        )
                        if dataset:
                            document = next(
                                iter(
                                    get_documents_by_ids(
                                        self._session,
                                        tenant_id=dataset.tenant_id,
                                        dataset_id=dataset.id,
                                        document_ids=[document_id.value],
                                    )
                                ),
                                None,
                            )
                            if document:
                                document.indexing_status = IndexingStatus.ERROR
                                document.error = error
                                self._session.add(document)
                                self._session.commit()

        return workflow_node_execution

    def update_workflow(
        self,
        *,
        session: Session,
        account_id: str,
        data: dict[str, Any],
        workflow_ref: WorkflowRef,
    ) -> Workflow | None:
        """
        Update workflow attributes

        :param session: SQLAlchemy database session
        :param account_id: Account ID (for permission check)
        :param data: Dictionary containing fields to update
        :param workflow_ref: Owner-bound workflow reference
        :return: Updated workflow or None if not found
        """
        stmt = select(Workflow).where(
            Workflow.id == workflow_ref.workflow_id,
            Workflow.tenant_id == workflow_ref.tenant_id,
            Workflow.app_id == workflow_ref.owner_id,
        )
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
        self,
        pipeline: Pipeline,
        run_id: str,
        user: Account | EndUser,
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
            node_executions, self._node_execution_service_repo, session=self._session
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

    def is_workflow_exist(self, pipeline: Pipeline) -> bool:
        return (
            self._session.scalar(
                select(func.count(Workflow.id)).where(
                    Workflow.tenant_id == pipeline.tenant_id,
                    Workflow.app_id == pipeline.id,
                    Workflow.version == Workflow.VERSION_DRAFT,
                )
            )
            or 0
        ) > 0

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

    def set_datasource_variables(self, pipeline: Pipeline, args: dict[str, Any], current_user: Account):
        """
        Set datasource variables
        """

        # fetch draft workflow by app_model
        draft_workflow = self.get_draft_workflow(pipeline=pipeline)
        if not draft_workflow:
            raise ValueError("Workflow not initialized")

        # run draft workflow node
        start_at = time.perf_counter()
        node_id = args.get("start_node_id")
        if not node_id:
            raise ValueError("Node id is required")
        node_config = draft_workflow.get_node_config_by_id(node_id)

        eclosing_node_type_and_id = draft_workflow.get_enclosing_node_type_and_id(node_config)
        if eclosing_node_type_and_id:
            _, enclosing_node_id = eclosing_node_type_and_id
        else:
            enclosing_node_id = None

        system_inputs = build_system_variables(
            datasource_type=args.get("datasource_type", "online_document"),
            datasource_info=args.get("datasource_info", {}),
        )

        workflow_node_execution = self._handle_node_run_result(
            getter=lambda: WorkflowEntry.single_step_run(
                execution_driver=WorkflowRunAgg.run,
                workflow=draft_workflow,
                node_id=node_id,
                user_inputs={},
                user_id=current_user.id,
                variable_pool=_build_seeded_variable_pool(
                    build_bootstrap_variables(
                        system_variables=system_inputs,
                        rag_pipeline_variables=(),
                    )
                ),
                variable_loader=DraftVarLoader(
                    engine=db.engine,
                    app_id=pipeline.id,
                    tenant_id=pipeline.tenant_id,
                    user_id=current_user.id,
                ),
            ),
            start_at=start_at,
            tenant_id=pipeline.tenant_id,
            node_id=node_id,
        )
        workflow_node_execution.workflow_id = draft_workflow.id

        # Create repository and save the node execution
        repository = SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=db.engine,
            tenant_id=pipeline.tenant_id,
            user=current_user,
            app_id=pipeline.id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
        )
        repository.save(workflow_node_execution)

        # Convert node_execution to WorkflowNodeExecution after save
        workflow_node_execution_db_model = repository._to_db_model(workflow_node_execution)  # type: ignore

        with sessionmaker(bind=db.engine).begin() as session:
            draft_var_saver = DraftVariableSaver(
                session=session,
                tenant_id=pipeline.tenant_id,
                app_id=pipeline.id,
                node_id=workflow_node_execution_db_model.node_id,
                node_type=workflow_node_execution_db_model.node_type,
                enclosing_node_id=enclosing_node_id,
                node_execution_id=workflow_node_execution.id,
                user=current_user,
            )
            draft_var_saver.save(
                process_data=workflow_node_execution.process_data,
                outputs=workflow_node_execution.outputs,
            )
        enqueue_draft_node_execution_trace(
            execution=workflow_node_execution_db_model,
            outputs=workflow_node_execution.outputs,
            workflow_execution_id=None,
            user_id=current_user.id,
        )
        return workflow_node_execution_db_model

    def _fetch_recommended_plugin_manifests(self, plugin_ids: list[str]) -> list[Any]:
        if not dify_config.MARKETPLACE_ENABLED:
            logger.info("Marketplace disabled; recommended-plugins list empty")
            return []
        return marketplace.batch_fetch_plugin_by_ids(plugin_ids)

    def get_recommended_plugins(self, type: str, current_user: Account, current_tenant_id: str) -> dict[str, Any]:
        # Query active recommended plugins
        stmt = select(PipelineRecommendedPlugin).where(PipelineRecommendedPlugin.active.is_(True))
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
            user_id=current_user.id,
            tenant_id=current_tenant_id,
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

    def get_datasource_plugin_specs(
        self,
        tenant_id: str,
        dataset_id: str,
        is_published: bool,
    ) -> list[dict]:
        """Load detached datasource plugin configuration without provider I/O."""
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

        return self.datasource_plugin_specs(workflow)

    @staticmethod
    def datasource_plugin_specs(workflow: Workflow) -> list[dict[str, Any]]:
        """Read datasource plugin identities from one fixed workflow snapshot."""
        datasource_nodes = workflow.graph_dict.get("nodes", [])
        datasource_plugins = []
        for datasource_node in datasource_nodes:
            if datasource_node.get("data", {}).get("type") == "datasource":
                datasource_node_data = datasource_node["data"]
                if not datasource_node_data:
                    continue

                variables = workflow.rag_pipeline_variables
                variables_map = {item["variable"]: item for item in variables} if variables else {}

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

                datasource_plugins.append(
                    {
                        "node_id": datasource_node.get("id"),
                        "plugin_id": datasource_node_data.get("plugin_id"),
                        "provider_name": datasource_node_data.get("provider_name"),
                        "datasource_type": datasource_node_data.get("provider_type"),
                        "credential_id": datasource_node_data.get("credential_id"),
                        "title": datasource_node_data.get("title"),
                        "user_input_variables": user_input_variables,
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
