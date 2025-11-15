import json
import logging
from argparse import ArgumentTypeError
from collections.abc import Sequence
from typing import Literal, cast

import sqlalchemy as sa
from flask import request
from flask_restx import Resource, fields, marshal, marshal_with, reqparse
from sqlalchemy import asc, desc, select
from werkzeug.exceptions import Forbidden, NotFound

import services
from controllers.console import api, console_ns
from controllers.console.app.error import (
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.datasets.error import (
    ArchivedDocumentImmutableError,
    DocumentAlreadyFinishedError,
    DocumentIndexingError,
    IndexingEstimateError,
    InvalidActionError,
    InvalidMetadataError,
)
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_rate_limit_check,
    cloud_edition_billing_resource_check,
    setup_required,
)
from core.errors.error import (
    LLMBadRequestError,
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.indexing_runner import IndexingRunner
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.invoke import InvokeAuthorizationError
from core.plugin.impl.exc import PluginDaemonClientSideError
from core.rag.extractor.entity.datasource_type import DatasourceType
from core.rag.extractor.entity.extract_setting import ExtractSetting, NotionInfo, WebsiteInfo
from extensions.ext_database import db
from fields.document_fields import (
    dataset_and_document_fields,
    document_fields,
    document_status_fields,
    document_with_segments_fields,
)
from libs.datetime_utils import naive_utc_now
from libs.login import current_account_with_tenant, login_required
from models import Dataset, DatasetProcessRule, Document, DocumentSegment, UploadFile
from models.dataset import DocumentPipelineExecutionLog
from services.dataset_service import DatasetService, DocumentService
from services.entities.knowledge_entities.knowledge_entities import KnowledgeConfig

logger = logging.getLogger(__name__)


class DocumentResource(Resource):
    def get_document(self, dataset_id: str, document_id: str) -> Document:
        current_user, current_tenant_id = current_account_with_tenant()
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound("Dataset not found.")

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        document = DocumentService.get_document(dataset_id, document_id)

        if not document:
            raise NotFound("Document not found.")

        if document.tenant_id != current_tenant_id:
            raise Forbidden("No permission.")

        return document

    def get_batch_documents(self, dataset_id: str, batch: str) -> Sequence[Document]:
        current_user, _ = current_account_with_tenant()
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound("Dataset not found.")

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        documents = DocumentService.get_batch_documents(dataset_id, batch)

        if not documents:
            raise NotFound("Documents not found.")

        return documents


@console_ns.route("/datasets/process-rule")
class GetProcessRuleApi(Resource):
    @api.doc("get_process_rule")
    @api.doc(description="Get dataset document processing rules")
    @api.doc(params={"document_id": "Document ID (optional)"})
    @api.response(200, "Process rules retrieved successfully")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        current_user, _ = current_account_with_tenant()
        req_data = request.args

        document_id = req_data.get("document_id")

        # get default rules
        mode = DocumentService.DEFAULT_RULES["mode"]
        rules = DocumentService.DEFAULT_RULES["rules"]
        limits = DocumentService.DEFAULT_RULES["limits"]
        if document_id:
            # get the latest process rule
            document = db.get_or_404(Document, document_id)

            dataset = DatasetService.get_dataset(document.dataset_id)

            if not dataset:
                raise NotFound("Dataset not found.")

            try:
                DatasetService.check_dataset_permission(dataset, current_user)
            except services.errors.account.NoPermissionError as e:
                raise Forbidden(str(e))

            # get the latest process rule
            dataset_process_rule = (
                db.session.query(DatasetProcessRule)
                .where(DatasetProcessRule.dataset_id == document.dataset_id)
                .order_by(DatasetProcessRule.created_at.desc())
                .limit(1)
                .one_or_none()
            )
            if dataset_process_rule:
                mode = dataset_process_rule.mode
                rules = dataset_process_rule.rules_dict

        return {"mode": mode, "rules": rules, "limits": limits}


@console_ns.route("/datasets/<uuid:dataset_id>/documents")
class DatasetDocumentListApi(Resource):
    @api.doc("get_dataset_documents")
    @api.doc(description="Get documents in a dataset")
    @api.doc(
        params={
            "dataset_id": "Dataset ID",
            "page": "Page number (default: 1)",
            "limit": "Number of items per page (default: 20)",
            "keyword": "Search keyword",
            "sort": "Sort order (default: -created_at)",
            "fetch": "Fetch full details (default: false)",
        }
    )
    @api.response(200, "Documents retrieved successfully")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id):
        current_user, current_tenant_id = current_account_with_tenant()
        dataset_id = str(dataset_id)
        page = request.args.get("page", default=1, type=int)
        limit = request.args.get("limit", default=20, type=int)
        search = request.args.get("keyword", default=None, type=str)
        sort = request.args.get("sort", default="-created_at", type=str)
        # "yes", "true", "t", "y", "1" convert to True, while others convert to False.
        try:
            fetch_val = request.args.get("fetch", default="false")
            if isinstance(fetch_val, bool):
                fetch = fetch_val
            else:
                if fetch_val.lower() in ("yes", "true", "t", "y", "1"):
                    fetch = True
                elif fetch_val.lower() in ("no", "false", "f", "n", "0"):
                    fetch = False
                else:
                    raise ArgumentTypeError(
                        f"Truthy value expected: got {fetch_val} but expected one of yes/no, true/false, t/f, y/n, 1/0 "
                        f"(case insensitive)."
                    )
        except (ArgumentTypeError, ValueError, Exception):
            fetch = False
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound("Dataset not found.")

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        query = select(Document).filter_by(dataset_id=str(dataset_id), tenant_id=current_tenant_id)

        if search:
            search = f"%{search}%"
            query = query.where(Document.name.like(search))

        if sort.startswith("-"):
            sort_logic = desc
            sort = sort[1:]
        else:
            sort_logic = asc

        if sort == "hit_count":
            sub_query = (
                sa.select(DocumentSegment.document_id, sa.func.sum(DocumentSegment.hit_count).label("total_hit_count"))
                .group_by(DocumentSegment.document_id)
                .subquery()
            )

            query = query.outerjoin(sub_query, sub_query.c.document_id == Document.id).order_by(
                sort_logic(sa.func.coalesce(sub_query.c.total_hit_count, 0)),
                sort_logic(Document.position),
            )
        elif sort == "created_at":
            query = query.order_by(
                sort_logic(Document.created_at),
                sort_logic(Document.position),
            )
        else:
            query = query.order_by(
                desc(Document.created_at),
                desc(Document.position),
            )

        paginated_documents = db.paginate(select=query, page=page, per_page=limit, max_per_page=100, error_out=False)
        documents = paginated_documents.items
        if fetch:
            for document in documents:
                completed_segments = (
                    db.session.query(DocumentSegment)
                    .where(
                        DocumentSegment.completed_at.isnot(None),
                        DocumentSegment.document_id == str(document.id),
                        DocumentSegment.status != "re_segment",
                    )
                    .count()
                )
                total_segments = (
                    db.session.query(DocumentSegment)
                    .where(DocumentSegment.document_id == str(document.id), DocumentSegment.status != "re_segment")
                    .count()
                )
                document.completed_segments = completed_segments
                document.total_segments = total_segments
            data = marshal(documents, document_with_segments_fields)
        else:
            data = marshal(documents, document_fields)
        response = {
            "data": data,
            "has_more": len(documents) == limit,
            "limit": limit,
            "total": paginated_documents.total,
            "page": page,
        }

        return response

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(dataset_and_document_fields)
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    def post(self, dataset_id):
        current_user, _ = current_account_with_tenant()
        dataset_id = str(dataset_id)

        dataset = DatasetService.get_dataset(dataset_id)

        if not dataset:
            raise NotFound("Dataset not found.")

        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        parser = (
            reqparse.RequestParser()
            .add_argument(
                "indexing_technique", type=str, choices=Dataset.INDEXING_TECHNIQUE_LIST, nullable=False, location="json"
            )
            .add_argument("data_source", type=dict, required=False, location="json")
            .add_argument("process_rule", type=dict, required=False, location="json")
            .add_argument("duplicate", type=bool, default=True, nullable=False, location="json")
            .add_argument("original_document_id", type=str, required=False, location="json")
            .add_argument("doc_form", type=str, default="text_model", required=False, nullable=False, location="json")
            .add_argument("retrieval_model", type=dict, required=False, nullable=False, location="json")
            .add_argument("embedding_model", type=str, required=False, nullable=True, location="json")
            .add_argument("embedding_model_provider", type=str, required=False, nullable=True, location="json")
            .add_argument("doc_language", type=str, default="English", required=False, nullable=False, location="json")
        )
        args = parser.parse_args()
        knowledge_config = KnowledgeConfig.model_validate(args)

        if not dataset.indexing_technique and not knowledge_config.indexing_technique:
            raise ValueError("indexing_technique is required.")

        # validate args
        DocumentService.document_create_args_validate(knowledge_config)

        try:
            documents, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, current_user)
            dataset = DatasetService.get_dataset(dataset_id)

        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()

        return {"dataset": dataset, "documents": documents, "batch": batch}

    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    def delete(self, dataset_id):
        dataset_id = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if dataset is None:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)

        try:
            document_ids = request.args.getlist("document_id")
            DocumentService.delete_documents(dataset, document_ids)
        except services.errors.document.DocumentIndexingError:
            raise DocumentIndexingError("Cannot delete document during indexing.")

        return {"result": "success"}, 204


