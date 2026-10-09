from collections.abc import Generator
from typing import Any, Protocol, override, runtime_checkable

from sqlalchemy.orm import Session

from core.app.app_config.entities import DatasetRetrieveConfigEntity
from core.app.entities.app_invoke_entities import InvokeFrom
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
from services.knowledge.retrieval.adapters.resource_events import DatasetIndexToolCallbackHandler
from services.knowledge.retrieval.ports import DatasetRetrievalFactory, KnowledgeRetrievalRecords


@runtime_checkable
class DatasetToolRetrieval(Protocol):
    def retrieve_dataset(
        self,
        *,
        tenant_id: str,
        app_id: str,
        user_id: str,
        dataset_id: str,
        query: str,
        config: DatasetRetrieveConfigEntity,
        top_k: int,
        inputs: dict[str, Any],
        invoke_from: InvokeFrom,
        return_resource: bool,
        hit_callback: DatasetIndexToolCallbackHandler,
    ) -> str: ...


class DatasetRetrieverTool(Tool):
    def __init__(
        self,
        entity: ToolEntity,
        runtime: ToolRuntime,
        *,
        retrieval: DatasetToolRetrieval,
        dataset_id: str,
        config: DatasetRetrieveConfigEntity,
        top_k: int,
        inputs: dict[str, Any],
        invoke_from: InvokeFrom,
        return_resource: bool,
        hit_callback: DatasetIndexToolCallbackHandler,
        app_id: str,
    ):
        super().__init__(entity, runtime)
        self._retrieval = retrieval
        self._dataset_id = dataset_id
        self._config = config
        self._top_k = top_k
        self._inputs = inputs
        self._invoke_from = invoke_from
        self._return_resource = return_resource
        self._hit_callback = hit_callback
        self._app_id = app_id

    @staticmethod
    def get_dataset_tools(
        records: KnowledgeRetrievalRecords,
        retrieval: DatasetRetrievalFactory,
        tenant_id: str,
        app_id: str,
        dataset_ids: list[str],
        retrieve_config: DatasetRetrieveConfigEntity | None,
        return_resource: bool,
        invoke_from: InvokeFrom,
        hit_callback: DatasetIndexToolCallbackHandler,
        user_id: str,
        inputs: dict[str, Any],
    ) -> list["DatasetRetrieverTool"]:
        if not dataset_ids or retrieve_config is None:
            return []
        feature = retrieval()
        if not isinstance(feature, DatasetToolRetrieval):
            raise TypeError("dataset retrieval factory does not support dataset tool invocation")
        tools = []
        for dataset in records.available_datasets(tenant_id, dataset_ids):
            description = dataset.description or "useful for when you want to answer queries about the " + dataset.name
            tool = DatasetRetrieverTool(
                retrieval=feature,
                dataset_id=dataset.id,
                config=retrieve_config.model_copy(deep=True),
                top_k=(dataset.retrieval_model or {}).get("top_k", 2),
                inputs=inputs,
                invoke_from=invoke_from,
                return_resource=return_resource,
                hit_callback=hit_callback,
                app_id=app_id,
                entity=ToolEntity(
                    identity=ToolIdentity(
                        provider="",
                        author="",
                        name=f"dataset_{dataset.id.replace('-', '_')}",
                        label=I18nObject(en_US="", zh_Hans=""),
                    ),
                    parameters=[],
                    description=ToolDescription(
                        human=I18nObject(en_US="", zh_Hans=""), llm=description.replace("\n", "").replace("\r", "")
                    ),
                ),
                runtime=ToolRuntime(tenant_id=tenant_id, user_id=user_id),
            )
            tools.append(tool)
        return tools

    @override
    def fork_tool_runtime(self, runtime: ToolRuntime) -> "DatasetRetrieverTool":
        return DatasetRetrieverTool(
            entity=self.entity.model_copy(deep=True),
            runtime=runtime,
            retrieval=self._retrieval,
            dataset_id=self._dataset_id,
            config=self._config.model_copy(deep=True),
            top_k=self._top_k,
            inputs=self._inputs.copy(),
            invoke_from=self._invoke_from,
            return_resource=self._return_resource,
            hit_callback=self._hit_callback,
            app_id=self._app_id,
        )

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
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        invoke dataset retriever tool
        """
        query = tool_parameters.get("query")
        if not query:
            yield self.create_text_message(text="please input query")
        else:
            result = self._retrieval.retrieve_dataset(
                tenant_id=self.runtime.tenant_id,
                app_id=self._app_id,
                user_id=user_id,
                dataset_id=self._dataset_id,
                query=query,
                config=self._config,
                top_k=self._top_k,
                inputs=self._inputs,
                invoke_from=self._invoke_from,
                return_resource=self._return_resource,
                hit_callback=self._hit_callback,
            )
            yield self.create_text_message(text=result)

    def validate_credentials(
        self, credentials: dict[str, Any], parameters: dict[str, Any], format_only: bool = False
    ) -> str | None:
        """
        validate the credentials for dataset retriever tool
        """
        pass
