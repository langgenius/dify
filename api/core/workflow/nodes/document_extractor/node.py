import csv
import io
import json
import os
import re
import tempfile

import docx
import pandas as pd
import pypdfium2  # type: ignore
import yaml  # type: ignore
from unstructured.partition.api import partition_via_api
from unstructured.partition.email import partition_email
from unstructured.partition.epub import partition_epub
from unstructured.partition.msg import partition_msg
from unstructured.partition.ppt import partition_ppt
from unstructured.partition.pptx import partition_pptx

from configs import dify_config
from core.file import File, FileTransferMethod, file_manager
from core.helper import ssrf_proxy
from core.variables import ArrayFileSegment
from core.variables.segments import FileSegment
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from models.workflow import WorkflowNodeExecutionStatus

from .entities import DocumentExtractorNodeData
from .exc import DocumentExtractorError, FileDownloadError, TextExtractionError, UnsupportedFileTypeError


class DocumentExtractorNode(BaseNode[DocumentExtractorNodeData]):
    """
    Extracts text content from various file types.
    Supports plain text, PDF, and DOC/DOCX files.
    """

    _node_data_cls = DocumentExtractorNodeData
    _node_type = NodeType.DOCUMENT_EXTRACTOR

    def _run(self):
        variable_selector = self.node_data.variable_selector
        variable = self.graph_runtime_state.variable_pool.get(variable_selector)

        if variable is None:
            error_message = f"File variable not found for selector: {variable_selector}"
            return NodeRunResult(status=WorkflowNodeExecutionStatus.FAILED, error=error_message)
        if variable.value and not isinstance(variable, ArrayFileSegment | FileSegment):
            error_message = f"Variable {variable_selector} is not an ArrayFileSegment"
            return NodeRunResult(status=WorkflowNodeExecutionStatus.FAILED, error=error_message)

        value = variable.value
        inputs = {"variable_selector": variable_selector}
        process_data = {"documents": value if isinstance(value, list) else [value]}

        try:
            if isinstance(value, list):
                extracted_text_list = list(map(_extract_text_from_file, value))
                return NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    inputs=inputs,
                    process_data=process_data,
                    outputs={"text": extracted_text_list},
                )
            elif isinstance(value, File):
                extracted_text = _extract_text_from_file(value)
                return NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    inputs=inputs,
                    process_data=process_data,
                    outputs={"text": extracted_text},
                )
            else:
                raise DocumentExtractorError(f"Unsupported variable type: {type(value)}")
        except DocumentExtractorError as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=str(e),
                inputs=inputs,
                process_data=process_data,
            )


def _extract_text_by_mime_type(*, file_content: bytes, mime_type: str) -> str:
    """Extract text from a file based on its MIME type."""
    match mime_type:
        case "text/plain" | "text/html" | "text/htm" | "text/markdown" | "text/xml":
            return _extract_text_from_plain_text(file_content)
        case "application/pdf":
            return _extract_text_from_pdf(file_content)
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | "application/msword":
            return _extract_text_from_doc(file_content)
        case "text/csv":
            return _extract_text_from_csv(file_content)
        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "application/vnd.ms-excel":
            return _extract_text_from_excel(file_content)
        case "application/vnd.ms-powerpoint":
            return _extract_text_from_ppt(file_content)
        case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
            return _extract_text_from_pptx(file_content)
        case "application/epub+zip":
            return _extract_text_from_epub(file_content)
        case "message/rfc822":
            return _extract_text_from_eml(file_content)
        case "application/vnd.ms-outlook":
            return _extract_text_from_msg(file_content)
        case "application/json":
            return _extract_text_from_json(file_content)
        case "application/x-yaml" | "text/yaml":
            return _extract_text_from_yaml(file_content)
        case "text/vtt":
            return _extract_text_from_vtt(file_content)
        case _:
            raise UnsupportedFileTypeError(f"Unsupported MIME type: {mime_type}")


