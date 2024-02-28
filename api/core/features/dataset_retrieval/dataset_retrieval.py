from typing import Optional, cast

from langchain.tools import BaseTool

from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
from core.entities.agent_entities import PlanningStrategy
from core.entities.application_entities import DatasetEntity, DatasetRetrieveConfigEntity, InvokeFrom, ModelConfigEntity
from core.features.dataset_retrieval.agent_based_dataset_executor import AgentConfiguration, AgentExecutor
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_runtime.entities.model_entities import ModelFeature
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.tools.tool.dataset_retriever.dataset_multi_retriever_tool import DatasetMultiRetrieverTool
from core.tools.tool.dataset_retriever.dataset_retriever_tool import DatasetRetrieverTool
from extensions.ext_database import db
from models.dataset import Dataset


class DatasetRetrievalFeature:
    def retrieve(self, tenant_id: str,
                 model_config: ModelConfigEntity,
                 config: DatasetEntity,
                 query: str,
                 invoke_from: InvokeFrom,
                 show_retrieve_source: bool,
                 hit_callback: DatasetIndexToolCallbackHandler,
                 memory: Optional[TokenBufferMemory] = None) -> Optional[str]:
        """
        Retrieve dataset.
        :param tenant_id: tenant id
        :param model_config: model config
        :param config: dataset config
        :param query: query
        :param invoke_from: invoke from
        :param show_retrieve_source: show retrieve source
        :param hit_callback: hit callback
        :param memory: memory
        :return:
        """
        dataset_ids = config.dataset_ids
        retrieve_config = config.retrieve_config

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

        dataset_retriever_tools = self.to_dataset_retriever_tool(
            tenant_id=tenant_id,
            dataset_ids=dataset_ids,
            retrieve_config=retrieve_config,
            return_resource=show_retrieve_source,
            invoke_from=invoke_from,
            hit_callback=hit_callback
        )

        if len(dataset_retriever_tools) == 0:
            return None

        agent_configuration = AgentConfiguration(
            strategy=planning_strategy,
            model_config=model_config,
            tools=dataset_retriever_tools,
            memory=memory,
            max_iterations=10,
            max_execution_time=400.0,
            early_stopping_method="generate"
        )

        agent_executor = AgentExecutor(agent_configuration)

        should_use_agent = agent_executor.should_use_agent(query)
        if not should_use_agent:
            return None

        result = agent_executor.run(query)

        return result.output

    def to_dataset_retriever_tool(self, tenant_id: str,
                                  dataset_ids: list[str],
                                  retrieve_config: DatasetRetrieveConfigEntity,
                                  return_resource: bool,
                                  invoke_from: InvokeFrom,
                                  hit_callback: DatasetIndexToolCallbackHandler) \
            -> Optional[list[BaseTool]]:
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
                'search_method': 'semantic_search',
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
