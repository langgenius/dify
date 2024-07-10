"""Abstract interface for document loader implementations."""
import datetime
import mimetypes
import os
import tempfile
import uuid
from urllib.parse import urlparse

import requests
from docx import Document as DocxDocument
from flask import current_app

from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.model import UploadFile


class WordExtractor(BaseExtractor):
    """Load docx files.


    Args:
        file_path: Path to the file to load.
    """

    def __init__(self, file_path: str, tenant_id: str, user_id: str):
        """Initialize with file path."""
        self.file_path = file_path
        self.tenant_id = tenant_id
        self.user_id = user_id

        if "~" in self.file_path:
            self.file_path = os.path.expanduser(self.file_path)

        # If the file is a web path, download it to a temporary file, and use that
        if not os.path.isfile(self.file_path) and self._is_valid_url(self.file_path):
            r = requests.get(self.file_path)

            if r.status_code != 200:
                raise ValueError(
                    f"Check the url of your file; returned status code {r.status_code}"
                )

            self.web_path = self.file_path
            self.temp_file = tempfile.NamedTemporaryFile()
            self.temp_file.write(r.content)
            self.file_path = self.temp_file.name
        elif not os.path.isfile(self.file_path):
            raise ValueError(f"File path {self.file_path} is not a valid file or url")

    def __del__(self) -> None:
        if hasattr(self, "temp_file"):
            self.temp_file.close()

    def extract(self) -> list[Document]:
        """Load given path as single page."""
        content = self.parse_docx(self.file_path, 'storage')
        return [Document(
            page_content=content,
            metadata={"source": self.file_path},
        )]

    @staticmethod
    def _is_valid_url(url: str) -> bool:
        """Check if the url is valid."""
        parsed = urlparse(url)
        return bool(parsed.netloc) and bool(parsed.scheme)

    def _extract_images_from_docx(self, doc, image_folder):
        os.makedirs(image_folder, exist_ok=True)
        image_count = 0
        image_map = {}

        for rel in doc.part.rels.values():
            if "image" in rel.target_ref:
                image_count += 1
                if rel.is_external:
                    url = rel.reltype
                    response = requests.get(url, stream=True)
                    if response.status_code == 200:
                        image_ext = mimetypes.guess_extension(response.headers['Content-Type'])
                        file_uuid = str(uuid.uuid4())
                        file_key = 'image_files/' + self.tenant_id + '/' + file_uuid + '.' + image_ext
                        mime_type, _ = mimetypes.guess_type(file_key)
                        storage.save(file_key, response.content)
                    else:
                        continue
                else:
                    image_ext = rel.target_ref.split('.')[-1]
                    # user uuid as file name
                    file_uuid = str(uuid.uuid4())
                    file_key = 'image_files/' + self.tenant_id + '/' + file_uuid + '.' + image_ext
                    mime_type, _ = mimetypes.guess_type(file_key)

                    storage.save(file_key, rel.target_part.blob)
                # save file to db
                config = current_app.config
                upload_file = UploadFile(
                    tenant_id=self.tenant_id,
                    storage_type=config['STORAGE_TYPE'],
                    key=file_key,
                    name=file_key,
                    size=0,
                    extension=image_ext,
                    mime_type=mime_type,
                    created_by=self.user_id,
                    created_at=datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None),
                    used=True,
                    used_by=self.user_id,
                    used_at=datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
                )

                db.session.add(upload_file)
                db.session.commit()
                image_map[rel.target_part] = f"![image]({current_app.config.get('CONSOLE_API_URL')}/files/{upload_file.id}/image-preview)"

        return image_map

    def _table_to_markdown(self, table):
        markdown = ""
        # deal with table headers
        header_row = table.rows[0]
        headers = [cell.text for cell in header_row.cells]
        markdown += "| " + " | ".join(headers) + " |\n"
        markdown += "| " + " | ".join(["---"] * len(headers)) + " |\n"
        # deal with table rows
        for row in table.rows[1:]:
            row_cells = [cell.text for cell in row.cells]
            markdown += "| " + " | ".join(row_cells) + " |\n"

        return markdown

    def _parse_paragraph(self, paragraph, image_map):
        paragraph_content = []
        for run in paragraph.runs:
            if run.element.xpath('.//a:blip'):
                for blip in run.element.xpath('.//a:blip'):
                    embed_id = blip.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed')
                    if embed_id:
                        rel_target = run.part.rels[embed_id].target_ref
                        if rel_target in image_map:
                            paragraph_content.append(image_map[rel_target])
            if run.text.strip():
                paragraph_content.append(run.text.strip())
        return ' '.join(paragraph_content) if paragraph_content else ''

    def parse_docx(self, docx_path, image_folder):
        doc = DocxDocument(docx_path)
        os.makedirs(image_folder, exist_ok=True)

        content = []

        image_map = self._extract_images_from_docx(doc, image_folder)

        def parse_paragraph(paragraph):
            paragraph_content = []
            for run in paragraph.runs:
                if run.element.tag.endswith('r'):
                    drawing_elements = run.element.findall(
                        './/{http://schemas.openxmlformats.org/wordprocessingml/2006/main}drawing')
                    for drawing in drawing_elements:
                        blip_elements = drawing.findall(
                            './/{http://schemas.openxmlformats.org/drawingml/2006/main}blip')
                        for blip in blip_elements:
                            embed_id = blip.get(
                                '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed')
                            if embed_id:
                                image_part = doc.part.related_parts.get(embed_id)
                                if image_part in image_map:
                                    paragraph_content.append(image_map[image_part])
                if run.text.strip():
                    paragraph_content.append(run.text.strip())
            return ''.join(paragraph_content) if paragraph_content else ''

        paragraphs = doc.paragraphs.copy()
        tables = doc.tables.copy()
        for element in doc.element.body:
            if element.tag.endswith('p'):  # paragraph
                para = paragraphs.pop(0)
                parsed_paragraph = parse_paragraph(para)
                if parsed_paragraph:
                    content.append(parsed_paragraph)
            elif element.tag.endswith('tbl'):  # table
                table = tables.pop(0)
                content.append(self._table_to_markdown(table))
        return '\n'.join(content)

