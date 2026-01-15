import base64
import enum
import hashlib
import hmac
import json
import logging
import os
import pickle
import re
import time
from datetime import datetime
from json import JSONDecodeError
from typing import Any, cast
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy import DateTime, String, func, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from configs import dify_config
from core.rag.index_processor.constant.built_in_field import BuiltInField, MetadataDataSource
from core.rag.index_processor.constant.query_type import QueryType
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.tools.signature import sign_upload_file
from extensions.ext_storage import storage
from libs.uuid_utils import uuidv7
from services.entities.knowledge_entities.knowledge_entities import ParentMode, Rule

from .account import Account
from .base import Base, TypeBase
from .engine import db
from .model import App, Tag, TagBinding, UploadFile
from .types import AdjustedJSON, BinaryData, LongText, StringUUID, adjusted_json_index

logger = logging.getLogger(__name__)


class DatasetPermissionEnum(enum.StrEnum):
    ONLY_ME = "only_me"
    ALL_TEAM = "all_team_members"
    PARTIAL_TEAM = "partial_members"


class Dataset(Base):
    __tablename__ = "datasets"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="dataset_pkey"),
        sa.Index("dataset_tenant_idx", "tenant_id"),
        adjusted_json_index("retrieval_model_idx", "retrieval_model"),
    )

    INDEXING_TECHNIQUE_LIST = ["high_quality", "economy", None]
    PROVIDER_LIST = ["vendor", "external", None]

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuid4()))
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    name: Mapped[str] = mapped_column(String(255))
    description = mapped_column(LongText, nullable=True)
    provider: Mapped[str] = mapped_column(String(255), server_default=sa.text("'vendor'"))
    permission: Mapped[str] = mapped_column(String(255), server_default=sa.text("'only_me'"))
    data_source_type = mapped_column(String(255))
    indexing_technique: Mapped[str | None] = mapped_column(String(255))
    index_struct = mapped_column(LongText, nullable=True)
    created_by = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_by = mapped_column(StringUUID, nullable=True)
    updated_at = mapped_column(
        sa.DateTime, nullable=False, server_default=func.current_timestamp(), onupdate=func.current_timestamp()
    )
    embedding_model = mapped_column(sa.String(255), nullable=True)
    embedding_model_provider = mapped_column(sa.String(255), nullable=True)
    keyword_number = mapped_column(sa.Integer, nullable=True, server_default=sa.text("10"))
    collection_binding_id = mapped_column(StringUUID, nullable=True)
    retrieval_model = mapped_column(AdjustedJSON, nullable=True)
    built_in_field_enabled = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("false"))
    icon_info = mapped_column(AdjustedJSON, nullable=True)
    runtime_mode = mapped_column(sa.String(255), nullable=True, server_default=sa.text("'general'"))
    pipeline_id = mapped_column(StringUUID, nullable=True)
    chunk_structure = mapped_column(sa.String(255), nullable=True)
    enable_api = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("true"))
    is_multimodal = mapped_column(sa.Boolean, default=False, nullable=False, server_default=db.text("false"))

    @property
    def total_documents(self):
        return db.session.query(func.count(Document.id)).where(Document.dataset_id == self.id).scalar()

    @property
    def total_available_documents(self):
        return (
            db.session.query(func.count(Document.id))
            .where(
                Document.dataset_id == self.id,
                Document.indexing_status == "completed",
                Document.enabled == True,
                Document.archived == False,
            )
            .scalar()
        )

    @property
    def dataset_keyword_table(self):
        dataset_keyword_table = (
            db.session.query(DatasetKeywordTable).where(DatasetKeywordTable.dataset_id == self.id).first()
        )
        if dataset_keyword_table:
            return dataset_keyword_table

        return None

    @property
    def index_struct_dict(self):
        return json.loads(self.index_struct) if self.index_struct else None

    @property
    def external_retrieval_model(self):
        default_retrieval_model = {
            "top_k": 2,
            "score_threshold": 0.0,
        }
        return self.retrieval_model or default_retrieval_model

    @property
    def created_by_account(self):
        return db.session.get(Account, self.created_by)

    @property
    def author_name(self) -> str | None:
        account = db.session.get(Account, self.created_by)
        if account:
            return account.name
        return None

    @property
    def latest_process_rule(self):
        return (
            db.session.query(DatasetProcessRule)
            .where(DatasetProcessRule.dataset_id == self.id)
            .order_by(DatasetProcessRule.created_at.desc())
            .first()
        )

    @property
    def app_count(self):
        return (
            db.session.query(func.count(AppDatasetJoin.id))
            .where(AppDatasetJoin.dataset_id == self.id, App.id == AppDatasetJoin.app_id)
            .scalar()
        )

    @property
    def document_count(self):
        return db.session.query(func.count(Document.id)).where(Document.dataset_id == self.id).scalar()

    @property
    def available_document_count(self):
        return (
            db.session.query(func.count(Document.id))
            .where(
                Document.dataset_id == self.id,
                Document.indexing_status == "completed",
                Document.enabled == True,
                Document.archived == False,
            )
            .scalar()
        )

    @property
    def available_segment_count(self):
        return (
            db.session.query(func.count(DocumentSegment.id))
            .where(
                DocumentSegment.dataset_id == self.id,
                DocumentSegment.status == "completed",
                DocumentSegment.enabled == True,
            )
            .scalar()
        )

    @property
    def word_count(self):
        return (
            db.session.query(Document)
            .with_entities(func.coalesce(func.sum(Document.word_count), 0))
            .where(Document.dataset_id == self.id)
            .scalar()
        )

    @property
    def doc_form(self) -> str | None:
        if self.chunk_structure:
            return self.chunk_structure
        document = db.session.query(Document).where(Document.dataset_id == self.id).first()
        if document:
            return document.doc_form
        return None

    @property
    def retrieval_model_dict(self):
        default_retrieval_model = {
            "search_method": RetrievalMethod.SEMANTIC_SEARCH,
            "reranking_enable": False,
            "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
            "top_k": 2,
            "score_threshold_enabled": False,
        }
        return self.retrieval_model or default_retrieval_model

    @property
    def tags(self):
        tags = (
            db.session.query(Tag)
            .join(TagBinding, Tag.id == TagBinding.tag_id)
            .where(
                TagBinding.target_id == self.id,
                TagBinding.tenant_id == self.tenant_id,
                Tag.tenant_id == self.tenant_id,
                Tag.type == "knowledge",
            )
            .all()
        )

        return tags or []

    @property
    def external_knowledge_info(self):
        if self.provider != "external":
            return None
        external_knowledge_binding = (
            db.session.query(ExternalKnowledgeBindings).where(ExternalKnowledgeBindings.dataset_id == self.id).first()
        )
        if not external_knowledge_binding:
            return None
        external_knowledge_api = db.session.scalar(
            select(ExternalKnowledgeApis).where(
                ExternalKnowledgeApis.id == external_knowledge_binding.external_knowledge_api_id
            )
        )
        if external_knowledge_api is None or external_knowledge_api.settings is None:
            return None
        return {
            "external_knowledge_id": external_knowledge_binding.external_knowledge_id,
            "external_knowledge_api_id": external_knowledge_api.id,
            "external_knowledge_api_name": external_knowledge_api.name,
            "external_knowledge_api_endpoint": json.loads(external_knowledge_api.settings).get("endpoint", ""),
        }

    @property
    def is_published(self):
        if self.pipeline_id:
            pipeline = db.session.query(Pipeline).where(Pipeline.id == self.pipeline_id).first()
            if pipeline:
                return pipeline.is_published
        return False

    @property
    def doc_metadata(self):
        dataset_metadatas = db.session.scalars(
            select(DatasetMetadata).where(DatasetMetadata.dataset_id == self.id)
        ).all()

        doc_metadata = [
            {
                "id": dataset_metadata.id,
                "name": dataset_metadata.name,
                "type": dataset_metadata.type,
            }
            for dataset_metadata in dataset_metadatas
        ]
        if self.built_in_field_enabled:
            doc_metadata.append(
                {
                    "id": "built-in",
                    "name": BuiltInField.document_name,
                    "type": "string",
                }
            )
            doc_metadata.append(
                {
                    "id": "built-in",
                    "name": BuiltInField.uploader,
                    "type": "string",
                }
            )
            doc_metadata.append(
                {
                    "id": "built-in",
                    "name": BuiltInField.upload_date,
                    "type": "time",
                }
            )
            doc_metadata.append(
                {
                    "id": "built-in",
                    "name": BuiltInField.last_update_date,
                    "type": "time",
                }
            )
            doc_metadata.append(
                {
                    "id": "built-in",
                    "name": BuiltInField.source,
                    "type": "string",
                }
            )
        return doc_metadata

    @staticmethod
    def gen_collection_name_by_id(dataset_id: str) -> str:
        normalized_dataset_id = dataset_id.replace("-", "_")
        return f"{dify_config.VECTOR_INDEX_NAME_PREFIX}_{normalized_dataset_id}_Node"


