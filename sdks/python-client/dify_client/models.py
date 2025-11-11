"""Response models for the Dify client with proper type hints."""

from typing import Optional, List, Dict, Any, Literal, Union
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class BaseResponse:
    """Base response model."""

    success: bool = True
    message: Optional[str] = None


@dataclass
class ErrorResponse(BaseResponse):
    """Error response model."""

    error_code: Optional[str] = None
    details: Optional[Dict[str, Any]] = None
    success: bool = False


@dataclass
class FileInfo:
    """File information model."""

    id: str
    name: str
    size: int
    mime_type: str
    url: Optional[str] = None
    created_at: Optional[datetime] = None


@dataclass
class MessageResponse(BaseResponse):
    """Message response model."""

    id: str = ""
    answer: str = ""
    conversation_id: Optional[str] = None
    created_at: Optional[int] = None
    metadata: Optional[Dict[str, Any]] = None
    files: Optional[List[Dict[str, Any]]] = None


@dataclass
class ConversationResponse(BaseResponse):
    """Conversation response model."""

    id: str = ""
    name: str = ""
    inputs: Optional[Dict[str, Any]] = None
    status: Optional[str] = None
    created_at: Optional[int] = None
    updated_at: Optional[int] = None


@dataclass
class DatasetResponse(BaseResponse):
    """Dataset response model."""

    id: str = ""
    name: str = ""
    description: Optional[str] = None
    permission: Optional[str] = None
    indexing_technique: Optional[str] = None
    embedding_model: Optional[str] = None
    embedding_model_provider: Optional[str] = None
    retrieval_model: Optional[Dict[str, Any]] = None
    document_count: Optional[int] = None
    word_count: Optional[int] = None
    app_count: Optional[int] = None
    created_at: Optional[int] = None
    updated_at: Optional[int] = None


@dataclass
class DocumentResponse(BaseResponse):
    """Document response model."""

    id: str = ""
    name: str = ""
    data_source_type: Optional[str] = None
    data_source_info: Optional[Dict[str, Any]] = None
    dataset_process_rule_id: Optional[str] = None
    batch: Optional[str] = None
    position: Optional[int] = None
    enabled: Optional[bool] = None
    disabled_at: Optional[float] = None
    disabled_by: Optional[str] = None
    archived: Optional[bool] = None
    archived_reason: Optional[str] = None
    archived_at: Optional[float] = None
    archived_by: Optional[str] = None
    word_count: Optional[int] = None
    hit_count: Optional[int] = None
    doc_form: Optional[str] = None
    doc_metadata: Optional[Dict[str, Any]] = None
    created_at: Optional[float] = None
    updated_at: Optional[float] = None
    indexing_status: Optional[str] = None
    completed_at: Optional[float] = None
    paused_at: Optional[float] = None
    error: Optional[str] = None
    stopped_at: Optional[float] = None


@dataclass
class DocumentSegmentResponse(BaseResponse):
    """Document segment response model."""

    id: str = ""
    position: Optional[int] = None
    document_id: Optional[str] = None
    content: Optional[str] = None
    answer: Optional[str] = None
    word_count: Optional[int] = None
    tokens: Optional[int] = None
    keywords: Optional[List[str]] = None
    index_node_id: Optional[str] = None
    index_node_hash: Optional[str] = None
    hit_count: Optional[int] = None
    enabled: Optional[bool] = None
    disabled_at: Optional[float] = None
    disabled_by: Optional[str] = None
    status: Optional[str] = None
    created_by: Optional[str] = None
    created_at: Optional[float] = None
    indexing_at: Optional[float] = None
    completed_at: Optional[float] = None
    error: Optional[str] = None
    stopped_at: Optional[float] = None


