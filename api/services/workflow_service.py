import json
import time
import uuid
from collections.abc import Callable, Generator, Mapping, Sequence
from typing import Any, cast

from sqlalchemy import exists, select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.app_config.entities import VariableEntityType
from core.app.apps.advanced_chat.app_config_manager import AdvancedChatAppConfigManager
from core.app.apps.workflow.app_config_manager import WorkflowAppConfigManager
from core.file import File
from core.repositories import DifyCoreRepositoryFactory
from core.variables import VariableBase
from core.variables.variables import Variable
from core.workflow.entities import WorkflowNodeExecution
from core.workflow.enums import ErrorStrategy, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from core.workflow.errors import WorkflowNodeRunFailedError
from core.workflow.graph_events import GraphNodeEventBase, NodeRunFailedEvent, NodeRunSucceededEvent
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes import NodeType
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.node_mapping import LATEST_VERSION, NODE_TYPE_CLASSES_MAPPING
from core.workflow.nodes.start.entities import StartNodeData
from core.workflow.runtime import VariablePool
from core.workflow.system_variable import SystemVariable
from core.workflow.workflow_entry import WorkflowEntry
from enums.cloud_plan import CloudPlan
from events.app_event import app_draft_workflow_was_synced, app_published_workflow_was_updated
from extensions.ext_database import db
from extensions.ext_storage import storage
from factories.file_factory import build_from_mapping, build_from_mappings
from libs.datetime_utils import naive_utc_now
from models import Account
from models.model import App, AppMode
from models.tools import WorkflowToolProvider
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom, WorkflowType
from repositories.factory import DifyAPIRepositoryFactory
from services.billing_service import BillingService
from services.enterprise.plugin_manager_service import PluginCredentialType
from services.errors.app import IsDraftWorkflowError, TriggerNodeLimitExceededError, WorkflowHashNotEqualError
from services.workflow.workflow_converter import WorkflowConverter

from .errors.workflow_service import DraftWorkflowDeletionError, WorkflowInUseError
from .workflow_draft_variable_service import DraftVariableSaver, DraftVarLoader, WorkflowDraftVariableService


