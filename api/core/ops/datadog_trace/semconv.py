# Datadog gen_ai semantic conventions
# Based on OTel GenAI Semantic Conventions v1.37+
# Reference: https://docs.datadoghq.com/llm_observability/instrumentation/otel_instrumentation/
#
# The presence of OPERATION_NAME or PROVIDER_NAME triggers Datadog's OTel 1.37 codepath.

# Operation name - drives span kind in Datadog UI
# "chat" / "completion" -> llm span
# "execute_tool" -> tool span
# "invoke_agent" -> agent span
# "retrieval" / "workflow" / anything else -> workflow span
OPERATION_NAME = "gen_ai.operation.name"

# System/provider
SYSTEM = "gen_ai.system"
PROVIDER_NAME = "gen_ai.provider.name"
REQUEST_MODEL = "gen_ai.request.model"
RESPONSE_MODEL = "gen_ai.response.model"

# Token usage (read directly from span attributes by Datadog)
USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens"
USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens"

# IO - JSON arrays of OTel v1.37 ChatMessage objects
# Each message: {"role": "...", "parts": [{"type": "text", "content": "..."}]}
# Output messages also include "finish_reason"
# Used on ALL non-tool spans (DD only reads these, not input.value/output.value)
INPUT_MESSAGES = "gen_ai.input.messages"
OUTPUT_MESSAGES = "gen_ai.output.messages"

# Session (DD reads this for session_id + metadata.conversation_id)
CONVERSATION_ID = "gen_ai.conversation.id"

# Response metadata (plural at span attribute level per DD mapping docs)
RESPONSE_FINISH_REASONS = "gen_ai.response.finish_reasons"

# Tool attributes
TOOL_NAME = "gen_ai.tool.name"
TOOL_CALL_ARGUMENTS = "gen_ai.tool.call.arguments"
TOOL_CALL_RESULT = "gen_ai.tool.call.result"

# Dify-specific attributes
DIFY_APP_ID = "dify.app_id"
DIFY_WORKFLOW_ID = "dify.workflow_id"
