from enum import StrEnum


class CreditUsageCreatedBy(StrEnum):
    """Business feature that created a credit usage event."""

    APP = "app"
    AGENT_NODE = "agent_node"
    BUILD_DRAFT = "build_draft"
    SKILL_BUILDER = "skill_builder"
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


class CreditUsageAppType(StrEnum):
    """Top-level application type associated with a credit usage event."""

    CHATBOT = "chatbot"
    CHATFLOW = "chatflow"
    WORKFLOW = "workflow"
    AGENT = "agent"
    AGENT_V2 = "agent_v2"
    COMPLETION = "completion"
    CHANNEL = "channel"
    RAG_PIPELINE = "rag_pipeline"
    UNKNOWN = "unknown"


type CreditUsageAppTypeInput = CreditUsageAppType | str | None


def normalize_credit_usage_created_by(value: object) -> CreditUsageCreatedBy:
    if isinstance(value, CreditUsageCreatedBy):
        return value
    if isinstance(value, str):
        try:
            return CreditUsageCreatedBy(value)
        except ValueError:
            pass
    return CreditUsageCreatedBy.UNKNOWN


def normalize_credit_usage_app_type(value: object) -> CreditUsageAppType:
    if isinstance(value, CreditUsageAppType):
        return value
    if isinstance(value, str):
        try:
            return CreditUsageAppType(value)
        except ValueError:
            pass
    return CreditUsageAppType.UNKNOWN


def created_by_from_app_type(app_type: CreditUsageAppTypeInput) -> CreditUsageCreatedBy:
    normalized_app_type = normalize_credit_usage_app_type(app_type)
    if normalized_app_type is CreditUsageAppType.UNKNOWN:
        return CreditUsageCreatedBy.UNKNOWN
    return CreditUsageCreatedBy.APP
