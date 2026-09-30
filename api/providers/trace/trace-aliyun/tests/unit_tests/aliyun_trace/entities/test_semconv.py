from dify_trace_aliyun.entities.semconv import (
    ACS_ARMS_SERVICE_FEATURE,
    GEN_AI_AGENT_NAME,
    GEN_AI_COMPLETION,
    GEN_AI_FRAMEWORK,
    GEN_AI_INPUT_MESSAGE,
    GEN_AI_OPERATION_NAME,
    GEN_AI_OUTPUT_MESSAGE,
    GEN_AI_PROMPT,
    GEN_AI_PROVIDER_NAME,
    GEN_AI_REACT_FINISH_REASON,
    GEN_AI_REACT_ROUND,
    GEN_AI_REQUEST_MODEL,
    GEN_AI_RESPONSE_FINISH_REASON,
    GEN_AI_RESPONSE_TIME_TO_FIRST_TOKEN,
    GEN_AI_SESSION_ID,
    GEN_AI_SKILL_DESCRIPTION,
    GEN_AI_SKILL_ID,
    GEN_AI_SKILL_NAME,
    GEN_AI_SKILL_VERSION,
    GEN_AI_SPAN_KIND,
    GEN_AI_TOOL_CALL_ARGUMENTS,
    GEN_AI_TOOL_CALL_ID,
    GEN_AI_TOOL_CALL_RESULT,
    GEN_AI_TOOL_DESCRIPTION,
    GEN_AI_TOOL_NAME,
    GEN_AI_TOOL_TYPE,
    GEN_AI_USAGE_INPUT_TOKENS,
    GEN_AI_USAGE_OUTPUT_TOKENS,
    GEN_AI_USAGE_TOTAL_TOKENS,
    GEN_AI_USER_ID,
    GEN_AI_USER_NAME,
    INPUT_VALUE,
    OPERATION_NAME_EXECUTE_TOOL,
    OUTPUT_VALUE,
    RETRIEVAL_DOCUMENT,
    RETRIEVAL_QUERY,
    TOOL_TYPE_DATASTORE,
    TOOL_TYPE_EXTENSION,
    TOOL_TYPE_FUNCTION,
    GenAISpanKind,
)


def test_constants():
    assert ACS_ARMS_SERVICE_FEATURE == "acs.arms.service.feature"
    assert GEN_AI_SESSION_ID == "gen_ai.session.id"
    assert GEN_AI_USER_ID == "gen_ai.user.id"
    assert GEN_AI_USER_NAME == "gen_ai.user.name"
    assert GEN_AI_SPAN_KIND == "gen_ai.span.kind"
    assert GEN_AI_FRAMEWORK == "gen_ai.framework"
    assert INPUT_VALUE == "input.value"
    assert OUTPUT_VALUE == "output.value"
    assert RETRIEVAL_QUERY == "retrieval.query"
    assert RETRIEVAL_DOCUMENT == "retrieval.document"
    assert GEN_AI_REQUEST_MODEL == "gen_ai.request.model"
    assert GEN_AI_PROVIDER_NAME == "gen_ai.provider.name"
    assert GEN_AI_USAGE_INPUT_TOKENS == "gen_ai.usage.input_tokens"
    assert GEN_AI_USAGE_OUTPUT_TOKENS == "gen_ai.usage.output_tokens"
    assert GEN_AI_USAGE_TOTAL_TOKENS == "gen_ai.usage.total_tokens"
    assert GEN_AI_PROMPT == "gen_ai.prompt"
    assert GEN_AI_COMPLETION == "gen_ai.completion"
    assert GEN_AI_RESPONSE_FINISH_REASON == "gen_ai.response.finish_reason"
    assert GEN_AI_INPUT_MESSAGE == "gen_ai.input.messages"
    assert GEN_AI_OUTPUT_MESSAGE == "gen_ai.output.messages"
    assert GEN_AI_TOOL_CALL_ID == "gen_ai.tool.call.id"
    assert GEN_AI_TOOL_DESCRIPTION == "gen_ai.tool.description"
    assert GEN_AI_TOOL_NAME == "gen_ai.tool.name"
    assert GEN_AI_TOOL_TYPE == "gen_ai.tool.type"
    assert GEN_AI_TOOL_CALL_ARGUMENTS == "gen_ai.tool.call.arguments"
    assert GEN_AI_TOOL_CALL_RESULT == "gen_ai.tool.call.result"
    assert GEN_AI_SKILL_ID == "gen_ai.skill.id"
    assert GEN_AI_SKILL_NAME == "gen_ai.skill.name"
    assert GEN_AI_SKILL_DESCRIPTION == "gen_ai.skill.description"
    assert GEN_AI_SKILL_VERSION == "gen_ai.skill.version"
    assert GEN_AI_OPERATION_NAME == "gen_ai.operation.name"
    assert OPERATION_NAME_EXECUTE_TOOL == "execute_tool"
    assert TOOL_TYPE_FUNCTION == "function"
    assert TOOL_TYPE_EXTENSION == "extension"
    assert TOOL_TYPE_DATASTORE == "datastore"
    assert GEN_AI_RESPONSE_TIME_TO_FIRST_TOKEN == "gen_ai.response.time_to_first_token"
    assert GEN_AI_AGENT_NAME == "gen_ai.agent.name"
    assert GEN_AI_REACT_ROUND == "gen_ai.react.round"
    assert GEN_AI_REACT_FINISH_REASON == "gen_ai.react.finish_reason"


def test_gen_ai_span_kind_enum():
    assert GenAISpanKind.CHAIN == "CHAIN"
    assert GenAISpanKind.RETRIEVER == "RETRIEVER"
    assert GenAISpanKind.RERANKER == "RERANKER"
    assert GenAISpanKind.LLM == "LLM"
    assert GenAISpanKind.EMBEDDING == "EMBEDDING"
    assert GenAISpanKind.TOOL == "TOOL"
    assert GenAISpanKind.AGENT == "AGENT"
    assert GenAISpanKind.TASK == "TASK"
    assert GenAISpanKind.STEP == "STEP"

    # Verify iteration works (covers the class definition)
    kinds = list(GenAISpanKind)
    assert len(kinds) == 9
    assert "LLM" in kinds
