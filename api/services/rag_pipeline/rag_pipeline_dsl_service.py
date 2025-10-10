import base64
import hashlib
import json
import logging
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime
from enum import StrEnum
from typing import cast
from urllib.parse import urlparse
from uuid import uuid4

import yaml  # type: ignore
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad
from flask_login import current_user
from packaging import version
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.helper import ssrf_proxy
from core.helper.name_generator import generate_incremental_name
from core.model_runtime.utils.encoders import jsonable_encoder
from core.plugin.entities.plugin import PluginDependency
from core.workflow.enums import NodeType
from core.workflow.nodes.datasource.entities import DatasourceNodeData
from core.workflow.nodes.knowledge_retrieval.entities import KnowledgeRetrievalNodeData
from core.workflow.nodes.llm.entities import LLMNodeData
from core.workflow.nodes.parameter_extractor.entities import ParameterExtractorNodeData
from core.workflow.nodes.question_classifier.entities import QuestionClassifierNodeData
from core.workflow.nodes.tool.entities import ToolNodeData
from extensions.ext_redis import redis_client
from factories import variable_factory
from models import Account
from models.dataset import Dataset, DatasetCollectionBinding, Pipeline
from models.workflow import Workflow, WorkflowType
from services.entities.knowledge_entities.rag_pipeline_entities import (
    IconInfo,
    KnowledgeConfiguration,
    RagPipelineDatasetCreateEntity,
)
from services.plugin.dependencies_analysis import DependenciesAnalysisService

logger = logging.getLogger(__name__)

IMPORT_INFO_REDIS_KEY_PREFIX = "app_import_info:"
CHECK_DEPENDENCIES_REDIS_KEY_PREFIX = "app_check_dependencies:"
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


class RagPipelineImportInfo(BaseModel):
    id: str
    status: ImportStatus
    pipeline_id: str | None = None
    current_dsl_version: str = CURRENT_DSL_VERSION
    imported_dsl_version: str = ""
    error: str = ""
    dataset_id: str | None = None


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


class RagPipelinePendingData(BaseModel):
    import_mode: str
    yaml_content: str
    pipeline_id: str | None


class CheckDependenciesPendingData(BaseModel):
    dependencies: list[PluginDependency]
    pipeline_id: str | None


