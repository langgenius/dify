"""Read EPUB chapters in spine order without extracting archive members to disk."""

import posixpath
from io import BytesIO
from urllib.parse import unquote, urlsplit
from zipfile import ZipFile

from defusedxml import ElementTree
from unstructured.documents.elements import Element
from unstructured.partition.html import partition_html


def partition_epub(file_path: str) -> list[Element]:
    with ZipFile(file_path) as archive:
        container = ElementTree.fromstring(archive.read("META-INF/container.xml"))
        rootfile = container.find(".//{*}rootfile")
        package_path = rootfile.get("full-path") if rootfile is not None else None
        if not package_path:
            raise ValueError("EPUB package path is missing")

        package_path = unquote(urlsplit(package_path).path).lstrip("/")
        package = ElementTree.fromstring(archive.read(package_path))
        manifest = {item.attrib["id"]: item.attrib["href"] for item in package.findall(".//{*}manifest/{*}item")}
        elements: list[Element] = []
        for itemref in package.findall(".//{*}spine/{*}itemref"):
            href = manifest[itemref.attrib["idref"]]
            chapter_path = posixpath.normpath(
                posixpath.join(posixpath.dirname(package_path), unquote(urlsplit(href).path))
            ).lstrip("/")
            with BytesIO(archive.read(chapter_path)) as chapter:
                elements.extend(partition_html(file=chapter))
        return elements