class DatasetProcessRule(Base):  # bug
    __tablename__ = "dataset_process_rules"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="dataset_process_rule_pkey"),
        sa.Index("dataset_process_rule_dataset_id_idx", "dataset_id"),
    )

    id = mapped_column(StringUUID, nullable=False, default=lambda: str(uuid4()))
    dataset_id = mapped_column(StringUUID, nullable=False)
    mode = mapped_column(String(255), nullable=False, server_default=sa.text("'automatic'"))
    rules = mapped_column(LongText, nullable=True)
    created_by = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())

    MODES = ["automatic", "custom", "hierarchical"]
    PRE_PROCESSING_RULES = ["remove_stopwords", "remove_extra_spaces", "remove_urls_emails"]
    AUTOMATIC_RULES: dict[str, Any] = {
        "pre_processing_rules": [
            {"id": "remove_extra_spaces", "enabled": True},
            {"id": "remove_urls_emails", "enabled": False},
        ],
        "segmentation": {"delimiter": "\n", "max_tokens": 500, "chunk_overlap": 50},
    }

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "dataset_id": self.dataset_id,
            "mode": self.mode,
            "rules": self.rules_dict,
        }

    @property
    def rules_dict(self) -> dict[str, Any] | None:
        try:
            return json.loads(self.rules) if self.rules else None
        except JSONDecodeError:
            return None


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="document_pkey"),
        sa.Index("document_dataset_id_idx", "dataset_id"),
        sa.Index("document_is_paused_idx", "is_paused"),
        sa.Index("document_tenant_idx", "tenant_id"),
        adjusted_json_index("document_metadata_idx", "doc_metadata"),
    )

    # initial fields
    id = mapped_column(StringUUID, nullable=False, default=lambda: str(uuid4()))
    tenant_id = mapped_column(StringUUID, nullable=False)
    dataset_id = mapped_column(StringUUID, nullable=False)
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    data_source_type: Mapped[str] = mapped_column(String(255), nullable=False)
    data_source_info = mapped_column(LongText, nullable=True)
    dataset_process_rule_id = mapped_column(StringUUID, nullable=True)
    batch: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_from: Mapped[str] = mapped_column(String(255), nullable=False)
    created_by = mapped_column(StringUUID, nullable=False)
    created_api_request_id = mapped_column(StringUUID, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())

    # start processing
    processing_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # parsing
    file_id = mapped_column(LongText, nullable=True)
    word_count: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)  # TODO: make this not nullable
    parsing_completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # cleaning
    cleaning_completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # split
    splitting_completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # indexing
    tokens: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    indexing_latency: Mapped[float | None] = mapped_column(sa.Float, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # pause
    is_paused: Mapped[bool | None] = mapped_column(sa.Boolean, nullable=True, server_default=sa.text("false"))
    paused_by = mapped_column(StringUUID, nullable=True)
    paused_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # error
    error = mapped_column(LongText, nullable=True)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # basic fields
    indexing_status = mapped_column(String(255), nullable=False, server_default=sa.text("'waiting'"))
    enabled: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("true"))
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    disabled_by = mapped_column(StringUUID, nullable=True)
    archived: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("false"))
    archived_reason = mapped_column(String(255), nullable=True)
    archived_by = mapped_column(StringUUID, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), onupdate=func.current_timestamp()
    )
    doc_type = mapped_column(String(40), nullable=True)
    doc_metadata = mapped_column(AdjustedJSON, nullable=True)
    doc_form = mapped_column(String(255), nullable=False, server_default=sa.text("'text_model'"))
    doc_language = mapped_column(String(255), nullable=True)

    DATA_SOURCES = ["upload_file", "notion_import", "website_crawl"]

    @property
    def display_status(self):
        status = None
        if self.indexing_status == "waiting":
            status = "queuing"
        elif self.indexing_status not in {"completed", "error", "waiting"} and self.is_paused:
            status = "paused"
        elif self.indexing_status in {"parsing", "cleaning", "splitting", "indexing"}:
            status = "indexing"
        elif self.indexing_status == "error":
            status = "error"
        elif self.indexing_status == "completed" and not self.archived and self.enabled:
            status = "available"
        elif self.indexing_status == "completed" and not self.archived and not self.enabled:
            status = "disabled"
        elif self.indexing_status == "completed" and self.archived:
            status = "archived"
        return status

    @property
    def data_source_info_dict(self) -> dict[str, Any]:
        if self.data_source_info:
            try:
                data_source_info_dict: dict[str, Any] = json.loads(self.data_source_info)
            except JSONDecodeError:
                data_source_info_dict = {}

            return data_source_info_dict
        return {}

    @property
    def data_source_detail_dict(self) -> dict[str, Any]:
        if self.data_source_info:
            if self.data_source_type == "upload_file":
                data_source_info_dict: dict[str, Any] = json.loads(self.data_source_info)
                file_detail = (
                    db.session.query(UploadFile)
                    .where(UploadFile.id == data_source_info_dict["upload_file_id"])
                    .one_or_none()
                )
                if file_detail:
                    return {
                        "upload_file": {
                            "id": file_detail.id,
                            "name": file_detail.name,
                            "size": file_detail.size,
                            "extension": file_detail.extension,
                            "mime_type": file_detail.mime_type,
                            "created_by": file_detail.created_by,
                            "created_at": file_detail.created_at.timestamp(),
                        }
                    }
            elif self.data_source_type in {"notion_import", "website_crawl"}:
                result: dict[str, Any] = json.loads(self.data_source_info)
                return result
        return {}

    @property
    def average_segment_length(self):
        if self.word_count and self.word_count != 0 and self.segment_count and self.segment_count != 0:
            return self.word_count // self.segment_count
        return 0

    @property
    def dataset_process_rule(self):
        if self.dataset_process_rule_id:
            return db.session.get(DatasetProcessRule, self.dataset_process_rule_id)
        return None

    @property
    def dataset(self):
        return db.session.query(Dataset).where(Dataset.id == self.dataset_id).one_or_none()

    @property
    def segment_count(self):
        return db.session.query(DocumentSegment).where(DocumentSegment.document_id == self.id).count()

    @property
    def hit_count(self):
        return (
            db.session.query(DocumentSegment)
            .with_entities(func.coalesce(func.sum(DocumentSegment.hit_count), 0))
            .where(DocumentSegment.document_id == self.id)
            .scalar()
        )

    @property
    def uploader(self):
        user = db.session.query(Account).where(Account.id == self.created_by).first()
        return user.name if user else None

    @property
    def upload_date(self):
        return self.created_at

    @property
    def last_update_date(self):
        return self.updated_at

    @property
    def doc_metadata_details(self) -> list[dict[str, Any]] | None:
        if self.doc_metadata:
            document_metadatas = (
                db.session.query(DatasetMetadata)
                .join(DatasetMetadataBinding, DatasetMetadataBinding.metadata_id == DatasetMetadata.id)
                .where(
                    DatasetMetadataBinding.dataset_id == self.dataset_id, DatasetMetadataBinding.document_id == self.id
                )
                .all()
            )
            metadata_list: list[dict[str, Any]] = []
            for metadata in document_metadatas:
                metadata_dict: dict[str, Any] = {
                    "id": metadata.id,
                    "name": metadata.name,
                    "type": metadata.type,
                    "value": self.doc_metadata.get(metadata.name),
                }
                metadata_list.append(metadata_dict)
            # deal built-in fields
            metadata_list.extend(self.get_built_in_fields())

            return metadata_list
        return None

    @property
    def process_rule_dict(self) -> dict[str, Any] | None:
        if self.dataset_process_rule_id and self.dataset_process_rule:
            return self.dataset_process_rule.to_dict()
        return None

    def get_built_in_fields(self) -> list[dict[str, Any]]:
        built_in_fields: list[dict[str, Any]] = []
        built_in_fields.append(
            {
                "id": "built-in",
                "name": BuiltInField.document_name,
                "type": "string",
                "value": self.name,
            }
        )
        built_in_fields.append(
            {
                "id": "built-in",
                "name": BuiltInField.uploader,
                "type": "string",
                "value": self.uploader,
            }
        )
        built_in_fields.append(
            {
                "id": "built-in",
                "name": BuiltInField.upload_date,
                "type": "time",
                "value": str(self.created_at.timestamp()),
            }
        )
        built_in_fields.append(
            {
                "id": "built-in",
                "name": BuiltInField.last_update_date,
                "type": "time",
                "value": str(self.updated_at.timestamp()),
            }
        )
        built_in_fields.append(
            {
                "id": "built-in",
                "name": BuiltInField.source,
                "type": "string",
                "value": MetadataDataSource[self.data_source_type],
            }
        )
        return built_in_fields

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "dataset_id": self.dataset_id,
            "position": self.position,
            "data_source_type": self.data_source_type,
            "data_source_info": self.data_source_info,
            "dataset_process_rule_id": self.dataset_process_rule_id,
            "batch": self.batch,
            "name": self.name,
            "created_from": self.created_from,
            "created_by": self.created_by,
            "created_api_request_id": self.created_api_request_id,
            "created_at": self.created_at,
            "processing_started_at": self.processing_started_at,
            "file_id": self.file_id,
            "word_count": self.word_count,
            "parsing_completed_at": self.parsing_completed_at,
            "cleaning_completed_at": self.cleaning_completed_at,
            "splitting_completed_at": self.splitting_completed_at,
            "tokens": self.tokens,
            "indexing_latency": self.indexing_latency,
            "completed_at": self.completed_at,
            "is_paused": self.is_paused,
            "paused_by": self.paused_by,
            "paused_at": self.paused_at,
            "error": self.error,
            "stopped_at": self.stopped_at,
            "indexing_status": self.indexing_status,
            "enabled": self.enabled,
            "disabled_at": self.disabled_at,
            "disabled_by": self.disabled_by,
            "archived": self.archived,
            "archived_reason": self.archived_reason,
            "archived_by": self.archived_by,
            "archived_at": self.archived_at,
            "updated_at": self.updated_at,
            "doc_type": self.doc_type,
            "doc_metadata": self.doc_metadata,
            "doc_form": self.doc_form,
            "doc_language": self.doc_language,
            "display_status": self.display_status,
            "data_source_info_dict": self.data_source_info_dict,
            "average_segment_length": self.average_segment_length,
            "dataset_process_rule": self.dataset_process_rule.to_dict() if self.dataset_process_rule else None,
            "dataset": None,  # Dataset class doesn't have a to_dict method
            "segment_count": self.segment_count,
            "hit_count": self.hit_count,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]):
        return cls(
            id=data.get("id"),
            tenant_id=data.get("tenant_id"),
            dataset_id=data.get("dataset_id"),
            position=data.get("position"),
            data_source_type=data.get("data_source_type"),
            data_source_info=data.get("data_source_info"),
            dataset_process_rule_id=data.get("dataset_process_rule_id"),
            batch=data.get("batch"),
            name=data.get("name"),
            created_from=data.get("created_from"),
            created_by=data.get("created_by"),
            created_api_request_id=data.get("created_api_request_id"),
            created_at=data.get("created_at"),
            processing_started_at=data.get("processing_started_at"),
            file_id=data.get("file_id"),
            word_count=data.get("word_count"),
            parsing_completed_at=data.get("parsing_completed_at"),
            cleaning_completed_at=data.get("cleaning_completed_at"),
            splitting_completed_at=data.get("splitting_completed_at"),
            tokens=data.get("tokens"),
            indexing_latency=data.get("indexing_latency"),
            completed_at=data.get("completed_at"),
            is_paused=data.get("is_paused"),
            paused_by=data.get("paused_by"),
            paused_at=data.get("paused_at"),
            error=data.get("error"),
            stopped_at=data.get("stopped_at"),
            indexing_status=data.get("indexing_status"),
            enabled=data.get("enabled"),
            disabled_at=data.get("disabled_at"),
            disabled_by=data.get("disabled_by"),
            archived=data.get("archived"),
            archived_reason=data.get("archived_reason"),
            archived_by=data.get("archived_by"),
            archived_at=data.get("archived_at"),
            updated_at=data.get("updated_at"),
            doc_type=data.get("doc_type"),
            doc_metadata=data.get("doc_metadata"),
            doc_form=data.get("doc_form"),
            doc_language=data.get("doc_language"),
        )