def _extract_text_by_file_extension(*, file_content: bytes, file_extension: str) -> str:
    """Extract text from a file based on its file extension."""
    match file_extension:
        case ".txt" | ".markdown" | ".md" | ".html" | ".htm" | ".xml":
            return _extract_text_from_plain_text(file_content)
        case ".json":
            return _extract_text_from_json(file_content)
        case ".yaml" | ".yml":
            return _extract_text_from_yaml(file_content)
        case ".pdf":
            return _extract_text_from_pdf(file_content)
        case ".doc" | ".docx":
            return _extract_text_from_doc(file_content)
        case ".csv":
            return _extract_text_from_csv(file_content)
        case ".xls" | ".xlsx":
            return _extract_text_from_excel(file_content)
        case ".ppt":
            return _extract_text_from_ppt(file_content)
        case ".pptx":
            return _extract_text_from_pptx(file_content)
        case ".epub":
            return _extract_text_from_epub(file_content)
        case ".eml":
            return _extract_text_from_eml(file_content)
        case ".msg":
            return _extract_text_from_msg(file_content)
        case ".vtt":
            return _extract_text_from_vtt(file_content)
        case _:
            raise UnsupportedFileTypeError(f"Unsupported Extension Type: {file_extension}")


def _extract_text_from_plain_text(file_content: bytes) -> str:
    try:
        return file_content.decode("utf-8", "ignore")
    except UnicodeDecodeError as e:
        raise TextExtractionError("Failed to decode plain text file") from e


def _extract_text_from_json(file_content: bytes) -> str:
    try:
        json_data = json.loads(file_content.decode("utf-8", "ignore"))
        return json.dumps(json_data, indent=2, ensure_ascii=False)
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise TextExtractionError(f"Failed to decode or parse JSON file: {e}") from e


def _extract_text_from_yaml(file_content: bytes) -> str:
    """Extract the content from yaml file"""
    try:
        yaml_data = yaml.safe_load_all(file_content.decode("utf-8", "ignore"))
        return yaml.dump_all(yaml_data, allow_unicode=True, sort_keys=False)
    except (UnicodeDecodeError, yaml.YAMLError) as e:
        raise TextExtractionError(f"Failed to decode or parse YAML file: {e}") from e


def _extract_text_from_pdf(file_content: bytes) -> str:
    try:
        pdf_file = io.BytesIO(file_content)
        pdf_document = pypdfium2.PdfDocument(pdf_file, autoclose=True)
        text = ""
        for page in pdf_document:
            text_page = page.get_textpage()
            text += text_page.get_text_range()
            text_page.close()
            page.close()
        return text
    except Exception as e:
        raise TextExtractionError(f"Failed to extract text from PDF: {str(e)}") from e


def _extract_text_from_doc(file_content: bytes) -> str:
    try:
        doc_file = io.BytesIO(file_content)
        doc = docx.Document(doc_file)
        return "\n".join([paragraph.text for paragraph in doc.paragraphs])
    except Exception as e:
        raise TextExtractionError(f"Failed to extract text from DOC/DOCX: {str(e)}") from e


def _download_file_content(file: File) -> bytes:
    """Download the content of a file based on its transfer method."""
    try:
        if file.transfer_method == FileTransferMethod.REMOTE_URL:
            if file.remote_url is None:
                raise FileDownloadError("Missing URL for remote file")
            response = ssrf_proxy.get(file.remote_url)
            response.raise_for_status()
            return response.content
        else:
            return file_manager.download(file)
    except Exception as e:
        raise FileDownloadError(f"Error downloading file: {str(e)}") from e


def _extract_text_from_file(file: File):
    file_content = _download_file_content(file)
    if file.extension:
        extracted_text = _extract_text_by_file_extension(file_content=file_content, file_extension=file.extension)
    elif file.mime_type:
        extracted_text = _extract_text_by_mime_type(file_content=file_content, mime_type=file.mime_type)
    else:
        raise UnsupportedFileTypeError("Unable to determine file type: MIME type or file extension is missing")
    return extracted_text


def _extract_text_from_csv(file_content: bytes) -> str:
    try:
        csv_file = io.StringIO(file_content.decode("utf-8", "ignore"))
        csv_reader = csv.reader(csv_file)
        rows = list(csv_reader)

        if not rows:
            return ""

        # Create Markdown table
        markdown_table = "| " + " | ".join(rows[0]) + " |\n"
        markdown_table += "| " + " | ".join(["---"] * len(rows[0])) + " |\n"
        for row in rows[1:]:
            markdown_table += "| " + " | ".join(row) + " |\n"

        return markdown_table.strip()
    except Exception as e:
        raise TextExtractionError(f"Failed to extract text from CSV: {str(e)}") from e


def _extract_text_from_excel(file_content: bytes) -> str:
    """Extract text from an Excel file using pandas."""
    try:
        excel_file = pd.ExcelFile(io.BytesIO(file_content))
        markdown_table = ""
        for sheet_name in excel_file.sheet_names:
            try:
                df = excel_file.parse(sheet_name=sheet_name)
                df.dropna(how="all", inplace=True)
                # Create Markdown table two times to separate tables with a newline
                markdown_table += df.to_markdown(index=False) + "\n\n"
            except Exception as e:
                continue
        return markdown_table
    except Exception as e:
        raise TextExtractionError(f"Failed to extract text from Excel file: {str(e)}") from e


