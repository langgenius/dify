from typing import Optional

from langchain import WikipediaAPIWrapper
from langchain.callbacks.manager import Callbacks
from langchain.memory.chat_memory import BaseChatMemory
from langchain.tools import BaseTool, Tool, WikipediaQueryRun
from pydantic import BaseModel, Field

from core.agent.agent_executor import AgentExecutor, PlanningStrategy, AgentConfiguration
from core.callback_handler.agent_loop_gather_callback_handler import AgentLoopGatherCallbackHandler
from core.callback_handler.dataset_tool_callback_handler import DatasetToolCallbackHandler
from core.callback_handler.main_chain_gather_callback_handler import MainChainGatherCallbackHandler
from core.callback_handler.std_out_callback_handler import DifyStdOutCallbackHandler
from core.chain.sensitive_word_avoidance_chain import SensitiveWordAvoidanceChain, SensitiveWordAvoidanceRule
from core.conversation_message_task import ConversationMessageTask
from core.model_providers.error import ProviderTokenNotInitError
from core.model_providers.model_factory import ModelFactory
from core.model_providers.models.entity.model_params import ModelKwargs, ModelMode
from core.model_providers.models.llm.base import BaseLLM
from core.tool.current_datetime_tool import DatetimeTool
from core.tool.dataset_retriever_tool import DatasetRetrieverTool
from core.tool.provider.serpapi_provider import SerpAPIToolProvider
from core.tool.serpapi_wrapper import OptimizedSerpAPIWrapper, OptimizedSerpAPIInput
from core.tool.web_reader_tool import WebReaderTool
from extensions.ext_database import db
from models.dataset import Dataset, DatasetProcessRule
from models.model import AppModelConfig