class DocumentSegment(Base):
    __tablename__ = "document_segments"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="document_segment_pkey"),
        sa.Index("document_segment_dataset_id_idx", "dataset_id"),
        sa.Index("document_segment_document_id_idx", "document_id"),
        sa.Index("document_segment_tenant_dataset_idx", "dataset_id", "tenant_id"),
        sa.Index("document_segment_tenant_document_idx", "document_id", "tenant_id"),
        sa.Index("document_segment_node_dataset_idx", "index_node_id", "dataset_id"),
        sa.Index("document_segment_tenant_idx", "tenant_id"),
    )

    # initial fields
    id = mapped_column(StringUUID, nullable=False, default=lambda: str(uuid4()))
    tenant_id = mapped_column(StringUUID, nullable=False)
    dataset_id = mapped_column(StringUUID, nullable=False)
    document_id = mapped_column(StringUUID, nullable=False)
    position: Mapped[int]
    content = mapped_column(LongText, nullable=False)
    answer = mapped_column(LongText, nullable=True)
    word_count: Mapped[int]
    tokens: Mapped[int]

    # indexing fields
    keywords = mapped_column(sa.JSON, nullable=True)
    index_node_id = mapped_column(String(255), nullable=True)
    index_node_hash = mapped_column(String(255), nullable=True)

    # basic fields
    hit_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    enabled: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("true"))
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    disabled_by = mapped_column(StringUUID, nullable=True)
    status: Mapped[str] = mapped_column(String(255), server_default=sa.text("'waiting'"))
    created_by = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_by = mapped_column(StringUUID, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    indexing_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    error = mapped_column(LongText, nullable=True)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    @property
    def dataset(self):
        return db.session.scalar(select(Dataset).where(Dataset.id == self.dataset_id))

    @property
    def document(self):
        return db.session.scalar(select(Document).where(Document.id == self.document_id))

    @property
    def previous_segment(self):
        return db.session.scalar(
            select(DocumentSegment).where(
                DocumentSegment.document_id == self.document_id, DocumentSegment.position == self.position - 1
            )
        )

    @property
    def next_segment(self):
        return db.session.scalar(
            select(DocumentSegment).where(
                DocumentSegment.document_id == self.document_id, DocumentSegment.position == self.position + 1
            )
        )

    @property
    def child_chunks(self) -> list[Any]:
        if not self.document:
            return []
        process_rule = self.document.dataset_process_rule
        if process_rule and process_rule.mode == "hierarchical":
            rules_dict = process_rule.rules_dict
            if rules_dict:
                rules = Rule.model_validate(rules_dict)
                if rules.parent_mode and rules.parent_mode != ParentMode.FULL_DOC:
                    child_chunks = (
                        db.session.query(ChildChunk)
                        .where(ChildChunk.segment_id == self.id)
                        .order_by(ChildChunk.position.asc())
                        .all()
                    )
                    return child_chunks or []
        return []

    def get_child_chunks(self) -> list[Any]:
        if not self.document:
            return []
        process_rule = self.document.dataset_process_rule
        if process_rule and process_rule.mode == "hierarchical":
            rules_dict = process_rule.rules_dict
            if rules_dict:
                rules = Rule.model_validate(rules_dict)
                if rules.parent_mode:
                    child_chunks = (
                        db.session.query(ChildChunk)
                        .where(ChildChunk.segment_id == self.id)
                        .order_by(ChildChunk.position.asc())
                        .all()
                    )
                    return child_chunks or []
        return []

    @property
    def sign_content(self) -> str:
        return self.get_sign_content()

    def get_sign_content(self) -> str:
        signed_urls: list[tuple[int, int, str]] = []
        text = self.content

        # For data before v0.10.0
        pattern = r"/files/([a-f0-9\-]+)/image-preview(?:\?.*?)?"
        matches = re.finditer(pattern, text)
        for match in matches:
            upload_file_id = match.group(1)
            nonce = os.urandom(16).hex()
            timestamp = str(int(time.time()))
            data_to_sign = f"image-preview|{upload_file_id}|{timestamp}|{nonce}"
            secret_key = dify_config.SECRET_KEY.encode() if dify_config.SECRET_KEY else b""
            sign = hmac.new(secret_key, data_to_sign.encode(), hashlib.sha256).digest()
            encoded_sign = base64.urlsafe_b64encode(sign).decode()

            params = f"timestamp={timestamp}&nonce={nonce}&sign={encoded_sign}"
            base_url = f"/files/{upload_file_id}/image-preview"
            signed_url = f"{base_url}?{params}"
            signed_urls.append((match.start(), match.end(), signed_url))

        # For data after v0.10.0
        pattern = r"/files/([a-f0-9\-]+)/file-preview(?:\?.*?)?"
        matches = re.finditer(pattern, text)
        for match in matches:
            upload_file_id = match.group(1)
            nonce = os.urandom(16).hex()
            timestamp = str(int(time.time()))
            data_to_sign = f"file-preview|{upload_file_id}|{timestamp}|{nonce}"
            secret_key = dify_config.SECRET_KEY.encode() if dify_config.SECRET_KEY else b""
            sign = hmac.new(secret_key, data_to_sign.encode(), hashlib.sha256).digest()
            encoded_sign = base64.urlsafe_b64encode(sign).decode()

            params = f"timestamp={timestamp}&nonce={nonce}&sign={encoded_sign}"
            base_url = f"/files/{upload_file_id}/file-preview"
            signed_url = f"{base_url}?{params}"
            signed_urls.append((match.start(), match.end(), signed_url))

        # For tools directory - direct file formats (e.g., .png, .jpg, etc.)
        # Match URL including any query parameters up to common URL boundaries (space, parenthesis, quotes)
        pattern = r"/files/tools/([a-f0-9\-]+)\.([a-zA-Z0-9]+)(?:\?[^\s\)\"\']*)?"
        matches = re.finditer(pattern, text)
        for match in matches:
            upload_file_id = match.group(1)
            file_extension = match.group(2)
            nonce = os.urandom(16).hex()
            timestamp = str(int(time.time()))
            data_to_sign = f"file-preview|{upload_file_id}|{timestamp}|{nonce}"
            secret_key = dify_config.SECRET_KEY.encode() if dify_config.SECRET_KEY else b""
            sign = hmac.new(secret_key, data_to_sign.encode(), hashlib.sha256).digest()
            encoded_sign = base64.urlsafe_b64encode(sign).decode()

            params = f"timestamp={timestamp}&nonce={nonce}&sign={encoded_sign}"
            base_url = f"/files/tools/{upload_file_id}.{file_extension}"
            signed_url = f"{base_url}?{params}"
            signed_urls.append((match.start(), match.end(), signed_url))

        # Reconstruct the text with signed URLs
        offset = 0
        for start, end, signed_url in signed_urls:
            text = text[: start + offset] + signed_url + text[end + offset :]
            offset += len(signed_url) - (end - start)

        return text

    @property
    def attachments(self) -> list[dict[str, Any]]:
        # Use JOIN to fetch attachments in a single query instead of two separate queries
        attachments_with_bindings = db.session.execute(
            select(SegmentAttachmentBinding, UploadFile)
            .join(UploadFile, UploadFile.id == SegmentAttachmentBinding.attachment_id)
            .where(
                SegmentAttachmentBinding.tenant_id == self.tenant_id,
                SegmentAttachmentBinding.dataset_id == self.dataset_id,
                SegmentAttachmentBinding.document_id == self.document_id,
                SegmentAttachmentBinding.segment_id == self.id,
            )
        ).all()
        if not attachments_with_bindings:
            return []
        attachment_list = []
        for _, attachment in attachments_with_bindings:
            upload_file_id = attachment.id
            nonce = os.urandom(16).hex()
            timestamp = str(int(time.time()))
            data_to_sign = f"image-preview|{upload_file_id}|{timestamp}|{nonce}"
            secret_key = dify_config.SECRET_KEY.encode() if dify_config.SECRET_KEY else b""
            sign = hmac.new(secret_key, data_to_sign.encode(), hashlib.sha256).digest()
            encoded_sign = base64.urlsafe_b64encode(sign).decode()

            params = f"timestamp={timestamp}&nonce={nonce}&sign={encoded_sign}"
            reference_url = dify_config.CONSOLE_API_URL or ""
            base_url = f"{reference_url}/files/{upload_file_id}/image-preview"
            source_url = f"{base_url}?{params}"
            attachment_list.append(
                {
                    "id": attachment.id,
                    "name": attachment.name,
                    "size": attachment.size,
                    "extension": attachment.extension,
                    "mime_type": attachment.mime_type,
                    "source_url": source_url,
                }
            )
        return attachment_list


class ChildChunk(Base):
    __tablename__ = "child_chunks"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="child_chunk_pkey"),
        sa.Index("child_chunk_dataset_id_idx", "tenant_id", "dataset_id", "document_id", "segment_id", "index_node_id"),
        sa.Index("child_chunks_node_idx", "index_node_id", "dataset_id"),
        sa.Index("child_chunks_segment_idx", "segment_id"),
    )

    # initial fields
    id = mapped_column(StringUUID, nullable=False, default=lambda: str(uuid4()))
    tenant_id = mapped_column(StringUUID, nullable=False)
    dataset_id = mapped_column(StringUUID, nullable=False)
    document_id = mapped_column(StringUUID, nullable=False)
    segment_id = mapped_column(StringUUID, nullable=False)
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    content = mapped_column(LongText, nullable=False)
    word_count: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    # indexing fields
    index_node_id = mapped_column(String(255), nullable=True)
    index_node_hash = mapped_column(String(255), nullable=True)
    type = mapped_column(String(255), nullable=False, server_default=sa.text("'automatic'"))
    created_by = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=sa.func.current_timestamp())
    updated_by = mapped_column(StringUUID, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=sa.func.current_timestamp(), onupdate=func.current_timestamp()
    )
    indexing_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    error = mapped_column(LongText, nullable=True)

    @property
    def dataset(self):
        return db.session.query(Dataset).where(Dataset.id == self.dataset_id).first()

    @property
    def document(self):
        return db.session.query(Document).where(Document.id == self.document_id).first()

    @property
    def segment(self):
        return db.session.query(DocumentSegment).where(DocumentSegment.id == self.segment_id).first()


