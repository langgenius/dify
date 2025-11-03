import json
import logging
import re
import threading
import time
from collections.abc import Callable, Generator, Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, Union, cast
from uuid import uuid4

from flask_login import current_user
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

import contexts
from configs import dify_config
from core.app.apps.pipeline.pipeline_generator import PipelineGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
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
from core.rag.entities.event import (
    DatasourceCompletedEvent,
    DatasourceErrorEvent,
    DatasourceProcessingEvent,
)
from core.repositories.factory import DifyCoreRepositoryFactory
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.variables.variables import Variable
from core.workflow.entities.workflow_node_execution import (
    WorkflowNodeExecution,
    WorkflowNodeExecutionStatus,
)
from core.workflow.enums import ErrorStrategy, NodeType, SystemVariableKey
from core.workflow.errors import WorkflowNodeRunFailedError
from core.workflow.graph_events import NodeRunFailedEvent, NodeRunSucceededEvent
from core.workflow.graph_events.base import GraphNodeEventBase
from core.workflow.node_events.base import NodeRunResult
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.node_mapping import LATEST_VERSION, NODE_TYPE_CLASSES_MAPPING
from core.workflow.repositories.workflow_node_execution_repository import OrderConfig
from core.workflow.runtime import VariablePool
from core.workflow.system_variable import SystemVariable
from core.workflow.workflow_entry import WorkflowEntry
from extensions.ext_database import db
from libs.infinite_scroll_pagination import InfiniteScrollPagination
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
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowType,
)
from repositories.factory import DifyAPIRepositoryFactory
from services.datasource_provider_service import DatasourceProviderService
from services.entities.knowledge_entities.rag_pipeline_entities import (
    KnowledgeConfiguration,
    PipelineTemplateInfoEntity,
)
from services.errors.app import WorkflowHashNotEqualError
from services.rag_pipeline.pipeline_template.pipeline_template_factory import PipelineTemplateRetrievalFactory
from services.tools.builtin_tools_manage_service import BuiltinToolManageService
from services.workflow_draft_variable_service import DraftVariableSaver, DraftVarLoader

logger = logging.getLogger(__name__)


