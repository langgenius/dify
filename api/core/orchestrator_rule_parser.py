import json
import threading
from typing import Optional, List

from flask import Flask
from langchain import WikipediaAPIWrapper
from langchain.callbacks.manager import Callbacks
from langchain.memory.chat_memory import BaseChatMemory
from langchain.tools import BaseTool, Tool, WikipediaQueryRun
from pydantic import BaseModel, Field

from core.agent.agent.multi_dataset_router_agent import MultiDatasetRouterAgent
from core.agent.agent.output_parser.structured_chat import StructuredChatOutputParser
from core.agent.agent.structed_multi_dataset_router_agent import StructuredMultiDatasetRouterAgent
from core.agent.agent_executor import AgentExecutor, PlanningStrategy, AgentConfiguration
from core.callback_handler.agent_loop_gather_callback_handler import AgentLoopGatherCallbackHandler
from core.callback_handler.dataset_tool_callback_handler import DatasetToolCallbackHandler
from core.callback_handler.main_chain_gather_callback_handler import MainChainGatherCallbackHandler
from core.callback_handler.std_out_callback_handler import DifyStdOutCallbackHandler
from core.conversation_message_task import ConversationMessageTask
from core.model_providers.error import ProviderTokenNotInitError
from core.model_providers.model_factory import ModelFactory
from core.model_providers.models.entity.model_params import ModelKwargs, ModelMode
from core.model_providers.models.llm.base import BaseLLM
from core.tool.current_datetime_tool import DatetimeTool
from core.tool.dataset_multi_retriever_tool import DatasetMultiRetrieverTool
from core.tool.dataset_retriever_tool import DatasetRetrieverTool
from core.tool.provider.serpapi_provider import SerpAPIToolProvider
from core.tool.serpapi_wrapper import OptimizedSerpAPIWrapper, OptimizedSerpAPIInput
from core.tool.web_reader_tool import WebReaderTool
from extensions.ext_database import db
from models.dataset import Dataset, DatasetProcessRule
from models.model import AppModelConfig

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

