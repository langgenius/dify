import logging
from typing import cast, Optional, List

from langchain import WikipediaAPIWrapper
from langchain.callbacks.base import BaseCallbackHandler
from langchain.tools import BaseTool, WikipediaQueryRun, Tool
from pydantic import BaseModel, Field

from core.agent.agent.agent_llm_callback import AgentLLMCallback
from core.agent.agent_executor import PlanningStrategy, AgentConfiguration, AgentExecutor
from core.application_queue_manager import ApplicationQueueManager
from core.callback_handler.agent_loop_gather_callback_handler import AgentLoopGatherCallbackHandler
from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
from core.callback_handler.std_out_callback_handler import DifyStdOutCallbackHandler
from core.entities.application_entities import ModelConfigEntity, InvokeFrom, \
    AgentEntity, AgentToolEntity, AppOrchestrationConfigEntity
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_runtime.entities.model_entities import ModelFeature, ModelType
from core.model_runtime.model_providers import model_provider_factory
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.tool.current_datetime_tool import DatetimeTool
from core.tool.dataset_retriever_tool import DatasetRetrieverTool
from core.tool.provider.serpapi_provider import SerpAPIToolProvider
from core.tool.serpapi_wrapper import OptimizedSerpAPIWrapper, OptimizedSerpAPIInput
from core.tool.web_reader_tool import WebReaderTool
from extensions.ext_database import db
from models.dataset import Dataset
from models.model import Message

logger = logging.getLogger(__name__)


