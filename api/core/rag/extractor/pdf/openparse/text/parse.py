from typing import Literal, Optional

from core.rag.extractor.pdf.openparse.pdf import Pdf
from core.rag.extractor.pdf.openparse.schemas import TextElement

from . import pdfminer, pymupdf


def ingest(
        doc: Pdf, parsing_method: Literal["pdfminer", "pymupdf"] = "pdfminer", ocr: bool = False,
        max_parser_page: Optional[int] = None,
) -> list[TextElement]:
    """
    Default to pdfminer-based implementation.

    Optional use the PyMuPDF-based implementation which has identical behaviour but supports OCR. Important - see their licensing to view the terms of use:
    https://mupdf.com/licensing/index.html
    """
    if parsing_method == "pdfminer":
        return pdfminer.ingest(doc)
    elif parsing_method == "pymupdf":
        return pymupdf.ingest(doc=doc, ocr=ocr, max_parser_page=max_parser_page)
    # else:
#     raise ValueError(f"Unsupported parsing_method: {parsing_method}")
