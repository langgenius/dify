import base64
import hashlib
import hmac
import json
import logging
import os
import pickle
import re
import time
from json import JSONDecodeError

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import JSONB

from configs import dify_config
from core.rag.retrieval.retrival_methods import RetrievalMethod
from extensions.ext_database import db
from extensions.ext_storage import storage

from .account import Account
from .model import App, Tag, TagBinding, UploadFile
from .types import StringUUID


class Dataset(db.Model):
    __tablename__ = 'datasets'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='dataset_pkey'),
        db.Index('dataset_tenant_idx', 'tenant_id'),
        db.Index('retrieval_model_idx', "retrieval_model", postgresql_using='gin')
    )

    INDEXING_TECHNIQUE_LIST = ['high_quality', 'economy', None]

    id = db.Column(StringUUID, server_default=db.text('uuid_generate_v4()'))
    tenant_id = db.Column(StringUUID, nullable=False)
    name = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    provider = db.Column(db.String(255), nullable=False,
                         server_default=db.text("'vendor'::character varying"))
    permission = db.Column(db.String(255), nullable=False,
                           server_default=db.text("'only_me'::character varying"))
    data_source_type = db.Column(db.String(255))
    indexing_technique = db.Column(db.String(255), nullable=True)
    index_struct = db.Column(db.Text, nullable=True)
    created_by = db.Column(StringUUID, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False,
                           server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_by = db.Column(StringUUID, nullable=True)
    updated_at = db.Column(db.DateTime, nullable=False,
                           server_default=db.text('CURRENT_TIMESTAMP(0)'))
    embedding_model = db.Column(db.String(255), nullable=True)
    embedding_model_provider = db.Column(db.String(255), nullable=True)
    collection_binding_id = db.Column(StringUUID, nullable=True)
    retrieval_model = db.Column(JSONB, nullable=True)

    @property
    def dataset_keyword_table(self):
        dataset_keyword_table = db.session.query(DatasetKeywordTable).filter(
            DatasetKeywordTable.dataset_id == self.id).first()
        if dataset_keyword_table:
            return dataset_keyword_table

        return None

    @property
    def index_struct_dict(self):
        return json.loads(self.index_struct) if self.index_struct else None

    @property
    def created_by_account(self):
        return db.session.get(Account, self.created_by)

    @property
    def latest_process_rule(self):
        return DatasetProcessRule.query.filter(DatasetProcessRule.dataset_id == self.id) \
            .order_by(DatasetProcessRule.created_at.desc()).first()

    @property
    def app_count(self):
        return db.session.query(func.count(AppDatasetJoin.id)).filter(AppDatasetJoin.dataset_id == self.id,
                                                                      App.id == AppDatasetJoin.app_id).scalar()

    @property
    def document_count(self):
        return db.session.query(func.count(Document.id)).filter(Document.dataset_id == self.id).scalar()

    @property
    def available_document_count(self):
        return db.session.query(func.count(Document.id)).filter(
            Document.dataset_id == self.id,
            Document.indexing_status == 'completed',
            Document.enabled == True,
            Document.archived == False
        ).scalar()

    @property
    def available_segment_count(self):
        return db.session.query(func.count(DocumentSegment.id)).filter(
            DocumentSegment.dataset_id == self.id,
            DocumentSegment.status == 'completed',
            DocumentSegment.enabled == True
        ).scalar()

    @property
    def word_count(self):
        return Document.query.with_entities(func.coalesce(func.sum(Document.word_count))) \
            .filter(Document.dataset_id == self.id).scalar()

    @property
    def doc_form(self):
        document = db.session.query(Document).filter(
            Document.dataset_id == self.id).first()
        if document:
            return document.doc_form
        return None

    @property
    def retrieval_model_dict(self):
        default_retrieval_model = {
            'search_method': RetrievalMethod.SEMANTIC_SEARCH.value,
            'reranking_enable': False,
            'reranking_model': {
                'reranking_provider_name': '',
                'reranking_model_name': ''
            },
            'top_k': 2,
            'score_threshold_enabled': False
        }
        return self.retrieval_model if self.retrieval_model else default_retrieval_model

    @property
    def tags(self):
        tags = db.session.query(Tag).join(
            TagBinding,
            Tag.id == TagBinding.tag_id
        ).filter(
            TagBinding.target_id == self.id,
            TagBinding.tenant_id == self.tenant_id,
            Tag.tenant_id == self.tenant_id,
            Tag.type == 'knowledge'
        ).all()

        return tags if tags else []

    @staticmethod
    def gen_collection_name_by_id(dataset_id: str) -> str:
        normalized_dataset_id = dataset_id.replace("-", "_")
        return f'Vector_index_{normalized_dataset_id}_Node'


class DatasetProcessRule(db.Model):
    __tablename__ = 'dataset_process_rules'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='dataset_process_rule_pkey'),
        db.Index('dataset_process_rule_dataset_id_idx', 'dataset_id'),
    )

    id = db.Column(StringUUID, nullable=False,
                   server_default=db.text('uuid_generate_v4()'))
    dataset_id = db.Column(StringUUID, nullable=False)
    mode = db.Column(db.String(255), nullable=False,
                     server_default=db.text("'automatic'::character varying"))
    rules = db.Column(db.Text, nullable=True)
    created_by = db.Column(StringUUID, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False,
                           server_default=db.text('CURRENT_TIMESTAMP(0)'))

    MODES = ['automatic', 'custom']
    PRE_PROCESSING_RULES = ['remove_stopwords', 'remove_extra_spaces', 'remove_urls_emails']
    AUTOMATIC_RULES = {
        'pre_processing_rules': [
            {'id': 'remove_extra_spaces', 'enabled': True},
            {'id': 'remove_urls_emails', 'enabled': False}
        ],
        'segmentation': {
            'delimiter': '\n',
            'max_tokens': 500,
            'chunk_overlap': 50
        }
    }

    def to_dict(self):
        return {
            'id': self.id,
            'dataset_id': self.dataset_id,
            'mode': self.mode,
            'rules': self.rules_dict,
            'created_by': self.created_by,
            'created_at': self.created_at,
        }

    @property
    def rules_dict(self):
        try:
            return json.loads(self.rules) if self.rules else None
        except JSONDecodeError:
            return None