@console_ns.route("/datasets/init")
class DatasetInitApi(Resource):
    @api.doc("init_dataset")
    @api.doc(description="Initialize dataset with documents")
    @api.expect(
        api.model(
            "DatasetInitRequest",
            {
                "upload_file_id": fields.String(required=True, description="Upload file ID"),
                "indexing_technique": fields.String(description="Indexing technique"),
                "process_rule": fields.Raw(description="Processing rules"),
                "data_source": fields.Raw(description="Data source configuration"),
            },
        )
    )
    @api.response(201, "Dataset initialized successfully", dataset_and_document_fields)
    @api.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(dataset_and_document_fields)
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    def post(self):
        # The role of the current user in the ta table must be admin, owner, dataset_operator, or editor
        current_user, current_tenant_id = current_account_with_tenant()
        if not current_user.is_dataset_editor:
            raise Forbidden()

        parser = (
            reqparse.RequestParser()
            .add_argument(
                "indexing_technique",
                type=str,
                choices=Dataset.INDEXING_TECHNIQUE_LIST,
                required=True,
                nullable=False,
                location="json",
            )
            .add_argument("data_source", type=dict, required=True, nullable=True, location="json")
            .add_argument("process_rule", type=dict, required=True, nullable=True, location="json")
            .add_argument("doc_form", type=str, default="text_model", required=False, nullable=False, location="json")
            .add_argument("doc_language", type=str, default="English", required=False, nullable=False, location="json")
            .add_argument("retrieval_model", type=dict, required=False, nullable=False, location="json")
            .add_argument("embedding_model", type=str, required=False, nullable=True, location="json")
            .add_argument("embedding_model_provider", type=str, required=False, nullable=True, location="json")
        )
        args = parser.parse_args()

        knowledge_config = KnowledgeConfig.model_validate(args)
        if knowledge_config.indexing_technique == "high_quality":
            if knowledge_config.embedding_model is None or knowledge_config.embedding_model_provider is None:
                raise ValueError("embedding model and embedding model provider are required for high quality indexing.")
            try:
                model_manager = ModelManager()
                model_manager.get_model_instance(
                    tenant_id=current_tenant_id,
                    provider=args["embedding_model_provider"],
                    model_type=ModelType.TEXT_EMBEDDING,
                    model=args["embedding_model"],
                )
            except InvokeAuthorizationError:
                raise ProviderNotInitializeError(
                    "No Embedding Model available. Please configure a valid provider in the Settings -> Model Provider."
                )
            except ProviderTokenNotInitError as ex:
                raise ProviderNotInitializeError(ex.description)

        # validate args
        DocumentService.document_create_args_validate(knowledge_config)

        try:
            dataset, documents, batch = DocumentService.save_document_without_dataset_id(
                tenant_id=current_tenant_id,
                knowledge_config=knowledge_config,
                account=current_user,
            )
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()

        response = {"dataset": dataset, "documents": documents, "batch": batch}

        return response


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/indexing-estimate")
class DocumentIndexingEstimateApi(DocumentResource):
    @api.doc("estimate_document_indexing")
    @api.doc(description="Estimate document indexing cost")
    @api.doc(params={"dataset_id": "Dataset ID", "document_id": "Document ID"})
    @api.response(200, "Indexing estimate calculated successfully")
    @api.response(404, "Document not found")
    @api.response(400, "Document already finished")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id, document_id):
        _, current_tenant_id = current_account_with_tenant()
        dataset_id = str(dataset_id)
        document_id = str(document_id)
        document = self.get_document(dataset_id, document_id)

        if document.indexing_status in {"completed", "error"}:
            raise DocumentAlreadyFinishedError()

        data_process_rule = document.dataset_process_rule
        data_process_rule_dict = data_process_rule.to_dict() if data_process_rule else {}

        response = {"tokens": 0, "total_price": 0, "currency": "USD", "total_segments": 0, "preview": []}

        if document.data_source_type == "upload_file":
            data_source_info = document.data_source_info_dict
            if data_source_info and "upload_file_id" in data_source_info:
                file_id = data_source_info["upload_file_id"]

                file = (
                    db.session.query(UploadFile)
                    .where(UploadFile.tenant_id == document.tenant_id, UploadFile.id == file_id)
                    .first()
                )

                # raise error if file not found
                if not file:
                    raise NotFound("File not found.")

                extract_setting = ExtractSetting(
                    datasource_type=DatasourceType.FILE, upload_file=file, document_model=document.doc_form
                )

                indexing_runner = IndexingRunner()

                try:
                    estimate_response = indexing_runner.indexing_estimate(
                        current_tenant_id,
                        [extract_setting],
                        data_process_rule_dict,
                        document.doc_form,
                        "English",
                        dataset_id,
                    )
                    return estimate_response.model_dump(), 200
                except LLMBadRequestError:
                    raise ProviderNotInitializeError(
                        "No Embedding Model available. Please configure a valid provider "
                        "in the Settings -> Model Provider."
                    )
                except ProviderTokenNotInitError as ex:
                    raise ProviderNotInitializeError(ex.description)
                except PluginDaemonClientSideError as ex:
                    raise ProviderNotInitializeError(ex.description)
                except Exception as e:
                    raise IndexingEstimateError(str(e))

        return response, 200


