import base64
import hashlib
import logging
import uuid
from collections.abc import Mapping
from enum import StrEnum
from urllib.parse import urlparse
from uuid import uuid4

import yaml
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad
from packaging import version
from packaging.version import parse as parse_version
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.helper import ssrf_proxy
from core.model_runtime.utils.encoders import jsonable_encoder
from core.plugin.entities.plugin import PluginDependency
from core.workflow.enums import NodeType
from core.workflow.nodes.knowledge_retrieval.entities import KnowledgeRetrievalNodeData
from core.workflow.nodes.llm.entities import LLMNodeData
from core.workflow.nodes.parameter_extractor.entities import ParameterExtractorNodeData
from core.workflow.nodes.question_classifier.entities import QuestionClassifierNodeData
from core.workflow.nodes.tool.entities import ToolNodeData
from core.workflow.nodes.trigger_schedule.trigger_schedule_node import TriggerScheduleNode
from events.app_event import app_model_config_was_updated, app_was_created
from extensions.ext_redis import redis_client
from factories import variable_factory
from libs.datetime_utils import naive_utc_now
from models import Account, App, AppMode
from models.model import AppModelConfig, IconType
from models.workflow import Workflow
from services.plugin.dependencies_analysis import DependenciesAnalysisService
from services.workflow_draft_variable_service import WorkflowDraftVariableService
from services.workflow_service import WorkflowService

logger = logging.getLogger(__name__)

IMPORT_INFO_REDIS_KEY_PREFIX = "app_import_info:"
CHECK_DEPENDENCIES_REDIS_KEY_PREFIX = "app_check_dependencies:"
IMPORT_INFO_REDIS_EXPIRY = 10 * 60  # 10 minutes
DSL_MAX_SIZE = 10 * 1024 * 1024  # 10MB
CURRENT_DSL_VERSION = "0.5.0"


class ImportMode(StrEnum):
    YAML_CONTENT = "yaml-content"
    YAML_URL = "yaml-url"


class ImportStatus(StrEnum):
    COMPLETED = "completed"
    COMPLETED_WITH_WARNINGS = "completed-with-warnings"
    PENDING = "pending"
    FAILED = "failed"


class Import(BaseModel):
    id: str
    status: ImportStatus
    app_id: str | None = None
    app_mode: str | None = None
    current_dsl_version: str = CURRENT_DSL_VERSION
    imported_dsl_version: str = ""
    error: str = ""


class CheckDependenciesResult(BaseModel):
    leaked_dependencies: list[PluginDependency] = Field(default_factory=list)


def _check_version_compatibility(imported_version: str) -> ImportStatus:
    """Determine import status based on version comparison"""
    try:
        current_ver = version.parse(CURRENT_DSL_VERSION)
        imported_ver = version.parse(imported_version)
    except version.InvalidVersion:
        return ImportStatus.FAILED

    # If imported version is newer than current, always return PENDING
    if imported_ver > current_ver:
        return ImportStatus.PENDING

    # If imported version is older than current's major, return PENDING
    if imported_ver.major < current_ver.major:
        return ImportStatus.PENDING

    # If imported version is older than current's minor, return COMPLETED_WITH_WARNINGS
    if imported_ver.minor < current_ver.minor:
        return ImportStatus.COMPLETED_WITH_WARNINGS

    # If imported version equals or is older than current's micro, return COMPLETED
    return ImportStatus.COMPLETED


class PendingData(BaseModel):
    import_mode: str
    yaml_content: str
    name: str | None = None
    description: str | None = None
    icon_type: str | None = None
    icon: str | None = None
    icon_background: str | None = None
    app_id: str | None = None


class CheckDependenciesPendingData(BaseModel):
    dependencies: list[PluginDependency]
    app_id: str | None = None


