import json
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from docx.table import Table

from core.variables.segments import FileSegment
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.file import File, FileTransferMethod
from core.workflow.nodes.document_extractor.entities import UnstructuredApiConfig
from core.workflow.nodes.document_extractor.exc import (
    DocumentExtractorError,
    FileDownloadError,
    TextExtractionError,
    UnsupportedFileTypeError,
)
from core.workflow.nodes.document_extractor.node import (
    DocumentExtractorNode,
    _download_file_content,
    _extract_text_by_file_extension,
    _extract_text_by_mime_type,
    _extract_text_from_csv,
    _extract_text_from_doc,
    _extract_text_from_docx,
    _extract_text_from_eml,
    _extract_text_from_epub,
    _extract_text_from_excel,
    _extract_text_from_file,
    _extract_text_from_json,
    _extract_text_from_msg,
    _extract_text_from_pdf,
    _extract_text_from_plain_text,
    _extract_text_from_ppt,
    _extract_text_from_pptx,
    _extract_text_from_properties,
    _extract_text_from_vtt,
    _extract_text_from_yaml,
)


@pytest.fixture
def mock_file():
    f = MagicMock(spec=File)
    f.extension = ".txt"
    f.mime_type = None
    f.transfer_method = FileTransferMethod.LOCAL_FILE
    return f


@pytest.fixture
def mock_node():
    node = MagicMock()

    node.node_data = MagicMock()
    node.node_data.variable_selector = "file_var"

    node.graph_runtime_state = MagicMock()
    node.graph_runtime_state.variable_pool = MagicMock()

    file_obj = MagicMock(spec=File)

    variable = MagicMock(spec=FileSegment)
    variable.value = file_obj

    node.graph_runtime_state.variable_pool.get.return_value = variable

    return node


class TestDocumentExtractorNodeRun:
    def test_variable_not_found(self, mock_node):
        mock_node.graph_runtime_state.variable_pool.get.return_value = None
        result = DocumentExtractorNode._run(mock_node)
        assert result.status == WorkflowNodeExecutionStatus.FAILED

    def test_invalid_variable_type(self, mock_node):
        mock_node.graph_runtime_state.variable_pool.get.return_value.value = "invalid"
        result = DocumentExtractorNode._run(mock_node)
        assert result.status == WorkflowNodeExecutionStatus.FAILED

    @patch("core.workflow.nodes.document_extractor.node._extract_text_from_file")
    def test_single_file_success(self, mock_extract, mock_node):
        mock_extract.return_value = "text"
        result = DocumentExtractorNode._run(mock_node)
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["text"] == "text"

    @patch("core.workflow.nodes.document_extractor.node._extract_text_from_file")
    def test_list_files_success(self, mock_extract, mock_node):
        file_obj = MagicMock(spec=File)
        mock_node.graph_runtime_state.variable_pool.get.return_value.value = [file_obj]
        mock_extract.return_value = "text"

        result = DocumentExtractorNode._run(mock_node)
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["text"].value == ["text"]

    @patch("core.workflow.nodes.document_extractor.node._extract_text_from_file")
    def test_extraction_error(self, mock_extract, mock_node):
        mock_extract.side_effect = DocumentExtractorError("fail")
        result = DocumentExtractorNode._run(mock_node)
        assert result.status == WorkflowNodeExecutionStatus.FAILED


class TestRouting:
    def test_unsupported_mime(self):
        with pytest.raises(UnsupportedFileTypeError):
            _extract_text_by_mime_type(
                file_content=b"",
                mime_type="unknown/type",
                unstructured_api_config=UnstructuredApiConfig(),
            )

    def test_unsupported_extension(self):
        with pytest.raises(UnsupportedFileTypeError):
            _extract_text_by_file_extension(
                file_content=b"",
                file_extension=".xyz",
                unstructured_api_config=UnstructuredApiConfig(),
            )


