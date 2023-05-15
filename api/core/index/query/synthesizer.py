from typing import (
    Any,
    Dict,
    Optional, Sequence,
)

from llama_index.indices.response.response_synthesis import ResponseSynthesizer
from llama_index.indices.response.response_builder import ResponseMode, BaseResponseBuilder, get_response_builder
from llama_index.indices.service_context import ServiceContext
from llama_index.optimization.optimizer import BaseTokenUsageOptimizer
from llama_index.prompts.prompts import (
    QuestionAnswerPrompt,
    RefinePrompt,
    SimpleInputPrompt,
)
from llama_index.types import RESPONSE_TEXT_TYPE


class EnhanceResponseSynthesizer(ResponseSynthesizer):
    @classmethod
    def from_args(
            cls,
            service_context: ServiceContext,
            streaming: bool = False,
            use_async: bool = False,
            text_qa_template: Optional[QuestionAnswerPrompt] = None,
            refine_template: Optional[RefinePrompt] = None,
            simple_template: Optional[SimpleInputPrompt] = None,
            response_mode: ResponseMode = ResponseMode.DEFAULT,
            response_kwargs: Optional[Dict] = None,
            optimizer: Optional[BaseTokenUsageOptimizer] = None,
    ) -> "ResponseSynthesizer":
        response_builder: Optional[BaseResponseBuilder] = None
        if response_mode != ResponseMode.NO_TEXT:
            if response_mode == 'no_synthesizer':
                response_builder = NoSynthesizer(
                    service_context=service_context,
                    simple_template=simple_template,
                    streaming=streaming,
                )
            else:
                response_builder = get_response_builder(
                    service_context,
                    text_qa_template,
                    refine_template,
                    simple_template,
                    response_mode,
                    use_async=use_async,
                    streaming=streaming,
                )
        return cls(response_builder, response_mode, response_kwargs, optimizer)


class NoSynthesizer(BaseResponseBuilder):
    def __init__(
            self,
            service_context: ServiceContext,
            simple_template: Optional[SimpleInputPrompt] = None,
            streaming: bool = False,
    ) -> None:
        super().__init__(service_context, streaming)

    async def aget_response(
            self,
            query_str: str,
            text_chunks: Sequence[str],
            prev_response: Optional[str] = None,
            **response_kwargs: Any,
    ) -> RESPONSE_TEXT_TYPE:
        return "\n".join(text_chunks)

    def get_response(
            self,
            query_str: str,
            text_chunks: Sequence[str],
            prev_response: Optional[str] = None,
            **response_kwargs: Any,
    ) -> RESPONSE_TEXT_TYPE:
        return "\n".join(text_chunks)