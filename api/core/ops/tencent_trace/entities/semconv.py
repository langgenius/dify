from enum import Enum

# public
GEN_AI_SESSION_ID = "gen_ai.session.id"

GEN_AI_USER_ID = "gen_ai.user.id"

GEN_AI_USER_NAME = "gen_ai.user.name"

GEN_AI_SPAN_KIND = "gen_ai.span.kind"

GEN_AI_FRAMEWORK = "gen_ai.framework"

GEN_AI_IS_ENTRY = "gen_ai.is_entry"  # mark to count the LLM-related traces

# Chain
INPUT_VALUE = "gen_ai.entity.input"

OUTPUT_VALUE = "gen_ai.entity.output"


# Retriever
RETRIEVAL_QUERY = "retrieval.query"

RETRIEVAL_DOCUMENT = "retrieval.document"


# GENERATION
GEN_AI_MODEL_NAME = "gen_ai.response.model"

GEN_AI_PROVIDER = "gen_ai.provider.name"


GEN_AI_USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens"

GEN_AI_USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens"

GEN_AI_USAGE_TOTAL_TOKENS = "gen_ai.usage.total_tokens"

GEN_AI_PROMPT_TEMPLATE_TEMPLATE = "gen_ai.prompt_template.template"

GEN_AI_PROMPT_TEMPLATE_VARIABLE = "gen_ai.prompt_template.variable"

GEN_AI_PROMPT = "gen_ai.prompt"

GEN_AI_COMPLETION = "gen_ai.completion"

GEN_AI_RESPONSE_FINISH_REASON = "gen_ai.response.finish_reason"

# Streaming Span Attributes
GEN_AI_IS_STREAMING_REQUEST = "llm.is_streaming"  # Same as OpenLLMetry semconv

# Tool
TOOL_NAME = "tool.name"

TOOL_DESCRIPTION = "tool.description"

TOOL_PARAMETERS = "tool.parameters"

# Instrumentation Library
INSTRUMENTATION_NAME = "dify-sdk"
INSTRUMENTATION_VERSION = "0.1.0"
INSTRUMENTATION_LANGUAGE = "python"


# Metrics
LLM_OPERATION_DURATION = "gen_ai.client.operation.duration"
GEN_AI_TOKEN_USAGE = "gen_ai.client.token.usage"
GEN_AI_SERVER_TIME_TO_FIRST_TOKEN = "gen_ai.server.time_to_first_token"
GEN_AI_STREAMING_TIME_TO_GENERATE = "gen_ai.streaming.time_to_generate"
# The LLM trace duration which is exclusive to tencent apm
GEN_AI_TRACE_DURATION = "gen_ai.trace.duration"

# Token Usage Attributes
GEN_AI_OPERATION_NAME = "gen_ai.operation.name"
GEN_AI_REQUEST_MODEL = "gen_ai.request.model"
GEN_AI_RESPONSE_MODEL = "gen_ai.response.model"
GEN_AI_SYSTEM = "gen_ai.system"
GEN_AI_TOKEN_TYPE = "gen_ai.token.type"
SERVER_ADDRESS = "server.address"


class GenAISpanKind(Enum):
    WORKFLOW = "WORKFLOW"  # OpenLLMetry
    RETRIEVER = "RETRIEVER"  # RAG
    GENERATION = "GENERATION"  # Langfuse
    TOOL = "TOOL"  # OpenLLMetry
    AGENT = "AGENT"  # OpenLLMetry
    TASK = "TASK"  # OpenLLMetry
