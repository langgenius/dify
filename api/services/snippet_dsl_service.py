import json
import logging
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime
from enum import StrEnum
from urllib.parse import urlparse

import yaml  # type: ignore
from packaging import version
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.helper import ssrf_proxy
from core.model_runtime.utils.encoders import jsonable_encoder
from core.plugin.entities.plugin import PluginDependency
from core.workflow.enums import NodeType
from extensions.ext_redis import redis_client
from factories import variable_factory
from models import Account
from models.snippet import CustomizedSnippet, SnippetType
from models.workflow import Workflow
from services.plugin.dependencies_analysis import DependenciesAnalysisService
from services.snippet_service import SnippetService

logger = logging.getLogger(__name__)

IMPORT_INFO_REDIS_KEY_PREFIX = "snippet_import_info:"
CHECK_DEPENDENCIES_REDIS_KEY_PREFIX = "snippet_check_dependencies:"
IMPORT_INFO_REDIS_EXPIRY = 10 * 60  # 10 minutes
DSL_MAX_SIZE = 10 * 1024 * 1024  # 10MB
CURRENT_DSL_VERSION = "0.1.0"


class ImportMode(StrEnum):
    YAML_CONTENT = "yaml-content"
    YAML_URL = "yaml-url"


class ImportStatus(StrEnum):
    COMPLETED = "completed"
    COMPLETED_WITH_WARNINGS = "completed-with-warnings"
    PENDING = "pending"
    FAILED = "failed"


class SnippetImportInfo(BaseModel):
    id: str
    status: ImportStatus
    snippet_id: str | None = None
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


class SnippetPendingData(BaseModel):
    import_mode: str
    yaml_content: str
    snippet_id: str | None


class CheckDependenciesPendingData(BaseModel):
    dependencies: list[PluginDependency]
    snippet_id: str | None


