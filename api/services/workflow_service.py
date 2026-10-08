import time
import uuid
from collections.abc import Callable, Generator, Mapping, Sequence
from typing import Any, cast

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.file_access import DatabaseFileAccessController
from core.entities import PluginCredentialType
from core.plugin.impl.model_runtime_factory import create_plugin_model_assembly, create_plugin_provider_manager
from core.repositories import DifyCoreRepositoryFactory
from core.trigger.constants import is_trigger_node_type
from core.workflow.human_input_adapter import adapt_human_input_node_data_for_graph
from core.workflow.llm_environment_variable import (
    LLMEnvironmentVariable,
    parse_llm_model_selector,
    resolve_llm_model_config,
    should_resolve_llm_model_selector,
    validate_llm_environment_model_references,
)
from core.workflow.system_variables import build_bootstrap_variables, build_system_variables, default_system_variables
from core.workflow.variable_pool_initializer import add_node_inputs_to_pool, add_variables_to_pool
from enterprise.telemetry.draft_trace import enqueue_draft_node_execution_trace
from enums import CloudPlan, DeploymentEdition
from extensions.ext_database import db
from factories.file_factory import build_from_mapping, build_from_mappings
from graphon.entities import WorkflowNodeExecution
from graphon.enums import (
    ErrorStrategy,
    NodeType,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from graphon.errors import WorkflowNodeRunFailedError
from graphon.file import File
from graphon.graph_events import GraphNodeEventBase, NodeRunFailedEvent, NodeRunSucceededEvent
from graphon.node_events import NodeRunResult
from graphon.nodes import BuiltinNodeTypes
from graphon.nodes.base.node import Node
from graphon.nodes.container_effects import ContainerAwaitRequest
from graphon.nodes.http_request import HTTP_REQUEST_CONFIG_FILTER_KEY, build_http_request_config
from graphon.nodes.llm.entities import ModelConfig
from graphon.nodes.start.entities import StartNodeData
from graphon.runtime import VariablePool
from graphon.variables import VariableBase
from graphon.variables.input_entities import VariableEntityType
from graphon.variables.variables import Variable
from libs.datetime_utils import naive_utc_now
from models import Account
from models.human_input_entities import HumanInputNodeData
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom, WorkflowType
from repositories.factory import DifyAPIRepositoryFactory
from repositories.workflow.definition_repository import WorkflowDefinitionStore
from services.billing_service import BillingService
from services.credentials.query import CredentialQuery
from services.errors.app import (
    TriggerNodeLimitExceededError,
)
from services.system_feature_service import SystemFeatureService
from services.workflow.execution.adapters.chatflow.app_config_manager import AdvancedChatAppConfigManager
from services.workflow.execution.adapters.node_factory import (
    LATEST_VERSION,
    get_node_type_classes_mapping,
    is_start_node_type,
)
from services.workflow.execution.adapters.workflow.app_config_manager import WorkflowAppConfigManager
from services.workflow.execution.adapters.workflow_entry import WorkflowEntry
from services.workflow.variable_contracts import WorkflowExecutionVariables

_file_access_controller = DatabaseFileAccessController()

from services.workflow.execution.ports import WorkflowRuntime


class WorkflowService:
    """
    Workflow Service
    """

    def __init__(
        self,
        session_maker: sessionmaker | None = None,
        *,
        runtime: WorkflowRuntime | None = None,
    ):
        """Initialize WorkflowService with repository dependencies."""
        if session_maker is None:
            session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        self._runtime = runtime
        self._sessions = session_maker
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

    def get_draft_workflow(
        self, app_model: App, workflow_id: str | None = None, *, session: Session
    ) -> Workflow | None:
        return WorkflowDefinitionStore.get_draft_workflow(app_model, workflow_id, session=session)

    def get_published_workflow_by_id(
        self,
        app_model: App,
        workflow_id: str,
        *,
        session: Session,
        for_update: bool = False,
    ) -> Workflow | None:
        return WorkflowDefinitionStore.get_published_workflow_by_id(
            app_model, workflow_id, session=session, for_update=for_update
        )

    def get_published_workflow(self, app_model: App, *, session: Session) -> Workflow | None:
        return WorkflowDefinitionStore.get_published_workflow(app_model, session=session)

    def validate_publication(self, app_model: App, draft_workflow: Workflow, *, credentials: CredentialQuery) -> None:
        """Validate an already loaded revision without changing workflow state."""
        validate_llm_environment_model_references(
            graph=draft_workflow.graph_dict,
            environment_variables=draft_workflow.environment_variables,
        )

        # Validate credentials before publishing, for credential policy check
        if SystemFeatureService.is_plugin_manager_enabled():
            self._validate_workflow_credentials(draft_workflow, credentials=credentials)

        # validate graph structure
        self.validate_graph_structure(graph=draft_workflow.graph_dict)

        # billing check
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            limit_info = BillingService.get_info(app_model.tenant_id)
            if limit_info["subscription"]["plan"] == CloudPlan.SANDBOX:
                # Check trigger node count limit for SANDBOX plan
                trigger_node_count = sum(
                    1
                    for _, node_data in draft_workflow.walk_nodes()
                    if (node_type_str := node_data.get("type"))
                    and isinstance(node_type_str, str)
                    and is_trigger_node_type(node_type_str)
                )
                if trigger_node_count > 2:
                    raise TriggerNodeLimitExceededError(count=trigger_node_count, limit=2)

    def _validate_workflow_credentials(self, workflow: Workflow, *, credentials: CredentialQuery) -> None:
        """
        Validate all credentials in workflow nodes before publishing.

        :param workflow: The workflow to validate
        :raises ValueError: If any credentials violate policy compliance
        """
        graph_dict = workflow.graph_dict
        nodes = graph_dict.get("nodes", [])
        has_llm_model_reference = any(
            node.get("data", {}).get("type") == "llm"
            and should_resolve_llm_model_selector(node.get("data", {}).get("model_selector"))
            for node in nodes
        )
        environment_variables = (
            {variable.name: variable for variable in workflow.environment_variables} if has_llm_model_reference else {}
        )

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
                            self._check_default_tool_credential(workflow.tenant_id, provider, credentials=credentials)

                elif node_type == "agent":
                    agent_params = node_data.get("agent_parameters", {})

                    model_config = agent_params.get("model", {}).get("value", {})
                    if model_config.get("provider") and model_config.get("model"):
                        self._validate_llm_model_config(
                            workflow.tenant_id, model_config["provider"], model_config["model"]
                        )

                        # Validate load balancing credentials for agent model if load balancing is enabled
                        agent_model_node_data = {"model": model_config}
                        self._validate_load_balancing_credentials(
                            workflow, agent_model_node_data, node_id, credentials=credentials
                        )

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
                                self._check_default_tool_credential(
                                    workflow.tenant_id, provider, credentials=credentials
                                )

                elif node_type in ["llm", "knowledge_retrieval", "parameter_extractor", "question_classifier"]:
                    validation_node_data = node_data
                    model_config = node_data.get("model", {})
                    if node_type == "llm" and should_resolve_llm_model_selector(node_data.get("model_selector")):
                        selector = parse_llm_model_selector(node_data["model_selector"])
                        variable = environment_variables.get(selector[1])
                        if not isinstance(variable, LLMEnvironmentVariable):
                            raise ValueError(
                                f"LLM environment variable '{selector[1]}' was not found or is not an LLM variable"
                            )
                        resolved_model = resolve_llm_model_config(
                            node_model=ModelConfig.model_validate(model_config),
                            variable_name=selector[1],
                            variable_value=variable.value,
                        )
                        model_config = resolved_model.model_dump(mode="json")
                        validation_node_data = {**node_data, "model": model_config}
                    provider = model_config.get("provider")
                    model_name = model_config.get("name")

                    if provider and model_name:
                        # Validate that the provider+model combination can fetch valid credentials
                        self._validate_llm_model_config(workflow.tenant_id, provider, model_name)
                        # Validate load balancing credentials if load balancing is enabled
                        self._validate_load_balancing_credentials(
                            workflow, validation_node_data, node_id, credentials=credentials
                        )
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
            from graphon.model_runtime.entities.model_entities import ModelType

            # Model instance resolution and provider status lookup must reuse the
            # same request-scoped runtime so validation does not silently split
            # provider discovery and credential reads across different caches.
            assembly = create_plugin_model_assembly(tenant_id=tenant_id)

            # Get model instance to validate provider+model combination
            assembly.model_manager.get_model_instance(
                tenant_id=tenant_id, provider=provider, model_type=ModelType.LLM, model=model_name
            )

            # The ModelInstance constructor will automatically check credential policy compliance
            # via ProviderConfiguration.get_current_credentials() -> _check_credential_policy_compliance()
            # If it fails, an exception will be raised

            # Additionally, check the model status to ensure it's ACTIVE
            provider_configurations = assembly.provider_manager.get_configurations(tenant_id)
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

    def _check_default_tool_credential(self, tenant_id: str, provider: str, *, credentials: CredentialQuery) -> None:
        """
        Check credential policy compliance for the default workspace credential of a tool provider.

        This method finds the default credential for the given provider and validates it.
        Uses the same fallback logic as runtime to handle deauthorized credentials.

        :param tenant_id: The tenant ID
        :param provider: The tool provider name
        :raises ValueError: If no default credential exists or if it fails policy compliance
        """
        try:
            credential_id = credentials.default_tool_credential_id(workspace_id=tenant_id, provider=provider)
            if credential_id is None:
                return

            # Check credential policy compliance using the default credential ID
            from core.helper.credential_utils import check_credential_policy_compliance

            check_credential_policy_compliance(
                credential_id=credential_id,
                provider=provider,
                credential_type=PluginCredentialType.TOOL,
                check_existence=False,
            )

        except Exception as e:
            raise ValueError(f"Failed to validate default credential for tool provider {provider}: {str(e)}")

    def _validate_load_balancing_credentials(
        self, workflow: Workflow, node_data: dict[str, Any], node_id: str, *, credentials: CredentialQuery
    ) -> None:
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
            credential_ids = credentials.list_model_load_balancing_credential_ids(
                workspace_id=workflow.tenant_id, provider=provider, model=model_name
            )
            try:
                from core.helper.credential_utils import check_credential_policy_compliance

                for credential_id in credential_ids:
                    check_credential_policy_compliance(credential_id, provider, PluginCredentialType.MODEL)
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
            from graphon.model_runtime.entities.model_entities import ModelType

            # Get provider configurations
            provider_manager = create_plugin_provider_manager(tenant_id=tenant_id)
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

    def get_default_block_configs(self) -> Sequence[Mapping[str, object]]:
        """
        Get default block configs
        """
        # return default block config
        default_block_configs: list[Mapping[str, object]] = []
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
        node_type_enum: NodeType = node_type
        node_mapping = get_node_type_classes_mapping()

        # return default block config
        if node_type_enum not in node_mapping:
            return {}

        node_class = node_mapping[node_type_enum][LATEST_VERSION]
        resolved_filters = dict(filters) if filters else {}
        if node_type_enum == BuiltinNodeTypes.HTTP_REQUEST and HTTP_REQUEST_CONFIG_FILTER_KEY not in resolved_filters:
            resolved_filters[HTTP_REQUEST_CONFIG_FILTER_KEY] = build_http_request_config(
                max_connect_timeout=dify_config.HTTP_REQUEST_MAX_CONNECT_TIMEOUT,
                max_read_timeout=dify_config.HTTP_REQUEST_MAX_READ_TIMEOUT,
                max_write_timeout=dify_config.HTTP_REQUEST_MAX_WRITE_TIMEOUT,
                max_binary_size=dify_config.HTTP_REQUEST_NODE_MAX_BINARY_SIZE,
                max_text_size=dify_config.HTTP_REQUEST_NODE_MAX_TEXT_SIZE,
                ssl_verify=dify_config.HTTP_REQUEST_NODE_SSL_VERIFY,
                ssrf_default_max_retries=dify_config.SSRF_DEFAULT_MAX_RETRIES,
            )
        default_config = node_class.get_default_config(filters=resolved_filters or None)
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
        *,
        variables: WorkflowExecutionVariables,
    ) -> WorkflowNodeExecutionModel:
        """
        Run draft workflow node
        """
        files = files or []

        node_config = draft_workflow.get_node_config_by_id(node_id)
        node_type = Workflow.get_node_type_from_node_config(node_config)
        node_data = node_config["data"]
        if is_start_node_type(node_type):
            conversation_id = variables.get_or_create_conversation(
                account_id=account.id,
                app=app_model,
                workflow=draft_workflow,
            )
            if node_type == BuiltinNodeTypes.START:
                start_data = StartNodeData.model_validate(node_data, from_attributes=True)
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
                node_id=node_id,
                # NOTE(QuantumGhost): We rely on `DraftVarLoader` to load conversation variables.
                conversation_variables=[],
                node_type=node_type,
                conversation_id=conversation_id,
            )

        else:
            variable_pool = VariablePool()
            add_variables_to_pool(
                variable_pool,
                build_bootstrap_variables(
                    system_variables=default_system_variables(),
                    environment_variables=draft_workflow.environment_variables,
                ),
            )

        variable_loader = variables.workflow_loader(draft_workflow, account.id)

        enclosing_node_type_and_id = draft_workflow.get_enclosing_node_type_and_id(node_config)
        if enclosing_node_type_and_id:
            _, enclosing_node_id = enclosing_node_type_and_id
        else:
            enclosing_node_id = None

        if self._runtime is None:
            raise ValueError("Workflow execution dependencies are required")
        run = WorkflowEntry.single_step_run(
            workflow_runtime=self._runtime,
            agent_binding_resolver=self._runtime.agent_bindings,
            draft_variable_saver=variables.saver_factory,
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
            session_factory=self._sessions,
            tenant_id=app_model.tenant_id,
            user=account,
            app_id=app_model.id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
        )
        repository.save(node_execution)

        workflow_node_execution = self._node_execution_service_repo.get_execution_by_id(
            node_execution.id, tenant_id=app_model.tenant_id
        )
        if workflow_node_execution is None:
            raise ValueError(f"WorkflowNodeExecution with id {node_execution.id} not found after saving")

        outputs = variables.load_execution_outputs(workflow_node_execution)

        draft_var_saver = variables.saver_factory(app_model.tenant_id, account)(
            app_id=app_model.id,
            node_id=workflow_node_execution.node_id,
            node_type=workflow_node_execution.node_type,
            enclosing_node_id=enclosing_node_id,
            node_execution_id=node_execution.id,
        )
        draft_var_saver.save(process_data=node_execution.process_data, outputs=outputs)

        enqueue_draft_node_execution_trace(
            execution=workflow_node_execution,
            outputs=outputs,
            workflow_execution_id=None,
            user_id=account.id,
        )

        return workflow_node_execution

    def run_free_workflow_node(
        self, node_data: dict[str, Any], tenant_id: str, user_id: str, node_id: str, user_inputs: dict[str, Any]
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
        invoke_node_fn: Callable[
            [],
            tuple[Node, Generator[GraphNodeEventBase | ContainerAwaitRequest, None, None]],
        ],
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
        self,
        invoke_node_fn: Callable[
            [],
            tuple[Node, Generator[GraphNodeEventBase | ContainerAwaitRequest, None, None]],
        ],
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
                node_types.add(node_type)

        # start node and trigger node cannot coexist
        if BuiltinNodeTypes.START in node_types:
            if any(is_trigger_node_type(nt) for nt in node_types):
                raise ValueError("Start node and trigger nodes cannot coexist in the same workflow")

        for node in node_configs:
            node_data = node.get("data", {})
            node_type = node_data.get("type")

            if node_type == BuiltinNodeTypes.HUMAN_INPUT:
                self._validate_human_input_node_data(node_data)

    def validate_features_structure(self, app_model: App, features: dict[str, Any]):
        match app_model.mode:
            case AppMode.ADVANCED_CHAT:
                return AdvancedChatAppConfigManager.config_validate(
                    tenant_id=app_model.tenant_id, config=features, only_structure_validate=True
                )
            case AppMode.WORKFLOW:
                return WorkflowAppConfigManager.config_validate(
                    tenant_id=app_model.tenant_id, config=features, only_structure_validate=True
                )
            case _:
                raise ValueError(f"Invalid app mode: {app_model.mode}")

    def _validate_human_input_node_data(self, node_data: dict[str, Any]) -> None:
        """
        Validate HumanInput node data format.

        Args:
            node_data: The node data dictionary

        Raises:
            ValueError: If the node data format is invalid
        """

        try:
            HumanInputNodeData.model_validate(adapt_human_input_node_data_for_graph(node_data))
        except Exception as e:
            raise ValueError(f"Invalid HumanInput node data: {str(e)}")


def _setup_variable_pool(
    query: str,
    files: Sequence[File],
    user_id: str,
    user_inputs: Mapping[str, Any],
    workflow: Workflow,
    node_id: str,
    node_type: NodeType,
    conversation_id: str,
    conversation_variables: list[VariableBase],
):
    # Only inject system variables for START node type.
    if is_start_node_type(node_type):
        system_variable_values: dict[str, Any] = {
            "user_id": user_id,
            "app_id": workflow.app_id,
            "timestamp": int(naive_utc_now().timestamp()),
            "workflow_id": workflow.id,
            "files": files or [],
            "workflow_execution_id": str(uuid.uuid4()),
        }

        # Only add chatflow-specific variables for non-workflow types.
        if workflow.type != WorkflowType.WORKFLOW:
            system_variable_values.update(
                {
                    "query": query,
                    "conversation_id": conversation_id,
                    "dialogue_count": 1,
                }
            )

        system_variable = build_system_variables(system_variable_values)
    else:
        system_variable = default_system_variables()

    # init variable pool
    variable_pool = VariablePool()
    add_variables_to_pool(
        variable_pool,
        build_bootstrap_variables(
            system_variables=system_variable,
            environment_variables=workflow.environment_variables,
            conversation_variables=cast(list[Variable], conversation_variables),
        ),
    )
    if is_start_node_type(node_type):
        add_node_inputs_to_pool(variable_pool, node_id=node_id, inputs=user_inputs)

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
        return build_from_mapping(mapping=value, tenant_id=tenant_id, access_controller=_file_access_controller)
    elif variable_entity_type == VariableEntityType.FILE_LIST:
        if not isinstance(value, list):
            raise ValueError(f"expected list for file list object, got {type(value)}")
        if len(value) == 0:
            return []
        if not isinstance(value[0], dict):
            raise ValueError(f"expected dict for first element in the file list, got {type(value)}")
        return build_from_mappings(mappings=value, tenant_id=tenant_id, access_controller=_file_access_controller)
    else:
        raise Exception("unreachable")
