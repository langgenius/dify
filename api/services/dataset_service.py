import json
import logging
import datetime
import time
import random
from typing import Optional
from extensions.ext_redis import redis_client
from flask_login import current_user

from core.index.index_builder import IndexBuilder
from events.dataset_event import dataset_was_deleted
from events.document_event import document_was_deleted
from extensions.ext_database import db
from models.account import Account
from models.dataset import Dataset, Document, DatasetQuery, DatasetProcessRule, AppDatasetJoin
from models.model import UploadFile
from services.errors.account import NoPermissionError
from services.errors.dataset import DatasetNameDuplicateError
from services.errors.document import DocumentIndexingError
from services.errors.file import FileNotExistsError
from tasks.deal_dataset_vector_index_task import deal_dataset_vector_index_task
from tasks.document_indexing_task import document_indexing_task


class DatasetService:

    @staticmethod
    def get_datasets(page, per_page, provider="vendor", tenant_id=None, user=None):
        if user:
            permission_filter = db.or_(Dataset.created_by == user.id,
                                       Dataset.permission == 'all_team_members')
        else:
            permission_filter = Dataset.permission == 'all_team_members'
        datasets = Dataset.query.filter(
            db.and_(Dataset.provider == provider, Dataset.tenant_id == tenant_id, permission_filter)) \
            .paginate(
            page=page,
            per_page=per_page,
            max_per_page=100,
            error_out=False
        )

        return datasets.items, datasets.total

    @staticmethod
    def get_process_rules(dataset_id):
        # get the latest process rule
        dataset_process_rule = db.session.query(DatasetProcessRule). \
            filter(DatasetProcessRule.dataset_id == dataset_id). \
            order_by(DatasetProcessRule.created_at.desc()). \
            limit(1). \
            one_or_none()
        if dataset_process_rule:
            mode = dataset_process_rule.mode
            rules = dataset_process_rule.rules_dict
        else:
            mode = DocumentService.DEFAULT_RULES['mode']
            rules = DocumentService.DEFAULT_RULES['rules']
        return {
            'mode': mode,
            'rules': rules
        }

    @staticmethod
    def get_datasets_by_ids(ids, tenant_id):
        datasets = Dataset.query.filter(Dataset.id.in_(ids),
                                        Dataset.tenant_id == tenant_id).paginate(
            page=1, per_page=len(ids), max_per_page=len(ids), error_out=False)
        return datasets.items, datasets.total

    @staticmethod
    def create_empty_dataset(tenant_id: str, name: str, indexing_technique: Optional[str], account: Account):
        # check if dataset name already exists
        if Dataset.query.filter_by(name=name, tenant_id=tenant_id).first():
            raise DatasetNameDuplicateError(
                f'Dataset with name {name} already exists.')

        dataset = Dataset(name=name, indexing_technique=indexing_technique, data_source_type='upload_file')
        # dataset = Dataset(name=name, provider=provider, config=config)
        dataset.created_by = account.id
        dataset.updated_by = account.id
        dataset.tenant_id = tenant_id
        db.session.add(dataset)
        db.session.commit()
        return dataset

    @staticmethod
    def get_dataset(dataset_id):
        dataset = Dataset.query.filter_by(
            id=dataset_id
        ).first()
        if dataset is None:
            return None
        else:
            return dataset

    @staticmethod
    def update_dataset(dataset_id, data, user):
        dataset = DatasetService.get_dataset(dataset_id)
        DatasetService.check_dataset_permission(dataset, user)
        if dataset.indexing_technique != data['indexing_technique']:
            # if update indexing_technique
            if data['indexing_technique'] == 'economy':
                deal_dataset_vector_index_task.delay(dataset_id, 'remove')
            elif data['indexing_technique'] == 'high_quality':
                deal_dataset_vector_index_task.delay(dataset_id, 'add')
        filtered_data = {k: v for k, v in data.items() if v is not None or k == 'description'}

        filtered_data['updated_by'] = user.id
        filtered_data['updated_at'] = datetime.datetime.now()

        dataset.query.filter_by(id=dataset_id).update(filtered_data)

        db.session.commit()

        return dataset

    @staticmethod
    def delete_dataset(dataset_id, user):
        # todo: cannot delete dataset if it is being processed

        dataset = DatasetService.get_dataset(dataset_id)

        if dataset is None:
            return False

        DatasetService.check_dataset_permission(dataset, user)

        dataset_was_deleted.send(dataset)

        db.session.delete(dataset)
        db.session.commit()
        return True

    @staticmethod
    def check_dataset_permission(dataset, user):
        if dataset.tenant_id != user.current_tenant_id:
            logging.debug(
                f'User {user.id} does not have permission to access dataset {dataset.id}')
            raise NoPermissionError(
                'You do not have permission to access this dataset.')
        if dataset.permission == 'only_me' and dataset.created_by != user.id:
            logging.debug(
                f'User {user.id} does not have permission to access dataset {dataset.id}')
            raise NoPermissionError(
                'You do not have permission to access this dataset.')

    @staticmethod
    def get_dataset_queries(dataset_id: str, page: int, per_page: int):
        dataset_queries = DatasetQuery.query.filter_by(dataset_id=dataset_id) \
            .order_by(db.desc(DatasetQuery.created_at)) \
            .paginate(
            page=page, per_page=per_page, max_per_page=100, error_out=False
        )
        return dataset_queries.items, dataset_queries.total

    @staticmethod
    def get_related_apps(dataset_id: str):
        return AppDatasetJoin.query.filter(AppDatasetJoin.dataset_id == dataset_id) \
            .order_by(db.desc(AppDatasetJoin.created_at)).all()


