from enum import StrEnum

from core.trigger.constants import (
    TRIGGER_PLUGIN_NODE_TYPE,
    TRIGGER_SCHEDULE_NODE_TYPE,
    TRIGGER_WEBHOOK_NODE_TYPE,
)


class CreatorUserRole(StrEnum):
    ACCOUNT = "account"
    END_USER = "end_user"

    @classmethod
    def _missing_(cls, value):
        if value == "end-user":
            return cls.END_USER
        else:
            return super()._missing_(value)


class WorkflowRunTriggeredFrom(StrEnum):
    DEBUGGING = "debugging"
    APP_RUN = "app-run"  # webapp / service api
    RAG_PIPELINE_RUN = "rag-pipeline-run"
    RAG_PIPELINE_DEBUGGING = "rag-pipeline-debugging"
    WEBHOOK = "webhook"
    SCHEDULE = "schedule"
    PLUGIN = "plugin"


class DraftVariableType(StrEnum):
    # node means that the correspond variable
    NODE = "node"
    SYS = "sys"
    CONVERSATION = "conversation"


class MessageStatus(StrEnum):
    """
    Message Status Enum
    """

    NORMAL = "normal"
    PAUSED = "paused"
    ERROR = "error"


class ExecutionOffLoadType(StrEnum):
    INPUTS = "inputs"
    PROCESS_DATA = "process_data"
    OUTPUTS = "outputs"


class WorkflowTriggerStatus(StrEnum):
    """Workflow Trigger Execution Status"""

    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    PAUSED = "paused"
    FAILED = "failed"
    RATE_LIMITED = "rate_limited"
    RETRYING = "retrying"


class AppTriggerStatus(StrEnum):
    """App Trigger Status Enum"""

    ENABLED = "enabled"
    DISABLED = "disabled"
    UNAUTHORIZED = "unauthorized"
    RATE_LIMITED = "rate_limited"


class AppTriggerType(StrEnum):
    """App Trigger Type Enum"""

    TRIGGER_WEBHOOK = TRIGGER_WEBHOOK_NODE_TYPE
    TRIGGER_SCHEDULE = TRIGGER_SCHEDULE_NODE_TYPE
    TRIGGER_PLUGIN = TRIGGER_PLUGIN_NODE_TYPE

    # for backward compatibility
    UNKNOWN = "unknown"


class AppStatus(StrEnum):
    """App Status Enum"""

    NORMAL = "normal"


class AppMCPServerStatus(StrEnum):
    """AppMCPServer Status Enum"""

    NORMAL = "normal"
    ACTIVE = "active"
    INACTIVE = "inactive"


class ConversationStatus(StrEnum):
    """Conversation Status Enum"""

    NORMAL = "normal"


class DataSourceType(StrEnum):
    """Data Source Type for Dataset and Document"""

    UPLOAD_FILE = "upload_file"
    NOTION_IMPORT = "notion_import"
    WEBSITE_CRAWL = "website_crawl"
    LOCAL_FILE = "local_file"
    ONLINE_DOCUMENT = "online_document"


class ProcessRuleMode(StrEnum):
    """Dataset Process Rule Mode"""

    AUTOMATIC = "automatic"
    CUSTOM = "custom"
    HIERARCHICAL = "hierarchical"


class IndexingStatus(StrEnum):
    """Document Indexing Status"""

    WAITING = "waiting"
    PARSING = "parsing"
    CLEANING = "cleaning"
    SPLITTING = "splitting"
    INDEXING = "indexing"
    PAUSED = "paused"
    COMPLETED = "completed"
    ERROR = "error"


class DocumentCreatedFrom(StrEnum):
    """Document Created From"""

    WEB = "web"
    API = "api"
    RAG_PIPELINE = "rag-pipeline"


class ConversationFromSource(StrEnum):
    """Conversation / Message from_source"""

    API = "api"
    CONSOLE = "console"


class FeedbackFromSource(StrEnum):
    """MessageFeedback from_source"""

    USER = "user"
    ADMIN = "admin"


class CustomizeTokenStrategy(StrEnum):
    """Site token customization strategy"""

    MUST = "must"
    ALLOW = "allow"
    NOT_ALLOW = "not_allow"
    UUID = "uuid"


class FeedbackRating(StrEnum):
    """MessageFeedback rating"""

    LIKE = "like"
    DISLIKE = "dislike"


