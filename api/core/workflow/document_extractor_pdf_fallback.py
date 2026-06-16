"""Compatibility fallback for Graphon PDF text extraction.

Graphon 0.5.x uses PDFium as the only PDF text extractor for the workflow
Document Extractor node. Some valid PDFs produce empty text with PDFium while
`pypdf` can still read their text layer. Dify installs this fallback at workflow
node bootstrap time so the node does not report a successful empty extraction
for those PDFs.
"""

import io
import logging
from collections.abc import Callable
from dataclasses import replace
from typing import Any

import pypdf

from graphon.nodes.document_extractor import node as graphon_document_extractor

logger = logging.getLogger(__name__)

PDF_EXTENSION = ".pdf"
PDF_MIME_TYPE = "application/pdf"
_PATCHED_EXTRACTOR_ATTRIBUTE = "_dify_pdf_empty_text_fallback"


def install_pdf_empty_text_fallback() -> None:
    """Patch Graphon's PDF registry with a fallback for empty PDFium text."""
    registry = graphon_document_extractor._TEXT_EXTRACTOR_REGISTRY
    pdf_registration = registry._file_extension_extractors.get(PDF_EXTENSION)
    if pdf_registration is None:
        logger.warning("Graphon PDF extractor registration not found")
        return

    if getattr(pdf_registration.extractor, _PATCHED_EXTRACTOR_ATTRIBUTE, False):
        return

    extract_text_from_pdf = _build_pdf_extractor_with_fallback(pdf_registration.extractor)
    patched_registration = replace(pdf_registration, extractor=extract_text_from_pdf)
    registry._file_extension_extractors[PDF_EXTENSION] = patched_registration
    registry._mime_type_extractors[PDF_MIME_TYPE] = patched_registration


def _build_pdf_extractor_with_fallback(pdf_extractor: Callable[[bytes], str]) -> Callable[[bytes], str]:
    def extract_text_from_pdf(file_content: bytes) -> str:
        text = pdf_extractor(file_content)
        if text.strip():
            return text

        fallback_text = _try_extract_text_with_pypdf(file_content)
        return fallback_text if fallback_text.strip() else text

    setattr(extract_text_from_pdf, _PATCHED_EXTRACTOR_ATTRIBUTE, True)
    return extract_text_from_pdf


def _try_extract_text_with_pypdf(file_content: bytes) -> str:
    try:
        pdf_reader = pypdf.PdfReader(io.BytesIO(file_content))
        pages: Any = pdf_reader.pages
        extract_page_text = _get_page_text_extractor()
        return "".join(extract_page_text(page) for page in pages)
    except Exception:
        logger.debug("pypdf fallback failed for PDF text extraction", exc_info=True)
        return ""


def _get_page_text_extractor() -> Callable[[Any], str]:
    def extract_page_text(page: Any) -> str:
        return page.extract_text() or ""

    return extract_page_text