class Document(db.Model):
    __tablename__ = 'documents'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='document_pkey'),
        db.Index('document_dataset_id_idx', 'dataset_id'),
        db.Index('document_is_paused_idx', 'is_paused'),
        db.Index('document_tenant_idx', 'tenant_id'),
    )

    # initial fields
    id = db.Column(StringUUID, nullable=False,
                   server_default=db.text('uuid_generate_v4()'))
    tenant_id = db.Column(StringUUID, nullable=False)
    dataset_id = db.Column(StringUUID, nullable=False)
    position = db.Column(db.Integer, nullable=False)
    data_source_type = db.Column(db.String(255), nullable=False)
    data_source_info = db.Column(db.Text, nullable=True)
    dataset_process_rule_id = db.Column(StringUUID, nullable=True)
    batch = db.Column(db.String(255), nullable=False)
    name = db.Column(db.String(255), nullable=False)
    created_from = db.Column(db.String(255), nullable=False)
    created_by = db.Column(StringUUID, nullable=False)
    created_api_request_id = db.Column(StringUUID, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False,
                           server_default=db.text('CURRENT_TIMESTAMP(0)'))

    # start processing
    processing_started_at = db.Column(db.DateTime, nullable=True)

    # parsing
    file_id = db.Column(db.Text, nullable=True)
    word_count = db.Column(db.Integer, nullable=True)
    parsing_completed_at = db.Column(db.DateTime, nullable=True)

    # cleaning
    cleaning_completed_at = db.Column(db.DateTime, nullable=True)

    # split
    splitting_completed_at = db.Column(db.DateTime, nullable=True)

    # indexing
    tokens = db.Column(db.Integer, nullable=True)
    indexing_latency = db.Column(db.Float, nullable=True)
    completed_at = db.Column(db.DateTime, nullable=True)

    # pause
    is_paused = db.Column(db.Boolean, nullable=True, server_default=db.text('false'))
    paused_by = db.Column(StringUUID, nullable=True)
    paused_at = db.Column(db.DateTime, nullable=True)

    # error
    error = db.Column(db.Text, nullable=True)
    stopped_at = db.Column(db.DateTime, nullable=True)

    # basic fields
    indexing_status = db.Column(db.String(
        255), nullable=False, server_default=db.text("'waiting'::character varying"))
    enabled = db.Column(db.Boolean, nullable=False,
                        server_default=db.text('true'))
    disabled_at = db.Column(db.DateTime, nullable=True)
    disabled_by = db.Column(StringUUID, nullable=True)
    archived = db.Column(db.Boolean, nullable=False,
                         server_default=db.text('false'))
    archived_reason = db.Column(db.String(255), nullable=True)
    archived_by = db.Column(StringUUID, nullable=True)
    archived_at = db.Column(db.DateTime, nullable=True)
    updated_at = db.Column(db.DateTime, nullable=False,
                           server_default=db.text('CURRENT_TIMESTAMP(0)'))
    doc_type = db.Column(db.String(40), nullable=True)
    doc_metadata = db.Column(db.JSON, nullable=True)
    doc_form = db.Column(db.String(
        255), nullable=False, server_default=db.text("'text_model'::character varying"))
    doc_language = db.Column(db.String(255), nullable=True)

    DATA_SOURCES = ['upload_file', 'notion_import', 'website_crawl']

    @property
    def display_status(self):
        status = None
        if self.indexing_status == 'waiting':
            status = 'queuing'
        elif self.indexing_status not in ['completed', 'error', 'waiting'] and self.is_paused:
            status = 'paused'
        elif self.indexing_status in ['parsing', 'cleaning', 'splitting', 'indexing']:
            status = 'indexing'
        elif self.indexing_status == 'error':
            status = 'error'
        elif self.indexing_status == 'completed' and not self.archived and self.enabled:
            status = 'available'
        elif self.indexing_status == 'completed' and not self.archived and not self.enabled:
            status = 'disabled'
        elif self.indexing_status == 'completed' and self.archived:
            status = 'archived'
        return status

    @property
    def data_source_info_dict(self):
        if self.data_source_info:
            try:
                data_source_info_dict = json.loads(self.data_source_info)
            except JSONDecodeError:
                data_source_info_dict = {}

            return data_source_info_dict
        return None

    @property
    def data_source_detail_dict(self):
        if self.data_source_info:
            if self.data_source_type == 'upload_file':
                data_source_info_dict = json.loads(self.data_source_info)
                file_detail = db.session.query(UploadFile). \
                    filter(UploadFile.id == data_source_info_dict['upload_file_id']). \
                    one_or_none()
                if file_detail:
                    return {
                        'upload_file': {
                            'id': file_detail.id,
                            'name': file_detail.name,
                            'size': file_detail.size,
                            'extension': file_detail.extension,
                            'mime_type': file_detail.mime_type,
                            'created_by': file_detail.created_by,
                            'created_at': file_detail.created_at.timestamp()
                        }
                    }
            elif self.data_source_type == 'notion_import' or self.data_source_type == 'website_crawl':
                return json.loads(self.data_source_info)
        return {}

    @property
    def average_segment_length(self):
        if self.word_count and self.word_count != 0 and self.segment_count and self.segment_count != 0:
            return self.word_count // self.segment_count
        return 0

    @property
    def dataset_process_rule(self):
        if self.dataset_process_rule_id:
            return db.session.get(DatasetProcessRule, self.dataset_process_rule_id)
        return None

    @property
    def dataset(self):
        return db.session.query(Dataset).filter(Dataset.id == self.dataset_id).one_or_none()

    @property
    def segment_count(self):
        return DocumentSegment.query.filter(DocumentSegment.document_id == self.id).count()

    @property
    def hit_count(self):
        return DocumentSegment.query.with_entities(func.coalesce(func.sum(DocumentSegment.hit_count))) \
            .filter(DocumentSegment.document_id == self.id).scalar()

    def to_dict(self):
        return {
            'id': self.id,
            'tenant_id': self.tenant_id,
            'dataset_id': self.dataset_id,
            'position': self.position,
            'data_source_type': self.data_source_type,
            'data_source_info': self.data_source_info,
            'dataset_process_rule_id': self.dataset_process_rule_id,
            'batch': self.batch,
            'name': self.name,
            'created_from': self.created_from,
            'created_by': self.created_by,
            'created_api_request_id': self.created_api_request_id,
            'created_at': self.created_at,
            'processing_started_at': self.processing_started_at,
            'file_id': self.file_id,
            'word_count': self.word_count,
            'parsing_completed_at': self.parsing_completed_at,
            'cleaning_completed_at': self.cleaning_completed_at,
            'splitting_completed_at': self.splitting_completed_at,
            'tokens': self.tokens,
            'indexing_latency': self.indexing_latency,
            'completed_at': self.completed_at,
            'is_paused': self.is_paused,
            'paused_by': self.paused_by,
            'paused_at': self.paused_at,
            'error': self.error,
            'stopped_at': self.stopped_at,
            'indexing_status': self.indexing_status,
            'enabled': self.enabled,
            'disabled_at': self.disabled_at,
            'disabled_by': self.disabled_by,
            'archived': self.archived,
            'archived_reason': self.archived_reason,
            'archived_by': self.archived_by,
            'archived_at': self.archived_at,
            'updated_at': self.updated_at,
            'doc_type': self.doc_type,
            'doc_metadata': self.doc_metadata,
            'doc_form': self.doc_form,
            'doc_language': self.doc_language,
            'display_status': self.display_status,
            'data_source_info_dict': self.data_source_info_dict,
            'average_segment_length': self.average_segment_length,
            'dataset_process_rule': self.dataset_process_rule.to_dict() if self.dataset_process_rule else None,
            'dataset': self.dataset.to_dict() if self.dataset else None,
            'segment_count': self.segment_count,
            'hit_count': self.hit_count
        }

    @classmethod
    def from_dict(cls, data: dict):
        return cls(
            id=data.get('id'),
            tenant_id=data.get('tenant_id'),
            dataset_id=data.get('dataset_id'),
            position=data.get('position'),
            data_source_type=data.get('data_source_type'),
            data_source_info=data.get('data_source_info'),
            dataset_process_rule_id=data.get('dataset_process_rule_id'),
            batch=data.get('batch'),
            name=data.get('name'),
            created_from=data.get('created_from'),
            created_by=data.get('created_by'),
            created_api_request_id=data.get('created_api_request_id'),
            created_at=data.get('created_at'),
            processing_started_at=data.get('processing_started_at'),
            file_id=data.get('file_id'),
            word_count=data.get('word_count'),
            parsing_completed_at=data.get('parsing_completed_at'),
            cleaning_completed_at=data.get('cleaning_completed_at'),
            splitting_completed_at=data.get('splitting_completed_at'),
            tokens=data.get('tokens'),
            indexing_latency=data.get('indexing_latency'),
            completed_at=data.get('completed_at'),
            is_paused=data.get('is_paused'),
            paused_by=data.get('paused_by'),
            paused_at=data.get('paused_at'),
            error=data.get('error'),
            stopped_at=data.get('stopped_at'),
            indexing_status=data.get('indexing_status'),
            enabled=data.get('enabled'),
            disabled_at=data.get('disabled_at'),
            disabled_by=data.get('disabled_by'),
            archived=data.get('archived'),
            archived_reason=data.get('archived_reason'),
            archived_by=data.get('archived_by'),
            archived_at=data.get('archived_at'),
            updated_at=data.get('updated_at'),
            doc_type=data.get('doc_type'),
            doc_metadata=data.get('doc_metadata'),
            doc_form=data.get('doc_form'),
            doc_language=data.get('doc_language')
        )