class TestPlainText:
    def test_plain_text_success(self):
        result = _extract_text_from_plain_text(b"hello")
        assert "hello" in result

    @patch("charset_normalizer.from_bytes")
    def test_charset_none(self, mock_charset):
        mock_charset.return_value.best.return_value = None
        result = _extract_text_from_plain_text(b"hello")
        assert "hello" in result


class TestJSON:
    def test_valid_json(self):
        data = {"a": 1}
        result = _extract_text_from_json(json.dumps(data).encode())
        assert '"a": 1' in result

    def test_invalid_json(self):
        with pytest.raises(TextExtractionError):
            _extract_text_from_json(b"{invalid")


class TestYAML:
    def test_valid_yaml(self):
        yaml_data = b"a: 1"
        result = _extract_text_from_yaml(yaml_data)
        assert "a: 1" in result

    def test_invalid_yaml(self):
        with pytest.raises(TextExtractionError):
            _extract_text_from_yaml(b": invalid")


class TestCSV:
    def test_valid_csv(self):
        csv_data = b"col1,col2\n1,2"
        result = _extract_text_from_csv(csv_data)
        assert "| col1 | col2 |" in result

    def test_empty_csv(self):
        result = _extract_text_from_csv(b"")
        assert result == ""


class TestExcel:
    @patch("pandas.ExcelFile")
    def test_excel_success(self, mock_excel):
        df = pd.DataFrame({"col": ["val"]})
        mock_excel.return_value.sheet_names = ["Sheet1"]
        mock_excel.return_value.parse.return_value = df

        result = _extract_text_from_excel(b"fake")
        assert "| col |" in result
        assert "| val |" in result

    @patch("pandas.ExcelFile", side_effect=Exception("fail"))
    def test_excel_failure(self, mock_excel):
        with pytest.raises(TextExtractionError):
            _extract_text_from_excel(b"fake")


class TestPDF:
    @patch("pypdfium2.PdfDocument")
    def test_pdf_success(self, mock_pdf):
        page = MagicMock()
        textpage = MagicMock()
        textpage.get_text_range.return_value = "text"
        page.get_textpage.return_value = textpage
        mock_pdf.return_value = [page]

        result = _extract_text_from_pdf(b"fake")
        assert "text" in result

    @patch("pypdfium2.PdfDocument", side_effect=Exception("fail"))
    def test_pdf_failure(self, mock_pdf):
        with pytest.raises(TextExtractionError):
            _extract_text_from_pdf(b"fake")


class TestDOC:
    def test_doc_missing_api(self):
        with pytest.raises(TextExtractionError):
            _extract_text_from_doc(b"fake", unstructured_api_config=UnstructuredApiConfig())


class TestDownload:
    def test_remote_missing_url(self):
        f = MagicMock(spec=File)
        f.transfer_method = FileTransferMethod.REMOTE_URL
        f.remote_url = None

        with pytest.raises(FileDownloadError):
            _download_file_content(f)


class TestVTT:
    @patch("webvtt.from_string")
    def test_vtt_merge(self, mock_vtt):
        mock_vtt.return_value = [
            MagicMock(voice="A", text="Hi"),
            MagicMock(voice="A", text="there"),
        ]
        result = _extract_text_from_vtt(b"fake")
        assert 'A "Hi there"' in result


class TestProperties:
    def test_properties_equal(self):
        data = b"a=1"
        result = _extract_text_from_properties(data)
        assert "a: 1" in result

    def test_properties_comment(self):
        data = b"#comment"
        result = _extract_text_from_properties(data)
        assert "#comment" in result


class TestVariableSelectorMapping:
    def test_mapping(self):
        mapping = DocumentExtractorNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="node1",
            node_data={
                "title": "Test",
                "variable_selector": ["file_var"],
            },
        )
        assert mapping == {"node1.files": ["file_var"]}


