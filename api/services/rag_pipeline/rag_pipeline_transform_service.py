import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import yaml
from flask_login import current_user

from constants import DOCUMENT_EXTENSIONS
from core.plugin.impl.plugin import PluginInstaller
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from extensions.ext_database import db
from factories import variable_factory
from models.dataset import Dataset, Document, DocumentPipelineExecutionLog, Pipeline
from models.model import UploadFile
from models.workflow import Workflow, WorkflowType
from services.entities.knowledge_entities.rag_pipeline_entities import KnowledgeConfiguration, RetrievalSetting
from services.plugin.plugin_migration import PluginMigration
from services.plugin.plugin_service import PluginService

logger = logging.getLogger(__name__)


class RagPipelineTransformService:
    def transform_dataset(self, dataset_id: str):
        dataset = db.session.query(Dataset).where(Dataset.id == dataset_id).first()
        if not dataset:
            raise ValueError("Dataset not found")
        if dataset.pipeline_id and dataset.runtime_mode == "rag_pipeline":
            return {
                "pipeline_id": dataset.pipeline_id,
                "dataset_id": dataset_id,
                "status": "success",
            }
        if dataset.provider != "vendor":
            raise ValueError("External dataset is not supported")
        datasource_type = dataset.data_source_type
        indexing_technique = dataset.indexing_technique

        if not datasource_type and not indexing_technique:
            return self._transform_to_empty_pipeline(dataset)

        doc_form = dataset.doc_form
        if not doc_form:
            return self._transform_to_empty_pipeline(dataset)
        retrieval_model = dataset.retrieval_model
        pipeline_yaml = self._get_transform_yaml(doc_form, datasource_type, indexing_technique)
        # deal dependencies
        self._deal_dependencies(pipeline_yaml, dataset.tenant_id)
        # Extract app data
        workflow_data = pipeline_yaml.get("workflow")
        if not workflow_data:
            raise ValueError("Missing workflow data for rag pipeline")
        graph = workflow_data.get("graph", {})
        nodes = graph.get("nodes", [])
        new_nodes = []

        for node in nodes:
            if (
                node.get("data", {}).get("type") == "datasource"
                and node.get("data", {}).get("provider_type") == "local_file"
            ):
                node = self._deal_file_extensions(node)
            if node.get("data", {}).get("type") == "knowledge-index":
                node = self._deal_knowledge_index(dataset, doc_form, indexing_technique, retrieval_model, node)
            new_nodes.append(node)
        if new_nodes:
            graph["nodes"] = new_nodes
            workflow_data["graph"] = graph
            pipeline_yaml["workflow"] = workflow_data
        # create pipeline
        pipeline = self._create_pipeline(pipeline_yaml)

        # save chunk structure to dataset
        if doc_form == "hierarchical_model":
            dataset.chunk_structure = "hierarchical_model"
        elif doc_form == "text_model":
            dataset.chunk_structure = "text_model"
        else:
            raise ValueError("Unsupported doc form")

        dataset.runtime_mode = "rag_pipeline"
        dataset.pipeline_id = pipeline.id

        # deal document data
        self._deal_document_data(dataset)

        db.session.commit()
        return {
            "pipeline_id": pipeline.id,
            "dataset_id": dataset_id,
            "status": "success",
        }

    def _get_transform_yaml(self, doc_form: str, datasource_type: str, indexing_technique: str | None):
        pipeline_yaml = {}
        if doc_form == "text_model":
            match datasource_type:
                case "upload_file":
                    if indexing_technique == "high_quality":
                        # get graph from transform.file-general-high-quality.yml
                        with open(f"{Path(__file__).parent}/transform/file-general-high-quality.yml") as f:
                            pipeline_yaml = yaml.safe_load(f)
                    if indexing_technique == "economy":
                        # get graph from transform.file-general-economy.yml
                        with open(f"{Path(__file__).parent}/transform/file-general-economy.yml") as f:
                            pipeline_yaml = yaml.safe_load(f)
                case "notion_import":
                    if indexing_technique == "high_quality":
                        # get graph from transform.notion-general-high-quality.yml
                        with open(f"{Path(__file__).parent}/transform/notion-general-high-quality.yml") as f:
                            pipeline_yaml = yaml.safe_load(f)
                    if indexing_technique == "economy":
                        # get graph from transform.notion-general-economy.yml
                        with open(f"{Path(__file__).parent}/transform/notion-general-economy.yml") as f:
                            pipeline_yaml = yaml.safe_load(f)
                case "website_crawl":
                    if indexing_technique == "high_quality":
                        # get graph from transform.website-crawl-general-high-quality.yml
                        with open(f"{Path(__file__).parent}/transform/website-crawl-general-high-quality.yml") as f:
                            pipeline_yaml = yaml.safe_load(f)
                    if indexing_technique == "economy":
                        # get graph from transform.website-crawl-general-economy.yml
                        with open(f"{Path(__file__).parent}/transform/website-crawl-general-economy.yml") as f:
                            pipeline_yaml = yaml.safe_load(f)
                case _:
                    raise ValueError("Unsupported datasource type")
        elif doc_form == "hierarchical_model":
            match datasource_type:
                case "upload_file":
                    # get graph from transform.file-parentchild.yml
                    with open(f"{Path(__file__).parent}/transform/file-parentchild.yml") as f:
                        pipeline_yaml = yaml.safe_load(f)
                case "notion_import":
                    # get graph from transform.notion-parentchild.yml
                    with open(f"{Path(__file__).parent}/transform/notion-parentchild.yml") as f:
                        pipeline_yaml = yaml.safe_load(f)
                case "website_crawl":
                    # get graph from transform.website-crawl-parentchild.yml
                    with open(f"{Path(__file__).parent}/transform/website-crawl-parentchild.yml") as f:
                        pipeline_yaml = yaml.safe_load(f)
                case _:
                    raise ValueError("Unsupported datasource type")
        else:
            raise ValueError("Unsupported doc form")
        return pipeline_yaml

    def _deal_file_extensions(self, node: dict):
        file_extensions = node.get("data", {}).get("fileExtensions", [])
        if not file_extensions:
            return node
        node["data"]["fileExtensions"] = [ext.lower() for ext in file_extensions if ext in DOCUMENT_EXTENSIONS]
        return node

    def _deal_knowledge_index(
        self, dataset: Dataset, doc_form: str, indexing_technique: str | None, retrieval_model: dict, node: dict
    ):
        knowledge_configuration_dict = node.get("data", {})
        knowledge_configuration = KnowledgeConfiguration.model_validate(knowledge_configuration_dict)

        if indexing_technique == "high_quality":
            knowledge_configuration.embedding_model = dataset.embedding_model
            knowledge_configuration.embedding_model_provider = dataset.embedding_model_provider
        if retrieval_model:
            retrieval_setting = RetrievalSetting.model_validate(retrieval_model)
            if indexing_technique == "economy":
                retrieval_setting.search_method = RetrievalMethod.KEYWORD_SEARCH
            knowledge_configuration.retrieval_model = retrieval_setting
        else:
            dataset.retrieval_model = knowledge_configuration.retrieval_model.model_dump()

        knowledge_configuration_dict.update(knowledge_configuration.model_dump())
        node["data"] = knowledge_configuration_dict
        return node

    def _create_pipeline(
        self,
        data: dict,
    ) -> Pipeline:
        """Create a new app or update an existing one."""
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

        # Create new app
        pipeline = Pipeline()
        pipeline.id = str(uuid4())
        pipeline.tenant_id = current_user.current_tenant_id
        pipeline.name = pipeline_data.get("name", "")
        pipeline.description = pipeline_data.get("description", "")
        pipeline.created_by = current_user.id
        pipeline.updated_by = current_user.id
        pipeline.is_published = True
        pipeline.is_public = True

        db.session.add(pipeline)
        db.session.flush()
        # create draft workflow
        draft_workflow = Workflow(
            tenant_id=pipeline.tenant_id,
            app_id=pipeline.id,
            features="{}",
            type=WorkflowType.RAG_PIPELINE,
            version="draft",
            graph=json.dumps(graph),
            created_by=current_user.id,
            environment_variables=environment_variables,
            conversation_variables=conversation_variables,
            rag_pipeline_variables=rag_pipeline_variables_list,
        )
        published_workflow = Workflow(
            tenant_id=pipeline.tenant_id,
            app_id=pipeline.id,
            features="{}",
            type=WorkflowType.RAG_PIPELINE,
            version=str(datetime.now(UTC).replace(tzinfo=None)),
            graph=json.dumps(graph),
            created_by=current_user.id,
            environment_variables=environment_variables,
            conversation_variables=conversation_variables,
            rag_pipeline_variables=rag_pipeline_variables_list,
        )
        db.session.add(draft_workflow)
        db.session.add(published_workflow)
        db.session.flush()
        pipeline.workflow_id = published_workflow.id
        db.session.add(pipeline)
        return pipeline

    def _deal_dependencies(self, pipeline_yaml: dict, tenant_id: str):
        installer_manager = PluginInstaller()
        installed_plugins = installer_manager.list_plugins(tenant_id)

        plugin_migration = PluginMigration()

        installed_plugins_ids = [plugin.plugin_id for plugin in installed_plugins]
        dependencies = pipeline_yaml.get("dependencies", [])
        need_install_plugin_unique_identifiers = []
        for dependency in dependencies:
            if dependency.get("type") == "marketplace":
                plugin_unique_identifier = dependency.get("value", {}).get("plugin_unique_identifier")
                plugin_id = plugin_unique_identifier.split(":")[0]
                if plugin_id not in installed_plugins_ids:
                    plugin_unique_identifier = plugin_migration._fetch_plugin_unique_identifier(plugin_id)  # type: ignore
                    if plugin_unique_identifier:
                        need_install_plugin_unique_identifiers.append(plugin_unique_identifier)
        if need_install_plugin_unique_identifiers:
            logger.debug("Installing missing pipeline plugins %s", need_install_plugin_unique_identifiers)
            PluginService.install_from_marketplace_pkg(tenant_id, need_install_plugin_unique_identifiers)

    def _transform_to_empty_pipeline(self, dataset: Dataset):
        pipeline = Pipeline(
            tenant_id=dataset.tenant_id,
            name=dataset.name,
            description=dataset.description,
            created_by=current_user.id,
        )
        db.session.add(pipeline)
        db.session.flush()

        dataset.pipeline_id = pipeline.id
        dataset.runtime_mode = "rag_pipeline"
        dataset.updated_by = current_user.id
        dataset.updated_at = datetime.now(UTC).replace(tzinfo=None)
        db.session.add(dataset)
        db.session.commit()
        return {
            "pipeline_id": pipeline.id,
            "dataset_id": dataset.id,
            "status": "success",
        }

    def _deal_document_data(self, dataset: Dataset):
        file_node_id = "1752479895761"
        notion_node_id = "1752489759475"
        jina_node_id = "1752491761974"
        firecrawl_node_id = "1752565402678"

        documents = db.session.query(Document).where(Document.dataset_id == dataset.id).all()

        for document in documents:
            data_source_info_dict = document.data_source_info_dict
            if not data_source_info_dict:
                continue
            if document.data_source_type == "upload_file":
                document.data_source_type = "local_file"
                file_id = data_source_info_dict.get("upload_file_id")
                if file_id:
                    file = db.session.query(UploadFile).where(UploadFile.id == file_id).first()
                    if file:
                        data_source_info = json.dumps(
                            {
                                "real_file_id": file_id,
                                "name": file.name,
                                "size": file.size,
                                "extension": file.extension,
                                "mime_type": file.mime_type,
                                "url": "",
                                "transfer_method": "local_file",
                            }
                        )
                        document.data_source_info = data_source_info
                        document_pipeline_execution_log = DocumentPipelineExecutionLog(
                            document_id=document.id,
                            pipeline_id=dataset.pipeline_id,
                            datasource_type="local_file",
                            datasource_info=data_source_info,
                            input_data={},
                            created_by=document.created_by,
                            created_at=document.created_at,
                            datasource_node_id=file_node_id,
                        )
                        db.session.add(document)
                        db.session.add(document_pipeline_execution_log)
            elif document.data_source_type == "notion_import":
                document.data_source_type = "online_document"
                data_source_info = json.dumps(
                    {
                        "workspace_id": data_source_info_dict.get("notion_workspace_id"),
                        "page": {
                            "page_id": data_source_info_dict.get("notion_page_id"),
                            "page_name": document.name,
                            "page_icon": data_source_info_dict.get("notion_page_icon"),
                            "type": data_source_info_dict.get("type"),
                            "last_edited_time": data_source_info_dict.get("last_edited_time"),
                            "parent_id": None,
                        },
                    }
                )
                document.data_source_info = data_source_info
                document_pipeline_execution_log = DocumentPipelineExecutionLog(
                    document_id=document.id,
                    pipeline_id=dataset.pipeline_id,
                    datasource_type="online_document",
                    datasource_info=data_source_info,
                    input_data={},
                    created_by=document.created_by,
                    created_at=document.created_at,
                    datasource_node_id=notion_node_id,
                )
                db.session.add(document)
                db.session.add(document_pipeline_execution_log)
            elif document.data_source_type == "website_crawl":
                document.data_source_type = "website_crawl"
                data_source_info = json.dumps(
                    {
                        "source_url": data_source_info_dict.get("url"),
                        "content": "",
                        "title": document.name,
                        "description": "",
                    }
                )
                document.data_source_info = data_source_info
                if data_source_info_dict.get("provider") == "firecrawl":
                    datasource_node_id = firecrawl_node_id
                elif data_source_info_dict.get("provider") == "jinareader":
                    datasource_node_id = jina_node_id
                else:
                    continue
                document_pipeline_execution_log = DocumentPipelineExecutionLog(
                    document_id=document.id,
                    pipeline_id=dataset.pipeline_id,
                    datasource_type="website_crawl",
                    datasource_info=data_source_info,
                    input_data={},
                    created_by=document.created_by,
                    created_at=document.created_at,
                    datasource_node_id=datasource_node_id,
                )
                db.session.add(document)
                db.session.add(document_pipeline_execution_log)