@console_ns.route("/datasets/<uuid:dataset_id>/batch/<string:batch>/indexing-estimate")
class DocumentBatchIndexingEstimateApi(DocumentResource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id, batch):
        _, current_tenant_id = current_account_with_tenant()
        dataset_id = str(dataset_id)
        batch = str(batch)
        documents = self.get_batch_documents(dataset_id, batch)
        if not documents:
            return {"tokens": 0, "total_price": 0, "currency": "USD", "total_segments": 0, "preview": []}, 200
        data_process_rule = documents[0].dataset_process_rule
        data_process_rule_dict = data_process_rule.to_dict() if data_process_rule else {}
        extract_settings = []
        for document in documents:
            if document.indexing_status in {"completed", "error"}:
                raise DocumentAlreadyFinishedError()
            data_source_info = document.data_source_info_dict

            if document.data_source_type == "upload_file":
                if not data_source_info:
                    continue
                file_id = data_source_info["upload_file_id"]
                file_detail = (
                    db.session.query(UploadFile)
                    .where(UploadFile.tenant_id == current_tenant_id, UploadFile.id == file_id)
                    .first()
                )

                if file_detail is None:
                    raise NotFound("File not found.")

                extract_setting = ExtractSetting(
                    datasource_type=DatasourceType.FILE, upload_file=file_detail, document_model=document.doc_form
                )
                extract_settings.append(extract_setting)

            elif document.data_source_type == "notion_import":
                if not data_source_info:
                    continue
                extract_setting = ExtractSetting(
                    datasource_type=DatasourceType.NOTION,
                    notion_info=NotionInfo.model_validate(
                        {
                            "credential_id": data_source_info["credential_id"],
                            "notion_workspace_id": data_source_info["notion_workspace_id"],
                            "notion_obj_id": data_source_info["notion_page_id"],
                            "notion_page_type": data_source_info["type"],
                            "tenant_id": current_tenant_id,
                        }
                    ),
                    document_model=document.doc_form,
                )
                extract_settings.append(extract_setting)
            elif document.data_source_type == "website_crawl":
                if not data_source_info:
                    continue
                extract_setting = ExtractSetting(
                    datasource_type=DatasourceType.WEBSITE,
                    website_info=WebsiteInfo.model_validate(
                        {
                            "provider": data_source_info["provider"],
                            "job_id": data_source_info["job_id"],
                            "url": data_source_info["url"],
                            "tenant_id": current_tenant_id,
                            "mode": data_source_info["mode"],
                            "only_main_content": data_source_info["only_main_content"],
                        }
                    ),
                    document_model=document.doc_form,
                )
                extract_settings.append(extract_setting)

            else:
                raise ValueError("Data source type not support")
            indexing_runner = IndexingRunner()
            try:
                response = indexing_runner.indexing_estimate(
                    current_tenant_id,
                    extract_settings,
                    data_process_rule_dict,
                    document.doc_form,
                    "English",
                    dataset_id,
                )
                return response.model_dump(), 200
            except LLMBadRequestError:
                raise ProviderNotInitializeError(
                    "No Embedding Model available. Please configure a valid provider in the Settings -> Model Provider."
                )
            except ProviderTokenNotInitError as ex:
                raise ProviderNotInitializeError(ex.description)
            except PluginDaemonClientSideError as ex:
                raise ProviderNotInitializeError(ex.description)
            except Exception as e:
                raise IndexingEstimateError(str(e))