class AppDslService:
    def __init__(self, session: Session):
        self._session = session

    def import_app(
        self,
        *,
        account: Account,
        import_mode: str,
        yaml_content: str | None = None,
        yaml_url: str | None = None,
        name: str | None = None,
        description: str | None = None,
        icon_type: str | None = None,
        icon: str | None = None,
        icon_background: str | None = None,
        app_id: str | None = None,
    ) -> Import:
        """Import an app from YAML content or URL."""
        import_id = str(uuid.uuid4())

        # Validate import mode
        try:
            mode = ImportMode(import_mode)
        except ValueError:
            raise ValueError(f"Invalid import_mode: {import_mode}")

        # Get YAML content
        content: str = ""
        if mode == ImportMode.YAML_URL:
            if not yaml_url:
                return Import(
                    id=import_id,
                    status=ImportStatus.FAILED,
                    error="yaml_url is required when import_mode is yaml-url",
                )
            try:
                parsed_url = urlparse(yaml_url)
                if (
                    parsed_url.scheme == "https"
                    and parsed_url.netloc == "github.com"
                    and parsed_url.path.endswith((".yml", ".yaml"))
                    and "/blob/" in parsed_url.path
                ):
                    yaml_url = yaml_url.replace("https://github.com", "https://raw.githubusercontent.com")
                    yaml_url = yaml_url.replace("/blob/", "/")
                response = ssrf_proxy.get(yaml_url.strip(), follow_redirects=True, timeout=(10, 10))
                response.raise_for_status()
                content = response.content.decode()

                if len(content) > DSL_MAX_SIZE:
                    return Import(
                        id=import_id,
                        status=ImportStatus.FAILED,
                        error="File size exceeds the limit of 10MB",
                    )

                if not content:
                    return Import(
                        id=import_id,
                        status=ImportStatus.FAILED,
                        error="Empty content from url",
                    )
            except Exception as e:
                return Import(
                    id=import_id,
                    status=ImportStatus.FAILED,
                    error=f"Error fetching YAML from URL: {str(e)}",
                )
        elif mode == ImportMode.YAML_CONTENT:
            if not yaml_content:
                return Import(
                    id=import_id,
                    status=ImportStatus.FAILED,
                    error="yaml_content is required when import_mode is yaml-content",
                )
            content = yaml_content

        # Process YAML content
        try:
            # Parse YAML to validate format
            data = yaml.safe_load(content)
            if not isinstance(data, dict):
                return Import(
                    id=import_id,
                    status=ImportStatus.FAILED,
                    error="Invalid YAML format: content must be a mapping",
                )

            # Validate and fix DSL version
            if not data.get("version"):
                data["version"] = "0.1.0"
            if not data.get("kind") or data.get("kind") != "app":
                data["kind"] = "app"

            imported_version = data.get("version", "0.1.0")
            # check if imported_version is a float-like string
            if not isinstance(imported_version, str):
                raise ValueError(f"Invalid version type, expected str, got {type(imported_version)}")
            status = _check_version_compatibility(imported_version)

            # Extract app data
            app_data = data.get("app")
            if not app_data:
                return Import(
                    id=import_id,
                    status=ImportStatus.FAILED,
                    error="Missing app data in YAML content",
                )

            # If app_id is provided, check if it exists
            app = None
            if app_id:
                stmt = select(App).where(App.id == app_id, App.tenant_id == account.current_tenant_id)
                app = self._session.scalar(stmt)

                if not app:
                    return Import(
                        id=import_id,
                        status=ImportStatus.FAILED,
                        error="App not found",
                    )

                if app.mode not in [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT]:
                    return Import(
                        id=import_id,
                        status=ImportStatus.FAILED,
                        error="Only workflow or advanced chat apps can be overwritten",
                    )

            # If major version mismatch, store import info in Redis
            if status == ImportStatus.PENDING:
                pending_data = PendingData(
                    import_mode=import_mode,
                    yaml_content=content,
                    name=name,
                    description=description,
                    icon_type=icon_type,
                    icon=icon,
                    icon_background=icon_background,
                    app_id=app_id,
                )
                redis_client.setex(
                    f"{IMPORT_INFO_REDIS_KEY_PREFIX}{import_id}",
                    IMPORT_INFO_REDIS_EXPIRY,
                    pending_data.model_dump_json(),
                )

                return Import(
                    id=import_id,
                    status=status,
                    app_id=app_id,
                    imported_dsl_version=imported_version,
                )

            # Extract dependencies
            dependencies = data.get("dependencies", [])
            check_dependencies_pending_data = None
            if dependencies:
                check_dependencies_pending_data = [PluginDependency.model_validate(d) for d in dependencies]
            elif parse_version(imported_version) <= parse_version("0.1.5"):
                if "workflow" in data:
                    graph = data.get("workflow", {}).get("graph", {})
                    dependencies_list = self._extract_dependencies_from_workflow_graph(graph)
                else:
                    dependencies_list = self._extract_dependencies_from_model_config(data.get("model_config", {}))

                check_dependencies_pending_data = DependenciesAnalysisService.generate_latest_dependencies(
                    dependencies_list
                )

            # Create or update app
            app = self._create_or_update_app(
                app=app,
                data=data,
                account=account,
                name=name,
                description=description,
                icon_type=icon_type,
                icon=icon,
                icon_background=icon_background,
                dependencies=check_dependencies_pending_data,
            )

            draft_var_srv = WorkflowDraftVariableService(session=self._session)
            draft_var_srv.delete_workflow_variables(app_id=app.id)
            return Import(
                id=import_id,
                status=status,
                app_id=app.id,
                app_mode=app.mode,
                imported_dsl_version=imported_version,
            )

        except yaml.YAMLError as e:
            return Import(
                id=import_id,
                status=ImportStatus.FAILED,
                error=f"Invalid YAML format: {str(e)}",
            )

        except Exception as e:
            logger.exception("Failed to import app")
            return Import(
                id=import_id,
                status=ImportStatus.FAILED,
                error=str(e),
            )

    def confirm_import(self, *, import_id: str, account: Account) -> Import:
        """
        Confirm an import that requires confirmation
        """
        redis_key = f"{IMPORT_INFO_REDIS_KEY_PREFIX}{import_id}"
        pending_data = redis_client.get(redis_key)

        if not pending_data:
            return Import(
                id=import_id,
                status=ImportStatus.FAILED,
                error="Import information expired or does not exist",
            )

        try:
            if not isinstance(pending_data, str | bytes):
                return Import(
                    id=import_id,
                    status=ImportStatus.FAILED,
                    error="Invalid import information",
                )
            pending_data = PendingData.model_validate_json(pending_data)
            data = yaml.safe_load(pending_data.yaml_content)

            app = None
            if pending_data.app_id:
                stmt = select(App).where(App.id == pending_data.app_id, App.tenant_id == account.current_tenant_id)
                app = self._session.scalar(stmt)

            # Create or update app
            app = self._create_or_update_app(
                app=app,
                data=data,
                account=account,
                name=pending_data.name,
                description=pending_data.description,
                icon_type=pending_data.icon_type,
                icon=pending_data.icon,
                icon_background=pending_data.icon_background,
            )

            # Delete import info from Redis
            redis_client.delete(redis_key)

            return Import(
                id=import_id,
                status=ImportStatus.COMPLETED,
                app_id=app.id,
                app_mode=app.mode,
                current_dsl_version=CURRENT_DSL_VERSION,
                imported_dsl_version=data.get("version", "0.1.0"),
            )

        except Exception as e:
            logger.exception("Error confirming import")
            return Import(
                id=import_id,
                status=ImportStatus.FAILED,
                error=str(e),
            )

    def check_dependencies(
        self,
        *,
        app_model: App,
    ) -> CheckDependenciesResult:
        """Check dependencies"""
        # Get dependencies from Redis
        redis_key = f"{CHECK_DEPENDENCIES_REDIS_KEY_PREFIX}{app_model.id}"
        dependencies = redis_client.get(redis_key)
        if not dependencies:
            return CheckDependenciesResult()

        # Extract dependencies
        dependencies = CheckDependenciesPendingData.model_validate_json(dependencies)

        # Get leaked dependencies
        leaked_dependencies = DependenciesAnalysisService.get_leaked_dependencies(
            tenant_id=app_model.tenant_id, dependencies=dependencies.dependencies
        )
        return CheckDependenciesResult(
            leaked_dependencies=leaked_dependencies,
        )

    def _create_or_update_app(
        self,
        *,
        app: App | None,
        data: dict,
        account: Account,
        name: str | None = None,
        description: str | None = None,
        icon_type: str | None = None,
        icon: str | None = None,
        icon_background: str | None = None,
        dependencies: list[PluginDependency] | None = None,
    ) -> App:
        """Create a new app or update an existing one."""
        app_data = data.get("app", {})
        app_mode = app_data.get("mode")
        if not app_mode:
            raise ValueError("loss app mode")
        app_mode = AppMode(app_mode)

        # Set icon type
        icon_type_value = icon_type or app_data.get("icon_type")
        if icon_type_value in [IconType.EMOJI, IconType.IMAGE, IconType.LINK]:
            icon_type = icon_type_value
        else:
            icon_type = IconType.EMOJI
        icon = icon or str(app_data.get("icon", ""))

        if app:
            # Update existing app
            app.name = name or app_data.get("name", app.name)
            app.description = description or app_data.get("description", app.description)
            app.icon_type = icon_type
            app.icon = icon
            app.icon_background = icon_background or app_data.get("icon_background", app.icon_background)
            app.updated_by = account.id
            app.updated_at = naive_utc_now()
        else:
            if account.current_tenant_id is None:
                raise ValueError("Current tenant is not set")

            # Create new app
            app = App()
            app.id = str(uuid4())
            app.tenant_id = account.current_tenant_id
            app.mode = app_mode.value
            app.name = name or app_data.get("name", "")
            app.description = description or app_data.get("description", "")
            app.icon_type = icon_type
            app.icon = icon
            app.icon_background = icon_background or app_data.get("icon_background", "#FFFFFF")
            app.enable_site = True
            app.enable_api = True
            app.use_icon_as_answer_icon = app_data.get("use_icon_as_answer_icon", False)
            app.created_by = account.id
            app.updated_by = account.id

            self._session.add(app)
            self._session.commit()
            app_was_created.send(app, account=account)

        # save dependencies
        if dependencies:
            redis_client.setex(
                f"{CHECK_DEPENDENCIES_REDIS_KEY_PREFIX}{app.id}",
                IMPORT_INFO_REDIS_EXPIRY,
                CheckDependenciesPendingData(app_id=app.id, dependencies=dependencies).model_dump_json(),
            )

        # Initialize app based on mode
        if app_mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
            workflow_data = data.get("workflow")
            if not workflow_data or not isinstance(workflow_data, dict):
                raise ValueError("Missing workflow data for workflow/advanced chat app")

            environment_variables_list = workflow_data.get("environment_variables", [])
            environment_variables = [
                variable_factory.build_environment_variable_from_mapping(obj) for obj in environment_variables_list
            ]
            conversation_variables_list = workflow_data.get("conversation_variables", [])
            conversation_variables = [
                variable_factory.build_conversation_variable_from_mapping(obj) for obj in conversation_variables_list
            ]

            workflow_service = WorkflowService()
            current_draft_workflow = workflow_service.get_draft_workflow(app_model=app)
            if current_draft_workflow:
                unique_hash = current_draft_workflow.unique_hash
            else:
                unique_hash = None
            graph = workflow_data.get("graph", {})
            for node in graph.get("nodes", []):
                if node.get("data", {}).get("type", "") == NodeType.KNOWLEDGE_RETRIEVAL:
                    dataset_ids = node["data"].get("dataset_ids", [])
                    node["data"]["dataset_ids"] = [
                        decrypted_id
                        for dataset_id in dataset_ids
                        if (decrypted_id := self.decrypt_dataset_id(encrypted_data=dataset_id, tenant_id=app.tenant_id))
                    ]
            workflow_service.sync_draft_workflow(
                app_model=app,
                graph=workflow_data.get("graph", {}),
                features=workflow_data.get("features", {}),
                unique_hash=unique_hash,
                account=account,
                environment_variables=environment_variables,
                conversation_variables=conversation_variables,
            )
        elif app_mode in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.COMPLETION}:
            # Initialize model config
            model_config = data.get("model_config")
            if not model_config or not isinstance(model_config, dict):
                raise ValueError("Missing model_config for chat/agent-chat/completion app")
            # Initialize or update model config
            if not app.app_model_config:
                app_model_config = AppModelConfig(
                    app_id=app.id, created_by=account.id, updated_by=account.id
                ).from_model_config_dict(model_config)
                app_model_config.id = str(uuid4())
                app.app_model_config_id = app_model_config.id

                self._session.add(app_model_config)
                app_model_config_was_updated.send(app, app_model_config=app_model_config)
        else:
            raise ValueError("Invalid app mode")
        return app

    @classmethod
    def export_dsl(cls, app_model: App, include_secret: bool = False, workflow_id: str | None = None) -> str:
        """
        Export app
        :param app_model: App instance
        :param include_secret: Whether include secret variable
        :return:
        """
        app_mode = AppMode.value_of(app_model.mode)

        export_data = {
            "version": CURRENT_DSL_VERSION,
            "kind": "app",
            "app": {
                "name": app_model.name,
                "mode": app_model.mode,
                "icon": app_model.icon if app_model.icon_type == "image" else "🤖",
                "icon_background": "#FFEAD5" if app_model.icon_type == "image" else app_model.icon_background,
                "description": app_model.description,
                "use_icon_as_answer_icon": app_model.use_icon_as_answer_icon,
            },
        }

        if app_mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
            cls._append_workflow_export_data(
                export_data=export_data, app_model=app_model, include_secret=include_secret, workflow_id=workflow_id
            )
        else:
            cls._append_model_config_export_data(export_data, app_model)

        return yaml.dump(export_data, allow_unicode=True)

    @classmethod
    def _append_workflow_export_data(
        cls, *, export_data: dict, app_model: App, include_secret: bool, workflow_id: str | None = None
    ):
        """
        Append workflow export data
        :param export_data: export data
        :param app_model: App instance
        """
        workflow_service = WorkflowService()
        workflow = workflow_service.get_draft_workflow(app_model, workflow_id)
        if not workflow:
            raise ValueError("Missing draft workflow configuration, please check.")

        workflow_dict = workflow.to_dict(include_secret=include_secret)
        # TODO: refactor: we need a better way to filter workspace related data from nodes
        for node in workflow_dict.get("graph", {}).get("nodes", []):
            node_data = node.get("data", {})
            if not node_data:
                continue
            data_type = node_data.get("type", "")
            if data_type == NodeType.KNOWLEDGE_RETRIEVAL:
                dataset_ids = node_data.get("dataset_ids", [])
                node_data["dataset_ids"] = [
                    cls.encrypt_dataset_id(dataset_id=dataset_id, tenant_id=app_model.tenant_id)
                    for dataset_id in dataset_ids
                ]
            # filter credential id from tool node
            if not include_secret and data_type == NodeType.TOOL:
                node_data.pop("credential_id", None)
            # filter credential id from agent node
            if not include_secret and data_type == NodeType.AGENT:
                for tool in node_data.get("agent_parameters", {}).get("tools", {}).get("value", []):
                    tool.pop("credential_id", None)
            if data_type == NodeType.TRIGGER_SCHEDULE.value:
                # override the config with the default config
                node_data["config"] = TriggerScheduleNode.get_default_config()["config"]
            if data_type == NodeType.TRIGGER_WEBHOOK.value:
                # clear the webhook_url
                node_data["webhook_url"] = ""
                node_data["webhook_debug_url"] = ""
            if data_type == NodeType.TRIGGER_PLUGIN.value:
                # clear the subscription_id
                node_data["subscription_id"] = ""

        export_data["workflow"] = workflow_dict
        dependencies = cls._extract_dependencies_from_workflow(workflow)
        export_data["dependencies"] = [
            jsonable_encoder(d.model_dump())
            for d in DependenciesAnalysisService.generate_dependencies(
                tenant_id=app_model.tenant_id, dependencies=dependencies
            )
        ]

    @classmethod
    def _append_model_config_export_data(cls, export_data: dict, app_model: App):
        """
        Append model config export data
        :param export_data: export data
        :param app_model: App instance
        """
        app_model_config = app_model.app_model_config
        if not app_model_config:
            raise ValueError("Missing app configuration, please check.")

        model_config = app_model_config.to_dict()

        # TODO: refactor: we need a better way to filter workspace related data from model config
        # filter credential id from model config
        for tool in model_config.get("agent_mode", {}).get("tools", []):
            tool.pop("credential_id", None)

        export_data["model_config"] = model_config

        dependencies = cls._extract_dependencies_from_model_config(app_model_config.to_dict())
        export_data["dependencies"] = [
            jsonable_encoder(d.model_dump())
            for d in DependenciesAnalysisService.generate_dependencies(
                tenant_id=app_model.tenant_id, dependencies=dependencies
            )
        ]

    @classmethod
    def _extract_dependencies_from_workflow(cls, workflow: Workflow) -> list[str]:
        """
        Extract dependencies from workflow
        :param workflow: Workflow instance
        :return: dependencies list format like ["langgenius/google"]
        """
        graph = workflow.graph_dict
        dependencies = cls._extract_dependencies_from_workflow_graph(graph)
        return dependencies

    @classmethod
    def _extract_dependencies_from_workflow_graph(cls, graph: Mapping) -> list[str]:
        """
        Extract dependencies from workflow graph
        :param graph: Workflow graph
        :return: dependencies list format like ["langgenius/google"]
        """
        dependencies = []
        for node in graph.get("nodes", []):
            try:
                typ = node.get("data", {}).get("type")
                match typ:
                    case NodeType.TOOL:
                        tool_entity = ToolNodeData.model_validate(node["data"])
                        dependencies.append(
                            DependenciesAnalysisService.analyze_tool_dependency(tool_entity.provider_id),
                        )
                    case NodeType.LLM:
                        llm_entity = LLMNodeData.model_validate(node["data"])
                        dependencies.append(
                            DependenciesAnalysisService.analyze_model_provider_dependency(llm_entity.model.provider),
                        )
                    case NodeType.QUESTION_CLASSIFIER:
                        question_classifier_entity = QuestionClassifierNodeData.model_validate(node["data"])
                        dependencies.append(
                            DependenciesAnalysisService.analyze_model_provider_dependency(
                                question_classifier_entity.model.provider
                            ),
                        )
                    case NodeType.PARAMETER_EXTRACTOR:
                        parameter_extractor_entity = ParameterExtractorNodeData.model_validate(node["data"])
                        dependencies.append(
                            DependenciesAnalysisService.analyze_model_provider_dependency(
                                parameter_extractor_entity.model.provider
                            ),
                        )
                    case NodeType.KNOWLEDGE_RETRIEVAL:
                        knowledge_retrieval_entity = KnowledgeRetrievalNodeData.model_validate(node["data"])
                        if knowledge_retrieval_entity.retrieval_mode == "multiple":
                            if knowledge_retrieval_entity.multiple_retrieval_config:
                                if (
                                    knowledge_retrieval_entity.multiple_retrieval_config.reranking_mode
                                    == "reranking_model"
                                ):
                                    if knowledge_retrieval_entity.multiple_retrieval_config.reranking_model:
                                        dependencies.append(
                                            DependenciesAnalysisService.analyze_model_provider_dependency(
                                                knowledge_retrieval_entity.multiple_retrieval_config.reranking_model.provider
                                            ),
                                        )
                                elif (
                                    knowledge_retrieval_entity.multiple_retrieval_config.reranking_mode
                                    == "weighted_score"
                                ):
                                    if knowledge_retrieval_entity.multiple_retrieval_config.weights:
                                        vector_setting = (
                                            knowledge_retrieval_entity.multiple_retrieval_config.weights.vector_setting
                                        )
                                        dependencies.append(
                                            DependenciesAnalysisService.analyze_model_provider_dependency(
                                                vector_setting.embedding_provider_name
                                            ),
                                        )
                        elif knowledge_retrieval_entity.retrieval_mode == "single":
                            model_config = knowledge_retrieval_entity.single_retrieval_config
                            if model_config:
                                dependencies.append(
                                    DependenciesAnalysisService.analyze_model_provider_dependency(
                                        model_config.model.provider
                                    ),
                                )
                    case _:
                        # TODO: Handle default case or unknown node types
                        pass
            except Exception as e:
                logger.exception("Error extracting node dependency", exc_info=e)

        return dependencies

    @classmethod
    def _extract_dependencies_from_model_config(cls, model_config: Mapping) -> list[str]:
        """
        Extract dependencies from model config
        :param model_config: model config dict
        :return: dependencies list format like ["langgenius/google"]
        """
        dependencies = []

        try:
            # completion model
            model_dict = model_config.get("model", {})
            if model_dict:
                dependencies.append(
                    DependenciesAnalysisService.analyze_model_provider_dependency(model_dict.get("provider", ""))
                )

            # reranking model
            dataset_configs = model_config.get("dataset_configs", {})
            if dataset_configs:
                for dataset_config in dataset_configs.get("datasets", {}).get("datasets", []):
                    if dataset_config.get("reranking_model"):
                        dependencies.append(
                            DependenciesAnalysisService.analyze_model_provider_dependency(
                                dataset_config.get("reranking_model", {})
                                .get("reranking_provider_name", {})
                                .get("provider")
                            )
                        )

            # tools
            agent_configs = model_config.get("agent_mode", {})
            if agent_configs:
                for agent_config in agent_configs.get("tools", []):
                    dependencies.append(
                        DependenciesAnalysisService.analyze_tool_dependency(agent_config.get("provider_id"))
                    )

        except Exception as e:
            logger.exception("Error extracting model config dependency", exc_info=e)

        return dependencies

    @classmethod
    def get_leaked_dependencies(
        cls, tenant_id: str, dsl_dependencies: list[PluginDependency]
    ) -> list[PluginDependency]:
        """
        Returns the leaked dependencies in current workspace
        """
        if not dsl_dependencies:
            return []

        return DependenciesAnalysisService.get_leaked_dependencies(tenant_id=tenant_id, dependencies=dsl_dependencies)

    @staticmethod
    def _generate_aes_key(tenant_id: str) -> bytes:
        """Generate AES key based on tenant_id"""
        return hashlib.sha256(tenant_id.encode()).digest()

    @classmethod
    def encrypt_dataset_id(cls, dataset_id: str, tenant_id: str) -> str:
        """Encrypt dataset_id using AES-CBC mode or return plain text based on configuration"""
        if not dify_config.DSL_EXPORT_ENCRYPT_DATASET_ID:
            return dataset_id

        key = cls._generate_aes_key(tenant_id)
        iv = key[:16]
        cipher = AES.new(key, AES.MODE_CBC, iv)
        ct_bytes = cipher.encrypt(pad(dataset_id.encode(), AES.block_size))
        return base64.b64encode(ct_bytes).decode()

    @classmethod
    def decrypt_dataset_id(cls, encrypted_data: str, tenant_id: str) -> str | None:
        """AES decryption with fallback to plain text UUID"""
        # First, check if it's already a plain UUID (not encrypted)
        if cls._is_valid_uuid(encrypted_data):
            return encrypted_data

        # If it's not a UUID, try to decrypt it
        try:
            key = cls._generate_aes_key(tenant_id)
            iv = key[:16]
            cipher = AES.new(key, AES.MODE_CBC, iv)
            pt = unpad(cipher.decrypt(base64.b64decode(encrypted_data)), AES.block_size)
            decrypted_text = pt.decode()

            # Validate that the decrypted result is a valid UUID
            if cls._is_valid_uuid(decrypted_text):
                return decrypted_text
            else:
                # If decrypted result is not a valid UUID, it's probably not our encrypted data
                return None
        except Exception:
            # If decryption fails completely, return None
            return None

    @staticmethod
    def _is_valid_uuid(value: str) -> bool:
        """Check if string is a valid UUID format"""
        try:
            uuid.UUID(value)
            return True
        except (ValueError, TypeError):
            return False
