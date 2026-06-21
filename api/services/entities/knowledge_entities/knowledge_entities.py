from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, WithJsonSchema, field_validator

from core.rag.entities import Rule
from core.rag.entities.metadata_entities import MetadataFilteringCondition
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from models.enums import ProcessRuleMode

DocForm = Annotated[
    str,
    WithJsonSchema({"enum": ["text_model", "hierarchical_model", "qa_model"], "type": "string"}),
]
IndexingTechnique = Annotated[
    str | None,
    WithJsonSchema({"anyOf": [{"enum": ["high_quality", "economy"], "type": "string"}, {"type": "null"}]}),
]
KnowledgeProvider = Annotated[
    str,
    WithJsonSchema({"enum": ["vendor", "external"], "type": "string"}),
]
RerankingMode = Annotated[
    str | None,
    WithJsonSchema({"anyOf": [{"enum": ["reranking_model", "weighted_score"], "type": "string"}, {"type": "null"}]}),
]
SummaryIndexSetting = Annotated[
    dict[str, Any] | None,
    WithJsonSchema(
        {
            "anyOf": [
                {
                    "properties": {
                        "enable": {"description": "Whether to enable summary indexing.", "type": "boolean"},
                        "model_name": {
                            "description": "Name of the model used for generating summaries.",
                            "type": "string",
                        },
                        "model_provider_name": {
                            "description": "Provider of the summary generation model.",
                            "type": "string",
                        },
                        "summary_prompt": {
                            "description": "Custom prompt template for summary generation.",
                            "type": "string",
                        },
                    },
                    "type": "object",
                },
                {"type": "null"},
            ]
        }
    ),
]
ExternalRetrievalModel = Annotated[
    dict[str, Any] | None,
    WithJsonSchema(
        {
            "anyOf": [
                {
                    "properties": {
                        "top_k": {"description": "Maximum number of results to return.", "type": "integer"},
                        "score_threshold": {
                            "description": "Minimum similarity score threshold for filtering results.",
                            "type": "number",
                        },
                        "score_threshold_enabled": {
                            "description": "Whether score threshold filtering is enabled.",
                            "type": "boolean",
                        },
                    },
                    "type": "object",
                },
                {"type": "null"},
            ]
        }
    ),
]


class RerankingModel(BaseModel):
    reranking_provider_name: str | None = Field(default=None, description="Provider name of the reranking model.")
    reranking_model_name: str | None = Field(default=None, description="Name of the reranking model.")


class NotionIcon(BaseModel):
    type: str
    url: str | None = None
    emoji: str | None = None


class NotionPage(BaseModel):
    page_id: str
    page_name: str
    page_icon: NotionIcon | None = None
    type: str


class NotionInfo(BaseModel):
    credential_id: str
    workspace_id: str
    pages: list[NotionPage]


class WebsiteInfo(BaseModel):
    provider: str
    job_id: str
    urls: list[str]
    only_main_content: bool = True


class FileInfo(BaseModel):
    file_ids: list[str]


class InfoList(BaseModel):
    data_source_type: Literal["upload_file", "notion_import", "website_crawl"]
    notion_info_list: list[NotionInfo] | None = None
    file_info_list: FileInfo | None = None
    website_info_list: WebsiteInfo | None = None


class DataSource(BaseModel):
    info_list: InfoList


class ProcessRule(BaseModel):
    mode: ProcessRuleMode = Field(
        description=(
            "Processing mode. `automatic` uses built-in rules, `custom` allows manual configuration, and "
            "`hierarchical` enables parent-child chunk structure for `doc_form: hierarchical_model`."
        )
    )
    rules: Rule | None = Field(default=None, description="Custom processing rules.")


class WeightVectorSetting(BaseModel):
    vector_weight: float = Field(description="Weight assigned to semantic vector search results.")
    embedding_provider_name: str = Field(description="Provider of the embedding model used for vector search.")
    embedding_model_name: str = Field(description="Name of the embedding model used for vector search.")


class WeightKeywordSetting(BaseModel):
    keyword_weight: float = Field(description="Weight assigned to keyword search results.")


class WeightModel(BaseModel):
    weight_type: Literal["semantic_first", "keyword_first", "customized"] | None = Field(
        default=None,
        description="Strategy for balancing semantic and keyword search weights.",
    )
    vector_setting: WeightVectorSetting | None = Field(default=None, description="Semantic search weight settings.")
    keyword_setting: WeightKeywordSetting | None = Field(default=None, description="Keyword search weight settings.")


