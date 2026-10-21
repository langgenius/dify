"""Stable data carried by durable knowledge cleanup tasks."""

from collections.abc import Mapping
from dataclasses import dataclass


class UploadFilePendingDeletionError(ValueError):
    """A resource attempted to attach a file already claimed for cleanup."""

    def __init__(self, file_ids: tuple[str, ...]) -> None:
        self.file_ids = file_ids
        super().__init__(f"upload files are pending deletion: {', '.join(file_ids)}")


def _required_string(value: object, *, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"cleanup manifest requires {field}")
    return value


def _optional_string(value: object, *, field: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"cleanup manifest field {field} must be a string or null")
    return value


def _string_tuple(payload: Mapping[str, object], key: str) -> tuple[str, ...]:
    value = payload.get(key, [])
    if not isinstance(value, list) or not all(isinstance(item, str) and item for item in value):
        raise ValueError(f"cleanup manifest field {key} must be a string list")
    return tuple(dict.fromkeys(value))


def _mapping_list(payload: Mapping[str, object], key: str) -> tuple[Mapping[str, object], ...]:
    value = payload.get(key, [])
    if not isinstance(value, list) or not all(isinstance(item, Mapping) for item in value):
        raise ValueError(f"cleanup manifest field {key} must be a list of objects")
    return tuple(value)


@dataclass(frozen=True)
class UploadFileCleanup:
    """File identity retained after its owning document row is deleted."""

    id: str
    key: str | None

    def to_payload(self) -> dict[str, object]:
        return {"id": self.id, "key": self.key}

    @classmethod
    def from_payload(cls, payload: Mapping[str, object]) -> "UploadFileCleanup":
        return cls(
            id=_required_string(payload.get("id"), field="id"),
            key=_optional_string(payload.get("key"), field="key"),
        )


@dataclass(frozen=True)
class SegmentAttachmentCleanup:
    """Attachment binding and file identity needed for reference-safe cleanup."""

    binding_id: str
    attachment_id: str
    key: str | None

    @property
    def file(self) -> UploadFileCleanup:
        return UploadFileCleanup(id=self.attachment_id, key=self.key)

    def to_payload(self) -> dict[str, object]:
        return {
            "binding_id": self.binding_id,
            "attachment_id": self.attachment_id,
            "key": self.key,
        }

    @classmethod
    def from_payload(cls, payload: Mapping[str, object]) -> "SegmentAttachmentCleanup":
        return cls(
            binding_id=_required_string(payload.get("binding_id"), field="binding_id"),
            attachment_id=_required_string(payload.get("attachment_id"), field="attachment_id"),
            key=_optional_string(payload.get("key"), field="key"),
        )


@dataclass(frozen=True)
class DocumentCleanupManifest:
    """Database-independent file snapshot for one document cleanup intent."""

    document_files: tuple[UploadFileCleanup, ...] = ()
    image_files: tuple[UploadFileCleanup, ...] = ()
    segment_attachments: tuple[SegmentAttachmentCleanup, ...] = ()

    def to_payload(self) -> dict[str, object]:
        return {
            "document_files": [file.to_payload() for file in self.document_files],
            "image_files": [file.to_payload() for file in self.image_files],
            "segment_attachments": [attachment.to_payload() for attachment in self.segment_attachments],
        }

    @classmethod
    def from_payload(cls, payload: Mapping[str, object]) -> "DocumentCleanupManifest":
        return cls(
            document_files=tuple(
                UploadFileCleanup.from_payload(item) for item in _mapping_list(payload, "document_files")
            ),
            image_files=tuple(UploadFileCleanup.from_payload(item) for item in _mapping_list(payload, "image_files")),
            segment_attachments=tuple(
                SegmentAttachmentCleanup.from_payload(item) for item in _mapping_list(payload, "segment_attachments")
            ),
        )


@dataclass(frozen=True)
class DeletionIndexCleanup:
    """External index state retained independently from deleted SQL owners."""

    tenant_id: str
    dataset_id: str
    indexing_technique: str | None
    index_struct: str | None
    collection_binding_id: str | None
    embedding_model_provider: str | None
    embedding_model: str | None
    vector_type: str | None
    delete_all: bool
    vector_node_ids: tuple[str, ...] = ()
    inline_image_node_ids: tuple[str, ...] = ()
    attachment_node_ids: tuple[str, ...] = ()
    keyword_node_ids: tuple[str, ...] = ()
    keyword_data_source_type: str | None = None
    refresh_billing: bool = False

    def to_payload(self) -> dict[str, object]:
        return {
            "tenant_id": self.tenant_id,
            "dataset_id": self.dataset_id,
            "indexing_technique": self.indexing_technique,
            "index_struct": self.index_struct,
            "collection_binding_id": self.collection_binding_id,
            "embedding_model_provider": self.embedding_model_provider,
            "embedding_model": self.embedding_model,
            "vector_type": self.vector_type,
            "delete_all": self.delete_all,
            "vector_node_ids": list(self.vector_node_ids),
            "inline_image_node_ids": list(self.inline_image_node_ids),
            "attachment_node_ids": list(self.attachment_node_ids),
            "keyword_node_ids": list(self.keyword_node_ids),
            "keyword_data_source_type": self.keyword_data_source_type,
            "refresh_billing": self.refresh_billing,
        }

    @classmethod
    def from_payload(cls, payload: Mapping[str, object]) -> "DeletionIndexCleanup":
        delete_all = payload.get("delete_all")
        if not isinstance(delete_all, bool):
            raise ValueError("cleanup manifest field delete_all must be a boolean")
        refresh_billing = payload.get("refresh_billing", False)
        if not isinstance(refresh_billing, bool):
            raise ValueError("cleanup manifest field refresh_billing must be a boolean")
        return cls(
            tenant_id=_required_string(payload.get("tenant_id"), field="tenant_id"),
            dataset_id=_required_string(payload.get("dataset_id"), field="dataset_id"),
            indexing_technique=_optional_string(payload.get("indexing_technique"), field="indexing_technique"),
            index_struct=_optional_string(payload.get("index_struct"), field="index_struct"),
            collection_binding_id=_optional_string(payload.get("collection_binding_id"), field="collection_binding_id"),
            embedding_model_provider=_optional_string(
                payload.get("embedding_model_provider"), field="embedding_model_provider"
            ),
            embedding_model=_optional_string(payload.get("embedding_model"), field="embedding_model"),
            vector_type=_optional_string(payload.get("vector_type"), field="vector_type"),
            delete_all=delete_all,
            vector_node_ids=_string_tuple(payload, "vector_node_ids"),
            inline_image_node_ids=_string_tuple(payload, "inline_image_node_ids"),
            attachment_node_ids=_string_tuple(payload, "attachment_node_ids"),
            keyword_node_ids=_string_tuple(payload, "keyword_node_ids"),
            keyword_data_source_type=_optional_string(
                payload.get("keyword_data_source_type"), field="keyword_data_source_type"
            ),
            refresh_billing=refresh_billing,
        )
