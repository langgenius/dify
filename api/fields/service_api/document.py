"""Request and response schemas for Service API document endpoints."""

from copy import deepcopy
from typing import Annotated, Any, Literal, Self, override

from pydantic import (
    BaseModel,
    Field,
    GetJsonSchemaHandler,
    WithJsonSchema,
    field_validator,
    model_validator,
)
from pydantic.json_schema import SkipJsonSchema

from core.rag.index_processor.constant.index_type import IndexStructureType
from enums.knowledge import DocumentIndexRetryAction, DocumentIndexState
from fields.base import ResponseModel
from fields.document_fields import DocumentMetadataResponse, DocumentResponse, normalize_enum
from services.knowledge.entities.knowledge_entities import (
    DocForm,
    IndexingTechnique,
    ProcessRule,
    RetrievalModel,
)


class DocumentTextCreatePayload(BaseModel):
    name: str = Field(description="Document name.")
    text: str = Field(description="Document text content.")
    process_rule: ProcessRule | None = Field(default=None, description="Processing rules for chunking.")
    original_document_id: str | None = Field(default=None, description="Original document ID for replacement.")
    doc_form: DocForm = Field(
        default="text_model",
        description=(
            "`text_model` for standard text chunking, `hierarchical_model` for parent-child chunk structure, "
            "`qa_model` for question-answer pair extraction."
        ),
    )
    doc_language: str = Field(default="English", description="Language of the document for processing optimization.")
    indexing_technique: IndexingTechnique = Field(
        default=None,
        description=(
            "`high_quality` uses embedding models for precise search; `economy` uses keyword-based indexing. "
            "Required when adding the first document to a knowledge base; subsequent documents inherit the "
            "knowledge base's indexing technique if omitted."
        ),
    )
    retrieval_model: RetrievalModel | None = Field(
        default=None,
        description="Controls how chunks are searched and ranked when querying this knowledge base.",
    )
    embedding_model: str | None = Field(
        default=None,
        description=(
            "Embedding model name. Use the `model` field from "
            "[Get Available Models](/api-reference/models/get-available-models) with `model_type=text-embedding`."
        ),
    )
    embedding_model_provider: str | None = Field(
        default=None,
        description=(
            "Embedding model provider. Use the `provider` field from "
            "[Get Available Models](/api-reference/models/get-available-models) with `model_type=text-embedding`."
        ),
    )

    @field_validator("doc_form")
    @classmethod
    def validate_doc_form(cls, value: str) -> str:
        if value not in set(IndexStructureType):
            raise ValueError("Invalid doc_form.")
        return value


class DocumentTextUpdate(BaseModel):
    name: str | None = Field(default=None, description="Document name. Required when `text` is provided.")
    text: str | None = Field(default=None, description="Document text content.")
    process_rule: ProcessRule | None = Field(default=None, description="Processing rules for chunking.")
    doc_form: DocForm = Field(
        default="text_model",
        description=(
            "`text_model` for standard text chunking, `hierarchical_model` for parent-child chunk structure, "
            "`qa_model` for question-answer pair extraction."
        ),
    )
    doc_language: str = Field(default="English", description="Language of the document for processing optimization.")
    retrieval_model: RetrievalModel | None = Field(
        default=None,
        description="Controls how chunks are searched and ranked when querying this knowledge base.",
    )

    @field_validator("doc_form")
    @classmethod
    def validate_doc_form(cls, value: str) -> str:
        if value not in set(IndexStructureType):
            raise ValueError("Invalid doc_form.")
        return value

    @classmethod
    @override
    def __get_pydantic_json_schema__(cls, core_schema: Any, handler: GetJsonSchemaHandler) -> dict[str, Any]:
        schema = handler.resolve_ref_schema(handler(core_schema))
        properties = schema.get("properties")
        if not isinstance(properties, dict):
            return schema

        text_branch_properties = deepcopy(properties)
        text_branch_properties["text"] = _non_null_property_schema(properties.get("text"))
        text_branch_properties["name"] = _non_null_property_schema(properties.get("name"))

        no_text_branch_properties = deepcopy(properties)
        no_text_branch_properties["text"] = {"description": "Document text content.", "type": "null"}

        return {
            **schema,
            "anyOf": [
                {
                    "properties": text_branch_properties,
                    "required": ["name", "text"],
                    "type": "object",
                },
                {
                    "properties": no_text_branch_properties,
                    "type": "object",
                },
            ],
        }

    @model_validator(mode="after")
    def check_text_and_name(self) -> Self:
        if self.text is not None and self.name is None:
            raise ValueError("name is required when text is provided")
        return self


def _non_null_property_schema(property_schema: object) -> dict[str, Any]:
    if not isinstance(property_schema, dict):
        return {}

    any_of = property_schema.get("anyOf")
    if isinstance(any_of, list):
        non_null_candidates = [
            candidate for candidate in any_of if isinstance(candidate, dict) and candidate.get("type") != "null"
        ]
        if len(non_null_candidates) == 1:
            return {
                **{
                    key: value
                    for key, value in property_schema.items()
                    if key != "anyOf" and not (key == "default" and value is None)
                },
                **deepcopy(non_null_candidates[0]),
            }

    return deepcopy(property_schema)


DocumentDisplayStatus = Annotated[
    str | None,
    WithJsonSchema(
        {
            "anyOf": [
                {
                    "enum": ["queuing", "indexing", "paused", "error", "available", "disabled", "archived"],
                    "type": "string",
                },
                {"type": "null"},
            ]
        }
    ),
]


