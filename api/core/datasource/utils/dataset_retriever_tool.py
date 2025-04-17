from collections.abc import Generator
from typing import Any, Optional

from core.app.app_config.entities import DatasetRetrieveConfigEntity
from core.app.entities.app_invoke_entities import InvokeFrom
from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolDescription,
    ToolEntity,
    ToolIdentity,
    ToolInvokeMessage,
    ToolParameter,
    ToolProviderType,
)
from core.tools.utils.dataset_retriever.dataset_retriever_base_tool import DatasetRetrieverBaseTool


class DatasetRetrieverTool(Tool):
    retrieval_tool: DatasetRetrieverBaseTool

    def __init__(self, entity: ToolEntity, runtime: ToolRuntime, retrieval_tool: DatasetRetrieverBaseTool) -> None:
        super().__init__(entity, runtime)
        self.retrieval_tool = retrieval_tool

    @staticmethod
    def get_dataset_tools(
        tenant_id: str,
        dataset_ids: list[str],
        retrieve_config: DatasetRetrieveConfigEntity | None,
        return_resource: bool,
        invoke_from: InvokeFrom,
        hit_callback: DatasetIndexToolCallbackHandler,
    ) -> list["DatasetRetrieverTool"]:
        """
        get dataset tool
        """
        # check if retrieve_config is valid
        if dataset_ids is None or len(dataset_ids) == 0:
            return []
        if retrieve_config is None:
            return []

        feature = DatasetRetrieval()

        # save original retrieve strategy, and set retrieve strategy to SINGLE
        # Agent only support SINGLE mode
        original_retriever_mode = retrieve_config.retrieve_strategy
        retrieve_config.retrieve_strategy = DatasetRetrieveConfigEntity.RetrieveStrategy.SINGLE
        retrieval_tools = feature.to_dataset_retriever_tool(
            tenant_id=tenant_id,
            dataset_ids=dataset_ids,
            retrieve_config=retrieve_config,
            return_resource=return_resource,
            invoke_from=invoke_from,
            hit_callback=hit_callback,
        )
        if retrieval_tools is None or len(retrieval_tools) == 0:
            return []

        # restore retrieve strategy
        retrieve_config.retrieve_strategy = original_retriever_mode

        # convert retrieval tools to Tools
        tools = []
        for retrieval_tool in retrieval_tools:
            tool = DatasetRetrieverTool(
                retrieval_tool=retrieval_tool,
                entity=ToolEntity(
                    identity=ToolIdentity(
                        provider="", author="", name=retrieval_tool.name, label=I18nObject(en_US="", zh_Hans="")
                    ),
                    parameters=[],
                    description=ToolDescription(human=I18nObject(en_US="", zh_Hans=""), llm=retrieval_tool.description),
                ),
                runtime=ToolRuntime(tenant_id=tenant_id),
            )

            tools.append(tool)

        return tools

    def get_runtime_parameters(
        self,
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> list[ToolParameter]:
        return [
            ToolParameter(
                name="query",
                label=I18nObject(en_US="", zh_Hans=""),
                human_description=I18nObject(en_US="", zh_Hans=""),
                type=ToolParameter.ToolParameterType.STRING,
                form=ToolParameter.ToolParameterForm.LLM,
                llm_description="Query for the dataset to be used to retrieve the dataset.",
                required=True,
                default="",
                placeholder=I18nObject(en_US="", zh_Hans=""),
            ),
        ]

    def tool_provider_type(self) -> ToolProviderType:
        return ToolProviderType.DATASET_RETRIEVAL

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        invoke dataset retriever tool
        """
        query = tool_parameters.get("query")
        if not query:
            yield self.create_text_message(text="please input query")
        else:
            # invoke dataset retriever tool
            result = self.retrieval_tool._run(query=query)
            yield self.create_text_message(text=result)

    def validate_credentials(
        self, credentials: dict[str, Any], parameters: dict[str, Any], format_only: bool = False
    ) -> str | None:
        """
        validate the credentials for dataset retriever tool
        """
        pass
