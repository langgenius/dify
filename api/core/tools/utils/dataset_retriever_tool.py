from collections.abc import Generator
from typing import Any, override

from sqlalchemy.orm import Session

from core.app.app_config.entities import DatasetRetrieveConfigEntity
from core.app.entities.app_invoke_entities import InvokeFrom
from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
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
from core.tools.utils.dataset_retriever.dataset_retriever_tool import DatasetRetrieverTool as DatasetQueryTool
from enums.creator import CreatorUserRole
from services.knowledge.retrieval.retrieval import KnowledgeRetriever


class DatasetRetrieverTool(Tool):
    def __init__(self, entity: ToolEntity, runtime: ToolRuntime, retrieval_tool: DatasetRetrieverBaseTool):
        super().__init__(entity, runtime)
        self.retrieval_tool = retrieval_tool

    @staticmethod
    def get_dataset_tools(
        knowledge_retrieval: KnowledgeRetriever,
        app_id: str,
        tenant_id: str,
        dataset_ids: list[str],
        retrieve_config: DatasetRetrieveConfigEntity | None,
        return_resource: bool,
        invoke_from: InvokeFrom,
        hit_callback: DatasetIndexToolCallbackHandler,
        user_id: str,
        inputs: dict[str, Any],
    ) -> list["DatasetRetrieverTool"]:
        """
        get dataset tool
        """
        # check if retrieve_config is valid
        if dataset_ids is None or len(dataset_ids) == 0:
            return []
        if retrieve_config is None:
            return []

        available_datasets = knowledge_retrieval.list_datasets(tenant_id=tenant_id, dataset_ids=dataset_ids)

        user_from = (
            CreatorUserRole.ACCOUNT
            if invoke_from in {InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER}
            else CreatorUserRole.END_USER
        )
        metadata_inputs = {str(key): str(value) for key, value in inputs.items()}
        retrieval_tools: list[DatasetRetrieverBaseTool] = []
        for dataset in available_datasets:
            retrieval_tools.append(
                DatasetQueryTool.from_dataset(
                    dataset=dataset,
                    tenant_id=tenant_id,
                    app_id=app_id,
                    user_id=user_id,
                    user_from=user_from.value,
                    hit_callbacks=[hit_callback],
                    return_resource=return_resource,
                    retriever_from=invoke_from.to_source(),
                    retrieve_config=retrieve_config,
                    metadata_inputs=metadata_inputs,
                    knowledge_retrieval=knowledge_retrieval,
                )
            )

        # convert retrieval tools to Tools
        tools: list[DatasetRetrieverTool] = []
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

    @override
    def get_runtime_parameters(
        self,
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
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

    @override
    def tool_provider_type(self) -> ToolProviderType:
        return ToolProviderType.DATASET_RETRIEVAL

    @override
    def _invoke(
        self,
        session: Session,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage]:
        """
        invoke dataset retriever tool
        """
        query = tool_parameters.get("query")
        if not query:
            yield self.create_text_message(text="please input query")
        else:
            # invoke dataset retriever tool
            result = self.retrieval_tool.run(query=query)
            yield self.create_text_message(text=result)

    def validate_credentials(
        self, credentials: dict[str, Any], parameters: dict[str, Any], format_only: bool = False
    ) -> str | None:
        """
        validate the credentials for dataset retriever tool
        """
        pass