class DocumentSegment(db.Model):
    __tablename__ = 'document_segments'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='document_segment_pkey'),
        db.Index('document_segment_dataset_id_idx', 'dataset_id'),
        db.Index('document_segment_document_id_idx', 'document_id'),
        db.Index('document_segment_tenant_dataset_idx', 'dataset_id', 'tenant_id'),
        db.Index('document_segment_tenant_document_idx', 'document_id', 'tenant_id'),
        db.Index('document_segment_dataset_node_idx', 'dataset_id', 'index_node_id'),
        db.Index('document_segment_tenant_idx', 'tenant_id'),
    )

    # initial fields
    id = db.Column(StringUUID, nullable=False,
                   server_default=db.text('uuid_generate_v4()'))
    tenant_id = db.Column(StringUUID, nullable=False)
    dataset_id = db.Column(StringUUID, nullable=False)
    document_id = db.Column(StringUUID, nullable=False)
    position = db.Column(db.Integer, nullable=False)
    content = db.Column(db.Text, nullable=False)
    answer = db.Column(db.Text, nullable=True)
    word_count = db.Column(db.Integer, nullable=False)
    tokens = db.Column(db.Integer, nullable=False)

    # indexing fields
    keywords = db.Column(db.JSON, nullable=True)
    index_node_id = db.Column(db.String(255), nullable=True)
    index_node_hash = db.Column(db.String(255), nullable=True)

    # basic fields
    hit_count = db.Column(db.Integer, nullable=False, default=0)
    enabled = db.Column(db.Boolean, nullable=False,
                        server_default=db.text('true'))
    disabled_at = db.Column(db.DateTime, nullable=True)
    disabled_by = db.Column(StringUUID, nullable=True)
    status = db.Column(db.String(255), nullable=False,
                       server_default=db.text("'waiting'::character varying"))
    created_by = db.Column(StringUUID, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False,
                           server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_by = db.Column(StringUUID, nullable=True)
    updated_at = db.Column(db.DateTime, nullable=False,
                           server_default=db.text('CURRENT_TIMESTAMP(0)'))
    indexing_at = db.Column(db.DateTime, nullable=True)
    completed_at = db.Column(db.DateTime, nullable=True)
    error = db.Column(db.Text, nullable=True)
    stopped_at = db.Column(db.DateTime, nullable=True)

    @property
    def dataset(self):
        return db.session.query(Dataset).filter(Dataset.id == self.dataset_id).first()

    @property
    def document(self):
        return db.session.query(Document).filter(Document.id == self.document_id).first()

    @property
    def previous_segment(self):
        return db.session.query(DocumentSegment).filter(
            DocumentSegment.document_id == self.document_id,
            DocumentSegment.position == self.position - 1
        ).first()

    @property
    def next_segment(self):
        return db.session.query(DocumentSegment).filter(
            DocumentSegment.document_id == self.document_id,
            DocumentSegment.position == self.position + 1
        ).first()

    def get_sign_content(self):
        pattern = r"/files/([a-f0-9\-]+)/image-preview"
        text = self.content
        matches = re.finditer(pattern, text)
        signed_urls = []
        for match in matches:
            upload_file_id = match.group(1)
            nonce = os.urandom(16).hex()
            timestamp = str(int(time.time()))
            data_to_sign = f"image-preview|{upload_file_id}|{timestamp}|{nonce}"
            secret_key = dify_config.SECRET_KEY.encode() if dify_config.SECRET_KEY else b''
            sign = hmac.new(secret_key, data_to_sign.encode(), hashlib.sha256).digest()
            encoded_sign = base64.urlsafe_b64encode(sign).decode()

            params = f"timestamp={timestamp}&nonce={nonce}&sign={encoded_sign}"
            signed_url = f"{match.group(0)}?{params}"
            signed_urls.append((match.start(), match.end(), signed_url))

        # Reconstruct the text with signed URLs
        offset = 0
        for start, end, signed_url in signed_urls:
            text = text[:start + offset] + signed_url + text[end + offset:]
            offset += len(signed_url) - (end - start)

        return text



class AppDatasetJoin(db.Model):
    __tablename__ = 'app_dataset_joins'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='app_dataset_join_pkey'),
        db.Index('app_dataset_join_app_dataset_idx', 'dataset_id', 'app_id'),
    )

    id = db.Column(StringUUID, primary_key=True, nullable=False, server_default=db.text('uuid_generate_v4()'))
    app_id = db.Column(StringUUID, nullable=False)
    dataset_id = db.Column(StringUUID, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.func.current_timestamp())

    @property
    def app(self):
        return db.session.get(App, self.app_id)