class TestMimeRouting:
    @pytest.mark.parametrize(
        ("mime", "target"),
        [
            ("text/plain", "_extract_text_from_plain_text"),
            ("application/pdf", "_extract_text_from_pdf"),
            ("application/msword", "_extract_text_from_doc"),
            ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "_extract_text_from_docx"),
            ("text/csv", "_extract_text_from_csv"),
            ("application/vnd.ms-excel", "_extract_text_from_excel"),
            ("application/vnd.ms-powerpoint", "_extract_text_from_ppt"),
            ("application/vnd.openxmlformats-officedocument.presentationml.presentation", "_extract_text_from_pptx"),
            ("application/epub+zip", "_extract_text_from_epub"),
            ("message/rfc822", "_extract_text_from_eml"),
            ("application/vnd.ms-outlook", "_extract_text_from_msg"),
            ("application/json", "_extract_text_from_json"),
            ("text/yaml", "_extract_text_from_yaml"),
            ("text/vtt", "_extract_text_from_vtt"),
            ("text/properties", "_extract_text_from_properties"),
        ],
    )
    def test_mime_routing(self, mime, target):
        with patch(f"core.workflow.nodes.document_extractor.node.{target}") as mock_func:
            mock_func.return_value = "ok"
            result = _extract_text_by_mime_type(
                file_content=b"data",
                mime_type=mime,
                unstructured_api_config=UnstructuredApiConfig(),
            )
            assert result == "ok"


class TestExtensionRouting:
    @pytest.mark.parametrize(
        ("ext", "target"),
        [
            (".txt", "_extract_text_from_plain_text"),
            (".json", "_extract_text_from_json"),
            (".yaml", "_extract_text_from_yaml"),
            (".pdf", "_extract_text_from_pdf"),
            (".doc", "_extract_text_from_doc"),
            (".docx", "_extract_text_from_docx"),
            (".csv", "_extract_text_from_csv"),
            (".xlsx", "_extract_text_from_excel"),
            (".ppt", "_extract_text_from_ppt"),
            (".pptx", "_extract_text_from_pptx"),
            (".epub", "_extract_text_from_epub"),
            (".eml", "_extract_text_from_eml"),
            (".msg", "_extract_text_from_msg"),
            (".properties", "_extract_text_from_properties"),
        ],
    )
    def test_extension_routing(self, ext, target):
        with patch(f"core.workflow.nodes.document_extractor.node.{target}") as mock_func:
            mock_func.return_value = "ok"
            result = _extract_text_by_file_extension(
                file_content=b"data",
                file_extension=ext,
                unstructured_api_config=UnstructuredApiConfig(),
            )
            assert result == "ok"


class TestExtractTextFromFile:
    @patch("core.workflow.nodes.document_extractor.node._download_file_content")
    @patch("core.workflow.nodes.document_extractor.node._extract_text_by_file_extension")
    def test_uses_extension(self, mock_ext, mock_download):
        file = MagicMock(spec=File)
        file.extension = ".txt"
        file.mime_type = None
        mock_download.return_value = b"data"
        mock_ext.return_value = "text"

        result = _extract_text_from_file(file, unstructured_api_config=UnstructuredApiConfig())
        assert result == "text"

    @patch("core.workflow.nodes.document_extractor.node._download_file_content")
    @patch("core.workflow.nodes.document_extractor.node._extract_text_by_mime_type")
    def test_uses_mime(self, mock_mime, mock_download):
        file = MagicMock(spec=File)
        file.extension = None
        file.mime_type = "text/plain"
        mock_download.return_value = b"data"
        mock_mime.return_value = "text"

        result = _extract_text_from_file(file, unstructured_api_config=UnstructuredApiConfig())
        assert result == "text"

    @patch("core.workflow.nodes.document_extractor.node._download_file_content")
    def test_missing_type(self, mock_download):
        file = MagicMock(spec=File)
        file.extension = None
        file.mime_type = None

        mock_download.return_value = b"data"

        with pytest.raises(UnsupportedFileTypeError):
            _extract_text_from_file(file, unstructured_api_config=UnstructuredApiConfig())


