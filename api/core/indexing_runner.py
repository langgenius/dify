import datetime
import json
import logging
import re
import threading
import time
import uuid
from typing import AbstractSet, Any, Collection, List, Literal, Optional, Type, Union, cast

from core.data_loader.file_extractor import FileExtractor
from core.data_loader.loader.notion import NotionLoader
from core.docstore.dataset_docstore import DatasetDocumentStore
from core.errors.error import ProviderTokenNotInitError
from core.generator.llm_generator import LLMGenerator
from core.index.index import IndexBuilder
from core.model_manager import ModelInstance, ModelManager
from core.model_runtime.entities.model_entities import ModelType, PriceType
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel
from core.model_runtime.model_providers.__base.tokenizers.gpt2_tokenzier import GPT2Tokenizer
from core.spiltter.fixed_text_splitter import EnhanceRecursiveCharacterTextSplitter, FixedRecursiveCharacterTextSplitter
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from flask import Flask, current_app
from flask_login import current_user
from langchain.schema import Document
from langchain.text_splitter import TS, TextSplitter, TokenTextSplitter
from libs import helper
from models.dataset import Dataset, DatasetProcessRule
from models.dataset import Document as DatasetDocument
from models.dataset import DocumentSegment
from models.model import UploadFile
from models.source import DataSourceBinding
from sqlalchemy.orm.exc import ObjectDeletedError


