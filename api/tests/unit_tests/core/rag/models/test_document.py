import asyncio
from collections.abc import Sequence

import pytest
from pydantic import ValidationError

from core.rag.models.document import (
    AttachmentDocument,
    BaseDocumentTransformer,
    ChildDocument,
    Document,
    GeneralChunk,
    GeneralStructureChunk,
    MultimodalGeneralStructureChunk,
    ParentChildChunk,
    ParentChildStructureChunk,
    QAChunk,
    QAStructureChunk,
)


class TestChildDocument:
    def test_minimal_construction_uses_defaults(self) -> None:
        chunk = ChildDocument(page_content="hello")
        assert chunk.page_content == "hello"
        assert chunk.vector is None
        assert chunk.metadata == {}

    def test_metadata_default_is_not_shared_between_instances(self) -> None:
        first = ChildDocument(page_content="a")
        second = ChildDocument(page_content="b")
        first.metadata["source"] = "first.txt"
        assert second.metadata == {}

    def test_vector_and_metadata_are_kept(self) -> None:
        chunk = ChildDocument(page_content="a", vector=[0.5, 0.25], metadata={"page": 3})
        assert chunk.vector == [0.5, 0.25]
        assert chunk.metadata == {"page": 3}

    def test_page_content_is_required(self) -> None:
        with pytest.raises(ValidationError, match="page_content"):
            ChildDocument.model_validate({})


class TestAttachmentDocument:
    def test_provider_defaults_to_dify(self) -> None:
        attachment = AttachmentDocument(page_content="a")
        assert attachment.provider == "dify"
        assert attachment.vector is None
        assert attachment.metadata == {}

    def test_provider_can_be_overridden(self) -> None:
        attachment = AttachmentDocument(page_content="a", provider="external-store")
        assert attachment.provider == "external-store"

    def test_page_content_is_required(self) -> None:
        with pytest.raises(ValidationError, match="page_content"):
            AttachmentDocument.model_validate({})


class TestDocument:
    def test_minimal_construction_uses_defaults(self) -> None:
        document = Document(page_content="body")
        assert document.page_content == "body"
        assert document.vector is None
        assert document.metadata == {}
        assert document.provider == "dify"
        assert document.children is None
        assert document.attachments is None

    def test_metadata_default_is_not_shared_between_instances(self) -> None:
        first = Document(page_content="a")
        second = Document(page_content="b")
        first.metadata["document_id"] = "doc-1"
        assert second.metadata == {}

    def test_nested_children_and_attachments_are_validated(self) -> None:
        document = Document(
            page_content="parent",
            children=[ChildDocument(page_content="child-1"), ChildDocument(page_content="child-2")],
            attachments=[AttachmentDocument(page_content="att", provider="s3")],
        )
        children = document.children
        attachments = document.attachments
        assert children is not None
        assert attachments is not None
        assert [child.page_content for child in children] == ["child-1", "child-2"]
        assert attachments[0].provider == "s3"

    def test_children_accept_plain_mappings(self) -> None:
        document = Document(page_content="parent", children=[{"page_content": "child"}])
        children = document.children
        assert children is not None
        assert isinstance(children[0], ChildDocument)
        assert children[0].page_content == "child"

    def test_metadata_accepts_arbitrary_nested_values(self) -> None:
        metadata = {"source": "file.txt", "page": 3, "tags": ["a", "b"], "nested": {"k": "v"}}
        document = Document(page_content="body", metadata=metadata)
        assert document.metadata == metadata

    def test_page_content_is_required(self) -> None:
        with pytest.raises(ValidationError, match="page_content"):
            Document.model_validate({})

    def test_children_reject_non_list_values(self) -> None:
        with pytest.raises(ValidationError, match="children"):
            Document.model_validate({"page_content": "body", "children": "not-a-list"})


class TestGeneralChunk:
    def test_minimal_construction_uses_defaults(self) -> None:
        chunk = GeneralChunk(content="text")
        assert chunk.content == "text"
        assert chunk.files is None

    def test_content_is_required(self) -> None:
        with pytest.raises(ValidationError, match="content"):
            GeneralChunk.model_validate({})