class TestDownloadBranches:
    @patch("core.workflow.nodes.document_extractor.node.ssrf_proxy.get")
    def test_remote_success(self, mock_get):
        file = MagicMock(spec=File)
        file.transfer_method = FileTransferMethod.REMOTE_URL
        file.remote_url = "http://test"

        response = MagicMock()
        response.content = b"data"
        mock_get.return_value = response

        result = _download_file_content(file)
        assert result == b"data"

    @patch("core.workflow.nodes.document_extractor.node.file_manager.download")
    def test_local_success(self, mock_download):
        file = MagicMock(spec=File)
        file.transfer_method = FileTransferMethod.LOCAL_FILE

        mock_download.return_value = b"data"
        result = _download_file_content(file)
        assert result == b"data"

    @patch("core.workflow.nodes.document_extractor.node.file_manager.download", side_effect=Exception("fail"))
    def test_local_failure(self, mock_download):
        file = MagicMock(spec=File)
        file.transfer_method = FileTransferMethod.LOCAL_FILE

        with pytest.raises(FileDownloadError):
            _download_file_content(file)


class TestDocx:
    @patch("core.workflow.nodes.document_extractor.node.docx.Document")
    @patch("core.workflow.nodes.document_extractor.node.parser_docx_part")
    def test_docx_paragraph(self, mock_parser, mock_document):
        paragraph = MagicMock()
        paragraph.text = "hello"
        mock_document.return_value.element.body = [MagicMock()]

        def inject(block, doc, content_items, i):
            content_items.append((0, "paragraph", paragraph))

        mock_parser.side_effect = inject

        result = _extract_text_from_docx(b"fake")
        assert "hello" in result


class TestJsonFallback:
    @patch("charset_normalizer.from_bytes")
    def test_json_fallback(self, mock_charset):
        mock_charset.return_value.best.return_value = None
        data = json.dumps({"a": 1}).encode()
        result = _extract_text_from_json(data)
        assert '"a": 1' in result


class TestYamlFallback:
    @patch("charset_normalizer.from_bytes")
    def test_yaml_fallback(self, mock_charset):
        mock_charset.return_value.best.return_value = None
        result = _extract_text_from_yaml(b"a: 1")
        assert "a: 1" in result


class TestCsvFailure:
    @patch("csv.reader", side_effect=Exception("fail"))
    def test_csv_failure(self, mock_csv):
        with pytest.raises(TextExtractionError):
            _extract_text_from_csv(b"data")


class TestVttEmpty:
    @patch("webvtt.from_string", return_value=[])
    def test_vtt_empty(self, mock_vtt):
        result = _extract_text_from_vtt(b"fake")
        assert result == ""


class TestPropertiesColon:
    def test_colon_separator(self):
        result = _extract_text_from_properties(b"a:1")
        assert "a: 1" in result


def test_run_unsupported_variable_type(mock_node):
    variable = MagicMock()  # NOT FileSegment or ArrayFileSegment
    variable.value = MagicMock()

    mock_node.graph_runtime_state.variable_pool.get.return_value = variable

    result = DocumentExtractorNode._run(mock_node)
    assert result.status == WorkflowNodeExecutionStatus.FAILED


@patch("charset_normalizer.from_bytes")
def test_json_hard_failure(mock_charset):
    mock_charset.return_value.best.return_value = None

    with pytest.raises(TextExtractionError):
        _extract_text_from_json(b"{invalid")


@patch("charset_normalizer.from_bytes")
def test_yaml_hard_failure(mock_charset):
    mock_charset.return_value.best.return_value = None

    with pytest.raises(TextExtractionError):
        _extract_text_from_yaml(b": invalid")


@patch("pypdfium2.PdfDocument", side_effect=Exception("fail"))
def test_pdf_exception(mock_pdf):
    with pytest.raises(TextExtractionError):
        _extract_text_from_pdf(b"data")