class DatasetQuery(db.Model):
    __tablename__ = 'dataset_queries'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='dataset_query_pkey'),
        db.Index('dataset_query_dataset_id_idx', 'dataset_id'),
    )

    id = db.Column(StringUUID, primary_key=True, nullable=False, server_default=db.text('uuid_generate_v4()'))
    dataset_id = db.Column(StringUUID, nullable=False)
    content = db.Column(db.Text, nullable=False)
    source = db.Column(db.String(255), nullable=False)
    source_app_id = db.Column(StringUUID, nullable=True)
    created_by_role = db.Column(db.String, nullable=False)
    created_by = db.Column(StringUUID, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.func.current_timestamp())


class DatasetKeywordTable(db.Model):
    __tablename__ = 'dataset_keyword_tables'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='dataset_keyword_table_pkey'),
        db.Index('dataset_keyword_table_dataset_id_idx', 'dataset_id'),
    )

    id = db.Column(StringUUID, primary_key=True, server_default=db.text('uuid_generate_v4()'))
    dataset_id = db.Column(StringUUID, nullable=False, unique=True)
    keyword_table = db.Column(db.Text, nullable=False)
    data_source_type = db.Column(db.String(255), nullable=False,
                                 server_default=db.text("'database'::character varying"))

    @property
    def keyword_table_dict(self):
        class SetDecoder(json.JSONDecoder):
            def __init__(self, *args, **kwargs):
                super().__init__(object_hook=self.object_hook, *args, **kwargs)

            def object_hook(self, dct):
                if isinstance(dct, dict):
                    for keyword, node_idxs in dct.items():
                        if isinstance(node_idxs, list):
                            dct[keyword] = set(node_idxs)
                return dct

        # get dataset
        dataset = Dataset.query.filter_by(
            id=self.dataset_id
        ).first()
        if not dataset:
            return None
        if self.data_source_type == 'database':
            return json.loads(self.keyword_table, cls=SetDecoder) if self.keyword_table else None
        else:
            file_key = 'keyword_files/' + dataset.tenant_id + '/' + self.dataset_id + '.txt'
            try:
                keyword_table_text = storage.load_once(file_key)
                if keyword_table_text:
                    return json.loads(keyword_table_text.decode('utf-8'), cls=SetDecoder)
                return None
            except Exception as e:
                logging.exception(str(e))
                return None