class AppDatasetJoin(TypeBase):
    __tablename__ = "app_dataset_joins"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="app_dataset_join_pkey"),
        sa.Index("app_dataset_join_app_dataset_idx", "dataset_id", "app_id"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID,
        primary_key=True,
        nullable=False,
        insert_default=lambda: str(uuid4()),
        default_factory=lambda: str(uuid4()),
        init=False,
    )
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    dataset_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=sa.func.current_timestamp(), init=False
    )

    @property
    def app(self):
        return db.session.get(App, self.app_id)


class DatasetQuery(TypeBase):
    __tablename__ = "dataset_queries"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="dataset_query_pkey"),
        sa.Index("dataset_query_dataset_id_idx", "dataset_id"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID,
        primary_key=True,
        nullable=False,
        insert_default=lambda: str(uuid4()),
        default_factory=lambda: str(uuid4()),
        init=False,
    )
    dataset_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    content: Mapped[str] = mapped_column(LongText, nullable=False)
    source: Mapped[str] = mapped_column(String(255), nullable=False)
    source_app_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    created_by_role: Mapped[str] = mapped_column(String(255), nullable=False)
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=sa.func.current_timestamp(), init=False
    )

    @property
    def queries(self) -> list[dict[str, Any]]:
        try:
            queries = json.loads(self.content)
            if isinstance(queries, list):
                for query in queries:
                    if query["content_type"] == QueryType.IMAGE_QUERY:
                        file_info = db.session.query(UploadFile).filter_by(id=query["content"]).first()
                        if file_info:
                            query["file_info"] = {
                                "id": file_info.id,
                                "name": file_info.name,
                                "size": file_info.size,
                                "extension": file_info.extension,
                                "mime_type": file_info.mime_type,
                                "source_url": sign_upload_file(file_info.id, file_info.extension),
                            }
                    else:
                        query["file_info"] = None

                return queries
            else:
                return [queries]
        except JSONDecodeError:
            return [
                {
                    "content_type": QueryType.TEXT_QUERY,
                    "content": self.content,
                    "file_info": None,
                }
            ]


