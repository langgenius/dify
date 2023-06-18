from typing import Any, Dict, Optional, Sequence

from langchain.schema import Document
from sqlalchemy import func

from core.llm.token_calculator import TokenCalculator
from extensions.ext_database import db
from models.dataset import Dataset, DocumentSegment


class DatesetDocumentStore:
    def __init__(
        self,
        dataset: Dataset,
        user_id: str,
        embedding_model_name: str,
        document_id: Optional[str] = None,
    ):
        self._dataset = dataset
        self._user_id = user_id
        self._embedding_model_name = embedding_model_name
        self._document_id = document_id

    @classmethod
    def from_dict(cls, config_dict: Dict[str, Any]) -> "DatesetDocumentStore":
        return cls(**config_dict)

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dict."""
        return {
            "dataset_id": self._dataset.id,
        }

    @property
    def dateset_id(self) -> Any:
        return self._dataset.id

    @property
    def user_id(self) -> Any:
        return self._user_id

    @property
    def embedding_model_name(self) -> Any:
        return self._embedding_model_name

    @property
    def docs(self) -> Dict[str, Document]:
        document_segments = db.session.query(DocumentSegment).filter(
            DocumentSegment.dataset_id == self._dataset.id
        ).all()

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
                }
            )

        return output

    def add_documents(
        self, docs: Sequence[Document], allow_update: bool = True
    ) -> None:
        max_position = db.session.query(func.max(DocumentSegment.position)).filter(
            DocumentSegment.document == self._document_id
        ).scalar()

        if max_position is None:
            max_position = 0

        for doc in docs:
            if not isinstance(doc, Document):
                raise ValueError("doc must be a Document")

            segment_document = self.get_document(doc_id=doc.metadata['doc_id'], raise_error=False)

            # NOTE: doc could already exist in the store, but we overwrite it
            if not allow_update and segment_document:
                raise ValueError(
                    f"doc_id {doc.metadata['doc_id']} already exists. "
                    "Set allow_update to True to overwrite."
                )

            # calc embedding use tokens
            tokens = TokenCalculator.get_num_tokens(self._embedding_model_name, doc.page_content)

            if not segment_document:
                max_position += 1

                segment_document = DocumentSegment(
                    tenant_id=self._dataset.tenant_id,
                    dataset_id=self._dataset.id,
                    document_id=self._document_id,
                    index_node_id=doc.metadata['doc_id'],
                    index_node_hash=doc.metadata['doc_hash'],
                    position=max_position,
                    content=doc.page_content,
                    word_count=len(doc.page_content),
                    tokens=tokens,
                    created_by=self._user_id,
                )
                db.session.add(segment_document)
            else:
                segment_document.content = doc.page_content
                segment_document.index_node_hash = doc.metadata['doc_hash']
                segment_document.word_count = len(doc.page_content)
                segment_document.tokens = tokens

            db.session.commit()

    def document_exists(self, doc_id: str) -> bool:
        """Check if document exists."""
        result = self.get_document_segment(doc_id)
        return result is not None

    def get_document(
        self, doc_id: str, raise_error: bool = True
    ) -> Optional[Document]:
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
            }
        )

    def delete_document(self, doc_id: str, raise_error: bool = True) -> None:
        document_segment = self.get_document_segment(doc_id)

        if document_segment is None:
            if raise_error:
                raise ValueError(f"doc_id {doc_id} not found.")
            else:
                return None

        db.session.delete(document_segment)
        db.session.commit()

    def set_document_hash(self, doc_id: str, doc_hash: str) -> None:
        """Set the hash for a given doc_id."""
        document_segment = self.get_document_segment(doc_id)

        if document_segment is None:
            return None

        document_segment.index_node_hash = doc_hash
        db.session.commit()

    def get_document_hash(self, doc_id: str) -> Optional[str]:
        """Get the stored hash for a document, if it exists."""
        document_segment = self.get_document_segment(doc_id)

        if document_segment is None:
            return None

        return document_segment.index_node_hash

    def get_document_segment(self, doc_id: str) -> DocumentSegment:
        document_segment = db.session.query(DocumentSegment).filter(
            DocumentSegment.dataset_id == self._dataset.id,
            DocumentSegment.index_node_id == doc_id
        ).first()

        return document_segment