class WorkflowService:
    """
    Workflow Service
    """

    def __init__(self, session_maker: sessionmaker | None = None):
        """Initialize WorkflowService with repository dependencies."""
        if session_maker is None:
            session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        self._node_execution_service_repo = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
            session_maker
        )

    def get_node_last_run(self, app_model: App, workflow: Workflow, node_id: str) -> WorkflowNodeExecutionModel | None:
        """
        Get the most recent execution for a specific node.

        Args:
            app_model: The application model
            workflow: The workflow model
            node_id: The node identifier

        Returns:
            The most recent WorkflowNodeExecutionModel for the node, or None if not found
        """
        return self._node_execution_service_repo.get_node_last_execution(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            workflow_id=workflow.id,
            node_id=node_id,
        )

    def is_workflow_exist(self, app_model: App) -> bool:
        stmt = select(
            exists().where(
                Workflow.tenant_id == app_model.tenant_id,
                Workflow.app_id == app_model.id,
                Workflow.version == Workflow.VERSION_DRAFT,
            )
        )
        return db.session.execute(stmt).scalar_one()

    def get_draft_workflow(self, app_model: App, workflow_id: str | None = None) -> Workflow | None:
        """
        Get draft workflow
        """
        if workflow_id:
            return self.get_published_workflow_by_id(app_model, workflow_id)
        # fetch draft workflow by app_model
        workflow = (
            db.session.query(Workflow)
            .where(
                Workflow.tenant_id == app_model.tenant_id,
                Workflow.app_id == app_model.id,
                Workflow.version == Workflow.VERSION_DRAFT,
            )
            .first()
        )

        # return draft workflow
        return workflow

    def get_published_workflow_by_id(self, app_model: App, workflow_id: str) -> Workflow | None:
        """
        fetch published workflow by workflow_id
        """
        workflow = (
            db.session.query(Workflow)
            .where(
                Workflow.tenant_id == app_model.tenant_id,
                Workflow.app_id == app_model.id,
                Workflow.id == workflow_id,
            )
            .first()
        )
        if not workflow:
            return None
        if workflow.version == Workflow.VERSION_DRAFT:
            raise IsDraftWorkflowError(
                f"Cannot use draft workflow version. Workflow ID: {workflow_id}. "
                f"Please use a published workflow version or leave workflow_id empty."
            )
        return workflow

    def get_published_workflow(self, app_model: App) -> Workflow | None:
        """
        Get published workflow
        """

        if not app_model.workflow_id:
            return None

        # fetch published workflow by workflow_id
        workflow = (
            db.session.query(Workflow)
            .where(
                Workflow.tenant_id == app_model.tenant_id,
                Workflow.app_id == app_model.id,
                Workflow.id == app_model.workflow_id,
            )
            .first()
        )

        return workflow

    def get_all_published_workflow(
        self,
        *,
        session: Session,
        app_model: App,
        page: int,
        limit: int,
        user_id: str | None,
        named_only: bool = False,
    ) -> tuple[Sequence[Workflow], bool]:
        """
        Get published workflow with pagination
        """
        if not app_model.workflow_id:
            return [], False

        stmt = (
            select(Workflow)
            .where(Workflow.app_id == app_model.id)
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
        app_model: App,
        graph: dict,
        features: dict,
        unique_hash: str | None,
        account: Account,
        environment_variables: Sequence[VariableBase],
        conversation_variables: Sequence[VariableBase],
    ) -> Workflow:
        """
        Sync draft workflow
        :raises WorkflowHashNotEqualError
        """
        # fetch draft workflow by app_model
        workflow = self.get_draft_workflow(app_model=app_model)

        if workflow and workflow.unique_hash != unique_hash:
            raise WorkflowHashNotEqualError()

        # validate features structure
        self.validate_features_structure(app_model=app_model, features=features)

        # validate graph structure
        self.validate_graph_structure(graph=graph)

        # create draft workflow if not found
        if not workflow:
            workflow = Workflow(
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
                type=WorkflowType.from_app_mode(app_model.mode).value,
                version=Workflow.VERSION_DRAFT,
                graph=json.dumps(graph),
                features=json.dumps(features),
                created_by=account.id,
                environment_variables=environment_variables,
                conversation_variables=conversation_variables,
            )
            db.session.add(workflow)
        # update draft workflow if found
        else:
            workflow.graph = json.dumps(graph)
            workflow.features = json.dumps(features)
            workflow.updated_by = account.id
            workflow.updated_at = naive_utc_now()
            workflow.environment_variables = environment_variables
            workflow.conversation_variables = conversation_variables

        # commit db session changes
        db.session.commit()

        # trigger app workflow events
        app_draft_workflow_was_synced.send(app_model, synced_draft_workflow=workflow)

        # return draft workflow
        return workflow

    def publish_workflow(
        self,
        *,
        session: Session,
        app_model: App,
        account: Account,
        marked_name: str = "",
        marked_comment: str = "",
    ) -> Workflow:
        draft_workflow_stmt = select(Workflow).where(
            Workflow.tenant_id == app_model.tenant_id,
            Workflow.app_id == app_model.id,
            Workflow.version == Workflow.VERSION_DRAFT,
        )
        draft_workflow = session.scalar(draft_workflow_stmt)
        if not draft_workflow:
            raise ValueError("No valid workflow found.")

        # Validate credentials before publishing, for credential policy check
        from services.feature_service import FeatureService

        if FeatureService.get_system_features().plugin_manager.enabled:
            self._validate_workflow_credentials(draft_workflow)

        # validate graph structure
        self.validate_graph_structure(graph=draft_workflow.graph_dict)

        # billing check
        if dify_config.BILLING_ENABLED:
            limit_info = BillingService.get_info(app_model.tenant_id)
            if limit_info["subscription"]["plan"] == CloudPlan.SANDBOX:
                # Check trigger node count limit for SANDBOX plan
                trigger_node_count = sum(
                    1
                    for _, node_data in draft_workflow.walk_nodes()
                    if (node_type_str := node_data.get("type"))
                    and isinstance(node_type_str, str)
                    and NodeType(node_type_str).is_trigger_node
                )
                if trigger_node_count > 2:
                    raise TriggerNodeLimitExceededError(count=trigger_node_count, limit=2)

        # create new workflow
        workflow = Workflow.new(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            type=draft_workflow.type,
            version=Workflow.version_from_datetime(naive_utc_now()),
            graph=draft_workflow.graph,
            created_by=account.id,
            environment_variables=draft_workflow.environment_variables,
            conversation_variables=draft_workflow.conversation_variables,
            marked_name=marked_name,
            marked_comment=marked_comment,
            rag_pipeline_variables=draft_workflow.rag_pipeline_variables,
            features=draft_workflow.features,
        )

        # commit db session changes
        session.add(workflow)

        # trigger app workflow events
        app_published_workflow_was_updated.send(app_model, published_workflow=workflow)

        # return new workflow
        return workflow

    def _validate_workflow_credentials(self, workflow: Workflow) -> None:
        """
        Validate all credentials in workflow nodes before publishing.

        :param workflow: The workflow to validate
        :raises ValueError: If any credentials violate policy compliance
        """
        graph_dict = workflow.graph_dict
        nodes = graph_dict.get("nodes", [])

        for node in nodes:
            node_data = node.get("data", {})
            node_type = node_data.get("type")
            node_id = node.get("id", "unknown")

            try:
                # Extract and validate credentials based on node type
                if node_type == "tool":
                    credential_id = node_data.get("credential_id")
                    provider = node_data.get("provider_id")
                    if provider:
                        if credential_id:
                            # Check specific credential
                            from core.helper.credential_utils import check_credential_policy_compliance

                            check_credential_policy_compliance(
                                credential_id=credential_id,
                                provider=provider,
                                credential_type=PluginCredentialType.TOOL,
                            )
                        else:
                            # Check default workspace credential for this provider
                            self._check_default_tool_credential(workflow.tenant_id, provider)

                elif node_type == "agent":
                    agent_params = node_data.get("agent_parameters", {})

                    model_config = agent_params.get("model", {}).get("value", {})
                    if model_config.get("provider") and model_config.get("model"):
                        self._validate_llm_model_config(
                            workflow.tenant_id, model_config["provider"], model_config["model"]
                        )

                        # Validate load balancing credentials for agent model if load balancing is enabled
                        agent_model_node_data = {"model": model_config}
                        self._validate_load_balancing_credentials(workflow, agent_model_node_data, node_id)

                    # Validate agent tools
                    tools = agent_params.get("tools", {}).get("value", [])
                    for tool in tools:
                        # Agent tools store provider in provider_name field
                        provider = tool.get("provider_name")
                        credential_id = tool.get("credential_id")
                        if provider:
                            if credential_id:
                                from core.helper.credential_utils import check_credential_policy_compliance

                                check_credential_policy_compliance(credential_id, provider, PluginCredentialType.TOOL)
                            else:
                                self._check_default_tool_credential(workflow.tenant_id, provider)

                elif node_type in ["llm", "knowledge_retrieval", "parameter_extractor", "question_classifier"]:
                    model_config = node_data.get("model", {})
                    provider = model_config.get("provider")
                    model_name = model_config.get("name")

                    if provider and model_name:
                        # Validate that the provider+model combination can fetch valid credentials
                        self._validate_llm_model_config(workflow.tenant_id, provider, model_name)
                        # Validate load balancing credentials if load balancing is enabled
                        self._validate_load_balancing_credentials(workflow, node_data, node_id)
                    else:
                        raise ValueError(f"Node {node_id} ({node_type}): Missing provider or model configuration")

            except Exception as e:
                if isinstance(e, ValueError):
                    raise e
                else:
                    raise ValueError(f"Node {node_id} ({node_type}): {str(e)}")

    def _validate_llm_model_config(self, tenant_id: str, provider: str, model_name: str) -> None:
        """
        Validate that an LLM model configuration can fetch valid credentials and has active status.

        This method attempts to get the model instance and validates that:
        1. The provider exists and is configured
        2. The model exists in the provider
        3. Credentials can be fetched for the model
        4. The credentials pass policy compliance checks
        5. The model status is ACTIVE (not NO_CONFIGURE, DISABLED, etc.)

        :param tenant_id: The tenant ID
        :param provider: The provider name
        :param model_name: The model name
        :raises ValueError: If the model configuration is invalid or credentials fail policy checks
        """
        try:
            from core.model_manager import ModelManager
            from core.model_runtime.entities.model_entities import ModelType
            from core.provider_manager import ProviderManager

            # Get model instance to validate provider+model combination
            model_manager = ModelManager()
            model_manager.get_model_instance(
                tenant_id=tenant_id, provider=provider, model_type=ModelType.LLM, model=model_name
            )

            # The ModelInstance constructor will automatically check credential policy compliance
            # via ProviderConfiguration.get_current_credentials() -> _check_credential_policy_compliance()
            # If it fails, an exception will be raised

            # Additionally, check the model status to ensure it's ACTIVE
            provider_manager = ProviderManager()
            provider_configurations = provider_manager.get_configurations(tenant_id)
            models = provider_configurations.get_models(provider=provider, model_type=ModelType.LLM)

            target_model = None
            for model in models:
                if model.model == model_name and model.provider.provider == provider:
                    target_model = model
                    break

            if target_model:
                target_model.raise_for_status()
            else:
                raise ValueError(f"Model {model_name} not found for provider {provider}")

        except Exception as e:
            raise ValueError(
                f"Failed to validate LLM model configuration (provider: {provider}, model: {model_name}): {str(e)}"
            )

    def _check_default_tool_credential(self, tenant_id: str, provider: str) -> None:
        """
        Check credential policy compliance for the default workspace credential of a tool provider.

        This method finds the default credential for the given provider and validates it.
        Uses the same fallback logic as runtime to handle deauthorized credentials.

        :param tenant_id: The tenant ID
        :param provider: The tool provider name
        :raises ValueError: If no default credential exists or if it fails policy compliance
        """
        try:
            from models.tools import BuiltinToolProvider

            # Use the same fallback logic as runtime: get the first available credential
            # ordered by is_default DESC, created_at ASC (same as tool_manager.py)
            default_provider = (
                db.session.query(BuiltinToolProvider)
                .where(
                    BuiltinToolProvider.tenant_id == tenant_id,
                    BuiltinToolProvider.provider == provider,
                )
                .order_by(BuiltinToolProvider.is_default.desc(), BuiltinToolProvider.created_at.asc())
                .first()
            )

            if not default_provider:
                # plugin does not require credentials, skip
                return

            # Check credential policy compliance using the default credential ID
            from core.helper.credential_utils import check_credential_policy_compliance

            check_credential_policy_compliance(
                credential_id=default_provider.id,
                provider=provider,
                credential_type=PluginCredentialType.TOOL,
                check_existence=False,
            )

        except Exception as e:
            raise ValueError(f"Failed to validate default credential for tool provider {provider}: {str(e)}")

    def _validate_load_balancing_credentials(self, workflow: Workflow, node_data: dict, node_id: str) -> None:
        """
        Validate load balancing credentials for a workflow node.

        :param workflow: The workflow being validated
        :param node_data: The node data containing model configuration
        :param node_id: The node ID for error reporting
        :raises ValueError: If load balancing credentials violate policy compliance
        """
        # Extract model configuration
        model_config = node_data.get("model", {})
        provider = model_config.get("provider")
        model_name = model_config.get("name")

        if not provider or not model_name:
            return  # No model config to validate

        # Check if this model has load balancing enabled
        if self._is_load_balancing_enabled(workflow.tenant_id, provider, model_name):
            # Get all load balancing configurations for this model
            load_balancing_configs = self._get_load_balancing_configs(workflow.tenant_id, provider, model_name)
            # Validate each load balancing configuration
            try:
                for config in load_balancing_configs:
                    if config.get("credential_id"):
                        from core.helper.credential_utils import check_credential_policy_compliance

                        check_credential_policy_compliance(
                            config["credential_id"], provider, PluginCredentialType.MODEL
                        )
            except Exception as e:
                raise ValueError(f"Invalid load balancing credentials for {provider}/{model_name}: {str(e)}")

    def _is_load_balancing_enabled(self, tenant_id: str, provider: str, model_name: str) -> bool:
        """
        Check if load balancing is enabled for a specific model.

        :param tenant_id: The tenant ID
        :param provider: The provider name
        :param model_name: The model name
        :return: True if load balancing is enabled, False otherwise
        """
        try:
            from core.model_runtime.entities.model_entities import ModelType
            from core.provider_manager import ProviderManager

            # Get provider configurations
            provider_manager = ProviderManager()
            provider_configurations = provider_manager.get_configurations(tenant_id)
            provider_configuration = provider_configurations.get(provider)

            if not provider_configuration:
                return False

            # Get provider model setting
            provider_model_setting = provider_configuration.get_provider_model_setting(
                model_type=ModelType.LLM,
                model=model_name,
            )
            return provider_model_setting is not None and provider_model_setting.load_balancing_enabled

        except Exception:
            # If we can't determine the status, assume load balancing is not enabled
            return False

    def _get_load_balancing_configs(self, tenant_id: str, provider: str, model_name: str) -> list[dict]:
        """
        Get all load balancing configurations for a model.

        :param tenant_id: The tenant ID
        :param provider: The provider name
        :param model_name: The model name
        :return: List of load balancing configuration dictionaries
        """
        try:
            from services.model_load_balancing_service import ModelLoadBalancingService

            model_load_balancing_service = ModelLoadBalancingService()
            _, configs = model_load_balancing_service.get_load_balancing_configs(
                tenant_id=tenant_id,
                provider=provider,
                model=model_name,
                model_type="llm",  # Load balancing is primarily used for LLM models
                config_from="predefined-model",  # Check both predefined and custom models
            )

            _, custom_configs = model_load_balancing_service.get_load_balancing_configs(
                tenant_id=tenant_id, provider=provider, model=model_name, model_type="llm", config_from="custom-model"
            )
            all_configs = configs + custom_configs

            return [config for config in all_configs if config.get("credential_id")]

        except Exception:
            # If we can't get the configurations, return empty list
            # This will prevent validation errors from breaking the workflow
            return []

    def get_default_block_configs(self) -> Sequence[Mapping[str, object]]:
        """
        Get default block configs
        """
        # return default block config
        default_block_configs: list[Mapping[str, object]] = []
        for node_class_mapping in NODE_TYPE_CLASSES_MAPPING.values():
            node_class = node_class_mapping[LATEST_VERSION]
            default_config = node_class.get_default_config()
            if default_config:
                default_block_configs.append(default_config)

        return default_block_configs

    def get_default_block_config(
        self, node_type: str, filters: Mapping[str, object] | None = None
    ) -> Mapping[str, object]:
        """
        Get default config of node.
        :param node_type: node type
        :param filters: filter by node config parameters.
        :return:
        """
        node_type_enum = NodeType(node_type)

        # return default block config
        if node_type_enum not in NODE_TYPE_CLASSES_MAPPING:
            return {}

        node_class = NODE_TYPE_CLASSES_MAPPING[node_type_enum][LATEST_VERSION]
        default_config = node_class.get_default_config(filters=filters)
        if not default_config:
            return {}

        return default_config

    def run_draft_workflow_node(
        self,
        app_model: App,
        draft_workflow: Workflow,
        node_id: str,
        user_inputs: Mapping[str, Any],
        account: Account,
        query: str = "",
        files: Sequence[File] | None = None,
    ) -> WorkflowNodeExecutionModel:
        """
        Run draft workflow node
        """
        files = files or []

        with Session(bind=db.engine, expire_on_commit=False) as session, session.begin():
            draft_var_srv = WorkflowDraftVariableService(session)
            draft_var_srv.prefill_conversation_variable_default_values(draft_workflow)

        node_config = draft_workflow.get_node_config_by_id(node_id)
        node_type = Workflow.get_node_type_from_node_config(node_config)
        node_data = node_config.get("data", {})
        if node_type.is_start_node:
            with Session(bind=db.engine) as session, session.begin():
                draft_var_srv = WorkflowDraftVariableService(session)
                conversation_id = draft_var_srv.get_or_create_conversation(
                    account_id=account.id,
                    app=app_model,
                    workflow=draft_workflow,
                )
                if node_type is NodeType.START:
                    start_data = StartNodeData.model_validate(node_data)
                    user_inputs = _rebuild_file_for_user_inputs_in_start_node(
                        tenant_id=draft_workflow.tenant_id, start_node_data=start_data, user_inputs=user_inputs
                    )
                # init variable pool
                variable_pool = _setup_variable_pool(
                    query=query,
                    files=files or [],
                    user_id=account.id,
                    user_inputs=user_inputs,
                    workflow=draft_workflow,
                    # NOTE(QuantumGhost): We rely on `DraftVarLoader` to load conversation variables.
                    conversation_variables=[],
                    node_type=node_type,
                    conversation_id=conversation_id,
                )

        else:
            variable_pool = VariablePool(
                system_variables=SystemVariable.default(),
                user_inputs=user_inputs,
                environment_variables=draft_workflow.environment_variables,
                conversation_variables=[],
            )

        variable_loader = DraftVarLoader(
            engine=db.engine,
            app_id=app_model.id,
            tenant_id=app_model.tenant_id,
        )

        enclosing_node_type_and_id = draft_workflow.get_enclosing_node_type_and_id(node_config)
        if enclosing_node_type_and_id:
            _, enclosing_node_id = enclosing_node_type_and_id
        else:
            enclosing_node_id = None

        run = WorkflowEntry.single_step_run(
            workflow=draft_workflow,
            node_id=node_id,
            user_inputs=user_inputs,
            user_id=account.id,
            variable_pool=variable_pool,
            variable_loader=variable_loader,
        )

        # run draft workflow node
        start_at = time.perf_counter()
        node_execution = self._handle_single_step_result(
            invoke_node_fn=lambda: run,
            start_at=start_at,
            node_id=node_id,
        )

        # Set workflow_id on the NodeExecution
        node_execution.workflow_id = draft_workflow.id

        # Create repository and save the node execution
        repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
            session_factory=db.engine,
            user=account,
            app_id=app_model.id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
        )
        repository.save(node_execution)

        workflow_node_execution = self._node_execution_service_repo.get_execution_by_id(node_execution.id)
        if workflow_node_execution is None:
            raise ValueError(f"WorkflowNodeExecution with id {node_execution.id} not found after saving")

        with Session(db.engine) as session:
            outputs = workflow_node_execution.load_full_outputs(session, storage)

        with Session(bind=db.engine) as session, session.begin():
            draft_var_saver = DraftVariableSaver(
                session=session,
                app_id=app_model.id,
                node_id=workflow_node_execution.node_id,
                node_type=NodeType(workflow_node_execution.node_type),
                enclosing_node_id=enclosing_node_id,
                node_execution_id=node_execution.id,
                user=account,
            )
            draft_var_saver.save(process_data=node_execution.process_data, outputs=outputs)
            session.commit()

        return workflow_node_execution

    def run_free_workflow_node(
        self, node_data: dict, tenant_id: str, user_id: str, node_id: str, user_inputs: dict[str, Any]
    ) -> WorkflowNodeExecution:
        """
        Run free workflow node
        """
        # run free workflow node
        start_at = time.perf_counter()

        node_execution = self._handle_single_step_result(
            invoke_node_fn=lambda: WorkflowEntry.run_free_node(
                node_id=node_id,
                node_data=node_data,
                tenant_id=tenant_id,
                user_id=user_id,
                user_inputs=user_inputs,
            ),
            start_at=start_at,
            node_id=node_id,
        )

        return node_execution

    def _handle_single_step_result(
        self,
        invoke_node_fn: Callable[[], tuple[Node, Generator[GraphNodeEventBase, None, None]]],
        start_at: float,
        node_id: str,
    ) -> WorkflowNodeExecution:
        """
        Handle single step execution and return WorkflowNodeExecution.

        Args:
            invoke_node_fn: Function to invoke node execution
            start_at: Execution start time
            node_id: ID of the node being executed

        Returns:
            WorkflowNodeExecution: The execution result
        """
        node, node_run_result, run_succeeded, error = self._execute_node_safely(invoke_node_fn)

        # Create base node execution
        node_execution = WorkflowNodeExecution(
            id=str(uuid.uuid4()),
            workflow_id="",  # Single-step execution has no workflow ID
            index=1,
            node_id=node_id,
            node_type=node.node_type,
            title=node.title,
            elapsed_time=time.perf_counter() - start_at,
            created_at=naive_utc_now(),
            finished_at=naive_utc_now(),
        )

        # Populate execution result data
        self._populate_execution_result(node_execution, node_run_result, run_succeeded, error)

        return node_execution

    def _execute_node_safely(
        self, invoke_node_fn: Callable[[], tuple[Node, Generator[GraphNodeEventBase, None, None]]]
    ) -> tuple[Node, NodeRunResult | None, bool, str | None]:
        """
        Execute node safely and handle errors according to error strategy.

        Returns:
            Tuple of (node, node_run_result, run_succeeded, error)
        """
        try:
            node, node_events = invoke_node_fn()
            node_run_result = next(
                (
                    event.node_run_result
                    for event in node_events
                    if isinstance(event, (NodeRunSucceededEvent, NodeRunFailedEvent))
                ),
                None,
            )

            if not node_run_result:
                raise ValueError("Node execution failed - no result returned")

            # Apply error strategy if node failed
            if node_run_result.status == WorkflowNodeExecutionStatus.FAILED and node.error_strategy:
                node_run_result = self._apply_error_strategy(node, node_run_result)

            run_succeeded = node_run_result.status in (
                WorkflowNodeExecutionStatus.SUCCEEDED,
                WorkflowNodeExecutionStatus.EXCEPTION,
            )
            error = node_run_result.error if not run_succeeded else None
            return node, node_run_result, run_succeeded, error
        except WorkflowNodeRunFailedError as e:
            node = e.node
            run_succeeded = False
            node_run_result = None
            error = e.error
            return node, node_run_result, run_succeeded, error

    def _apply_error_strategy(self, node: Node, node_run_result: NodeRunResult) -> NodeRunResult:
        """Apply error strategy when node execution fails."""
        # TODO(Novice): Maybe we should apply error strategy to node level?
        error_outputs = {
            "error_message": node_run_result.error,
            "error_type": node_run_result.error_type,
        }

        # Add default values if strategy is DEFAULT_VALUE
        if node.error_strategy is ErrorStrategy.DEFAULT_VALUE:
            error_outputs.update(node.default_value_dict)

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.EXCEPTION,
            error=node_run_result.error,
            inputs=node_run_result.inputs,
            metadata={WorkflowNodeExecutionMetadataKey.ERROR_STRATEGY: node.error_strategy},
            outputs=error_outputs,
        )

    def _populate_execution_result(
        self,
        node_execution: WorkflowNodeExecution,
        node_run_result: NodeRunResult | None,
        run_succeeded: bool,
        error: str | None,
    ) -> None:
        """Populate node execution with result data."""
        if run_succeeded and node_run_result:
            node_execution.inputs = (
                WorkflowEntry.handle_special_values(node_run_result.inputs) if node_run_result.inputs else None
            )
            node_execution.process_data = (
                WorkflowEntry.handle_special_values(node_run_result.process_data)
                if node_run_result.process_data
                else None
            )
            node_execution.outputs = node_run_result.outputs
            node_execution.metadata = node_run_result.metadata

            # Set status and error based on result
            node_execution.status = node_run_result.status
            if node_run_result.status == WorkflowNodeExecutionStatus.EXCEPTION:
                node_execution.error = node_run_result.error
        else:
            node_execution.status = WorkflowNodeExecutionStatus.FAILED
            node_execution.error = error

    def convert_to_workflow(self, app_model: App, account: Account, args: dict) -> App:
        """
        Basic mode of chatbot app(expert mode) to workflow
        Completion App to Workflow App

        :param app_model: App instance
        :param account: Account instance
        :param args: dict
        :return:
        """
        # chatbot convert to workflow mode
        workflow_converter = WorkflowConverter()

        if app_model.mode not in {AppMode.CHAT, AppMode.COMPLETION}:
            raise ValueError(f"Current App mode: {app_model.mode} is not supported convert to workflow.")

        # convert to workflow
        new_app: App = workflow_converter.convert_to_workflow(
            app_model=app_model,
            account=account,
            name=args.get("name", "Default Name"),
            icon_type=args.get("icon_type", "emoji"),
            icon=args.get("icon", "🤖"),
            icon_background=args.get("icon_background", "#FFEAD5"),
        )

        return new_app

    def validate_graph_structure(self, graph: Mapping[str, Any]):
        """
        Validate workflow graph structure.

        This performs a lightweight validation on the graph, checking for structural
        inconsistencies such as the coexistence of start and trigger nodes.
        """
        node_configs = graph.get("nodes", [])
        node_configs = cast(list[dict[str, Any]], node_configs)

        # is empty graph
        if not node_configs:
            return

        node_types: set[NodeType] = set()
        for node in node_configs:
            node_type = node.get("data", {}).get("type")
            if node_type:
                node_types.add(NodeType(node_type))

        # start node and trigger node cannot coexist
        if NodeType.START in node_types:
            if any(nt.is_trigger_node for nt in node_types):
                raise ValueError("Start node and trigger nodes cannot coexist in the same workflow")

    def validate_features_structure(self, app_model: App, features: dict):
        if app_model.mode == AppMode.ADVANCED_CHAT:
            return AdvancedChatAppConfigManager.config_validate(
                tenant_id=app_model.tenant_id, config=features, only_structure_validate=True
            )
        elif app_model.mode == AppMode.WORKFLOW:
            return WorkflowAppConfigManager.config_validate(
                tenant_id=app_model.tenant_id, config=features, only_structure_validate=True
            )
        else:
            raise ValueError(f"Invalid app mode: {app_model.mode}")

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
        workflow.updated_at = naive_utc_now()

        return workflow

    def delete_workflow(self, *, session: Session, workflow_id: str, tenant_id: str) -> bool:
        """
        Delete a workflow

        :param session: SQLAlchemy database session
        :param workflow_id: Workflow ID
        :param tenant_id: Tenant ID
        :return: True if successful
        :raises: ValueError if workflow not found
        :raises: WorkflowInUseError if workflow is in use
        :raises: DraftWorkflowDeletionError if workflow is a draft version
        """
        stmt = select(Workflow).where(Workflow.id == workflow_id, Workflow.tenant_id == tenant_id)
        workflow = session.scalar(stmt)

        if not workflow:
            raise ValueError(f"Workflow with ID {workflow_id} not found")

        # Check if workflow is a draft version
        if workflow.version == Workflow.VERSION_DRAFT:
            raise DraftWorkflowDeletionError("Cannot delete draft workflow versions")

        # Check if this workflow is currently referenced by an app
        app_stmt = select(App).where(App.workflow_id == workflow_id)
        app = session.scalar(app_stmt)
        if app:
            # Cannot delete a workflow that's currently in use by an app
            raise WorkflowInUseError(f"Cannot delete workflow that is currently in use by app '{app.id}'")

        # Don't use workflow.tool_published as it's not accurate for specific workflow versions
        # Check if there's a tool provider using this specific workflow version
        tool_provider = (
            session.query(WorkflowToolProvider)
            .where(
                WorkflowToolProvider.tenant_id == workflow.tenant_id,
                WorkflowToolProvider.app_id == workflow.app_id,
                WorkflowToolProvider.version == workflow.version,
            )
            .first()
        )

        if tool_provider:
            # Cannot delete a workflow that's published as a tool
            raise WorkflowInUseError("Cannot delete workflow that is published as a tool")

        session.delete(workflow)
        return True