class Embedding(db.Model):
    __tablename__ = 'embeddings'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='embedding_pkey'),
        db.UniqueConstraint('model_name', 'hash', 'provider_name', name='embedding_hash_idx'),
        db.Index('created_at_idx', 'created_at')
    )

    id = db.Column(StringUUID, primary_key=True, server_default=db.text('uuid_generate_v4()'))
    model_name = db.Column(db.String(255), nullable=False,
                           server_default=db.text("'text-embedding-ada-002'::character varying"))
    hash = db.Column(db.String(64), nullable=False)
    embedding = db.Column(db.LargeBinary, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    provider_name = db.Column(db.String(255), nullable=False,
                              server_default=db.text("''::character varying"))

    def set_embedding(self, embedding_data: list[float]):
        self.embedding = pickle.dumps(embedding_data, protocol=pickle.HIGHEST_PROTOCOL)

    def get_embedding(self) -> list[float]:
        return pickle.loads(self.embedding)


class DatasetCollectionBinding(db.Model):
    __tablename__ = 'dataset_collection_bindings'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='dataset_collection_bindings_pkey'),
        db.Index('provider_model_name_idx', 'provider_name', 'model_name')

    )

    id = db.Column(StringUUID, primary_key=True, server_default=db.text('uuid_generate_v4()'))
    provider_name = db.Column(db.String(40), nullable=False)
    model_name = db.Column(db.String(255), nullable=False)
    type = db.Column(db.String(40), server_default=db.text("'dataset'::character varying"), nullable=False)
    collection_name = db.Column(db.String(64), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))


class DatasetPermission(db.Model):
    __tablename__ = 'dataset_permissions'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='dataset_permission_pkey'),
        db.Index('idx_dataset_permissions_dataset_id', 'dataset_id'),
        db.Index('idx_dataset_permissions_account_id', 'account_id'),
        db.Index('idx_dataset_permissions_tenant_id', 'tenant_id')
    )

    id = db.Column(StringUUID, server_default=db.text('uuid_generate_v4()'), primary_key=True)
    dataset_id = db.Column(StringUUID, nullable=False)
    account_id = db.Column(StringUUID, nullable=False)
    tenant_id = db.Column(StringUUID, nullable=False)
    has_permission = db.Column(db.Boolean, nullable=False, server_default=db.text('true'))
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
