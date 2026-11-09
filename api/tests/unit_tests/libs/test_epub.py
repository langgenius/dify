from pathlib import Path
from zipfile import BadZipFile, ZipFile

import pytest
from defusedxml.common import EntitiesForbidden
from unstructured.chunking.title import chunk_by_title

from libs.epub import partition_epub


def test_partition_epub_preserves_spine_order_and_title_chunking(tmp_path: Path) -> None:
    file_path = tmp_path / "book.epub"
    with ZipFile(file_path, "w") as archive:
        archive.writestr(
            "META-INF/container.xml",
            '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            '<rootfiles><rootfile full-path="OPS/book%20package.opf"/></rootfiles></container>',
        )
        archive.writestr(
            "OPS/book package.opf",
            '<package xmlns="http://www.idpf.org/2007/opf">'
            '<manifest><item id="second" href="Text/second.xhtml"/>'
            '<item id="first" href="Text/../Text/first%20chapter.xhtml#start"/>'
            '<item id="nav" href="nav.xhtml"/></manifest>'
            '<spine><itemref idref="first"/><itemref idref="second"/></spine></package>',
        )
        archive.writestr("OPS/nav.xhtml", "<html><body><p>Navigation only</p></body></html>")
        archive.writestr(
            "OPS/Text/second.xhtml", "<html><body><h1>Second chapter</h1><p>Second body.</p></body></html>"
        )
        archive.writestr(
            "OPS/Text/first chapter.xhtml", "<html><body><h1>First chapter</h1><p>First body.</p></body></html>"
        )

    elements = partition_epub(str(file_path))

    assert [str(element) for element in elements] == [
        "First chapter",
        "First body.",
        "Second chapter",
        "Second body.",
    ]
    chunks = chunk_by_title(elements, max_characters=100, combine_text_under_n_chars=0)
    assert [chunk.text for chunk in chunks] == ["First chapter\n\nFirst body.", "Second chapter\n\nSecond body."]


def test_partition_epub_rejects_missing_package_path(tmp_path: Path) -> None:
    file_path = tmp_path / "missing-package.epub"
    with ZipFile(file_path, "w") as archive:
        archive.writestr("META-INF/container.xml", "<container><rootfiles/></container>")

    with pytest.raises(ValueError, match="EPUB package path is missing"):
        partition_epub(str(file_path))


@pytest.mark.parametrize("xml_path", ["META-INF/container.xml", "package.opf"])
def test_partition_epub_rejects_xml_entities(tmp_path: Path, xml_path: str) -> None:
    file_path = tmp_path / "unsafe.epub"
    with ZipFile(file_path, "w") as archive:
        if xml_path == "package.opf":
            archive.writestr(
                "META-INF/container.xml",
                '<container><rootfiles><rootfile full-path="package.opf"/></rootfiles></container>',
            )
        archive.writestr(
            xml_path, '<!DOCTYPE container [<!ENTITY payload "expanded">]><container>&payload;</container>'
        )

    with pytest.raises(EntitiesForbidden):
        partition_epub(str(file_path))


def test_partition_epub_propagates_invalid_archive_errors(tmp_path: Path) -> None:
    file_path = tmp_path / "invalid.epub"
    file_path.write_text("not an archive", encoding="utf-8")

    with pytest.raises(BadZipFile):
        partition_epub(str(file_path))