class IndexingRunner:

    def __init__(self):
        self.storage = storage
        self.model_manager = ModelManager()

    def run(self, dataset_documents: List[DatasetDocument]):
        """Run the indexing process."""
        for dataset_document in dataset_documents:
            try:
                # get dataset
                dataset = Dataset.query.filter_by(
                    id=dataset_document.dataset_id
                ).first()

                if not dataset:
                    raise ValueError("no dataset found")

                # get the process rule
                processing_rule = db.session.query(DatasetProcessRule). \
                    filter(DatasetProcessRule.id == dataset_document.dataset_process_rule_id). \
                    first()

                # load file
                text_docs = self._load_data(dataset_document, processing_rule.mode == 'automatic')

                # get embedding model instance
                embedding_model_instance = None
                if dataset.indexing_technique == 'high_quality':
                    if dataset.embedding_model_provider:
                        embedding_model_instance = self.model_manager.get_model_instance(
                            tenant_id=dataset.tenant_id,
                            provider=dataset.embedding_model_provider,
                            model_type=ModelType.TEXT_EMBEDDING,
                            model=dataset.embedding_model
                        )
                    else:
                        embedding_model_instance = self.model_manager.get_default_model_instance(
                            tenant_id=dataset.tenant_id,
                            model_type=ModelType.TEXT_EMBEDDING,
                        )

                # get splitter
                splitter = self._get_splitter(processing_rule, embedding_model_instance)

                # split to documents
                documents = self._step_split(
                    text_docs=text_docs,
                    splitter=splitter,
                    dataset=dataset,
                    dataset_document=dataset_document,
                    processing_rule=processing_rule
                )
                self._build_index(
                    dataset=dataset,
                    dataset_document=dataset_document,
                    documents=documents
                )
            except DocumentIsPausedException:
                raise DocumentIsPausedException('Document paused, document id: {}'.format(dataset_document.id))
            except ProviderTokenNotInitError as e:
                dataset_document.indexing_status = 'error'
                dataset_document.error = str(e.description)
                dataset_document.stopped_at = datetime.datetime.utcnow()
                db.session.commit()
            except ObjectDeletedError:
                logging.warning('Document deleted, document id: {}'.format(dataset_document.id))
            except Exception as e:
                logging.exception("consume document failed")
                dataset_document.indexing_status = 'error'
                dataset_document.error = str(e)
                dataset_document.stopped_at = datetime.datetime.utcnow()
                db.session.commit()

    def run_in_splitting_status(self, dataset_document: DatasetDocument):
        """Run the indexing process when the index_status is splitting."""
        try:
            # get dataset
            dataset = Dataset.query.filter_by(
                id=dataset_document.dataset_id
            ).first()

            if not dataset:
                raise ValueError("no dataset found")

            # get exist document_segment list and delete
            document_segments = DocumentSegment.query.filter_by(
                dataset_id=dataset.id,
                document_id=dataset_document.id
            ).all()

            for document_segment in document_segments:
                db.session.delete(document_segment)
            db.session.commit()
            # get the process rule
            processing_rule = db.session.query(DatasetProcessRule). \
                filter(DatasetProcessRule.id == dataset_document.dataset_process_rule_id). \
                first()

            # load file
            text_docs = self._load_data(dataset_document, processing_rule.mode == 'automatic')

            # get embedding model instance
            embedding_model_instance = None
            if dataset.indexing_technique == 'high_quality':
                if dataset.embedding_model_provider:
                    embedding_model_instance = self.model_manager.get_model_instance(
                        tenant_id=dataset.tenant_id,
                        provider=dataset.embedding_model_provider,
                        model_type=ModelType.TEXT_EMBEDDING,
                        model=dataset.embedding_model
                    )
                else:
                    embedding_model_instance = self.model_manager.get_default_model_instance(
                        tenant_id=dataset.tenant_id,
                        model_type=ModelType.TEXT_EMBEDDING,
                    )

            # get splitter
            splitter = self._get_splitter(processing_rule, embedding_model_instance)

            # split to documents
            documents = self._step_split(
                text_docs=text_docs,
                splitter=splitter,
                dataset=dataset,
                dataset_document=dataset_document,
                processing_rule=processing_rule
            )

            # build index
            self._build_index(
                dataset=dataset,
                dataset_document=dataset_document,
                documents=documents
            )
        except DocumentIsPausedException:
            raise DocumentIsPausedException('Document paused, document id: {}'.format(dataset_document.id))
        except ProviderTokenNotInitError as e:
            dataset_document.indexing_status = 'error'
            dataset_document.error = str(e.description)
            dataset_document.stopped_at = datetime.datetime.utcnow()
            db.session.commit()
        except Exception as e:
            logging.exception("consume document failed")
            dataset_document.indexing_status = 'error'
            dataset_document.error = str(e)
            dataset_document.stopped_at = datetime.datetime.utcnow()
            db.session.commit()

    def run_in_indexing_status(self, dataset_document: DatasetDocument):
        """Run the indexing process when the index_status is indexing."""
        try:
            # get dataset
            dataset = Dataset.query.filter_by(
                id=dataset_document.dataset_id
            ).first()

            if not dataset:
                raise ValueError("no dataset found")

            # get exist document_segment list and delete
            document_segments = DocumentSegment.query.filter_by(
                dataset_id=dataset.id,
                document_id=dataset_document.id
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
                            }
                        )

                        documents.append(document)

            # build index
            self._build_index(
                dataset=dataset,
                dataset_document=dataset_document,
                documents=documents
            )
        except DocumentIsPausedException:
            raise DocumentIsPausedException('Document paused, document id: {}'.format(dataset_document.id))
        except ProviderTokenNotInitError as e:
            dataset_document.indexing_status = 'error'
            dataset_document.error = str(e.description)
            dataset_document.stopped_at = datetime.datetime.utcnow()
            db.session.commit()
        except Exception as e:
            logging.exception("consume document failed")
            dataset_document.indexing_status = 'error'
            dataset_document.error = str(e)
            dataset_document.stopped_at = datetime.datetime.utcnow()
            db.session.commit()

    def file_indexing_estimate(self, tenant_id: str, file_details: List[UploadFile], tmp_processing_rule: dict,
                               doc_form: str = None, doc_language: str = 'English', dataset_id: str = None,
                               indexing_technique: str = 'economy') -> dict:
        """
        Estimate the indexing for the document.
        """
        embedding_model_instance = None
        if dataset_id:
            dataset = Dataset.query.filter_by(
                id=dataset_id
            ).first()
            if not dataset:
                raise ValueError('Dataset not found.')
            if dataset.indexing_technique == 'high_quality' or indexing_technique == 'high_quality':
                if dataset.embedding_model_provider:
                    embedding_model_instance = self.model_manager.get_model_instance(
                        tenant_id=tenant_id,
                        provider=dataset.embedding_model_provider,
                        model_type=ModelType.TEXT_EMBEDDING,
                        model=dataset.embedding_model
                    )
                else:
                    embedding_model_instance = self.model_manager.get_default_model_instance(
                        tenant_id=tenant_id,
                        model_type=ModelType.TEXT_EMBEDDING,
                    )
        else:
            if indexing_technique == 'high_quality':
                embedding_model_instance = self.model_manager.get_default_model_instance(
                    tenant_id=tenant_id,
                    model_type=ModelType.TEXT_EMBEDDING,
                )
        tokens = 0
        preview_texts = []
        total_segments = 0
        total_price = 0
        currency = 'USD'
        for file_detail in file_details:

            processing_rule = DatasetProcessRule(
                mode=tmp_processing_rule["mode"],
                rules=json.dumps(tmp_processing_rule["rules"])
            )

            # load data from file
            text_docs = FileExtractor.load(file_detail, is_automatic=processing_rule.mode == 'automatic')

            # get splitter
            splitter = self._get_splitter(processing_rule, embedding_model_instance)

            # split to documents
            documents = self._split_to_documents_for_estimate(
                text_docs=text_docs,
                splitter=splitter,
                processing_rule=processing_rule
            )

            total_segments += len(documents)

            for document in documents:
                if len(preview_texts) < 5:
                    preview_texts.append(document.page_content)
                if indexing_technique == 'high_quality' or embedding_model_instance:
                    embedding_model_type_instance = embedding_model_instance.model_type_instance
                    embedding_model_type_instance = cast(TextEmbeddingModel, embedding_model_type_instance)
                    tokens += embedding_model_type_instance.get_num_tokens(
                        model=embedding_model_instance.model,
                        credentials=embedding_model_instance.credentials,
                        texts=[self.filter_string(document.page_content)]
                    )

        if doc_form and doc_form == 'qa_model':
            model_instance = self.model_manager.get_default_model_instance(
                tenant_id=tenant_id,
                model_type=ModelType.LLM
            )

            model_type_instance = model_instance.model_type_instance
            model_type_instance = cast(LargeLanguageModel, model_type_instance)

            if len(preview_texts) > 0:
                # qa model document
                response = LLMGenerator.generate_qa_document(current_user.current_tenant_id, preview_texts[0],
                                                             doc_language)
                document_qa_list = self.format_split_text(response)
                price_info = model_type_instance.get_price(
                    model=model_instance.model,
                    credentials=model_instance.credentials,
                    price_type=PriceType.INPUT,
                    tokens=total_segments * 2000,
                )
                return {
                    "total_segments": total_segments * 20,
                    "tokens": total_segments * 2000,
                    "total_price": '{:f}'.format(price_info.total_amount),
                    "currency": price_info.currency,
                    "qa_preview": document_qa_list,
                    "preview": preview_texts
                }
        if embedding_model_instance:
            embedding_model_type_instance = cast(TextEmbeddingModel, embedding_model_instance.model_type_instance)
            embedding_price_info = embedding_model_type_instance.get_price(
                model=embedding_model_instance.model,
                credentials=embedding_model_instance.credentials,
                price_type=PriceType.INPUT,
                tokens=tokens
            )
            total_price = '{:f}'.format(embedding_price_info.total_amount)
            currency = embedding_price_info.currency
        return {
            "total_segments": total_segments,
            "tokens": tokens,
            "total_price": total_price,
            "currency": currency,
            "preview": preview_texts
        }

    def notion_indexing_estimate(self, tenant_id: str, notion_info_list: list, tmp_processing_rule: dict,
                                 doc_form: str = None, doc_language: str = 'English', dataset_id: str = None,
                                 indexing_technique: str = 'economy') -> dict:
        """
        Estimate the indexing for the document.
        """
        embedding_model_instance = None
        if dataset_id:
            dataset = Dataset.query.filter_by(
                id=dataset_id
            ).first()
            if not dataset:
                raise ValueError('Dataset not found.')
            if dataset.indexing_technique == 'high_quality' or indexing_technique == 'high_quality':
                if dataset.embedding_model_provider:
                    embedding_model_instance = self.model_manager.get_model_instance(
                        tenant_id=tenant_id,
                        provider=dataset.embedding_model_provider,
                        model_type=ModelType.TEXT_EMBEDDING,
                        model=dataset.embedding_model
                    )
                else:
                    embedding_model_instance = self.model_manager.get_default_model_instance(
                        tenant_id=tenant_id,
                        model_type=ModelType.TEXT_EMBEDDING,
                    )
        else:
            if indexing_technique == 'high_quality':
                embedding_model_instance = self.model_manager.get_default_model_instance(
                    tenant_id=tenant_id,
                    model_type=ModelType.TEXT_EMBEDDING
                )
        # load data from notion
        tokens = 0
        preview_texts = []
        total_segments = 0
        total_price = 0
        currency = 'USD'
        for notion_info in notion_info_list:
            workspace_id = notion_info['workspace_id']
            data_source_binding = DataSourceBinding.query.filter(
                db.and_(
                    DataSourceBinding.tenant_id == current_user.current_tenant_id,
                    DataSourceBinding.provider == 'notion',
                    DataSourceBinding.disabled == False,
                    DataSourceBinding.source_info['workspace_id'] == f'"{workspace_id}"'
                )
            ).first()
            if not data_source_binding:
                raise ValueError('Data source binding not found.')

            for page in notion_info['pages']:
                loader = NotionLoader(
                    notion_access_token=data_source_binding.access_token,
                    notion_workspace_id=workspace_id,
                    notion_obj_id=page['page_id'],
                    notion_page_type=page['type']
                )
                documents = loader.load()

                processing_rule = DatasetProcessRule(
                    mode=tmp_processing_rule["mode"],
                    rules=json.dumps(tmp_processing_rule["rules"])
                )

                # get splitter
                splitter = self._get_splitter(processing_rule, embedding_model_instance)

                # split to documents
                documents = self._split_to_documents_for_estimate(
                    text_docs=documents,
                    splitter=splitter,
                    processing_rule=processing_rule
                )
                total_segments += len(documents)

                embedding_model_type_instance = None
                if embedding_model_instance:
                    embedding_model_type_instance = embedding_model_instance.model_type_instance
                    embedding_model_type_instance = cast(TextEmbeddingModel, embedding_model_type_instance)

                for document in documents:
                    if len(preview_texts) < 5:
                        preview_texts.append(document.page_content)
                    if indexing_technique == 'high_quality' and embedding_model_type_instance:
                        tokens += embedding_model_type_instance.get_num_tokens(
                            model=embedding_model_instance.model,
                            credentials=embedding_model_instance.credentials,
                            texts=[document.page_content]
                        )

        if doc_form and doc_form == 'qa_model':
            model_instance = self.model_manager.get_default_model_instance(
                tenant_id=tenant_id,
                model_type=ModelType.LLM
            )

            model_type_instance = model_instance.model_type_instance
            model_type_instance = cast(LargeLanguageModel, model_type_instance)
            if len(preview_texts) > 0:
                # qa model document
                response = LLMGenerator.generate_qa_document(current_user.current_tenant_id, preview_texts[0],
                                                             doc_language)
                document_qa_list = self.format_split_text(response)

                price_info = model_type_instance.get_price(
                    model=model_instance.model,
                    credentials=model_instance.credentials,
                    price_type=PriceType.INPUT,
                    tokens=total_segments * 2000,
                )

                return {
                    "total_segments": total_segments * 20,
                    "tokens": total_segments * 2000,
                    "total_price": '{:f}'.format(price_info.total_amount),
                    "currency": price_info.currency,
                    "qa_preview": document_qa_list,
                    "preview": preview_texts
                }
        if embedding_model_instance:
            embedding_model_type_instance = embedding_model_instance.model_type_instance
            embedding_model_type_instance = cast(TextEmbeddingModel, embedding_model_type_instance)
            embedding_price_info = embedding_model_type_instance.get_price(
                model=embedding_model_instance.model,
                credentials=embedding_model_instance.credentials,
                price_type=PriceType.INPUT,
                tokens=tokens
            )
            total_price = '{:f}'.format(embedding_price_info.total_amount)
            currency = embedding_price_info.currency
        return {
            "total_segments": total_segments,
            "tokens": tokens,
            "total_price": total_price,
            "currency": currency,
            "preview": preview_texts
        }

    def _load_data(self, dataset_document: DatasetDocument, automatic: bool = False) -> List[Document]:
        # load file
        if dataset_document.data_source_type not in ["upload_file", "notion_import"]:
            return []

        data_source_info = dataset_document.data_source_info_dict
        text_docs = []
        if dataset_document.data_source_type == 'upload_file':
            if not data_source_info or 'upload_file_id' not in data_source_info:
                raise ValueError("no upload file found")

            file_detail = db.session.query(UploadFile). \
                filter(UploadFile.id == data_source_info['upload_file_id']). \
                one_or_none()

            if file_detail:
                text_docs = FileExtractor.load(file_detail, is_automatic=automatic)
        elif dataset_document.data_source_type == 'notion_import':
            loader = NotionLoader.from_document(dataset_document)
            text_docs = loader.load()

        # update document status to splitting
        self._update_document_index_status(
            document_id=dataset_document.id,
            after_indexing_status="splitting",
            extra_update_params={
                DatasetDocument.word_count: sum([len(text_doc.page_content) for text_doc in text_docs]),
                DatasetDocument.parsing_completed_at: datetime.datetime.utcnow()
            }
        )

        # replace doc id to document model id
        text_docs = cast(List[Document], text_docs)
        for text_doc in text_docs:
            # remove invalid symbol
            text_doc.page_content = self.filter_string(text_doc.page_content)
            text_doc.metadata['document_id'] = dataset_document.id
            text_doc.metadata['dataset_id'] = dataset_document.dataset_id

        return text_docs

    def filter_string(self, text):
        text = re.sub(r'<\|', '<', text)
        text = re.sub(r'\|>', '>', text)
        text = re.sub(r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\xEF\xBF\xBE]', '', text)
        # Unicode  U+FFFE
        text = re.sub(u'\uFFFE', '', text)
        return text

    def _get_splitter(self, processing_rule: DatasetProcessRule,
                      embedding_model_instance: Optional[ModelInstance]) -> TextSplitter:
        """
        Get the NodeParser object according to the processing rule.
        """
        if processing_rule.mode == "custom":
            # The user-defined segmentation rule
            rules = json.loads(processing_rule.rules)
            segmentation = rules["segmentation"]
            if segmentation["max_tokens"] < 50 or segmentation["max_tokens"] > 1000:
                raise ValueError("Custom segment length should be between 50 and 1000.")

            separator = segmentation["separator"]
            if separator:
                separator = separator.replace('\\n', '\n')

            character_splitter = FixedRecursiveCharacterTextSplitter.from_encoder(
                chunk_size=segmentation["max_tokens"],
                chunk_overlap=segmentation.get('chunk_overlap', 0),
                fixed_separator=separator,
                separators=["\n\n", "。", ".", " ", ""],
                embedding_model_instance=embedding_model_instance
            )
        else:
            # Automatic segmentation
            character_splitter = EnhanceRecursiveCharacterTextSplitter.from_encoder(
                chunk_size=DatasetProcessRule.AUTOMATIC_RULES['segmentation']['max_tokens'],
                chunk_overlap=DatasetProcessRule.AUTOMATIC_RULES['segmentation']['chunk_overlap'],
                separators=["\n\n", "。", ".", " ", ""],
                embedding_model_instance=embedding_model_instance
            )

        return character_splitter

    def _step_split(self, text_docs: List[Document], splitter: TextSplitter,
                    dataset: Dataset, dataset_document: DatasetDocument, processing_rule: DatasetProcessRule) \
            -> List[Document]:
        """
        Split the text documents into documents and save them to the document segment.
        """
        documents = self._split_to_documents(
            text_docs=text_docs,
            splitter=splitter,
            processing_rule=processing_rule,
            tenant_id=dataset.tenant_id,
            document_form=dataset_document.doc_form,
            document_language=dataset_document.doc_language
        )

        # save node to document segment
        doc_store = DatasetDocumentStore(
            dataset=dataset,
            user_id=dataset_document.created_by,
            document_id=dataset_document.id
        )

        # add document segments
        doc_store.add_documents(documents)

        # update document status to indexing
        cur_time = datetime.datetime.utcnow()
        self._update_document_index_status(
            document_id=dataset_document.id,
            after_indexing_status="indexing",
            extra_update_params={
                DatasetDocument.cleaning_completed_at: cur_time,
                DatasetDocument.splitting_completed_at: cur_time,
            }
        )

        # update segment status to indexing
        self._update_segments_by_document(
            dataset_document_id=dataset_document.id,
            update_params={
                DocumentSegment.status: "indexing",
                DocumentSegment.indexing_at: datetime.datetime.utcnow()
            }
        )

        return documents

    def _split_to_documents(self, text_docs: List[Document], splitter: TextSplitter,
                            processing_rule: DatasetProcessRule, tenant_id: str,
                            document_form: str, document_language: str) -> List[Document]:
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
                    document_node.metadata['doc_id'] = doc_id
                    document_node.metadata['doc_hash'] = hash
                    # delete Spliter character
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
        if document_form == 'qa_model':
            for i in range(0, len(all_documents), 10):
                threads = []
                sub_documents = all_documents[i:i + 10]
                for doc in sub_documents:
                    document_format_thread = threading.Thread(target=self.format_qa_document, kwargs={
                        'flask_app': current_app._get_current_object(),
                        'tenant_id': tenant_id, 'document_node': doc, 'all_qa_documents': all_qa_documents,
                        'document_language': document_language})
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
                    qa_document = Document(page_content=result['question'], metadata=document_node.metadata.copy())
                    doc_id = str(uuid.uuid4())
                    hash = helper.generate_text_hash(result['question'])
                    qa_document.metadata['answer'] = result['answer']
                    qa_document.metadata['doc_id'] = doc_id
                    qa_document.metadata['doc_hash'] = hash
                    qa_documents.append(qa_document)
                format_documents.extend(qa_documents)
            except Exception as e:
                logging.exception(e)

            all_qa_documents.extend(format_documents)

    def _split_to_documents_for_estimate(self, text_docs: List[Document], splitter: TextSplitter,
                                         processing_rule: DatasetProcessRule) -> List[Document]:
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

                document.metadata['doc_id'] = doc_id
                document.metadata['doc_hash'] = hash

                split_documents.append(document)

            all_documents.extend(split_documents)

        return all_documents

    def _document_clean(self, text: str, processing_rule: DatasetProcessRule) -> str:
        """
        Clean the document text according to the processing rules.
        """
        if processing_rule.mode == "automatic":
            rules = DatasetProcessRule.AUTOMATIC_RULES
        else:
            rules = json.loads(processing_rule.rules) if processing_rule.rules else {}

        if 'pre_processing_rules' in rules:
            pre_processing_rules = rules["pre_processing_rules"]
            for pre_processing_rule in pre_processing_rules:
                if pre_processing_rule["id"] == "remove_extra_spaces" and pre_processing_rule["enabled"] is True:
                    # Remove extra spaces
                    pattern = r'\n{3,}'
                    text = re.sub(pattern, '\n\n', text)
                    pattern = r'[\t\f\r\x20\u00a0\u1680\u180e\u2000-\u200a\u202f\u205f\u3000]{2,}'
                    text = re.sub(pattern, ' ', text)
                elif pre_processing_rule["id"] == "remove_urls_emails" and pre_processing_rule["enabled"] is True:
                    # Remove email
                    pattern = r'([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)'
                    text = re.sub(pattern, '', text)

                    # Remove URL
                    pattern = r'https?://[^\s]+'
                    text = re.sub(pattern, '', text)

        return text

    def format_split_text(self, text):
        regex = r"Q\d+:\s*(.*?)\s*A\d+:\s*([\s\S]*?)(?=Q\d+:|$)"
        matches = re.findall(regex, text, re.UNICODE)

        return [
            {
                "question": q,
                "answer": re.sub(r"\n\s*", "\n", a.strip())
            }
            for q, a in matches if q and a
        ]

    def _build_index(self, dataset: Dataset, dataset_document: DatasetDocument, documents: List[Document]) -> None:
        """
        Build the index for the document.
        """
        vector_index = IndexBuilder.get_index(dataset, 'high_quality')
        keyword_table_index = IndexBuilder.get_index(dataset, 'economy')
        embedding_model_instance = None
        if dataset.indexing_technique == 'high_quality':
            embedding_model_instance = self.model_manager.get_model_instance(
                tenant_id=dataset.tenant_id,
                provider=dataset.embedding_model_provider,
                model_type=ModelType.TEXT_EMBEDDING,
                model=dataset.embedding_model
            )

        # chunk nodes by chunk size
        indexing_start_at = time.perf_counter()
        tokens = 0
        chunk_size = 100

        embedding_model_type_instance = None
        if embedding_model_instance:
            embedding_model_type_instance = embedding_model_instance.model_type_instance
            embedding_model_type_instance = cast(TextEmbeddingModel, embedding_model_type_instance)

        for i in range(0, len(documents), chunk_size):
            # check document is paused
            self._check_document_paused_status(dataset_document.id)
            chunk_documents = documents[i:i + chunk_size]
            if dataset.indexing_technique == 'high_quality' or embedding_model_type_instance:
                tokens += sum(
                    embedding_model_type_instance.get_num_tokens(
                        embedding_model_instance.model,
                        embedding_model_instance.credentials,
                        [document.page_content]
                    )
                    for document in chunk_documents
                )

            # save vector index
            if vector_index:
                vector_index.add_texts(chunk_documents)

            # save keyword index
            keyword_table_index.add_texts(chunk_documents)

            document_ids = [document.metadata['doc_id'] for document in chunk_documents]
            db.session.query(DocumentSegment).filter(
                DocumentSegment.document_id == dataset_document.id,
                DocumentSegment.index_node_id.in_(document_ids),
                DocumentSegment.status == "indexing"
            ).update({
                DocumentSegment.status: "completed",
                DocumentSegment.enabled: True,
                DocumentSegment.completed_at: datetime.datetime.utcnow()
            })

            db.session.commit()

        indexing_end_at = time.perf_counter()

        # update document status to completed
        self._update_document_index_status(
            document_id=dataset_document.id,
            after_indexing_status="completed",
            extra_update_params={
                DatasetDocument.tokens: tokens,
                DatasetDocument.completed_at: datetime.datetime.utcnow(),
                DatasetDocument.indexing_latency: indexing_end_at - indexing_start_at,
            }
        )

    def _check_document_paused_status(self, document_id: str):
        indexing_cache_key = 'document_{}_is_paused'.format(document_id)
        result = redis_client.get(indexing_cache_key)
        if result:
            raise DocumentIsPausedException()

    def _update_document_index_status(self, document_id: str, after_indexing_status: str,
                                      extra_update_params: Optional[dict] = None) -> None:
        """
        Update the document indexing status.
        """
        count = DatasetDocument.query.filter_by(id=document_id, is_paused=True).count()
        if count > 0:
            raise DocumentIsPausedException()
        document = DatasetDocument.query.filter_by(id=document_id).first()
        if not document:
            raise DocumentIsDeletedPausedException()

        update_params = {
            DatasetDocument.indexing_status: after_indexing_status
        }

        if extra_update_params:
            update_params.update(extra_update_params)

        DatasetDocument.query.filter_by(id=document_id).update(update_params)
        db.session.commit()

    def _update_segments_by_document(self, dataset_document_id: str, update_params: dict) -> None:
        """
        Update the document segment by document id.
        """
        DocumentSegment.query.filter_by(document_id=dataset_document_id).update(update_params)
        db.session.commit()

    def batch_add_segments(self, segments: List[DocumentSegment], dataset: Dataset):
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
                }
            )
            documents.append(document)
        # save vector index
        index = IndexBuilder.get_index(dataset, 'high_quality')
        if index:
            index.add_texts(documents, duplicate_check=True)

        # save keyword index
        index = IndexBuilder.get_index(dataset, 'economy')
        if index:
            index.add_texts(documents)


class DocumentIsPausedException(Exception):
    pass


class DocumentIsDeletedPausedException(Exception):
    pass
