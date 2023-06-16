import datetime
import json
import re
import tempfile
import time
from pathlib import Path
from typing import Optional, List

from flask_login import current_user
from langchain.text_splitter import RecursiveCharacterTextSplitter

from llama_index import SimpleDirectoryReader
from llama_index.data_structs import Node
from llama_index.data_structs.node_v2 import DocumentRelationship
from llama_index.node_parser import SimpleNodeParser, NodeParser
from llama_index.readers.file.base import DEFAULT_FILE_EXTRACTOR
from llama_index.readers.file.markdown_parser import MarkdownParser

from core.data_source.notion import NotionPageReader
from core.index.readers.xlsx_parser import XLSXParser
from core.docstore.dataset_docstore import DatesetDocumentStore
from core.index.keyword_table_index import KeywordTableIndex
from core.index.readers.html_parser import HTMLParser
from core.index.readers.markdown_parser import MarkdownParser
from core.index.readers.pdf_parser import PDFParser
from core.index.spiltter.fixed_text_splitter import FixedRecursiveCharacterTextSplitter
from core.index.vector_index import VectorIndex
from core.llm.token_calculator import TokenCalculator
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from models.dataset import Document, Dataset, DocumentSegment, DatasetProcessRule
from models.model import UploadFile
from models.source import DataSourceBinding