class SnippetDslService:
    def __init__(self, session: Session):
        self._session = session

    def import_snippet(
        self,
        *,
        account: Account,
        import_mode: str,
        yaml_content: str | None = None,
        yaml_url: str | None = None,
        snippet_id: str | None = None,
        name: str | None = None,
        description: str | None = None,
    ) -> SnippetImportInfo:
        """Import a snippet from YAML content or URL."""
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
                return SnippetImportInfo(
                    id=import_id,
                    status=ImportStatus.FAILED,
                    error="yaml_url is required when import_mode is yaml-url",
                )
            try:
                parsed_url = urlparse(yaml_url)
                if parsed_url.scheme not in ["http", "https"]:
                    return SnippetImportInfo(
                        id=import_id,
                        status=ImportStatus.FAILED,
                        error="Invalid URL scheme, only http and https are allowed",
                    )
                response = ssrf_proxy.get(yaml_url, timeout=(10, 30))
                if response.status_code != 200:
                    return SnippetImportInfo(
                        id=import_id,
                        status=ImportStatus.FAILED,
                        error=f"Failed to fetch YAML from URL: {response.status_code}",
                    )
                content = response.text
                if len(content) > DSL_MAX_SIZE:
                    return SnippetImportInfo(
                        id=import_id,
                        status=ImportStatus.FAILED,
                        error=f"YAML content size exceeds maximum limit of {DSL_MAX_SIZE} bytes",
                    )
            except Exception as e:
                logger.exception("Failed to fetch YAML from URL")
                return SnippetImportInfo(
                    id=import_id,
                    status=ImportStatus.FAILED,
                    error=f"Failed to fetch YAML from URL: {str(e)}",
                )
        elif mode == ImportMode.YAML_CONTENT:
            if not yaml_content:
                return SnippetImportInfo(
                    id=import_id,
                    status=ImportStatus.FAILED,
                    error="yaml_content is required when import_mode is yaml-content",
                )
            content = yaml_content
            if len(content) > DSL_MAX_SIZE:
                return SnippetImportInfo(
                    id=import_id,
                    status=ImportStatus.FAILED,
                    error=f"YAML content size exceeds maximum limit of {DSL_MAX_SIZE} bytes",
                )

        try:
            # Parse YAML
            data = yaml.safe_load(content)
            if not isinstance(data, dict):
                return SnippetImportInfo(
                    id=import_id,
                    status=ImportStatus.FAILED,
                    error="Invalid YAML format: expected a dictionary",
                )

            # Validate and fix DSL version
            if not data.get("version"):
                data["version"] = "0.1.0"

            # Strictly validate kind field
            kind = data.get("kind")
            if not kind:
                return SnippetImportInfo(
                    id=import_id,
                    status=ImportStatus.FAILED,
                    error="Missing 'kind' field in DSL. Expected 'kind: snippet'.",
                )
            if kind != "snippet":
                return SnippetImportInfo(
                    id=import_id,
                    status=ImportStatus.FAILED,
                    error=f"Invalid DSL kind: expected 'snippet', got '{kind}'. This DSL is for {kind}, not snippet.",
                )

            imported_version = data.get("version", "0.1.0")
            if not isinstance(imported_version, str):
                raise ValueError(f"Invalid version type, expected str, got {type(imported_version)}")
            status = _check_version_compatibility(imported_version)

            # Extract snippet data
            snippet_data = data.get("snippet")
            if not snippet_data:
                return SnippetImportInfo(
                    id=import_id,
                    status=ImportStatus.FAILED,
                    error="Missing snippet data in YAML content",
                )

            # If snippet_id is provided, check if it exists
            snippet = None
            if snippet_id:
                stmt = select(CustomizedSnippet).where(
                    CustomizedSnippet.id == snippet_id,
                    CustomizedSnippet.tenant_id == account.current_tenant_id,
                )
                snippet = self._session.scalar(stmt)

                if not snippet:
                    return SnippetImportInfo(
                        id=import_id,
                        status=ImportStatus.FAILED,
                        error="Snippet not found",
                    )

            # If major version mismatch, store import info in Redis
            if status == ImportStatus.PENDING:
                pending_data = SnippetPendingData(
                    import_mode=import_mode,
                    yaml_content=content,
                    snippet_id=snippet_id,
                )
                redis_client.setex(
                    f"{IMPORT_INFO_REDIS_KEY_PREFIX}{import_id}",
                    IMPORT_INFO_REDIS_EXPIRY,
                    pending_data.model_dump_json(),
                )

                return SnippetImportInfo(
                    id=import_id,
                    status=status,
                    snippet_id=snippet_id,
                    imported_dsl_version=imported_version,
                )

            # Extract dependencies
            dependencies = data.get("dependencies", [])
            check_dependencies_pending_data = None
            if dependencies:
                check_dependencies_pending_data = [PluginDependency.model_validate(d) for d in dependencies]

            # Create or update snippet
            snippet = self._create_or_update_snippet(
                snippet=snippet,
                data=data,
                account=account,
                name=name,
                description=description,
                dependencies=check_dependencies_pending_data,
            )

            return SnippetImportInfo(
                id=import_id,
                status=status,
                snippet_id=snippet.id,
                imported_dsl_version=imported_version,
            )

        except yaml.YAMLError as e:
            return SnippetImportInfo(
                id=import_id,
                status=ImportStatus.FAILED,
                error=f"Invalid YAML format: {str(e)}",
            )

        except Exception as e:
            logger.exception("Failed to import snippet")
            return SnippetImportInfo(
                id=import_id,
                status=ImportStatus.FAILED,
                error=str(e),
            )

    def confirm_import(self, *, import_id: str, account: Account) -> SnippetImportInfo:
        """
        Confirm an import that requires confirmation
        """
        redis_key = f"{IMPORT_INFO_REDIS_KEY_PREFIX}{import_id}"
        pending_data = redis_client.get(redis_key)

        if not pending_data:
            return SnippetImportInfo(
                id=import_id,
                status=ImportStatus.FAILED,
                error="Import information expired or does not exist",
            )

        try:
            if not isinstance(pending_data, str | bytes):
                return SnippetImportInfo(
                    id=import_id,
                    status=ImportStatus.FAILED,
                    error="Invalid import information",
                )

            pending_data_str = pending_data.decode("utf-8") if isinstance(pending_data, bytes) else pending_data
            pending = SnippetPendingData.model_validate_json(pending_data_str)

            # Re-import with the pending data
            return self.import_snippet(
                account=account,
                import_mode=pending.import_mode,
                yaml_content=pending.yaml_content,
                snippet_id=pending.snippet_id,
            )

        except Exception as e:
            logger.exception("Failed to confirm import")
            return SnippetImportInfo(
                id=import_id,
                status=ImportStatus.FAILED,
                error=str(e),
            )

    def check_dependencies(self, snippet: CustomizedSnippet) -> CheckDependenciesResult:
        """
        Check dependencies for a snippet
        """
        snippet_service = SnippetService()
        workflow = snippet_service.get_draft_workflow(snippet=snippet)
        if not workflow:
            return CheckDependenciesResult(leaked_dependencies=[])

        dependencies = self._extract_dependencies_from_workflow(workflow)
        leaked_dependencies = DependenciesAnalysisService.generate_dependencies(
            tenant_id=snippet.tenant_id, dependencies=dependencies
        )

        return CheckDependenciesResult(leaked_dependencies=leaked_dependencies)

    def _create_or_update_snippet(
        self,
        *,
        snippet: CustomizedSnippet | None,
        data: dict,
        account: Account,
        name: str | None = None,
        description: str | None = None,
        dependencies: list[PluginDependency] | None = None,
    ) -> CustomizedSnippet:
        """
        Create or update snippet from DSL data
        """
        snippet_data = data.get("snippet", {})
        workflow_data = data.get("workflow", {})

        # Extract snippet info
        snippet_name = name or snippet_data.get("name") or "Untitled Snippet"
        snippet_description = description or snippet_data.get("description") or ""
        snippet_type_str = snippet_data.get("type", "node")
        try:
            snippet_type = SnippetType(snippet_type_str)
        except ValueError:
            snippet_type = SnippetType.NODE

        icon_info = snippet_data.get("icon_info", {})
        input_fields = snippet_data.get("input_fields", [])

        # Create or update snippet
        if snippet:
            # Update existing snippet
            snippet.name = snippet_name
            snippet.description = snippet_description
            snippet.type = snippet_type.value
            snippet.icon_info = icon_info or None
            snippet.input_fields = json.dumps(input_fields) if input_fields else None
            snippet.updated_by = account.id
            snippet.updated_at = datetime.now(UTC).replace(tzinfo=None)
        else:
            # Create new snippet
            snippet = CustomizedSnippet(
                tenant_id=account.current_tenant_id,
                name=snippet_name,
                description=snippet_description,
                type=snippet_type.value,
                icon_info=icon_info or None,
                input_fields=json.dumps(input_fields) if input_fields else None,
                created_by=account.id,
            )
            self._session.add(snippet)
            self._session.flush()

        # Create or update draft workflow
        if workflow_data:
            graph = workflow_data.get("graph", {})
            environment_variables_list = workflow_data.get("environment_variables", [])
            conversation_variables_list = workflow_data.get("conversation_variables", [])

            environment_variables = [
                variable_factory.build_environment_variable_from_mapping(obj) for obj in environment_variables_list
            ]
            conversation_variables = [
                variable_factory.build_conversation_variable_from_mapping(obj) for obj in conversation_variables_list
            ]

            snippet_service = SnippetService()
            # Get existing workflow hash if exists
            existing_workflow = snippet_service.get_draft_workflow(snippet=snippet)
            unique_hash = existing_workflow.unique_hash if existing_workflow else None

            snippet_service.sync_draft_workflow(
                snippet=snippet,
                graph=graph,
                unique_hash=unique_hash,
                account=account,
                environment_variables=environment_variables,
                conversation_variables=conversation_variables,
                input_variables=input_fields,
            )

        self._session.commit()
        return snippet

    def export_snippet_dsl(self, snippet: CustomizedSnippet, include_secret: bool = False) -> str:
        """
        Export snippet as DSL
        :param snippet: CustomizedSnippet instance
        :param include_secret: Whether include secret variable
        :return: YAML string
        """
        snippet_service = SnippetService()
        workflow = snippet_service.get_draft_workflow(snippet=snippet)
        if not workflow:
            raise ValueError("Missing draft workflow configuration, please check.")

        icon_info = snippet.icon_info or {}
        export_data = {
            "version": CURRENT_DSL_VERSION,
            "kind": "snippet",
            "snippet": {
                "name": snippet.name,
                "description": snippet.description or "",
                "type": snippet.type,
                "icon_info": icon_info,
                "input_fields": snippet.input_fields_list,
            },
        }

        self._append_workflow_export_data(
            export_data=export_data, snippet=snippet, workflow=workflow, include_secret=include_secret
        )

        return yaml.dump(export_data, allow_unicode=True)  # type: ignore

    def _append_workflow_export_data(
        self, *, export_data: dict, snippet: CustomizedSnippet, workflow: Workflow, include_secret: bool
    ) -> None:
        """
        Append workflow export data
        """
        workflow_dict = workflow.to_dict(include_secret=include_secret)
        # Filter workspace related data from nodes
        for node in workflow_dict.get("graph", {}).get("nodes", []):
            node_data = node.get("data", {})
            if not node_data:
                continue
            data_type = node_data.get("type", "")
            if data_type == NodeType.KNOWLEDGE_RETRIEVAL:
                dataset_ids = node_data.get("dataset_ids", [])
                node["data"]["dataset_ids"] = [
                    self._encrypt_dataset_id(dataset_id=dataset_id, tenant_id=snippet.tenant_id)
                    for dataset_id in dataset_ids
                ]
            # filter credential id from tool node
            if not include_secret and data_type == NodeType.TOOL:
                node_data.pop("credential_id", None)
            # filter credential id from agent node
            if not include_secret and data_type == NodeType.AGENT:
                for tool in node_data.get("agent_parameters", {}).get("tools", {}).get("value", []):
                    tool.pop("credential_id", None)

        export_data["workflow"] = workflow_dict
        dependencies = self._extract_dependencies_from_workflow(workflow)
        export_data["dependencies"] = [
            jsonable_encoder(d.model_dump())
            for d in DependenciesAnalysisService.generate_dependencies(
                tenant_id=snippet.tenant_id, dependencies=dependencies
            )
        ]

    def _encrypt_dataset_id(self, *, dataset_id: str, tenant_id: str) -> str:
        """
        Encrypt dataset ID for export
        """
        # For now, just return the dataset_id as-is
        # In the future, we might want to encrypt it
        return dataset_id

    def _extract_dependencies_from_workflow(self, workflow: Workflow) -> list[str]:
        """
        Extract dependencies from workflow
        :param workflow: Workflow instance
        :return: dependencies list format like ["langgenius/google"]
        """
        graph = workflow.graph_dict
        dependencies = self._extract_dependencies_from_workflow_graph(graph)
        return dependencies

    def _extract_dependencies_from_workflow_graph(self, graph: Mapping) -> list[str]:
        """
        Extract dependencies from workflow graph
        :param graph: Workflow graph
        :return: dependencies list format like ["langgenius/google"]
        """
        dependencies = []
        for node in graph.get("nodes", []):
            node_data = node.get("data", {})
            if not node_data:
                continue
            data_type = node_data.get("type", "")
            if data_type == NodeType.TOOL:
                tool_config = node_data.get("tool_configurations", {})
                provider_type = tool_config.get("provider_type")
                provider_name = tool_config.get("provider")
                if provider_type and provider_name:
                    dependencies.append(f"{provider_name}/{provider_name}")
            elif data_type == NodeType.AGENT:
                agent_parameters = node_data.get("agent_parameters", {})
                tools = agent_parameters.get("tools", {}).get("value", [])
                for tool in tools:
                    provider_type = tool.get("provider_type")
                    provider_name = tool.get("provider")
                    if provider_type and provider_name:
                        dependencies.append(f"{provider_name}/{provider_name}")

        return dependencies