@console_ns.route("/datasets/<uuid:dataset_id>/batch/<string:batch>/indexing-status")
class DocumentBatchIndexingStatusApi(DocumentResource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id, batch):
        dataset_id = str(dataset_id)
        batch = str(batch)
        documents = self.get_batch_documents(dataset_id, batch)
        documents_status = []
        for document in documents:
            completed_segments = (
                db.session.query(DocumentSegment)
                .where(
                    DocumentSegment.completed_at.isnot(None),
                    DocumentSegment.document_id == str(document.id),
                    DocumentSegment.status != "re_segment",
                )
                .count()
            )
            total_segments = (
                db.session.query(DocumentSegment)
                .where(DocumentSegment.document_id == str(document.id), DocumentSegment.status != "re_segment")
                .count()
            )
            # Create a dictionary with document attributes and additional fields
            document_dict = {
                "id": document.id,
                "indexing_status": "paused" if document.is_paused else document.indexing_status,
                "processing_started_at": document.processing_started_at,
                "parsing_completed_at": document.parsing_completed_at,
                "cleaning_completed_at": document.cleaning_completed_at,
                "splitting_completed_at": document.splitting_completed_at,
                "completed_at": document.completed_at,
                "paused_at": document.paused_at,
                "error": document.error,
                "stopped_at": document.stopped_at,
                "completed_segments": completed_segments,
                "total_segments": total_segments,
            }
            documents_status.append(marshal(document_dict, document_status_fields))
        data = {"data": documents_status}
        return data


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/indexing-status")
class DocumentIndexingStatusApi(DocumentResource):
    @api.doc("get_document_indexing_status")
    @api.doc(description="Get document indexing status")
    @api.doc(params={"dataset_id": "Dataset ID", "document_id": "Document ID"})
    @api.response(200, "Indexing status retrieved successfully")
    @api.response(404, "Document not found")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id, document_id):
        dataset_id = str(dataset_id)
        document_id = str(document_id)
        document = self.get_document(dataset_id, document_id)

        completed_segments = (
            db.session.query(DocumentSegment)
            .where(
                DocumentSegment.completed_at.isnot(None),
                DocumentSegment.document_id == str(document_id),
                DocumentSegment.status != "re_segment",
            )
            .count()
        )
        total_segments = (
            db.session.query(DocumentSegment)
            .where(DocumentSegment.document_id == str(document_id), DocumentSegment.status != "re_segment")
            .count()
        )

        # Create a dictionary with document attributes and additional fields
        document_dict = {
            "id": document.id,
            "indexing_status": "paused" if document.is_paused else document.indexing_status,
            "processing_started_at": document.processing_started_at,
            "parsing_completed_at": document.parsing_completed_at,
            "cleaning_completed_at": document.cleaning_completed_at,
            "splitting_completed_at": document.splitting_completed_at,
            "completed_at": document.completed_at,
            "paused_at": document.paused_at,
            "error": document.error,
            "stopped_at": document.stopped_at,
            "completed_segments": completed_segments,
            "total_segments": total_segments,
        }
        return marshal(document_dict, document_status_fields)


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>")
class DocumentApi(DocumentResource):
    METADATA_CHOICES = {"all", "only", "without"}

    @api.doc("get_document")
    @api.doc(description="Get document details")
    @api.doc(
        params={
            "dataset_id": "Dataset ID",
            "document_id": "Document ID",
            "metadata": "Metadata inclusion (all/only/without)",
        }
    )
    @api.response(200, "Document retrieved successfully")
    @api.response(404, "Document not found")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id, document_id):
        dataset_id = str(dataset_id)
        document_id = str(document_id)
        document = self.get_document(dataset_id, document_id)

        metadata = request.args.get("metadata", "all")
        if metadata not in self.METADATA_CHOICES:
            raise InvalidMetadataError(f"Invalid metadata value: {metadata}")

        if metadata == "only":
            response = {"id": document.id, "doc_type": document.doc_type, "doc_metadata": document.doc_metadata_details}
        elif metadata == "without":
            dataset_process_rules = DatasetService.get_process_rules(dataset_id)
            document_process_rules = document.dataset_process_rule.to_dict() if document.dataset_process_rule else {}
            data_source_info = document.data_source_detail_dict
            response = {
                "id": document.id,
                "position": document.position,
                "data_source_type": document.data_source_type,
                "data_source_info": data_source_info,
                "dataset_process_rule_id": document.dataset_process_rule_id,
                "dataset_process_rule": dataset_process_rules,
                "document_process_rule": document_process_rules,
                "name": document.name,
                "created_from": document.created_from,
                "created_by": document.created_by,
                "created_at": int(document.created_at.timestamp()),
                "tokens": document.tokens,
                "indexing_status": document.indexing_status,
                "completed_at": int(document.completed_at.timestamp()) if document.completed_at else None,
                "updated_at": int(document.updated_at.timestamp()) if document.updated_at else None,
                "indexing_latency": document.indexing_latency,
                "error": document.error,
                "enabled": document.enabled,
                "disabled_at": int(document.disabled_at.timestamp()) if document.disabled_at else None,
                "disabled_by": document.disabled_by,
                "archived": document.archived,
                "segment_count": document.segment_count,
                "average_segment_length": document.average_segment_length,
                "hit_count": document.hit_count,
                "display_status": document.display_status,
                "doc_form": document.doc_form,
                "doc_language": document.doc_language,
            }
        else:
            dataset_process_rules = DatasetService.get_process_rules(dataset_id)
            document_process_rules = document.dataset_process_rule.to_dict() if document.dataset_process_rule else {}
            data_source_info = document.data_source_detail_dict
            response = {
                "id": document.id,
                "position": document.position,
                "data_source_type": document.data_source_type,
                "data_source_info": data_source_info,
                "dataset_process_rule_id": document.dataset_process_rule_id,
                "dataset_process_rule": dataset_process_rules,
                "document_process_rule": document_process_rules,
                "name": document.name,
                "created_from": document.created_from,
                "created_by": document.created_by,
                "created_at": int(document.created_at.timestamp()),
                "tokens": document.tokens,
                "indexing_status": document.indexing_status,
                "completed_at": int(document.completed_at.timestamp()) if document.completed_at else None,
                "updated_at": int(document.updated_at.timestamp()) if document.updated_at else None,
                "indexing_latency": document.indexing_latency,
                "error": document.error,
                "enabled": document.enabled,
                "disabled_at": int(document.disabled_at.timestamp()) if document.disabled_at else None,
                "disabled_by": document.disabled_by,
                "archived": document.archived,
                "doc_type": document.doc_type,
                "doc_metadata": document.doc_metadata_details,
                "segment_count": document.segment_count,
                "average_segment_length": document.average_segment_length,
                "hit_count": document.hit_count,
                "display_status": document.display_status,
                "doc_form": document.doc_form,
                "doc_language": document.doc_language,
            }

        return response, 200

    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    def delete(self, dataset_id, document_id):
        dataset_id = str(dataset_id)
        document_id = str(document_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if dataset is None:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)

        document = self.get_document(dataset_id, document_id)

        try:
            DocumentService.delete_document(document)
        except services.errors.document.DocumentIndexingError:
            raise DocumentIndexingError("Cannot delete document during indexing.")

        return {"result": "success"}, 204


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/processing/<string:action>")
class DocumentProcessingApi(DocumentResource):
    @api.doc("update_document_processing")
    @api.doc(description="Update document processing status (pause/resume)")
    @api.doc(
        params={"dataset_id": "Dataset ID", "document_id": "Document ID", "action": "Action to perform (pause/resume)"}
    )
    @api.response(200, "Processing status updated successfully")
    @api.response(404, "Document not found")
    @api.response(400, "Invalid action")
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    def patch(self, dataset_id, document_id, action: Literal["pause", "resume"]):
        current_user, _ = current_account_with_tenant()
        dataset_id = str(dataset_id)
        document_id = str(document_id)
        document = self.get_document(dataset_id, document_id)

        # The role of the current user in the ta table must be admin, owner, dataset_operator, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()

        if action == "pause":
            if document.indexing_status != "indexing":
                raise InvalidActionError("Document not in indexing state.")

            document.paused_by = current_user.id
            document.paused_at = naive_utc_now()
            document.is_paused = True
            db.session.commit()

        elif action == "resume":
            if document.indexing_status not in {"paused", "error"}:
                raise InvalidActionError("Document not in paused or error state.")

            document.paused_by = None
            document.paused_at = None
            document.is_paused = False
            db.session.commit()

        return {"result": "success"}, 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/metadata")
