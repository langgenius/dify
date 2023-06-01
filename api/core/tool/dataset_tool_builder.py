from typing import Optional

from langchain.callbacks import CallbackManager
from llama_index.langchain_helpers.agents import IndexToolConfig

from core.callback_handler.dataset_tool_callback_handler import DatasetToolCallbackHandler
from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
from core.callback_handler.std_out_callback_handler import DifyStdOutCallbackHandler
from core.index.keyword_table_index import KeywordTableIndex
from core.index.vector_index import VectorIndex
from core.prompt.prompts import QUERY_KEYWORD_EXTRACT_TEMPLATE
from core.tool.llama_index_tool import EnhanceLlamaIndexTool
from models.dataset import Dataset


class DatasetToolBuilder:
    @classmethod
    def build_dataset_tool(cls, dataset: Dataset,
                           response_mode: str = "no_synthesizer",
                           callback_handler: Optional[DatasetToolCallbackHandler] = None):
        if dataset.indexing_technique == "economy":
            # use keyword table query
            index = KeywordTableIndex(dataset=dataset).query_index

            if not index:
                return None

            query_kwargs = {
                "mode": "default",
                "response_mode": response_mode,
                "query_keyword_extract_template": QUERY_KEYWORD_EXTRACT_TEMPLATE,
                "max_keywords_per_query": 5,
                # If num_chunks_per_query is too large,
                # it will slow down the synthesis process due to multiple iterations of refinement.
                "num_chunks_per_query": 2
            }
        else:
            index = VectorIndex(dataset=dataset).query_index

            if not index:
                return None

            query_kwargs = {
                "mode": "default",
                "response_mode": response_mode,
                # If top_k is too large,
                # it will slow down the synthesis process due to multiple iterations of refinement.
                "similarity_top_k": 2
            }

        # fulfill description when it is empty
        description = dataset.description
        if not description:
            description = 'useful for when you want to answer queries about the ' + dataset.name

        index_tool_config = IndexToolConfig(
            index=index,
            name=f"dataset-{dataset.id}",
            description=description,
            index_query_kwargs=query_kwargs,
            tool_kwargs={
                "callback_manager": CallbackManager([callback_handler, DifyStdOutCallbackHandler()])
            },
            # tool_kwargs={"return_direct": True},
            # return_direct: Whether to return LLM results directly or process the output data with an Output Parser
        )

        index_callback_handler = DatasetIndexToolCallbackHandler(dataset_id=dataset.id)

        return EnhanceLlamaIndexTool.from_tool_config(
            tool_config=index_tool_config,
            callback_handler=index_callback_handler
        )