class RetrievalModel(BaseModel):
    search_method: RetrievalMethod = Field(description="Search method used for retrieval.")
    reranking_enable: bool = Field(description="Whether reranking is enabled.")
    reranking_model: RerankingModel | None = Field(default=None, description="Reranking model configuration.")
    reranking_mode: RerankingMode = Field(
        default=None,
        description="Reranking mode. Required when `reranking_enable` is `true`.",
    )
    top_k: int = Field(description="Maximum number of results to return.")
    score_threshold_enabled: bool = Field(description="Whether score threshold filtering is enabled.")
    score_threshold: float | None = Field(
        default=None,
        description="Minimum similarity score for results. Only effective when score threshold filtering is enabled.",
    )
    weights: WeightModel | None = Field(default=None, description="Weight configuration for hybrid search.")
    metadata_filtering_conditions: MetadataFilteringCondition | None = Field(
        default=None,
        description=(
            "Restrict retrieval to chunks whose document metadata matches the given conditions. Conditions are "
            "evaluated server-side against document metadata fields."
        ),
    )


class MetaDataConfig(BaseModel):
    doc_type: str
    doc_metadata: dict[str, Any]


class KnowledgeConfig(BaseModel):
    original_document_id: str | None = Field(default=None, description="Original document ID for replacement updates.")
    duplicate: bool = Field(default=True, description="Whether duplicate document content is allowed.")
    indexing_technique: Literal["high_quality", "economy"] = Field(
        description=(
            "`high_quality` uses embedding models for precise search; `economy` uses keyword-based indexing. "
            "Required when adding the first document to a knowledge base; subsequent documents inherit the "
            "knowledge base's indexing technique if omitted."
        )
    )
    data_source: DataSource | None = Field(default=None, description="Document data source configuration.")
    process_rule: ProcessRule | None = Field(default=None, description="Processing rules for chunking.")
    retrieval_model: RetrievalModel | None = Field(
        default=None,
        description=(
            "Retrieval model configuration. Controls how chunks are searched and ranked in this knowledge base."
        ),
    )
    summary_index_setting: SummaryIndexSetting = Field(
        default=None,
        description="Summary index configuration.",
    )
    doc_form: DocForm = Field(
        default="text_model",
        description=(
            "`text_model` for standard text chunking, `hierarchical_model` for parent-child chunk structure, "
            "`qa_model` for question-answer pair extraction."
        ),
    )
    doc_language: str = Field(default="English", description="Language of the document for processing optimization.")
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
    name: str | None = Field(default=None, description="Document name.")
    is_multimodal: bool = Field(default=False, description="Whether the document uses multimodal indexing.")

    @field_validator("doc_form")
    @classmethod
    def validate_doc_form(cls, value: str) -> str:
        valid_forms = [
            IndexStructureType.PARAGRAPH_INDEX,
            IndexStructureType.QA_INDEX,
            IndexStructureType.PARENT_CHILD_INDEX,
        ]
        if value not in valid_forms:
            raise ValueError("Invalid doc_form.")
        return value


class SegmentCreateArgs(BaseModel):
    content: str | None = Field(default=None, description="Chunk text content.")
    answer: str | None = Field(default=None, description="Answer content for QA mode.")
    keywords: list[str] | None = Field(default=None, description="Keywords for the chunk.")
    attachment_ids: list[str] | None = Field(default=None, description="Attachment file IDs.")


class SegmentUpdateArgs(BaseModel):
    content: str | None = Field(default=None, description="Updated chunk text content.")
    answer: str | None = Field(default=None, description="Updated answer content for QA mode.")
    keywords: list[str] | None = Field(default=None, description="Updated keywords for the chunk.")
    regenerate_child_chunks: bool = Field(
        default=False,
        description="Whether to regenerate child chunks after updating a parent chunk.",
    )
    enabled: bool | None = Field(default=None, description="Whether the chunk is enabled.")
    attachment_ids: list[str] | None = Field(default=None, description="Attachment file IDs.")
    summary: str | None = Field(default=None, description="Summary content for summary index.")


class ChildChunkUpdateArgs(BaseModel):
    id: str | None = Field(default=None, description="Existing child chunk ID. Omit to create a new child chunk.")
    content: str = Field(description="Child chunk text content.")


class MetadataArgs(BaseModel):
    type: Literal["string", "number", "time"] = Field(
        description="`string` for text values, `number` for numeric values, `time` for date/time values."
    )
    name: str = Field(description="Metadata field name.")


class MetadataUpdateArgs(BaseModel):
    name: str = Field(description="Metadata field name.")
    value: str | int | float | None = Field(
        default=None,
        description="Metadata value. Can be a string, number, or `null`.",
    )


class MetadataDetail(BaseModel):
    id: str = Field(description="Metadata field ID.")
    name: str = Field(description="Metadata field name.")
    value: str | int | float | None = Field(
        default=None,
        description="Metadata value. Can be a string, number, or `null`.",
    )


class DocumentMetadataOperation(BaseModel):
    document_id: str = Field(description="Document ID whose metadata should be updated.")
    metadata_list: list[MetadataDetail] = Field(description="Metadata fields to update.")
    partial_update: bool = Field(
        default=False,
        description="Whether to partially update metadata, keeping existing values for unspecified fields.",
    )


class MetadataOperationData(BaseModel):
    """
    Metadata operation data
    """

    operation_data: list[DocumentMetadataOperation] = Field(
        description=(
            "Array of document metadata update operations. Each entry maps a document ID to its metadata values."
        )
    )