class DatasetKeywordTable(TypeBase):
    __tablename__ = "dataset_keyword_tables"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="dataset_keyword_table_pkey"),
        sa.Index("dataset_keyword_table_dataset_id_idx", "dataset_id"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID,
        primary_key=True,
        insert_default=lambda: str(uuid4()),
        default_factory=lambda: str(uuid4()),
        init=False,
    )
    dataset_id: Mapped[str] = mapped_column(StringUUID, nullable=False, unique=True)
    keyword_table: Mapped[str] = mapped_column(LongText, nullable=False)
    data_source_type: Mapped[str] = mapped_column(
        String(255), nullable=False, server_default=sa.text("'database'"), default="database"
    )

    @property
    def keyword_table_dict(self) -> dict[str, set[Any]] | None:
        class SetDecoder(json.JSONDecoder):
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                def object_hook(dct: Any) -> Any:
                    if isinstance(dct, dict):
                        result: dict[str, Any] = {}
                        items = cast(dict[str, Any], dct).items()
                        for keyword, node_idxs in items:
                            if isinstance(node_idxs, list):
                                result[keyword] = set(cast(list[Any], node_idxs))
                            else:
                                result[keyword] = node_idxs
                        return result
                    return dct

                super().__init__(object_hook=object_hook, *args, **kwargs)

        # get dataset
        dataset = db.session.query(Dataset).filter_by(id=self.dataset_id).first()
        if not dataset:
            return None
        if self.data_source_type == "database":
            return json.loads(self.keyword_table, cls=SetDecoder) if self.keyword_table else None
        else:
            file_key = "keyword_files/" + dataset.tenant_id + "/" + self.dataset_id + ".txt"
            try:
                keyword_table_text = storage.load_once(file_key)
                if keyword_table_text:
                    return json.loads(keyword_table_text.decode("utf-8"), cls=SetDecoder)
                return None
            except Exception:
                logger.exception("Failed to load keyword table from file: %s", file_key)
                return None


