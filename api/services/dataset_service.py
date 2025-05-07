import copy
import datetime
import json
import logging
import random
import time
import uuid
from collections import Counter
from typing import Any, Optional

from flask_login import current_user
from sqlalchemy import func
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from configs import dify_config
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.plugin.entities.plugin import ModelProviderID
from core.rag.index_processor.constant.built_in_field import BuiltInField
from core.rag.index_processor.constant.index_type import IndexType
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from events.dataset_event import dataset_was_deleted
from events.document_event import document_was_deleted
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs import helper
from models.account import Account, TenantAccountRole
from models.dataset import (
    AppDatasetJoin,
    ChildChunk,
    Dataset,
    DatasetAutoDisableLog,
    DatasetCollectionBinding,
    DatasetPermission,
    DatasetPermissionEnum,
    DatasetProcessRule,
    DatasetQuery,
    Document,
    DocumentSegment,
    ExternalKnowledgeBindings,
)
from models.model import UploadFile
from models.source import DataSourceOauthBinding
from services.entities.knowledge_entities.knowledge_entities import (
    ChildChunkUpdateArgs,
    KnowledgeConfig,
    RerankingModel,
    RetrievalModel,
    SegmentUpdateArgs,
)
from services.errors.account import InvalidActionError, NoPermissionError
from services.errors.chunk import ChildChunkDeleteIndexError, ChildChunkIndexingError
from services.errors.dataset import DatasetNameDuplicateError
from services.errors.document import DocumentIndexingError
from services.errors.file import FileNotExistsError
from services.external_knowledge_service import ExternalDatasetService
from services.feature_service import FeatureModel, FeatureService
from services.tag_service import TagService
from services.vector_service import VectorService
from tasks.batch_clean_document_task import batch_clean_document_task
from tasks.clean_notion_document_task import clean_notion_document_task
from tasks.deal_dataset_vector_index_task import deal_dataset_vector_index_task
from tasks.delete_segment_from_index_task import delete_segment_from_index_task
from tasks.disable_segment_from_index_task import disable_segment_from_index_task
from tasks.disable_segments_from_index_task import disable_segments_from_index_task
from tasks.document_indexing_task import document_indexing_task
from tasks.document_indexing_update_task import document_indexing_update_task
from tasks.duplicate_document_indexing_task import duplicate_document_indexing_task
from tasks.enable_segments_to_index_task import enable_segments_to_index_task
from tasks.recover_document_indexing_task import recover_document_indexing_task
from tasks.retry_document_indexing_task import retry_document_indexing_task
from tasks.sync_website_document_indexing_task import sync_website_document_indexing_task