class DocumentListQuery(BaseModel):
    page: int = Field(default=1, description="Page number to retrieve.")
    limit: int = Field(default=20, description="Number of items per page. Server caps at `100`.")
    keyword: str | None = Field(default=None, description="Search keyword to filter by document name.")
    status: DocumentDisplayStatus = Field(default=None, description="Filter by display status.")


class DocumentGetQuery(BaseModel):
    metadata: Literal["all", "only", "without"] = Field(
        default="all",
        description=(
            "`all` returns all fields including metadata. `only` returns only `id`, `doc_type`, and "
            "`doc_metadata`. `without` returns all fields except `doc_type` and `doc_metadata`."
        ),
    )


DOCUMENT_CREATE_BY_FILE_PARAMS = {
    "dataset_id": "Knowledge base ID.",
    "file": {
        "in": "formData",
        "type": "file",
        "required": True,
        "description": "Document file to upload.",
    },
    "data": {
        "in": "formData",
        "type": "string",
        "required": False,
        "description": (
            "JSON string containing configuration. Accepts the same fields as "
            "[Create Document by Text](/api-reference/documents/create-document-by-text) (`indexing_technique`, "
            "`doc_form`, `doc_language`, `process_rule`, `retrieval_model`, `embedding_model`, "
            "`embedding_model_provider`) except `name` and `text`."
        ),
    },
}
DOCUMENT_UPDATE_BY_FILE_PARAMS = {
    "dataset_id": "Knowledge base ID.",
    "document_id": "Document ID.",
    "file": {
        "in": "formData",
        "type": "file",
        "required": False,
        "description": "Replacement document file to upload.",
    },
    "data": {
        "in": "formData",
        "type": "string",
        "required": False,
        "description": (
            "JSON string containing document update settings such as `doc_form`, `doc_language`, `process_rule`, "
            "`retrieval_model`, `embedding_model`, and `embedding_model_provider`. `name` and `text` are not used "
            "for file updates."
        ),
    },
}


class DocumentAndBatchResponse(ResponseModel):
    document: DocumentResponse
    batch: str


def _omit_schema_default(schema: dict[str, Any]) -> None:
    """Keep omission placeholders out of the public non-null field contract."""
    schema.pop("default", None)


# These fields are absent in metadata=only responses. None is an internal
# validation default, not a value returned for these fields when present.
class DocumentDetailResponse(ResponseModel):
    id: str
    position: int | SkipJsonSchema[None] = Field(default=None, json_schema_extra=_omit_schema_default)
    data_source_type: str | SkipJsonSchema[None] = Field(default=None, json_schema_extra=_omit_schema_default)
    data_source_info: dict[str, Any] | SkipJsonSchema[None] = Field(
        default=None, json_schema_extra=_omit_schema_default
    )
    dataset_process_rule_id: str | None = None
    dataset_process_rule: dict[str, Any] | SkipJsonSchema[None] = Field(
        default=None, json_schema_extra=_omit_schema_default
    )
    document_process_rule: dict[str, Any] | SkipJsonSchema[None] = Field(
        default=None, json_schema_extra=_omit_schema_default
    )
    name: str | SkipJsonSchema[None] = Field(default=None, json_schema_extra=_omit_schema_default)
    created_from: str | SkipJsonSchema[None] = Field(default=None, json_schema_extra=_omit_schema_default)
    created_by: str | SkipJsonSchema[None] = Field(default=None, json_schema_extra=_omit_schema_default)
    created_at: int | SkipJsonSchema[None] = Field(default=None, json_schema_extra=_omit_schema_default)
    tokens: int | None = None
    indexing_status: str | SkipJsonSchema[None] = Field(default=None, json_schema_extra=_omit_schema_default)
    completed_at: int | None = None
    updated_at: int | None = None
    indexing_latency: float | None = None
    error: str | None = None
    enabled: bool | SkipJsonSchema[None] = Field(default=None, json_schema_extra=_omit_schema_default)
    indexing_state: DocumentIndexState | None = None
    indexing_retry_action: DocumentIndexRetryAction | None = None
    disabled_at: int | None = None
    disabled_by: str | None = None
    archived: bool | SkipJsonSchema[None] = Field(default=None, json_schema_extra=_omit_schema_default)
    doc_type: str | None = None
    doc_metadata: list[DocumentMetadataResponse] | dict[str, Any] | None = None
    segment_count: int | SkipJsonSchema[None] = Field(default=None, json_schema_extra=_omit_schema_default)
    average_segment_length: int | float | SkipJsonSchema[None] = Field(
        default=None, json_schema_extra=_omit_schema_default
    )
    hit_count: int | SkipJsonSchema[None] = Field(default=None, json_schema_extra=_omit_schema_default)
    display_status: str | None = None
    doc_form: str | SkipJsonSchema[None] = Field(default=None, json_schema_extra=_omit_schema_default)
    doc_language: str | None = None
    summary_index_status: str | None = None
    need_summary: bool | SkipJsonSchema[None] = Field(default=None, json_schema_extra=_omit_schema_default)

    @field_validator("data_source_type", "indexing_status", "display_status", "doc_form", mode="before")
    @classmethod
    def _normalize_enum_fields(cls, value: Any) -> Any:
        return normalize_enum(value)