class Embedding(TypeBase):
    __tablename__ = "embeddings"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="embedding_pkey"),
        sa.UniqueConstraint("model_name", "hash", "provider_name", name="embedding_hash_idx"),
        sa.Index("created_at_idx", "created_at"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID,
        primary_key=True,
        insert_default=lambda: str(uuid4()),
        default_factory=lambda: str(uuid4()),
        init=False,
    )
    model_name: Mapped[str] = mapped_column(
        String(255), nullable=False, server_default=sa.text("'text-embedding-ada-002'")
    )
    hash: Mapped[str] = mapped_column(String(64), nullable=False)
    embedding: Mapped[bytes] = mapped_column(BinaryData, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    provider_name: Mapped[str] = mapped_column(String(255), nullable=False, server_default=sa.text("''"))

    def set_embedding(self, embedding_data: list[float]):
        self.embedding = pickle.dumps(embedding_data, protocol=pickle.HIGHEST_PROTOCOL)

    def get_embedding(self) -> list[float]:
        return cast(list[float], pickle.loads(self.embedding))  # noqa: S301


class DatasetCollectionBinding(TypeBase):
    __tablename__ = "dataset_collection_bindings"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="dataset_collection_bindings_pkey"),
        sa.Index("provider_model_name_idx", "provider_name", "model_name"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID,
        primary_key=True,
        insert_default=lambda: str(uuid4()),
        default_factory=lambda: str(uuid4()),
        init=False,
    )
    provider_name: Mapped[str] = mapped_column(String(255), nullable=False)
    model_name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(40), server_default=sa.text("'dataset'"), nullable=False)
    collection_name: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )


class TidbAuthBinding(TypeBase):
    __tablename__ = "tidb_auth_bindings"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="tidb_auth_bindings_pkey"),
        sa.Index("tidb_auth_bindings_tenant_idx", "tenant_id"),
        sa.Index("tidb_auth_bindings_active_idx", "active"),
        sa.Index("tidb_auth_bindings_created_at_idx", "created_at"),
        sa.Index("tidb_auth_bindings_status_idx", "status"),
    )
    id: Mapped[str] = mapped_column(
        StringUUID,
        primary_key=True,
        insert_default=lambda: str(uuid4()),
        default_factory=lambda: str(uuid4()),
        init=False,
    )
    tenant_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    cluster_id: Mapped[str] = mapped_column(String(255), nullable=False)
    cluster_name: Mapped[str] = mapped_column(String(255), nullable=False)
    active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("false"))
    status: Mapped[str] = mapped_column(sa.String(255), nullable=False, server_default=sa.text("'CREATING'"))
    account: Mapped[str] = mapped_column(String(255), nullable=False)
    password: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )


class Whitelist(TypeBase):
    __tablename__ = "whitelists"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="whitelists_pkey"),
        sa.Index("whitelists_tenant_idx", "tenant_id"),
    )
    id: Mapped[str] = mapped_column(
        StringUUID,
        primary_key=True,
        insert_default=lambda: str(uuid4()),
        default_factory=lambda: str(uuid4()),
        init=False,
    )
    tenant_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    category: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )


class DatasetPermission(TypeBase):
    __tablename__ = "dataset_permissions"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="dataset_permission_pkey"),
        sa.Index("idx_dataset_permissions_dataset_id", "dataset_id"),
        sa.Index("idx_dataset_permissions_account_id", "account_id"),
        sa.Index("idx_dataset_permissions_tenant_id", "tenant_id"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID,
        insert_default=lambda: str(uuid4()),
        default_factory=lambda: str(uuid4()),
        primary_key=True,
        init=False,
    )
    dataset_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    account_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    has_permission: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("true"), default=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )


class ExternalKnowledgeApis(TypeBase):
    __tablename__ = "external_knowledge_apis"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="external_knowledge_apis_pkey"),
        sa.Index("external_knowledge_apis_tenant_idx", "tenant_id"),
        sa.Index("external_knowledge_apis_name_idx", "name"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        insert_default=lambda: str(uuid4()),
        default_factory=lambda: str(uuid4()),
        init=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    settings: Mapped[str | None] = mapped_column(LongText, nullable=True)
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), onupdate=func.current_timestamp(), init=False
    )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "name": self.name,
            "description": self.description,
            "settings": self.settings_dict,
            "dataset_bindings": self.dataset_bindings,
            "created_by": self.created_by,
            "created_at": self.created_at.isoformat(),
        }

    @property
    def settings_dict(self) -> dict[str, Any] | None:
        try:
            return json.loads(self.settings) if self.settings else None
        except JSONDecodeError:
            return None

    @property
    def dataset_bindings(self) -> list[dict[str, Any]]:
        external_knowledge_bindings = db.session.scalars(
            select(ExternalKnowledgeBindings).where(ExternalKnowledgeBindings.external_knowledge_api_id == self.id)
        ).all()
        dataset_ids = [binding.dataset_id for binding in external_knowledge_bindings]
        datasets = db.session.scalars(select(Dataset).where(Dataset.id.in_(dataset_ids))).all()
        dataset_bindings: list[dict[str, Any]] = []
        for dataset in datasets:
            dataset_bindings.append({"id": dataset.id, "name": dataset.name})

        return dataset_bindings


class ExternalKnowledgeBindings(TypeBase):
    __tablename__ = "external_knowledge_bindings"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="external_knowledge_bindings_pkey"),
        sa.Index("external_knowledge_bindings_tenant_idx", "tenant_id"),
        sa.Index("external_knowledge_bindings_dataset_idx", "dataset_id"),
        sa.Index("external_knowledge_bindings_external_knowledge_idx", "external_knowledge_id"),
        sa.Index("external_knowledge_bindings_external_knowledge_api_idx", "external_knowledge_api_id"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        insert_default=lambda: str(uuid4()),
        default_factory=lambda: str(uuid4()),
        init=False,
    )
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    external_knowledge_api_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    dataset_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    external_knowledge_id: Mapped[str] = mapped_column(String(512), nullable=False)
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None, init=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), onupdate=func.current_timestamp(), init=False
    )