class RagPipelineDslService:
    def __init__(self, session: Session):
        self._session = session

    def import_rag_pipeline(
        self,
        *,
        account: Account,
        import_mode: str,
        yaml_content: str | None = None,
        yaml_url: str | None = None,
        pipeline_id: str | None = None,
        dataset: Dataset | None = None,
        dataset_name: str | None = None,
        icon_info: IconInfo | None = None,
    ) -> RagPipelineImportInfo:
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
                return RagPipelineImportInfo(
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
                ):
                    yaml_url = yaml_url.replace("https://github.com", "https://raw.githubusercontent.com")
                    yaml_url = yaml_url.replace("/blob/", "/")
                response = ssrf_proxy.get(yaml_url.strip(), follow_redirects=True, timeout=(10, 10))
                response.raise_for_status()
                content = response.content.decode()

                if len(content) > DSL_MAX_SIZE:
                    return RagPipelineImportInfo(
                        id=import_id,
                        status=ImportStatus.FAILED,
                        error="File size exceeds the limit of 10MB",
                    )

                if not content:
                    return RagPipelineImportInfo(
                        id=import_id,
                        status=ImportStatus.FAILED,
                        error="Empty content from url",
                    )
            except Exception as e:
                return RagPipelineImportInfo(
                    id=import_id,
                    status=ImportStatus.FAILED,
                    error=f"Error fetching YAML from URL: {str(e)}",
                )
        elif mode == ImportMode.YAML_CONTENT:
            if not yaml_content:
                return RagPipelineImportInfo(
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
                return RagPipelineImportInfo(
                    id=import_id,
                    status=ImportStatus.FAILED,
                    error="Invalid YAML format: content must be a mapping",
                )

            # Validate and fix DSL version
            if not data.get("version"):
                data["version"] = "0.1.0"
            if not data.get("kind") or data.get("kind") != "rag_pipeline":
                data["kind"] = "rag_pipeline"

            imported_version = data.get("version", "0.1.0")
            # check if imported_version is a float-like string
            if not isinstance(imported_version, str):
                raise ValueError(f"Invalid version type, expected str, got {type(imported_version)}")
            status = _check_version_compatibility(imported_version)

            # Extract app data
            pipeline_data = data.get("rag_pipeline")
            if not pipeline_data:
                return RagPipelineImportInfo(
                    id=import_id,
                    status=ImportStatus.FAILED,
                    error="Missing rag_pipeline data in YAML content",
                )

            # If app_id is provided, check if it exists
            pipeline = None
            if pipeline_id:
                stmt = select(Pipeline).where(
                    Pipeline.id == pipeline_id,
                    Pipeline.tenant_id == account.current_tenant_id,
                )
                pipeline = self._session.scalar(stmt)

                if not pipeline:
                    return RagPipelineImportInfo(
                        id=import_id,
                        status=ImportStatus.FAILED,
                        error="Pipeline not found",
                    )
                dataset = pipeline.retrieve_dataset(session=self._session)

            # If major version mismatch, store import info in Redis
            if status == ImportStatus.PENDING:
                pending_data = RagPipelinePendingData(
                    import_mode=import_mode,
                    yaml_content=content,
                    pipeline_id=pipeline_id,
                )
                redis_client.setex(
                    f"{IMPORT_INFO_REDIS_KEY_PREFIX}{import_id}",
                    IMPORT_INFO_REDIS_EXPIRY,
                    pending_data.model_dump_json(),
                )

                return RagPipelineImportInfo(
                    id=import_id,
                    status=status,
                    pipeline_id=pipeline_id,
                    imported_dsl_version=imported_version,
                )

            # Extract dependencies
            dependencies = data.get("dependencies", [])
            check_dependencies_pending_data = None
            if dependencies:
                check_dependencies_pending_data = [PluginDependency.model_validate(d) for d in dependencies]

            # Create or update pipeline
            pipeline = self._create_or_update_pipeline(
                pipeline=pipeline,
                data=data,
                account=account,
                dependencies=check_dependencies_pending_data,
            )
            # create dataset
            name = pipeline.name or "Untitled"
            description = pipeline.description
            if icon_info:
                icon_type = icon_info.icon_type
                icon = icon_info.icon
                icon_background = icon_info.icon_background
                icon_url = icon_info.icon_url
            else:
                icon_type = data.get("rag_pipeline", {}).get("icon_type")
                icon = data.get("rag_pipeline", {}).get("icon")
                icon_background = data.get("rag_pipeline", {}).get("icon_background")
                icon_url = data.get("rag_pipeline", {}).get("icon_url")
            workflow = data.get("workflow", {})
            graph = workflow.get("graph", {})
            nodes = graph.get("nodes", [])
            dataset_id = None
            for node in nodes:
                if node.get("data", {}).get("type") == "knowledge-index":
                    knowledge_configuration = KnowledgeConfiguration.model_validate(node.get("data", {}))
                    if (
                        dataset
                        and pipeline.is_published
                        and dataset.chunk_structure != knowledge_configuration.chunk_structure
                    ):
                        raise ValueError("Chunk structure is not compatible with the published pipeline")
                    if not dataset:
                        datasets = self._session.query(Dataset).filter_by(tenant_id=account.current_tenant_id).all()
                        names = [dataset.name for dataset in datasets]
                        generate_name = generate_incremental_name(names, name)
                        dataset = Dataset(
                            tenant_id=account.current_tenant_id,
                            name=generate_name,
                            description=description,
                            icon_info={
                                "icon_type": icon_type,
                                "icon": icon,
                                "icon_background": icon_background,
                                "icon_url": icon_url,
                            },
                            indexing_technique=knowledge_configuration.indexing_technique,
                            created_by=account.id,
                            retrieval_model=knowledge_configuration.retrieval_model.model_dump(),
                            runtime_mode="rag_pipeline",
                            chunk_structure=knowledge_configuration.chunk_structure,
                        )
                    if knowledge_configuration.indexing_technique == "high_quality":
                        dataset_collection_binding = (
                            self._session.query(DatasetCollectionBinding)
                            .where(
                                DatasetCollectionBinding.provider_name
                                == knowledge_configuration.embedding_model_provider,
                                DatasetCollectionBinding.model_name == knowledge_configuration.embedding_model,
                                DatasetCollectionBinding.type == "dataset",
                            )
                            .order_by(DatasetCollectionBinding.created_at)
                            .first()
                        )

                        if not dataset_collection_binding:
                            dataset_collection_binding = DatasetCollectionBinding(
                                provider_name=knowledge_configuration.embedding_model_provider,
                                model_name=knowledge_configuration.embedding_model,
                                collection_name=Dataset.gen_collection_name_by_id(str(uuid.uuid4())),
                                type="dataset",
                            )
                            self._session.add(dataset_collection_binding)
                            self._session.commit()
                        dataset_collection_binding_id = dataset_collection_binding.id
                        dataset.collection_binding_id = dataset_collection_binding_id
                        dataset.embedding_model = knowledge_configuration.embedding_model
                        dataset.embedding_model_provider = knowledge_configuration.embedding_model_provider
                    elif knowledge_configuration.indexing_technique == "economy":
                        dataset.keyword_number = knowledge_configuration.keyword_number
                    dataset.pipeline_id = pipeline.id
                    self._session.add(dataset)
                    self._session.commit()
                    dataset_id = dataset.id
            if not dataset_id:
                raise ValueError("DSL is not valid, please check the Knowledge Index node.")

            return RagPipelineImportInfo(
                id=import_id,
                status=status,
                pipeline_id=pipeline.id,
                dataset_id=dataset_id,
                imported_dsl_version=imported_version,
            )

        except yaml.YAMLError as e:
            return RagPipelineImportInfo(
                id=import_id,
                status=ImportStatus.FAILED,
                error=f"Invalid YAML format: {str(e)}",
            )

        except Exception as e:
            logger.exception("Failed to import app")
            return RagPipelineImportInfo(
                id=import_id,
                status=ImportStatus.FAILED,
                error=str(e),
            )

    def confirm_import(self, *, import_id: str, account: Account) -> RagPipelineImportInfo:
        """
        Confirm an import that requires confirmation
        """
        redis_key = f"{IMPORT_INFO_REDIS_KEY_PREFIX}{import_id}"
        pending_data = redis_client.get(redis_key)

        if not pending_data:
            return RagPipelineImportInfo(
                id=import_id,
                status=ImportStatus.FAILED,
                error="Import information expired or does not exist",
            )

        try:
            if not isinstance(pending_data, str | bytes):
                return RagPipelineImportInfo(
                    id=import_id,
                    status=ImportStatus.FAILED,
                    error="Invalid import information",
                )
            pending_data = RagPipelinePendingData.model_validate_json(pending_data)
            data = yaml.safe_load(pending_data.yaml_content)

            pipeline = None
            if pending_data.pipeline_id:
                stmt = select(Pipeline).where(
                    Pipeline.id == pending_data.pipeline_id,
                    Pipeline.tenant_id == account.current_tenant_id,
                )
                pipeline = self._session.scalar(stmt)

            # Create or update app
            pipeline = self._create_or_update_pipeline(
                pipeline=pipeline,
                data=data,
                account=account,
            )
            dataset = pipeline.retrieve_dataset(session=self._session)

            # create dataset
            name = pipeline.name
            description = pipeline.description
            icon_type = data.get("rag_pipeline", {}).get("icon_type")
            icon = data.get("rag_pipeline", {}).get("icon")
            icon_background = data.get("rag_pipeline", {}).get("icon_background")
            icon_url = data.get("rag_pipeline", {}).get("icon_url")
            workflow = data.get("workflow", {})
            graph = workflow.get("graph", {})
            nodes = graph.get("nodes", [])
            dataset_id = None
            for node in nodes:
                if node.get("data", {}).get("type") == "knowledge-index":
                    knowledge_configuration = KnowledgeConfiguration.model_validate(node.get("data", {}))
                    if not dataset:
                        dataset = Dataset(
                            tenant_id=account.current_tenant_id,
                            name=name,
                            description=description,
                            icon_info={
                                "icon_type": icon_type,
                                "icon": icon,
                                "icon_background": icon_background,
                                "icon_url": icon_url,
                            },
                            indexing_technique=knowledge_configuration.indexing_technique,
                            created_by=account.id,
                            retrieval_model=knowledge_configuration.retrieval_model.model_dump(),
                            runtime_mode="rag_pipeline",
                            chunk_structure=knowledge_configuration.chunk_structure,
                        )
                    else:
                        dataset.indexing_technique = knowledge_configuration.indexing_technique
                        dataset.retrieval_model = knowledge_configuration.retrieval_model.model_dump()
                        dataset.runtime_mode = "rag_pipeline"
                        dataset.chunk_structure = knowledge_configuration.chunk_structure
                    if knowledge_configuration.indexing_technique == "high_quality":
                        dataset_collection_binding = (
                            self._session.query(DatasetCollectionBinding)
                            .where(
                                DatasetCollectionBinding.provider_name
                                == knowledge_configuration.embedding_model_provider,
                                DatasetCollectionBinding.model_name == knowledge_configuration.embedding_model,
                                DatasetCollectionBinding.type == "dataset",
                            )
                            .order_by(DatasetCollectionBinding.created_at)
                            .first()
                        )

                        if not dataset_collection_binding:
                            dataset_collection_binding = DatasetCollectionBinding(
                                provider_name=knowledge_configuration.embedding_model_provider,
                                model_name=knowledge_configuration.embedding_model,
                                collection_name=Dataset.gen_collection_name_by_id(str(uuid.uuid4())),
                                type="dataset",
                            )
                            self._session.add(dataset_collection_binding)
                            self._session.commit()
                        dataset_collection_binding_id = dataset_collection_binding.id
                        dataset.collection_binding_id = dataset_collection_binding_id
                        dataset.embedding_model = knowledge_configuration.embedding_model
                        dataset.embedding_model_provider = knowledge_configuration.embedding_model_provider
                    elif knowledge_configuration.indexing_technique == "economy":
                        dataset.keyword_number = knowledge_configuration.keyword_number
                    dataset.pipeline_id = pipeline.id
                    self._session.add(dataset)
                    self._session.commit()
                    dataset_id = dataset.id
            if not dataset_id:
                raise ValueError("DSL is not valid, please check the Knowledge Index node.")

            # Delete import info from Redis
            redis_client.delete(redis_key)

            return RagPipelineImportInfo(
                id=import_id,
                status=ImportStatus.COMPLETED,
                pipeline_id=pipeline.id,
                dataset_id=dataset_id,
                current_dsl_version=CURRENT_DSL_VERSION,
                imported_dsl_version=data.get("version", "0.1.0"),
            )

        except Exception as e:
            logger.exception("Error confirming import")
            return RagPipelineImportInfo(
                id=import_id,
                status=ImportStatus.FAILED,
                error=str(e),
            )

    def check_dependencies(
        self,
        *,
        pipeline: Pipeline,
    ) -> CheckDependenciesResult:
        """Check dependencies"""
        # Get dependencies from Redis
        redis_key = f"{CHECK_DEPENDENCIES_REDIS_KEY_PREFIX}{pipeline.id}"
        dependencies = redis_client.get(redis_key)
        if not dependencies:
            return CheckDependenciesResult()

        # Extract dependencies
        dependencies = CheckDependenciesPendingData.model_validate_json(dependencies)

        # Get leaked dependencies
        leaked_dependencies = DependenciesAnalysisService.get_leaked_dependencies(
            tenant_id=pipeline.tenant_id, dependencies=dependencies.dependencies
        )
        return CheckDependenciesResult(
            leaked_dependencies=leaked_dependencies,
        )

    def _create_or_update_pipeline(
        self,
        *,
        pipeline: Pipeline | None,
        data: dict,
        account: Account,
        dependencies: list[PluginDependency] | None = None,
    ) -> Pipeline:
        """Create a new app or update an existing one."""
        if not account.current_tenant_id:
            raise ValueError("Tenant id is required")
        pipeline_data = data.get("rag_pipeline", {})
        # Initialize pipeline based on mode
        workflow_data = data.get("workflow")
        if not workflow_data or not isinstance(workflow_data, dict):
            raise ValueError("Missing workflow data for rag pipeline")

        environment_variables_list = workflow_data.get("environment_variables", [])
        environment_variables = [
            variable_factory.build_environment_variable_from_mapping(obj) for obj in environment_variables_list
        ]
        conversation_variables_list = workflow_data.get("conversation_variables", [])
        conversation_variables = [
            variable_factory.build_conversation_variable_from_mapping(obj) for obj in conversation_variables_list
        ]
        rag_pipeline_variables_list = workflow_data.get("rag_pipeline_variables", [])

        graph = workflow_data.get("graph", {})
        for node in graph.get("nodes", []):
            if node.get("data", {}).get("type", "") == NodeType.KNOWLEDGE_RETRIEVAL:
                dataset_ids = node["data"].get("dataset_ids", [])
                node["data"]["dataset_ids"] = [
                    decrypted_id
                    for dataset_id in dataset_ids
                    if (
                        decrypted_id := self.decrypt_dataset_id(
                            encrypted_data=dataset_id,
                            tenant_id=account.current_tenant_id,
                        )
                    )
                ]

        if pipeline:
            # Update existing pipeline
            pipeline.name = pipeline_data.get("name", pipeline.name)
            pipeline.description = pipeline_data.get("description", pipeline.description)
            pipeline.updated_by = account.id

        else:
            if account.current_tenant_id is None:
                raise ValueError("Current tenant is not set")

            # Create new app
            pipeline = Pipeline()
            pipeline.id = str(uuid4())
            pipeline.tenant_id = account.current_tenant_id
            pipeline.name = pipeline_data.get("name", "")
            pipeline.description = pipeline_data.get("description", "")
            pipeline.created_by = account.id
            pipeline.updated_by = account.id

            self._session.add(pipeline)
            self._session.commit()
        # save dependencies
        if dependencies:
            redis_client.setex(
                f"{CHECK_DEPENDENCIES_REDIS_KEY_PREFIX}{pipeline.id}",
                IMPORT_INFO_REDIS_EXPIRY,
                CheckDependenciesPendingData(pipeline_id=pipeline.id, dependencies=dependencies).model_dump_json(),
            )
        workflow = (
            self._session.query(Workflow)
            .where(
                Workflow.tenant_id == pipeline.tenant_id,
                Workflow.app_id == pipeline.id,
                Workflow.version == "draft",
            )
            .first()
        )

        # create draft workflow if not found
        if not workflow:
            workflow = Workflow(
                tenant_id=pipeline.tenant_id,
                app_id=pipeline.id,
                features="{}",
                type=WorkflowType.RAG_PIPELINE,
                version="draft",
                graph=json.dumps(graph),
                created_by=account.id,
                environment_variables=environment_variables,
                conversation_variables=conversation_variables,
                rag_pipeline_variables=rag_pipeline_variables_list,
            )
            self._session.add(workflow)
            self._session.flush()
            pipeline.workflow_id = workflow.id
        else:
            workflow.graph = json.dumps(graph)
            workflow.updated_by = account.id
            workflow.updated_at = datetime.now(UTC).replace(tzinfo=None)
            workflow.environment_variables = environment_variables
            workflow.conversation_variables = conversation_variables
            workflow.rag_pipeline_variables = rag_pipeline_variables_list
        # commit db session changes
        self._session.commit()

        return pipeline

    def export_rag_pipeline_dsl(self, pipeline: Pipeline, include_secret: bool = False) -> str:
        """
        Export pipeline
        :param pipeline: Pipeline instance
        :param include_secret: Whether include secret variable
        :return:
        """
        dataset = pipeline.retrieve_dataset(session=self._session)
        if not dataset:
            raise ValueError("Missing dataset for rag pipeline")
        icon_info = dataset.icon_info
        export_data = {
            "version": CURRENT_DSL_VERSION,
            "kind": "rag_pipeline",
            "rag_pipeline": {
                "name": dataset.name,
                "icon": icon_info.get("icon", "📙") if icon_info else "📙",
                "icon_type": icon_info.get("icon_type", "emoji") if icon_info else "emoji",
                "icon_background": icon_info.get("icon_background", "#FFEAD5") if icon_info else "#FFEAD5",
                "icon_url": icon_info.get("icon_url") if icon_info else None,
                "description": pipeline.description,
            },
        }

        self._append_workflow_export_data(export_data=export_data, pipeline=pipeline, include_secret=include_secret)

        return yaml.dump(export_data, allow_unicode=True)  # type: ignore

    def _append_workflow_export_data(self, *, export_data: dict, pipeline: Pipeline, include_secret: bool) -> None:
        """
        Append workflow export data
        :param export_data: export data
        :param pipeline: Pipeline instance
        """

        workflow = (
            self._session.query(Workflow)
            .where(
                Workflow.tenant_id == pipeline.tenant_id,
                Workflow.app_id == pipeline.id,
                Workflow.version == "draft",
            )
            .first()
        )
        if not workflow:
            raise ValueError("Missing draft workflow configuration, please check.")

        workflow_dict = workflow.to_dict(include_secret=include_secret)
        for node in workflow_dict.get("graph", {}).get("nodes", []):
            node_data = node.get("data", {})
            if not node_data:
                continue
            data_type = node_data.get("type", "")
            if data_type == NodeType.KNOWLEDGE_RETRIEVAL:
                dataset_ids = node_data.get("dataset_ids", [])
                node["data"]["dataset_ids"] = [
                    self.encrypt_dataset_id(dataset_id=dataset_id, tenant_id=pipeline.tenant_id)
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
                tenant_id=pipeline.tenant_id, dependencies=dependencies
            )
        ]

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
            try:
                typ = node.get("data", {}).get("type")
                match typ:
                    case NodeType.TOOL:
                        tool_entity = ToolNodeData.model_validate(node["data"])
                        dependencies.append(
                            DependenciesAnalysisService.analyze_tool_dependency(tool_entity.provider_id),
                        )
                    case NodeType.DATASOURCE:
                        datasource_entity = DatasourceNodeData.model_validate(node["data"])
                        if datasource_entity.provider_type != "local_file":
                            dependencies.append(datasource_entity.plugin_id)
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
                    case NodeType.KNOWLEDGE_INDEX:
                        knowledge_index_entity = KnowledgeConfiguration.model_validate(node["data"])
                        if knowledge_index_entity.indexing_technique == "high_quality":
                            if knowledge_index_entity.embedding_model_provider:
                                dependencies.append(
                                    DependenciesAnalysisService.analyze_model_provider_dependency(
                                        knowledge_index_entity.embedding_model_provider
                                    ),
                                )
                        if knowledge_index_entity.retrieval_model.reranking_mode == "reranking_model":
                            if knowledge_index_entity.retrieval_model.reranking_enable:
                                if (
                                    knowledge_index_entity.retrieval_model.reranking_model
                                    and knowledge_index_entity.retrieval_model.reranking_mode == "reranking_model"
                                ):
                                    if knowledge_index_entity.retrieval_model.reranking_model.reranking_provider_name:
                                        dependencies.append(
                                            DependenciesAnalysisService.analyze_model_provider_dependency(
                                                knowledge_index_entity.retrieval_model.reranking_model.reranking_provider_name
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
    def get_leaked_dependencies(cls, tenant_id: str, dsl_dependencies: list[dict]) -> list[PluginDependency]:
        """
        Returns the leaked dependencies in current workspace
        """
        dependencies = [PluginDependency.model_validate(dep) for dep in dsl_dependencies]
        if not dependencies:
            return []

        return DependenciesAnalysisService.get_leaked_dependencies(tenant_id=tenant_id, dependencies=dependencies)

    def _generate_aes_key(self, tenant_id: str) -> bytes:
        """Generate AES key based on tenant_id"""
        return hashlib.sha256(tenant_id.encode()).digest()

    def encrypt_dataset_id(self, dataset_id: str, tenant_id: str) -> str:
        """Encrypt dataset_id using AES-CBC mode"""
        key = self._generate_aes_key(tenant_id)
        iv = key[:16]
        cipher = AES.new(key, AES.MODE_CBC, iv)
        ct_bytes = cipher.encrypt(pad(dataset_id.encode(), AES.block_size))
        return base64.b64encode(ct_bytes).decode()

    def decrypt_dataset_id(self, encrypted_data: str, tenant_id: str) -> str | None:
        """AES decryption"""
        try:
            key = self._generate_aes_key(tenant_id)
            iv = key[:16]
            cipher = AES.new(key, AES.MODE_CBC, iv)
            pt = unpad(cipher.decrypt(base64.b64decode(encrypted_data)), AES.block_size)
            return pt.decode()
        except Exception:
            return None

    def create_rag_pipeline_dataset(
        self,
        tenant_id: str,
        rag_pipeline_dataset_create_entity: RagPipelineDatasetCreateEntity,
    ):
        if rag_pipeline_dataset_create_entity.name:
            # check if dataset name already exists
            if (
                self._session.query(Dataset)
                .filter_by(name=rag_pipeline_dataset_create_entity.name, tenant_id=tenant_id)
                .first()
            ):
                raise ValueError(f"Dataset with name {rag_pipeline_dataset_create_entity.name} already exists.")
        else:
            # generate a random name as Untitled 1 2 3 ...
            datasets = self._session.query(Dataset).filter_by(tenant_id=tenant_id).all()
            names = [dataset.name for dataset in datasets]
            rag_pipeline_dataset_create_entity.name = generate_incremental_name(
                names,
                "Untitled",
            )

        account = cast(Account, current_user)
        rag_pipeline_import_info: RagPipelineImportInfo = self.import_rag_pipeline(
            account=account,
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content=rag_pipeline_dataset_create_entity.yaml_content,
            dataset=None,
            dataset_name=rag_pipeline_dataset_create_entity.name,
            icon_info=rag_pipeline_dataset_create_entity.icon_info,
        )
        return {
            "id": rag_pipeline_import_info.id,
            "dataset_id": rag_pipeline_import_info.dataset_id,
            "pipeline_id": rag_pipeline_import_info.pipeline_id,
            "status": rag_pipeline_import_info.status,
            "imported_dsl_version": rag_pipeline_import_info.imported_dsl_version,
            "current_dsl_version": rag_pipeline_import_info.current_dsl_version,
            "error": rag_pipeline_import_info.error,
        }
