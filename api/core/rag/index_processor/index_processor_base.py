"""Abstract interface for document loader implementations."""
import json
from abc import ABC, abstractmethod
from typing import List, Optional

from langchain.text_splitter import TextSplitter
from werkzeug.datastructures import FileStorage

from core.model_manager import ModelInstance
from core.rag.cleaner.cleaner_base import BaseCleaner
from core.rag.extractor.entity.extract_setting import ExtractSetting
from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document
from core.splitter.fixed_text_splitter import EnhanceRecursiveCharacterTextSplitter, FixedRecursiveCharacterTextSplitter
from models.dataset import DatasetProcessRule, Dataset


class BaseIndexProcessor(ABC):
    """Interface for extract files.
    """

    def __init__(self, process_rule: dict):
        self._process_rule = process_rule

    @abstractmethod
    def extract(self, extract_setting: ExtractSetting) -> List[Document]:
        pass

    @abstractmethod
    def transform(self, documents: List[Document], **kwargs) -> List[Document]:
        pass

    @abstractmethod
    def load(self, dataset: Dataset, documents: List[Document]):
        pass

    @abstractmethod
    def retrieve(self, retrival_method: str, query: str, dataset: Dataset, top_k: int,
                 score_threshold: float, reranking_model: dict) -> List[Document]:
        pass

    def _get_splitter(self, processing_rule: dict,
                      embedding_model_instance: Optional[ModelInstance]) -> TextSplitter:
        """
        Get the NodeParser object according to the processing rule.
        """
        if processing_rule['mode'] == "custom":
            # The user-defined segmentation rule
            rules = processing_rule['rules']
            segmentation = rules["segmentation"]
            if segmentation["max_tokens"] < 50 or segmentation["max_tokens"] > 1000:
                raise ValueError("Custom segment length should be between 50 and 1000.")

            separator = segmentation["separator"]
            if separator:
                separator = separator.replace('\\n', '\n')

            character_splitter = FixedRecursiveCharacterTextSplitter.from_encoder(
                chunk_size=segmentation["max_tokens"],
                chunk_overlap=0,
                fixed_separator=separator,
                separators=["\n\n", "。", ".", " ", ""],
                embedding_model_instance=embedding_model_instance
            )
        else:
            # Automatic segmentation
            character_splitter = EnhanceRecursiveCharacterTextSplitter.from_encoder(
                chunk_size=DatasetProcessRule.AUTOMATIC_RULES['segmentation']['max_tokens'],
                chunk_overlap=0,
                separators=["\n\n", "。", ".", " ", ""],
                embedding_model_instance=embedding_model_instance
            )

        return character_splitter