class DatasetAutoDisableLog(TypeBase):
    __tablename__ = "dataset_auto_disable_logs"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="dataset_auto_disable_log_pkey"),
        sa.Index("dataset_auto_disable_log_tenant_idx", "tenant_id"),
        sa.Index("dataset_auto_disable_log_dataset_idx", "dataset_id"),
        sa.Index("dataset_auto_disable_log_created_atx", "created_at"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuid4()), default_factory=lambda: str(uuid4()), init=False
    )
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    dataset_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    document_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    notified: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("false"), default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=sa.func.current_timestamp(), init=False
    )


class RateLimitLog(TypeBase):
    __tablename__ = "rate_limit_logs"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="rate_limit_log_pkey"),
        sa.Index("rate_limit_log_tenant_idx", "tenant_id"),
        sa.Index("rate_limit_log_operation_idx", "operation"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuid4()), default_factory=lambda: str(uuid4()), init=False
    )
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    subscription_plan: Mapped[str] = mapped_column(String(255), nullable=False)
    operation: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )


class DatasetMetadata(TypeBase):
    __tablename__ = "dataset_metadatas"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="dataset_metadata_pkey"),
        sa.Index("dataset_metadata_tenant_idx", "tenant_id"),
        sa.Index("dataset_metadata_dataset_idx", "dataset_id"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuid4()), default_factory=lambda: str(uuid4()), init=False
    )
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    dataset_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    type: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=sa.func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=sa.func.current_timestamp(),
        onupdate=func.current_timestamp(),
        init=False,
    )
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    updated_by: Mapped[str] = mapped_column(StringUUID, nullable=True, default=None)


class DatasetMetadataBinding(TypeBase):
    __tablename__ = "dataset_metadata_bindings"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="dataset_metadata_binding_pkey"),
        sa.Index("dataset_metadata_binding_tenant_idx", "tenant_id"),
        sa.Index("dataset_metadata_binding_dataset_idx", "dataset_id"),
        sa.Index("dataset_metadata_binding_metadata_idx", "metadata_id"),
        sa.Index("dataset_metadata_binding_document_idx", "document_id"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuid4()), default_factory=lambda: str(uuid4()), init=False
    )
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    dataset_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    metadata_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    document_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)


class PipelineBuiltInTemplate(TypeBase):
    __tablename__ = "pipeline_built_in_templates"
    __table_args__ = (sa.PrimaryKeyConstraint("id", name="pipeline_built_in_template_pkey"),)

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuidv7()), default_factory=lambda: str(uuidv7()), init=False
    )
    name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    description: Mapped[str] = mapped_column(LongText, nullable=False)
    chunk_structure: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    icon: Mapped[dict] = mapped_column(sa.JSON, nullable=False)
    yaml_content: Mapped[str] = mapped_column(LongText, nullable=False)
    copyright: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    privacy_policy: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    install_count: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    language: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        init=False,
    )


class PipelineCustomizedTemplate(TypeBase):
    __tablename__ = "pipeline_customized_templates"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="pipeline_customized_template_pkey"),
        sa.Index("pipeline_customized_template_tenant_idx", "tenant_id"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuidv7()), default_factory=lambda: str(uuidv7()), init=False
    )
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    description: Mapped[str] = mapped_column(LongText, nullable=False)
    chunk_structure: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    icon: Mapped[dict] = mapped_column(sa.JSON, nullable=False)
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    yaml_content: Mapped[str] = mapped_column(LongText, nullable=False)
    install_count: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    language: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None, init=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        init=False,
    )

    @property
    def created_user_name(self):
        account = db.session.query(Account).where(Account.id == self.created_by).first()
        if account:
            return account.name
        return ""


class Pipeline(TypeBase):
    __tablename__ = "pipelines"
    __table_args__ = (sa.PrimaryKeyConstraint("id", name="pipeline_pkey"),)

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuidv7()), default_factory=lambda: str(uuidv7()), init=False
    )
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    description: Mapped[str] = mapped_column(LongText, nullable=False, default=sa.text("''"))
    workflow_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    is_public: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("false"), default=False)
    is_published: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("false"), default=False
    )
    created_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        init=False,
    )

    def retrieve_dataset(self, session: Session):
        return session.query(Dataset).where(Dataset.pipeline_id == self.id).first()


class DocumentPipelineExecutionLog(TypeBase):
    __tablename__ = "document_pipeline_execution_logs"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="document_pipeline_execution_log_pkey"),
        sa.Index("document_pipeline_execution_logs_document_id_idx", "document_id"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuidv7()), default_factory=lambda: str(uuidv7()), init=False
    )
    pipeline_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    document_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    datasource_type: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    datasource_info: Mapped[str] = mapped_column(LongText, nullable=False)
    datasource_node_id: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    input_data: Mapped[dict] = mapped_column(sa.JSON, nullable=False)
    created_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )


class PipelineRecommendedPlugin(TypeBase):
    __tablename__ = "pipeline_recommended_plugins"
    __table_args__ = (sa.PrimaryKeyConstraint("id", name="pipeline_recommended_plugin_pkey"),)

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuidv7()), default_factory=lambda: str(uuidv7()), init=False
    )
    plugin_id: Mapped[str] = mapped_column(LongText, nullable=False)
    provider_name: Mapped[str] = mapped_column(LongText, nullable=False)
    type: Mapped[str] = mapped_column(sa.String(50), nullable=False, server_default=sa.text("'tool'"))
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        init=False,
    )


class SegmentAttachmentBinding(Base):
    __tablename__ = "segment_attachment_bindings"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="segment_attachment_binding_pkey"),
        sa.Index(
            "segment_attachment_binding_tenant_dataset_document_segment_idx",
            "tenant_id",
            "dataset_id",
            "document_id",
            "segment_id",
        ),
        sa.Index("segment_attachment_binding_attachment_idx", "attachment_id"),
    )
    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuidv7()))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    dataset_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    document_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    segment_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    attachment_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())