class DocumentMetadataApi(DocumentResource):
    @api.doc("update_document_metadata")
    @api.doc(description="Update document metadata")
    @api.doc(params={"dataset_id": "Dataset ID", "document_id": "Document ID"})
    @api.expect(
        api.model(
            "UpdateDocumentMetadataRequest",
            {
                "doc_type": fields.String(description="Document type"),
                "doc_metadata": fields.Raw(description="Document metadata"),
            },
        )
    )
    @api.response(200, "Document metadata updated successfully")
    @api.response(404, "Document not found")
    @api.response(403, "Permission denied")
    @setup_required
    @login_required
    @account_initialization_required
    def put(self, dataset_id, document_id):
        current_user, _ = current_account_with_tenant()
        dataset_id = str(dataset_id)
        document_id = str(document_id)
        document = self.get_document(dataset_id, document_id)

        req_data = request.get_json()

        doc_type = req_data.get("doc_type")
        doc_metadata = req_data.get("doc_metadata")

        # The role of the current user in the ta table must be admin, owner, dataset_operator, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()

        if doc_type is None or doc_metadata is None:
            raise ValueError("Both doc_type and doc_metadata must be provided.")

        if doc_type not in DocumentService.DOCUMENT_METADATA_SCHEMA:
            raise ValueError("Invalid doc_type.")

        if not isinstance(doc_metadata, dict):
            raise ValueError("doc_metadata must be a dictionary.")
        metadata_schema: dict = cast(dict, DocumentService.DOCUMENT_METADATA_SCHEMA[doc_type])

        document.doc_metadata = {}
        if doc_type == "others":
            document.doc_metadata = doc_metadata
        else:
            for key, value_type in metadata_schema.items():
                value = doc_metadata.get(key)
                if value is not None and isinstance(value, value_type):
                    document.doc_metadata[key] = value

        document.doc_type = doc_type
        document.updated_at = naive_utc_now()
        db.session.commit()

        return {"result": "success", "message": "Document metadata updated."}, 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/status/<string:action>/batch")
