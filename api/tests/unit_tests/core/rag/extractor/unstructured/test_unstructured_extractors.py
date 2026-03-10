"""Unit tests for unstructured extractors and their local/API partitioning paths."""

import base64
import sys
import types
from types import SimpleNamespace

import pytest

import core.rag.extractor.unstructured.unstructured_epub_extractor as epub_module
from core.rag.extractor.unstructured.unstructured_doc_extractor import UnstructuredWordExtractor
from core.rag.extractor.unstructured.unstructured_eml_extractor import UnstructuredEmailExtractor
from core.rag.extractor.unstructured.unstructured_epub_extractor import UnstructuredEpubExtractor
from core.rag.extractor.unstructured.unstructured_markdown_extractor import UnstructuredMarkdownExtractor
from core.rag.extractor.unstructured.unstructured_msg_extractor import UnstructuredMsgExtractor
from core.rag.extractor.unstructured.unstructured_ppt_extractor import UnstructuredPPTExtractor
from core.rag.extractor.unstructured.unstructured_pptx_extractor import UnstructuredPPTXExtractor
from core.rag.extractor.unstructured.unstructured_xml_extractor import UnstructuredXmlExtractor


def _register_module(monkeypatch: pytest.MonkeyPatch, name: str, **attrs: object) -> types.ModuleType:
    module = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(module, k, v)
    monkeypatch.setitem(sys.modules, name, module)
    return module


def _register_unstructured_packages(monkeypatch: pytest.MonkeyPatch) -> None:
    _register_module(monkeypatch, "unstructured", __path__=[])
    _register_module(monkeypatch, "unstructured.partition", __path__=[])
    _register_module(monkeypatch, "unstructured.chunking", __path__=[])
    _register_module(monkeypatch, "unstructured.file_utils", __path__=[])


def _install_chunk_by_title(monkeypatch: pytest.MonkeyPatch, chunks: list[SimpleNamespace]) -> None:
    _register_unstructured_packages(monkeypatch)

    def chunk_by_title(
        elements: list[SimpleNamespace], max_characters: int, combine_text_under_n_chars: int
    ) -> list[SimpleNamespace]:
        return chunks

    _register_module(monkeypatch, "unstructured.chunking.title", chunk_by_title=chunk_by_title)


class TestUnstructuredMarkdownMsgXml:
    def test_markdown_extractor_without_api(self, monkeypatch):
        _install_chunk_by_title(monkeypatch, [SimpleNamespace(text=" chunk-1 "), SimpleNamespace(text=" chunk-2 ")])
        _register_module(
            monkeypatch, "unstructured.partition.md", partition_md=lambda filename: [SimpleNamespace(text="x")]
        )

        docs = UnstructuredMarkdownExtractor("/tmp/file.md").extract()

        assert [doc.page_content for doc in docs] == ["chunk-1", "chunk-2"]

    def test_markdown_extractor_with_api(self, monkeypatch):
        _install_chunk_by_title(monkeypatch, [SimpleNamespace(text=" via-api ")])
        calls = {}

        def partition_via_api(filename, api_url, api_key):
            calls.update({"filename": filename, "api_url": api_url, "api_key": api_key})
            return [SimpleNamespace(text="ignored")]

        _register_module(monkeypatch, "unstructured.partition.api", partition_via_api=partition_via_api)

        docs = UnstructuredMarkdownExtractor("/tmp/file.md", api_url="https://u", api_key="k").extract()

        assert docs[0].page_content == "via-api"
        assert calls == {"filename": "/tmp/file.md", "api_url": "https://u", "api_key": "k"}

    def test_msg_extractor_local(self, monkeypatch):
        _install_chunk_by_title(monkeypatch, [SimpleNamespace(text="msg-doc")])
        _register_module(
            monkeypatch, "unstructured.partition.msg", partition_msg=lambda filename: [SimpleNamespace(text="x")]
        )

        assert UnstructuredMsgExtractor("/tmp/file.msg").extract()[0].page_content == "msg-doc"

    def test_msg_extractor_with_api(self, monkeypatch):
        _install_chunk_by_title(monkeypatch, [SimpleNamespace(text="msg-doc")])
        calls = {}

        def partition_via_api(filename, api_url, api_key):
            calls.update({"filename": filename, "api_url": api_url, "api_key": api_key})
            return [SimpleNamespace(text="x")]

        _register_module(monkeypatch, "unstructured.partition.api", partition_via_api=partition_via_api)

        assert (
            UnstructuredMsgExtractor("/tmp/file.msg", api_url="https://u", api_key="k").extract()[0].page_content
            == "msg-doc"
        )
        assert calls["filename"] == "/tmp/file.msg"

    def test_xml_extractor_local_and_api(self, monkeypatch):
        _install_chunk_by_title(monkeypatch, [SimpleNamespace(text="xml-doc")])

        xml_calls = {}

        def partition_xml(filename, xml_keep_tags):
            xml_calls.update({"filename": filename, "xml_keep_tags": xml_keep_tags})
            return [SimpleNamespace(text="x")]

        _register_module(monkeypatch, "unstructured.partition.xml", partition_xml=partition_xml)

        assert UnstructuredXmlExtractor("/tmp/file.xml").extract()[0].page_content == "xml-doc"
        assert xml_calls == {"filename": "/tmp/file.xml", "xml_keep_tags": True}

        api_calls = {}

        def partition_via_api(filename, api_url, api_key):
            api_calls.update({"filename": filename, "api_url": api_url, "api_key": api_key})
            return [SimpleNamespace(text="x")]

        _register_module(monkeypatch, "unstructured.partition.api", partition_via_api=partition_via_api)

        assert (
            UnstructuredXmlExtractor("/tmp/file.xml", api_url="https://u", api_key="k").extract()[0].page_content
            == "xml-doc"
        )
        assert api_calls["filename"] == "/tmp/file.xml"


