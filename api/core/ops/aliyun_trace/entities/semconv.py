from enum import StrEnum
from typing import Final

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
GEN_AI_MODEL_NAME: Final[str] = "gen_ai.model_name"
GEN_AI_SYSTEM: Final[str] = "gen_ai.system"
GEN_AI_USAGE_INPUT_TOKENS: Final[str] = "gen_ai.usage.input_tokens"
GEN_AI_USAGE_OUTPUT_TOKENS: Final[str] = "gen_ai.usage.output_tokens"
GEN_AI_USAGE_TOTAL_TOKENS: Final[str] = "gen_ai.usage.total_tokens"
GEN_AI_PROMPT_TEMPLATE_TEMPLATE: Final[str] = "gen_ai.prompt_template.template"
GEN_AI_PROMPT_TEMPLATE_VARIABLE: Final[str] = "gen_ai.prompt_template.variable"
GEN_AI_PROMPT: Final[str] = "gen_ai.prompt"
GEN_AI_COMPLETION: Final[str] = "gen_ai.completion"
GEN_AI_RESPONSE_FINISH_REASON: Final[str] = "gen_ai.response.finish_reason"

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
