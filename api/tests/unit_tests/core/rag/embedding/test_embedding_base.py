"""Unit tests for embedding_base.py - the abstract Embeddings base class."""

import asyncio
import inspect
from typing import Any

import pytest

from core.rag.embedding.embedding_base import Embeddings


class ConcreteEmbeddings(Embeddings):
    """Concrete implementation of Embeddings for testing."""

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [[1.0] * 10 for _ in texts]

    def embed_multimodal_documents(self, multimodel_documents: list[dict[str, Any]]) -> list[list[float]]:
        return [[1.0] * 10 for _ in multimodel_documents]

    def embed_query(self, text: str) -> list[float]:
        return [1.0] * 10

    def embed_multimodal_query(self, multimodel_document: dict[str, Any]) -> list[float]:
        return [1.0] * 10


class TestEmbeddingsBase:
    """Test suite for the abstract Embeddings base class."""

    def test_embeddings_is_abc(self):
        """Test that Embeddings is an abstract base class."""
        assert hasattr(Embeddings, "__abstractmethods__")
        assert len(Embeddings.__abstractmethods__) > 0

    def test_embed_documents_is_abstract(self):
        """Test that embed_documents is an abstract method."""
        assert "embed_documents" in Embeddings.__abstractmethods__

    def test_embed_multimodal_documents_is_abstract(self):
        """Test that embed_multimodal_documents is an abstract method."""
        assert "embed_multimodal_documents" in Embeddings.__abstractmethods__

    def test_embed_query_is_abstract(self):
        """Test that embed_query is an abstract method."""
        assert "embed_query" in Embeddings.__abstractmethods__

    def test_embed_multimodal_query_is_abstract(self):
        """Test that embed_multimodal_query is an abstract method."""
        assert "embed_multimodal_query" in Embeddings.__abstractmethods__

    def test_embed_documents_raises_not_implemented(self):
        """Test that embed_documents raises NotImplementedError in its body."""
        source = inspect.getsource(Embeddings.embed_documents)
        assert "raise NotImplementedError" in source

    def test_embed_multimodal_documents_raises_not_implemented(self):
        """Test that embed_multimodal_documents raises NotImplementedError in its body."""
        source = inspect.getsource(Embeddings.embed_multimodal_documents)
        assert "raise NotImplementedError" in source

    def test_embed_query_raises_not_implemented(self):
        """Test that embed_query raises NotImplementedError in its body."""
        source = inspect.getsource(Embeddings.embed_query)
        assert "raise NotImplementedError" in source

    def test_embed_multimodal_query_raises_not_implemented(self):
        """Test that embed_multimodal_query raises NotImplementedError in its body."""
        source = inspect.getsource(Embeddings.embed_multimodal_query)
        assert "raise NotImplementedError" in source

    def test_aembed_documents_raises_not_implemented(self):
        """Test that aembed_documents raises NotImplementedError in its body."""
        source = inspect.getsource(Embeddings.aembed_documents)
        assert "raise NotImplementedError" in source

    def test_aembed_query_raises_not_implemented(self):
        """Test that aembed_query raises NotImplementedError in its body."""
        source = inspect.getsource(Embeddings.aembed_query)
        assert "raise NotImplementedError" in source

    def test_concrete_implementation_works(self):
        """Test that a concrete implementation of Embeddings works correctly."""
        concrete = ConcreteEmbeddings()
        result = concrete.embed_documents(["test1", "test2"])
        assert len(result) == 2
        assert all(len(emb) == 10 for emb in result)

    def test_concrete_implementation_embed_query(self):
        """Test concrete implementation of embed_query."""
        concrete = ConcreteEmbeddings()
        result = concrete.embed_query("test query")
        assert len(result) == 10

    def test_concrete_implementation_embed_multimodal_documents(self):
        """Test concrete implementation of embed_multimodal_documents."""
        concrete = ConcreteEmbeddings()
        docs: list[dict[str, Any]] = [{"file_id": "file1"}, {"file_id": "file2"}]
        result = concrete.embed_multimodal_documents(docs)
        assert len(result) == 2

    def test_concrete_implementation_embed_multimodal_query(self):
        """Test concrete implementation of embed_multimodal_query."""
        concrete = ConcreteEmbeddings()
        result = concrete.embed_multimodal_query({"file_id": "test"})
        assert len(result) == 10