@dataclass
class WorkflowRunResponse(BaseResponse):
    """Workflow run response model."""

    id: str = ""
    workflow_id: Optional[str] = None
    status: Optional[Literal["running", "succeeded", "failed", "stopped"]] = None
    inputs: Optional[Dict[str, Any]] = None
    outputs: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    elapsed_time: Optional[float] = None
    total_tokens: Optional[int] = None
    total_steps: Optional[int] = None
    created_at: Optional[float] = None
    finished_at: Optional[float] = None


@dataclass
class ApplicationParametersResponse(BaseResponse):
    """Application parameters response model."""

    opening_statement: Optional[str] = None
    suggested_questions: Optional[List[str]] = None
    speech_to_text: Optional[Dict[str, Any]] = None
    text_to_speech: Optional[Dict[str, Any]] = None
    retriever_resource: Optional[Dict[str, Any]] = None
    sensitive_word_avoidance: Optional[Dict[str, Any]] = None
    file_upload: Optional[Dict[str, Any]] = None
    system_parameters: Optional[Dict[str, Any]] = None
    user_input_form: Optional[List[Dict[str, Any]]] = None


@dataclass
class AnnotationResponse(BaseResponse):
    """Annotation response model."""

    id: str = ""
    question: str = ""
    answer: str = ""
    content: Optional[str] = None
    created_at: Optional[float] = None
    updated_at: Optional[float] = None
    created_by: Optional[str] = None
    updated_by: Optional[str] = None
    hit_count: Optional[int] = None


@dataclass
class PaginatedResponse(BaseResponse):
    """Paginated response model."""

    data: List[Any] = field(default_factory=list)
    has_more: bool = False
    limit: int = 0
    total: int = 0
    page: Optional[int] = None


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
    url: Optional[str] = None
    created_at: Optional[float] = None


@dataclass
class AudioResponse(BaseResponse):
    """Audio generation/response model."""

    audio: Optional[str] = None  # Base64 encoded audio data or URL
    audio_url: Optional[str] = None
    duration: Optional[float] = None
    sample_rate: Optional[int] = None


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
    description: Optional[str] = None
    icon: Optional[str] = None
    icon_background: Optional[str] = None
    mode: Optional[str] = None
    tags: Optional[List[str]] = None
    enable_site: Optional[bool] = None
    enable_api: Optional[bool] = None
    api_token: Optional[str] = None


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
    credentials: Optional[Dict[str, Any]] = None


@dataclass
class FileInfoResponse(BaseResponse):
    """File info response model."""

    id: str = ""
    name: str = ""
    size: int = 0
    mime_type: str = ""
    url: Optional[str] = None
    created_at: Optional[int] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class WorkflowDraftResponse(BaseResponse):
    """Workflow draft response model."""

    id: str = ""
    app_id: str = ""
    draft_data: Dict[str, Any] = field(default_factory=dict)
    version: int = 0
    created_at: Optional[int] = None
    updated_at: Optional[int] = None


@dataclass
class ApiTokenResponse(BaseResponse):
    """API token response model."""

    id: str = ""
    name: str = ""
    token: str = ""
    description: Optional[str] = None
    created_at: Optional[int] = None
    last_used_at: Optional[int] = None
    is_active: bool = True


@dataclass
class JobStatusResponse(BaseResponse):
    """Job status response model."""

    job_id: str = ""
    job_status: str = ""
    error_msg: Optional[str] = None
    progress: Optional[float] = None
    created_at: Optional[int] = None
    updated_at: Optional[int] = None


@dataclass
class DatasetQueryResponse(BaseResponse):
    """Dataset query response model."""

    query: str = ""
    records: List[Dict[str, Any]] = field(default_factory=list)
    total: int = 0
    search_time: Optional[float] = None
    retrieval_model: Optional[Dict[str, Any]] = None


@dataclass
class DatasetTemplateResponse(BaseResponse):
    """Dataset template response model."""

    template_name: str = ""
    display_name: str = ""
    description: str = ""
    category: str = ""
    icon: Optional[str] = None
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
