from llama_index.indices.query.base import IS
from typing import (
    Any,
    Dict,
    List,
    Optional
)

from llama_index.docstore import BaseDocumentStore
from llama_index.indices.postprocessor.node import (
    BaseNodePostprocessor,
)
from llama_index.indices.vector_store import GPTVectorStoreIndexQuery
from llama_index.indices.response.response_builder import ResponseMode
from llama_index.indices.service_context import ServiceContext
from llama_index.optimization.optimizer import BaseTokenUsageOptimizer
from llama_index.prompts.prompts import (
    QuestionAnswerPrompt,
    RefinePrompt,
    SimpleInputPrompt,
)

from core.index.query.synthesizer import EnhanceResponseSynthesizer


class EnhanceGPTVectorStoreIndexQuery(GPTVectorStoreIndexQuery):
    @classmethod
    def from_args(
            cls,
            index_struct: IS,
            service_context: ServiceContext,
            docstore: Optional[BaseDocumentStore] = None,
            node_postprocessors: Optional[List[BaseNodePostprocessor]] = None,
            verbose: bool = False,
            # response synthesizer args
            response_mode: ResponseMode = ResponseMode.DEFAULT,
            text_qa_template: Optional[QuestionAnswerPrompt] = None,
            refine_template: Optional[RefinePrompt] = None,
            simple_template: Optional[SimpleInputPrompt] = None,
            response_kwargs: Optional[Dict] = None,
            use_async: bool = False,
            streaming: bool = False,
            optimizer: Optional[BaseTokenUsageOptimizer] = None,
            # class-specific args
            **kwargs: Any,
    ) -> "BaseGPTIndexQuery":
        response_synthesizer = EnhanceResponseSynthesizer.from_args(
            service_context=service_context,
            text_qa_template=text_qa_template,
            refine_template=refine_template,
            simple_template=simple_template,
            response_mode=response_mode,
            response_kwargs=response_kwargs,
            use_async=use_async,
            streaming=streaming,
            optimizer=optimizer,
        )
        return cls(
            index_struct=index_struct,
            service_context=service_context,
            response_synthesizer=response_synthesizer,
            docstore=docstore,
            node_postprocessors=node_postprocessors,
            verbose=verbose,
            **kwargs,
        )
