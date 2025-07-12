from enum import Enum

# public
GEN_AI_SESSION_ID = "gen_ai.session.id"

GEN_AI_USER_ID = "gen_ai.user.id"

GEN_AI_USER_NAME = "gen_ai.user.name"

GEN_AI_SPAN_KIND = "gen_ai.span.kind"

GEN_AI_FRAMEWORK = "gen_ai.framework"


# Chain
INPUT_VALUE = "input.value"

OUTPUT_VALUE = "output.value"


# Retriever
RETRIEVAL_QUERY = "retrieval.query"

RETRIEVAL_DOCUMENT = "retrieval.document"


# LLM
GEN_AI_MODEL_NAME = "gen_ai.model_name"

GEN_AI_SYSTEM = "gen_ai.system"

GEN_AI_USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens"

GEN_AI_USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens"

GEN_AI_USAGE_TOTAL_TOKENS = "gen_ai.usage.total_tokens"

GEN_AI_PROMPT_TEMPLATE_TEMPLATE = "gen_ai.prompt_template.template"

GEN_AI_PROMPT_TEMPLATE_VARIABLE = "gen_ai.prompt_template.variable"

GEN_AI_PROMPT = "gen_ai.prompt"

GEN_AI_COMPLETION = "gen_ai.completion"

GEN_AI_RESPONSE_FINISH_REASON = "gen_ai.response.finish_reason"

# Tool
TOOL_NAME = "tool.name"

TOOL_DESCRIPTION = "tool.description"

TOOL_PARAMETERS = "tool.parameters"


class GenAISpanKind(Enum):
    CHAIN = "CHAIN"
    RETRIEVER = "RETRIEVER"
    RERANKER = "RERANKER"
    LLM = "LLM"
    EMBEDDING = "EMBEDDING"
    TOOL = "TOOL"
    AGENT = "AGENT"
    TASK = "TASK"
