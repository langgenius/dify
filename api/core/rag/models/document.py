from abc import ABC, abstractmethod
from collections.abc import Sequence
from typing import Any

from pydantic import BaseModel, Field


class ChildDocument(BaseModel):
    """Class for storing a piece of text and associated metadata."""

    page_content: str

    vector: list[float] | None = None

    """Arbitrary metadata about the page content (e.g., source, relationships to other
        documents, etc.).
    """
    metadata: dict = Field(default_factory=dict)


class Document(BaseModel):
    """Class for storing a piece of text and associated metadata."""

    page_content: str

    vector: list[float] | None = None

    """Arbitrary metadata about the page content (e.g., source, relationships to other
        documents, etc.).
    """
    metadata: dict = Field(default_factory=dict)

    provider: str | None = "dify"

    children: list[ChildDocument] | None = None


class GeneralStructureChunk(BaseModel):
    """
    General Structure Chunk.
    """

    general_chunks: list[str]


class ParentChildChunk(BaseModel):
    """
    Parent Child Chunk.
    """

    parent_content: str
    child_contents: list[str]


class ParentChildStructureChunk(BaseModel):
    """
    Parent Child Structure Chunk.
    """

    parent_child_chunks: list[ParentChildChunk]
    parent_mode: str = "paragraph"


class QAChunk(BaseModel):
    """
    QA Chunk.
    """

    question: str
    answer: str


class QAStructureChunk(BaseModel):
    """
    QAStructureChunk.
    """

    qa_chunks: list[QAChunk]


class BaseDocumentTransformer(ABC):
    """Abstract base class for document transformation systems.

    A document transformation system takes a sequence of Documents and returns a
    sequence of transformed Documents.

    Example:
        .. code-block:: python

            class EmbeddingsRedundantFilter(BaseDocumentTransformer, BaseModel):
                model_config = ConfigDict(arbitrary_types_allowed=True)

                embeddings: Embeddings
                similarity_fn: Callable = cosine_similarity
                similarity_threshold: float = 0.95

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

    """

    @abstractmethod
    def transform_documents(self, documents: Sequence[Document], **kwargs: Any) -> Sequence[Document]:
        """Transform a list of documents.

        Args:
            documents: A sequence of Documents to be transformed.

        Returns:
            A list of transformed Documents.
        """

    @abstractmethod
    async def atransform_documents(self, documents: Sequence[Document], **kwargs: Any) -> Sequence[Document]:
        """Asynchronously transform a list of documents.

        Args:
            documents: A sequence of Documents to be transformed.

        Returns:
            A list of transformed Documents.
        """
