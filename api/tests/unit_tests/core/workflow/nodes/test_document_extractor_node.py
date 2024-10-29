from unittest.mock import Mock, patch

import pytest

from core.file import File, FileTransferMethod
from core.variables import ArrayFileSegment
from core.variables.variables import StringVariable
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.nodes.document_extractor import DocumentExtractorNode, DocumentExtractorNodeData
from core.workflow.nodes.document_extractor.node import (
    _extract_text_from_doc,
    _extract_text_from_pdf,
    _extract_text_from_plain_text,
)
from core.workflow.nodes.enums import NodeType
from models.workflow import WorkflowNodeExecutionStatus


@pytest.fixture
def document_extractor_node():
    node_data = DocumentExtractorNodeData(
        title="Test Document Extractor",
        variable_selector=["node_id", "variable_name"],
    )
    return DocumentExtractorNode(
        id="test_node_id",
        config={"id": "test_node_id", "data": node_data.model_dump()},
        graph_init_params=Mock(),
        graph=Mock(),
        graph_runtime_state=Mock(),
    )


@pytest.fixture
def mock_graph_runtime_state():
    return Mock()


def test_run_variable_not_found(document_extractor_node, mock_graph_runtime_state):
    document_extractor_node.graph_runtime_state = mock_graph_runtime_state
    mock_graph_runtime_state.variable_pool.get.return_value = None

    result = document_extractor_node._run()

    assert isinstance(result, NodeRunResult)
    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error is not None
    assert "File variable not found" in result.error


def test_run_invalid_variable_type(document_extractor_node, mock_graph_runtime_state):
    document_extractor_node.graph_runtime_state = mock_graph_runtime_state
    mock_graph_runtime_state.variable_pool.get.return_value = StringVariable(
        value="Not an ArrayFileSegment", name="test"
    )

    result = document_extractor_node._run()

    assert isinstance(result, NodeRunResult)
    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error is not None
    assert "is not an ArrayFileSegment" in result.error


@pytest.mark.parametrize(
    ("mime_type", "file_content", "expected_text", "transfer_method", "extension"),
    [
        ("text/plain", b"Hello, world!", ["Hello, world!"], FileTransferMethod.LOCAL_FILE, ".txt"),
        (
            "application/pdf",
            b"%PDF-1.5\n%Test PDF content",
            ["Mocked PDF content"],
            FileTransferMethod.LOCAL_FILE,
            ".pdf",
        ),
        (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            b"PK\x03\x04",
            ["Mocked DOCX content"],
            FileTransferMethod.REMOTE_URL,
            "",
        ),
        ("text/plain", b"Remote content", ["Remote content"], FileTransferMethod.REMOTE_URL, None),
    ],
)
def test_run_extract_text(
    document_extractor_node,
    mock_graph_runtime_state,
    mime_type,
    file_content,
    expected_text,
    transfer_method,
    extension,
    monkeypatch,
):
    document_extractor_node.graph_runtime_state = mock_graph_runtime_state

    mock_file = Mock(spec=File)
    mock_file.mime_type = mime_type
    mock_file.transfer_method = transfer_method
    mock_file.related_id = "test_file_id" if transfer_method == FileTransferMethod.LOCAL_FILE else None
    mock_file.remote_url = "https://example.com/file.txt" if transfer_method == FileTransferMethod.REMOTE_URL else None
    mock_file.extension = extension

    mock_array_file_segment = Mock(spec=ArrayFileSegment)
    mock_array_file_segment.value = [mock_file]

    mock_graph_runtime_state.variable_pool.get.return_value = mock_array_file_segment

    mock_download = Mock(return_value=file_content)
    mock_ssrf_proxy_get = Mock()
    mock_ssrf_proxy_get.return_value.content = file_content
    mock_ssrf_proxy_get.return_value.raise_for_status = Mock()

    monkeypatch.setattr("core.file.file_manager.download", mock_download)
    monkeypatch.setattr("core.helper.ssrf_proxy.get", mock_ssrf_proxy_get)

    if mime_type == "application/pdf":
        mock_pdf_extract = Mock(return_value=expected_text[0])
        monkeypatch.setattr("core.workflow.nodes.document_extractor.node._extract_text_from_pdf", mock_pdf_extract)
    elif mime_type.startswith("application/vnd.openxmlformats"):
        mock_docx_extract = Mock(return_value=expected_text[0])
        monkeypatch.setattr("core.workflow.nodes.document_extractor.node._extract_text_from_doc", mock_docx_extract)

    result = document_extractor_node._run()

    assert isinstance(result, NodeRunResult)
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED, result.error
    assert result.outputs is not None
    assert result.outputs["text"] == expected_text

    if transfer_method == FileTransferMethod.REMOTE_URL:
        mock_ssrf_proxy_get.assert_called_once_with("https://example.com/file.txt")
    elif transfer_method == FileTransferMethod.LOCAL_FILE:
        mock_download.assert_called_once_with(mock_file)


def test_extract_text_from_plain_text():
    text = _extract_text_from_plain_text(b"Hello, world!")
    assert text == "Hello, world!"


@patch("pypdfium2.PdfDocument")
def test_extract_text_from_pdf(mock_pdf_document):
    mock_page = Mock()
    mock_text_page = Mock()
    mock_text_page.get_text_range.return_value = "PDF content"
    mock_page.get_textpage.return_value = mock_text_page
    mock_pdf_document.return_value = [mock_page]
    text = _extract_text_from_pdf(b"%PDF-1.5\n%Test PDF content")
    assert text == "PDF content"


@patch("docx.Document")
def test_extract_text_from_doc(mock_document):
    mock_paragraph1 = Mock()
    mock_paragraph1.text = "Paragraph 1"
    mock_paragraph2 = Mock()
    mock_paragraph2.text = "Paragraph 2"
    mock_document.return_value.paragraphs = [mock_paragraph1, mock_paragraph2]

    text = _extract_text_from_doc(b"PK\x03\x04")
    assert text == "Paragraph 1\nParagraph 2"


def test_node_type(document_extractor_node):
    assert document_extractor_node._node_type == NodeType.DOCUMENT_EXTRACTOR
