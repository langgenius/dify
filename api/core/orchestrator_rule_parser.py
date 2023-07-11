import math
from typing import Optional

from langchain import WikipediaAPIWrapper
from langchain.callbacks.manager import Callbacks
from langchain.memory.chat_memory import BaseChatMemory
from langchain.tools import BaseTool, Tool, WikipediaQueryRun

from core.agent.agent_executor import AgentExecutor, PlanningStrategy, AgentConfiguration
from core.callback_handler.dataset_tool_callback_handler import DatasetToolCallbackHandler
from core.callback_handler.std_out_callback_handler import DifyStdOutCallbackHandler
from core.chain.sensitive_word_avoidance_chain import SensitiveWordAvoidanceChain
from core.conversation_message_task import ConversationMessageTask
from core.llm.llm_builder import LLMBuilder
from core.llm.streamable_chat_open_ai import StreamableChatOpenAI
from core.tool.dataset_retriever_tool import DatasetRetrieverTool
from core.tool.provider.serpapi_provider import SerpAPIToolProvider
from core.tool.serpapi_wrapper import OptimizedSerpAPIWrapper
from core.tool.web_reader_tool import WebReaderTool
from extensions.ext_database import db
from models.dataset import Dataset, DatasetProcessRule
from models.model import AppModelConfig


