from collections.abc import Sequence
from typing import Any

from sqlalchemy import func, select

from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.rag.models.document import Document
from extensions.ext_database import db
from models.dataset import ChildChunk, Dataset, DocumentSegment


class DatasetDocumentStore:
    def __init__(
        self,
        dataset: Dataset,
        user_id: str,
        document_id: str | None = None,
    ):
        self._dataset = dataset
        self._user_id = user_id
        self._document_id = document_id

    @classmethod
    def from_dict(cls, config_dict: dict[str, Any]) -> "DatasetDocumentStore":
        return cls(**config_dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize to dict."""
        return {
            "dataset_id": self._dataset.id,
        }

    @property
    def dataset_id(self):
        return self._dataset.id

    @property
    def user_id(self):
        return self._user_id

    @property
    def docs(self) -> dict[str, Document]:
        stmt = select(DocumentSegment).where(DocumentSegment.dataset_id == self._dataset.id)
        document_segments = db.session.scalars(stmt).all()

        output = {}
        for document_segment in document_segments:
            doc_id = document_segment.index_node_id
            output[doc_id] = Document(
                page_content=document_segment.content,
                metadata={
                    "doc_id": document_segment.index_node_id,
                    "doc_hash": document_segment.index_node_hash,
                    "document_id": document_segment.document_id,
                    "dataset_id": document_segment.dataset_id,
                },
            )

        return output

    def add_documents(self, docs: Sequence[Document], allow_update: bool = True, save_child: bool = False):
        max_position = (
            db.session.query(func.max(DocumentSegment.position))
            .where(DocumentSegment.document_id == self._document_id)
            .scalar()
        )

        if max_position is None:
            max_position = 0
        embedding_model = None
        if self._dataset.indexing_technique == "high_quality":
            model_manager = ModelManager()
            embedding_model = model_manager.get_model_instance(
                tenant_id=self._dataset.tenant_id,
                provider=self._dataset.embedding_model_provider,
                model_type=ModelType.TEXT_EMBEDDING,
                model=self._dataset.embedding_model,
            )

        if embedding_model:
            page_content_list = [doc.page_content for doc in docs]
            tokens_list = embedding_model.get_text_embedding_num_tokens(page_content_list)
        else:
            tokens_list = [0] * len(docs)

        for doc, tokens in zip(docs, tokens_list):
            if not isinstance(doc, Document):
                raise ValueError("doc must be a Document")

            if doc.metadata is None:
                raise ValueError("doc.metadata must be a dict")

            segment_document = self.get_document_segment(doc_id=doc.metadata["doc_id"])

            # NOTE: doc could already exist in the store, but we overwrite it
            if not allow_update and segment_document:
                raise ValueError(
                    f"doc_id {doc.metadata['doc_id']} already exists. Set allow_update to True to overwrite."
                )

            if not segment_document:
                max_position += 1

                segment_document = DocumentSegment(
                    tenant_id=self._dataset.tenant_id,
                    dataset_id=self._dataset.id,
                    document_id=self._document_id,
                    index_node_id=doc.metadata["doc_id"],
                    index_node_hash=doc.metadata["doc_hash"],
                    position=max_position,
                    content=doc.page_content,
                    word_count=len(doc.page_content),
                    tokens=tokens,
                    enabled=False,
                    created_by=self._user_id,
                )
                if doc.metadata.get("answer"):
                    segment_document.answer = doc.metadata.pop("answer", "")

                db.session.add(segment_document)
                db.session.flush()
                if save_child:
                    if doc.children:
                        for position, child in enumerate(doc.children, start=1):
                            child_segment = ChildChunk(
                                tenant_id=self._dataset.tenant_id,
                                dataset_id=self._dataset.id,
                                document_id=self._document_id,
                                segment_id=segment_document.id,
                                position=position,
                                index_node_id=child.metadata.get("doc_id"),
                                index_node_hash=child.metadata.get("doc_hash"),
                                content=child.page_content,
                                word_count=len(child.page_content),
                                type="automatic",
                                created_by=self._user_id,
                            )
                            db.session.add(child_segment)
            else:
                segment_document.content = doc.page_content
                if doc.metadata.get("answer"):
                    segment_document.answer = doc.metadata.pop("answer", "")
                segment_document.index_node_hash = doc.metadata.get("doc_hash")
                segment_document.word_count = len(doc.page_content)
                segment_document.tokens = tokens
                if save_child and doc.children:
                    # delete the existing child chunks
                    db.session.query(ChildChunk).where(
                        ChildChunk.tenant_id == self._dataset.tenant_id,
                        ChildChunk.dataset_id == self._dataset.id,
                        ChildChunk.document_id == self._document_id,
                        ChildChunk.segment_id == segment_document.id,
                    ).delete()
                    # add new child chunks
                    for position, child in enumerate(doc.children, start=1):
                        child_segment = ChildChunk(
                            tenant_id=self._dataset.tenant_id,
                            dataset_id=self._dataset.id,
                            document_id=self._document_id,
                            segment_id=segment_document.id,
                            position=position,
                            index_node_id=child.metadata.get("doc_id"),
                            index_node_hash=child.metadata.get("doc_hash"),
                            content=child.page_content,
                            word_count=len(child.page_content),
                            type="automatic",
                            created_by=self._user_id,
                        )
                        db.session.add(child_segment)

            db.session.commit()

    def document_exists(self, doc_id: str) -> bool:
        """Check if document exists."""
        result = self.get_document_segment(doc_id)
        return result is not None

    def get_document(self, doc_id: str, raise_error: bool = True) -> Document | None:
        document_segment = self.get_document_segment(doc_id)

        if document_segment is None:
            if raise_error:
                raise ValueError(f"doc_id {doc_id} not found.")
            else:
                return None

        return Document(
            page_content=document_segment.content,
            metadata={
                "doc_id": document_segment.index_node_id,
                "doc_hash": document_segment.index_node_hash,
                "document_id": document_segment.document_id,
                "dataset_id": document_segment.dataset_id,
            },
        )

    def delete_document(self, doc_id: str, raise_error: bool = True):
        document_segment = self.get_document_segment(doc_id)

        if document_segment is None:
            if raise_error:
                raise ValueError(f"doc_id {doc_id} not found.")
            else:
                return None

        db.session.delete(document_segment)
        db.session.commit()

    def set_document_hash(self, doc_id: str, doc_hash: str):
        """Set the hash for a given doc_id."""
        document_segment = self.get_document_segment(doc_id)

        if document_segment is None:
            return None

        document_segment.index_node_hash = doc_hash
        db.session.commit()

    def get_document_hash(self, doc_id: str) -> str | None:
        """Get the stored hash for a document, if it exists."""
        document_segment = self.get_document_segment(doc_id)

        if document_segment is None:
            return None
        data: str | None = document_segment.index_node_hash
        return data

    def get_document_segment(self, doc_id: str) -> DocumentSegment | None:
        stmt = select(DocumentSegment).where(
            DocumentSegment.dataset_id == self._dataset.id, DocumentSegment.index_node_id == doc_id
        )
        document_segment = db.session.scalar(stmt)

        return document_segment
