"""Typed response shapes for workflow JSON stored as free-form documents.

Graphs, feature settings and node execution metadata are persisted as JSON and
round-trip back to the editor, so these models document the keys clients rely on
while keeping every other key and never adding keys the stored document lacks.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import ConfigDict, Field, SerializerFunctionWrapHandler, model_serializer

from fields.app_model_config_response import AppModelSelectionResponse
from fields.base import ResponseModel


class StoredJsonResponseModel(ResponseModel):
    """Serialize a stored JSON document as-is: unknown keys pass through, absent keys stay absent."""

    model_config = ConfigDict(extra="allow")

    @model_serializer(mode="wrap")
    def _serialize_present_keys(self, handler: SerializerFunctionWrapHandler):
        data = handler(self)
        present = self.model_fields_set | set(self.__pydantic_extra__ or {})
        aliases = {
            name: field.serialization_alias or field.alias or name for name, field in type(self).model_fields.items()
        }
        present_keys = {aliases.get(name, name) for name in present}
        return {key: value for key, value in data.items() if key in present_keys}


class WorkflowGraphPositionResponse(StoredJsonResponseModel):
    x: float
    y: float


class WorkflowGraphViewportResponse(StoredJsonResponseModel):
    x: float
    y: float
    zoom: float


class WorkflowGraphNodeDataResponse(StoredJsonResponseModel):
    type: str
    title: str | None = None
    desc: str | None = None


class WorkflowGraphNodeResponse(StoredJsonResponseModel):
    id: str
    type: str | None = None
    position: WorkflowGraphPositionResponse | None = None
    data: WorkflowGraphNodeDataResponse


class WorkflowGraphEdgeDataResponse(StoredJsonResponseModel):
    source_type: str | None = Field(default=None, alias="sourceType")
    target_type: str | None = Field(default=None, alias="targetType")


class WorkflowGraphEdgeResponse(StoredJsonResponseModel):
    id: str | None = None
    source: str
    target: str
    source_handle: str | None = Field(default=None, alias="sourceHandle")
    target_handle: str | None = Field(default=None, alias="targetHandle")
    data: WorkflowGraphEdgeDataResponse | None = None


class WorkflowGraphResponse(StoredJsonResponseModel):
    nodes: list[WorkflowGraphNodeResponse] = Field(default_factory=list)
    edges: list[WorkflowGraphEdgeResponse] = Field(default_factory=list)
    viewport: WorkflowGraphViewportResponse | None = None


class WorkflowFeatureToggleResponse(StoredJsonResponseModel):
    enabled: bool | None = None


class WorkflowSuggestedQuestionsAfterAnswerResponse(WorkflowFeatureToggleResponse):
    model: AppModelSelectionResponse | None = None
    prompt: str | None = None


class WorkflowTextToSpeechResponse(WorkflowFeatureToggleResponse):
    language: str | None = None
    voice: str | None = None
    auto_play: Literal["enabled", "disabled"] | None = Field(default=None, alias="autoPlay")


class WorkflowSensitiveWordAvoidanceResponse(WorkflowFeatureToggleResponse):
    type: str | None = None
    config: dict[str, Any] | None = None


class WorkflowFileUploadTransferResponse(WorkflowFeatureToggleResponse):
    number_limits: int | None = None
    transfer_methods: list[str] | None = None


class WorkflowFileUploadImageResponse(WorkflowFileUploadTransferResponse):
    detail: str | None = None


class WorkflowFileUploadResponse(WorkflowFeatureToggleResponse):
    allowed_file_types: list[str] | None = None
    allowed_file_extensions: list[str] | None = None
    allowed_file_upload_methods: list[str] | None = None
    number_limits: int | None = None
    image: WorkflowFileUploadImageResponse | None = None


class WorkflowFeaturesResponse(StoredJsonResponseModel):
    opening_statement: str | None = None
    suggested_questions: list[str] | None = None
    suggested_questions_after_answer: WorkflowSuggestedQuestionsAfterAnswerResponse | None = None
    text_to_speech: WorkflowTextToSpeechResponse | None = None
    speech_to_text: WorkflowFeatureToggleResponse | None = None
    retriever_resource: WorkflowFeatureToggleResponse | None = None
    sensitive_word_avoidance: WorkflowSensitiveWordAvoidanceResponse | None = None
    file_upload: WorkflowFileUploadResponse | None = None


class WorkflowAgentLogMetadataResponse(StoredJsonResponseModel):
    elapsed_time: float | None = None
    provider: str | None = None
    icon: str | None = None


class WorkflowAgentLogResponse(StoredJsonResponseModel):
    node_execution_id: str | None = None
    message_id: str | None = None
    node_id: str | None = None
    parent_id: str | None = None
    label: str | None = None
    data: dict[str, Any] | None = None
    error: str | None = None
    status: str | None = None
    metadata: WorkflowAgentLogMetadataResponse | None = None


class WorkflowNodeToolInfoResponse(StoredJsonResponseModel):
    agent_strategy: str | None = None
    icon: str | None = None


class WorkflowNodeExecutionMetadataResponse(StoredJsonResponseModel):
    total_tokens: int | None = None
    total_price: float | None = None
    currency: str | None = None
    tool_info: WorkflowNodeToolInfoResponse | None = None
    # Agent nodes record a list of log items; Agent V2 nodes record their backend run metadata
    # (`{"agent_backend": {...}, ...}`) under the same key.
    agent_log: list[WorkflowAgentLogResponse] | dict[str, Any] | None = None
    iteration_id: str | None = None
    iteration_index: int | None = None
    loop_id: str | None = None
    loop_index: int | None = None
    parallel_id: str | None = None
    parallel_start_node_id: str | None = None
    parent_parallel_id: str | None = None
    parent_parallel_start_node_id: str | None = None
    parallel_mode_run_id: str | None = None
    iteration_duration_map: dict[str, float] | None = None
    loop_duration_map: dict[str, float] | None = None
    error_strategy: str | None = None
    loop_variable_map: dict[str, Any] | None = None
