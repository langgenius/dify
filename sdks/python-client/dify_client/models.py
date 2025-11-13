"""Response models for the Dify client with proper type hints."""

from typing import Optional, List, Dict, Any, Literal, Union
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class BaseResponse:
    """Base response model."""

    success: bool = True
    message: str | None = None


@dataclass
class ErrorResponse(BaseResponse):
    """Error response model."""

    error_code: str | None = None
    details: Dict[str, Any] | None = None
    success: bool = False


@dataclass
class FileInfo:
    """File information model."""

    id: str
    name: str
    size: int
    mime_type: str
    url: str | None = None
    created_at: datetime | None = None


@dataclass
class MessageResponse(BaseResponse):
    """Message response model."""

    id: str = ""
    answer: str = ""
    conversation_id: str | None = None
    created_at: int | None = None
    metadata: Dict[str, Any] | None = None
    files: List[Dict[str, Any]] | None = None


@dataclass
class ConversationResponse(BaseResponse):
    """Conversation response model."""

    id: str = ""
    name: str = ""
    inputs: Dict[str, Any] | None = None
    status: str | None = None
    created_at: int | None = None
    updated_at: int | None = None


@dataclass
class DatasetResponse(BaseResponse):
    """Dataset response model."""

    id: str = ""
    name: str = ""
    description: str | None = None
    permission: str | None = None
    indexing_technique: str | None = None
    embedding_model: str | None = None
    embedding_model_provider: str | None = None
    retrieval_model: Dict[str, Any] | None = None
    document_count: int | None = None
    word_count: int | None = None
    app_count: int | None = None
    created_at: int | None = None
    updated_at: int | None = None


@dataclass
class DocumentResponse(BaseResponse):
    """Document response model."""

    id: str = ""
    name: str = ""
    data_source_type: str | None = None
    data_source_info: Dict[str, Any] | None = None
    dataset_process_rule_id: str | None = None
    batch: str | None = None
    position: int | None = None
    enabled: bool | None = None
    disabled_at: float | None = None
    disabled_by: str | None = None
    archived: bool | None = None
    archived_reason: str | None = None
    archived_at: float | None = None
    archived_by: str | None = None
    word_count: int | None = None
    hit_count: int | None = None
    doc_form: str | None = None
    doc_metadata: Dict[str, Any] | None = None
    created_at: float | None = None
    updated_at: float | None = None
    indexing_status: str | None = None
    completed_at: float | None = None
    paused_at: float | None = None
    error: str | None = None
    stopped_at: float | None = None


@dataclass
class DocumentSegmentResponse(BaseResponse):
    """Document segment response model."""

    id: str = ""
    position: int | None = None
    document_id: str | None = None
    content: str | None = None
    answer: str | None = None
    word_count: int | None = None
    tokens: int | None = None
    keywords: List[str] | None = None
    index_node_id: str | None = None
    index_node_hash: str | None = None
    hit_count: int | None = None
    enabled: bool | None = None
    disabled_at: float | None = None
    disabled_by: str | None = None
    status: str | None = None
    created_by: str | None = None
    created_at: float | None = None
    indexing_at: float | None = None
    completed_at: float | None = None
    error: str | None = None
    stopped_at: float | None = None


@dataclass
class WorkflowRunResponse(BaseResponse):
    """Workflow run response model."""

    id: str = ""
    workflow_id: str | None = None
    status: Literal["running", "succeeded", "failed", "stopped"] | None = None
    inputs: Dict[str, Any] | None = None
    outputs: Dict[str, Any] | None = None
    error: str | None = None
    elapsed_time: float | None = None
    total_tokens: int | None = None
    total_steps: int | None = None
    created_at: float | None = None
    finished_at: float | None = None


@dataclass
class ApplicationParametersResponse(BaseResponse):
    """Application parameters response model."""

    opening_statement: str | None = None
    suggested_questions: List[str] | None = None
    speech_to_text: Dict[str, Any] | None = None
    text_to_speech: Dict[str, Any] | None = None
    retriever_resource: Dict[str, Any] | None = None
    sensitive_word_avoidance: Dict[str, Any] | None = None
    file_upload: Dict[str, Any] | None = None
    system_parameters: Dict[str, Any] | None = None
    user_input_form: List[Dict[str, Any]] | None = None


@dataclass
class AnnotationResponse(BaseResponse):
    """Annotation response model."""

    id: str = ""
    question: str = ""
    answer: str = ""
    content: str | None = None
    created_at: float | None = None
    updated_at: float | None = None
    created_by: str | None = None
    updated_by: str | None = None
    hit_count: int | None = None


