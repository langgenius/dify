from enum import StrEnum
from typing import Final

ACS_ARMS_SERVICE_FEATURE: Final[str] = "acs.arms.service.feature"

# Public attributes
GEN_AI_SESSION_ID: Final[str] = "gen_ai.session.id"
GEN_AI_USER_ID: Final[str] = "gen_ai.user.id"
GEN_AI_USER_NAME: Final[str] = "gen_ai.user.name"
GEN_AI_SPAN_KIND: Final[str] = "gen_ai.span.kind"
GEN_AI_FRAMEWORK: Final[str] = "gen_ai.framework"

# Chain attributes
INPUT_VALUE: Final[str] = "input.value"
OUTPUT_VALUE: Final[str] = "output.value"

# Retriever attributes
RETRIEVAL_QUERY: Final[str] = "retrieval.query"
RETRIEVAL_DOCUMENT: Final[str] = "retrieval.document"

# LLM attributes
GEN_AI_REQUEST_MODEL: Final[str] = "gen_ai.request.model"
GEN_AI_PROVIDER_NAME: Final[str] = "gen_ai.provider.name"
GEN_AI_USAGE_INPUT_TOKENS: Final[str] = "gen_ai.usage.input_tokens"
GEN_AI_USAGE_OUTPUT_TOKENS: Final[str] = "gen_ai.usage.output_tokens"
GEN_AI_USAGE_TOTAL_TOKENS: Final[str] = "gen_ai.usage.total_tokens"
GEN_AI_PROMPT: Final[str] = "gen_ai.prompt"
GEN_AI_COMPLETION: Final[str] = "gen_ai.completion"
GEN_AI_RESPONSE_FINISH_REASON: Final[str] = "gen_ai.response.finish_reason"

GEN_AI_INPUT_MESSAGE: Final[str] = "gen_ai.input.messages"
GEN_AI_OUTPUT_MESSAGE: Final[str] = "gen_ai.output.messages"

# Tool attributes
TOOL_NAME: Final[str] = "tool.name"
TOOL_DESCRIPTION: Final[str] = "tool.description"
TOOL_PARAMETERS: Final[str] = "tool.parameters"


class GenAISpanKind(StrEnum):
    CHAIN = "CHAIN"
    RETRIEVER = "RETRIEVER"
    RERANKER = "RERANKER"
    LLM = "LLM"
    EMBEDDING = "EMBEDDING"
    TOOL = "TOOL"
    AGENT = "AGENT"
    TASK = "TASK"