class DocumentStatusApi(DocumentResource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    def patch(self, dataset_id, action: Literal["enable", "disable", "archive", "un_archive"]):
        current_user, _ = current_account_with_tenant()
        dataset_id = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if dataset is None:
            raise NotFound("Dataset not found.")

        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()

        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)

        # check user's permission
        DatasetService.check_dataset_permission(dataset, current_user)

        document_ids = request.args.getlist("document_id")

        try:
            DocumentService.batch_update_document_status(dataset, document_ids, action, current_user)
        except services.errors.document.DocumentIndexingError as e:
            raise InvalidActionError(str(e))
        except ValueError as e:
            raise InvalidActionError(str(e))
        except NotFound as e:
            raise NotFound(str(e))

        return {"result": "success"}, 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/processing/pause")
class DocumentPauseApi(DocumentResource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    def patch(self, dataset_id, document_id):
        """pause document."""
        dataset_id = str(dataset_id)
        document_id = str(document_id)

        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound("Dataset not found.")

        document = DocumentService.get_document(dataset.id, document_id)

        # 404 if document not found
        if document is None:
            raise NotFound("Document Not Exists.")

        # 403 if document is archived
        if DocumentService.check_archived(document):
            raise ArchivedDocumentImmutableError()

        try:
            # pause document
            DocumentService.pause_document(document)
        except services.errors.document.DocumentIndexingError:
            raise DocumentIndexingError("Cannot pause completed document.")

        return {"result": "success"}, 204


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/processing/resume")
class DocumentRecoverApi(DocumentResource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    def patch(self, dataset_id, document_id):
        """recover document."""
        dataset_id = str(dataset_id)
        document_id = str(document_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound("Dataset not found.")
        document = DocumentService.get_document(dataset.id, document_id)

        # 404 if document not found
        if document is None:
            raise NotFound("Document Not Exists.")

        # 403 if document is archived
        if DocumentService.check_archived(document):
            raise ArchivedDocumentImmutableError()
        try:
            # pause document
            DocumentService.recover_document(document)
        except services.errors.document.DocumentIndexingError:
            raise DocumentIndexingError("Document is not in paused status.")

        return {"result": "success"}, 204


@console_ns.route("/datasets/<uuid:dataset_id>/retry")
class DocumentRetryApi(DocumentResource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    def post(self, dataset_id):
        """retry document."""

        parser = reqparse.RequestParser().add_argument(
            "document_ids", type=list, required=True, nullable=False, location="json"
        )
        args = parser.parse_args()
        dataset_id = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id)
        retry_documents = []
        if not dataset:
            raise NotFound("Dataset not found.")
        for document_id in args["document_ids"]:
            try:
                document_id = str(document_id)

                document = DocumentService.get_document(dataset.id, document_id)

                # 404 if document not found
                if document is None:
                    raise NotFound("Document Not Exists.")

                # 403 if document is archived
                if DocumentService.check_archived(document):
                    raise ArchivedDocumentImmutableError()

                # 400 if document is completed
                if document.indexing_status == "completed":
                    raise DocumentAlreadyFinishedError()
                retry_documents.append(document)
            except Exception:
                logger.exception("Failed to retry document, document id: %s", document_id)
                continue
        # retry document
        DocumentService.retry_document(dataset_id, retry_documents)

        return {"result": "success"}, 204


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/rename")
class DocumentRenameApi(DocumentResource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(document_fields)
    def post(self, dataset_id, document_id):
        # The role of the current user in the ta table must be admin, owner, editor, or dataset_operator
        current_user, _ = current_account_with_tenant()
        if not current_user.is_dataset_editor:
            raise Forbidden()
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound("Dataset not found.")
        DatasetService.check_dataset_operator_permission(current_user, dataset)
        parser = reqparse.RequestParser().add_argument("name", type=str, required=True, nullable=False, location="json")
        args = parser.parse_args()

        try:
            document = DocumentService.rename_document(dataset_id, document_id, args["name"])
        except services.errors.document.DocumentIndexingError:
            raise DocumentIndexingError("Cannot delete document during indexing.")

        return document


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/website-sync")
class WebsiteDocumentSyncApi(DocumentResource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id, document_id):
        """sync website document."""
        _, current_tenant_id = current_account_with_tenant()
        dataset_id = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound("Dataset not found.")
        document_id = str(document_id)
        document = DocumentService.get_document(dataset.id, document_id)
        if not document:
            raise NotFound("Document not found.")
        if document.tenant_id != current_tenant_id:
            raise Forbidden("No permission.")
        if document.data_source_type != "website_crawl":
            raise ValueError("Document is not a website document.")
        # 403 if document is archived
        if DocumentService.check_archived(document):
            raise ArchivedDocumentImmutableError()
        # sync document
        DocumentService.sync_website_document(dataset_id, document)

        return {"result": "success"}, 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/pipeline-execution-log")
class DocumentPipelineExecutionLogApi(DocumentResource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id, document_id):
        dataset_id = str(dataset_id)
        document_id = str(document_id)

        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound("Dataset not found.")
        document = DocumentService.get_document(dataset.id, document_id)
        if not document:
            raise NotFound("Document not found.")
        log = (
            db.session.query(DocumentPipelineExecutionLog)
            .filter_by(document_id=document_id)
            .order_by(DocumentPipelineExecutionLog.created_at.desc())
            .first()
        )
        if not log:
            return {
                "datasource_info": None,
                "datasource_type": None,
                "input_data": None,
                "datasource_node_id": None,
            }, 200
        return {
            "datasource_info": json.loads(log.datasource_info),
            "datasource_type": log.datasource_type,
            "input_data": log.input_data,
            "datasource_node_id": log.datasource_node_id,
        }, 200