class AgentRunnerFeature:
    def __init__(self, tenant_id: str,
                 app_orchestration_config: AppOrchestrationConfigEntity,
                 model_config: ModelConfigEntity,
                 config: AgentEntity,
                 queue_manager: ApplicationQueueManager,
                 message: Message,
                 user_id: str,
                 agent_llm_callback: AgentLLMCallback,
                 callback: AgentLoopGatherCallbackHandler,
                 memory: Optional[TokenBufferMemory] = None,) -> None:
        """
        Agent runner
        :param tenant_id: tenant id
        :param app_orchestration_config: app orchestration config
        :param model_config: model config
        :param config: dataset config
        :param queue_manager: queue manager
        :param message: message
        :param user_id: user id
        :param agent_llm_callback: agent llm callback
        :param callback: callback
        :param memory: memory
        """
        self.tenant_id = tenant_id
        self.app_orchestration_config = app_orchestration_config
        self.model_config = model_config
        self.config = config
        self.queue_manager = queue_manager
        self.message = message
        self.user_id = user_id
        self.agent_llm_callback = agent_llm_callback
        self.callback = callback
        self.memory = memory

    def run(self, query: str,
            invoke_from: InvokeFrom) -> Optional[str]:
        """
        Retrieve agent loop result.
        :param query: query
        :param invoke_from: invoke from
        :return:
        """
        provider = self.config.provider
        model = self.config.model
        tool_configs = self.config.tools

        # check model is support tool calling
        provider_instance = model_provider_factory.get_provider_instance(provider=provider)
        model_type_instance = provider_instance.get_model_instance(ModelType.LLM)
        model_type_instance = cast(LargeLanguageModel, model_type_instance)

        # get model schema
        model_schema = model_type_instance.get_model_schema(
            model=model,
            credentials=self.model_config.credentials
        )

        if not model_schema:
            return None

        planning_strategy = PlanningStrategy.REACT
        features = model_schema.features
        if features:
            if ModelFeature.TOOL_CALL in features \
                    or ModelFeature.MULTI_TOOL_CALL in features:
                planning_strategy = PlanningStrategy.FUNCTION_CALL

        tools = self.to_tools(
            tool_configs=tool_configs,
            invoke_from=invoke_from,
            callbacks=[self.callback, DifyStdOutCallbackHandler()],
        )

        if len(tools) == 0:
            return None

        agent_configuration = AgentConfiguration(
            strategy=planning_strategy,
            model_config=self.model_config,
            tools=tools,
            memory=self.memory,
            max_iterations=10,
            max_execution_time=400.0,
            early_stopping_method="generate",
            agent_llm_callback=self.agent_llm_callback,
            callbacks=[self.callback, DifyStdOutCallbackHandler()]
        )

        agent_executor = AgentExecutor(agent_configuration)

        try:
            # check if should use agent
            should_use_agent = agent_executor.should_use_agent(query)
            if not should_use_agent:
                return None

            result = agent_executor.run(query)
            return result.output
        except Exception as ex:
            logger.exception("agent_executor run failed")
            return None

    def to_tools(self, tool_configs: list[AgentToolEntity],
                 invoke_from: InvokeFrom,
                 callbacks: list[BaseCallbackHandler]) \
            -> Optional[List[BaseTool]]:
        """
        Convert tool configs to tools
        :param tool_configs: tool configs
        :param invoke_from: invoke from
        :param callbacks: callbacks
        """
        tools = []
        for tool_config in tool_configs:
            tool = None
            if tool_config.tool_id == "dataset":
                tool = self.to_dataset_retriever_tool(
                    tool_config=tool_config.config,
                    invoke_from=invoke_from
                )
            elif tool_config.tool_id == "web_reader":
                tool = self.to_web_reader_tool(
                    tool_config=tool_config.config,
                    invoke_from=invoke_from
                )
            elif tool_config.tool_id == "google_search":
                tool = self.to_google_search_tool(
                    tool_config=tool_config.config,
                    invoke_from=invoke_from
                )
            elif tool_config.tool_id == "wikipedia":
                tool = self.to_wikipedia_tool(
                    tool_config=tool_config.config,
                    invoke_from=invoke_from
                )
            elif tool_config.tool_id == "current_datetime":
                tool = self.to_current_datetime_tool(
                    tool_config=tool_config.config,
                    invoke_from=invoke_from
                )

            if tool:
                if tool.callbacks is not None:
                    tool.callbacks.extend(callbacks)
                else:
                    tool.callbacks = callbacks

                tools.append(tool)

        return tools

    def to_dataset_retriever_tool(self, tool_config: dict,
                                  invoke_from: InvokeFrom) \
            -> Optional[BaseTool]:
        """
        A dataset tool is a tool that can be used to retrieve information from a dataset
        :param tool_config: tool config
        :param invoke_from: invoke from
        """
        show_retrieve_source = self.app_orchestration_config.show_retrieve_source

        hit_callback = DatasetIndexToolCallbackHandler(
            queue_manager=self.queue_manager,
            app_id=self.message.app_id,
            message_id=self.message.id,
            user_id=self.user_id,
            invoke_from=invoke_from
        )

        # get dataset from dataset id
        dataset = db.session.query(Dataset).filter(
            Dataset.tenant_id == self.tenant_id,
            Dataset.id == tool_config.get("id")
        ).first()

        # pass if dataset is not available
        if not dataset:
            return None

        # pass if dataset is not available
        if (dataset and dataset.available_document_count == 0
                and dataset.available_document_count == 0):
            return None

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
            return_resource=show_retrieve_source,
            retriever_from=invoke_from.to_source()
        )

        return tool

    def to_web_reader_tool(self, tool_config: dict,
                           invoke_from: InvokeFrom) -> Optional[BaseTool]:
        """
        A tool for reading web pages
        :param tool_config: tool config
        :param invoke_from: invoke from
        :return:
        """
        model_parameters = {
            "temperature": 0,
            "max_tokens": 500
        }

        tool = WebReaderTool(
            model_config=self.model_config,
            model_parameters=model_parameters,
            max_chunk_length=4000,
            continue_reading=True
        )

        return tool

    def to_google_search_tool(self, tool_config: dict,
                              invoke_from: InvokeFrom) -> Optional[BaseTool]:
        """
        A tool for performing a Google search and extracting snippets and webpages
        :param tool_config: tool config
        :param invoke_from: invoke from
        :return:
        """
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

    def to_current_datetime_tool(self, tool_config: dict,
                                 invoke_from: InvokeFrom) -> Optional[BaseTool]:
        """
        A tool for getting the current date and time
        :param tool_config: tool config
        :param invoke_from: invoke from
        :return:
        """
        return DatetimeTool()

    def to_wikipedia_tool(self, tool_config: dict,
                          invoke_from: InvokeFrom) -> Optional[BaseTool]:
        """
        A tool for searching Wikipedia
        :param tool_config: tool config
        :param invoke_from: invoke from
        :return:
        """
        class WikipediaInput(BaseModel):
            query: str = Field(..., description="search query.")

        return WikipediaQueryRun(
            name="wikipedia",
            api_wrapper=WikipediaAPIWrapper(doc_content_chars_max=4000),
            args_schema=WikipediaInput
        )