class OrchestratorRuleParser:
    """Parse the orchestrator rule to entities."""

    def __init__(self, tenant_id: str, app_model_config: AppModelConfig):
        self.tenant_id = tenant_id
        self.app_model_config = app_model_config
        self.agent_summary_model_name = "gpt-3.5-turbo-16k"

    def to_agent_executor(self, conversation_message_task: ConversationMessageTask, memory: Optional[BaseChatMemory],
                       rest_tokens: int, callbacks: Callbacks = None) \
            -> Optional[AgentExecutor]:
        if not self.app_model_config.agent_mode_dict:
            return None

        agent_mode_config = self.app_model_config.agent_mode_dict

        chain = None
        if agent_mode_config and agent_mode_config.get('enabled'):
            tool_configs = agent_mode_config.get('tools', [])
            agent_model_name = agent_mode_config.get('model_name', 'gpt-4')

            agent_llm = LLMBuilder.to_llm(
                tenant_id=self.tenant_id,
                model_name=agent_model_name,
                temperature=0,
                max_tokens=800,
                callbacks=[DifyStdOutCallbackHandler()]
            )

            planning_strategy = PlanningStrategy(agent_mode_config.get('strategy', 'router'))

            # only OpenAI chat model support function call, use ReACT instead
            if not isinstance(agent_llm, StreamableChatOpenAI) \
                    and planning_strategy in [PlanningStrategy.FUNCTION_CALL, PlanningStrategy.MULTI_FUNCTION_CALL]:
                planning_strategy = PlanningStrategy.REACT

            summary_llm = LLMBuilder.to_llm(
                tenant_id=self.tenant_id,
                model_name=self.agent_summary_model_name,
                temperature=0,
                max_tokens=500,
                callbacks=[DifyStdOutCallbackHandler()]
            )

            tools = self.to_tools(tool_configs, conversation_message_task, rest_tokens)

            if len(tools) == 0:
                return None

            agent_configuration = AgentConfiguration(
                strategy=planning_strategy,
                llm=agent_llm,
                tools=tools,
                summary_llm=summary_llm,
                memory=memory,
                callbacks=callbacks,
                max_iterations=6,
                max_execution_time=None,
                early_stopping_method="generate"
            )

            return AgentExecutor(agent_configuration)

        return chain

    def to_sensitive_word_avoidance_chain(self, callbacks: Callbacks = None, **kwargs) \
            -> Optional[SensitiveWordAvoidanceChain]:
        """
        Convert app sensitive word avoidance config to chain

        :param kwargs:
        :return:
        """
        if not self.app_model_config.sensitive_word_avoidance_dict:
            return None

        sensitive_word_avoidance_config = self.app_model_config.sensitive_word_avoidance_dict
        sensitive_words = sensitive_word_avoidance_config.get("words", "")
        if sensitive_word_avoidance_config.get("enabled", False) and sensitive_words:
            return SensitiveWordAvoidanceChain(
                sensitive_words=sensitive_words.split(","),
                canned_response=sensitive_word_avoidance_config.get("canned_response", ''),
                output_key="sensitive_word_avoidance_output",
                callbacks=callbacks,
                **kwargs
            )

        return None

    def to_tools(self, tool_configs: list, conversation_message_task: ConversationMessageTask,
                 rest_tokens: int) -> list[BaseTool]:
        """
        Convert app agent tool configs to tools

        :param rest_tokens:
        :param tool_configs: app agent tool configs
        :param conversation_message_task:
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
                tool = self.to_dataset_retriever_tool(tool_val, conversation_message_task, rest_tokens)
            elif tool_type == "web_reader":
                tool = self.to_web_reader_tool()
            elif tool_type == "google_search":
                tool = self.to_google_search_tool()
            elif tool_type == "wikipedia":
                tool = self.to_wikipedia_tool()

            if tool:
                tools.append(tool)

        return tools

    def to_dataset_retriever_tool(self, tool_config: dict, conversation_message_task: ConversationMessageTask,
                                  rest_tokens: int) \
            -> Optional[BaseTool]:
        """
        A dataset tool is a tool that can be used to retrieve information from a dataset
        :param rest_tokens:
        :param tool_config:
        :param conversation_message_task:
        :return:
        """
        # get dataset from dataset id
        dataset = db.session.query(Dataset).filter(
            Dataset.tenant_id == self.tenant_id,
            Dataset.id == tool_config.get("id")
        ).first()

        if dataset and dataset.available_document_count == 0 and dataset.available_document_count == 0:
            return None

        k = self._dynamic_calc_retrieve_k(dataset, rest_tokens)
        tool = DatasetRetrieverTool.from_dataset(
            dataset=dataset,
            k=k,
            callbacks=[DatasetToolCallbackHandler(conversation_message_task), DifyStdOutCallbackHandler()]
        )

        return tool

    def to_web_reader_tool(self) -> Optional[BaseTool]:
        """
        A tool for reading web pages

        :return:
        """
        summary_llm = LLMBuilder.to_llm(
            tenant_id=self.tenant_id,
            model_name="gpt-3.5-turbo-16k",
            temperature=0,
            max_tokens=500,
            callbacks=[DifyStdOutCallbackHandler()]
        )

        tool = WebReaderTool(
            llm=summary_llm,
            max_chunk_length=4000,
            continue_reading=True,
            callbacks=[DifyStdOutCallbackHandler()]
        )

        return tool

    def to_google_search_tool(self) -> Optional[BaseTool]:
        tool_provider = SerpAPIToolProvider(tenant_id=self.tenant_id)
        func_kwargs = tool_provider.credentials_to_func_kwargs()
        if not func_kwargs:
            return None

        tool = Tool(
            name="google_search",
            description="A tool for performing a Google search and extracting snippets and webpages "
                        "when you need to search for something you don't know or when your information "
                        "is not up to date."
                        "Input should be a search query.",
            func=OptimizedSerpAPIWrapper(**func_kwargs).run,
            callbacks=[DifyStdOutCallbackHandler()]
        )

        return tool

    def to_wikipedia_tool(self) -> Optional[BaseTool]:
        return WikipediaQueryRun(
            api_wrapper=WikipediaAPIWrapper(doc_content_chars_max=4000),
            callbacks=[DifyStdOutCallbackHandler()]
        )

    @classmethod
    def _dynamic_calc_retrieve_k(cls, dataset: Dataset, rest_tokens: int) -> int:
        DEFAULT_K = 2
        CONTEXT_TOKENS_PERCENT = 0.3
        processing_rule = dataset.latest_process_rule
        if not processing_rule:
            return DEFAULT_K

        if processing_rule.mode == "custom":
            rules = processing_rule.rules_dict
            if not rules:
                return DEFAULT_K

            segmentation = rules["segmentation"]
            segment_max_tokens = segmentation["max_tokens"]
        else:
            segment_max_tokens = DatasetProcessRule.AUTOMATIC_RULES['segmentation']['max_tokens']

        # when rest_tokens is less than default context tokens
        if rest_tokens < segment_max_tokens * DEFAULT_K:
            return rest_tokens // segment_max_tokens

        context_limit_tokens = math.floor(rest_tokens * CONTEXT_TOKENS_PERCENT)

        # when context_limit_tokens is less than default context tokens, use default_k
        if context_limit_tokens <= segment_max_tokens * DEFAULT_K:
            return DEFAULT_K

        # Expand the k value when there's still some room left in the 30% rest tokens space
        return context_limit_tokens // segment_max_tokens