class DocumentService:
    DEFAULT_RULES = {
        'mode': 'custom',
        'rules': {
            'pre_processing_rules': [
                {'id': 'remove_extra_spaces', 'enabled': True},
                {'id': 'remove_urls_emails', 'enabled': False}
            ],
            'segmentation': {
                'delimiter': '\n',
                'max_tokens': 500
            }
        }
    }

    DOCUMENT_METADATA_SCHEMA = {
        "book": {
            "title": str,
            "language": str,
            "author": str,
            "publisher": str,
            "publication_date": str,
            "isbn": str,
            "category": str,
        },
        "web_page": {
            "title": str,
            "url": str,
            "language": str,
            "publish_date": str,
            "author/publisher": str,
            "topic/keywords": str,
            "description": str,
        },
        "paper": {
            "title": str,
            "language": str,
            "author": str,
            "publish_date": str,
            "journal/conference_name": str,
            "volume/issue/page_numbers": str,
            "doi": str,
            "topic/keywords": str,
            "abstract": str,
        },
        "social_media_post": {
            "platform": str,
            "author/username": str,
            "publish_date": str,
            "post_url": str,
            "topic/tags": str,
        },
        "wikipedia_entry": {
            "title": str,
            "language": str,
            "web_page_url": str,
            "last_edit_date": str,
            "editor/contributor": str,
            "summary/introduction": str,
        },
        "personal_document": {
            "title": str,
            "author": str,
            "creation_date": str,
            "last_modified_date": str,
            "document_type": str,
            "tags/category": str,
        },
        "business_document": {
            "title": str,
            "author": str,
            "creation_date": str,
            "last_modified_date": str,
            "document_type": str,
            "department/team": str,
        },
        "im_chat_log": {
            "chat_platform": str,
            "chat_participants/group_name": str,
            "start_date": str,
            "end_date": str,
            "summary": str,
        },
        "synced_from_notion": {
            "title": str,
            "language": str,
            "author/creator": str,
            "creation_date": str,
            "last_modified_date": str,
            "notion_page_link": str,
            "category/tags": str,
            "description": str,
        },
        "synced_from_github": {
            "repository_name": str,
            "repository_description": str,
            "repository_owner/organization": str,
            "code_filename": str,
            "code_file_path": str,
            "programming_language": str,
            "github_link": str,
            "open_source_license": str,
            "commit_date": str,
            "commit_author": str
        }
    }

    @staticmethod
    def get_document(dataset_id: str, document_id: str) -> Optional[Document]:
        document = db.session.query(Document).filter(
            Document.id == document_id,
            Document.dataset_id == dataset_id
        ).first()

        return document

    @staticmethod
    def get_document_file_detail(file_id: str):
        file_detail = db.session.query(UploadFile). \
            filter(UploadFile.id == file_id). \
            one_or_none()
        return file_detail

    @staticmethod
    def check_archived(document):
        if document.archived:
            return True
        else:
            return False

    @staticmethod
    def delete_document(document):
        if document.indexing_status in ["parsing", "cleaning", "splitting", "indexing"]:
            raise DocumentIndexingError()

        # trigger document_was_deleted signal
        document_was_deleted.send(document.id, dataset_id=document.dataset_id)

        db.session.delete(document)
        db.session.commit()

    @staticmethod
    def pause_document(document):
        if document.indexing_status not in ["waiting", "parsing", "cleaning", "splitting", "indexing"]:
            raise DocumentIndexingError()
        # update document to be paused
        document.is_paused = True
        document.paused_by = current_user.id
        document.paused_at = datetime.datetime.utcnow()

        db.session.add(document)
        db.session.commit()
        # set document paused flag
        indexing_cache_key = 'document_{}_is_paused'.format(document.id)
        redis_client.setnx(indexing_cache_key, "True")

    @staticmethod
    def recover_document(document):
        if not document.is_paused:
            raise DocumentIndexingError()
        # update document to be recover
        document.is_paused = False
        document.paused_by = current_user.id
        document.paused_at = time.time()

        db.session.add(document)
        db.session.commit()
        # delete paused flag
        indexing_cache_key = 'document_{}_is_paused'.format(document.id)
        redis_client.delete(indexing_cache_key)
        # trigger async task
        document_indexing_task.delay(document.dataset_id, document.id)

    @staticmethod
    def get_documents_position(dataset_id):
        documents = Document.query.filter_by(dataset_id=dataset_id).all()
        if documents:
            return len(documents) + 1
        else:
            return 1

    @staticmethod
    def save_document_with_dataset_id(dataset: Dataset, document_data: dict,
                                      account: Account, dataset_process_rule: Optional[DatasetProcessRule] = None,
                                      created_from: str = 'web'):
        if not dataset.indexing_technique:
            if 'indexing_technique' not in document_data \
                    or document_data['indexing_technique'] not in Dataset.INDEXING_TECHNIQUE_LIST:
                raise ValueError("Indexing technique is required")

            dataset.indexing_technique = document_data["indexing_technique"]

        if dataset.indexing_technique == 'high_quality':
            IndexBuilder.get_default_service_context(dataset.tenant_id)

        # save process rule
        if not dataset_process_rule:
            process_rule = document_data["process_rule"]
            if process_rule["mode"] == "custom":
                dataset_process_rule = DatasetProcessRule(
                    dataset_id=dataset.id,
                    mode=process_rule["mode"],
                    rules=json.dumps(process_rule["rules"]),
                    created_by=account.id
                )
            elif process_rule["mode"] == "automatic":
                dataset_process_rule = DatasetProcessRule(
                    dataset_id=dataset.id,
                    mode=process_rule["mode"],
                    rules=json.dumps(DatasetProcessRule.AUTOMATIC_RULES),
                    created_by=account.id
                )
            db.session.add(dataset_process_rule)
            db.session.commit()

        file_name = ''
        data_source_info = {}
        if document_data["data_source"]["type"] == "upload_file":
            file_id = document_data["data_source"]["info"]
            file = db.session.query(UploadFile).filter(
                UploadFile.tenant_id == dataset.tenant_id,
                UploadFile.id == file_id
            ).first()

            # raise error if file not found
            if not file:
                raise FileNotExistsError()

            file_name = file.name
            data_source_info = {
                "upload_file_id": file_id,
            }

        # save document
        position = DocumentService.get_documents_position(dataset.id)
        document = Document(
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            position=position,
            data_source_type=document_data["data_source"]["type"],
            data_source_info=json.dumps(data_source_info),
            dataset_process_rule_id=dataset_process_rule.id,
            batch=time.strftime('%Y%m%d%H%M%S') + str(random.randint(100000, 999999)),
            name=file_name,
            created_from=created_from,
            created_by=account.id,
            # created_api_request_id = db.Column(UUID, nullable=True)
        )

        db.session.add(document)
        db.session.commit()

        # trigger async task
        document_indexing_task.delay(document.dataset_id, document.id)

        return document

    @staticmethod
    def save_document_without_dataset_id(tenant_id: str, document_data: dict, account: Account):
        # save dataset
        dataset = Dataset(
            tenant_id=tenant_id,
            name='',
            data_source_type=document_data["data_source"]["type"],
            indexing_technique=document_data["indexing_technique"],
            created_by=account.id
        )

        db.session.add(dataset)
        db.session.flush()

        document = DocumentService.save_document_with_dataset_id(dataset, document_data, account)

        cut_length = 18
        cut_name = document.name[:cut_length]
        dataset.name = cut_name + '...' if len(document.name) > cut_length else cut_name
        dataset.description = 'useful for when you want to answer queries about the ' + document.name
        db.session.commit()

        return dataset, document

    @classmethod
    def document_create_args_validate(cls, args: dict):
        if 'data_source' not in args or not args['data_source']:
            raise ValueError("Data source is required")

        if not isinstance(args['data_source'], dict):
            raise ValueError("Data source is invalid")

        if 'type' not in args['data_source'] or not args['data_source']['type']:
            raise ValueError("Data source type is required")

        if args['data_source']['type'] not in Document.DATA_SOURCES:
            raise ValueError("Data source type is invalid")

        if args['data_source']['type'] == 'upload_file':
            if 'info' not in args['data_source'] or not args['data_source']['info']:
                raise ValueError("Data source info is required")

        if 'process_rule' not in args or not args['process_rule']:
            raise ValueError("Process rule is required")

        if not isinstance(args['process_rule'], dict):
            raise ValueError("Process rule is invalid")

        if 'mode' not in args['process_rule'] or not args['process_rule']['mode']:
            raise ValueError("Process rule mode is required")

        if args['process_rule']['mode'] not in DatasetProcessRule.MODES:
            raise ValueError("Process rule mode is invalid")

        if args['process_rule']['mode'] == 'automatic':
            args['process_rule']['rules'] = {}
        else:
            if 'rules' not in args['process_rule'] or not args['process_rule']['rules']:
                raise ValueError("Process rule rules is required")

            if not isinstance(args['process_rule']['rules'], dict):
                raise ValueError("Process rule rules is invalid")

            if 'pre_processing_rules' not in args['process_rule']['rules'] \
                    or args['process_rule']['rules']['pre_processing_rules'] is None:
                raise ValueError("Process rule pre_processing_rules is required")

            if not isinstance(args['process_rule']['rules']['pre_processing_rules'], list):
                raise ValueError("Process rule pre_processing_rules is invalid")

            unique_pre_processing_rule_dicts = {}
            for pre_processing_rule in args['process_rule']['rules']['pre_processing_rules']:
                if 'id' not in pre_processing_rule or not pre_processing_rule['id']:
                    raise ValueError("Process rule pre_processing_rules id is required")

                if pre_processing_rule['id'] not in DatasetProcessRule.PRE_PROCESSING_RULES:
                    raise ValueError("Process rule pre_processing_rules id is invalid")

                if 'enabled' not in pre_processing_rule or pre_processing_rule['enabled'] is None:
                    raise ValueError("Process rule pre_processing_rules enabled is required")

                if not isinstance(pre_processing_rule['enabled'], bool):
                    raise ValueError("Process rule pre_processing_rules enabled is invalid")

                unique_pre_processing_rule_dicts[pre_processing_rule['id']] = pre_processing_rule

            args['process_rule']['rules']['pre_processing_rules'] = list(unique_pre_processing_rule_dicts.values())

            if 'segmentation' not in args['process_rule']['rules'] \
                    or args['process_rule']['rules']['segmentation'] is None:
                raise ValueError("Process rule segmentation is required")

            if not isinstance(args['process_rule']['rules']['segmentation'], dict):
                raise ValueError("Process rule segmentation is invalid")

            if 'separator' not in args['process_rule']['rules']['segmentation'] \
                    or not args['process_rule']['rules']['segmentation']['separator']:
                raise ValueError("Process rule segmentation separator is required")

            if not isinstance(args['process_rule']['rules']['segmentation']['separator'], str):
                raise ValueError("Process rule segmentation separator is invalid")

            if 'max_tokens' not in args['process_rule']['rules']['segmentation'] \
                    or not args['process_rule']['rules']['segmentation']['max_tokens']:
                raise ValueError("Process rule segmentation max_tokens is required")

            if not isinstance(args['process_rule']['rules']['segmentation']['max_tokens'], int):
                raise ValueError("Process rule segmentation max_tokens is invalid")
