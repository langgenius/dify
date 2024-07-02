import threading
from typing import Optional, cast

from flask import Flask, current_app

from core.app.app_config.entities import DatasetEntity, DatasetRetrieveConfigEntity
from core.app.entities.app_invoke_entities import InvokeFrom, ModelConfigWithCredentialsEntity
from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
from core.entities.agent_entities import PlanningStrategy
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance, ModelManager
from core.model_runtime.entities.message_entities import PromptMessageTool
from core.model_runtime.entities.model_entities import ModelFeature, ModelType
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask, TraceTaskName
from core.ops.utils import measure_time
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.models.document import Document
from core.rag.rerank.rerank import RerankRunner
from core.rag.retrieval.retrival_methods import RetrievalMethod
from core.rag.retrieval.router.multi_dataset_function_call_router import FunctionCallMultiDatasetRouter
from core.rag.retrieval.router.multi_dataset_react_route import ReactMultiDatasetRouter
from core.tools.tool.dataset_retriever.dataset_multi_retriever_tool import DatasetMultiRetrieverTool
from core.tools.tool.dataset_retriever.dataset_retriever_base_tool import DatasetRetrieverBaseTool
from core.tools.tool.dataset_retriever.dataset_retriever_tool import DatasetRetrieverTool
from extensions.ext_database import db
from models.dataset import Dataset, DatasetQuery, DocumentSegment
from models.dataset import Document as DatasetDocument

default_retrieval_model = {
    'search_method': RetrievalMethod.SEMANTIC_SEARCH,
    'reranking_enable': False,
    'reranking_model': {
        'reranking_provider_name': '',
        'reranking_model_name': ''
    },
    'top_k': 2,
    'score_threshold_enabled': False
}