def _extract_text_from_ppt(file_content: bytes) -> str:
    try:
        with io.BytesIO(file_content) as file:
            elements = partition_ppt(file=file)
        return "\n".join([getattr(element, "text", "") for element in elements])
    except Exception as e:
        raise TextExtractionError(f"Failed to extract text from PPT: {str(e)}") from e


def _extract_text_from_vtt(vtt_bytes: bytes):
    text = _extract_text_from_plain_text(vtt_bytes)
    lines = text.splitlines()

    raw_results = []

    i = 0
    while i < len(lines):
        line = lines[i].strip()

        # Skip "WEBVTT", empty lines, and cue identifiers
        if line in ("WEBVTT", ""):
            i += 1
            continue

        # Check if it is a timestamp line
        if "-->" in line:
            # Collect the cue text from the next lines
            i += 1
            cue_lines = []

            # The text until the next empty line or timestamp line is considered as one cue
            while i < len(lines) and lines[i].strip() != "" and "-->" not in lines[i]:
                cue_lines.append(lines[i])
                i += 1

            # Extract <v speaker> ... </v> within the cue
            cue_text = "\n".join(cue_lines)

            # Regular expression to extract speaker name and content
            pattern = r"<v\s+([^>]+)>(.*?)</v>"
            match = re.search(pattern, cue_text, flags=re.DOTALL)

            if match:
                speaker = match.group(1).strip()
                content = match.group(2).strip()
                # Convert line breaks to spaces
                content = " ".join(line.strip() for line in content.splitlines() if line.strip())

                # Store in the list in chronological order
                raw_results.append((speaker, content))
        else:
            i += 1

    # Merge consecutive utterances by the same speaker
    merged_results = []
    if raw_results:
        current_speaker, current_text = raw_results[0]

        for i in range(1, len(raw_results)):
            spk, txt = raw_results[i]
            if spk == current_speaker:
                # If it is the same speaker, merge the utterances (joined by space)
                current_text += " " + txt
            else:
                # If the speaker changes, register the utterance so far and move on
                merged_results.append((current_speaker, current_text))
                current_speaker, current_text = spk, txt

        # Add the last element
        merged_results.append((current_speaker, current_text))
    else:
        merged_results = raw_results

    # Return the result in the specified format: Speaker "text" style
    formatted = [f'{spk} "{txt}"' for spk, txt in merged_results]
    return "\n".join(formatted)


def _extract_text_from_pptx(file_content: bytes) -> str:
    try:
        if dify_config.UNSTRUCTURED_API_URL and dify_config.UNSTRUCTURED_API_KEY:
            with tempfile.NamedTemporaryFile(suffix=".pptx", delete=False) as temp_file:
                temp_file.write(file_content)
                temp_file.flush()
                with open(temp_file.name, "rb") as file:
                    elements = partition_via_api(
                        file=file,
                        metadata_filename=temp_file.name,
                        api_url=dify_config.UNSTRUCTURED_API_URL,
                        api_key=dify_config.UNSTRUCTURED_API_KEY,
                    )
                os.unlink(temp_file.name)
        else:
            with io.BytesIO(file_content) as file:
                elements = partition_pptx(file=file)
        return "\n".join([getattr(element, "text", "") for element in elements])
    except Exception as e:
        raise TextExtractionError(f"Failed to extract text from PPTX: {str(e)}") from e


def _extract_text_from_epub(file_content: bytes) -> str:
    try:
        with io.BytesIO(file_content) as file:
            elements = partition_epub(file=file)
        return "\n".join([str(element) for element in elements])
    except Exception as e:
        raise TextExtractionError(f"Failed to extract text from EPUB: {str(e)}") from e


def _extract_text_from_eml(file_content: bytes) -> str:
    try:
        with io.BytesIO(file_content) as file:
            elements = partition_email(file=file)
        return "\n".join([str(element) for element in elements])
    except Exception as e:
        raise TextExtractionError(f"Failed to extract text from EML: {str(e)}") from e


def _extract_text_from_msg(file_content: bytes) -> str:
    try:
        with io.BytesIO(file_content) as file:
            elements = partition_msg(file=file)
        return "\n".join([str(element) for element in elements])
    except Exception as e:
        raise TextExtractionError(f"Failed to extract text from MSG: {str(e)}") from e