class DatasetService:
    @staticmethod
    def get_datasets(page, per_page, tenant_id=None, user=None, search=None, tag_ids=None, include_all=False):
        query = Dataset.query.filter(Dataset.tenant_id == tenant_id).order_by(Dataset.created_at.desc())

        if user:
            # get permitted dataset ids
            dataset_permission = DatasetPermission.query.filter_by(account_id=user.id, tenant_id=tenant_id).all()
            permitted_dataset_ids = {dp.dataset_id for dp in dataset_permission} if dataset_permission else None

            if user.current_role == TenantAccountRole.DATASET_OPERATOR:
                # only show datasets that the user has permission to access
                if permitted_dataset_ids:
                    query = query.filter(Dataset.id.in_(permitted_dataset_ids))
                else:
                    return [], 0
            else:
                if user.current_role != TenantAccountRole.OWNER or not include_all:
                    # show all datasets that the user has permission to access
                    if permitted_dataset_ids:
                        query = query.filter(
                            db.or_(
                                Dataset.permission == DatasetPermissionEnum.ALL_TEAM,
                                db.and_(
                                    Dataset.permission == DatasetPermissionEnum.ONLY_ME, Dataset.created_by == user.id
                                ),
                                db.and_(
                                    Dataset.permission == DatasetPermissionEnum.PARTIAL_TEAM,
                                    Dataset.id.in_(permitted_dataset_ids),
                                ),
                            )
                        )
                    else:
                        query = query.filter(
                            db.or_(
                                Dataset.permission == DatasetPermissionEnum.ALL_TEAM,
                                db.and_(
                                    Dataset.permission == DatasetPermissionEnum.ONLY_ME, Dataset.created_by == user.id
                                ),
                            )
                        )
        else:
            # if no user, only show datasets that are shared with all team members
            query = query.filter(Dataset.permission == DatasetPermissionEnum.ALL_TEAM)

        if search:
            query = query.filter(Dataset.name.ilike(f"%{search}%"))

        if tag_ids:
            target_ids = TagService.get_target_ids_by_tag_ids("knowledge", tenant_id, tag_ids)
            if target_ids:
                query = query.filter(Dataset.id.in_(target_ids))
            else:
                return [], 0

        datasets = query.paginate(page=page, per_page=per_page, max_per_page=100, error_out=False)

        return datasets.items, datasets.total

    @staticmethod
    def get_process_rules(dataset_id):
        # get the latest process rule
        dataset_process_rule = (
            db.session.query(DatasetProcessRule)
            .filter(DatasetProcessRule.dataset_id == dataset_id)
            .order_by(DatasetProcessRule.created_at.desc())
            .limit(1)
            .one_or_none()
        )
        if dataset_process_rule:
            mode = dataset_process_rule.mode
            rules = dataset_process_rule.rules_dict
        else:
            mode = DocumentService.DEFAULT_RULES["mode"]
            rules = DocumentService.DEFAULT_RULES["rules"]
        return {"mode": mode, "rules": rules}

    @staticmethod
    def get_datasets_by_ids(ids, tenant_id):
        datasets = Dataset.query.filter(Dataset.id.in_(ids), Dataset.tenant_id == tenant_id).paginate(
            page=1, per_page=len(ids), max_per_page=len(ids), error_out=False
        )
        return datasets.items, datasets.total

    @staticmethod
    def create_empty_dataset(
        tenant_id: str,
        name: str,
        description: Optional[str],
        indexing_technique: Optional[str],
        account: Account,
        permission: Optional[str] = None,
        provider: str = "vendor",
        external_knowledge_api_id: Optional[str] = None,
        external_knowledge_id: Optional[str] = None,
        embedding_model_provider: Optional[str] = None,
        embedding_model_name: Optional[str] = None,
        retrieval_model: Optional[RetrievalModel] = None,
    ):
        # check if dataset name already exists
        if Dataset.query.filter_by(name=name, tenant_id=tenant_id).first():
            raise DatasetNameDuplicateError(f"Dataset with name {name} already exists.")
        embedding_model = None
        if indexing_technique == "high_quality":
            model_manager = ModelManager()
            if embedding_model_provider and embedding_model_name:
                # check if embedding model setting is valid
                DatasetService.check_embedding_model_setting(tenant_id, embedding_model_provider, embedding_model_name)
                embedding_model = model_manager.get_model_instance(
                    tenant_id=tenant_id,
                    provider=embedding_model_provider,
                    model_type=ModelType.TEXT_EMBEDDING,
                    model=embedding_model_name,
                )
            else:
                embedding_model = model_manager.get_default_model_instance(
                    tenant_id=tenant_id, model_type=ModelType.TEXT_EMBEDDING
                )
            if retrieval_model and retrieval_model.reranking_model:
                if (
                    retrieval_model.reranking_model.reranking_provider_name
                    and retrieval_model.reranking_model.reranking_model_name
                ):
                    # check if reranking model setting is valid
                    DatasetService.check_embedding_model_setting(
                        tenant_id,
                        retrieval_model.reranking_model.reranking_provider_name,
                        retrieval_model.reranking_model.reranking_model_name,
                    )
        dataset = Dataset(name=name, indexing_technique=indexing_technique)
        # dataset = Dataset(name=name, provider=provider, config=config)
        dataset.description = description
        dataset.created_by = account.id
        dataset.updated_by = account.id
        dataset.tenant_id = tenant_id
        dataset.embedding_model_provider = embedding_model.provider if embedding_model else None
        dataset.embedding_model = embedding_model.model if embedding_model else None
        dataset.retrieval_model = retrieval_model.model_dump() if retrieval_model else None
        dataset.permission = permission or DatasetPermissionEnum.ONLY_ME
        dataset.provider = provider
        db.session.add(dataset)
        db.session.flush()

        if provider == "external" and external_knowledge_api_id:
            external_knowledge_api = ExternalDatasetService.get_external_knowledge_api(external_knowledge_api_id)
            if not external_knowledge_api:
                raise ValueError("External API template not found.")
            external_knowledge_binding = ExternalKnowledgeBindings(
                tenant_id=tenant_id,
                dataset_id=dataset.id,
                external_knowledge_api_id=external_knowledge_api_id,
                external_knowledge_id=external_knowledge_id,
                created_by=account.id,
            )
            db.session.add(external_knowledge_binding)

        db.session.commit()
        return dataset

    @staticmethod
    def get_dataset(dataset_id) -> Optional[Dataset]:
        dataset: Optional[Dataset] = Dataset.query.filter_by(id=dataset_id).first()
        return dataset

    @staticmethod
    def check_dataset_model_setting(dataset):
        if dataset.indexing_technique == "high_quality":
            try:
                model_manager = ModelManager()
                model_manager.get_model_instance(
                    tenant_id=dataset.tenant_id,
                    provider=dataset.embedding_model_provider,
                    model_type=ModelType.TEXT_EMBEDDING,
                    model=dataset.embedding_model,
                )
            except LLMBadRequestError:
                raise ValueError(
                    "No Embedding Model available. Please configure a valid provider in the Settings -> Model Provider."
                )
            except ProviderTokenNotInitError as ex:
                raise ValueError(f"The dataset in unavailable, due to: {ex.description}")

    @staticmethod
    def check_embedding_model_setting(tenant_id: str, embedding_model_provider: str, embedding_model: str):
        try:
            model_manager = ModelManager()
            model_manager.get_model_instance(
                tenant_id=tenant_id,
                provider=embedding_model_provider,
                model_type=ModelType.TEXT_EMBEDDING,
                model=embedding_model,
            )
        except LLMBadRequestError:
            raise ValueError(
                "No Embedding Model available. Please configure a valid provider in the Settings -> Model Provider."
            )
        except ProviderTokenNotInitError as ex:
            raise ValueError(ex.description)

    @staticmethod
    def update_dataset(dataset_id, data, user):
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise ValueError("Dataset not found")

        DatasetService.check_dataset_permission(dataset, user)
        if dataset.provider == "external":
            external_retrieval_model = data.get("external_retrieval_model", None)
            if external_retrieval_model:
                dataset.retrieval_model = external_retrieval_model
            dataset.name = data.get("name", dataset.name)
            dataset.description = data.get("description", "")
            permission = data.get("permission")
            if permission:
                dataset.permission = permission
            external_knowledge_id = data.get("external_knowledge_id", None)
            db.session.add(dataset)
            if not external_knowledge_id:
                raise ValueError("External knowledge id is required.")
            external_knowledge_api_id = data.get("external_knowledge_api_id", None)
            if not external_knowledge_api_id:
                raise ValueError("External knowledge api id is required.")

            with Session(db.engine) as session:
                external_knowledge_binding = (
                    session.query(ExternalKnowledgeBindings).filter_by(dataset_id=dataset_id).first()
                )

                if not external_knowledge_binding:
                    raise ValueError("External knowledge binding not found.")

            if (
                external_knowledge_binding.external_knowledge_id != external_knowledge_id
                or external_knowledge_binding.external_knowledge_api_id != external_knowledge_api_id
            ):
                external_knowledge_binding.external_knowledge_id = external_knowledge_id
                external_knowledge_binding.external_knowledge_api_id = external_knowledge_api_id
                db.session.add(external_knowledge_binding)
            db.session.commit()
        else:
            data.pop("partial_member_list", None)
            data.pop("external_knowledge_api_id", None)
            data.pop("external_knowledge_id", None)
            data.pop("external_retrieval_model", None)
            filtered_data = {k: v for k, v in data.items() if v is not None or k == "description"}
            action = None
            if dataset.indexing_technique != data["indexing_technique"]:
                # if update indexing_technique
                if data["indexing_technique"] == "economy":
                    action = "remove"
                    filtered_data["embedding_model"] = None
                    filtered_data["embedding_model_provider"] = None
                    filtered_data["collection_binding_id"] = None
                elif data["indexing_technique"] == "high_quality":
                    action = "add"
                    # get embedding model setting
                    try:
                        model_manager = ModelManager()
                        embedding_model = model_manager.get_model_instance(
                            tenant_id=current_user.current_tenant_id,
                            provider=data["embedding_model_provider"],
                            model_type=ModelType.TEXT_EMBEDDING,
                            model=data["embedding_model"],
                        )
                        filtered_data["embedding_model"] = embedding_model.model
                        filtered_data["embedding_model_provider"] = embedding_model.provider
                        dataset_collection_binding = DatasetCollectionBindingService.get_dataset_collection_binding(
                            embedding_model.provider, embedding_model.model
                        )
                        filtered_data["collection_binding_id"] = dataset_collection_binding.id
                    except LLMBadRequestError:
                        raise ValueError(
                            "No Embedding Model available. Please configure a valid provider "
                            "in the Settings -> Model Provider."
                        )
                    except ProviderTokenNotInitError as ex:
                        raise ValueError(ex.description)
            else:
                # add default plugin id to both setting sets, to make sure the plugin model provider is consistent
                # Skip embedding model checks if not provided in the update request
                if (
                    "embedding_model_provider" not in data
                    or "embedding_model" not in data
                    or not data.get("embedding_model_provider")
                    or not data.get("embedding_model")
                ):
                    # If the dataset already has embedding model settings, use those
                    if dataset.embedding_model_provider and dataset.embedding_model:
                        # Keep existing values
                        filtered_data["embedding_model_provider"] = dataset.embedding_model_provider
                        filtered_data["embedding_model"] = dataset.embedding_model
                        # If collection_binding_id exists, keep it too
                        if dataset.collection_binding_id:
                            filtered_data["collection_binding_id"] = dataset.collection_binding_id
                    # Otherwise, don't try to update embedding model settings at all
                    # Remove these fields from filtered_data if they exist but are None/empty
                    if "embedding_model_provider" in filtered_data and not filtered_data["embedding_model_provider"]:
                        del filtered_data["embedding_model_provider"]
                    if "embedding_model" in filtered_data and not filtered_data["embedding_model"]:
                        del filtered_data["embedding_model"]
                else:
                    skip_embedding_update = False
                    try:
                        # Handle existing model provider
                        plugin_model_provider = dataset.embedding_model_provider
                        plugin_model_provider_str = None
                        if plugin_model_provider:
                            plugin_model_provider_str = str(ModelProviderID(plugin_model_provider))

                        # Handle new model provider from request
                        new_plugin_model_provider = data["embedding_model_provider"]
                        new_plugin_model_provider_str = None
                        if new_plugin_model_provider:
                            new_plugin_model_provider_str = str(ModelProviderID(new_plugin_model_provider))

                        # Only update embedding model if both values are provided and different from current
                        if (
                            plugin_model_provider_str != new_plugin_model_provider_str
                            or data["embedding_model"] != dataset.embedding_model
                        ):
                            action = "update"
                            model_manager = ModelManager()
                            try:
                                embedding_model = model_manager.get_model_instance(
                                    tenant_id=current_user.current_tenant_id,
                                    provider=data["embedding_model_provider"],
                                    model_type=ModelType.TEXT_EMBEDDING,
                                    model=data["embedding_model"],
                                )
                            except ProviderTokenNotInitError:
                                # If we can't get the embedding model, skip updating it
                                # and keep the existing settings if available
                                if dataset.embedding_model_provider and dataset.embedding_model:
                                    filtered_data["embedding_model_provider"] = dataset.embedding_model_provider
                                    filtered_data["embedding_model"] = dataset.embedding_model
                                    if dataset.collection_binding_id:
                                        filtered_data["collection_binding_id"] = dataset.collection_binding_id
                                # Skip the rest of the embedding model update
                                skip_embedding_update = True
                            if not skip_embedding_update:
                                filtered_data["embedding_model"] = embedding_model.model
                                filtered_data["embedding_model_provider"] = embedding_model.provider
                                dataset_collection_binding = (
                                    DatasetCollectionBindingService.get_dataset_collection_binding(
                                        embedding_model.provider, embedding_model.model
                                    )
                                )
                                filtered_data["collection_binding_id"] = dataset_collection_binding.id
                    except LLMBadRequestError:
                        raise ValueError(
                            "No Embedding Model available. Please configure a valid provider "
                            "in the Settings -> Model Provider."
                        )
                    except ProviderTokenNotInitError as ex:
                        raise ValueError(ex.description)

            filtered_data["updated_by"] = user.id
            filtered_data["updated_at"] = datetime.datetime.now()

            # update Retrieval model
            filtered_data["retrieval_model"] = data["retrieval_model"]

            dataset.query.filter_by(id=dataset_id).update(filtered_data)

            db.session.commit()
            if action:
                deal_dataset_vector_index_task.delay(dataset_id, action)
        return dataset

    @staticmethod
    def delete_dataset(dataset_id, user):
        dataset = DatasetService.get_dataset(dataset_id)

        if dataset is None:
            return False

        DatasetService.check_dataset_permission(dataset, user)

        dataset_was_deleted.send(dataset)

        db.session.delete(dataset)
        db.session.commit()
        return True

    @staticmethod
    def dataset_use_check(dataset_id) -> bool:
        count = AppDatasetJoin.query.filter_by(dataset_id=dataset_id).count()
        if count > 0:
            return True
        return False

    @staticmethod
    def check_dataset_permission(dataset, user):
        if dataset.tenant_id != user.current_tenant_id:
            logging.debug(f"User {user.id} does not have permission to access dataset {dataset.id}")
            raise NoPermissionError("You do not have permission to access this dataset.")
        if user.current_role != TenantAccountRole.OWNER:
            if dataset.permission == DatasetPermissionEnum.ONLY_ME and dataset.created_by != user.id:
                logging.debug(f"User {user.id} does not have permission to access dataset {dataset.id}")
                raise NoPermissionError("You do not have permission to access this dataset.")
            if dataset.permission == "partial_members":
                user_permission = DatasetPermission.query.filter_by(dataset_id=dataset.id, account_id=user.id).first()
                if (
                    not user_permission
                    and dataset.tenant_id != user.current_tenant_id
                    and dataset.created_by != user.id
                ):
                    logging.debug(f"User {user.id} does not have permission to access dataset {dataset.id}")
                    raise NoPermissionError("You do not have permission to access this dataset.")

    @staticmethod
    def check_dataset_operator_permission(user: Optional[Account] = None, dataset: Optional[Dataset] = None):
        if not dataset:
            raise ValueError("Dataset not found")

        if not user:
            raise ValueError("User not found")

        if user.current_role != TenantAccountRole.OWNER:
            if dataset.permission == DatasetPermissionEnum.ONLY_ME:
                if dataset.created_by != user.id:
                    raise NoPermissionError("You do not have permission to access this dataset.")

            elif dataset.permission == DatasetPermissionEnum.PARTIAL_TEAM:
                if not any(
                    dp.dataset_id == dataset.id for dp in DatasetPermission.query.filter_by(account_id=user.id).all()
                ):
                    raise NoPermissionError("You do not have permission to access this dataset.")

    @staticmethod
    def get_dataset_queries(dataset_id: str, page: int, per_page: int):
        dataset_queries = (
            DatasetQuery.query.filter_by(dataset_id=dataset_id)
            .order_by(db.desc(DatasetQuery.created_at))
            .paginate(page=page, per_page=per_page, max_per_page=100, error_out=False)
        )
        return dataset_queries.items, dataset_queries.total

    @staticmethod
    def get_related_apps(dataset_id: str):
        return (
            AppDatasetJoin.query.filter(AppDatasetJoin.dataset_id == dataset_id)
            .order_by(db.desc(AppDatasetJoin.created_at))
            .all()
        )

    @staticmethod
    def get_dataset_auto_disable_logs(dataset_id: str) -> dict:
        features = FeatureService.get_features(current_user.current_tenant_id)
        if not features.billing.enabled or features.billing.subscription.plan == "sandbox":
            return {
                "document_ids": [],
                "count": 0,
            }
        # get recent 30 days auto disable logs
        start_date = datetime.datetime.now() - datetime.timedelta(days=30)
        dataset_auto_disable_logs = DatasetAutoDisableLog.query.filter(
            DatasetAutoDisableLog.dataset_id == dataset_id,
            DatasetAutoDisableLog.created_at >= start_date,
        ).all()
        if dataset_auto_disable_logs:
            return {
                "document_ids": [log.document_id for log in dataset_auto_disable_logs],
                "count": len(dataset_auto_disable_logs),
            }
        return {
            "document_ids": [],
            "count": 0,
        }


