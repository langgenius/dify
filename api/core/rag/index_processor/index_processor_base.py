"""Abstract interface for document loader implementations."""

import cgi
import logging
import mimetypes
import os
import re
from abc import ABC, abstractmethod
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Optional
from urllib.parse import unquote, urlparse

import httpx

from configs import dify_config
from core.helper import ssrf_proxy
from core.rag.extractor.entity.extract_setting import ExtractSetting
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.models.document import AttachmentDocument, Document
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.rag.splitter.fixed_text_splitter import (
    EnhanceRecursiveCharacterTextSplitter,
    FixedRecursiveCharacterTextSplitter,
)
from core.rag.splitter.text_splitter import TextSplitter
from extensions.ext_database import db
from extensions.ext_storage import storage
from models import Account, ToolFile
from models.dataset import Dataset, DatasetProcessRule
from models.dataset import Document as DatasetDocument
from models.model import UploadFile

if TYPE_CHECKING:
    from core.model_manager import ModelInstance


class BaseIndexProcessor(ABC):
    """Interface for extract files."""

    @abstractmethod
    def extract(self, extract_setting: ExtractSetting, **kwargs) -> list[Document]:
        raise NotImplementedError

    @abstractmethod
    def transform(self, documents: list[Document], current_user: Account | None = None, **kwargs) -> list[Document]:
        raise NotImplementedError

    @abstractmethod
    def load(
        self,
        dataset: Dataset,
        documents: list[Document],
        multimodal_documents: list[AttachmentDocument] | None = None,
        with_keywords: bool = True,
        **kwargs,
    ):
        raise NotImplementedError

    @abstractmethod
    def clean(self, dataset: Dataset, node_ids: list[str] | None, with_keywords: bool = True, **kwargs):
        raise NotImplementedError

    @abstractmethod
    def index(self, dataset: Dataset, document: DatasetDocument, chunks: Any):
        raise NotImplementedError

    @abstractmethod
    def format_preview(self, chunks: Any) -> Mapping[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def retrieve(
        self,
        retrieval_method: RetrievalMethod,
        query: str,
        dataset: Dataset,
        top_k: int,
        score_threshold: float,
        reranking_model: dict,
    ) -> list[Document]:
        raise NotImplementedError

    def _get_splitter(
        self,
        processing_rule_mode: str,
        max_tokens: int,
        chunk_overlap: int,
        separator: str,
        embedding_model_instance: Optional["ModelInstance"],
    ) -> TextSplitter:
        """
        Get the NodeParser object according to the processing rule.
        """
        if processing_rule_mode in ["custom", "hierarchical"]:
            # The user-defined segmentation rule
            max_segmentation_tokens_length = dify_config.INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH
            if max_tokens < 50 or max_tokens > max_segmentation_tokens_length:
                raise ValueError(f"Custom segment length should be between 50 and {max_segmentation_tokens_length}.")

            if separator:
                separator = separator.replace("\\n", "\n")

            character_splitter = FixedRecursiveCharacterTextSplitter.from_encoder(
                chunk_size=max_tokens,
                chunk_overlap=chunk_overlap,
                fixed_separator=separator,
                separators=["\n\n", "。", ". ", " ", ""],
                embedding_model_instance=embedding_model_instance,
            )
        else:
            # Automatic segmentation
            character_splitter = EnhanceRecursiveCharacterTextSplitter.from_encoder(
                chunk_size=DatasetProcessRule.AUTOMATIC_RULES["segmentation"]["max_tokens"],
                chunk_overlap=DatasetProcessRule.AUTOMATIC_RULES["segmentation"]["chunk_overlap"],
                separators=["\n\n", "。", ". ", " ", ""],
                embedding_model_instance=embedding_model_instance,
            )

        return character_splitter  # type: ignore

    def _get_content_files(self, document: Document, current_user: Account | None = None) -> list[AttachmentDocument]:
        """
        Get the content files from the document.
        """
        multi_model_documents: list[AttachmentDocument] = []
        text = document.page_content
        images = self._extract_markdown_images(text)
        if not images:
            return multi_model_documents
        upload_file_id_list = []

        for image in images:
            # Collect all upload_file_ids including duplicates to preserve occurrence count

            # For data before v0.10.0
            pattern = r"/files/([a-f0-9\-]+)/image-preview(?:\?.*?)?"
            match = re.search(pattern, image)
            if match:
                upload_file_id = match.group(1)
                upload_file_id_list.append(upload_file_id)
                continue

            # For data after v0.10.0
            pattern = r"/files/([a-f0-9\-]+)/file-preview(?:\?.*?)?"
            match = re.search(pattern, image)
            if match:
                upload_file_id = match.group(1)
                upload_file_id_list.append(upload_file_id)
                continue

            # For tools directory - direct file formats (e.g., .png, .jpg, etc.)
            # Match URL including any query parameters up to common URL boundaries (space, parenthesis, quotes)
            pattern = r"/files/tools/([a-f0-9\-]+)\.([a-zA-Z0-9]+)(?:\?[^\s\)\"\']*)?"
            match = re.search(pattern, image)
            if match:
                if current_user:
                    tool_file_id = match.group(1)
                    upload_file_id = self._download_tool_file(tool_file_id, current_user)
                    if upload_file_id:
                        upload_file_id_list.append(upload_file_id)
                continue
            if current_user:
                upload_file_id = self._download_image(image.split(" ")[0], current_user)
                if upload_file_id:
                    upload_file_id_list.append(upload_file_id)

        if not upload_file_id_list:
            return multi_model_documents

        # Get unique IDs for database query
        unique_upload_file_ids = list(set(upload_file_id_list))
        upload_files = db.session.query(UploadFile).where(UploadFile.id.in_(unique_upload_file_ids)).all()

        # Create a mapping from ID to UploadFile for quick lookup
        upload_file_map = {upload_file.id: upload_file for upload_file in upload_files}

        # Create a Document for each occurrence (including duplicates)
        for upload_file_id in upload_file_id_list:
            upload_file = upload_file_map.get(upload_file_id)
            if upload_file:
                multi_model_documents.append(
                    AttachmentDocument(
                        page_content=upload_file.name,
                        metadata={
                            "doc_id": upload_file.id,
                            "doc_hash": "",
                            "document_id": document.metadata.get("document_id"),
                            "dataset_id": document.metadata.get("dataset_id"),
                            "doc_type": DocType.IMAGE,
                        },
                    )
                )
        return multi_model_documents

    def _extract_markdown_images(self, text: str) -> list[str]:
        """
        Extract the markdown images from the text.
        """
        pattern = r"!\[.*?\]\((.*?)\)"
        return re.findall(pattern, text)

    def _download_image(self, image_url: str, current_user: Account) -> str | None:
        """
        Download the image from the URL.
        Image size must not exceed 2MB.
        """
        from services.file_service import FileService

        MAX_IMAGE_SIZE = dify_config.ATTACHMENT_IMAGE_FILE_SIZE_LIMIT * 1024 * 1024
        DOWNLOAD_TIMEOUT = dify_config.ATTACHMENT_IMAGE_DOWNLOAD_TIMEOUT

        try:
            # Download with timeout
            response = ssrf_proxy.get(image_url, timeout=DOWNLOAD_TIMEOUT)
            response.raise_for_status()

            # Check Content-Length header if available
            content_length = response.headers.get("Content-Length")
            if content_length and int(content_length) > MAX_IMAGE_SIZE:
                logging.warning("Image from %s exceeds 2MB limit (size: %s bytes)", image_url, content_length)
                return None

            filename = None

            content_disposition = response.headers.get("content-disposition")
            if content_disposition:
                _, params = cgi.parse_header(content_disposition)
                if "filename" in params:
                    filename = params["filename"]
                    filename = unquote(filename)

            if not filename:
                parsed_url = urlparse(image_url)
                # Decode percent-encoded characters in the URL path.
                path = unquote(parsed_url.path)
                filename = os.path.basename(path)

            if not filename:
                filename = "downloaded_image_file"

            name, current_ext = os.path.splitext(filename)

            content_type = response.headers.get("content-type", "").split(";")[0].strip()

            real_ext = mimetypes.guess_extension(content_type)

            if not current_ext and real_ext or current_ext in [".php", ".jsp", ".asp", ".html"] and real_ext:
                filename = f"{name}{real_ext}"
            # Download content with size limit
            blob = b""
            for chunk in response.iter_bytes(chunk_size=8192):
                blob += chunk
                if len(blob) > MAX_IMAGE_SIZE:
                    logging.warning("Image from %s exceeds 2MB limit during download", image_url)
                    return None

            if not blob:
                logging.warning("Image from %s is empty", image_url)
                return None

            upload_file = FileService(db.engine).upload_file(
                filename=filename,
                content=blob,
                mimetype=content_type,
                user=current_user,
            )
            return upload_file.id
        except httpx.TimeoutException:
            logging.warning("Timeout downloading image from %s after %s seconds", image_url, DOWNLOAD_TIMEOUT)
            return None
        except httpx.RequestError as e:
            logging.warning("Error downloading image from %s: %s", image_url, str(e))
            return None
        except Exception:
            logging.exception("Unexpected error downloading image from %s", image_url)
            return None

    def _download_tool_file(self, tool_file_id: str, current_user: Account) -> str | None:
        """
        Download the tool file from the ID.
        """
        from services.file_service import FileService

        tool_file = db.session.query(ToolFile).where(ToolFile.id == tool_file_id).first()
        if not tool_file:
            return None
        blob = storage.load_once(tool_file.file_key)
        upload_file = FileService(db.engine).upload_file(
            filename=tool_file.name,
            content=blob,
            mimetype=tool_file.mimetype,
            user=current_user,
        )
        return upload_file.id
