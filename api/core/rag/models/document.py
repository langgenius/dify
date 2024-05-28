from abc import ABC, abstractmethod
from collections.abc import Sequence
from typing import Any, Optional

from pydantic import BaseModel, Field


class Document(BaseModel):
    """Class for storing a piece of text and associated metadata."""

    page_content: str

    """Arbitrary metadata about the page content (e.g., source, relationships to other
        documents, etc.).
    """
    metadata: Optional[dict] = Field(default_factory=dict)


class BaseDocumentTransformer(ABC):
    """Abstract base class for document transformation systems.

    A document transformation system takes a sequence of Documents and returns a
    sequence of transformed Documents.

    Example:
        .. code-block:: python

            class EmbeddingsRedundantFilter(BaseDocumentTransformer, BaseModel):
                embeddings: Embeddings
                similarity_fn: Callable = cosine_similarity
                similarity_threshold: float = 0.95

                class Config:
                    arbitrary_types_allowed = True

                def transform_documents(
                    self, documents: Sequence[Document], **kwargs: Any
                ) -> Sequence[Document]:
                    stateful_documents = get_stateful_documents(documents)
                    embedded_documents = _get_embeddings_from_stateful_docs(
                        self.embeddings, stateful_documents
                    )
                    included_idxs = _filter_similar_embeddings(
                        embedded_documents, self.similarity_fn, self.similarity_threshold
                    )
                    return [stateful_documents[i] for i in sorted(included_idxs)]

                async def atransform_documents(
                    self, documents: Sequence[Document], **kwargs: Any
                ) -> Sequence[Document]:
                    raise NotImplementedError

    """  # noqa: E501

    @abstractmethod
    def transform_documents(
        self, documents: Sequence[Document], **kwargs: Any
    ) -> Sequence[Document]:
        """Transform a list of documents.

        Args:
            documents: A sequence of Documents to be transformed.

        Returns:
            A list of transformed Documents.
        """

    @abstractmethod
    async def atransform_documents(
        self, documents: Sequence[Document], **kwargs: Any
    ) -> Sequence[Document]:
        """Asynchronously transform a list of documents.

        Args:
            documents: A sequence of Documents to be transformed.

        Returns:
            A list of transformed Documents.
        """