class DocumentService:
    DEFAULT_RULES: dict[str, Any] = {
        "mode": "custom",
        "rules": {
            "pre_processing_rules": [
                {"id": "remove_extra_spaces", "enabled": True},
                {"id": "remove_urls_emails", "enabled": False},
            ],
            "segmentation": {"delimiter": "\n", "max_tokens": 1024, "chunk_overlap": 50},
        },
        "limits": {
            "indexing_max_segmentation_tokens_length": dify_config.INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH,
        },
    }

    DOCUMENT_METADATA_SCHEMA: dict[str, Any] = {
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
            "commit_author": str,
        },
        "others": dict,
    }

    @staticmethod
    def get_document(dataset_id: str, document_id: Optional[str] = None) -> Optional[Document]:
        if document_id:
            document = (
                db.session.query(Document).filter(Document.id == document_id, Document.dataset_id == dataset_id).first()
            )
            return document
        else:
            return None

    @staticmethod
    def get_document_by_id(document_id: str) -> Optional[Document]:
        document = db.session.query(Document).filter(Document.id == document_id).first()

        return document

    @staticmethod
    def get_document_by_ids(document_ids: list[str]) -> list[Document]:
        documents = (
            db.session.query(Document)
            .filter(
                Document.id.in_(document_ids),
                Document.enabled == True,
                Document.indexing_status == "completed",
                Document.archived == False,
            )
            .all()
        )
        return documents

    @staticmethod
    def get_document_by_dataset_id(dataset_id: str) -> list[Document]:
        documents = (
            db.session.query(Document)
            .filter(
                Document.dataset_id == dataset_id,
                Document.enabled == True,
            )
            .all()
        )

        return documents

    @staticmethod
    def get_working_documents_by_dataset_id(dataset_id: str) -> list[Document]:
        documents = (
            db.session.query(Document)
            .filter(
                Document.dataset_id == dataset_id,
                Document.enabled == True,
                Document.indexing_status == "completed",
                Document.archived == False,
            )
            .all()
        )

        return documents

    @staticmethod
    def get_error_documents_by_dataset_id(dataset_id: str) -> list[Document]:
        documents = (
            db.session.query(Document)
            .filter(Document.dataset_id == dataset_id, Document.indexing_status.in_(["error", "paused"]))
            .all()
        )
        return documents

    @staticmethod
    def get_batch_documents(dataset_id: str, batch: str) -> list[Document]:
        documents = (
            db.session.query(Document)
            .filter(
                Document.batch == batch,
                Document.dataset_id == dataset_id,
                Document.tenant_id == current_user.current_tenant_id,
            )
            .all()
        )

        return documents

    @staticmethod
    def get_document_file_detail(file_id: str):
        file_detail = db.session.query(UploadFile).filter(UploadFile.id == file_id).one_or_none()
        return file_detail

    @staticmethod
    def check_archived(document):
        if document.archived:
            return True
        else:
            return False

    @staticmethod
    def delete_document(document):
        # trigger document_was_deleted signal
        file_id = None
        if document.data_source_type == "upload_file":
            if document.data_source_info:
                data_source_info = document.data_source_info_dict
                if data_source_info and "upload_file_id" in data_source_info:
                    file_id = data_source_info["upload_file_id"]
        document_was_deleted.send(
            document.id, dataset_id=document.dataset_id, doc_form=document.doc_form, file_id=file_id
        )

        db.session.delete(document)
        db.session.commit()

    @staticmethod
    def delete_documents(dataset: Dataset, document_ids: list[str]):
        documents = db.session.query(Document).filter(Document.id.in_(document_ids)).all()
        file_ids = [
            document.data_source_info_dict["upload_file_id"]
            for document in documents
            if document.data_source_type == "upload_file"
        ]
        batch_clean_document_task.delay(document_ids, dataset.id, dataset.doc_form, file_ids)

        for document in documents:
            db.session.delete(document)
        db.session.commit()

    @staticmethod
    def rename_document(dataset_id: str, document_id: str, name: str) -> Document:
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise ValueError("Dataset not found.")

        document = DocumentService.get_document(dataset_id, document_id)

        if not document:
            raise ValueError("Document not found.")

        if document.tenant_id != current_user.current_tenant_id:
            raise ValueError("No permission.")

        if dataset.built_in_field_enabled:
            if document.doc_metadata:
                doc_metadata = copy.deepcopy(document.doc_metadata)
                doc_metadata[BuiltInField.document_name.value] = name
                document.doc_metadata = doc_metadata

        document.name = name
        db.session.add(document)
        db.session.commit()

        return document

    @staticmethod
    def pause_document(document):
        if document.indexing_status not in {"waiting", "parsing", "cleaning", "splitting", "indexing"}:
            raise DocumentIndexingError()
        # update document to be paused
        document.is_paused = True
        document.paused_by = current_user.id
        document.paused_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)

        db.session.add(document)
        db.session.commit()
        # set document paused flag
        indexing_cache_key = "document_{}_is_paused".format(document.id)
        redis_client.setnx(indexing_cache_key, "True")

    @staticmethod
    def recover_document(document):
        if not document.is_paused:
            raise DocumentIndexingError()
        # update document to be recover
        document.is_paused = False
        document.paused_by = None
        document.paused_at = None

        db.session.add(document)
        db.session.commit()
        # delete paused flag
        indexing_cache_key = "document_{}_is_paused".format(document.id)
        redis_client.delete(indexing_cache_key)
        # trigger async task
        recover_document_indexing_task.delay(document.dataset_id, document.id)

    @staticmethod
    def retry_document(dataset_id: str, documents: list[Document]):
        for document in documents:
            # add retry flag
            retry_indexing_cache_key = "document_{}_is_retried".format(document.id)
            cache_result = redis_client.get(retry_indexing_cache_key)
            if cache_result is not None:
                raise ValueError("Document is being retried, please try again later")
            # retry document indexing
            document.indexing_status = "waiting"
            db.session.add(document)
            db.session.commit()

            redis_client.setex(retry_indexing_cache_key, 600, 1)
        # trigger async task
        document_ids = [document.id for document in documents]
        retry_document_indexing_task.delay(dataset_id, document_ids)

    @staticmethod
    def sync_website_document(dataset_id: str, document: Document):
        # add sync flag
        sync_indexing_cache_key = "document_{}_is_sync".format(document.id)
        cache_result = redis_client.get(sync_indexing_cache_key)
        if cache_result is not None:
            raise ValueError("Document is being synced, please try again later")
        # sync document indexing
        document.indexing_status = "waiting"
        data_source_info = document.data_source_info_dict
        data_source_info["mode"] = "scrape"
        document.data_source_info = json.dumps(data_source_info, ensure_ascii=False)
        db.session.add(document)
        db.session.commit()

        redis_client.setex(sync_indexing_cache_key, 600, 1)

        sync_website_document_indexing_task.delay(dataset_id, document.id)

    @staticmethod
    def get_documents_position(dataset_id):
        document = Document.query.filter_by(dataset_id=dataset_id).order_by(Document.position.desc()).first()
        if document:
            return document.position + 1
        else:
            return 1

    @staticmethod
    def save_document_with_dataset_id(
        dataset: Dataset,
        knowledge_config: KnowledgeConfig,
        account: Account | Any,
        dataset_process_rule: Optional[DatasetProcessRule] = None,
        created_from: str = "web",
    ):
        # check document limit
        features = FeatureService.get_features(current_user.current_tenant_id)

        if features.billing.enabled:
            if not knowledge_config.original_document_id:
                count = 0
                if knowledge_config.data_source:
                    if knowledge_config.data_source.info_list.data_source_type == "upload_file":
                        upload_file_list = knowledge_config.data_source.info_list.file_info_list.file_ids  # type: ignore
                        count = len(upload_file_list)
                    elif knowledge_config.data_source.info_list.data_source_type == "notion_import":
                        notion_info_list = knowledge_config.data_source.info_list.notion_info_list
                        for notion_info in notion_info_list:  # type: ignore
                            count = count + len(notion_info.pages)
                    elif knowledge_config.data_source.info_list.data_source_type == "website_crawl":
                        website_info = knowledge_config.data_source.info_list.website_info_list
                        count = len(website_info.urls)  # type: ignore
                    batch_upload_limit = int(dify_config.BATCH_UPLOAD_LIMIT)

                    if features.billing.subscription.plan == "sandbox" and count > 1:
                        raise ValueError("Your current plan does not support batch upload, please upgrade your plan.")
                    if count > batch_upload_limit:
                        raise ValueError(f"You have reached the batch upload limit of {batch_upload_limit}.")

                    DocumentService.check_documents_upload_quota(count, features)

        # if dataset is empty, update dataset data_source_type
        if not dataset.data_source_type:
            dataset.data_source_type = knowledge_config.data_source.info_list.data_source_type  # type: ignore

        if not dataset.indexing_technique:
            if knowledge_config.indexing_technique not in Dataset.INDEXING_TECHNIQUE_LIST:
                raise ValueError("Indexing technique is invalid")

            dataset.indexing_technique = knowledge_config.indexing_technique
            if knowledge_config.indexing_technique == "high_quality":
                model_manager = ModelManager()
                if knowledge_config.embedding_model and knowledge_config.embedding_model_provider:
                    dataset_embedding_model = knowledge_config.embedding_model
                    dataset_embedding_model_provider = knowledge_config.embedding_model_provider
                else:
                    embedding_model = model_manager.get_default_model_instance(
                        tenant_id=current_user.current_tenant_id, model_type=ModelType.TEXT_EMBEDDING
                    )
                    dataset_embedding_model = embedding_model.model
                    dataset_embedding_model_provider = embedding_model.provider
                dataset.embedding_model = dataset_embedding_model
                dataset.embedding_model_provider = dataset_embedding_model_provider
                dataset_collection_binding = DatasetCollectionBindingService.get_dataset_collection_binding(
                    dataset_embedding_model_provider, dataset_embedding_model
                )
                dataset.collection_binding_id = dataset_collection_binding.id
                if not dataset.retrieval_model:
                    default_retrieval_model = {
                        "search_method": RetrievalMethod.SEMANTIC_SEARCH.value,
                        "reranking_enable": False,
                        "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
                        "top_k": 2,
                        "score_threshold_enabled": False,
                    }

                dataset.retrieval_model = (
                    knowledge_config.retrieval_model.model_dump()
                    if knowledge_config.retrieval_model
                    else default_retrieval_model
                )  # type: ignore

        documents = []
        if knowledge_config.original_document_id:
            document = DocumentService.update_document_with_dataset_id(dataset, knowledge_config, account)
            documents.append(document)
            batch = document.batch
        else:
            batch = time.strftime("%Y%m%d%H%M%S") + str(random.randint(100000, 999999))
            # save process rule
            if not dataset_process_rule:
                process_rule = knowledge_config.process_rule
                if process_rule:
                    if process_rule.mode in ("custom", "hierarchical"):
                        dataset_process_rule = DatasetProcessRule(
                            dataset_id=dataset.id,
                            mode=process_rule.mode,
                            rules=process_rule.rules.model_dump_json() if process_rule.rules else None,
                            created_by=account.id,
                        )
                    elif process_rule.mode == "automatic":
                        dataset_process_rule = DatasetProcessRule(
                            dataset_id=dataset.id,
                            mode=process_rule.mode,
                            rules=json.dumps(DatasetProcessRule.AUTOMATIC_RULES),
                            created_by=account.id,
                        )
                    else:
                        logging.warn(
                            f"Invalid process rule mode: {process_rule.mode}, can not find dataset process rule"
                        )
                        return
                    db.session.add(dataset_process_rule)
                    db.session.commit()
            lock_name = "add_document_lock_dataset_id_{}".format(dataset.id)
            with redis_client.lock(lock_name, timeout=600):
                position = DocumentService.get_documents_position(dataset.id)
                document_ids = []
                duplicate_document_ids = []
                if knowledge_config.data_source.info_list.data_source_type == "upload_file":  # type: ignore
                    upload_file_list = knowledge_config.data_source.info_list.file_info_list.file_ids  # type: ignore
                    for file_id in upload_file_list:
                        file = (
                            db.session.query(UploadFile)
                            .filter(UploadFile.tenant_id == dataset.tenant_id, UploadFile.id == file_id)
                            .first()
                        )

                        # raise error if file not found
                        if not file:
                            raise FileNotExistsError()

                        file_name = file.name
                        data_source_info = {
                            "upload_file_id": file_id,
                        }
                        # check duplicate
                        if knowledge_config.duplicate:
                            document = Document.query.filter_by(
                                dataset_id=dataset.id,
                                tenant_id=current_user.current_tenant_id,
                                data_source_type="upload_file",
                                enabled=True,
                                name=file_name,
                            ).first()
                            if document:
                                document.dataset_process_rule_id = dataset_process_rule.id  # type: ignore
                                document.updated_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
                                document.created_from = created_from
                                document.doc_form = knowledge_config.doc_form
                                document.doc_language = knowledge_config.doc_language
                                document.data_source_info = json.dumps(data_source_info)
                                document.batch = batch
                                document.indexing_status = "waiting"
                                db.session.add(document)
                                documents.append(document)
                                duplicate_document_ids.append(document.id)
                                continue
                        document = DocumentService.build_document(
                            dataset,
                            dataset_process_rule.id,  # type: ignore
                            knowledge_config.data_source.info_list.data_source_type,  # type: ignore
                            knowledge_config.doc_form,
                            knowledge_config.doc_language,
                            data_source_info,
                            created_from,
                            position,
                            account,
                            file_name,
                            batch,
                        )
                        db.session.add(document)
                        db.session.flush()
                        document_ids.append(document.id)
                        documents.append(document)
                        position += 1
                elif knowledge_config.data_source.info_list.data_source_type == "notion_import":  # type: ignore
                    notion_info_list = knowledge_config.data_source.info_list.notion_info_list  # type: ignore
                    if not notion_info_list:
                        raise ValueError("No notion info list found.")
                    exist_page_ids = []
                    exist_document = {}
                    documents = Document.query.filter_by(
                        dataset_id=dataset.id,
                        tenant_id=current_user.current_tenant_id,
                        data_source_type="notion_import",
                        enabled=True,
                    ).all()
                    if documents:
                        for document in documents:
                            data_source_info = json.loads(document.data_source_info)
                            exist_page_ids.append(data_source_info["notion_page_id"])
                            exist_document[data_source_info["notion_page_id"]] = document.id
                    for notion_info in notion_info_list:
                        workspace_id = notion_info.workspace_id
                        data_source_binding = DataSourceOauthBinding.query.filter(
                            db.and_(
                                DataSourceOauthBinding.tenant_id == current_user.current_tenant_id,
                                DataSourceOauthBinding.provider == "notion",
                                DataSourceOauthBinding.disabled == False,
                                DataSourceOauthBinding.source_info["workspace_id"] == f'"{workspace_id}"',
                            )
                        ).first()
                        if not data_source_binding:
                            raise ValueError("Data source binding not found.")
                        for page in notion_info.pages:
                            if page.page_id not in exist_page_ids:
                                data_source_info = {
                                    "notion_workspace_id": workspace_id,
                                    "notion_page_id": page.page_id,
                                    "notion_page_icon": page.page_icon.model_dump() if page.page_icon else None,
                                    "type": page.type,
                                }
                                # Truncate page name to 255 characters to prevent DB field length errors
                                truncated_page_name = page.page_name[:255] if page.page_name else "nopagename"
                                document = DocumentService.build_document(
                                    dataset,
                                    dataset_process_rule.id,  # type: ignore
                                    knowledge_config.data_source.info_list.data_source_type,  # type: ignore
                                    knowledge_config.doc_form,
                                    knowledge_config.doc_language,
                                    data_source_info,
                                    created_from,
                                    position,
                                    account,
                                    truncated_page_name,
                                    batch,
                                )
                                db.session.add(document)
                                db.session.flush()
                                document_ids.append(document.id)
                                documents.append(document)
                                position += 1
                            else:
                                exist_document.pop(page.page_id)
                    # delete not selected documents
                    if len(exist_document) > 0:
                        clean_notion_document_task.delay(list(exist_document.values()), dataset.id)
                elif knowledge_config.data_source.info_list.data_source_type == "website_crawl":  # type: ignore
                    website_info = knowledge_config.data_source.info_list.website_info_list  # type: ignore
                    if not website_info:
                        raise ValueError("No website info list found.")
                    urls = website_info.urls
                    for url in urls:
                        data_source_info = {
                            "url": url,
                            "provider": website_info.provider,
                            "job_id": website_info.job_id,
                            "only_main_content": website_info.only_main_content,
                            "mode": "crawl",
                        }
                        if len(url) > 255:
                            document_name = url[:200] + "..."
                        else:
                            document_name = url
                        document = DocumentService.build_document(
                            dataset,
                            dataset_process_rule.id,  # type: ignore
                            knowledge_config.data_source.info_list.data_source_type,  # type: ignore
                            knowledge_config.doc_form,
                            knowledge_config.doc_language,
                            data_source_info,
                            created_from,
                            position,
                            account,
                            document_name,
                            batch,
                        )
                        db.session.add(document)
                        db.session.flush()
                        document_ids.append(document.id)
                        documents.append(document)
                        position += 1
                db.session.commit()

                # trigger async task
                if document_ids:
                    document_indexing_task.delay(dataset.id, document_ids)
                if duplicate_document_ids:
                    duplicate_document_indexing_task.delay(dataset.id, duplicate_document_ids)

        return documents, batch

    @staticmethod
    def check_documents_upload_quota(count: int, features: FeatureModel):
        can_upload_size = features.documents_upload_quota.limit - features.documents_upload_quota.size
        if count > can_upload_size:
            raise ValueError(
                f"You have reached the limit of your subscription. Only {can_upload_size} documents can be uploaded."
            )

    @staticmethod
    def build_document(
        dataset: Dataset,
        process_rule_id: str,
        data_source_type: str,
        document_form: str,
        document_language: str,
        data_source_info: dict,
        created_from: str,
        position: int,
        account: Account,
        name: str,
        batch: str,
    ):
        document = Document(
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            position=position,
            data_source_type=data_source_type,
            data_source_info=json.dumps(data_source_info),
            dataset_process_rule_id=process_rule_id,
            batch=batch,
            name=name,
            created_from=created_from,
            created_by=account.id,
            doc_form=document_form,
            doc_language=document_language,
        )
        doc_metadata = {}
        if dataset.built_in_field_enabled:
            doc_metadata = {
                BuiltInField.document_name: name,
                BuiltInField.uploader: account.name,
                BuiltInField.upload_date: datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%d %H:%M:%S"),
                BuiltInField.last_update_date: datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%d %H:%M:%S"),
                BuiltInField.source: data_source_type,
            }
        if doc_metadata:
            document.doc_metadata = doc_metadata
        return document

    @staticmethod
    def get_tenant_documents_count():
        documents_count = Document.query.filter(
            Document.completed_at.isnot(None),
            Document.enabled == True,
            Document.archived == False,
            Document.tenant_id == current_user.current_tenant_id,
        ).count()
        return documents_count

    @staticmethod
    def update_document_with_dataset_id(
        dataset: Dataset,
        document_data: KnowledgeConfig,
        account: Account,
        dataset_process_rule: Optional[DatasetProcessRule] = None,
        created_from: str = "web",
    ):
        DatasetService.check_dataset_model_setting(dataset)
        document = DocumentService.get_document(dataset.id, document_data.original_document_id)
        if document is None:
            raise NotFound("Document not found")
        if document.display_status != "available":
            raise ValueError("Document is not available")
        # save process rule
        if document_data.process_rule:
            process_rule = document_data.process_rule
            if process_rule.mode in {"custom", "hierarchical"}:
                dataset_process_rule = DatasetProcessRule(
                    dataset_id=dataset.id,
                    mode=process_rule.mode,
                    rules=process_rule.rules.model_dump_json() if process_rule.rules else None,
                    created_by=account.id,
                )
            elif process_rule.mode == "automatic":
                dataset_process_rule = DatasetProcessRule(
                    dataset_id=dataset.id,
                    mode=process_rule.mode,
                    rules=json.dumps(DatasetProcessRule.AUTOMATIC_RULES),
                    created_by=account.id,
                )
            if dataset_process_rule is not None:
                db.session.add(dataset_process_rule)
                db.session.commit()
                document.dataset_process_rule_id = dataset_process_rule.id
        # update document data source
        if document_data.data_source:
            file_name = ""
            data_source_info = {}
            if document_data.data_source.info_list.data_source_type == "upload_file":
                if not document_data.data_source.info_list.file_info_list:
                    raise ValueError("No file info list found.")
                upload_file_list = document_data.data_source.info_list.file_info_list.file_ids
                for file_id in upload_file_list:
                    file = (
                        db.session.query(UploadFile)
                        .filter(UploadFile.tenant_id == dataset.tenant_id, UploadFile.id == file_id)
                        .first()
                    )

                    # raise error if file not found
                    if not file:
                        raise FileNotExistsError()

                    file_name = file.name
                    data_source_info = {
                        "upload_file_id": file_id,
                    }
            elif document_data.data_source.info_list.data_source_type == "notion_import":
                if not document_data.data_source.info_list.notion_info_list:
                    raise ValueError("No notion info list found.")
                notion_info_list = document_data.data_source.info_list.notion_info_list
                for notion_info in notion_info_list:
                    workspace_id = notion_info.workspace_id
                    data_source_binding = DataSourceOauthBinding.query.filter(
                        db.and_(
                            DataSourceOauthBinding.tenant_id == current_user.current_tenant_id,
                            DataSourceOauthBinding.provider == "notion",
                            DataSourceOauthBinding.disabled == False,
                            DataSourceOauthBinding.source_info["workspace_id"] == f'"{workspace_id}"',
                        )
                    ).first()
                    if not data_source_binding:
                        raise ValueError("Data source binding not found.")
                    for page in notion_info.pages:
                        data_source_info = {
                            "notion_workspace_id": workspace_id,
                            "notion_page_id": page.page_id,
                            "notion_page_icon": page.page_icon.model_dump() if page.page_icon else None,  # type: ignore
                            "type": page.type,
                        }
            elif document_data.data_source.info_list.data_source_type == "website_crawl":
                website_info = document_data.data_source.info_list.website_info_list
                if website_info:
                    urls = website_info.urls
                    for url in urls:
                        data_source_info = {
                            "url": url,
                            "provider": website_info.provider,
                            "job_id": website_info.job_id,
                            "only_main_content": website_info.only_main_content,  # type: ignore
                            "mode": "crawl",
                        }
            document.data_source_type = document_data.data_source.info_list.data_source_type
            document.data_source_info = json.dumps(data_source_info)
            document.name = file_name

        # update document name
        if document_data.name:
            document.name = document_data.name
        # update document to be waiting
        document.indexing_status = "waiting"
        document.completed_at = None
        document.processing_started_at = None
        document.parsing_completed_at = None
        document.cleaning_completed_at = None
        document.splitting_completed_at = None
        document.updated_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
        document.created_from = created_from
        document.doc_form = document_data.doc_form
        db.session.add(document)
        db.session.commit()
        # update document segment
        update_params = {DocumentSegment.status: "re_segment"}
        DocumentSegment.query.filter_by(document_id=document.id).update(update_params)
        db.session.commit()
        # trigger async task
        document_indexing_update_task.delay(document.dataset_id, document.id)
        return document

    @staticmethod
    def save_document_without_dataset_id(tenant_id: str, knowledge_config: KnowledgeConfig, account: Account):
        features = FeatureService.get_features(current_user.current_tenant_id)

        if features.billing.enabled:
            count = 0
            if knowledge_config.data_source.info_list.data_source_type == "upload_file":  # type: ignore
                upload_file_list = (
                    knowledge_config.data_source.info_list.file_info_list.file_ids  # type: ignore
                    if knowledge_config.data_source.info_list.file_info_list  # type: ignore
                    else []
                )
                count = len(upload_file_list)
            elif knowledge_config.data_source.info_list.data_source_type == "notion_import":  # type: ignore
                notion_info_list = knowledge_config.data_source.info_list.notion_info_list  # type: ignore
                if notion_info_list:
                    for notion_info in notion_info_list:
                        count = count + len(notion_info.pages)
            elif knowledge_config.data_source.info_list.data_source_type == "website_crawl":  # type: ignore
                website_info = knowledge_config.data_source.info_list.website_info_list  # type: ignore
                if website_info:
                    count = len(website_info.urls)
            if features.billing.subscription.plan == "sandbox" and count > 1:
                raise ValueError("Your current plan does not support batch upload, please upgrade your plan.")
            batch_upload_limit = int(dify_config.BATCH_UPLOAD_LIMIT)
            if count > batch_upload_limit:
                raise ValueError(f"You have reached the batch upload limit of {batch_upload_limit}.")

            DocumentService.check_documents_upload_quota(count, features)

        dataset_collection_binding_id = None
        retrieval_model = None
        if knowledge_config.indexing_technique == "high_quality":
            dataset_collection_binding = DatasetCollectionBindingService.get_dataset_collection_binding(
                knowledge_config.embedding_model_provider,  # type: ignore
                knowledge_config.embedding_model,  # type: ignore
            )
            dataset_collection_binding_id = dataset_collection_binding.id
            if knowledge_config.retrieval_model:
                retrieval_model = knowledge_config.retrieval_model
            else:
                retrieval_model = RetrievalModel(
                    search_method=RetrievalMethod.SEMANTIC_SEARCH.value,
                    reranking_enable=False,
                    reranking_model=RerankingModel(reranking_provider_name="", reranking_model_name=""),
                    top_k=2,
                    score_threshold_enabled=False,
                )
        # save dataset
        dataset = Dataset(
            tenant_id=tenant_id,
            name="",
            data_source_type=knowledge_config.data_source.info_list.data_source_type,  # type: ignore
            indexing_technique=knowledge_config.indexing_technique,
            created_by=account.id,
            embedding_model=knowledge_config.embedding_model,
            embedding_model_provider=knowledge_config.embedding_model_provider,
            collection_binding_id=dataset_collection_binding_id,
            retrieval_model=retrieval_model.model_dump() if retrieval_model else None,
        )

        db.session.add(dataset)  # type: ignore
        db.session.flush()

        documents, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

        cut_length = 18
        cut_name = documents[0].name[:cut_length]
        dataset.name = cut_name + "..."
        dataset.description = "useful for when you want to answer queries about the " + documents[0].name
        db.session.commit()

        return dataset, documents, batch

    @classmethod
    def document_create_args_validate(cls, knowledge_config: KnowledgeConfig):
        if not knowledge_config.data_source and not knowledge_config.process_rule:
            raise ValueError("Data source or Process rule is required")
        else:
            if knowledge_config.data_source:
                DocumentService.data_source_args_validate(knowledge_config)
            if knowledge_config.process_rule:
                DocumentService.process_rule_args_validate(knowledge_config)

    @classmethod
    def data_source_args_validate(cls, knowledge_config: KnowledgeConfig):
        if not knowledge_config.data_source:
            raise ValueError("Data source is required")

        if knowledge_config.data_source.info_list.data_source_type not in Document.DATA_SOURCES:
            raise ValueError("Data source type is invalid")

        if not knowledge_config.data_source.info_list:
            raise ValueError("Data source info is required")

        if knowledge_config.data_source.info_list.data_source_type == "upload_file":
            if not knowledge_config.data_source.info_list.file_info_list:
                raise ValueError("File source info is required")
        if knowledge_config.data_source.info_list.data_source_type == "notion_import":
            if not knowledge_config.data_source.info_list.notion_info_list:
                raise ValueError("Notion source info is required")
        if knowledge_config.data_source.info_list.data_source_type == "website_crawl":
            if not knowledge_config.data_source.info_list.website_info_list:
                raise ValueError("Website source info is required")

    @classmethod
    def process_rule_args_validate(cls, knowledge_config: KnowledgeConfig):
        if not knowledge_config.process_rule:
            raise ValueError("Process rule is required")

        if not knowledge_config.process_rule.mode:
            raise ValueError("Process rule mode is required")

        if knowledge_config.process_rule.mode not in DatasetProcessRule.MODES:
            raise ValueError("Process rule mode is invalid")

        if knowledge_config.process_rule.mode == "automatic":
            knowledge_config.process_rule.rules = None
        else:
            if not knowledge_config.process_rule.rules:
                raise ValueError("Process rule rules is required")

            if knowledge_config.process_rule.rules.pre_processing_rules is None:
                raise ValueError("Process rule pre_processing_rules is required")

            unique_pre_processing_rule_dicts = {}
            for pre_processing_rule in knowledge_config.process_rule.rules.pre_processing_rules:
                if not pre_processing_rule.id:
                    raise ValueError("Process rule pre_processing_rules id is required")

                if not isinstance(pre_processing_rule.enabled, bool):
                    raise ValueError("Process rule pre_processing_rules enabled is invalid")

                unique_pre_processing_rule_dicts[pre_processing_rule.id] = pre_processing_rule

            knowledge_config.process_rule.rules.pre_processing_rules = list(unique_pre_processing_rule_dicts.values())

            if not knowledge_config.process_rule.rules.segmentation:
                raise ValueError("Process rule segmentation is required")

            if not knowledge_config.process_rule.rules.segmentation.separator:
                raise ValueError("Process rule segmentation separator is required")

            if not isinstance(knowledge_config.process_rule.rules.segmentation.separator, str):
                raise ValueError("Process rule segmentation separator is invalid")

            if not (
                knowledge_config.process_rule.mode == "hierarchical"
                and knowledge_config.process_rule.rules.parent_mode == "full-doc"
            ):
                if not knowledge_config.process_rule.rules.segmentation.max_tokens:
                    raise ValueError("Process rule segmentation max_tokens is required")

                if not isinstance(knowledge_config.process_rule.rules.segmentation.max_tokens, int):
                    raise ValueError("Process rule segmentation max_tokens is invalid")

    @classmethod
    def estimate_args_validate(cls, args: dict):
        if "info_list" not in args or not args["info_list"]:
            raise ValueError("Data source info is required")

        if not isinstance(args["info_list"], dict):
            raise ValueError("Data info is invalid")

        if "process_rule" not in args or not args["process_rule"]:
            raise ValueError("Process rule is required")

        if not isinstance(args["process_rule"], dict):
            raise ValueError("Process rule is invalid")

        if "mode" not in args["process_rule"] or not args["process_rule"]["mode"]:
            raise ValueError("Process rule mode is required")

        if args["process_rule"]["mode"] not in DatasetProcessRule.MODES:
            raise ValueError("Process rule mode is invalid")

        if args["process_rule"]["mode"] == "automatic":
            args["process_rule"]["rules"] = {}
        else:
            if "rules" not in args["process_rule"] or not args["process_rule"]["rules"]:
                raise ValueError("Process rule rules is required")

            if not isinstance(args["process_rule"]["rules"], dict):
                raise ValueError("Process rule rules is invalid")

            if (
                "pre_processing_rules" not in args["process_rule"]["rules"]
                or args["process_rule"]["rules"]["pre_processing_rules"] is None
            ):
                raise ValueError("Process rule pre_processing_rules is required")

            if not isinstance(args["process_rule"]["rules"]["pre_processing_rules"], list):
                raise ValueError("Process rule pre_processing_rules is invalid")

            unique_pre_processing_rule_dicts = {}
            for pre_processing_rule in args["process_rule"]["rules"]["pre_processing_rules"]:
                if "id" not in pre_processing_rule or not pre_processing_rule["id"]:
                    raise ValueError("Process rule pre_processing_rules id is required")

                if pre_processing_rule["id"] not in DatasetProcessRule.PRE_PROCESSING_RULES:
                    raise ValueError("Process rule pre_processing_rules id is invalid")

                if "enabled" not in pre_processing_rule or pre_processing_rule["enabled"] is None:
                    raise ValueError("Process rule pre_processing_rules enabled is required")

                if not isinstance(pre_processing_rule["enabled"], bool):
                    raise ValueError("Process rule pre_processing_rules enabled is invalid")

                unique_pre_processing_rule_dicts[pre_processing_rule["id"]] = pre_processing_rule

            args["process_rule"]["rules"]["pre_processing_rules"] = list(unique_pre_processing_rule_dicts.values())

            if (
                "segmentation" not in args["process_rule"]["rules"]
                or args["process_rule"]["rules"]["segmentation"] is None
            ):
                raise ValueError("Process rule segmentation is required")

            if not isinstance(args["process_rule"]["rules"]["segmentation"], dict):
                raise ValueError("Process rule segmentation is invalid")

            if (
                "separator" not in args["process_rule"]["rules"]["segmentation"]
                or not args["process_rule"]["rules"]["segmentation"]["separator"]
            ):
                raise ValueError("Process rule segmentation separator is required")

            if not isinstance(args["process_rule"]["rules"]["segmentation"]["separator"], str):
                raise ValueError("Process rule segmentation separator is invalid")

            if (
                "max_tokens" not in args["process_rule"]["rules"]["segmentation"]
                or not args["process_rule"]["rules"]["segmentation"]["max_tokens"]
            ):
                raise ValueError("Process rule segmentation max_tokens is required")

            if not isinstance(args["process_rule"]["rules"]["segmentation"]["max_tokens"], int):
                raise ValueError("Process rule segmentation max_tokens is invalid")


