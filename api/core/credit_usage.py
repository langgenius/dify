from enum import StrEnum


class CreditUsageCreatedBy(StrEnum):
    """Business feature that created a credit usage event."""

    CHATBOT = "chatbot"
    CHATFLOW = "chatflow"
    WORKFLOW = "workflow"
    AGENT = "agent"
    AGENT_V2 = "agent_v2"
    COMPLETION = "completion"
    CHANNEL = "channel"
    RAG_PIPELINE = "rag_pipeline"
    CONVERSATION_NAME = "conversation_name"
    SUGGESTED_QUESTIONS = "suggested_questions"
    WORKFLOW_GENERATION = "workflow_generation"
    WORKFLOW_INSTRUCTION_SUGGESTIONS = "workflow_instruction_suggestions"
    RULE_CONFIG = "rule_config"
    CODE_GENERATION = "code_generation"
    QA_DOCUMENT = "qa_document"
    STRUCTURED_OUTPUT = "structured_output"
    INSTRUCTION_MODIFICATION = "instruction_modification"
    KNOWLEDGE_RETRIEVAL = "knowledge_retrieval"
    KNOWLEDGE_INDEXING = "knowledge_indexing"
    TOOL = "tool"
    AUDIO = "audio"
    MODERATION = "moderation"
    PLUGIN_API = "plugin_api"
    UNKNOWN = "unknown"


type CreditUsageCreatedByInput = CreditUsageCreatedBy | str | None


def normalize_credit_usage_created_by(value: object) -> CreditUsageCreatedBy:
    if isinstance(value, CreditUsageCreatedBy):
        return value
    if isinstance(value, str):
        try:
            return CreditUsageCreatedBy(value)
        except ValueError:
            pass
    return CreditUsageCreatedBy.UNKNOWN