def _setup_variable_pool(
    query: str,
    files: Sequence[File],
    user_id: str,
    user_inputs: Mapping[str, Any],
    workflow: Workflow,
    node_type: NodeType,
    conversation_id: str,
    conversation_variables: list[VariableBase],
):
    # Only inject system variables for START node type.
    if node_type == NodeType.START or node_type.is_trigger_node:
        system_variable = SystemVariable(
            user_id=user_id,
            app_id=workflow.app_id,
            timestamp=int(naive_utc_now().timestamp()),
            workflow_id=workflow.id,
            files=files or [],
            workflow_execution_id=str(uuid.uuid4()),
        )

        # Only add chatflow-specific variables for non-workflow types
        if workflow.type != WorkflowType.WORKFLOW:
            system_variable.query = query
            system_variable.conversation_id = conversation_id
            system_variable.dialogue_count = 1
    else:
        system_variable = SystemVariable.default()

    # init variable pool
    variable_pool = VariablePool(
        system_variables=system_variable,
        user_inputs=user_inputs,
        environment_variables=workflow.environment_variables,
        # Based on the definition of `Variable`,
        # `VariableBase` instances can be safely used as `Variable` since they are compatible.
        conversation_variables=cast(list[Variable], conversation_variables),  #
    )

    return variable_pool


