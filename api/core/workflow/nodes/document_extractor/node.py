"""Workflow-local document extractor behavior.

Graphon 0.2.x tightened Excel extraction by only skipping a subset of sheet
parse failures. Dify historically treated any per-sheet parse failure as
skippable and continued extracting the remaining sheets. Keep that rule in a
workflow-owned node so the business behavior stays stable without import-time
monkey patching.
"""

from __future__ import annotations

import io
import logging
from collections.abc import Callable
from typing import Any, cast, override

import pandas as pd

from graphon.enums import WorkflowNodeExecutionStatus
from graphon.file.models import File
from graphon.node_events.base import NodeRunResult
from graphon.nodes.document_extractor import DocumentExtractorNode as GraphonDocumentExtractorNode
from graphon.nodes.document_extractor import node as graphon_document_extractor_node
from graphon.nodes.document_extractor.entities import UnstructuredApiConfig
from graphon.nodes.document_extractor.exc import (
    DocumentExtractorError,
    TextExtractionError,
    UnsupportedFileTypeError,
)
from graphon.nodes.protocols import HttpClientProtocol
from graphon.variables.segments import ArrayFileSegment, ArrayStringSegment, FileSegment

logger = logging.getLogger(__name__)

_EXCEL_EXTENSIONS = frozenset((".xls", ".xlsx"))
_EXCEL_MIME_TYPES = frozenset(
    (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
    )
)


def _call_graphon_extractor(extractor_name: str, **kwargs: Any) -> str:
    extractor = cast(Callable[..., str], getattr(graphon_document_extractor_node, extractor_name))
    return extractor(**kwargs)


def _construct_markdown_table(df: pd.DataFrame) -> str:
    header_row = "| " + " | ".join(df.columns) + " |"
    separator_row = "| " + " | ".join(["-" * len(col) for col in df.columns]) + " |"
    data_rows: list[str] = []
    for _, row in df.iterrows():
        data_rows.append("| " + " | ".join(map(str, row)) + " |")
    return "\n".join([header_row, separator_row, *data_rows])


def extract_text_from_excel(file_content: bytes) -> str:
    """Extract Excel content while skipping any failing sheet.

    Older Dify workflows accepted partially readable workbooks and surfaced the
    successfully parsed sheets only. Preserve that contract explicitly here.
    """
    try:
        excel_file = pd.ExcelFile(io.BytesIO(file_content))
        markdown_table = ""
        for sheet_name in excel_file.sheet_names:
            try:
                df = excel_file.parse(sheet_name=sheet_name)
                df = df.dropna(how="all")
                df = df.map(lambda value: " ".join(str(value).splitlines()) if isinstance(value, str) else value)
                df.columns = pd.Index([" ".join(str(column).splitlines()) for column in df.columns])
                markdown_table += _construct_markdown_table(df) + "\n\n"
            except Exception:
                continue
    except Exception as exc:
        raise TextExtractionError(f"Failed to extract text from Excel file: {exc!s}") from exc
    else:
        return markdown_table


def _extract_text_from_file(
    http_client: HttpClientProtocol,
    file: File,
    *,
    unstructured_api_config: UnstructuredApiConfig,
) -> str:
    file_content = graphon_document_extractor_node.download_file_content(http_client, file)

    if file.extension in _EXCEL_EXTENSIONS:
        return extract_text_from_excel(file_content)

    if file.mime_type in _EXCEL_MIME_TYPES:
        return extract_text_from_excel(file_content)

    if file.extension:
        return _call_graphon_extractor(
            "_extract_text_by_file_extension",
            file_content=file_content,
            file_extension=file.extension,
            unstructured_api_config=unstructured_api_config,
        )

    if file.mime_type:
        return _call_graphon_extractor(
            "_extract_text_by_mime_type",
            file_content=file_content,
            mime_type=file.mime_type,
            unstructured_api_config=unstructured_api_config,
        )

    msg = "Unable to determine file type: MIME type or file extension is missing"
    raise UnsupportedFileTypeError(msg)


class DocumentExtractorNode(GraphonDocumentExtractorNode):
    """Workflow-local document extractor that preserves Dify Excel semantics."""

    @classmethod
    @override
    def version(cls) -> str:
        return "1"

    @override
    def _run(self) -> NodeRunResult:
        variable_selector = self.node_data.variable_selector
        variable = self.graph_runtime_state.variable_pool.get(variable_selector)

        if variable is None:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=f"File variable not found for selector: {variable_selector}",
            )

        if variable.value and not isinstance(variable, ArrayFileSegment | FileSegment):
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=f"Variable {variable_selector} is not an ArrayFileSegment",
            )

        value = variable.value
        inputs = {"variable_selector": variable_selector}
        if isinstance(value, list):
            value = list(filter(lambda item: item, value))
        process_data = {"documents": value if isinstance(value, list) else [value]}

        if not value:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs=inputs,
                process_data=process_data,
                outputs={"text": ArrayStringSegment(value=[])},
            )

        if isinstance(value, list):
            try:
                extracted_text_list = [
                    _extract_text_from_file(
                        self.http_client,
                        file,
                        unstructured_api_config=self._unstructured_api_config,
                    )
                    for file in value
                ]
            except DocumentExtractorError as exc:
                logger.warning(exc, exc_info=True)
                return NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=str(exc),
                    inputs=inputs,
                    process_data=process_data,
                )
            outputs: dict[str, ArrayStringSegment | str] = {"text": ArrayStringSegment(value=extracted_text_list)}
        else:
            if not isinstance(value, File):
                msg = f"Variable {variable_selector} did not resolve to a file"
                return NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=msg,
                    inputs=inputs,
                    process_data=process_data,
                )
            try:
                extracted_text = _extract_text_from_file(
                    self.http_client,
                    value,
                    unstructured_api_config=self._unstructured_api_config,
                )
            except DocumentExtractorError as exc:
                logger.warning(exc, exc_info=True)
                return NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=str(exc),
                    inputs=inputs,
                    process_data=process_data,
                )
            outputs = {"text": extracted_text}

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=inputs,
            process_data=process_data,
            outputs=outputs,
        )