class OrchestratorRuleParser:
    """Parse the orchestrator rule to entities."""

    def __init__(self, tenant_id: str, app_model_config: AppModelConfig):
        self.tenant_id = tenant_id
        self.app_model_config = app_model_config

    def to_agent_executor(self, conversation_message_task: ConversationMessageTask, memory: Optional[BaseChatMemory],
                          rest_tokens: int, chain_callback: MainChainGatherCallbackHandler, tenant_id: str,
                          retriever_from: str = 'dev') -> Optional[AgentExecutor]:
        if not self.app_model_config.agent_mode_dict:
            return None

        agent_mode_config = self.app_model_config.agent_mode_dict
        model_dict = self.app_model_config.model_dict
        return_resource = self.app_model_config.retriever_resource_dict.get('enabled', False)

        chain = None
        if agent_mode_config and agent_mode_config.get('enabled'):
            tool_configs = agent_mode_config.get('tools', [])
            agent_provider_name = model_dict.get('provider', 'openai')
            agent_model_name = model_dict.get('name', 'gpt-4')
            dataset_configs = self.app_model_config.dataset_configs_dict

            agent_model_instance = ModelFactory.get_text_generation_model(
                tenant_id=self.tenant_id,
                model_provider_name=agent_provider_name,
                model_name=agent_model_name,
                model_kwargs=ModelKwargs(
                    temperature=0.2,
                    top_p=0.3,
                    max_tokens=1500
                )
            )

            # add agent callback to record agent thoughts
            agent_callback = AgentLoopGatherCallbackHandler(
                model_instance=agent_model_instance,
                conversation_message_task=conversation_message_task
            )

            chain_callback.agent_callback = agent_callback
            agent_model_instance.add_callbacks([agent_callback])

            planning_strategy = PlanningStrategy(agent_mode_config.get('strategy', 'router'))

            # only OpenAI chat model (include Azure) support function call, use ReACT instead
            if not agent_model_instance.support_function_call:
                if planning_strategy == PlanningStrategy.FUNCTION_CALL:
                    planning_strategy = PlanningStrategy.REACT
                elif planning_strategy == PlanningStrategy.ROUTER:
                    planning_strategy = PlanningStrategy.REACT_ROUTER

            try:
                summary_model_instance = ModelFactory.get_text_generation_model(
                    tenant_id=self.tenant_id,
                    model_provider_name=agent_provider_name,
                    model_name=agent_model_name,
                    model_kwargs=ModelKwargs(
                        temperature=0,
                        max_tokens=500
                    ),
                    deduct_quota=False
                )
            except ProviderTokenNotInitError as e:
                summary_model_instance = None

            tools = self.to_tools(
                tool_configs=tool_configs,
                callbacks=[agent_callback, DifyStdOutCallbackHandler()],
                agent_model_instance=agent_model_instance,
                conversation_message_task=conversation_message_task,
                rest_tokens=rest_tokens,
                return_resource=return_resource,
                retriever_from=retriever_from,
                dataset_configs=dataset_configs,
                tenant_id=tenant_id
            )

            if len(tools) == 0:
                return None

            agent_configuration = AgentConfiguration(
                strategy=planning_strategy,
                model_instance=agent_model_instance,
                tools=tools,
                summary_model_instance=summary_model_instance,
                memory=memory,
                callbacks=[chain_callback, agent_callback],
                max_iterations=10,
                max_execution_time=400.0,
                early_stopping_method="generate"
            )

            return AgentExecutor(agent_configuration)

        return chain

    def to_tools(self, tool_configs: list, callbacks: Callbacks = None,  **kwargs) -> list[BaseTool]:
        """
        Convert app agent tool configs to tools

        :param tool_configs: app agent tool configs
        :param callbacks:
        :return:
        """
        tools = []
        dataset_tools = []
        for tool_config in tool_configs:
            tool_type = list(tool_config.keys())[0]
            tool_val = list(tool_config.values())[0]
            if not tool_val.get("enabled") or tool_val.get("enabled") is not True:
                continue

            tool = None
            if tool_type == "dataset":
                dataset_tools.append(tool_config)
            elif tool_type == "web_reader":
                tool = self.to_web_reader_tool(tool_config=tool_val, **kwargs)
            elif tool_type == "google_search":
                tool = self.to_google_search_tool(tool_config=tool_val, **kwargs)
            elif tool_type == "wikipedia":
                tool = self.to_wikipedia_tool(tool_config=tool_val, **kwargs)
            elif tool_type == "current_datetime":
                tool = self.to_current_datetime_tool(tool_config=tool_val, **kwargs)

            if tool:
                if tool.callbacks is not None:
                    tool.callbacks.extend(callbacks)
                else:
                    tool.callbacks = callbacks
                tools.append(tool)
        # format dataset tool
        if len(dataset_tools) > 0:
            dataset_retriever_tools = self.to_dataset_retriever_tool(tool_configs=dataset_tools, **kwargs)
            if dataset_retriever_tools:
                tools.extend(dataset_retriever_tools)
        return tools

    def to_dataset_retriever_tool(self, tool_configs: List, conversation_message_task: ConversationMessageTask,
                                  return_resource: bool = False, retriever_from: str = 'dev',
                                  **kwargs) \
            -> Optional[List[BaseTool]]:
        """
        A dataset tool is a tool that can be used to retrieve information from a dataset
        :param tool_configs:
        :param conversation_message_task:
        :param return_resource:
        :param retriever_from:
        :return:
        """
        dataset_configs = kwargs['dataset_configs']
        retrieval_model = dataset_configs.get('retrieval_model', 'single')
        tools = []
        dataset_ids = []
        tenant_id = None
        for tool_config in tool_configs:
            # get dataset from dataset id
            dataset = db.session.query(Dataset).filter(
                Dataset.tenant_id == self.tenant_id,
                Dataset.id == tool_config.get('dataset').get("id")
            ).first()

            if not dataset:
                continue

            if dataset and dataset.available_document_count == 0 and dataset.available_document_count == 0:
                continue
            dataset_ids.append(dataset.id)
            if retrieval_model == 'single':
                retrieval_model_config = dataset.retrieval_model if dataset.retrieval_model else default_retrieval_model
                top_k = retrieval_model_config['top_k']

                # dynamically adjust top_k when the remaining token number is not enough to support top_k
                # top_k = self._dynamic_calc_retrieve_k(dataset=dataset, top_k=top_k, rest_tokens=rest_tokens)

                score_threshold = None
                score_threshold_enabled = retrieval_model_config.get("score_threshold_enabled")
                if score_threshold_enabled:
                    score_threshold = retrieval_model_config.get("score_threshold")

                tool = DatasetRetrieverTool.from_dataset(
                    dataset=dataset,
                    top_k=top_k,
                    score_threshold=score_threshold,
                    callbacks=[DatasetToolCallbackHandler(conversation_message_task)],
                    conversation_message_task=conversation_message_task,
                    return_resource=return_resource,
                    retriever_from=retriever_from
                )
                tools.append(tool)
        if retrieval_model == 'multiple':
            tool = DatasetMultiRetrieverTool.from_dataset(
                dataset_ids=dataset_ids,
                tenant_id=kwargs['tenant_id'],
                top_k=dataset_configs.get('top_k', 2),
                score_threshold=dataset_configs.get('score_threshold', 0.5) if dataset_configs.get('score_threshold_enabled', False) else None,
                callbacks=[DatasetToolCallbackHandler(conversation_message_task)],
                conversation_message_task=conversation_message_task,
                return_resource=return_resource,
                retriever_from=retriever_from,
                reranking_provider_name=dataset_configs.get('reranking_model').get('reranking_provider_name'),
                reranking_model_name=dataset_configs.get('reranking_model').get('reranking_model_name')
            )
            tools.append(tool)

        return tools

    def to_web_reader_tool(self, tool_config: dict, agent_model_instance: BaseLLM, **kwargs) -> Optional[BaseTool]:
        """
        A tool for reading web pages

        :return:
        """
        try:
            summary_model_instance = ModelFactory.get_text_generation_model(
                tenant_id=self.tenant_id,
                model_provider_name=agent_model_instance.model_provider.provider_name,
                model_name=agent_model_instance.name,
                model_kwargs=ModelKwargs(
                    temperature=0,
                    max_tokens=500
                ),
                deduct_quota=False
            )
        except ProviderTokenNotInitError:
            summary_model_instance = None

        tool = WebReaderTool(
            model_instance=summary_model_instance if summary_model_instance else None,
            max_chunk_length=4000,
            continue_reading=True
        )

        return tool

    def to_google_search_tool(self, tool_config: dict, **kwargs) -> Optional[BaseTool]:
        tool_provider = SerpAPIToolProvider(tenant_id=self.tenant_id)
        func_kwargs = tool_provider.credentials_to_func_kwargs()
        if not func_kwargs:
            return None

        tool = Tool(
            name="google_search",
            description="A tool for performing a Google search and extracting snippets and webpages "
                        "when you need to search for something you don't know or when your information "
                        "is not up to date. "
                        "Input should be a search query.",
            func=OptimizedSerpAPIWrapper(**func_kwargs).run,
            args_schema=OptimizedSerpAPIInput
        )

        return tool

    def to_current_datetime_tool(self, tool_config: dict, **kwargs) -> Optional[BaseTool]:
        tool = DatetimeTool()

        return tool

    def to_wikipedia_tool(self, tool_config: dict, **kwargs) -> Optional[BaseTool]:
        class WikipediaInput(BaseModel):
            query: str = Field(..., description="search query.")

        return WikipediaQueryRun(
            name="wikipedia",
            api_wrapper=WikipediaAPIWrapper(doc_content_chars_max=4000),
            args_schema=WikipediaInput
        )

    @classmethod
    def _dynamic_calc_retrieve_k(cls, dataset: Dataset, top_k: int, rest_tokens: int) -> int:
        if rest_tokens == -1:
            return top_k

        processing_rule = dataset.latest_process_rule
        if not processing_rule:
            return top_k

        if processing_rule.mode == "custom":
            rules = processing_rule.rules_dict
            if not rules:
                return top_k

            segmentation = rules["segmentation"]
            segment_max_tokens = segmentation["max_tokens"]
        else:
            segment_max_tokens = DatasetProcessRule.AUTOMATIC_RULES['segmentation']['max_tokens']

        # when rest_tokens is less than default context tokens
        if rest_tokens < segment_max_tokens * top_k:
            return rest_tokens // segment_max_tokens

        return min(top_k, 10)
