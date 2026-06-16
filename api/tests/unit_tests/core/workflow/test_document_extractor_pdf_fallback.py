import importlib
from dataclasses import replace
from types import SimpleNamespace

import pypdf

from graphon.nodes.document_extractor import node as graphon_document_extractor


def test_install_pdf_empty_text_fallback_wraps_graphon_pdf_registry(monkeypatch):
    registry = graphon_document_extractor._TEXT_EXTRACTOR_REGISTRY
    original_registration = registry._file_extension_extractors[".pdf"]

    def pdfium_empty_text(_file_content: bytes) -> str:
        return "\n  "

    class FallbackPage:
        def extract_text(self) -> str:
            return "fallback text"

    monkeypatch.setitem(
        registry._file_extension_extractors,
        ".pdf",
        replace(original_registration, extractor=pdfium_empty_text),
    )
    monkeypatch.setitem(
        registry._mime_type_extractors,
        "application/pdf",
        replace(original_registration, extractor=pdfium_empty_text),
    )
    monkeypatch.setattr(
        pypdf,
        "PdfReader",
        lambda *_args, **_kwargs: SimpleNamespace(pages=[FallbackPage()]),
    )

    fallback = importlib.import_module("core.workflow.document_extractor_pdf_fallback")
    fallback = importlib.reload(fallback)
    fallback.install_pdf_empty_text_fallback()

    patched_registration = registry._file_extension_extractors[".pdf"]
    patched_mime_registration = registry._mime_type_extractors["application/pdf"]
    assert patched_registration.extractor(b"%PDF") == "fallback text"
    assert patched_mime_registration.extractor is patched_registration.extractor