class IndexingRunner:

    def __init__(self, embedding_model_name: str = "text-embedding-ada-002"):
        self.storage = storage
        self.embedding_model_name = embedding_model_name

    def run(self, documents: List[Document]):
        """Run the indexing process."""
        for document in documents:
            # get dataset
            dataset = Dataset.query.filter_by(
                id=document.dataset_id
            ).first()

            if not dataset:
                raise ValueError("no dataset found")

            # load file
            text_docs = self._load_data(document)

            # get the process rule
            processing_rule = db.session.query(DatasetProcessRule). \
                filter(DatasetProcessRule.id == document.dataset_process_rule_id). \
                first()

            # get node parser for splitting
            node_parser = self._get_node_parser(processing_rule)

            # split to nodes
            nodes = self._step_split(
                text_docs=text_docs,
                node_parser=node_parser,
                dataset=dataset,
                document=document,
                processing_rule=processing_rule
            )

            # build index
            self._build_index(
                dataset=dataset,
                document=document,
                nodes=nodes
            )

    def run_in_splitting_status(self, document: Document):
        """Run the indexing process when the index_status is splitting."""
        # get dataset
        dataset = Dataset.query.filter_by(
            id=document.dataset_id
        ).first()

        if not dataset:
            raise ValueError("no dataset found")

        # get exist document_segment list and delete
        document_segments = DocumentSegment.query.filter_by(
            dataset_id=dataset.id,
            document_id=document.id
        ).all()
        db.session.delete(document_segments)
        db.session.commit()
        # load file
        text_docs = self._load_data(document)

        # get the process rule
        processing_rule = db.session.query(DatasetProcessRule). \
            filter(DatasetProcessRule.id == document.dataset_process_rule_id). \
            first()

        # get node parser for splitting
        node_parser = self._get_node_parser(processing_rule)

        # split to nodes
        nodes = self._step_split(
            text_docs=text_docs,
            node_parser=node_parser,
            dataset=dataset,
            document=document,
            processing_rule=processing_rule
        )

        # build index
        self._build_index(
            dataset=dataset,
            document=document,
            nodes=nodes
        )

    def run_in_indexing_status(self, document: Document):
        """Run the indexing process when the index_status is indexing."""
        # get dataset
        dataset = Dataset.query.filter_by(
            id=document.dataset_id
        ).first()

        if not dataset:
            raise ValueError("no dataset found")

        # get exist document_segment list and delete
        document_segments = DocumentSegment.query.filter_by(
            dataset_id=dataset.id,
            document_id=document.id
        ).all()
        nodes = []
        if document_segments:
            for document_segment in document_segments:
                # transform segment to node
                if document_segment.status != "completed":
                    relationships = {
                        DocumentRelationship.SOURCE: document_segment.document_id,
                    }

                    previous_segment = document_segment.previous_segment
                    if previous_segment:
                        relationships[DocumentRelationship.PREVIOUS] = previous_segment.index_node_id

                    next_segment = document_segment.next_segment
                    if next_segment:
                        relationships[DocumentRelationship.NEXT] = next_segment.index_node_id
                    node = Node(
                        doc_id=document_segment.index_node_id,
                        doc_hash=document_segment.index_node_hash,
                        text=document_segment.content,
                        extra_info=None,
                        node_info=None,
                        relationships=relationships
                    )
                    nodes.append(node)

        # build index
        self._build_index(
            dataset=dataset,
            document=document,
            nodes=nodes
        )

    def file_indexing_estimate(self, file_details: List[UploadFile], tmp_processing_rule: dict) -> dict:
        """
        Estimate the indexing for the document.
        """
        tokens = 0
        preview_texts = []
        total_segments = 0
        for file_detail in file_details:
            # load data from file
            text_docs = self._load_data_from_file(file_detail)

            processing_rule = DatasetProcessRule(
                mode=tmp_processing_rule["mode"],
                rules=json.dumps(tmp_processing_rule["rules"])
            )

            # get node parser for splitting
            node_parser = self._get_node_parser(processing_rule)

            # split to nodes
            nodes = self._split_to_nodes(
                text_docs=text_docs,
                node_parser=node_parser,
                processing_rule=processing_rule
            )
            total_segments += len(nodes)
            for node in nodes:
                if len(preview_texts) < 5:
                    preview_texts.append(node.get_text())

                tokens += TokenCalculator.get_num_tokens(self.embedding_model_name, node.get_text())

        return {
            "total_segments": total_segments,
            "tokens": tokens,
            "total_price": '{:f}'.format(TokenCalculator.get_token_price(self.embedding_model_name, tokens)),
            "currency": TokenCalculator.get_currency(self.embedding_model_name),
            "preview": preview_texts
        }

    def notion_indexing_estimate(self, notion_info_list: list, tmp_processing_rule: dict) -> dict:
        """
        Estimate the indexing for the document.
        """
        # load data from notion
        tokens = 0
        preview_texts = []
        total_segments = 0
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
            reader = NotionPageReader(integration_token=data_source_binding.access_token)
            for page in notion_info['pages']:
                if page['type'] == 'page':
                    page_ids = [page['page_id']]
                    documents = reader.load_data_as_documents(page_ids=page_ids)
                elif page['type'] == 'database':
                    documents = reader.load_data_as_documents(database_id=page['page_id'])
                else:
                    documents = []
                processing_rule = DatasetProcessRule(
                    mode=tmp_processing_rule["mode"],
                    rules=json.dumps(tmp_processing_rule["rules"])
                )

                # get node parser for splitting
                node_parser = self._get_node_parser(processing_rule)

                # split to nodes
                nodes = self._split_to_nodes(
                    text_docs=documents,
                    node_parser=node_parser,
                    processing_rule=processing_rule
                )
                total_segments += len(nodes)
                for node in nodes:
                    if len(preview_texts) < 5:
                        preview_texts.append(node.get_text())

                    tokens += TokenCalculator.get_num_tokens(self.embedding_model_name, node.get_text())

        return {
            "total_segments": total_segments,
            "tokens": tokens,
            "total_price": '{:f}'.format(TokenCalculator.get_token_price(self.embedding_model_name, tokens)),
            "currency": TokenCalculator.get_currency(self.embedding_model_name),
            "preview": preview_texts
        }

    def _load_data(self, document: Document) -> List[Document]:
        # load file
        if document.data_source_type not in ["upload_file", "notion_import"]:
            return []

        data_source_info = document.data_source_info_dict
        text_docs = []
        if document.data_source_type == 'upload_file':
            if not data_source_info or 'upload_file_id' not in data_source_info:
                raise ValueError("no upload file found")

            file_detail = db.session.query(UploadFile). \
                filter(UploadFile.id == data_source_info['upload_file_id']). \
                one_or_none()

            text_docs = self._load_data_from_file(file_detail)
        elif document.data_source_type == 'notion_import':
            if not data_source_info or 'notion_page_id' not in data_source_info \
                    or 'notion_workspace_id' not in data_source_info:
                raise ValueError("no notion page found")
            workspace_id = data_source_info['notion_workspace_id']
            page_id = data_source_info['notion_page_id']
            page_type = data_source_info['type']
            data_source_binding = DataSourceBinding.query.filter(
                db.and_(
                    DataSourceBinding.tenant_id == document.tenant_id,
                    DataSourceBinding.provider == 'notion',
                    DataSourceBinding.disabled == False,
                    DataSourceBinding.source_info['workspace_id'] == f'"{workspace_id}"'
                )
            ).first()
            if not data_source_binding:
                raise ValueError('Data source binding not found.')
            if page_type == 'page':
                # add page last_edited_time to data_source_info
                self._get_notion_page_last_edited_time(page_id, data_source_binding.access_token, document)
                text_docs = self._load_page_data_from_notion(page_id, data_source_binding.access_token)
            elif page_type == 'database':
                # add page last_edited_time to data_source_info
                self._get_notion_database_last_edited_time(page_id, data_source_binding.access_token, document)
                text_docs = self._load_database_data_from_notion(page_id, data_source_binding.access_token)
        # update document status to splitting
        self._update_document_index_status(
            document_id=document.id,
            after_indexing_status="splitting",
            extra_update_params={
                Document.word_count: sum([len(text_doc.text) for text_doc in text_docs]),
                Document.parsing_completed_at: datetime.datetime.utcnow()
            }
        )

        # replace doc id to document model id
        for text_doc in text_docs:
            # remove invalid symbol
            text_doc.text = self.filter_string(text_doc.get_text())
            text_doc.doc_id = document.id

        return text_docs

    def filter_string(self, text):
        pattern = re.compile('[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x80-\xFF]')
        return pattern.sub('', text)

    def _load_data_from_file(self, upload_file: UploadFile) -> List[Document]:
        with tempfile.TemporaryDirectory() as temp_dir:
            suffix = Path(upload_file.key).suffix
            filepath = f"{temp_dir}/{next(tempfile._get_candidate_names())}{suffix}"
            self.storage.download(upload_file.key, filepath)

            file_extractor = DEFAULT_FILE_EXTRACTOR.copy()
            file_extractor[".markdown"] = MarkdownParser()
            file_extractor[".md"] = MarkdownParser()
            file_extractor[".html"] = HTMLParser()
            file_extractor[".htm"] = HTMLParser()
            file_extractor[".pdf"] = PDFParser({'upload_file': upload_file})
            file_extractor[".xlsx"] = XLSXParser()

            loader = SimpleDirectoryReader(input_files=[filepath], file_extractor=file_extractor)
            text_docs = loader.load_data()

            return text_docs

    def _load_page_data_from_notion(self, page_id: str, access_token: str) -> List[Document]:
        page_ids = [page_id]
        reader = NotionPageReader(integration_token=access_token)
        text_docs = reader.load_data_as_documents(page_ids=page_ids)
        return text_docs

    def _load_database_data_from_notion(self, database_id: str, access_token: str) -> List[Document]:
        reader = NotionPageReader(integration_token=access_token)
        text_docs = reader.load_data_as_documents(database_id=database_id)
        return text_docs

    def _get_notion_page_last_edited_time(self, page_id: str, access_token: str, document: Document):
        reader = NotionPageReader(integration_token=access_token)
        last_edited_time = reader.get_page_last_edited_time(page_id)
        data_source_info = document.data_source_info_dict
        data_source_info['last_edited_time'] = last_edited_time
        update_params = {
            Document.data_source_info: json.dumps(data_source_info)
        }

        Document.query.filter_by(id=document.id).update(update_params)
        db.session.commit()

    def _get_notion_database_last_edited_time(self, page_id: str, access_token: str, document: Document):
        reader = NotionPageReader(integration_token=access_token)
        last_edited_time = reader.get_database_last_edited_time(page_id)
        data_source_info = document.data_source_info_dict
        data_source_info['last_edited_time'] = last_edited_time
        update_params = {
            Document.data_source_info: json.dumps(data_source_info)
        }

        Document.query.filter_by(id=document.id).update(update_params)
        db.session.commit()

    def _get_node_parser(self, processing_rule: DatasetProcessRule) -> NodeParser:
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

            character_splitter = FixedRecursiveCharacterTextSplitter.from_tiktoken_encoder(
                chunk_size=segmentation["max_tokens"],
                chunk_overlap=0,
                fixed_separator=separator,
                separators=["\n\n", "。", ".", " ", ""]
            )
        else:
            # Automatic segmentation
            character_splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
                chunk_size=DatasetProcessRule.AUTOMATIC_RULES['segmentation']['max_tokens'],
                chunk_overlap=0,
                separators=["\n\n", "。", ".", " ", ""]
            )

        return SimpleNodeParser(text_splitter=character_splitter, include_extra_info=True)

    def _step_split(self, text_docs: List[Document], node_parser: NodeParser,
                    dataset: Dataset, document: Document, processing_rule: DatasetProcessRule) -> List[Node]:
        """
        Split the text documents into nodes and save them to the document segment.
        """
        nodes = self._split_to_nodes(
            text_docs=text_docs,
            node_parser=node_parser,
            processing_rule=processing_rule
        )

        # save node to document segment
        doc_store = DatesetDocumentStore(
            dataset=dataset,
            user_id=document.created_by,
            embedding_model_name=self.embedding_model_name,
            document_id=document.id
        )
        # add document segments
        doc_store.add_documents(nodes)

        # update document status to indexing
        cur_time = datetime.datetime.utcnow()
        self._update_document_index_status(
            document_id=document.id,
            after_indexing_status="indexing",
            extra_update_params={
                Document.cleaning_completed_at: cur_time,
                Document.splitting_completed_at: cur_time,
            }
        )

        # update segment status to indexing
        self._update_segments_by_document(
            document_id=document.id,
            update_params={
                DocumentSegment.status: "indexing",
                DocumentSegment.indexing_at: datetime.datetime.utcnow()
            }
        )

        return nodes

    def _split_to_nodes(self, text_docs: List[Document], node_parser: NodeParser,
                        processing_rule: DatasetProcessRule) -> List[Node]:
        """
        Split the text documents into nodes.
        """
        all_nodes = []
        for text_doc in text_docs:
            # document clean
            document_text = self._document_clean(text_doc.get_text(), processing_rule)
            text_doc.text = document_text

            # parse document to nodes
            nodes = node_parser.get_nodes_from_documents([text_doc])
            nodes = [node for node in nodes if node.text is not None and node.text.strip()]
            all_nodes.extend(nodes)

        return all_nodes

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

    def _build_index(self, dataset: Dataset, document: Document, nodes: List[Node]) -> None:
        """
        Build the index for the document.
        """
        vector_index = VectorIndex(dataset=dataset)
        keyword_table_index = KeywordTableIndex(dataset=dataset)

        # chunk nodes by chunk size
        indexing_start_at = time.perf_counter()
        tokens = 0
        chunk_size = 100
        for i in range(0, len(nodes), chunk_size):
            # check document is paused
            self._check_document_paused_status(document.id)
            chunk_nodes = nodes[i:i + chunk_size]

            tokens += sum(
                TokenCalculator.get_num_tokens(self.embedding_model_name, node.get_text()) for node in chunk_nodes
            )

            # save vector index
            if dataset.indexing_technique == "high_quality":
                vector_index.add_nodes(chunk_nodes)

            # save keyword index
            keyword_table_index.add_nodes(chunk_nodes)

            node_ids = [node.doc_id for node in chunk_nodes]
            db.session.query(DocumentSegment).filter(
                DocumentSegment.document_id == document.id,
                DocumentSegment.index_node_id.in_(node_ids),
                DocumentSegment.status == "indexing"
            ).update({
                DocumentSegment.status: "completed",
                DocumentSegment.completed_at: datetime.datetime.utcnow()
            })

            db.session.commit()

        indexing_end_at = time.perf_counter()

        # update document status to completed
        self._update_document_index_status(
            document_id=document.id,
            after_indexing_status="completed",
            extra_update_params={
                Document.tokens: tokens,
                Document.completed_at: datetime.datetime.utcnow(),
                Document.indexing_latency: indexing_end_at - indexing_start_at,
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
        count = Document.query.filter_by(id=document_id, is_paused=True).count()
        if count > 0:
            raise DocumentIsPausedException()

        update_params = {
            Document.indexing_status: after_indexing_status
        }

        if extra_update_params:
            update_params.update(extra_update_params)

        Document.query.filter_by(id=document_id).update(update_params)
        db.session.commit()

    def _update_segments_by_document(self, document_id: str, update_params: dict) -> None:
        """
        Update the document segment by document id.
        """
        DocumentSegment.query.filter_by(document_id=document_id).update(update_params)
        db.session.commit()


class DocumentIsPausedException(Exception):
    pass
