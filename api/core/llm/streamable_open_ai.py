from langchain.schema import LLMResult
from typing import Optional, List
from langchain import OpenAI

from core.llm.error_handle_wraps import handle_llm_exceptions, handle_llm_exceptions_async


class StreamableOpenAI(OpenAI):

    @handle_llm_exceptions
    def generate(
            self, prompts: List[str], stop: Optional[List[str]] = None
    ) -> LLMResult:
        return super().generate(prompts, stop)

    @handle_llm_exceptions_async
    async def agenerate(
            self, prompts: List[str], stop: Optional[List[str]] = None
    ) -> LLMResult:
        return await super().agenerate(prompts, stop)