class SegmentService:
    @classmethod
    def segment_create_args_validate(cls, args: dict, document: Document):
        if document.doc_form == "qa_model":
            if "answer" not in args or not args["answer"]:
                raise ValueError("Answer is required")
            if not args["answer"].strip():
                raise ValueError("Answer is empty")
        if "content" not in args or not args["content"] or not args["content"].strip():
            raise ValueError("Content is empty")

    @classmethod
    def create_segment(cls, args: dict, document: Document, dataset: Dataset):
        content = args["content"]
        doc_id = str(uuid.uuid4())
        segment_hash = helper.generate_text_hash(content)
        tokens = 0
        if dataset.indexing_technique == "high_quality":
            model_manager = ModelManager()
            embedding_model = model_manager.get_model_instance(
                tenant_id=current_user.current_tenant_id,
                provider=dataset.embedding_model_provider,
                model_type=ModelType.TEXT_EMBEDDING,
                model=dataset.embedding_model,
            )
            # calc embedding use tokens
            tokens = embedding_model.get_text_embedding_num_tokens(texts=[content])[0]
        lock_name = "add_segment_lock_document_id_{}".format(document.id)
        with redis_client.lock(lock_name, timeout=600):
            max_position = (
                db.session.query(func.max(DocumentSegment.position))
                .filter(DocumentSegment.document_id == document.id)
                .scalar()
            )
            segment_document = DocumentSegment(
                tenant_id=current_user.current_tenant_id,
                dataset_id=document.dataset_id,
                document_id=document.id,
                index_node_id=doc_id,
                index_node_hash=segment_hash,
                position=max_position + 1 if max_position else 1,
                content=content,
                word_count=len(content),
                tokens=tokens,
                status="completed",
                indexing_at=datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
                completed_at=datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
                created_by=current_user.id,
            )
            if document.doc_form == "qa_model":
                segment_document.word_count += len(args["answer"])
                segment_document.answer = args["answer"]

            db.session.add(segment_document)
            # update document word count
            document.word_count += segment_document.word_count
            db.session.add(document)
            db.session.commit()

            # save vector index
            try:
                VectorService.create_segments_vector([args["keywords"]], [segment_document], dataset, document.doc_form)
            except Exception as e:
                logging.exception("create segment index failed")
                segment_document.enabled = False
                segment_document.disabled_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
                segment_document.status = "error"
                segment_document.error = str(e)
                db.session.commit()
            segment = db.session.query(DocumentSegment).filter(DocumentSegment.id == segment_document.id).first()
            return segment

    @classmethod
    def multi_create_segment(cls, segments: list, document: Document, dataset: Dataset):
        lock_name = "multi_add_segment_lock_document_id_{}".format(document.id)
        increment_word_count = 0
        with redis_client.lock(lock_name, timeout=600):
            embedding_model = None
            if dataset.indexing_technique == "high_quality":
                model_manager = ModelManager()
                embedding_model = model_manager.get_model_instance(
                    tenant_id=current_user.current_tenant_id,
                    provider=dataset.embedding_model_provider,
                    model_type=ModelType.TEXT_EMBEDDING,
                    model=dataset.embedding_model,
                )
            max_position = (
                db.session.query(func.max(DocumentSegment.position))
                .filter(DocumentSegment.document_id == document.id)
                .scalar()
            )
            pre_segment_data_list = []
            segment_data_list = []
            keywords_list = []
            position = max_position + 1 if max_position else 1
            for segment_item in segments:
                content = segment_item["content"]
                doc_id = str(uuid.uuid4())
                segment_hash = helper.generate_text_hash(content)
                tokens = 0
                if dataset.indexing_technique == "high_quality" and embedding_model:
                    # calc embedding use tokens
                    if document.doc_form == "qa_model":
                        tokens = embedding_model.get_text_embedding_num_tokens(
                            texts=[content + segment_item["answer"]]
                        )[0]
                    else:
                        tokens = embedding_model.get_text_embedding_num_tokens(texts=[content])[0]

                segment_document = DocumentSegment(
                    tenant_id=current_user.current_tenant_id,
                    dataset_id=document.dataset_id,
                    document_id=document.id,
                    index_node_id=doc_id,
                    index_node_hash=segment_hash,
                    position=position,
                    content=content,
                    word_count=len(content),
                    tokens=tokens,
                    keywords=segment_item.get("keywords", []),
                    status="completed",
                    indexing_at=datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
                    completed_at=datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
                    created_by=current_user.id,
                )
                if document.doc_form == "qa_model":
                    segment_document.answer = segment_item["answer"]
                    segment_document.word_count += len(segment_item["answer"])
                increment_word_count += segment_document.word_count
                db.session.add(segment_document)
                segment_data_list.append(segment_document)
                position += 1

                pre_segment_data_list.append(segment_document)
                if "keywords" in segment_item:
                    keywords_list.append(segment_item["keywords"])
                else:
                    keywords_list.append(None)
            # update document word count
            document.word_count += increment_word_count
            db.session.add(document)
            try:
                # save vector index
                VectorService.create_segments_vector(keywords_list, pre_segment_data_list, dataset, document.doc_form)
            except Exception as e:
                logging.exception("create segment index failed")
                for segment_document in segment_data_list:
                    segment_document.enabled = False
                    segment_document.disabled_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
                    segment_document.status = "error"
                    segment_document.error = str(e)
            db.session.commit()
            return segment_data_list

    @classmethod
    def update_segment(cls, args: SegmentUpdateArgs, segment: DocumentSegment, document: Document, dataset: Dataset):
        indexing_cache_key = "segment_{}_indexing".format(segment.id)
        cache_result = redis_client.get(indexing_cache_key)
        if cache_result is not None:
            raise ValueError("Segment is indexing, please try again later")
        if args.enabled is not None:
            action = args.enabled
            if segment.enabled != action:
                if not action:
                    segment.enabled = action
                    segment.disabled_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
                    segment.disabled_by = current_user.id
                    db.session.add(segment)
                    db.session.commit()
                    # Set cache to prevent indexing the same segment multiple times
                    redis_client.setex(indexing_cache_key, 600, 1)
                    disable_segment_from_index_task.delay(segment.id)
                    return segment
        if not segment.enabled:
            if args.enabled is not None:
                if not args.enabled:
                    raise ValueError("Can't update disabled segment")
            else:
                raise ValueError("Can't update disabled segment")
        try:
            word_count_change = segment.word_count
            content = args.content or segment.content
            if segment.content == content:
                segment.word_count = len(content)
                if document.doc_form == "qa_model":
                    segment.answer = args.answer
                    segment.word_count += len(args.answer) if args.answer else 0
                word_count_change = segment.word_count - word_count_change
                keyword_changed = False
                if args.keywords:
                    if Counter(segment.keywords) != Counter(args.keywords):
                        segment.keywords = args.keywords
                        keyword_changed = True
                segment.enabled = True
                segment.disabled_at = None
                segment.disabled_by = None
                db.session.add(segment)
                db.session.commit()
                # update document word count
                if word_count_change != 0:
                    document.word_count = max(0, document.word_count + word_count_change)
                    db.session.add(document)
                # update segment index task
                if document.doc_form == IndexType.PARENT_CHILD_INDEX and args.regenerate_child_chunks:
                    # regenerate child chunks
                    # get embedding model instance
                    if dataset.indexing_technique == "high_quality":
                        # check embedding model setting
                        model_manager = ModelManager()

                        if dataset.embedding_model_provider:
                            embedding_model_instance = model_manager.get_model_instance(
                                tenant_id=dataset.tenant_id,
                                provider=dataset.embedding_model_provider,
                                model_type=ModelType.TEXT_EMBEDDING,
                                model=dataset.embedding_model,
                            )
                        else:
                            embedding_model_instance = model_manager.get_default_model_instance(
                                tenant_id=dataset.tenant_id,
                                model_type=ModelType.TEXT_EMBEDDING,
                            )
                    else:
                        raise ValueError("The knowledge base index technique is not high quality!")
                    # get the process rule
                    processing_rule = (
                        db.session.query(DatasetProcessRule)
                        .filter(DatasetProcessRule.id == document.dataset_process_rule_id)
                        .first()
                    )
                    if not processing_rule:
                        raise ValueError("No processing rule found.")
                    VectorService.generate_child_chunks(
                        segment, document, dataset, embedding_model_instance, processing_rule, True
                    )
                elif document.doc_form in (IndexType.PARAGRAPH_INDEX, IndexType.QA_INDEX):
                    if args.enabled or keyword_changed:
                        # update segment vector index
                        VectorService.update_segment_vector(args.keywords, segment, dataset)
            else:
                segment_hash = helper.generate_text_hash(content)
                tokens = 0
                if dataset.indexing_technique == "high_quality":
                    model_manager = ModelManager()
                    embedding_model = model_manager.get_model_instance(
                        tenant_id=current_user.current_tenant_id,
                        provider=dataset.embedding_model_provider,
                        model_type=ModelType.TEXT_EMBEDDING,
                        model=dataset.embedding_model,
                    )

                    # calc embedding use tokens
                    if document.doc_form == "qa_model":
                        tokens = embedding_model.get_text_embedding_num_tokens(texts=[content + segment.answer])[0]
                    else:
                        tokens = embedding_model.get_text_embedding_num_tokens(texts=[content])[0]
                segment.content = content
                segment.index_node_hash = segment_hash
                segment.word_count = len(content)
                segment.tokens = tokens
                segment.status = "completed"
                segment.indexing_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
                segment.completed_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
                segment.updated_by = current_user.id
                segment.updated_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
                segment.enabled = True
                segment.disabled_at = None
                segment.disabled_by = None
                if document.doc_form == "qa_model":
                    segment.answer = args.answer
                    segment.word_count += len(args.answer) if args.answer else 0
                word_count_change = segment.word_count - word_count_change
                # update document word count
                if word_count_change != 0:
                    document.word_count = max(0, document.word_count + word_count_change)
                    db.session.add(document)
                db.session.add(segment)
                db.session.commit()
                if document.doc_form == IndexType.PARENT_CHILD_INDEX and args.regenerate_child_chunks:
                    # get embedding model instance
                    if dataset.indexing_technique == "high_quality":
                        # check embedding model setting
                        model_manager = ModelManager()

                        if dataset.embedding_model_provider:
                            embedding_model_instance = model_manager.get_model_instance(
                                tenant_id=dataset.tenant_id,
                                provider=dataset.embedding_model_provider,
                                model_type=ModelType.TEXT_EMBEDDING,
                                model=dataset.embedding_model,
                            )
                        else:
                            embedding_model_instance = model_manager.get_default_model_instance(
                                tenant_id=dataset.tenant_id,
                                model_type=ModelType.TEXT_EMBEDDING,
                            )
                    else:
                        raise ValueError("The knowledge base index technique is not high quality!")
                    # get the process rule
                    processing_rule = (
                        db.session.query(DatasetProcessRule)
                        .filter(DatasetProcessRule.id == document.dataset_process_rule_id)
                        .first()
                    )
                    if not processing_rule:
                        raise ValueError("No processing rule found.")
                    VectorService.generate_child_chunks(
                        segment, document, dataset, embedding_model_instance, processing_rule, True
                    )
                elif document.doc_form in (IndexType.PARAGRAPH_INDEX, IndexType.QA_INDEX):
                    # update segment vector index
                    VectorService.update_segment_vector(args.keywords, segment, dataset)

        except Exception as e:
            logging.exception("update segment index failed")
            segment.enabled = False
            segment.disabled_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
            segment.status = "error"
            segment.error = str(e)
            db.session.commit()
        new_segment = db.session.query(DocumentSegment).filter(DocumentSegment.id == segment.id).first()
        return new_segment

    @classmethod
    def delete_segment(cls, segment: DocumentSegment, document: Document, dataset: Dataset):
        indexing_cache_key = "segment_{}_delete_indexing".format(segment.id)
        cache_result = redis_client.get(indexing_cache_key)
        if cache_result is not None:
            raise ValueError("Segment is deleting.")

        # enabled segment need to delete index
        if segment.enabled:
            # send delete segment index task
            redis_client.setex(indexing_cache_key, 600, 1)
            delete_segment_from_index_task.delay([segment.index_node_id], dataset.id, document.id)
        db.session.delete(segment)
        # update document word count
        document.word_count -= segment.word_count
        db.session.add(document)
        db.session.commit()

    @classmethod
    def delete_segments(cls, segment_ids: list, document: Document, dataset: Dataset):
        index_node_ids = (
            DocumentSegment.query.with_entities(DocumentSegment.index_node_id)
            .filter(
                DocumentSegment.id.in_(segment_ids),
                DocumentSegment.dataset_id == dataset.id,
                DocumentSegment.document_id == document.id,
                DocumentSegment.tenant_id == current_user.current_tenant_id,
            )
            .all()
        )
        index_node_ids = [index_node_id[0] for index_node_id in index_node_ids]

        delete_segment_from_index_task.delay(index_node_ids, dataset.id, document.id)
        db.session.query(DocumentSegment).filter(DocumentSegment.id.in_(segment_ids)).delete()
        db.session.commit()

    @classmethod
    def update_segments_status(cls, segment_ids: list, action: str, dataset: Dataset, document: Document):
        if action == "enable":
            segments = (
                db.session.query(DocumentSegment)
                .filter(
                    DocumentSegment.id.in_(segment_ids),
                    DocumentSegment.dataset_id == dataset.id,
                    DocumentSegment.document_id == document.id,
                    DocumentSegment.enabled == False,
                )
                .all()
            )
            if not segments:
                return
            real_deal_segmment_ids = []
            for segment in segments:
                indexing_cache_key = "segment_{}_indexing".format(segment.id)
                cache_result = redis_client.get(indexing_cache_key)
                if cache_result is not None:
                    continue
                segment.enabled = True
                segment.disabled_at = None
                segment.disabled_by = None
                db.session.add(segment)
                real_deal_segmment_ids.append(segment.id)
            db.session.commit()

            enable_segments_to_index_task.delay(real_deal_segmment_ids, dataset.id, document.id)
        elif action == "disable":
            segments = (
                db.session.query(DocumentSegment)
                .filter(
                    DocumentSegment.id.in_(segment_ids),
                    DocumentSegment.dataset_id == dataset.id,
                    DocumentSegment.document_id == document.id,
                    DocumentSegment.enabled == True,
                )
                .all()
            )
            if not segments:
                return
            real_deal_segmment_ids = []
            for segment in segments:
                indexing_cache_key = "segment_{}_indexing".format(segment.id)
                cache_result = redis_client.get(indexing_cache_key)
                if cache_result is not None:
                    continue
                segment.enabled = False
                segment.disabled_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
                segment.disabled_by = current_user.id
                db.session.add(segment)
                real_deal_segmment_ids.append(segment.id)
            db.session.commit()

            disable_segments_from_index_task.delay(real_deal_segmment_ids, dataset.id, document.id)
        else:
            raise InvalidActionError()

    @classmethod
    def create_child_chunk(
        cls, content: str, segment: DocumentSegment, document: Document, dataset: Dataset
    ) -> ChildChunk:
        lock_name = "add_child_lock_{}".format(segment.id)
        with redis_client.lock(lock_name, timeout=20):
            index_node_id = str(uuid.uuid4())
            index_node_hash = helper.generate_text_hash(content)
            child_chunk_count = (
                db.session.query(ChildChunk)
                .filter(
                    ChildChunk.tenant_id == current_user.current_tenant_id,
                    ChildChunk.dataset_id == dataset.id,
                    ChildChunk.document_id == document.id,
                    ChildChunk.segment_id == segment.id,
                )
                .count()
            )
            max_position = (
                db.session.query(func.max(ChildChunk.position))
                .filter(
                    ChildChunk.tenant_id == current_user.current_tenant_id,
                    ChildChunk.dataset_id == dataset.id,
                    ChildChunk.document_id == document.id,
                    ChildChunk.segment_id == segment.id,
                )
                .scalar()
            )
            child_chunk = ChildChunk(
                tenant_id=current_user.current_tenant_id,
                dataset_id=dataset.id,
                document_id=document.id,
                segment_id=segment.id,
                position=max_position + 1 if max_position else 1,
                index_node_id=index_node_id,
                index_node_hash=index_node_hash,
                content=content,
                word_count=len(content),
                type="customized",
                created_by=current_user.id,
            )
            db.session.add(child_chunk)
            # save vector index
            try:
                VectorService.create_child_chunk_vector(child_chunk, dataset)
            except Exception as e:
                logging.exception("create child chunk index failed")
                db.session.rollback()
                raise ChildChunkIndexingError(str(e))
            db.session.commit()

            return child_chunk

    @classmethod
    def update_child_chunks(
        cls,
        child_chunks_update_args: list[ChildChunkUpdateArgs],
        segment: DocumentSegment,
        document: Document,
        dataset: Dataset,
    ) -> list[ChildChunk]:
        child_chunks = (
            db.session.query(ChildChunk)
            .filter(
                ChildChunk.dataset_id == dataset.id,
                ChildChunk.document_id == document.id,
                ChildChunk.segment_id == segment.id,
            )
            .all()
        )
        child_chunks_map = {chunk.id: chunk for chunk in child_chunks}

        new_child_chunks, update_child_chunks, delete_child_chunks, new_child_chunks_args = [], [], [], []

        for child_chunk_update_args in child_chunks_update_args:
            if child_chunk_update_args.id:
                child_chunk = child_chunks_map.pop(child_chunk_update_args.id, None)
                if child_chunk:
                    if child_chunk.content != child_chunk_update_args.content:
                        child_chunk.content = child_chunk_update_args.content
                        child_chunk.word_count = len(child_chunk.content)
                        child_chunk.updated_by = current_user.id
                        child_chunk.updated_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
                        child_chunk.type = "customized"
                        update_child_chunks.append(child_chunk)
            else:
                new_child_chunks_args.append(child_chunk_update_args)
        if child_chunks_map:
            delete_child_chunks = list(child_chunks_map.values())
        try:
            if update_child_chunks:
                db.session.bulk_save_objects(update_child_chunks)

            if delete_child_chunks:
                for child_chunk in delete_child_chunks:
                    db.session.delete(child_chunk)
            if new_child_chunks_args:
                child_chunk_count = len(child_chunks)
                for position, args in enumerate(new_child_chunks_args, start=child_chunk_count + 1):
                    index_node_id = str(uuid.uuid4())
                    index_node_hash = helper.generate_text_hash(args.content)
                    child_chunk = ChildChunk(
                        tenant_id=current_user.current_tenant_id,
                        dataset_id=dataset.id,
                        document_id=document.id,
                        segment_id=segment.id,
                        position=position,
                        index_node_id=index_node_id,
                        index_node_hash=index_node_hash,
                        content=args.content,
                        word_count=len(args.content),
                        type="customized",
                        created_by=current_user.id,
                    )

                    db.session.add(child_chunk)
                    db.session.flush()
                    new_child_chunks.append(child_chunk)
            VectorService.update_child_chunk_vector(new_child_chunks, update_child_chunks, delete_child_chunks, dataset)
            db.session.commit()
        except Exception as e:
            logging.exception("update child chunk index failed")
            db.session.rollback()
            raise ChildChunkIndexingError(str(e))
        return sorted(new_child_chunks + update_child_chunks, key=lambda x: x.position)

    @classmethod
    def update_child_chunk(
        cls,
        content: str,
        child_chunk: ChildChunk,
        segment: DocumentSegment,
        document: Document,
        dataset: Dataset,
    ) -> ChildChunk:
        try:
            child_chunk.content = content
            child_chunk.word_count = len(content)
            child_chunk.updated_by = current_user.id
            child_chunk.updated_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
            child_chunk.type = "customized"
            db.session.add(child_chunk)
            VectorService.update_child_chunk_vector([], [child_chunk], [], dataset)
            db.session.commit()
        except Exception as e:
            logging.exception("update child chunk index failed")
            db.session.rollback()
            raise ChildChunkIndexingError(str(e))
        return child_chunk

    @classmethod
    def delete_child_chunk(cls, child_chunk: ChildChunk, dataset: Dataset):
        db.session.delete(child_chunk)
        try:
            VectorService.delete_child_chunk_vector(child_chunk, dataset)
        except Exception as e:
            logging.exception("delete child chunk index failed")
            db.session.rollback()
            raise ChildChunkDeleteIndexError(str(e))
        db.session.commit()

    @classmethod
    def get_child_chunks(
        cls, segment_id: str, document_id: str, dataset_id: str, page: int, limit: int, keyword: Optional[str] = None
    ):
        query = ChildChunk.query.filter_by(
            tenant_id=current_user.current_tenant_id,
            dataset_id=dataset_id,
            document_id=document_id,
            segment_id=segment_id,
        ).order_by(ChildChunk.position.asc())
        if keyword:
            query = query.where(ChildChunk.content.ilike(f"%{keyword}%"))
        return query.paginate(page=page, per_page=limit, max_per_page=100, error_out=False)

    @classmethod
    def get_child_chunk_by_id(cls, child_chunk_id: str, tenant_id: str) -> Optional[ChildChunk]:
        """Get a child chunk by its ID."""
        result = ChildChunk.query.filter(ChildChunk.id == child_chunk_id, ChildChunk.tenant_id == tenant_id).first()
        return result if isinstance(result, ChildChunk) else None

    @classmethod
    def get_segments(
        cls,
        document_id: str,
        tenant_id: str,
        status_list: list[str] | None = None,
        keyword: str | None = None,
        page: int = 1,
        limit: int = 20,
    ):
        """Get segments for a document with optional filtering."""
        query = DocumentSegment.query.filter(
            DocumentSegment.document_id == document_id, DocumentSegment.tenant_id == tenant_id
        )

        if status_list:
            query = query.filter(DocumentSegment.status.in_(status_list))

        if keyword:
            query = query.filter(DocumentSegment.content.ilike(f"%{keyword}%"))

        paginated_segments = query.order_by(DocumentSegment.position.asc()).paginate(
            page=page, per_page=limit, max_per_page=100, error_out=False
        )

        return paginated_segments.items, paginated_segments.total

    @classmethod
    def update_segment_by_id(
        cls, tenant_id: str, dataset_id: str, document_id: str, segment_id: str, segment_data: dict, user_id: str
    ) -> tuple[DocumentSegment, Document]:
        """Update a segment by its ID with validation and checks."""
        # check dataset
        dataset = db.session.query(Dataset).filter(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
        if not dataset:
            raise NotFound("Dataset not found.")

        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)

        # check document
        document = DocumentService.get_document(dataset_id, document_id)
        if not document:
            raise NotFound("Document not found.")

        # check embedding model setting if high quality
        if dataset.indexing_technique == "high_quality":
            try:
                model_manager = ModelManager()
                model_manager.get_model_instance(
                    tenant_id=user_id,
                    provider=dataset.embedding_model_provider,
                    model_type=ModelType.TEXT_EMBEDDING,
                    model=dataset.embedding_model,
                )
            except LLMBadRequestError:
                raise ValueError(
                    "No Embedding Model available. Please configure a valid provider in the Settings -> Model Provider."
                )
            except ProviderTokenNotInitError as ex:
                raise ValueError(ex.description)

        # check segment
        segment = DocumentSegment.query.filter(
            DocumentSegment.id == segment_id, DocumentSegment.tenant_id == user_id
        ).first()
        if not segment:
            raise NotFound("Segment not found.")

        # validate and update segment
        cls.segment_create_args_validate(segment_data, document)
        updated_segment = cls.update_segment(SegmentUpdateArgs(**segment_data), segment, document, dataset)

        return updated_segment, document

    @classmethod
    def get_segment_by_id(cls, segment_id: str, tenant_id: str) -> Optional[DocumentSegment]:
        """Get a segment by its ID."""
        result = DocumentSegment.query.filter(
            DocumentSegment.id == segment_id, DocumentSegment.tenant_id == tenant_id
        ).first()
        return result if isinstance(result, DocumentSegment) else None


