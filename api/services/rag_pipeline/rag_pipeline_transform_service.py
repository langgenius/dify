import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import yaml
from flask_login import current_user

from constants import DOCUMENT_EXTENSIONS
from extensions.ext_database import db
from factories import variable_factory
from models.dataset import Dataset, Pipeline
from models.workflow import Workflow, WorkflowType
from services.entities.knowledge_entities.rag_pipeline_entities import KnowledgeConfiguration, RetrievalSetting


class RagPipelineTransformService:
    def transform_dataset(self, dataset_id: str):
        dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()
        if not dataset:
            raise ValueError("Dataset not found")
        if dataset.pipeline_id and dataset.runtime_mode == "rag_pipeline":
            return
        if dataset.provider != "vendor":
            raise ValueError("External dataset is not supported")
        datasource_type = dataset.data_source_type
        indexing_technique = dataset.indexing_technique

        if not datasource_type and not indexing_technique:
            return
        doc_form = dataset.doc_form
        if not doc_form:
            return
        retrieval_model = dataset.retrieval_model
        pipeline_yaml = self._get_transform_yaml(doc_form, datasource_type, indexing_technique)
        # Extract app data
        workflow_data = pipeline_yaml.get("workflow")
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

        db.session.commit()
        return {
            "pipeline_id": pipeline.id,
            "dataset_id": dataset_id,
            "status": "success",
        }

    def _get_transform_yaml(self, doc_form: str, datasource_type: str, indexing_technique: str):
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
        file_extensions = [file_extension.lower() for file_extension in file_extensions]
        node["data"]["fileExtensions"] = DOCUMENT_EXTENSIONS
        return node

    def _deal_knowledge_index(
        self, dataset: Dataset, doc_form: str, indexing_technique: str, retrieval_model: dict, node: dict
    ):
        knowledge_configuration_dict = node.get("data", {})
        knowledge_configuration = KnowledgeConfiguration(**knowledge_configuration_dict)

        if indexing_technique == "high_quality":
            knowledge_configuration.embedding_model = dataset.embedding_model
            knowledge_configuration.embedding_model_provider = dataset.embedding_model_provider
        if retrieval_model:
            retrieval_setting = RetrievalSetting(**retrieval_model)
            if indexing_technique == "economy":
                retrieval_setting.search_method = "keyword_search"
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
            type=WorkflowType.RAG_PIPELINE.value,
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
            type=WorkflowType.RAG_PIPELINE.value,
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
