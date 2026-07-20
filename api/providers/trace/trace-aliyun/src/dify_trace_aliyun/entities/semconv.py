from enum import StrEnum
from typing import Final

ACS_ARMS_SERVICE_FEATURE: Final[str] = "acs.arms.service.feature"

# Dify-specific attributes
DIFY_APP_ID: Final[str] = "dify.app_id"

# Public attributes
GEN_AI_SESSION_ID: Final[str] = "gen_ai.session.id"
GEN_AI_USER_ID: Final[str] = "gen_ai.user.id"
GEN_AI_USER_NAME: Final[str] = "gen_ai.user.name"
GEN_AI_SPAN_KIND: Final[str] = "gen_ai.span.kind"
GEN_AI_OPERATION_NAME: Final[str] = "gen_ai.operation.name"
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
# Time to first token of the model response in a streaming scenario, in nanoseconds.
GEN_AI_RESPONSE_TIME_TO_FIRST_TOKEN: Final[str] = "gen_ai.response.time_to_first_token"

GEN_AI_INPUT_MESSAGE: Final[str] = "gen_ai.input.messages"
GEN_AI_OUTPUT_MESSAGE: Final[str] = "gen_ai.output.messages"

# Tool attributes
TOOL_NAME: Final[str] = "tool.name"
TOOL_DESCRIPTION: Final[str] = "tool.description"
TOOL_PARAMETERS: Final[str] = "tool.parameters"

# Agent attributes
GEN_AI_AGENT_NAME: Final[str] = "gen_ai.agent.name"

# ReAct step attributes
GEN_AI_REACT_ROUND: Final[str] = "gen_ai.react.round"
GEN_AI_REACT_FINISH_REASON: Final[str] = "gen_ai.react.finish_reason"

# gen_ai.operation.name values (see Aliyun LLM Trace field definitions)
OPERATION_NAME_CHAT: Final[str] = "chat"
OPERATION_NAME_INVOKE_AGENT: Final[str] = "invoke_agent"
OPERATION_NAME_REACT: Final[str] = "react"


class GenAISpanKind(StrEnum):
    CHAIN = "CHAIN"
    RETRIEVER = "RETRIEVER"
    RERANKER = "RERANKER"
    LLM = "LLM"
    EMBEDDING = "EMBEDDING"
    TOOL = "TOOL"
    AGENT = "AGENT"
    TASK = "TASK"
    # Marks one Reasoning-Acting iteration of an agent (ReAct step).
    STEP = "STEP"
