import threading
from typing import Any, cast

from flask import Flask, current_app

from core.app.app_config.entities import DatasetRetrieveConfigEntity
from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.entities.agent_entities import PlanningStrategy
from core.entities.model_entities import ModelStatus
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_manager import ModelInstance, ModelManager
from core.model_runtime.entities.message_entities import PromptMessageTool
from core.model_runtime.entities.model_entities import ModelFeature, ModelType
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.rag.datasource.retrieval_service import RetrievalService
from core.rerank.rerank import RerankRunner
from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.knowledge_retrieval.entities import KnowledgeRetrievalNodeData
from core.workflow.nodes.knowledge_retrieval.multi_dataset_function_call_router import FunctionCallMultiDatasetRouter
from core.workflow.nodes.knowledge_retrieval.multi_dataset_react_route import ReactMultiDatasetRouter
from extensions.ext_database import db
from models.dataset import Dataset, DatasetQuery, Document, DocumentSegment
from models.workflow import WorkflowNodeExecutionStatus

default_retrieval_model = {
    'search_method': 'semantic_search',
    'reranking_enable': False,
    'reranking_model': {
        'reranking_provider_name': '',
        'reranking_model_name': ''
    },
    'top_k': 2,
    'score_threshold_enabled': False
}


class KnowledgeRetrievalNode(BaseNode):
    _node_data_cls = KnowledgeRetrievalNodeData
    node_type = NodeType.KNOWLEDGE_RETRIEVAL

    def _run(self, variable_pool: VariablePool) -> NodeRunResult:
        node_data: KnowledgeRetrievalNodeData = cast(self._node_data_cls, self.node_data)

        # extract variables
        query = variable_pool.get_variable_value(variable_selector=node_data.query_variable_selector)
        variables = {
            'query': query
        }
        if not query:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=variables,
                error="Query is required."
            )
        # retrieve knowledge
        try:
            results = self._fetch_dataset_retriever(
                node_data=node_data, query=query
            )
            outputs = {
                'result': results
            }
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs=variables,
                process_data=None,
                outputs=outputs
            )

        except Exception as e:

            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=variables,
                error=str(e)
            )

    def _fetch_dataset_retriever(self, node_data: KnowledgeRetrievalNodeData, query: str) -> list[
        dict[str, Any]]:
        """
        A dataset tool is a tool that can be used to retrieve information from a dataset
        :param node_data: node data
        :param query: query
        """
        tools = []
        available_datasets = []
        dataset_ids = node_data.dataset_ids
        for dataset_id in dataset_ids:
            # get dataset from dataset id
            dataset = db.session.query(Dataset).filter(
                Dataset.tenant_id == self.tenant_id,
                Dataset.id == dataset_id
            ).first()

            # pass if dataset is not available
            if not dataset:
                continue

            # pass if dataset is not available
            if (dataset and dataset.available_document_count == 0
                    and dataset.available_document_count == 0):
                continue

            available_datasets.append(dataset)
        all_documents = []
        if node_data.retrieval_mode == DatasetRetrieveConfigEntity.RetrieveStrategy.SINGLE.value:
            all_documents = self._single_retrieve(available_datasets, node_data, query)
        elif node_data.retrieval_mode == DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE.value:
            all_documents = self._multiple_retrieve(available_datasets, node_data, query)

        context_list = []
        if all_documents:
            document_score_list = {}
            for item in all_documents:
                if 'score' in item.metadata and item.metadata['score']:
                    document_score_list[item.metadata['doc_id']] = item.metadata['score']

            document_context_list = []
            index_node_ids = [document.metadata['doc_id'] for document in all_documents]
            segments = DocumentSegment.query.filter(
                DocumentSegment.dataset_id.in_(dataset_ids),
                DocumentSegment.completed_at.isnot(None),
                DocumentSegment.status == 'completed',
                DocumentSegment.enabled == True,
                DocumentSegment.index_node_id.in_(index_node_ids)
            ).all()
            if segments:
                index_node_id_to_position = {id: position for position, id in enumerate(index_node_ids)}
                sorted_segments = sorted(segments,
                                         key=lambda segment: index_node_id_to_position.get(segment.index_node_id,
                                                                                           float('inf')))
                for segment in sorted_segments:
                    if segment.answer:
                        document_context_list.append(f'question:{segment.content} answer:{segment.answer}')
                    else:
                        document_context_list.append(segment.content)

                for segment in sorted_segments:
                    dataset = Dataset.query.filter_by(
                        id=segment.dataset_id
                    ).first()
                    document = Document.query.filter(Document.id == segment.document_id,
                                                     Document.enabled == True,
                                                     Document.archived == False,
                                                     ).first()
                    resource_number = 1
                    if dataset and document:

                        source = {
                            'metadata': {
                                '_source': 'knowledge',
                                'position': resource_number,
                                'dataset_id': dataset.id,
                                'dataset_name': dataset.name,
                                'document_id': document.id,
                                'document_name': document.name,
                                'document_data_source_type': document.data_source_type,
                                'segment_id': segment.id,
                                'retriever_from': 'workflow',
                                'score': document_score_list.get(segment.index_node_id, None),
                                'segment_hit_count': segment.hit_count,
                                'segment_word_count': segment.word_count,
                                'segment_position': segment.position,
                                'segment_index_node_hash': segment.index_node_hash,
                            },
                            'title': document.name
                        }
                        if segment.answer:
                            source['content'] = f'question:{segment.content} \nanswer:{segment.answer}'
                        else:
                            source['content'] = segment.content
                        context_list.append(source)
                        resource_number += 1
        return context_list

    @classmethod
    def _extract_variable_selector_to_variable_mapping(cls, node_data: BaseNodeData) -> dict[str, list[str]]:
        node_data = node_data
        node_data = cast(cls._node_data_cls, node_data)
        variable_mapping = {}
        variable_mapping['query'] = node_data.query_variable_selector
        return variable_mapping

    def _single_retrieve(self, available_datasets, node_data, query):
        tools = []
        for dataset in available_datasets:
            description = dataset.description
            if not description:
                description = 'useful for when you want to answer queries about the ' + dataset.name

            description = description.replace('\n', '').replace('\r', '')
            message_tool = PromptMessageTool(
                name=dataset.id,
                description=description,
                parameters={
                    "type": "object",
                    "properties": {},
                    "required": [],
                }
            )
            tools.append(message_tool)
        # fetch model config
        model_instance, model_config = self._fetch_model_config(node_data)
        # check model is support tool calling
        model_type_instance = model_config.provider_model_bundle.model_type_instance
        model_type_instance = cast(LargeLanguageModel, model_type_instance)
        # get model schema
        model_schema = model_type_instance.get_model_schema(
            model=model_config.model,
            credentials=model_config.credentials
        )

        if not model_schema:
            return None
        planning_strategy = PlanningStrategy.REACT_ROUTER
        features = model_schema.features
        if features:
            if ModelFeature.TOOL_CALL in features \
                    or ModelFeature.MULTI_TOOL_CALL in features:
                planning_strategy = PlanningStrategy.ROUTER
        dataset_id = None
        if planning_strategy == PlanningStrategy.REACT_ROUTER:
            react_multi_dataset_router = ReactMultiDatasetRouter()
            dataset_id = react_multi_dataset_router.invoke(query, tools, node_data, model_config, model_instance,
                                                           self.user_id, self.tenant_id)

        elif planning_strategy == PlanningStrategy.ROUTER:
            function_call_router = FunctionCallMultiDatasetRouter()
            dataset_id = function_call_router.invoke(query, tools, model_config, model_instance)
        if dataset_id:
            # get retrieval model config
            dataset = db.session.query(Dataset).filter(
                Dataset.id == dataset_id
            ).first()
            if dataset:
                retrieval_model_config = dataset.retrieval_model \
                    if dataset.retrieval_model else default_retrieval_model

                # get top k
                top_k = retrieval_model_config['top_k']
                # get retrieval method
                if dataset.indexing_technique == "economy":
                    retrival_method = 'keyword_search'
                else:
                    retrival_method = retrieval_model_config['search_method']
                # get reranking model
                reranking_model=retrieval_model_config['reranking_model'] \
                    if retrieval_model_config['reranking_enable'] else None
                # get score threshold
                score_threshold = .0
                score_threshold_enabled = retrieval_model_config.get("score_threshold_enabled")
                if score_threshold_enabled:
                    score_threshold = retrieval_model_config.get("score_threshold")

                results = RetrievalService.retrieve(retrival_method=retrival_method, dataset_id=dataset.id,
                                                    query=query,
                                                    top_k=top_k, score_threshold=score_threshold,
                                                    reranking_model=reranking_model)
                self._on_query(query, [dataset_id])
                if results:
                    self._on_retrival_end(results)
                return results
        return []

    def _fetch_model_config(self, node_data: KnowledgeRetrievalNodeData) -> tuple[
        ModelInstance, ModelConfigWithCredentialsEntity]:
        """
        Fetch model config
        :param node_data: node data
        :return:
        """
        model_name = node_data.single_retrieval_config.model.name
        provider_name = node_data.single_retrieval_config.model.provider

        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=self.tenant_id,
            model_type=ModelType.LLM,
            provider=provider_name,
            model=model_name
        )

        provider_model_bundle = model_instance.provider_model_bundle
        model_type_instance = model_instance.model_type_instance
        model_type_instance = cast(LargeLanguageModel, model_type_instance)

        model_credentials = model_instance.credentials

        # check model
        provider_model = provider_model_bundle.configuration.get_provider_model(
            model=model_name,
            model_type=ModelType.LLM
        )

        if provider_model is None:
            raise ValueError(f"Model {model_name} not exist.")

        if provider_model.status == ModelStatus.NO_CONFIGURE:
            raise ProviderTokenNotInitError(f"Model {model_name} credentials is not initialized.")
        elif provider_model.status == ModelStatus.NO_PERMISSION:
            raise ModelCurrentlyNotSupportError(f"Dify Hosted OpenAI {model_name} currently not support.")
        elif provider_model.status == ModelStatus.QUOTA_EXCEEDED:
            raise QuotaExceededError(f"Model provider {provider_name} quota exceeded.")

        # model config
        completion_params = node_data.single_retrieval_config.model.completion_params
        stop = []
        if 'stop' in completion_params:
            stop = completion_params['stop']
            del completion_params['stop']

        # get model mode
        model_mode = node_data.single_retrieval_config.model.mode
        if not model_mode:
            raise ValueError("LLM mode is required.")

        model_schema = model_type_instance.get_model_schema(
            model_name,
            model_credentials
        )

        if not model_schema:
            raise ValueError(f"Model {model_name} not exist.")

        return model_instance, ModelConfigWithCredentialsEntity(
            provider=provider_name,
            model=model_name,
            model_schema=model_schema,
            mode=model_mode,
            provider_model_bundle=provider_model_bundle,
            credentials=model_credentials,
            parameters=completion_params,
            stop=stop,
        )

    def _multiple_retrieve(self, available_datasets, node_data, query):
        threads = []
        all_documents = []
        dataset_ids = [dataset.id for dataset in available_datasets]
        for dataset in available_datasets:
            retrieval_thread = threading.Thread(target=self._retriever, kwargs={
                'flask_app': current_app._get_current_object(),
                'dataset_id': dataset.id,
                'query': query,
                'top_k': node_data.multiple_retrieval_config.top_k,
                'all_documents': all_documents,
            })
            threads.append(retrieval_thread)
            retrieval_thread.start()
        for thread in threads:
            thread.join()
        # do rerank for searched documents
        model_manager = ModelManager()
        rerank_model_instance = model_manager.get_model_instance(
            tenant_id=self.tenant_id,
            provider=node_data.multiple_retrieval_config.reranking_model.provider,
            model_type=ModelType.RERANK,
            model=node_data.multiple_retrieval_config.reranking_model.model
        )

        rerank_runner = RerankRunner(rerank_model_instance)
        all_documents = rerank_runner.run(query, all_documents,
                                          node_data.multiple_retrieval_config.score_threshold,
                                          node_data.multiple_retrieval_config.top_k)
        self._on_query(query, dataset_ids)
        if all_documents:
            self._on_retrival_end(all_documents)
        return all_documents

    def _on_retrival_end(self, documents: list[Document]) -> None:
        """Handle retrival end."""
        for document in documents:
            query = db.session.query(DocumentSegment).filter(
                DocumentSegment.index_node_id == document.metadata['doc_id']
            )

            # if 'dataset_id' in document.metadata:
            if 'dataset_id' in document.metadata:
                query = query.filter(DocumentSegment.dataset_id == document.metadata['dataset_id'])

            # add hit count to document segment
            query.update(
                {DocumentSegment.hit_count: DocumentSegment.hit_count + 1},
                synchronize_session=False
            )

            db.session.commit()

    def _on_query(self, query: str, dataset_ids: list[str]) -> None:
        """
        Handle query.
        """
        if not query:
            return
        for dataset_id in dataset_ids:
            dataset_query = DatasetQuery(
                dataset_id=dataset_id,
                content=query,
                source='app',
                source_app_id=self.app_id,
                created_by_role=self.user_from.value,
                created_by=self.user_id
            )
            db.session.add(dataset_query)
        db.session.commit()

    def _retriever(self, flask_app: Flask, dataset_id: str, query: str, top_k: int, all_documents: list):
        with flask_app.app_context():
            dataset = db.session.query(Dataset).filter(
                Dataset.tenant_id == self.tenant_id,
                Dataset.id == dataset_id
            ).first()

            if not dataset:
                return []

            # get retrieval model , if the model is not setting , using default
            retrieval_model = dataset.retrieval_model if dataset.retrieval_model else default_retrieval_model

            if dataset.indexing_technique == "economy":
                # use keyword table query
                documents = RetrievalService.retrieve(retrival_method='keyword_search',
                                                      dataset_id=dataset.id,
                                                      query=query,
                                                      top_k=top_k
                                                      )
                if documents:
                    all_documents.extend(documents)
            else:
                if top_k > 0:
                    # retrieval source
                    documents = RetrievalService.retrieve(retrival_method=retrieval_model['search_method'],
                                                          dataset_id=dataset.id,
                                                          query=query,
                                                          top_k=top_k,
                                                          score_threshold=retrieval_model['score_threshold']
                                                          if retrieval_model['score_threshold_enabled'] else None,
                                                          reranking_model=retrieval_model['reranking_model']
                                                          if retrieval_model['reranking_enable'] else None
                                                          )

                    all_documents.extend(documents)