def _rebuild_file_for_user_inputs_in_start_node(
    tenant_id: str, start_node_data: StartNodeData, user_inputs: Mapping[str, Any]
) -> Mapping[str, Any]:
    inputs_copy = dict(user_inputs)

    for variable in start_node_data.variables:
        if variable.type not in (VariableEntityType.FILE, VariableEntityType.FILE_LIST):
            continue
        if variable.variable not in user_inputs:
            continue
        value = user_inputs[variable.variable]
        file = _rebuild_single_file(tenant_id=tenant_id, value=value, variable_entity_type=variable.type)
        inputs_copy[variable.variable] = file
    return inputs_copy


def _rebuild_single_file(tenant_id: str, value: Any, variable_entity_type: VariableEntityType) -> File | Sequence[File]:
    if variable_entity_type == VariableEntityType.FILE:
        if not isinstance(value, dict):
            raise ValueError(f"expected dict for file object, got {type(value)}")
        return build_from_mapping(mapping=value, tenant_id=tenant_id)
    elif variable_entity_type == VariableEntityType.FILE_LIST:
        if not isinstance(value, list):
            raise ValueError(f"expected list for file list object, got {type(value)}")
        if len(value) == 0:
            return []
        if not isinstance(value[0], dict):
            raise ValueError(f"expected dict for first element in the file list, got {type(value)}")
        return build_from_mappings(mappings=value, tenant_id=tenant_id)
    else:
        raise Exception("unreachable")