class DatasetCollectionBindingService:
    @classmethod
    def get_dataset_collection_binding(
        cls, provider_name: str, model_name: str, collection_type: str = "dataset"
    ) -> DatasetCollectionBinding:
        dataset_collection_binding = (
            db.session.query(DatasetCollectionBinding)
            .filter(
                DatasetCollectionBinding.provider_name == provider_name,
                DatasetCollectionBinding.model_name == model_name,
                DatasetCollectionBinding.type == collection_type,
            )
            .order_by(DatasetCollectionBinding.created_at)
            .first()
        )

        if not dataset_collection_binding:
            dataset_collection_binding = DatasetCollectionBinding(
                provider_name=provider_name,
                model_name=model_name,
                collection_name=Dataset.gen_collection_name_by_id(str(uuid.uuid4())),
                type=collection_type,
            )
            db.session.add(dataset_collection_binding)
            db.session.commit()
        return dataset_collection_binding

    @classmethod
    def get_dataset_collection_binding_by_id_and_type(
        cls, collection_binding_id: str, collection_type: str = "dataset"
    ) -> DatasetCollectionBinding:
        dataset_collection_binding = (
            db.session.query(DatasetCollectionBinding)
            .filter(
                DatasetCollectionBinding.id == collection_binding_id, DatasetCollectionBinding.type == collection_type
            )
            .order_by(DatasetCollectionBinding.created_at)
            .first()
        )
        if not dataset_collection_binding:
            raise ValueError("Dataset collection binding not found")

        return dataset_collection_binding