@patch("unstructured.partition.api.partition_via_api", side_effect=Exception("fail"))
def test_doc_exception(mock_partition):
    unstructured_api_config = UnstructuredApiConfig(api_url="http://fake", api_key="key")
    with pytest.raises(TextExtractionError):
        _extract_text_from_doc(b"data", unstructured_api_config=unstructured_api_config)


@patch("core.workflow.nodes.document_extractor.node.docx.Document")
def test_docx_table_branch(mock_doc):
    mock_table = MagicMock(spec=Table)

    header_row = MagicMock()
    header_row.cells = [MagicMock(text="col1"), MagicMock(text="col2")]

    data_row = MagicMock()
    data_row.cells = [MagicMock(text="val1"), MagicMock(text="val2")]

    mock_table.rows = [header_row, data_row]

    mock_doc.return_value.element.body = [MagicMock()]

    with patch("core.workflow.nodes.document_extractor.node.parser_docx_part") as parser:

        def inject(block, doc, content, i):
            content.append((0, "table", mock_table))

        parser.side_effect = inject

        result = _extract_text_from_docx(b"data")
        assert "| col1 | col2 |" in result


@patch("pandas.ExcelFile", side_effect=Exception("fail"))
def test_excel_outer_exception(mock_excel):
    with pytest.raises(TextExtractionError):
        _extract_text_from_excel(b"data")


@patch("unstructured.partition.ppt.partition_ppt")
def test_ppt_no_api(mock_partition):
    unstructured_api_config = UnstructuredApiConfig()

    element = MagicMock()
    element.text = "text"
    mock_partition.return_value = [element]

    result = _extract_text_from_ppt(b"data", unstructured_api_config=unstructured_api_config)
    assert "text" in result


@patch("unstructured.partition.pptx.partition_pptx", side_effect=Exception("fail"))
def test_pptx_failure(mock_partition):
    with pytest.raises(TextExtractionError):
        _extract_text_from_pptx(b"data", unstructured_api_config=UnstructuredApiConfig())


@patch("unstructured.partition.epub.partition_epub")
def test_epub_branch(mock_partition):
    unstructured_api_config = UnstructuredApiConfig()
    mock_partition.return_value = ["text"]
    result = _extract_text_from_epub(b"data", unstructured_api_config=unstructured_api_config)
    assert "text" in result


@patch("unstructured.partition.email.partition_email")
def test_eml_branch(mock_partition):
    mock_partition.return_value = ["email"]

    result = _extract_text_from_eml(b"data")
    assert "email" in result


@patch("unstructured.partition.msg.partition_msg")
def test_msg_branch(mock_partition):
    mock_partition.return_value = ["msg"]

    result = _extract_text_from_msg(b"data")
    assert "msg" in result


@patch("webvtt.from_string")
def test_vtt_speaker_change(mock_vtt):
    mock_vtt.return_value = [
        MagicMock(voice="A", text="Hi"),
        MagicMock(voice="B", text="Hello"),
    ]

    result = _extract_text_from_vtt(b"data")
    assert 'A "Hi"' in result
    assert 'B "Hello"' in result


@patch("core.workflow.nodes.document_extractor.node._extract_text_from_plain_text", side_effect=Exception("fail"))
def test_properties_failure(mock_plain):
    with pytest.raises(TextExtractionError):
        _extract_text_from_properties(b"data")


def test_download_missing_url():
    file = MagicMock(spec=File)
    file.transfer_method = FileTransferMethod.REMOTE_URL
    file.remote_url = None

    with pytest.raises(FileDownloadError):
        _download_file_content(file)


@patch("core.workflow.nodes.document_extractor.node.ssrf_proxy.get")
def test_download_raise_for_status(mock_get):
    file = MagicMock(spec=File)
    file.transfer_method = FileTransferMethod.REMOTE_URL
    file.remote_url = "http://test"

    response = MagicMock()
    response.raise_for_status.side_effect = Exception("fail")
    mock_get.return_value = response

    with pytest.raises(FileDownloadError):
        _download_file_content(file)