class TestMultimodalGeneralStructureChunk:
    def test_general_chunks_are_kept(self) -> None:
        chunk = MultimodalGeneralStructureChunk(
            general_chunks=[GeneralChunk(content="a"), GeneralChunk(content="b")],
        )
        assert [c.content for c in chunk.general_chunks] == ["a", "b"]

    def test_general_chunks_are_required(self) -> None:
        with pytest.raises(ValidationError, match="general_chunks"):
            MultimodalGeneralStructureChunk.model_validate({})


class TestGeneralStructureChunk:
    def test_string_chunks_are_kept(self) -> None:
        chunk = GeneralStructureChunk(general_chunks=["a", "b"])
        assert chunk.general_chunks == ["a", "b"]

    def test_general_chunks_are_required(self) -> None:
        with pytest.raises(ValidationError, match="general_chunks"):
            GeneralStructureChunk.model_validate({})


class TestParentChildChunk:
    def test_minimal_construction_uses_defaults(self) -> None:
        chunk = ParentChildChunk(parent_content="parent", child_contents=["c1", "c2"])
        assert chunk.parent_content == "parent"
        assert chunk.child_contents == ["c1", "c2"]
        assert chunk.files is None

    def test_child_contents_are_required(self) -> None:
        with pytest.raises(ValidationError, match="child_contents"):
            ParentChildChunk.model_validate({"parent_content": "parent"})


class TestParentChildStructureChunk:
    def test_parent_mode_defaults_to_paragraph(self) -> None:
        chunk = ParentChildStructureChunk(
            parent_child_chunks=[ParentChildChunk(parent_content="p", child_contents=["c"])],
        )
        assert chunk.parent_mode == "paragraph"

    def test_parent_mode_can_be_overridden(self) -> None:
        chunk = ParentChildStructureChunk(
            parent_child_chunks=[ParentChildChunk(parent_content="p", child_contents=["c"])],
            parent_mode="full-doc",
        )
        assert chunk.parent_mode == "full-doc"

    def test_parent_child_chunks_are_required(self) -> None:
        with pytest.raises(ValidationError, match="parent_child_chunks"):
            ParentChildStructureChunk.model_validate({})


class TestQAChunk:
    def test_question_and_answer_are_kept(self) -> None:
        chunk = QAChunk(question="What?", answer="This.")
        assert chunk.question == "What?"
        assert chunk.answer == "This."

    def test_question_is_required(self) -> None:
        with pytest.raises(ValidationError, match="question"):
            QAChunk.model_validate({"answer": "This."})


class TestQAStructureChunk:
    def test_qa_chunks_are_kept(self) -> None:
        chunk = QAStructureChunk(
            qa_chunks=[QAChunk(question="q1", answer="a1"), QAChunk(question="q2", answer="a2")],
        )
        assert len(chunk.qa_chunks) == 2

    def test_qa_chunks_are_required(self) -> None:
        with pytest.raises(ValidationError, match="qa_chunks"):
            QAStructureChunk.model_validate({})


class TestBaseDocumentTransformer:
    def test_complete_subclass_transforms_documents(self) -> None:
        class IdentityTransformer(BaseDocumentTransformer):
            def transform_documents(self, documents: Sequence[Document], **kwargs: object) -> Sequence[Document]:
                _ = kwargs  # accepted for ABC signature compatibility, unused by the identity transform
                return documents

            async def atransform_documents(self, documents: Sequence[Document], **kwargs: object) -> Sequence[Document]:
                _ = kwargs  # accepted for ABC signature compatibility, unused by the identity transform
                return documents

        transformer = IdentityTransformer()
        documents = [Document(page_content="a"), Document(page_content="b")]

        assert list(transformer.transform_documents(documents)) == documents
        assert asyncio.run(transformer.atransform_documents(documents)) == documents

    def test_transform_documents_accepts_extra_kwargs(self) -> None:
        class KwargsTransformer(BaseDocumentTransformer):
            def transform_documents(self, documents: Sequence[Document], **kwargs: object) -> Sequence[Document]:
                return [Document(page_content=f"{doc.page_content}-{kwargs.get('suffix', '')}") for doc in documents]

            async def atransform_documents(self, documents: Sequence[Document], **kwargs: object) -> Sequence[Document]:
                _ = kwargs  # accepted for ABC signature compatibility, unused by this stub
                return documents

        transformer = KwargsTransformer()
        result = transformer.transform_documents([Document(page_content="a")], suffix="x")
        assert [doc.page_content for doc in result] == ["a-x"]