class InvokeFrom(StrEnum):
    """How a conversation/message was invoked"""

    SERVICE_API = "service-api"
    WEB_APP = "web-app"
    TRIGGER = "trigger"
    EXPLORE = "explore"
    DEBUGGER = "debugger"
    PUBLISHED_PIPELINE = "published"
    VALIDATION = "validation"

    @classmethod
    def value_of(cls, value: str) -> "InvokeFrom":
        return cls(value)

    def to_source(self) -> str:
        source_mapping = {
            InvokeFrom.WEB_APP: "web_app",
            InvokeFrom.DEBUGGER: "dev",
            InvokeFrom.EXPLORE: "explore_app",
            InvokeFrom.TRIGGER: "trigger",
            InvokeFrom.SERVICE_API: "api",
        }
        return source_mapping.get(self, "dev")


class DocumentDocType(StrEnum):
    """Document doc_type classification"""

    BOOK = "book"
    WEB_PAGE = "web_page"
    PAPER = "paper"
    SOCIAL_MEDIA_POST = "social_media_post"
    WIKIPEDIA_ENTRY = "wikipedia_entry"
    PERSONAL_DOCUMENT = "personal_document"
    BUSINESS_DOCUMENT = "business_document"
    IM_CHAT_LOG = "im_chat_log"
    SYNCED_FROM_NOTION = "synced_from_notion"
    SYNCED_FROM_GITHUB = "synced_from_github"
    OTHERS = "others"


class TagType(StrEnum):
    """Tag type"""

    KNOWLEDGE = "knowledge"
    APP = "app"


class DatasetMetadataType(StrEnum):
    """Dataset metadata value type"""

    STRING = "string"
    NUMBER = "number"
    TIME = "time"


class SegmentType(StrEnum):
    """Document segment type"""

    AUTOMATIC = "automatic"
    CUSTOMIZED = "customized"


class SegmentStatus(StrEnum):
    """Document segment status"""

    WAITING = "waiting"
    INDEXING = "indexing"
    COMPLETED = "completed"
    ERROR = "error"
    PAUSED = "paused"
    RE_SEGMENT = "re_segment"


class DatasetRuntimeMode(StrEnum):
    """Dataset runtime mode"""

    GENERAL = "general"
    RAG_PIPELINE = "rag_pipeline"


class CollectionBindingType(StrEnum):
    """Dataset collection binding type"""

    DATASET = "dataset"
    ANNOTATION = "annotation"


class DatasetQuerySource(StrEnum):
    """Dataset query source"""

    HIT_TESTING = "hit_testing"
    APP = "app"


class TidbAuthBindingStatus(StrEnum):
    """TiDB auth binding status"""

    CREATING = "CREATING"
    ACTIVE = "ACTIVE"


class MessageFileBelongsTo(StrEnum):
    """MessageFile belongs_to"""

    USER = "user"
    ASSISTANT = "assistant"


class CredentialSourceType(StrEnum):
    """Load balancing credential source type"""

    PROVIDER = "provider"
    CUSTOM_MODEL = "custom_model"


class PaymentStatus(StrEnum):
    """Provider order payment status"""

    WAIT_PAY = "wait_pay"
    PAID = "paid"
    FAILED = "failed"
    REFUNDED = "refunded"


class BannerStatus(StrEnum):
    """ExporleBanner status"""

    ENABLED = "enabled"
    DISABLED = "disabled"


class SummaryStatus(StrEnum):
    """Document segment summary status"""

    NOT_STARTED = "not_started"
    GENERATING = "generating"
    COMPLETED = "completed"
    ERROR = "error"
    TIMEOUT = "timeout"


class MessageChainType(StrEnum):
    """Message chain type"""

    SYSTEM = "system"


class PromptType(StrEnum):
    """Prompt configuration type"""

    SIMPLE = "simple"
    ADVANCED = "advanced"


class ProviderQuotaType(StrEnum):
    PAID = "paid"
    """hosted paid quota"""

    FREE = "free"
    """third-party free quota"""

    TRIAL = "trial"
    """hosted trial quota"""

    @staticmethod
    def value_of(value: str) -> "ProviderQuotaType":
        for member in ProviderQuotaType:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


class ApiTokenType(StrEnum):
    """API Token type"""

    APP = "app"
    DATASET = "dataset"
