"""Abstract interface for document loader implementations."""

import re
from abc import ABC, abstractmethod
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Optional

from configs import dify_config
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
    def transform(self, documents: list[Document], **kwargs) -> list[Document]:
        raise NotImplementedError

    @abstractmethod
    def load(
        self,
        dataset: Dataset,
        documents: list[Document],
        multimodel_documents: list[Document] | None = None,
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

    def _get_content_files(self, document: Document) -> list[AttachmentDocument]:
        """
        Get the content files from the document.
        """
        multi_model_documents = []
        text = document.page_content
        
        # Collect all upload_file_ids including duplicates to preserve occurrence count
        upload_file_id_list = []
        
        # For data before v0.10.0
        pattern = r"/files/([a-f0-9\-]+)/image-preview(?:\?.*?)?"
        matches = re.finditer(pattern, text)
        for match in matches:
            upload_file_id = match.group(1)
            upload_file_id_list.append(upload_file_id)

        # For data after v0.10.0
        pattern = r"/files/([a-f0-9\-]+)/file-preview(?:\?.*?)?"
        matches = re.finditer(pattern, text)
        for match in matches:
            upload_file_id = match.group(1)
            upload_file_id_list.append(upload_file_id)

        # For tools directory - direct file formats (e.g., .png, .jpg, etc.)
        # Match URL including any query parameters up to common URL boundaries (space, parenthesis, quotes)
        pattern = r"/files/tools/([a-f0-9\-]+)\.([a-zA-Z0-9]+)(?:\?[^\s\)\"\']*)?"
        matches = re.finditer(pattern, text)
        for match in matches:
            upload_file_id = match.group(1)
            upload_file_id_list.append(upload_file_id)
        
        if not upload_file_id_list:
            return multi_model_documents
        
        # Get unique IDs for database query
        unique_upload_file_ids = list(set(upload_file_id_list))
        upload_files = db.session.query(UploadFile).filter(UploadFile.id.in_(unique_upload_file_ids)).all()
        
        # Create a mapping from ID to UploadFile for quick lookup
        upload_file_map = {upload_file.id: upload_file for upload_file in upload_files}
        
        # Create a Document for each occurrence (including duplicates)
        for upload_file_id in upload_file_id_list:
            upload_file = upload_file_map.get(upload_file_id)
            if upload_file:
                multi_model_documents.append(Document(
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