class DatasetPermissionService:
    @classmethod
    def get_dataset_partial_member_list(cls, dataset_id):
        user_list_query = (
            db.session.query(
                DatasetPermission.account_id,
            )
            .filter(DatasetPermission.dataset_id == dataset_id)
            .all()
        )

        user_list = []
        for user in user_list_query:
            user_list.append(user.account_id)

        return user_list

    @classmethod
    def update_partial_member_list(cls, tenant_id, dataset_id, user_list):
        try:
            db.session.query(DatasetPermission).filter(DatasetPermission.dataset_id == dataset_id).delete()
            permissions = []
            for user in user_list:
                permission = DatasetPermission(
                    tenant_id=tenant_id,
                    dataset_id=dataset_id,
                    account_id=user["user_id"],
                )
                permissions.append(permission)

            db.session.add_all(permissions)
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            raise e

    @classmethod
    def check_permission(cls, user, dataset, requested_permission, requested_partial_member_list):
        if not user.is_dataset_editor:
            raise NoPermissionError("User does not have permission to edit this dataset.")

        if user.is_dataset_operator and dataset.permission != requested_permission:
            raise NoPermissionError("Dataset operators cannot change the dataset permissions.")

        if user.is_dataset_operator and requested_permission == "partial_members":
            if not requested_partial_member_list:
                raise ValueError("Partial member list is required when setting to partial members.")

            local_member_list = cls.get_dataset_partial_member_list(dataset.id)
            request_member_list = [user["user_id"] for user in requested_partial_member_list]
            if set(local_member_list) != set(request_member_list):
                raise ValueError("Dataset operators cannot change the dataset permissions.")

    @classmethod
    def clear_partial_member_list(cls, dataset_id):
        try:
            db.session.query(DatasetPermission).filter(DatasetPermission.dataset_id == dataset_id).delete()
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            raise e