class TestEmbeddingsNotImplemented:
    """Test that abstract methods raise NotImplementedError when called."""

    def test_embed_query_raises_not_implemented(self):
        """Test that embed_query raises NotImplementedError."""

        class PartialImpl:
            pass

        PartialImpl.embed_query = lambda self, text: Embeddings.embed_query(self, text)
        PartialImpl.embed_documents = lambda self, texts: Embeddings.embed_documents(self, texts)
        PartialImpl.embed_multimodal_documents = lambda self, docs: Embeddings.embed_multimodal_documents(self, docs)
        PartialImpl.embed_multimodal_query = lambda self, doc: Embeddings.embed_multimodal_query(self, doc)
        PartialImpl.aembed_documents = lambda self, texts: Embeddings.aembed_documents(self, texts)
        PartialImpl.aembed_query = lambda self, text: Embeddings.aembed_query(self, text)

        partial = PartialImpl()
        with pytest.raises(NotImplementedError):
            partial.embed_query("test")

    def test_embed_documents_raises_not_implemented(self):
        """Test that embed_documents raises NotImplementedError."""

        class PartialImpl:
            pass

        PartialImpl.embed_query = lambda self, text: Embeddings.embed_query(self, text)
        PartialImpl.embed_documents = lambda self, texts: Embeddings.embed_documents(self, texts)
        PartialImpl.embed_multimodal_documents = lambda self, docs: Embeddings.embed_multimodal_documents(self, docs)
        PartialImpl.embed_multimodal_query = lambda self, doc: Embeddings.embed_multimodal_query(self, doc)
        PartialImpl.aembed_documents = lambda self, texts: Embeddings.aembed_documents(self, texts)
        PartialImpl.aembed_query = lambda self, text: Embeddings.aembed_query(self, text)

        partial = PartialImpl()
        with pytest.raises(NotImplementedError):
            partial.embed_documents(["test"])

    def test_embed_multimodal_documents_raises_not_implemented(self):
        """Test that embed_multimodal_documents raises NotImplementedError."""

        class PartialImpl:
            pass

        PartialImpl.embed_query = lambda self, text: Embeddings.embed_query(self, text)
        PartialImpl.embed_documents = lambda self, texts: Embeddings.embed_documents(self, texts)
        PartialImpl.embed_multimodal_documents = lambda self, docs: Embeddings.embed_multimodal_documents(self, docs)
        PartialImpl.embed_multimodal_query = lambda self, doc: Embeddings.embed_multimodal_query(self, doc)
        PartialImpl.aembed_documents = lambda self, texts: Embeddings.aembed_documents(self, texts)
        PartialImpl.aembed_query = lambda self, text: Embeddings.aembed_query(self, text)

        partial = PartialImpl()
        with pytest.raises(NotImplementedError):
            partial.embed_multimodal_documents([{"file_id": "test"}])

    def test_embed_multimodal_query_raises_not_implemented(self):
        """Test that embed_multimodal_query raises NotImplementedError."""

        class PartialImpl:
            pass

        PartialImpl.embed_query = lambda self, text: Embeddings.embed_query(self, text)
        PartialImpl.embed_documents = lambda self, texts: Embeddings.embed_documents(self, texts)
        PartialImpl.embed_multimodal_documents = lambda self, docs: Embeddings.embed_multimodal_documents(self, docs)
        PartialImpl.embed_multimodal_query = lambda self, doc: Embeddings.embed_multimodal_query(self, doc)
        PartialImpl.aembed_documents = lambda self, texts: Embeddings.aembed_documents(self, texts)
        PartialImpl.aembed_query = lambda self, text: Embeddings.aembed_query(self, text)

        partial = PartialImpl()
        with pytest.raises(NotImplementedError):
            partial.embed_multimodal_query({"file_id": "test"})

    def test_aembed_documents_raises_not_implemented(self):
        """Test that aembed_documents raises NotImplementedError."""

        class PartialImpl:
            pass

        PartialImpl.embed_query = lambda self, text: Embeddings.embed_query(self, text)
        PartialImpl.embed_documents = lambda self, texts: Embeddings.embed_documents(self, texts)
        PartialImpl.embed_multimodal_documents = lambda self, docs: Embeddings.embed_multimodal_documents(self, docs)
        PartialImpl.embed_multimodal_query = lambda self, doc: Embeddings.embed_multimodal_query(self, doc)
        PartialImpl.aembed_documents = lambda self, texts: Embeddings.aembed_documents(self, texts)
        PartialImpl.aembed_query = lambda self, text: Embeddings.aembed_query(self, text)

        partial = PartialImpl()

        async def run_test():
            with pytest.raises(NotImplementedError):
                await partial.aembed_documents(["test"])

        asyncio.run(run_test())

    def test_aembed_query_raises_not_implemented(self):
        """Test that aembed_query raises NotImplementedError."""

        class PartialImpl:
            pass

        PartialImpl.embed_query = lambda self, text: Embeddings.embed_query(self, text)
        PartialImpl.embed_documents = lambda self, texts: Embeddings.embed_documents(self, texts)
        PartialImpl.embed_multimodal_documents = lambda self, docs: Embeddings.embed_multimodal_documents(self, docs)
        PartialImpl.embed_multimodal_query = lambda self, doc: Embeddings.embed_multimodal_query(self, doc)
        PartialImpl.aembed_documents = lambda self, texts: Embeddings.aembed_documents(self, texts)
        PartialImpl.aembed_query = lambda self, text: Embeddings.aembed_query(self, text)

        partial = PartialImpl()

        async def run_test():
            with pytest.raises(NotImplementedError):
                await partial.aembed_query("test")

        asyncio.run(run_test())
