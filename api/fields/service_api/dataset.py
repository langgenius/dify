"""Service API schemas for knowledge-base and knowledge-tag endpoints."""

from typing import Annotated, Literal, override

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    GetJsonSchemaHandler,
    RootModel,
    WithJsonSchema,
    field_validator,
    model_validator,
)

from fields.base import ResponseModel
from fields.dataset_fields import DatasetDetailResponse as BaseDatasetDetailResponse
from models.dataset import DatasetPermissionEnum
from services.knowledge.entities.knowledge_entities import (
    ExternalRetrievalModel,
    KnowledgeProvider,
    RetrievalModel,
    SummaryIndexSetting,
)

PartialMemberList = Annotated[
    list[dict[str, str]] | None,
    WithJsonSchema(
        {
            "anyOf": [
                {
                    "items": {
                        "properties": {
                            "user_id": {
                                "description": "ID of the team member to grant access.",
                                "type": "string",
                            }
                        },
                        "type": "object",
                    },
                    "type": "array",
                },
                {"type": "null"},
            ]
        }
    ),
]


class DatasetDetailResponse(BaseDatasetDetailResponse):
    # The Service API dump helpers exclude Console permission metadata and form settings.
    permission_keys: list[str] = Field(default_factory=list, exclude=True)
    keyword_number: int | None = Field(default=None, exclude=True)


class DatasetCreatePayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=40, description="Name of the knowledge base.")
    description: str = Field(default="", description="Description of the knowledge base.", max_length=400)
    indexing_technique: Literal["high_quality", "economy"] | None = Field(
        default=None,
        description="`high_quality` uses embedding models for precise search; `economy` uses keyword-based indexing.",
    )
    permission: DatasetPermissionEnum | None = Field(
        default=DatasetPermissionEnum.ONLY_ME,
        description=(
            "Controls who can access this knowledge base. `only_me` restricts access to the creator, "
            "`all_team_members` grants workspace-wide access, and `partial_members` grants access to specified "
            "members."
        ),
    )
    external_knowledge_api_id: str | None = Field(default=None, description="ID of the external knowledge API.")
    provider: KnowledgeProvider = Field(
        default="vendor",
        description="Knowledge base provider: `vendor` for internal knowledge bases, `external` for external ones.",
    )
    external_knowledge_id: str | None = Field(default=None, description="ID of the external knowledge base.")
    retrieval_model: RetrievalModel | None = Field(
        default=None,
        description=(
            "Retrieval model configuration. Controls how chunks are searched and ranked when querying this "
            "knowledge base."
        ),
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
    summary_index_setting: SummaryIndexSetting = Field(
        default=None,
        description="Summary index configuration.",
    )


class DatasetUpdatePayload(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=40, description="Name of the knowledge base.")
    description: str | None = Field(default=None, description="Description of the knowledge base.", max_length=400)
    indexing_technique: Literal["high_quality", "economy"] | None = Field(
        default=None,
        description="`high_quality` uses embedding models for precise search; `economy` uses keyword-based indexing.",
    )
    permission: DatasetPermissionEnum | None = Field(
        default=None,
        description=(
            "Controls who can access this knowledge base. `only_me` restricts access to the creator, "
            "`all_team_members` grants workspace-wide access, and `partial_members` grants access to specified "
            "members."
        ),
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
    retrieval_model: RetrievalModel | None = Field(
        default=None,
        description=(
            "Retrieval model configuration. Controls how chunks are searched and ranked when querying this "
            "knowledge base."
        ),
    )
    partial_member_list: PartialMemberList = Field(
        default=None,
        description="List of team members with access when `permission` is `partial_members`.",
    )
    external_retrieval_model: ExternalRetrievalModel = Field(
        default=None,
        description="Retrieval settings for external knowledge bases.",
    )
    external_knowledge_id: str | None = Field(default=None, description="ID of the external knowledge base.")
    external_knowledge_api_id: str | None = Field(default=None, description="ID of the external knowledge API.")


class DocumentStatusPayload(BaseModel):
    document_ids: list[str] = Field(default_factory=list, description="List of document IDs to update.")


class TagNamePayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=50, description="Tag name.")


class TagCreatePayload(TagNamePayload):
    pass


class TagUpdatePayload(TagNamePayload):
    tag_id: str = Field(description="Tag ID to update.")


class TagDeletePayload(BaseModel):
    tag_id: str = Field(description="Tag ID to delete.")


class TagBindingPayload(BaseModel):
    tag_ids: list[str] = Field(
        description="Tag IDs to bind.",
        json_schema_extra={"minItems": 1},
    )
    target_id: str = Field(description="Knowledge base ID to bind the tags to.")

    @field_validator("tag_ids")
    @classmethod
    def validate_tag_ids(cls, value: list[str]) -> list[str]:
        if not value:
            raise ValueError("Tag IDs is required.")
        return value


class TagUnbindingPayload(BaseModel):
    """Accept the legacy single-tag Service API payload while exposing a normalized tag_ids list internally."""

    tag_ids: list[str] = Field(default_factory=list)
    tag_id: str | None = None
    target_id: str = Field(description="Knowledge base ID.")

    @classmethod
    @override
    def __get_pydantic_json_schema__(cls, _core_schema: object, _handler: GetJsonSchemaHandler) -> dict[str, object]:
        tag_id_annotations = {
            "deprecated": True,
            "description": "Legacy single tag ID accepted by the Service API.",
        }
        tag_id_property = {
            **tag_id_annotations,
            "type": "string",
        }
        tag_ids_property = {
            "description": "Tag IDs to unbind. Use this for new integrations.",
            "items": {"type": "string"},
            "minItems": 1,
            "type": "array",
        }
        target_id_property = {"description": "Knowledge base ID.", "title": "Target Id", "type": "string"}
        return {
            "anyOf": [
                {
                    "properties": {
                        "tag_id": tag_id_property,
                        "tag_ids": tag_ids_property,
                        "target_id": target_id_property,
                    },
                    "required": ["tag_id", "target_id"],
                    "type": "object",
                },
                {
                    "properties": {
                        "tag_id": {
                            **tag_id_annotations,
                            "anyOf": [{"type": "string"}, {"type": "null"}],
                        },
                        "tag_ids": tag_ids_property,
                        "target_id": target_id_property,
                    },
                    "required": ["tag_ids", "target_id"],
                    "type": "object",
                },
            ],
            "description": "Accepts either the legacy tag_id payload or the normalized tag_ids payload.",
            "title": cls.__name__,
        }

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_tag_id(cls, data: object) -> object:
        if not isinstance(data, dict):
            return data
        if not data.get("tag_ids") and data.get("tag_id"):
            return {**data, "tag_ids": [data["tag_id"]]}
        return data

    @model_validator(mode="after")
    def validate_tag_ids(self) -> "TagUnbindingPayload":
        if not self.tag_ids:
            raise ValueError("Tag IDs is required.")
        return self


class KnowledgeTagResponse(ResponseModel):
    model_config = ConfigDict(coerce_numbers_to_str=True)

    id: str
    name: str
    type: str
    # TODO: The public Service API docs expose binding_count as string|null.
    # Keep matching the old RESTX fields.String coercion until that contract is intentionally migrated.
    binding_count: str | None = None


class KnowledgeTagListResponse(RootModel[list[KnowledgeTagResponse]]):
    pass


class DatasetListQuery(BaseModel):
    page: int = Field(default=1, description="Page number to retrieve.")
    limit: int = Field(default=20, description="Number of items per page. Server caps at `100`.")
    keyword: str | None = Field(default=None, description="Search keyword to filter by name.")
    include_all: bool = Field(
        default=False,
        description="Whether to include all knowledge bases regardless of permissions.",
    )
    tag_ids: list[str] = Field(default_factory=list, description="Tag IDs to filter by.")


class DatasetDetailWithPartialMembersResponse(DatasetDetailResponse):
    partial_member_list: list[str] | None = None


class DatasetListResponse(ResponseModel):
    data: list[DatasetDetailResponse]
    has_more: bool
    limit: int
    total: int
    page: int


class DatasetBoundTagResponse(ResponseModel):
    id: str
    name: str


class DatasetBoundTagListResponse(ResponseModel):
    data: list[DatasetBoundTagResponse]
    total: int
