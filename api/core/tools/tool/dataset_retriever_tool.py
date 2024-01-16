from typing import Any, Dict, List, Union
from core.features.dataset_retrieval import DatasetRetrievalFeature
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolParamter, ToolIdentity, ToolDescription
from core.tools.tool.tool import Tool
from core.tools.entities.common_entities import I18nObject
from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
from core.entities.application_entities import DatasetRetrieveConfigEntity, InvokeFrom

from langchain.tools import BaseTool

class DatasetRetrieverTool(Tool):
    langchain_tool: BaseTool

    @staticmethod
    def get_dataset_tools(tenant_id: str,
                         dataset_ids: list[str],
                         retrieve_config: DatasetRetrieveConfigEntity,
                         return_resource: bool,
                         invoke_from: InvokeFrom,
                         hit_callback: DatasetIndexToolCallbackHandler
    ) -> List['DatasetRetrieverTool']:
        """
        get dataset tool
        """
        # check if retrieve_config is valid
        if dataset_ids is None or len(dataset_ids) == 0:
            return []
        if retrieve_config is None:
            return []

        feature = DatasetRetrievalFeature()
        langchain_tools = feature.to_dataset_retriever_tool(
            tenant_id=tenant_id,
            dataset_ids=dataset_ids,
            retrieve_config=retrieve_config,
            return_resource=return_resource,
            invoke_from=invoke_from,
            hit_callback=hit_callback
        )
        
        # convert langchain tools to Tools
        tools = []
        for langchain_tool in langchain_tools:
            tool = DatasetRetrieverTool(
                langchain_tool=langchain_tool,
                identity=ToolIdentity(name=langchain_tool.name, label=I18nObject(en_US='', zh_Hans='')),
                parameters=[],
                is_team_authorization=True,
                description=ToolDescription(
                    human=I18nObject(en_US='', zh_Hans=''),
                    llm=langchain_tool.description)
                )
            
            tools.append(tool)

        return tools

    def get_runtime_parameters(self) -> List[ToolParamter]:
        return [
            ToolParamter(name='query',
                         label=I18nObject(en_US='', zh_Hans=''),
                         human_description=I18nObject(en_US='', zh_Hans=''),
                         form=ToolParamter.ToolParameterForm.LLM,
                         llm_description='Query for the dataset to be used to retrieve the dataset.',
                         required=True,
                         default=''),
        ]

    def _invoke(self, user_id: str, tool_paramters: Dict[str, Any]) -> ToolInvokeMessage | List[ToolInvokeMessage]:
        """
        invoke dataset retriever tool
        """
        query = tool_paramters.get('query', None)
        if not query:
            return self.create_text_message(text='please input query')
        
        # invoke dataset retriever tool
        result = self.langchain_tool._run(query=query)

        return self.create_text_message(text=result)

    def validate_credentials(self, credentails: Dict[str, Any], parameters: Dict[str, Any]) -> None:
        """
        validate the credentials for dataset retriever tool
        """
        pass