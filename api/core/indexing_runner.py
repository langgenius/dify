import concurrent.futures
import datetime
import json
import logging
import re
import threading
import time
import uuid
from typing import Optional, cast

from flask import Flask, current_app
from flask_login import current_user
from sqlalchemy.orm.exc import ObjectDeletedError

from configs import dify_config
from core.errors.error import ProviderTokenNotInitError
from core.llm_generator.llm_generator import LLMGenerator
from core.model_manager import ModelInstance, ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.rag.datasource.keyword.keyword_factory import Keyword
from core.rag.docstore.dataset_docstore import DatasetDocumentStore
from core.rag.extractor.entity.extract_setting import ExtractSetting
from core.rag.index_processor.index_processor_base import BaseIndexProcessor
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.rag.models.document import Document
from core.rag.splitter.fixed_text_splitter import (
    EnhanceRecursiveCharacterTextSplitter,
    FixedRecursiveCharacterTextSplitter,
)
from core.rag.splitter.text_splitter import TextSplitter
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from libs import helper
from models.dataset import Dataset, DatasetProcessRule, DocumentSegment
from models.dataset import Document as DatasetDocument
from models.model import UploadFile
from services.feature_service import FeatureService


class IndexingRunner:
    def __init__(self):
        self.storage = storage
        self.model_manager = ModelManager()

    def run(self, dataset_documents: list[DatasetDocument]):
        """Run the indexing process."""
        for dataset_document in dataset_documents:
            try:
                # get dataset
                dataset = Dataset.query.filter_by(id=dataset_document.dataset_id).first()

                if not dataset:
                    raise ValueError("no dataset found")

                # get the process rule
                processing_rule = (
                    db.session.query(DatasetProcessRule)
                    .filter(DatasetProcessRule.id == dataset_document.dataset_process_rule_id)
                    .first()
                )
                index_type = dataset_document.doc_form
                index_processor = IndexProcessorFactory(index_type).init_index_processor()
                # extract
                text_docs = self._extract(index_processor, dataset_document, processing_rule.to_dict())

                # transform
                documents = self._transform(
                    index_processor, dataset, text_docs, dataset_document.doc_language, processing_rule.to_dict()
                )
                # save segment
                self._load_segments(dataset, dataset_document, documents)

                # load
                self._load(
                    index_processor=index_processor,
                    dataset=dataset,
                    dataset_document=dataset_document,
                    documents=documents,
                )
            except DocumentIsPausedError:
                raise DocumentIsPausedError("Document paused, document id: {}".format(dataset_document.id))
            except ProviderTokenNotInitError as e:
                dataset_document.indexing_status = "error"
                dataset_document.error = str(e.description)
                dataset_document.stopped_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
                db.session.commit()
            except ObjectDeletedError:
                logging.warning("Document deleted, document id: {}".format(dataset_document.id))
            except Exception as e:
                logging.exception("consume document failed")
                dataset_document.indexing_status = "error"
                dataset_document.error = str(e)
                dataset_document.stopped_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
                db.session.commit()

    def run_in_splitting_status(self, dataset_document: DatasetDocument):
        """Run the indexing process when the index_status is splitting."""
        try:
            # get dataset
            dataset = Dataset.query.filter_by(id=dataset_document.dataset_id).first()

            if not dataset:
                raise ValueError("no dataset found")

            # get exist document_segment list and delete
            document_segments = DocumentSegment.query.filter_by(
                dataset_id=dataset.id, document_id=dataset_document.id
            ).all()

            for document_segment in document_segments:
                db.session.delete(document_segment)
            db.session.commit()
            # get the process rule
            processing_rule = (
                db.session.query(DatasetProcessRule)
                .filter(DatasetProcessRule.id == dataset_document.dataset_process_rule_id)
                .first()
            )

            index_type = dataset_document.doc_form
            index_processor = IndexProcessorFactory(index_type).init_index_processor()
            # extract
            text_docs = self._extract(index_processor, dataset_document, processing_rule.to_dict())

            # transform
            documents = self._transform(
                index_processor, dataset, text_docs, dataset_document.doc_language, processing_rule.to_dict()
            )
            # save segment
            self._load_segments(dataset, dataset_document, documents)

            # load
            self._load(
                index_processor=index_processor, dataset=dataset, dataset_document=dataset_document, documents=documents
            )
        except DocumentIsPausedError:
            raise DocumentIsPausedError("Document paused, document id: {}".format(dataset_document.id))
        except ProviderTokenNotInitError as e:
            dataset_document.indexing_status = "error"
            dataset_document.error = str(e.description)
            dataset_document.stopped_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
            db.session.commit()
        except Exception as e:
            logging.exception("consume document failed")
            dataset_document.indexing_status = "error"
            dataset_document.error = str(e)
            dataset_document.stopped_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
            db.session.commit()

    def run_in_indexing_status(self, dataset_document: DatasetDocument):
        """Run the indexing process when the index_status is indexing."""
        try:
            # get dataset
            dataset = Dataset.query.filter_by(id=dataset_document.dataset_id).first()

            if not dataset:
                raise ValueError("no dataset found")

            # get exist document_segment list and delete
            document_segments = DocumentSegment.query.filter_by(
                dataset_id=dataset.id, document_id=dataset_document.id
            ).all()

            documents = []
            if document_segments:
                for document_segment in document_segments:
                    # transform segment to node
                    if document_segment.status != "completed":
                        document = Document(
                            page_content=document_segment.content,
                            metadata={
                                "doc_id": document_segment.index_node_id,
                                "doc_hash": document_segment.index_node_hash,
                                "document_id": document_segment.document_id,
                                "dataset_id": document_segment.dataset_id,
                            },
                        )

                        documents.append(document)

            # build index
            # get the process rule
            processing_rule = (
                db.session.query(DatasetProcessRule)
                .filter(DatasetProcessRule.id == dataset_document.dataset_process_rule_id)
                .first()
            )

            index_type = dataset_document.doc_form
            index_processor = IndexProcessorFactory(index_type).init_index_processor()
            self._load(
                index_processor=index_processor, dataset=dataset, dataset_document=dataset_document, documents=documents
            )
        except DocumentIsPausedError:
            raise DocumentIsPausedError("Document paused, document id: {}".format(dataset_document.id))
        except ProviderTokenNotInitError as e:
            dataset_document.indexing_status = "error"
            dataset_document.error = str(e.description)
            dataset_document.stopped_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
            db.session.commit()
        except Exception as e:
            logging.exception("consume document failed")
            dataset_document.indexing_status = "error"
            dataset_document.error = str(e)
            dataset_document.stopped_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
            db.session.commit()

    def indexing_estimate(
        self,
        tenant_id: str,
        extract_settings: list[ExtractSetting],
        tmp_processing_rule: dict,
        doc_form: Optional[str] = None,
        doc_language: str = "English",
        dataset_id: Optional[str] = None,
        indexing_technique: str = "economy",
    ) -> dict:
        """
        Estimate the indexing for the document.
        """
        # check document limit
        features = FeatureService.get_features(tenant_id)
        if features.billing.enabled:
            count = len(extract_settings)
            batch_upload_limit = dify_config.BATCH_UPLOAD_LIMIT
            if count > batch_upload_limit:
                raise ValueError(f"You have reached the batch upload limit of {batch_upload_limit}.")

        embedding_model_instance = None
        if dataset_id:
            dataset = Dataset.query.filter_by(id=dataset_id).first()
            if not dataset:
                raise ValueError("Dataset not found.")
            if dataset.indexing_technique == "high_quality" or indexing_technique == "high_quality":
                if dataset.embedding_model_provider:
                    embedding_model_instance = self.model_manager.get_model_instance(
                        tenant_id=tenant_id,
                        provider=dataset.embedding_model_provider,
                        model_type=ModelType.TEXT_EMBEDDING,
                        model=dataset.embedding_model,
                    )
                else:
                    embedding_model_instance = self.model_manager.get_default_model_instance(
                        tenant_id=tenant_id,
                        model_type=ModelType.TEXT_EMBEDDING,
                    )
        else:
            if indexing_technique == "high_quality":
                embedding_model_instance = self.model_manager.get_default_model_instance(
                    tenant_id=tenant_id,
                    model_type=ModelType.TEXT_EMBEDDING,
                )
        preview_texts = []
        total_segments = 0
        index_type = doc_form
        index_processor = IndexProcessorFactory(index_type).init_index_processor()
        all_text_docs = []
        for extract_setting in extract_settings:
            # extract
            text_docs = index_processor.extract(extract_setting, process_rule_mode=tmp_processing_rule["mode"])
            all_text_docs.extend(text_docs)
            processing_rule = DatasetProcessRule(
                mode=tmp_processing_rule["mode"], rules=json.dumps(tmp_processing_rule["rules"])
            )

            # get splitter
            splitter = self._get_splitter(processing_rule, embedding_model_instance)

            # split to documents
            documents = self._split_to_documents_for_estimate(
                text_docs=text_docs, splitter=splitter, processing_rule=processing_rule
            )

            total_segments += len(documents)
            for document in documents:
                if len(preview_texts) < 5:
                    preview_texts.append(document.page_content)

        if doc_form and doc_form == "qa_model":
            if len(preview_texts) > 0:
                # qa model document
                response = LLMGenerator.generate_qa_document(
                    current_user.current_tenant_id, preview_texts[0], doc_language
                )
                document_qa_list = self.format_split_text(response)

                return {"total_segments": total_segments * 20, "qa_preview": document_qa_list, "preview": preview_texts}
        return {"total_segments": total_segments, "preview": preview_texts}

    def _extract(
        self, index_processor: BaseIndexProcessor, dataset_document: DatasetDocument, process_rule: dict
    ) -> list[Document]:
        # load file
        if dataset_document.data_source_type not in {"upload_file", "notion_import", "website_crawl"}:
            return []

        data_source_info = dataset_document.data_source_info_dict
        text_docs = []
        if dataset_document.data_source_type == "upload_file":
            if not data_source_info or "upload_file_id" not in data_source_info:
                raise ValueError("no upload file found")

            file_detail = (
                db.session.query(UploadFile).filter(UploadFile.id == data_source_info["upload_file_id"]).one_or_none()
            )

            if file_detail:
                extract_setting = ExtractSetting(
                    datasource_type="upload_file", upload_file=file_detail, document_model=dataset_document.doc_form
                )
                text_docs = index_processor.extract(extract_setting, process_rule_mode=process_rule["mode"])
        elif dataset_document.data_source_type == "notion_import":
            if (
                not data_source_info
                or "notion_workspace_id" not in data_source_info
                or "notion_page_id" not in data_source_info
            ):
                raise ValueError("no notion import info found")
            extract_setting = ExtractSetting(
                datasource_type="notion_import",
                notion_info={
                    "notion_workspace_id": data_source_info["notion_workspace_id"],
                    "notion_obj_id": data_source_info["notion_page_id"],
                    "notion_page_type": data_source_info["type"],
                    "document": dataset_document,
                    "tenant_id": dataset_document.tenant_id,
                },
                document_model=dataset_document.doc_form,
            )
            text_docs = index_processor.extract(extract_setting, process_rule_mode=process_rule["mode"])
        elif dataset_document.data_source_type == "website_crawl":
            if (
                not data_source_info
                or "provider" not in data_source_info
                or "url" not in data_source_info
                or "job_id" not in data_source_info
            ):
                raise ValueError("no website import info found")
            extract_setting = ExtractSetting(
                datasource_type="website_crawl",
                website_info={
                    "provider": data_source_info["provider"],
                    "job_id": data_source_info["job_id"],
                    "tenant_id": dataset_document.tenant_id,
                    "url": data_source_info["url"],
                    "mode": data_source_info["mode"],
                    "only_main_content": data_source_info["only_main_content"],
                },
                document_model=dataset_document.doc_form,
            )
            text_docs = index_processor.extract(extract_setting, process_rule_mode=process_rule["mode"])
        # update document status to splitting
        self._update_document_index_status(
            document_id=dataset_document.id,
            after_indexing_status="splitting",
            extra_update_params={
                DatasetDocument.word_count: sum(len(text_doc.page_content) for text_doc in text_docs),
                DatasetDocument.parsing_completed_at: datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None),
            },
        )

        # replace doc id to document model id
        text_docs = cast(list[Document], text_docs)
        for text_doc in text_docs:
            text_doc.metadata["document_id"] = dataset_document.id
            text_doc.metadata["dataset_id"] = dataset_document.dataset_id

        return text_docs

    @staticmethod
    def filter_string(text):
        text = re.sub(r"<\|", "<", text)
        text = re.sub(r"\|>", ">", text)
        text = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\xEF\xBF\xBE]", "", text)
        # Unicode  U+FFFE
        text = re.sub("\ufffe", "", text)
        return text

    @staticmethod
    def _get_splitter(
        processing_rule: DatasetProcessRule, embedding_model_instance: Optional[ModelInstance]
    ) -> TextSplitter:
        """
        Get the NodeParser object according to the processing rule.
        """
        if processing_rule.mode == "custom":
            # The user-defined segmentation rule
            rules = json.loads(processing_rule.rules)
            segmentation = rules["segmentation"]
            max_segmentation_tokens_length = dify_config.INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH
            if segmentation["max_tokens"] < 50 or segmentation["max_tokens"] > max_segmentation_tokens_length:
                raise ValueError(f"Custom segment length should be between 50 and {max_segmentation_tokens_length}.")

            separator = segmentation["separator"]
            if separator:
                separator = separator.replace("\\n", "\n")

            if segmentation.get("chunk_overlap"):
                chunk_overlap = segmentation["chunk_overlap"]
            else:
                chunk_overlap = 0

            character_splitter = FixedRecursiveCharacterTextSplitter.from_encoder(
                chunk_size=segmentation["max_tokens"],
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

        return character_splitter

    def _step_split(
        self,
        text_docs: list[Document],
        splitter: TextSplitter,
        dataset: Dataset,
        dataset_document: DatasetDocument,
        processing_rule: DatasetProcessRule,
    ) -> list[Document]:
        """
        Split the text documents into documents and save them to the document segment.
        """
        documents = self._split_to_documents(
            text_docs=text_docs,
            splitter=splitter,
            processing_rule=processing_rule,
            tenant_id=dataset.tenant_id,
            document_form=dataset_document.doc_form,
            document_language=dataset_document.doc_language,
        )

        # save node to document segment
        doc_store = DatasetDocumentStore(
            dataset=dataset, user_id=dataset_document.created_by, document_id=dataset_document.id
        )

        # add document segments
        doc_store.add_documents(documents)

        # update document status to indexing
        cur_time = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
        self._update_document_index_status(
            document_id=dataset_document.id,
            after_indexing_status="indexing",
            extra_update_params={
                DatasetDocument.cleaning_completed_at: cur_time,
                DatasetDocument.splitting_completed_at: cur_time,
            },
        )

        # update segment status to indexing
        self._update_segments_by_document(
            dataset_document_id=dataset_document.id,
            update_params={
                DocumentSegment.status: "indexing",
                DocumentSegment.indexing_at: datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None),
            },
        )

        return documents

    def _split_to_documents(
        self,
        text_docs: list[Document],
        splitter: TextSplitter,
        processing_rule: DatasetProcessRule,
        tenant_id: str,
        document_form: str,
        document_language: str,
    ) -> list[Document]:
        """
        Split the text documents into nodes.
        """
        all_documents = []
        all_qa_documents = []
        for text_doc in text_docs:
            # document clean
            document_text = self._document_clean(text_doc.page_content, processing_rule)
            text_doc.page_content = document_text

            # parse document to nodes
            documents = splitter.split_documents([text_doc])
            split_documents = []
            for document_node in documents:
                if document_node.page_content.strip():
                    doc_id = str(uuid.uuid4())
                    hash = helper.generate_text_hash(document_node.page_content)
                    document_node.metadata["doc_id"] = doc_id
                    document_node.metadata["doc_hash"] = hash
                    # delete Splitter character
                    page_content = document_node.page_content
                    if page_content.startswith(".") or page_content.startswith("。"):
                        page_content = page_content[1:]
                    else:
                        page_content = page_content
                    document_node.page_content = page_content

                    if document_node.page_content:
                        split_documents.append(document_node)
            all_documents.extend(split_documents)
        # processing qa document
        if document_form == "qa_model":
            for i in range(0, len(all_documents), 10):
                threads = []
                sub_documents = all_documents[i : i + 10]
                for doc in sub_documents:
                    document_format_thread = threading.Thread(
                        target=self.format_qa_document,
                        kwargs={
                            "flask_app": current_app._get_current_object(),
                            "tenant_id": tenant_id,
                            "document_node": doc,
                            "all_qa_documents": all_qa_documents,
                            "document_language": document_language,
                        },
                    )
                    threads.append(document_format_thread)
                    document_format_thread.start()
                for thread in threads:
                    thread.join()
            return all_qa_documents
        return all_documents

    def format_qa_document(self, flask_app: Flask, tenant_id: str, document_node, all_qa_documents, document_language):
        format_documents = []
        if document_node.page_content is None or not document_node.page_content.strip():
            return
        with flask_app.app_context():
            try:
                # qa model document
                response = LLMGenerator.generate_qa_document(tenant_id, document_node.page_content, document_language)
                document_qa_list = self.format_split_text(response)
                qa_documents = []
                for result in document_qa_list:
                    qa_document = Document(
                        page_content=result["question"], metadata=document_node.metadata.model_copy()
                    )
                    doc_id = str(uuid.uuid4())
                    hash = helper.generate_text_hash(result["question"])
                    qa_document.metadata["answer"] = result["answer"]
                    qa_document.metadata["doc_id"] = doc_id
                    qa_document.metadata["doc_hash"] = hash
                    qa_documents.append(qa_document)
                format_documents.extend(qa_documents)
            except Exception as e:
                logging.exception(e)

            all_qa_documents.extend(format_documents)

    def _split_to_documents_for_estimate(
        self, text_docs: list[Document], splitter: TextSplitter, processing_rule: DatasetProcessRule
    ) -> list[Document]:
        """
        Split the text documents into nodes.
        """
        all_documents = []
        for text_doc in text_docs:
            # document clean
            document_text = self._document_clean(text_doc.page_content, processing_rule)
            text_doc.page_content = document_text

            # parse document to nodes
            documents = splitter.split_documents([text_doc])

            split_documents = []
            for document in documents:
                if document.page_content is None or not document.page_content.strip():
                    continue
                doc_id = str(uuid.uuid4())
                hash = helper.generate_text_hash(document.page_content)

                document.metadata["doc_id"] = doc_id
                document.metadata["doc_hash"] = hash

                split_documents.append(document)

            all_documents.extend(split_documents)

        return all_documents

    @staticmethod
    def _document_clean(text: str, processing_rule: DatasetProcessRule) -> str:
        """
        Clean the document text according to the processing rules.
        """
        if processing_rule.mode == "automatic":
            rules = DatasetProcessRule.AUTOMATIC_RULES
        else:
            rules = json.loads(processing_rule.rules) if processing_rule.rules else {}

        if "pre_processing_rules" in rules:
            pre_processing_rules = rules["pre_processing_rules"]
            for pre_processing_rule in pre_processing_rules:
                if pre_processing_rule["id"] == "remove_extra_spaces" and pre_processing_rule["enabled"] is True:
                    # Remove extra spaces
                    pattern = r"\n{3,}"
                    text = re.sub(pattern, "\n\n", text)
                    pattern = r"[\t\f\r\x20\u00a0\u1680\u180e\u2000-\u200a\u202f\u205f\u3000]{2,}"
                    text = re.sub(pattern, " ", text)
                elif pre_processing_rule["id"] == "remove_urls_emails" and pre_processing_rule["enabled"] is True:
                    # Remove email
                    pattern = r"([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)"
                    text = re.sub(pattern, "", text)

                    # Remove URL
                    pattern = r"https?://[^\s]+"
                    text = re.sub(pattern, "", text)

        return text

    @staticmethod
    def format_split_text(text):
        regex = r"Q\d+:\s*(.*?)\s*A\d+:\s*([\s\S]*?)(?=Q\d+:|$)"
        matches = re.findall(regex, text, re.UNICODE)

        return [{"question": q, "answer": re.sub(r"\n\s*", "\n", a.strip())} for q, a in matches if q and a]

    def _load(
        self,
        index_processor: BaseIndexProcessor,
        dataset: Dataset,
        dataset_document: DatasetDocument,
        documents: list[Document],
    ) -> None:
        """
        insert index and update document/segment status to completed
        """

        embedding_model_instance = None
        if dataset.indexing_technique == "high_quality":
            embedding_model_instance = self.model_manager.get_model_instance(
                tenant_id=dataset.tenant_id,
                provider=dataset.embedding_model_provider,
                model_type=ModelType.TEXT_EMBEDDING,
                model=dataset.embedding_model,
            )

        # chunk nodes by chunk size
        indexing_start_at = time.perf_counter()
        tokens = 0
        chunk_size = 10

        # create keyword index
        create_keyword_thread = threading.Thread(
            target=self._process_keyword_index,
            args=(current_app._get_current_object(), dataset.id, dataset_document.id, documents),
        )
        create_keyword_thread.start()
        if dataset.indexing_technique == "high_quality":
            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
                futures = []
                for i in range(0, len(documents), chunk_size):
                    chunk_documents = documents[i : i + chunk_size]
                    futures.append(
                        executor.submit(
                            self._process_chunk,
                            current_app._get_current_object(),
                            index_processor,
                            chunk_documents,
                            dataset,
                            dataset_document,
                            embedding_model_instance,
                        )
                    )

                for future in futures:
                    tokens += future.result()

        create_keyword_thread.join()
        indexing_end_at = time.perf_counter()

        # update document status to completed
        self._update_document_index_status(
            document_id=dataset_document.id,
            after_indexing_status="completed",
            extra_update_params={
                DatasetDocument.tokens: tokens,
                DatasetDocument.completed_at: datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None),
                DatasetDocument.indexing_latency: indexing_end_at - indexing_start_at,
                DatasetDocument.error: None,
            },
        )

    @staticmethod
    def _process_keyword_index(flask_app, dataset_id, document_id, documents):
        with flask_app.app_context():
            dataset = Dataset.query.filter_by(id=dataset_id).first()
            if not dataset:
                raise ValueError("no dataset found")
            keyword = Keyword(dataset)
            keyword.create(documents)
            if dataset.indexing_technique != "high_quality":
                document_ids = [document.metadata["doc_id"] for document in documents]
                db.session.query(DocumentSegment).filter(
                    DocumentSegment.document_id == document_id,
                    DocumentSegment.dataset_id == dataset_id,
                    DocumentSegment.index_node_id.in_(document_ids),
                    DocumentSegment.status == "indexing",
                ).update(
                    {
                        DocumentSegment.status: "completed",
                        DocumentSegment.enabled: True,
                        DocumentSegment.completed_at: datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None),
                    }
                )

                db.session.commit()

    def _process_chunk(
        self, flask_app, index_processor, chunk_documents, dataset, dataset_document, embedding_model_instance
    ):
        with flask_app.app_context():
            # check document is paused
            self._check_document_paused_status(dataset_document.id)

            tokens = 0
            if embedding_model_instance:
                tokens += sum(
                    embedding_model_instance.get_text_embedding_num_tokens([document.page_content])
                    for document in chunk_documents
                )

            # load index
            index_processor.load(dataset, chunk_documents, with_keywords=False)

            document_ids = [document.metadata["doc_id"] for document in chunk_documents]
            db.session.query(DocumentSegment).filter(
                DocumentSegment.document_id == dataset_document.id,
                DocumentSegment.dataset_id == dataset.id,
                DocumentSegment.index_node_id.in_(document_ids),
                DocumentSegment.status == "indexing",
            ).update(
                {
                    DocumentSegment.status: "completed",
                    DocumentSegment.enabled: True,
                    DocumentSegment.completed_at: datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None),
                }
            )

            db.session.commit()

            return tokens

    @staticmethod
    def _check_document_paused_status(document_id: str):
        indexing_cache_key = "document_{}_is_paused".format(document_id)
        result = redis_client.get(indexing_cache_key)
        if result:
            raise DocumentIsPausedError()

    @staticmethod
    def _update_document_index_status(
        document_id: str, after_indexing_status: str, extra_update_params: Optional[dict] = None
    ) -> None:
        """
        Update the document indexing status.
        """
        count = DatasetDocument.query.filter_by(id=document_id, is_paused=True).count()
        if count > 0:
            raise DocumentIsPausedError()
        document = DatasetDocument.query.filter_by(id=document_id).first()
        if not document:
            raise DocumentIsDeletedPausedError()

        update_params = {DatasetDocument.indexing_status: after_indexing_status}

        if extra_update_params:
            update_params.update(extra_update_params)

        DatasetDocument.query.filter_by(id=document_id).update(update_params)
        db.session.commit()

    @staticmethod
    def _update_segments_by_document(dataset_document_id: str, update_params: dict) -> None:
        """
        Update the document segment by document id.
        """
        DocumentSegment.query.filter_by(document_id=dataset_document_id).update(update_params)
        db.session.commit()

    @staticmethod
    def batch_add_segments(segments: list[DocumentSegment], dataset: Dataset):
        """
        Batch add segments index processing
        """
        documents = []
        for segment in segments:
            document = Document(
                page_content=segment.content,
                metadata={
                    "doc_id": segment.index_node_id,
                    "doc_hash": segment.index_node_hash,
                    "document_id": segment.document_id,
                    "dataset_id": segment.dataset_id,
                },
            )
            documents.append(document)
        # save vector index
        index_type = dataset.doc_form
        index_processor = IndexProcessorFactory(index_type).init_index_processor()
        index_processor.load(dataset, documents)

    def _transform(
        self,
        index_processor: BaseIndexProcessor,
        dataset: Dataset,
        text_docs: list[Document],
        doc_language: str,
        process_rule: dict,
    ) -> list[Document]:
        # get embedding model instance
        embedding_model_instance = None
        if dataset.indexing_technique == "high_quality":
            if dataset.embedding_model_provider:
                embedding_model_instance = self.model_manager.get_model_instance(
                    tenant_id=dataset.tenant_id,
                    provider=dataset.embedding_model_provider,
                    model_type=ModelType.TEXT_EMBEDDING,
                    model=dataset.embedding_model,
                )
            else:
                embedding_model_instance = self.model_manager.get_default_model_instance(
                    tenant_id=dataset.tenant_id,
                    model_type=ModelType.TEXT_EMBEDDING,
                )

        documents = index_processor.transform(
            text_docs,
            embedding_model_instance=embedding_model_instance,
            process_rule=process_rule,
            tenant_id=dataset.tenant_id,
            doc_language=doc_language,
        )

        return documents

    def _load_segments(self, dataset, dataset_document, documents):
        # save node to document segment
        doc_store = DatasetDocumentStore(
            dataset=dataset, user_id=dataset_document.created_by, document_id=dataset_document.id
        )

        # add document segments
        doc_store.add_documents(documents)

        # update document status to indexing
        cur_time = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
        self._update_document_index_status(
            document_id=dataset_document.id,
            after_indexing_status="indexing",
            extra_update_params={
                DatasetDocument.cleaning_completed_at: cur_time,
                DatasetDocument.splitting_completed_at: cur_time,
            },
        )

        # update segment status to indexing
        self._update_segments_by_document(
            dataset_document_id=dataset_document.id,
            update_params={
                DocumentSegment.status: "indexing",
                DocumentSegment.indexing_at: datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None),
            },
        )
        pass


class DocumentIsPausedError(Exception):
    pass


class DocumentIsDeletedPausedError(Exception):
    pass
