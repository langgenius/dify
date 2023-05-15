from typing import Any, Dict, Optional, Sequence
from llama_index.docstore.types import BaseDocumentStore
from llama_index.schema import BaseDocument


class EmptyDocumentStore(BaseDocumentStore):
    @classmethod
    def from_dict(cls, config_dict: Dict[str, Any]) -> "EmptyDocumentStore":
        return cls()

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dict."""
        return {}

    @property
    def docs(self) -> Dict[str, BaseDocument]:
        return {}

    def add_documents(
        self, docs: Sequence[BaseDocument], allow_update: bool = True
    ) -> None:
        pass

    def document_exists(self, doc_id: str) -> bool:
        """Check if document exists."""
        return False

    def get_document(
        self, doc_id: str, raise_error: bool = True
    ) -> Optional[BaseDocument]:
        return None

    def delete_document(self, doc_id: str, raise_error: bool = True) -> None:
        pass

    def set_document_hash(self, doc_id: str, doc_hash: str) -> None:
        """Set the hash for a given doc_id."""
        pass

    def get_document_hash(self, doc_id: str) -> Optional[str]:
        """Get the stored hash for a document, if it exists."""
        return None

    def update_docstore(self, other: "BaseDocumentStore") -> None:
        """Update docstore.

        Args:
            other (BaseDocumentStore): docstore to update from

        """
        self.add_documents(list(other.docs.values()))