class TestUnstructuredEmailAndEpub:
    def test_email_extractor_local_decodes_html_and_suppresses_decode_errors(self, monkeypatch):
        _register_unstructured_packages(monkeypatch)
        captured = {}

        def chunk_by_title(
            elements: list[SimpleNamespace], max_characters: int, combine_text_under_n_chars: int
        ) -> list[SimpleNamespace]:
            captured["elements"] = list(elements)
            return [SimpleNamespace(text=" chunked-email ")]

        _register_module(monkeypatch, "unstructured.chunking.title", chunk_by_title=chunk_by_title)

        html = "<p>Hello Email</p>"
        encoded_html = base64.b64encode(html.encode("utf-8")).decode("utf-8")
        bad_base64 = "not-base64"

        elements = [SimpleNamespace(text=encoded_html), SimpleNamespace(text=bad_base64)]
        _register_module(monkeypatch, "unstructured.partition.email", partition_email=lambda filename: elements)

        docs = UnstructuredEmailExtractor("/tmp/file.eml").extract()

        assert docs[0].page_content == "chunked-email"
        chunk_elements = captured["elements"]
        assert "Hello Email" in chunk_elements[0].text
        assert chunk_elements[1].text == bad_base64

    def test_email_extractor_with_api(self, monkeypatch):
        _install_chunk_by_title(monkeypatch, [SimpleNamespace(text="api-email")])
        _register_module(
            monkeypatch,
            "unstructured.partition.api",
            partition_via_api=lambda filename, api_url, api_key: [SimpleNamespace(text="abc")],
        )

        docs = UnstructuredEmailExtractor("/tmp/file.eml", api_url="https://u", api_key="k").extract()

        assert docs[0].page_content == "api-email"

    def test_epub_extractor_local_and_api(self, monkeypatch):
        _install_chunk_by_title(monkeypatch, [SimpleNamespace(text="epub-doc")])

        calls = {"download": 0, "partition": 0}

        def fake_download_pandoc():
            calls["download"] += 1

        def partition_epub(filename, xml_keep_tags):
            calls["partition"] += 1
            assert xml_keep_tags is True
            return [SimpleNamespace(text="x")]

        monkeypatch.setattr(epub_module.pypandoc, "download_pandoc", fake_download_pandoc)
        _register_module(monkeypatch, "unstructured.partition.epub", partition_epub=partition_epub)

        docs = UnstructuredEpubExtractor("/tmp/file.epub").extract()

        assert docs[0].page_content == "epub-doc"
        assert calls == {"download": 1, "partition": 1}

        _register_module(
            monkeypatch,
            "unstructured.partition.api",
            partition_via_api=lambda filename, api_url, api_key: [SimpleNamespace(text="x")],
        )

        docs = UnstructuredEpubExtractor("/tmp/file.epub", api_url="https://u", api_key="k").extract()
        assert docs[0].page_content == "epub-doc"