class RagPipelineService:
    def __init__(self, session_maker: sessionmaker | None = None):
        """Initialize RagPipelineService with repository dependencies."""
        if session_maker is None:
            session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        self._node_execution_service_repo = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
            session_maker
        )
        self._workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)

    @classmethod
    def get_pipeline_templates(cls, type: str = "built-in", language: str = "en-US") -> dict:
        if type == "built-in":
            mode = dify_config.HOSTED_FETCH_PIPELINE_TEMPLATES_MODE
            retrieval_instance = PipelineTemplateRetrievalFactory.get_pipeline_template_factory(mode)()
            result = retrieval_instance.get_pipeline_templates(language)
            if not result.get("pipeline_templates") and language != "en-US":
                template_retrieval = PipelineTemplateRetrievalFactory.get_built_in_pipeline_template_retrieval()
                result = template_retrieval.fetch_pipeline_templates_from_builtin("en-US")
            return result
        else:
            mode = "customized"
            retrieval_instance = PipelineTemplateRetrievalFactory.get_pipeline_template_factory(mode)()
            result = retrieval_instance.get_pipeline_templates(language)
            return result

    @classmethod
    def get_pipeline_template_detail(cls, template_id: str, type: str = "built-in") -> dict | None:
        """
        Get pipeline template detail.
        :param template_id: template id
        :return:
        """
        if type == "built-in":
            mode = dify_config.HOSTED_FETCH_PIPELINE_TEMPLATES_MODE
            retrieval_instance = PipelineTemplateRetrievalFactory.get_pipeline_template_factory(mode)()
            built_in_result: dict | None = retrieval_instance.get_pipeline_template_detail(template_id)
            return built_in_result
        else:
            mode = "customized"
            retrieval_instance = PipelineTemplateRetrievalFactory.get_pipeline_template_factory(mode)()
            customized_result: dict | None = retrieval_instance.get_pipeline_template_detail(template_id)
            return customized_result

    @classmethod
    def update_customized_pipeline_template(cls, template_id: str, template_info: PipelineTemplateInfoEntity):
        """
        Update pipeline template.
        :param template_id: template id
        :param template_info: template info
        """
        customized_template: PipelineCustomizedTemplate | None = (
            db.session.query(PipelineCustomizedTemplate)
            .where(
                PipelineCustomizedTemplate.id == template_id,
                PipelineCustomizedTemplate.tenant_id == current_user.current_tenant_id,
            )
            .first()
        )
        if not customized_template:
            raise ValueError("Customized pipeline template not found.")
        # check template name is exist
        template_name = template_info.name
        if template_name:
            template = (
                db.session.query(PipelineCustomizedTemplate)
                .where(
                    PipelineCustomizedTemplate.name == template_name,
                    PipelineCustomizedTemplate.tenant_id == current_user.current_tenant_id,
                    PipelineCustomizedTemplate.id != template_id,
                )
                .first()
            )
            if template:
                raise ValueError("Template name is already exists")
        customized_template.name = template_info.name
        customized_template.description = template_info.description
        customized_template.icon = template_info.icon_info.model_dump()
        customized_template.updated_by = current_user.id
        db.session.commit()
        return customized_template

    @classmethod
    def delete_customized_pipeline_template(cls, template_id: str):
        """
        Delete customized pipeline template.
        """
        customized_template: PipelineCustomizedTemplate | None = (
            db.session.query(PipelineCustomizedTemplate)
            .where(
                PipelineCustomizedTemplate.id == template_id,
                PipelineCustomizedTemplate.tenant_id == current_user.current_tenant_id,
            )
            .first()
        )
        if not customized_template:
            raise ValueError("Customized pipeline template not found.")
        db.session.delete(customized_template)
        db.session.commit()

    def get_draft_workflow(self, pipeline: Pipeline) -> Workflow | None:
        """
        Get draft workflow
        """
        # fetch draft workflow by rag pipeline
        workflow = (
            db.session.query(Workflow)
            .where(
                Workflow.tenant_id == pipeline.tenant_id,
                Workflow.app_id == pipeline.id,
                Workflow.version == "draft",
            )
            .first()
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
        workflow = (
            db.session.query(Workflow)
            .where(
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
        unique_hash: str | None,
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
            rag_pipeline_variables=draft_workflow.rag_pipeline_variables,
            marked_name="",
            marked_comment="",
        )
        # commit db session changes
        session.add(workflow)

        graph = workflow.graph_dict
        nodes = graph.get("nodes", [])
        from services.dataset_service import DatasetService

        for node in nodes:
            if node.get("data", {}).get("type") == "knowledge-index":
                knowledge_configuration = node.get("data", {})
                knowledge_configuration = KnowledgeConfiguration.model_validate(knowledge_configuration)

                # update dataset
                dataset = pipeline.retrieve_dataset(session=session)
                if not dataset:
                    raise ValueError("Dataset not found")
                DatasetService.update_rag_pipeline_dataset_settings(
                    session=session,
                    dataset=dataset,
                    knowledge_configuration=knowledge_configuration,
                    has_published=pipeline.is_published,
                )
        # return new workflow
        return workflow

    def get_default_block_configs(self) -> list[dict]:
        """
        Get default block configs
        """
        # return default block config
        default_block_configs: list[dict[str, Any]] = []
        for node_class_mapping in NODE_TYPE_CLASSES_MAPPING.values():
            node_class = node_class_mapping[LATEST_VERSION]
            default_config = node_class.get_default_config()
            if default_config:
                default_block_configs.append(dict(default_config))

        return default_block_configs

    def get_default_block_config(self, node_type: str, filters: dict | None = None) -> Mapping[str, object] | None:
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
                workflow=draft_workflow,
                node_id=node_id,
                user_inputs=user_inputs,
                user_id=account.id,
                variable_pool=VariablePool(
                    system_variables=SystemVariable.empty(),
                    user_inputs=user_inputs,
                    environment_variables=[],
                    conversation_variables=[],
                    rag_pipeline_variables=[],
                ),
                variable_loader=DraftVarLoader(
                    engine=db.engine,
                    app_id=pipeline.id,
                    tenant_id=pipeline.tenant_id,
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
            user=account,
            app_id=pipeline.id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
        )
        repository.save(workflow_node_execution)

        # Convert node_execution to WorkflowNodeExecution after save
        workflow_node_execution_db_model = self._node_execution_service_repo.get_execution_by_id(
            workflow_node_execution.id
        )

        with Session(bind=db.engine) as session, session.begin():
            draft_var_saver = DraftVariableSaver(
                session=session,
                app_id=pipeline.id,
                node_id=workflow_node_execution.node_id,
                node_type=NodeType(workflow_node_execution.node_type),
                enclosing_node_id=enclosing_node_id,
                node_execution_id=workflow_node_execution.id,
                user=account,
            )
            draft_var_saver.save(
                process_data=workflow_node_execution.process_data,
                outputs=workflow_node_execution.outputs,
            )
            session.commit()
        return workflow_node_execution_db_model

    def run_datasource_workflow_node(
        self,
        pipeline: Pipeline,
        node_id: str,
        user_inputs: dict,
        account: Account,
        datasource_type: str,
        is_published: bool,
        credential_id: str | None = None,
    ) -> Generator[Mapping[str, Any], None, None]:
        """
        Run published workflow datasource
        """
        try:
            if is_published:
                # fetch published workflow by app_model
                workflow = self.get_published_workflow(pipeline=pipeline)
            else:
                workflow = self.get_draft_workflow(pipeline=pipeline)
            if not workflow:
                raise ValueError("Workflow not initialized")

            # run draft workflow node
            datasource_node_data = None
            datasource_nodes = workflow.graph_dict.get("nodes", [])
            for datasource_node in datasource_nodes:
                if datasource_node.get("id") == node_id:
                    datasource_node_data = datasource_node.get("data", {})
                    break
            if not datasource_node_data:
                raise ValueError("Datasource node data not found")

            variables_map = {}

            datasource_parameters = datasource_node_data.get("datasource_parameters", {})
            for key, value in datasource_parameters.items():
                param_value = value.get("value")

                if not param_value:
                    variables_map[key] = param_value
                elif isinstance(param_value, str):
                    # handle string type parameter value, check if it contains variable reference pattern
                    pattern = r"\{\{#([a-zA-Z0-9_]{1,50}(?:\.[a-zA-Z0-9_][a-zA-Z0-9_]{0,29}){1,10})#\}\}"
                    match = re.match(pattern, param_value)
                    if match:
                        # extract variable path and try to get value from user inputs
                        full_path = match.group(1)
                        last_part = full_path.split(".")[-1]
                        variables_map[key] = user_inputs.get(last_part, param_value)
                    else:
                        variables_map[key] = param_value
                elif isinstance(param_value, list) and param_value:
                    # handle list type parameter value, check if the last element is in user inputs
                    last_part = param_value[-1]
                    variables_map[key] = user_inputs.get(last_part, param_value)
                else:
                    # other type directly use original value
                    variables_map[key] = param_value

            from core.datasource.datasource_manager import DatasourceManager

            datasource_runtime = DatasourceManager.get_datasource_runtime(
                provider_id=f"{datasource_node_data.get('plugin_id')}/{datasource_node_data.get('provider_name')}",
                datasource_name=datasource_node_data.get("datasource_name"),
                tenant_id=pipeline.tenant_id,
                datasource_type=DatasourceProviderType(datasource_type),
            )
            datasource_provider_service = DatasourceProviderService()
            credentials = datasource_provider_service.get_datasource_credentials(
                tenant_id=pipeline.tenant_id,
                provider=datasource_node_data.get("provider_name"),
                plugin_id=datasource_node_data.get("plugin_id"),
                credential_id=credential_id,
            )
            if credentials:
                datasource_runtime.runtime.credentials = credentials
            match datasource_type:
                case DatasourceProviderType.ONLINE_DOCUMENT:
                    datasource_runtime = cast(OnlineDocumentDatasourcePlugin, datasource_runtime)
                    online_document_result: Generator[OnlineDocumentPagesMessage, None, None] = (
                        datasource_runtime.get_online_document_pages(
                            user_id=account.id,
                            datasource_parameters=user_inputs,
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
                    online_drive_result: Generator[OnlineDriveBrowseFilesResponse, None, None] = (
                        datasource_runtime.online_drive_browse_files(
                            user_id=account.id,
                            request=OnlineDriveBrowseFilesRequest(
                                bucket=user_inputs.get("bucket"),
                                prefix=user_inputs.get("prefix", ""),
                                max_keys=user_inputs.get("max_keys", 20),
                                next_page_parameters=user_inputs.get("next_page_parameters"),
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
                    website_crawl_result: Generator[WebsiteCrawlMessage, None, None] = (
                        datasource_runtime.get_website_crawl(
                            user_id=account.id,
                            datasource_parameters=variables_map,
                            provider_type=datasource_runtime.datasource_provider_type(),
                        )
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

    def run_datasource_node_preview(
        self,
        pipeline: Pipeline,
        node_id: str,
        user_inputs: dict,
        account: Account,
        datasource_type: str,
        is_published: bool,
        credential_id: str | None = None,
    ) -> Mapping[str, Any]:
        """
        Run published workflow datasource
        """
        try:
            if is_published:
                # fetch published workflow by app_model
                workflow = self.get_published_workflow(pipeline=pipeline)
            else:
                workflow = self.get_draft_workflow(pipeline=pipeline)
            if not workflow:
                raise ValueError("Workflow not initialized")

            # run draft workflow node
            datasource_node_data = None
            datasource_nodes = workflow.graph_dict.get("nodes", [])
            for datasource_node in datasource_nodes:
                if datasource_node.get("id") == node_id:
                    datasource_node_data = datasource_node.get("data", {})
                    break
            if not datasource_node_data:
                raise ValueError("Datasource node data not found")

            datasource_parameters = datasource_node_data.get("datasource_parameters", {})
            for key, value in datasource_parameters.items():
                if not user_inputs.get(key):
                    user_inputs[key] = value["value"]

            from core.datasource.datasource_manager import DatasourceManager

            datasource_runtime = DatasourceManager.get_datasource_runtime(
                provider_id=f"{datasource_node_data.get('plugin_id')}/{datasource_node_data.get('provider_name')}",
                datasource_name=datasource_node_data.get("datasource_name"),
                tenant_id=pipeline.tenant_id,
                datasource_type=DatasourceProviderType(datasource_type),
            )
            datasource_provider_service = DatasourceProviderService()
            credentials = datasource_provider_service.get_datasource_credentials(
                tenant_id=pipeline.tenant_id,
                provider=datasource_node_data.get("provider_name"),
                plugin_id=datasource_node_data.get("plugin_id"),
                credential_id=credential_id,
            )
            if credentials:
                datasource_runtime.runtime.credentials = credentials
            match datasource_type:
                case DatasourceProviderType.ONLINE_DOCUMENT:
                    datasource_runtime = cast(OnlineDocumentDatasourcePlugin, datasource_runtime)
                    online_document_result: Generator[DatasourceMessage, None, None] = (
                        datasource_runtime.get_online_document_page_content(
                            user_id=account.id,
                            datasource_parameters=GetOnlineDocumentPageContentRequest(
                                workspace_id=user_inputs.get("workspace_id", ""),
                                page_id=user_inputs.get("page_id", ""),
                                type=user_inputs.get("type", ""),
                            ),
                            provider_type=datasource_type,
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
                        raise RuntimeError(str(e))
                # TODO Online Drive
                case _:
                    raise ValueError(f"Unsupported datasource provider: {datasource_runtime.datasource_provider_type}")
        except Exception as e:
            logger.exception("Error in run_datasource_node_preview.")
            raise RuntimeError(str(e))

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
        getter: Callable[[], tuple[Node, Generator[GraphNodeEventBase, None, None]]],
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
            variable_pool = node_instance.graph_runtime_state.variable_pool
            invoke_from = variable_pool.get(["sys", SystemVariableKey.INVOKE_FROM])
            if invoke_from:
                if invoke_from.value == InvokeFrom.PUBLISHED:
                    document_id = variable_pool.get(["sys", SystemVariableKey.DOCUMENT_ID])
                    if document_id:
                        document = db.session.query(Document).where(Document.id == document_id.value).first()
                        if document:
                            document.indexing_status = "error"
                            document.error = error
                            db.session.add(document)
                            db.session.commit()

        return workflow_node_execution

    def update_workflow(
        self, *, session: Session, workflow_id: str, tenant_id: str, account_id: str, data: dict
    ) -> Workflow | None:
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

    def get_rag_pipeline_paginate_workflow_runs(self, pipeline: Pipeline, args: dict) -> InfiniteScrollPagination:
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
    ) -> list[WorkflowNodeExecutionModel]:
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
            session_factory=db.engine, app_id=pipeline.id, user=user, triggered_from=None
        )

        # Use the repository to get the node executions with ordering
        order_config = OrderConfig(order_by=["created_at"], order_direction="asc")
        node_executions = repository.get_db_models_by_workflow_run(
            workflow_run_id=run_id,
            order_config=order_config,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.RAG_PIPELINE_RUN,
        )

        return list(node_executions)

    @classmethod
    def publish_customized_pipeline_template(cls, pipeline_id: str, args: dict):
        """
        Publish customized pipeline template
        """
        pipeline = db.session.query(Pipeline).where(Pipeline.id == pipeline_id).first()
        if not pipeline:
            raise ValueError("Pipeline not found")
        if not pipeline.workflow_id:
            raise ValueError("Pipeline workflow not found")
        workflow = db.session.query(Workflow).where(Workflow.id == pipeline.workflow_id).first()
        if not workflow:
            raise ValueError("Workflow not found")
        with Session(db.engine) as session:
            dataset = pipeline.retrieve_dataset(session=session)
            if not dataset:
                raise ValueError("Dataset not found")

        # check template name is exist
        template_name = args.get("name")
        if template_name:
            template = (
                db.session.query(PipelineCustomizedTemplate)
                .where(
                    PipelineCustomizedTemplate.name == template_name,
                    PipelineCustomizedTemplate.tenant_id == pipeline.tenant_id,
                )
                .first()
            )
            if template:
                raise ValueError("Template name is already exists")

        max_position = (
            db.session.query(func.max(PipelineCustomizedTemplate.position))
            .where(PipelineCustomizedTemplate.tenant_id == pipeline.tenant_id)
            .scalar()
        )

        from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelineDslService

        with Session(db.engine) as session:
            rag_pipeline_dsl_service = RagPipelineDslService(session)
            dsl = rag_pipeline_dsl_service.export_rag_pipeline_dsl(pipeline=pipeline, include_secret=True)

        pipeline_customized_template = PipelineCustomizedTemplate(
            name=args.get("name"),
            description=args.get("description"),
            icon=args.get("icon_info"),
            tenant_id=pipeline.tenant_id,
            yaml_content=dsl,
            position=max_position + 1 if max_position else 1,
            chunk_structure=dataset.chunk_structure,
            language="en-US",
            created_by=current_user.id,
        )
        db.session.add(pipeline_customized_template)
        db.session.commit()

    def is_workflow_exist(self, pipeline: Pipeline) -> bool:
        return (
            db.session.query(Workflow)
            .where(
                Workflow.tenant_id == pipeline.tenant_id,
                Workflow.app_id == pipeline.id,
                Workflow.version == Workflow.VERSION_DRAFT,
            )
            .count()
        ) > 0

    def get_node_last_run(
        self, pipeline: Pipeline, workflow: Workflow, node_id: str
    ) -> WorkflowNodeExecutionModel | None:
        node_execution_service_repo = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
            sessionmaker(db.engine)
        )

        node_exec = node_execution_service_repo.get_node_last_execution(
            tenant_id=pipeline.tenant_id,
            app_id=pipeline.id,
            workflow_id=workflow.id,
            node_id=node_id,
        )
        return node_exec

    def set_datasource_variables(self, pipeline: Pipeline, args: dict, current_user: Account):
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

        system_inputs = SystemVariable(
            datasource_type=args.get("datasource_type", "online_document"),
            datasource_info=args.get("datasource_info", {}),
        )

        workflow_node_execution = self._handle_node_run_result(
            getter=lambda: WorkflowEntry.single_step_run(
                workflow=draft_workflow,
                node_id=node_id,
                user_inputs={},
                user_id=current_user.id,
                variable_pool=VariablePool(
                    system_variables=system_inputs,
                    user_inputs={},
                    environment_variables=[],
                    conversation_variables=[],
                    rag_pipeline_variables=[],
                ),
                variable_loader=DraftVarLoader(
                    engine=db.engine,
                    app_id=pipeline.id,
                    tenant_id=pipeline.tenant_id,
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
            user=current_user,
            app_id=pipeline.id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
        )
        repository.save(workflow_node_execution)

        # Convert node_execution to WorkflowNodeExecution after save
        workflow_node_execution_db_model = repository._to_db_model(workflow_node_execution)  # type: ignore

        with Session(bind=db.engine) as session, session.begin():
            draft_var_saver = DraftVariableSaver(
                session=session,
                app_id=pipeline.id,
                node_id=workflow_node_execution_db_model.node_id,
                node_type=NodeType(workflow_node_execution_db_model.node_type),
                enclosing_node_id=enclosing_node_id,
                node_execution_id=workflow_node_execution.id,
                user=current_user,
            )
            draft_var_saver.save(
                process_data=workflow_node_execution.process_data,
                outputs=workflow_node_execution.outputs,
            )
            session.commit()
        return workflow_node_execution_db_model

    def get_recommended_plugins(self) -> dict:
        # Query active recommended plugins
        pipeline_recommended_plugins = (
            db.session.query(PipelineRecommendedPlugin)
            .where(PipelineRecommendedPlugin.active == True)
            .order_by(PipelineRecommendedPlugin.position.asc())
            .all()
        )

        if not pipeline_recommended_plugins:
            return {
                "installed_recommended_plugins": [],
                "uninstalled_recommended_plugins": [],
            }

        # Batch fetch plugin manifests
        plugin_ids = [plugin.plugin_id for plugin in pipeline_recommended_plugins]
        providers = BuiltinToolManageService.list_builtin_tools(
            user_id=current_user.id,
            tenant_id=current_user.current_tenant_id,
        )
        providers_map = {provider.plugin_id: provider.to_dict() for provider in providers}

        plugin_manifests = marketplace.batch_fetch_plugin_by_ids(plugin_ids)
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

    def retry_error_document(self, dataset: Dataset, document: Document, user: Union[Account, EndUser]):
        """
        Retry error document
        """
        document_pipeline_execution_log = (
            db.session.query(DocumentPipelineExecutionLog)
            .where(DocumentPipelineExecutionLog.document_id == document.id)
            .first()
        )
        if not document_pipeline_execution_log:
            raise ValueError("Document pipeline execution log not found")
        pipeline = db.session.query(Pipeline).where(Pipeline.id == document_pipeline_execution_log.pipeline_id).first()
        if not pipeline:
            raise ValueError("Pipeline not found")
        # convert to app config
        workflow = self.get_published_workflow(pipeline)
        if not workflow:
            raise ValueError("Workflow not found")
        PipelineGenerator().generate(
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
            invoke_from=InvokeFrom.PUBLISHED,
            streaming=False,
            call_depth=0,
            workflow_thread_pool_id=None,
            is_retry=True,
        )

    def get_datasource_plugins(self, tenant_id: str, dataset_id: str, is_published: bool) -> list[dict]:
        """
        Get datasource plugins
        """
        dataset: Dataset | None = db.session.query(Dataset).where(Dataset.id == dataset_id).first()
        if not dataset:
            raise ValueError("Dataset not found")
        pipeline: Pipeline | None = db.session.query(Pipeline).where(Pipeline.id == dataset.pipeline_id).first()
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
                datasource_provider_service: DatasourceProviderService = DatasourceProviderService()
                credentials: list[dict[Any, Any]] = datasource_provider_service.list_datasource_credentials(
                    tenant_id=tenant_id,
                    provider=datasource_node_data.get("provider_name"),
                    plugin_id=datasource_node_data.get("plugin_id"),
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
        dataset: Dataset | None = db.session.query(Dataset).where(Dataset.id == dataset_id).first()
        if not dataset:
            raise ValueError("Dataset not found")
        pipeline: Pipeline | None = db.session.query(Pipeline).where(Pipeline.id == dataset.pipeline_id).first()
        if not pipeline:
            raise ValueError("Pipeline not found")
        return pipeline
