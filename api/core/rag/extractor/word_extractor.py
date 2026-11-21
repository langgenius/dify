"""Word (.docx) document extractor used for RAG ingestion.

Supports local file paths and remote URLs downloaded through the unified remote-file fetcher.
"""

import logging
import mimetypes
import os
import re
import shutil
import subprocess
import tempfile
import uuid
import xml.etree.ElementTree as ET
import zipfile
from contextlib import closing
from typing import override
from urllib.parse import urlparse

from docx import Document as DocxDocument
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph
from docx.text.run import Run
from sqlalchemy.orm import Session

from configs import dify_config
from core.file import remote_fetcher
from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document
from extensions.ext_database import db
from extensions.ext_storage import storage
from extensions.storage.storage_type import StorageType
from libs.datetime_utils import naive_utc_now
from libs.http_headers import content_type_media_type
from models.enums import CreatorUserRole
from models.model import UploadFile

logger = logging.getLogger(__name__)

_OLE2_MAGIC = bytes.fromhex("D0CF11E0A1B11AE1")


def _local_name(tag: str) -> str:
    """Return the local part of a possibly namespaced XML tag."""
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


class WordExtractor(BaseExtractor):
    """Load docx files.

    Args:
        file_path: Path to the file to load.
        session: Session used to persist extracted images.
    """

    _closed: bool
    _session: Session | None

    def __init__(self, file_path: str, tenant_id: str, user_id: str, *, session: Session | None = None):
        """Initialize from a local file or a downloadable URL.

        Downloaded files are closed before extraction can reopen them. If setup
        fails, close the response and remove any owned temporary file before
        propagating the error.
        """
        self._closed = False
        self.file_path = file_path
        self.tenant_id = tenant_id
        self.user_id = user_id
        self._session = session

        if "~" in self.file_path:
            self.file_path = os.path.expanduser(self.file_path)

        # If the file is a web path, download it to a temporary file, and use that
        if not os.path.isfile(self.file_path) and self._is_valid_url(self.file_path):
            response = remote_fetcher.make_request("GET", self.file_path)

            if response.status_code != 200:
                response.close()
                raise ValueError(f"Check the url of your file; returned status code {response.status_code}")

            self.web_path = self.file_path
            try:
                with closing(response), tempfile.NamedTemporaryFile(delete=False) as temp_file:
                    self.temp_file_path = temp_file.name
                    temp_file.write(response.content)
            except Exception:
                self.close()
                raise
            self.file_path = self.temp_file_path
        elif not os.path.isfile(self.file_path):
            raise ValueError(f"File path {self.file_path} is not a valid file or url")

    def close(self) -> None:
        """Remove an owned temporary path once, tolerating missing files.

        Local input files are never removed. Other cleanup errors are logged
        and suppressed so cleanup preserves any original extraction failure.
        """
        if getattr(self, "_closed", False):
            return

        self._closed = True
        temp_file_path = getattr(self, "temp_file_path", None)
        if temp_file_path is None:
            return

        try:
            os.unlink(temp_file_path)
        except FileNotFoundError:
            pass
        except Exception:
            logger.debug("Failed to cleanup downloaded word temp file", exc_info=True)

    def __del__(self):
        self.close()

    @override
    def extract(self) -> list[Document]:
        """Load given path as single page."""
        content = self.parse_docx(self.file_path)
        return [
            Document(
                page_content=content,
                metadata={"source": self.file_path},
            )
        ]

    @staticmethod
    def _is_valid_url(url: str) -> bool:
        """Check if the url is valid."""
        parsed = urlparse(url)
        return bool(parsed.netloc) and bool(parsed.scheme)

    def _extract_images_from_docx(self, doc):
        session = self._session or db.session
        image_count = 0
        image_map = {}
        upload_files: list[UploadFile] = []
        base_url = dify_config.FILES_URL

        for r_id, rel in doc.part.rels.items():
            if rel.reltype == RT.IMAGE:
                image_count += 1
                if rel.is_external:
                    url = rel.target_ref
                    if not self._is_valid_url(url):
                        continue
                    try:
                        response = remote_fetcher.make_request("GET", url)
                    except Exception:
                        logger.warning("Failed to download image from URL: %s", url, exc_info=True)
                        continue
                    if response.status_code == 200:
                        image_ext = mimetypes.guess_extension(
                            content_type_media_type(response.headers.get("Content-Type", ""))
                        )
                        if image_ext is None:
                            continue
                        file_uuid = str(uuid.uuid4())
                        file_key = "image_files/" + self.tenant_id + "/" + file_uuid + image_ext
                        mime_type, _ = mimetypes.guess_type(file_key)
                        storage.save(file_key, response.content)
                        # save file to db
                        upload_file = UploadFile(
                            tenant_id=self.tenant_id,
                            storage_type=StorageType(dify_config.STORAGE_TYPE),
                            key=file_key,
                            name=file_key,
                            size=0,
                            extension=str(image_ext),
                            mime_type=mime_type or "",
                            created_by=self.user_id,
                            created_by_role=CreatorUserRole.ACCOUNT,
                            created_at=naive_utc_now(),
                            used=True,
                            used_by=self.user_id,
                            used_at=naive_utc_now(),
                        )
                        upload_files.append(upload_file)
                        image_map[r_id] = f"![image]({base_url}/files/{upload_file.id}/file-preview)"
                else:
                    image_ext = rel.target_ref.split(".")[-1]
                    if image_ext is None:
                        continue
                    # user uuid as file name
                    file_uuid = str(uuid.uuid4())
                    file_key = "image_files/" + self.tenant_id + "/" + file_uuid + "." + image_ext
                    mime_type, _ = mimetypes.guess_type(file_key)

                    storage.save(file_key, rel.target_part.blob)
                    # save file to db
                    upload_file = UploadFile(
                        tenant_id=self.tenant_id,
                        storage_type=StorageType(dify_config.STORAGE_TYPE),
                        key=file_key,
                        name=file_key,
                        size=0,
                        extension=str(image_ext),
                        mime_type=mime_type or "",
                        created_by=self.user_id,
                        created_by_role=CreatorUserRole.ACCOUNT,
                        created_at=naive_utc_now(),
                        used=True,
                        used_by=self.user_id,
                        used_at=naive_utc_now(),
                    )
                    upload_files.append(upload_file)
                    image_map[rel.target_part] = f"![image]({base_url}/files/{upload_file.id}/file-preview)"
        if upload_files:
            session.add_all(upload_files)
        if self._session is None:
            session.commit()
        return image_map

    def _table_to_markdown(self, table, image_map):
        markdown = []
        # calculate the total number of columns
        total_cols = max(len(row.cells) for row in table.rows)

        header_row = table.rows[0]
        headers = self._parse_row(header_row, image_map, total_cols)
        markdown.extend(("| " + " | ".join(headers) + " |", "| " + " | ".join(["---"] * total_cols) + " |"))

        for row in table.rows[1:]:
            row_cells = self._parse_row(row, image_map, total_cols)
            markdown.append("| " + " | ".join(row_cells) + " |")
        return "\n".join(markdown)

    def _parse_row(self, row, image_map, total_cols):
        # Initialize a row, all of which are empty by default
        row_cells = [""] * total_cols
        col_index = 0
        while col_index < len(row.cells):
            # make sure the col_index is not out of range
            while col_index < len(row.cells) and row_cells[col_index] != "":
                col_index += 1
            # if col_index is out of range the loop is jumped
            if col_index >= len(row.cells):
                break
            # get the correct cell
            cell = row.cells[col_index]
            cell_content = self._parse_cell(cell, image_map).strip()
            cell_colspan = cell.grid_span or 1
            for i in range(cell_colspan):
                if col_index + i < total_cols:
                    row_cells[col_index + i] = cell_content if i == 0 else ""
            col_index += cell_colspan
        return row_cells

    def _parse_cell(self, cell, image_map):
        cell_content = []
        for paragraph in cell.paragraphs:
            parsed_paragraph = self._parse_cell_paragraph(paragraph, image_map)
            if parsed_paragraph:
                cell_content.append(parsed_paragraph)
        unique_content = list(dict.fromkeys(cell_content))
        return " ".join(unique_content)

    def _parse_cell_paragraph(self, paragraph, image_map):
        paragraph_content: list[str] = []

        for child in paragraph._element:
            tag = child.tag
            if tag == qn("w:hyperlink"):
                # Note: w:hyperlink elements may also use w:anchor for internal bookmarks.
                # This extractor intentionally only converts external links (HTTP/mailto, etc.)
                # that are backed by a relationship id (r:id) with rel.is_external == True.
                # Hyperlinks without such an external rel (including anchor-only bookmarks)
                # are left as plain text link_text.
                r_id = child.get(qn("r:id"))
                link_text_parts: list[str] = []
                for run_elem in child.findall(qn("w:r")):
                    run = Run(run_elem, paragraph)
                    if run.text:
                        link_text_parts.append(run.text)
                link_text = "".join(link_text_parts).strip()
                if r_id:
                    try:
                        rel = paragraph.part.rels.get(r_id)
                        if rel:
                            target_ref = getattr(rel, "target_ref", None)
                            if target_ref:
                                parsed_target = urlparse(str(target_ref))
                                if rel.is_external or parsed_target.scheme in ("http", "https", "mailto"):
                                    display_text = link_text or str(target_ref)
                                    link_text = f"[{display_text}]({target_ref})"
                    except Exception:
                        logger.exception("Failed to resolve URL for hyperlink with r:id: %s", r_id)
                if link_text:
                    paragraph_content.append(link_text)

            elif tag == qn("w:r"):
                run = Run(child, paragraph)
                if run.element.xpath(".//a:blip"):
                    for blip in run.element.xpath(".//a:blip"):
                        image_id = blip.get(
                            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed"
                        )
                        if not image_id:
                            continue
                        rel = paragraph.part.rels.get(image_id)
                        if rel is None:
                            continue
                        if rel.is_external:
                            if image_id in image_map:
                                paragraph_content.append(image_map[image_id])
                        else:
                            image_part = rel.target_part
                            if image_part in image_map:
                                paragraph_content.append(image_map[image_part])
                else:
                    if run.text:
                        paragraph_content.append(run.text)

        return "".join(paragraph_content).strip()

    def parse_docx(self, docx_path: str) -> str:
        """Extract the text of a .docx file as paragraphs and Markdown tables.

        Preconditions: docx_path names a readable file.
        Postconditions: returns the document text in document order. Legacy OLE2
        .doc files are converted with LibreOffice first. Packages python-docx
        cannot open fall back to reading word/document.xml directly, so Strict
        OOXML and rels-stripped packages still extract. Raises ValueError when
        the file is not a .docx package, has no word/document.xml, or is a
        legacy .doc that cannot be converted.
        """
        if self._is_legacy_doc(docx_path):
            return self._extract_legacy_doc(docx_path)

        try:
            doc = DocxDocument(docx_path)
        except Exception:
            logger.warning(
                "python-docx could not open %s; falling back to direct XML extraction",
                docx_path,
                exc_info=True,
            )
            return self._parse_docx_xml_fallback(docx_path)

        content: list[str] = []

        image_map = self._extract_images_from_docx(doc)

        def parse_paragraph(paragraph):
            def append_image_link(image_id, has_drawing, target_buffer):
                """Helper to append image link from image_map based on relationship type."""
                rel = doc.part.rels[image_id]
                if rel.is_external:
                    if image_id in image_map and not has_drawing:
                        target_buffer.append(image_map[image_id])
                else:
                    image_part = rel.target_part
                    if image_part in image_map and not has_drawing:
                        target_buffer.append(image_map[image_part])

            def process_run(run, target_buffer):
                # Helper to extract text and embedded images from a run element and append them to target_buffer
                if hasattr(run.element, "tag") and isinstance(run.element.tag, str) and run.element.tag.endswith("r"):
                    # Process drawing type images
                    drawing_elements = run.element.findall(
                        ".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}drawing"
                    )
                    has_drawing = False
                    for drawing in drawing_elements:
                        blip_elements = drawing.findall(
                            ".//{http://schemas.openxmlformats.org/drawingml/2006/main}blip"
                        )
                        for blip in blip_elements:
                            embed_id = blip.get(
                                "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed"
                            )
                            if embed_id:
                                rel = doc.part.rels.get(embed_id)
                                if rel is not None and rel.is_external:
                                    # External image: use embed_id as key
                                    if embed_id in image_map:
                                        has_drawing = True
                                        target_buffer.append(image_map[embed_id])
                                else:
                                    # Internal image: use target_part as key
                                    image_part = doc.part.related_parts.get(embed_id)
                                    if image_part in image_map:
                                        has_drawing = True
                                        target_buffer.append(image_map[image_part])
                    # Process pict type images
                    shape_elements = run.element.findall(
                        ".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}pict"
                    )
                    for shape in shape_elements:
                        # Find image data in VML
                        shape_image = shape.find(
                            ".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}binData"
                        )
                        if shape_image is not None and shape_image.text:
                            image_id = shape_image.get(
                                "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
                            )
                            if image_id and image_id in doc.part.rels:
                                append_image_link(image_id, has_drawing, target_buffer)
                        # Find imagedata element in VML
                        image_data = shape.find(".//{urn:schemas-microsoft-com:vml}imagedata")
                        if image_data is not None:
                            image_id = image_data.get("id") or image_data.get(
                                "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
                            )
                            if image_id and image_id in doc.part.rels:
                                append_image_link(image_id, has_drawing, target_buffer)
                if run.text.strip():
                    target_buffer.append(run.text.strip())

            def process_hyperlink(hyperlink_elem, target_buffer):
                # Helper to extract text from a hyperlink element and append it to target_buffer
                r_id = hyperlink_elem.get(qn("r:id"))

                # Extract text from runs inside the hyperlink
                link_text_parts = []
                for run_elem in hyperlink_elem.findall(qn("w:r")):
                    run = Run(run_elem, paragraph)
                    # Hyperlink text may be split across multiple runs (e.g., with different formatting),
                    # so collect all run texts first
                    if run.text:
                        link_text_parts.append(run.text)

                link_text = "".join(link_text_parts).strip()

                # Resolve URL
                if r_id:
                    try:
                        rel = doc.part.rels.get(r_id)
                        if rel and rel.is_external:
                            link_text = f"[{link_text or rel.target_ref}]({rel.target_ref})"
                    except Exception:
                        logger.exception("Failed to resolve URL for hyperlink with r:id: %s", r_id)

                if link_text:
                    target_buffer.append(link_text)

            paragraph_content = []
            # State for legacy HYPERLINK fields
            hyperlink_field_url = None
            hyperlink_field_text_parts: list[str] = []
            is_collecting_field_text = False
            # Iterate through paragraph elements in document order
            for child in paragraph._element:
                tag = child.tag
                if tag == qn("w:r"):
                    # Regular run
                    run = Run(child, paragraph)

                    # Check for fldChar (begin/end/separate) and instrText for legacy hyperlinks
                    fld_chars = child.findall(qn("w:fldChar"))
                    instr_texts = child.findall(qn("w:instrText"))

                    # Handle Fields
                    if fld_chars or instr_texts:
                        # Process instrText to find HYPERLINK "url"
                        for instr in instr_texts:
                            if instr.text and "HYPERLINK" in instr.text:
                                # Quick regex to extract URL
                                match = re.search(r'HYPERLINK\s+"([^"]+)"', instr.text, re.IGNORECASE)
                                if match:
                                    hyperlink_field_url = match.group(1)

                        # Process fldChar
                        for fld_char in fld_chars:
                            fld_char_type = fld_char.get(qn("w:fldCharType"))
                            if fld_char_type == "begin":
                                # Start of a field: reset legacy link state
                                hyperlink_field_url = None
                                hyperlink_field_text_parts = []
                                is_collecting_field_text = False
                            elif fld_char_type == "separate":
                                # Separator: if we found a URL, start collecting visible text
                                if hyperlink_field_url:
                                    is_collecting_field_text = True
                            elif fld_char_type == "end":
                                # End of field
                                if is_collecting_field_text and hyperlink_field_url:
                                    # Create markdown link and append to main content
                                    display_text = "".join(hyperlink_field_text_parts).strip()
                                    if display_text:
                                        link_md = f"[{display_text}]({hyperlink_field_url})"
                                        paragraph_content.append(link_md)
                                # Reset state
                                hyperlink_field_url = None
                                hyperlink_field_text_parts = []
                                is_collecting_field_text = False

                    # Decide where to append content
                    target_buffer = hyperlink_field_text_parts if is_collecting_field_text else paragraph_content
                    process_run(run, target_buffer)
                elif tag == qn("w:hyperlink"):
                    process_hyperlink(child, paragraph_content)
            return "".join(paragraph_content) if paragraph_content else ""

        for block in doc.iter_inner_content():
            match block:
                case Paragraph():
                    parsed_paragraph = parse_paragraph(block)
                    content.append(parsed_paragraph if parsed_paragraph.strip() else "\n")
                case Table():
                    content.append(self._table_to_markdown(block, image_map))
        return "\n".join(content)

    @staticmethod
    def _is_legacy_doc(docx_path: str) -> bool:
        """Return True when the file starts with the OLE2 compound-document magic.

        Preconditions: docx_path names a readable file; unreadable files return
        False so the caller reports the real open failure.
        Postconditions: True only for files whose first eight bytes are the
        OLE2 magic D0 CF 11 E0 A1 B1 1A E1.
        """
        try:
            with open(docx_path, "rb") as doc_file:
                return doc_file.read(len(_OLE2_MAGIC)) == _OLE2_MAGIC
        except OSError:
            return False

    def _extract_legacy_doc(self, docx_path: str) -> str:
        """Convert a legacy OLE2 .doc file to .docx with LibreOffice and extract it.

        Preconditions: docx_path names a file starting with the OLE2 magic.
        Postconditions: returns the extracted text of the converted document.
        Raises ValueError naming the cause when LibreOffice is not installed or
        the conversion fails or times out.
        """
        converter = shutil.which("soffice") or shutil.which("libreoffice")
        if converter is None:
            raise ValueError(
                "The file is a legacy .doc document, but LibreOffice is not installed, "
                "so it cannot be converted to .docx"
            )
        with tempfile.TemporaryDirectory(prefix="dify-word-legacy-") as tmpdir:
            try:
                result = subprocess.run(
                    [converter, "--headless", "--convert-to", "docx", "--outdir", tmpdir, docx_path],
                    capture_output=True,
                    text=True,
                    timeout=120,
                )
            except subprocess.TimeoutExpired:
                raise ValueError("LibreOffice conversion of the legacy .doc file to .docx timed out") from None
            converted_name = os.path.splitext(os.path.basename(docx_path))[0] + ".docx"
            converted_path = os.path.join(tmpdir, converted_name)
            if not os.path.isfile(converted_path):
                converted_candidates = [
                    os.path.join(tmpdir, name) for name in sorted(os.listdir(tmpdir)) if name.endswith(".docx")
                ]
                converted_path = converted_candidates[0] if converted_candidates else ""
            if result.returncode != 0 or not converted_path or not os.path.isfile(converted_path):
                raise ValueError(
                    f"LibreOffice failed to convert the legacy .doc file to .docx (exit code {result.returncode})"
                )
            return self.parse_docx(converted_path)

    def _parse_docx_xml_fallback(self, docx_path: str) -> str:
        """Extract text directly from word/document.xml without python-docx.

        Preconditions: docx_path names a .docx package python-docx could not open.
        Postconditions: returns paragraphs in document order with tables as
        Markdown, matching elements by local name so Strict and Transitional
        OOXML both work. Images are skipped: without relationships there is
        nothing to resolve them against. Raises ValueError when the file is not
        a zip archive or contains no word/document.xml.
        """
        try:
            archive = zipfile.ZipFile(docx_path)
        except zipfile.BadZipFile:
            raise ValueError(f"{docx_path} is not a valid .docx package") from None
        with archive:
            try:
                document_xml = archive.read("word/document.xml")
            except KeyError:
                raise ValueError(f"{docx_path} is not a valid .docx package: word/document.xml is missing") from None
        try:
            root = ET.fromstring(document_xml)
        except ET.ParseError:
            raise ValueError(f"{docx_path} is not a valid .docx package: word/document.xml is not valid XML") from None
        body = next(
            (child for child in root if _local_name(child.tag) == "body"),
            None,
        )
        if body is None:
            raise ValueError(f"{docx_path} is not a valid .docx package: word/document.xml has no body")
        content: list[str] = []
        for child in body:
            match _local_name(child.tag):
                case "p":
                    paragraph_text = self._fallback_paragraph_text(child)
                    content.append(paragraph_text if paragraph_text.strip() else "\n")
                case "tbl":
                    content.append(self._fallback_table_to_markdown(child))
        return "\n".join(content)

    @staticmethod
    def _fallback_paragraph_text(paragraph_element: ET.Element) -> str:
        """Join the text of every descendant w:t element, in document order.

        Preconditions: paragraph_element is a w:p element from word/document.xml.
        Postconditions: returns the paragraph text with hyperlink text included
        as plain text.
        """
        return "".join(node.text or "" for node in paragraph_element.iter() if _local_name(node.tag) == "t")

    @staticmethod
    def _fallback_cell_text(cell_element: ET.Element) -> str:
        """Join a table cell's paragraph texts with single spaces.

        Preconditions: cell_element is a w:tc element from word/document.xml.
        Postconditions: returns the cell text with empty paragraphs dropped.
        """
        texts = [
            WordExtractor._fallback_paragraph_text(child).strip()
            for child in cell_element
            if _local_name(child.tag) == "p"
        ]
        return " ".join(text for text in texts if text)

    @staticmethod
    def _fallback_table_to_markdown(table_element: ET.Element) -> str:
        """Render a w:tbl element as a Markdown table.

        Preconditions: table_element is a w:tbl element from word/document.xml.
        Postconditions: returns the table with the first row as the header, a
        separator row, and short rows padded with empty cells. Returns an empty
        string for a table with no rows.
        """
        rows = [
            [WordExtractor._fallback_cell_text(cell) for cell in row_element if _local_name(cell.tag) == "tc"]
            for row_element in table_element
            if _local_name(row_element.tag) == "tr"
        ]
        if not rows:
            return ""
        total_cols = max(len(row) for row in rows)
        padded_rows = [row + [""] * (total_cols - len(row)) for row in rows]
        markdown = [
            "| " + " | ".join(padded_rows[0]) + " |",
            "| " + " | ".join(["---"] * total_cols) + " |",
        ]
        markdown.extend("| " + " | ".join(row) + " |" for row in padded_rows[1:])
        return "\n".join(markdown)
