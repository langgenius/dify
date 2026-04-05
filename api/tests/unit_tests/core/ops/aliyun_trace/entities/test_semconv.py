from core.ops.aliyun_trace.entities.semconv import (
    ACS_ARMS_SERVICE_FEATURE,
    GEN_AI_COMPLETION,
    GEN_AI_FRAMEWORK,
    GEN_AI_INPUT_MESSAGE,
    GEN_AI_OUTPUT_MESSAGE,
    GEN_AI_PROMPT,
    GEN_AI_PROVIDER_NAME,
    GEN_AI_REQUEST_MODEL,
    GEN_AI_RESPONSE_FINISH_REASON,
    GEN_AI_SESSION_ID,
    GEN_AI_SPAN_KIND,
    GEN_AI_USAGE_INPUT_TOKENS,
    GEN_AI_USAGE_OUTPUT_TOKENS,
    GEN_AI_USAGE_TOTAL_TOKENS,
    GEN_AI_USER_ID,
    GEN_AI_USER_NAME,
    INPUT_VALUE,
    OUTPUT_VALUE,
    RETRIEVAL_DOCUMENT,
    RETRIEVAL_QUERY,
    TOOL_DESCRIPTION,
    TOOL_NAME,
    TOOL_PARAMETERS,
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
    assert TOOL_NAME == "tool.name"
    assert TOOL_DESCRIPTION == "tool.description"
    assert TOOL_PARAMETERS == "tool.parameters"


def test_gen_ai_span_kind_enum():
    assert GenAISpanKind.CHAIN == "CHAIN"
    assert GenAISpanKind.RETRIEVER == "RETRIEVER"
    assert GenAISpanKind.RERANKER == "RERANKER"
    assert GenAISpanKind.LLM == "LLM"
    assert GenAISpanKind.EMBEDDING == "EMBEDDING"
    assert GenAISpanKind.TOOL == "TOOL"
    assert GenAISpanKind.AGENT == "AGENT"
    assert GenAISpanKind.TASK == "TASK"

    # Verify iteration works (covers the class definition)
    kinds = list(GenAISpanKind)
    assert len(kinds) == 8
    assert "LLM" in kinds