class OrchestratorRuleParser:
    """Parse the orchestrator rule to entities."""

    def __init__(self, tenant_id: str, app_model_config: AppModelConfig):
        self.tenant_id = tenant_id
        self.app_model_config = app_model_config

    def to_agent_executor(self, conversation_message_task: ConversationMessageTask, memory: Optional[BaseChatMemory],
                          rest_tokens: int, chain_callback: MainChainGatherCallbackHandler,
                          return_resource: bool = False, retriever_from: str = 'dev') -> Optional[AgentExecutor]:
        if not self.app_model_config.agent_mode_dict:
            return None

        agent_mode_config = self.app_model_config.agent_mode_dict
        model_dict = self.app_model_config.model_dict

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
            if agent_model_instance.model_mode != ModelMode.CHAT \
                    or agent_model_instance.model_provider.provider_name not in ['openai', 'azure_openai']:
                if planning_strategy in [PlanningStrategy.FUNCTION_CALL, PlanningStrategy.MULTI_FUNCTION_CALL]:
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
                dataset_configs=dataset_configs
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

    def to_sensitive_word_avoidance_chain(self, model_instance: BaseLLM, callbacks: Callbacks = None, **kwargs) \
            -> Optional[SensitiveWordAvoidanceChain]:
        """
        Convert app sensitive word avoidance config to chain

        :param model_instance: model instance
        :param callbacks: callbacks for the chain
        :param kwargs:
        :return:
        """
        sensitive_word_avoidance_rule = None

        if self.app_model_config.sensitive_word_avoidance_dict:
            sensitive_word_avoidance_config = self.app_model_config.sensitive_word_avoidance_dict
            if sensitive_word_avoidance_config.get("enabled", False):
                if sensitive_word_avoidance_config.get('type') == 'moderation':
                    sensitive_word_avoidance_rule = SensitiveWordAvoidanceRule(
                        type=SensitiveWordAvoidanceRule.Type.MODERATION,
                        canned_response=sensitive_word_avoidance_config.get("canned_response")
                        if sensitive_word_avoidance_config.get("canned_response")
                        else 'Your content violates our usage policy. Please revise and try again.',
                    )
                else:
                    sensitive_words = sensitive_word_avoidance_config.get("words", "")
                    if sensitive_words:
                        sensitive_word_avoidance_rule = SensitiveWordAvoidanceRule(
                            type=SensitiveWordAvoidanceRule.Type.KEYWORDS,
                            canned_response=sensitive_word_avoidance_config.get("canned_response")
                            if sensitive_word_avoidance_config.get("canned_response")
                            else 'Your content violates our usage policy. Please revise and try again.',
                            extra_params={
                                'sensitive_words': sensitive_words.split(','),
                            }
                        )

        if sensitive_word_avoidance_rule:
            return SensitiveWordAvoidanceChain(
                model_instance=model_instance,
                sensitive_word_avoidance_rule=sensitive_word_avoidance_rule,
                output_key="sensitive_word_avoidance_output",
                callbacks=callbacks,
                **kwargs
            )

        return None

    def to_tools(self, tool_configs: list, callbacks: Callbacks = None, **kwargs) -> list[BaseTool]:
        """
        Convert app agent tool configs to tools

        :param tool_configs: app agent tool configs
        :param callbacks:
        :return:
        """
        tools = []
        for tool_config in tool_configs:
            tool_type = list(tool_config.keys())[0]
            tool_val = list(tool_config.values())[0]
            if not tool_val.get("enabled") or tool_val.get("enabled") is not True:
                continue

            tool = None
            if tool_type == "dataset":
                tool = self.to_dataset_retriever_tool(tool_config=tool_val, **kwargs)
            elif tool_type == "web_reader":
                tool = self.to_web_reader_tool(tool_config=tool_val, **kwargs)
            elif tool_type == "google_search":
                tool = self.to_google_search_tool(tool_config=tool_val, **kwargs)
            elif tool_type == "wikipedia":
                tool = self.to_wikipedia_tool(tool_config=tool_val, **kwargs)
            elif tool_type == "current_datetime":
                tool = self.to_current_datetime_tool(tool_config=tool_val, **kwargs)

            if tool:
                tool.callbacks.extend(callbacks)
                tools.append(tool)

        return tools

    def to_dataset_retriever_tool(self, tool_config: dict, conversation_message_task: ConversationMessageTask,
                                  dataset_configs: dict, rest_tokens: int,
                                  return_resource: bool = False, retriever_from: str = 'dev',
                                  **kwargs) \
            -> Optional[BaseTool]:
        """
        A dataset tool is a tool that can be used to retrieve information from a dataset
        :param rest_tokens:
        :param tool_config:
        :param dataset_configs:
        :param conversation_message_task:
        :param return_resource:
        :param retriever_from:
        :return:
        """
        # get dataset from dataset id
        dataset = db.session.query(Dataset).filter(
            Dataset.tenant_id == self.tenant_id,
            Dataset.id == tool_config.get("id")
        ).first()

        if not dataset:
            return None

        if dataset and dataset.available_document_count == 0 and dataset.available_document_count == 0:
            return None

        top_k = dataset_configs.get("top_k", 2)

        # dynamically adjust top_k when the remaining token number is not enough to support top_k
        top_k = self._dynamic_calc_retrieve_k(dataset=dataset, top_k=top_k, rest_tokens=rest_tokens)

        score_threshold = None
        score_threshold_config = dataset_configs.get("score_threshold")
        if score_threshold_config and score_threshold_config.get("enable"):
            score_threshold = score_threshold_config.get("value")

        tool = DatasetRetrieverTool.from_dataset(
            dataset=dataset,
            top_k=top_k,
            score_threshold=score_threshold,
            callbacks=[DatasetToolCallbackHandler(conversation_message_task)],
            conversation_message_task=conversation_message_task,
            return_resource=return_resource,
            retriever_from=retriever_from
        )

        return tool

    def to_web_reader_tool(self, agent_model_instance: BaseLLM, **kwargs) -> Optional[BaseTool]:
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
            llm=summary_model_instance.client if summary_model_instance else None,
            max_chunk_length=4000,
            continue_reading=True,
            callbacks=[DifyStdOutCallbackHandler()]
        )

        return tool

    def to_google_search_tool(self, **kwargs) -> Optional[BaseTool]:
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
            args_schema=OptimizedSerpAPIInput,
            callbacks=[DifyStdOutCallbackHandler()]
        )

        return tool

    def to_current_datetime_tool(self, **kwargs) -> Optional[BaseTool]:
        tool = DatetimeTool(
            callbacks=[DifyStdOutCallbackHandler()]
        )

        return tool

    def to_wikipedia_tool(self, **kwargs) -> Optional[BaseTool]:
        class WikipediaInput(BaseModel):
            query: str = Field(..., description="search query.")

        return WikipediaQueryRun(
            name="wikipedia",
            api_wrapper=WikipediaAPIWrapper(doc_content_chars_max=4000),
            args_schema=WikipediaInput,
            callbacks=[DifyStdOutCallbackHandler()]
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