class DatasetRetrieval:
    def __init__(self, application_generate_entity=None):
        self.application_generate_entity = application_generate_entity

    def retrieve(
            self, app_id: str, user_id: str, tenant_id: str,
            model_config: ModelConfigWithCredentialsEntity,
            config: DatasetEntity,
            query: str,
            invoke_from: InvokeFrom,
            show_retrieve_source: bool,
            hit_callback: DatasetIndexToolCallbackHandler,
            message_id: str,
            memory: Optional[TokenBufferMemory] = None,
    ) -> Optional[str]:
        """
        Retrieve dataset.
        :param app_id: app_id
        :param user_id: user_id
        :param tenant_id: tenant id
        :param model_config: model config
        :param config: dataset config
        :param query: query
        :param invoke_from: invoke from
        :param show_retrieve_source: show retrieve source
        :param hit_callback: hit callback
        :param message_id: message id
        :param memory: memory
        :return:
        """
        dataset_ids = config.dataset_ids
        if len(dataset_ids) == 0:
            return None
        retrieve_config = config.retrieve_config

        # check model is support tool calling
        model_type_instance = model_config.provider_model_bundle.model_type_instance
        model_type_instance = cast(LargeLanguageModel, model_type_instance)

        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=model_config.provider,
            model=model_config.model
        )

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
        available_datasets = []
        for dataset_id in dataset_ids:
            # get dataset from dataset id
            dataset = db.session.query(Dataset).filter(
                Dataset.tenant_id == tenant_id,
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
        user_from = 'account' if invoke_from in [InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER] else 'end_user'
        if retrieve_config.retrieve_strategy == DatasetRetrieveConfigEntity.RetrieveStrategy.SINGLE:
            all_documents = self.single_retrieve(
                app_id, tenant_id, user_id, user_from, available_datasets, query,
                model_instance,
                model_config, planning_strategy, message_id
            )
        elif retrieve_config.retrieve_strategy == DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE:
            all_documents = self.multiple_retrieve(
                app_id, tenant_id, user_id, user_from,
                available_datasets, query, retrieve_config.top_k,
                retrieve_config.score_threshold,
                retrieve_config.reranking_model.get('reranking_provider_name'),
                retrieve_config.reranking_model.get('reranking_model_name'),
                message_id,
            )

        document_score_list = {}
        for item in all_documents:
            if item.metadata.get('score'):
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
                    document_context_list.append(f'question:{segment.get_sign_content()} answer:{segment.answer}')
                else:
                    document_context_list.append(segment.get_sign_content())
            if show_retrieve_source:
                context_list = []
                resource_number = 1
                for segment in sorted_segments:
                    dataset = Dataset.query.filter_by(
                        id=segment.dataset_id
                    ).first()
                    document = DatasetDocument.query.filter(DatasetDocument.id == segment.document_id,
                                                            DatasetDocument.enabled == True,
                                                            DatasetDocument.archived == False,
                                                            ).first()
                    if dataset and document:
                        source = {
                            'position': resource_number,
                            'dataset_id': dataset.id,
                            'dataset_name': dataset.name,
                            'document_id': document.id,
                            'document_name': document.name,
                            'data_source_type': document.data_source_type,
                            'segment_id': segment.id,
                            'retriever_from': invoke_from.to_source(),
                            'score': document_score_list.get(segment.index_node_id, None)
                        }

                        if invoke_from.to_source() == 'dev':
                            source['hit_count'] = segment.hit_count
                            source['word_count'] = segment.word_count
                            source['segment_position'] = segment.position
                            source['index_node_hash'] = segment.index_node_hash
                        if segment.answer:
                            source['content'] = f'question:{segment.content} \nanswer:{segment.answer}'
                        else:
                            source['content'] = segment.content
                        context_list.append(source)
                    resource_number += 1
                if hit_callback:
                    hit_callback.return_retriever_resource_info(context_list)

            return str("\n".join(document_context_list))
        return ''

    def single_retrieve(
            self, app_id: str,
            tenant_id: str,
            user_id: str,
            user_from: str,
            available_datasets: list,
            query: str,
            model_instance: ModelInstance,
            model_config: ModelConfigWithCredentialsEntity,
            planning_strategy: PlanningStrategy,
            message_id: Optional[str] = None,
    ):
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
        dataset_id = None
        if planning_strategy == PlanningStrategy.REACT_ROUTER:
            react_multi_dataset_router = ReactMultiDatasetRouter()
            dataset_id = react_multi_dataset_router.invoke(query, tools, model_config, model_instance,
                                                           user_id, tenant_id)

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
                reranking_model = retrieval_model_config['reranking_model'] \
                    if retrieval_model_config['reranking_enable'] else None
                # get score threshold
                score_threshold = .0
                score_threshold_enabled = retrieval_model_config.get("score_threshold_enabled")
                if score_threshold_enabled:
                    score_threshold = retrieval_model_config.get("score_threshold")

                with measure_time() as timer:
                    results = RetrievalService.retrieve(
                        retrival_method=retrival_method, dataset_id=dataset.id,
                        query=query,
                        top_k=top_k, score_threshold=score_threshold,
                        reranking_model=reranking_model
                    )
                self._on_query(query, [dataset_id], app_id, user_from, user_id)

                if results:
                    self._on_retrival_end(results, message_id, timer)

                return results
        return []

    def multiple_retrieve(
            self,
            app_id: str,
            tenant_id: str,
            user_id: str,
            user_from: str,
            available_datasets: list,
            query: str,
            top_k: int,
            score_threshold: float,
            reranking_provider_name: str,
            reranking_model_name: str,
            message_id: Optional[str] = None,
    ):
        threads = []
        all_documents = []
        dataset_ids = [dataset.id for dataset in available_datasets]
        for dataset in available_datasets:
            retrieval_thread = threading.Thread(target=self._retriever, kwargs={
                'flask_app': current_app._get_current_object(),
                'dataset_id': dataset.id,
                'query': query,
                'top_k': top_k,
                'all_documents': all_documents,
            })
            threads.append(retrieval_thread)
            retrieval_thread.start()
        for thread in threads:
            thread.join()
        # do rerank for searched documents
        model_manager = ModelManager()
        rerank_model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id,
            provider=reranking_provider_name,
            model_type=ModelType.RERANK,
            model=reranking_model_name
        )

        rerank_runner = RerankRunner(rerank_model_instance)

        with measure_time() as timer:
            all_documents = rerank_runner.run(
                query, all_documents,
                score_threshold,
                top_k
            )
        self._on_query(query, dataset_ids, app_id, user_from, user_id)

        if all_documents:
            self._on_retrival_end(all_documents, message_id, timer)

        return all_documents

    def _on_retrival_end(
        self, documents: list[Document], message_id: Optional[str] = None, timer: Optional[dict] = None
    ) -> None:
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

        # get tracing instance
        trace_manager: TraceQueueManager = self.application_generate_entity.trace_manager if self.application_generate_entity else None
        if trace_manager:
            trace_manager.add_trace_task(
                TraceTask(
                    TraceTaskName.DATASET_RETRIEVAL_TRACE,
                    message_id=message_id,
                    documents=documents,
                    timer=timer
                )
            )

    def _on_query(self, query: str, dataset_ids: list[str], app_id: str, user_from: str, user_id: str) -> None:
        """
        Handle query.
        """
        if not query:
            return
        dataset_queries = []
        for dataset_id in dataset_ids:
            dataset_query = DatasetQuery(
                dataset_id=dataset_id,
                content=query,
                source='app',
                source_app_id=app_id,
                created_by_role=user_from,
                created_by=user_id
            )
            dataset_queries.append(dataset_query)
        if dataset_queries:
            db.session.add_all(dataset_queries)
        db.session.commit()

    def _retriever(self, flask_app: Flask, dataset_id: str, query: str, top_k: int, all_documents: list):
        with flask_app.app_context():
            dataset = db.session.query(Dataset).filter(
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

    def to_dataset_retriever_tool(self, tenant_id: str,
                                  dataset_ids: list[str],
                                  retrieve_config: DatasetRetrieveConfigEntity,
                                  return_resource: bool,
                                  invoke_from: InvokeFrom,
                                  hit_callback: DatasetIndexToolCallbackHandler) \
            -> Optional[list[DatasetRetrieverBaseTool]]:
        """
        A dataset tool is a tool that can be used to retrieve information from a dataset
        :param tenant_id: tenant id
        :param dataset_ids: dataset ids
        :param retrieve_config: retrieve config
        :param return_resource: return resource
        :param invoke_from: invoke from
        :param hit_callback: hit callback
        """
        tools = []
        available_datasets = []
        for dataset_id in dataset_ids:
            # get dataset from dataset id
            dataset = db.session.query(Dataset).filter(
                Dataset.tenant_id == tenant_id,
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

        if retrieve_config.retrieve_strategy == DatasetRetrieveConfigEntity.RetrieveStrategy.SINGLE:
            # get retrieval model config
            default_retrieval_model = {
                'search_method': RetrievalMethod.SEMANTIC_SEARCH,
                'reranking_enable': False,
                'reranking_model': {
                    'reranking_provider_name': '',
                    'reranking_model_name': ''
                },
                'top_k': 2,
                'score_threshold_enabled': False
            }

            for dataset in available_datasets:
                retrieval_model_config = dataset.retrieval_model \
                    if dataset.retrieval_model else default_retrieval_model

                # get top k
                top_k = retrieval_model_config['top_k']

                # get score threshold
                score_threshold = None
                score_threshold_enabled = retrieval_model_config.get("score_threshold_enabled")
                if score_threshold_enabled:
                    score_threshold = retrieval_model_config.get("score_threshold")

                tool = DatasetRetrieverTool.from_dataset(
                    dataset=dataset,
                    top_k=top_k,
                    score_threshold=score_threshold,
                    hit_callbacks=[hit_callback],
                    return_resource=return_resource,
                    retriever_from=invoke_from.to_source()
                )

                tools.append(tool)
        elif retrieve_config.retrieve_strategy == DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE:
            tool = DatasetMultiRetrieverTool.from_dataset(
                dataset_ids=[dataset.id for dataset in available_datasets],
                tenant_id=tenant_id,
                top_k=retrieve_config.top_k or 2,
                score_threshold=retrieve_config.score_threshold,
                hit_callbacks=[hit_callback],
                return_resource=return_resource,
                retriever_from=invoke_from.to_source(),
                reranking_provider_name=retrieve_config.reranking_model.get('reranking_provider_name'),
                reranking_model_name=retrieve_config.reranking_model.get('reranking_model_name')
            )

            tools.append(tool)

        return tools