class TestUnstructuredPPTAndPPTX:
    def test_ppt_extractor_requires_api_url(self):
        with pytest.raises(NotImplementedError, match="Unstructured API Url is not configured"):
            UnstructuredPPTExtractor("/tmp/file.ppt").extract()

    def test_ppt_extractor_groups_text_by_page(self, monkeypatch):
        _register_unstructured_packages(monkeypatch)
        _register_module(
            monkeypatch,
            "unstructured.partition.api",
            partition_via_api=lambda filename, api_url, api_key: [
                SimpleNamespace(text="A", metadata=SimpleNamespace(page_number=1)),
                SimpleNamespace(text="B", metadata=SimpleNamespace(page_number=1)),
                SimpleNamespace(text="skip", metadata=SimpleNamespace(page_number=None)),
                SimpleNamespace(text="C", metadata=SimpleNamespace(page_number=2)),
            ],
        )

        docs = UnstructuredPPTExtractor("/tmp/file.ppt", api_url="https://u", api_key="k").extract()

        assert [doc.page_content for doc in docs] == ["A\nB", "C"]

    def test_pptx_extractor_local_and_api(self, monkeypatch):
        _register_unstructured_packages(monkeypatch)
        _register_module(
            monkeypatch,
            "unstructured.partition.pptx",
            partition_pptx=lambda filename: [
                SimpleNamespace(text="P1", metadata=SimpleNamespace(page_number=1)),
                SimpleNamespace(text="P2", metadata=SimpleNamespace(page_number=2)),
                SimpleNamespace(text="Skip", metadata=SimpleNamespace(page_number=None)),
            ],
        )

        docs = UnstructuredPPTXExtractor("/tmp/file.pptx").extract()
        assert [doc.page_content for doc in docs] == ["P1", "P2"]

        _register_module(
            monkeypatch,
            "unstructured.partition.api",
            partition_via_api=lambda filename, api_url, api_key: [
                SimpleNamespace(text="X", metadata=SimpleNamespace(page_number=1)),
                SimpleNamespace(text="Y", metadata=SimpleNamespace(page_number=1)),
            ],
        )

        docs = UnstructuredPPTXExtractor("/tmp/file.pptx", api_url="https://u", api_key="k").extract()
        assert [doc.page_content for doc in docs] == ["X\nY"]


class TestUnstructuredWord:
    def _install_doc_modules(self, monkeypatch, version: str, filetype_value):
        _register_unstructured_packages(monkeypatch)

        class FileType:
            DOC = "doc"

        _register_module(monkeypatch, "unstructured.__version__", __version__=version)
        _register_module(
            monkeypatch,
            "unstructured.file_utils.filetype",
            FileType=FileType,
            detect_filetype=lambda filename: filetype_value,
        )
        _register_module(
            monkeypatch,
            "unstructured.partition.api",
            partition_via_api=lambda filename, api_url, api_key: [SimpleNamespace(text="api-doc")],
        )
        _register_module(
            monkeypatch,
            "unstructured.partition.docx",
            partition_docx=lambda filename: [SimpleNamespace(text="docx-doc")],
        )
        _register_module(
            monkeypatch,
            "unstructured.chunking.title",
            chunk_by_title=lambda elements, max_characters, combine_text_under_n_chars: [
                SimpleNamespace(text="chunk-1"),
                SimpleNamespace(text="chunk-2"),
            ],
        )

    def test_word_extractor_rejects_doc_on_old_unstructured_version(self, monkeypatch):
        self._install_doc_modules(monkeypatch, version="0.4.10", filetype_value="doc")

        with pytest.raises(ValueError, match="Partitioning .doc files is only supported"):
            UnstructuredWordExtractor("/tmp/file.doc", "https://u", "k").extract()

    def test_word_extractor_doc_and_docx_paths(self, monkeypatch):
        self._install_doc_modules(monkeypatch, version="0.4.11", filetype_value="doc")

        docs = UnstructuredWordExtractor("/tmp/file.doc", "https://u", "k").extract()
        assert [doc.page_content for doc in docs] == ["chunk-1", "chunk-2"]

        self._install_doc_modules(monkeypatch, version="0.5.0", filetype_value="not-doc")
        docs = UnstructuredWordExtractor("/tmp/file.docx", "https://u", "k").extract()
        assert [doc.page_content for doc in docs] == ["chunk-1", "chunk-2"]

    def test_word_extractor_magic_import_error_fallback_to_extension(self, monkeypatch):
        self._install_doc_modules(monkeypatch, version="0.4.10", filetype_value="not-used")
        monkeypatch.setitem(sys.modules, "magic", None)

        with pytest.raises(ValueError, match="Partitioning .doc files is only supported"):
            UnstructuredWordExtractor("/tmp/file.doc", "https://u", "k").extract()