@dataclass
class PaginatedResponse(BaseResponse):
    """Paginated response model."""

    data: List[Any] = field(default_factory=list)
    has_more: bool = False
    limit: int = 0
    total: int = 0
    page: int | None = None


@dataclass
class ConversationVariableResponse(BaseResponse):
    """Conversation variable response model."""

    conversation_id: str = ""
    variables: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class FileUploadResponse(BaseResponse):
    """File upload response model."""

    id: str = ""
    name: str = ""
    size: int = 0
    mime_type: str = ""
    url: str | None = None
    created_at: float | None = None


@dataclass
class AudioResponse(BaseResponse):
    """Audio generation/response model."""

    audio: str | None = None  # Base64 encoded audio data or URL
    audio_url: str | None = None
    duration: float | None = None
    sample_rate: int | None = None


@dataclass
class SuggestedQuestionsResponse(BaseResponse):
    """Suggested questions response model."""

    message_id: str = ""
    questions: List[str] = field(default_factory=list)


@dataclass
class AppInfoResponse(BaseResponse):
    """App info response model."""

    id: str = ""
    name: str = ""
    description: str | None = None
    icon: str | None = None
    icon_background: str | None = None
    mode: str | None = None
    tags: List[str] | None = None
    enable_site: bool | None = None
    enable_api: bool | None = None
    api_token: str | None = None


@dataclass
class WorkspaceModelsResponse(BaseResponse):
    """Workspace models response model."""

    models: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class HitTestingResponse(BaseResponse):
    """Hit testing response model."""

    query: str = ""
    records: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class DatasetTagsResponse(BaseResponse):
    """Dataset tags response model."""

    tags: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class WorkflowLogsResponse(BaseResponse):
    """Workflow logs response model."""

    logs: List[Dict[str, Any]] = field(default_factory=list)
    total: int = 0
    page: int = 0
    limit: int = 0
    has_more: bool = False


@dataclass
class ModelProviderResponse(BaseResponse):
    """Model provider response model."""

    provider_name: str = ""
    provider_type: str = ""
    models: List[Dict[str, Any]] = field(default_factory=list)
    is_enabled: bool = False
    credentials: Dict[str, Any] | None = None


@dataclass
class FileInfoResponse(BaseResponse):
    """File info response model."""

    id: str = ""
    name: str = ""
    size: int = 0
    mime_type: str = ""
    url: str | None = None
    created_at: int | None = None
    metadata: Dict[str, Any] | None = None


@dataclass
class WorkflowDraftResponse(BaseResponse):
    """Workflow draft response model."""

    id: str = ""
    app_id: str = ""
    draft_data: Dict[str, Any] = field(default_factory=dict)
    version: int = 0
    created_at: int | None = None
    updated_at: int | None = None


@dataclass
class ApiTokenResponse(BaseResponse):
    """API token response model."""

    id: str = ""
    name: str = ""
    token: str = ""
    description: str | None = None
    created_at: int | None = None
    last_used_at: int | None = None
    is_active: bool = True


@dataclass
class JobStatusResponse(BaseResponse):
    """Job status response model."""

    job_id: str = ""
    job_status: str = ""
    error_msg: str | None = None
    progress: float | None = None
    created_at: int | None = None
    updated_at: int | None = None


@dataclass
class DatasetQueryResponse(BaseResponse):
    """Dataset query response model."""

    query: str = ""
    records: List[Dict[str, Any]] = field(default_factory=list)
    total: int = 0
    search_time: float | None = None
    retrieval_model: Dict[str, Any] | None = None


@dataclass
class DatasetTemplateResponse(BaseResponse):
    """Dataset template response model."""

    template_name: str = ""
    display_name: str = ""
    description: str = ""
    category: str = ""
    icon: str | None = None
    config_schema: Dict[str, Any] = field(default_factory=dict)


# Type aliases for common response types
ResponseType = Union[
    BaseResponse,
    ErrorResponse,
    MessageResponse,
    ConversationResponse,
    DatasetResponse,
    DocumentResponse,
    DocumentSegmentResponse,
    WorkflowRunResponse,
    ApplicationParametersResponse,
    AnnotationResponse,
    PaginatedResponse,
    ConversationVariableResponse,
    FileUploadResponse,
    AudioResponse,
    SuggestedQuestionsResponse,
    AppInfoResponse,
    WorkspaceModelsResponse,
    HitTestingResponse,
    DatasetTagsResponse,
    WorkflowLogsResponse,
    ModelProviderResponse,
    FileInfoResponse,
    WorkflowDraftResponse,
    ApiTokenResponse,
    JobStatusResponse,
    DatasetQueryResponse,
    DatasetTemplateResponse,
]
