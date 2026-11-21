"""Knowledge bases (datasets) and their documents."""

from __future__ import annotations

from collections.abc import Generator, Mapping
from contextlib import contextmanager
from http import HTTPStatus
from typing import Any, Final

from flask_restx import Resource
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound

from constants.oauth_bearer import Scope
from constants.personal_access_token import PersonalAccessTokenPolicy
from controllers.common.fields import SimpleResultResponse
from controllers.common.rbac import DatasetId, RBACCheck, RBACPermission
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Effect, Example, Kind, endpoint
from controllers.openapi._models import (
    DatasetCreatePayload,
    DatasetListQuery,
    DatasetListResponse,
    DatasetResponse,
    DatasetUpdatePayload,
    DocumentAndBatchResponse,
    DocumentCreateByTextPayload,
    DocumentIndexingStatusResponse,
    DocumentListQuery,
    DocumentListResponse,
    DocumentResponse,
    DocumentUpdateByTextPayload,
)
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import (
    WORKSPACE_READ_GUARDS,
    CheckRBACPermission,
    CheckScope,
    CheckSubject,
    CheckWorkspaceMember,
    CheckWorkspaceRole,
    workspace_write_guards,
)
from controllers.openapi.auth.subjects import AccountSubject
from extensions.ext_application_services import application_services
from extensions.ext_database import db
from libs.helper import to_timestamp
from models.account import TenantAccountRole
from services.errors.dataset import DatasetNameDuplicateError as DatasetNameDuplicateFailure
from services.file_service import FileService
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.datasets.application import DatasetListFilter
from services.knowledge.documents.application import (
    DocumentApplicationError,
    DocumentListFilter,
    DocumentNotFoundError,
    DocumentProviderError,
)
from services.knowledge.entities.knowledge_entities import RetrievalModel

_DATASET_EDIT_ROLES: Final = frozenset(
    {
        TenantAccountRole.OWNER,
        TenantAccountRole.ADMIN,
        TenantAccountRole.EDITOR,
        TenantAccountRole.DATASET_OPERATOR,
    }
)

_COLLECTION: Final = "/workspaces/<string:workspace_id>/datasets"
_ITEM: Final = f"{_COLLECTION}/<string:dataset_id>"
_DOCUMENTS: Final = f"{_ITEM}/documents"
_DOCUMENT: Final = f"{_DOCUMENTS}/<string:document_id>"
_DOCUMENT_CREATE: Final = f"{_DOCUMENTS}:createByText"
_DOCUMENT_UPDATE: Final = f"{_DOCUMENT}:updateByText"
_DOCUMENT_BATCH: Final = f"{_ITEM}/document-batches/<string:batch>"

_PAT: Final = PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS


def _dataset_write_guards(permission: RBACPermission, *, roles: frozenset[TenantAccountRole] | None):
    """`workspace_write_guards` scoped to the `dataset_id` path parameter."""
    return (
        CheckSubject(allowed=(AccountSubject,)),
        CheckScope(Scope.WORKSPACE_WRITE),
        CheckWorkspaceMember(),
        CheckRBACPermission(RBACCheck(permission, DatasetId())),
        *((CheckWorkspaceRole(roles),) if roles is not None else ()),
    )


_DATASET_CREATE_GUARDS: Final = workspace_write_guards(
    RBACPermission.DATASET_CREATE_AND_MANAGEMENT, roles=_DATASET_EDIT_ROLES
)
_DATASET_UPDATE_GUARDS: Final = _dataset_write_guards(RBACPermission.DATASET_EDIT, roles=_DATASET_EDIT_ROLES)
_DATASET_DELETE_GUARDS: Final = _dataset_write_guards(RBACPermission.DATASET_DELETE, roles=_DATASET_EDIT_ROLES)
_DOCUMENT_CREATE_GUARDS: Final = _dataset_write_guards(RBACPermission.DATASET_USE, roles=_DATASET_EDIT_ROLES)
_DOCUMENT_DELETE_GUARDS: Final = _dataset_write_guards(RBACPermission.DATASET_DELETE_FILE, roles=_DATASET_EDIT_ROLES)
_DOCUMENT_READ_GUARDS: Final = (
    *WORKSPACE_READ_GUARDS,
    CheckRBACPermission(RBACCheck(RBACPermission.DATASET_READONLY, DatasetId())),
)


@contextmanager
def _dataset_errors() -> Generator[None]:
    try:
        yield
    except DatasetNotFoundError as error:
        raise NotFound("Dataset not found.") from error
    except DatasetAccessDeniedError as error:
        raise Forbidden(str(error)) from error
    except DatasetNameDuplicateFailure as error:
        raise Conflict(str(error)) from error
    except ValueError as error:
        raise BadRequest(str(error)) from error


@contextmanager
def _document_errors() -> Generator[None]:
    try:
        yield
    except DocumentNotFoundError as error:
        raise NotFound(str(error)) from error
    except DatasetNotFoundError as error:
        raise NotFound("Dataset not found.") from error
    except DatasetAccessDeniedError as error:
        raise Forbidden(str(error)) from error
    except DocumentProviderError as error:
        raise BadRequest(str(error)) from error
    except DocumentApplicationError as error:
        raise Conflict(str(error)) from error
    except ValueError as error:
        raise BadRequest(str(error)) from error


def _dataset_row(record: Mapping[str, Any]) -> DatasetResponse:
    external = record.get("external_knowledge_info") or {}
    return DatasetResponse(
        id=record["id"],
        name=record["name"],
        description=record.get("description"),
        provider=record["provider"],
        permission=record["permission"],
        indexing_technique=record.get("indexing_technique"),
        embedding_model=record.get("embedding_model"),
        embedding_model_provider=record.get("embedding_model_provider"),
        retrieval_model=record.get("retrieval_model_dict") or None,
        external_knowledge_api_id=external.get("external_knowledge_api_id"),
        external_knowledge_id=external.get("external_knowledge_id"),
        created_at=to_timestamp(record["created_at"]),
        updated_at=to_timestamp(record["updated_at"]),
    )


def _indexing_status(record: Mapping[str, Any]) -> str:
    """Public vocabulary: `completed` reads `available`, `error` reads `failed`."""
    status = str(record.get("indexing_status") or "")
    return {"completed": "available", "error": "failed"}.get(status, status)


def _document_row(record: Mapping[str, Any], *, dataset_id: str) -> DocumentResponse:
    return DocumentResponse(
        id=record["id"],
        dataset_id=dataset_id,
        name=record["name"],
        data_source_type=record.get("data_source_type"),
        indexing_status=_indexing_status(record),
        error=record.get("error"),
        enabled=bool(record.get("enabled", True)),
        archived=bool(record.get("archived", False)),
        doc_form=record.get("doc_form"),
        doc_language=record.get("doc_language"),
        # `get_detail` names it `document_process_rule`; `list_documents` rows
        # carry the same dict as `process_rule_dict`.
        document_process_rule=record.get("document_process_rule") or record.get("process_rule_dict"),
        created_at=to_timestamp(record.get("created_at")),
        updated_at=to_timestamp(record.get("updated_at")),
        completed_at=to_timestamp(record.get("completed_at")),
    )


def _dataset_defaults(ctx: Context, dataset_id: str) -> Mapping[str, Any]:
    with _dataset_errors():
        return application_services().knowledge.datasets.get_dataset(ctx.request_context, dataset_id=dataset_id)


def _document_settings(
    ctx: Context,
    dataset_id: str,
    body: DocumentCreateByTextPayload | DocumentUpdateByTextPayload,
    *,
    original_document_id: str | None,
) -> dict[str, Any]:
    """Translate the flat payload into `KnowledgeConfig` settings, uploading
    `text` as a file first — the same shape the console's create-by-upload
    path produces."""
    defaults = _dataset_defaults(ctx, dataset_id)
    settings: dict[str, Any] = {
        "name": body.name,
        "doc_form": body.doc_form or defaults.get("doc_form") or "text_model",
        "doc_language": body.doc_language or "English",
        "indexing_technique": body.indexing_technique or defaults.get("indexing_technique"),
    }
    if settings["indexing_technique"] is None:
        raise BadRequest("indexing_technique is required for the first document of a knowledge base.")
    for key in ("process_rule", "retrieval_model", "embedding_model", "embedding_model_provider"):
        value = getattr(body, key)
        if value is not None:
            settings[key] = value
    if original_document_id is not None:
        settings["original_document_id"] = original_document_id
    if body.text is not None:
        upload_file = FileService(db.engine).upload_text(
            text=body.text,
            text_name=body.name or defaults.get("name") or "document",
            user_id=ctx.account.id,
            tenant_id=ctx.workspace.id,
        )
        settings["data_source"] = {
            "info_list": {
                "data_source_type": "upload_file",
                "file_info_list": {"file_ids": [upload_file.id]},
            }
        }
    return {key: value for key, value in settings.items() if value is not None}


@openapi_ns.route(_COLLECTION)
class DatasetsApi(Resource):
    @endpoint(
        op="list.dataset",
        pat_policy=_PAT,
        kind=Kind.LIST,
        summary="Knowledge bases in the workspace",
        requirements=WORKSPACE_READ_GUARDS,
        query=DatasetListQuery,
        returns=(HTTPStatus.OK, DatasetListResponse, "Knowledge bases"),
    )
    def get(self, ctx: Context, workspace_id: str, *, query: DatasetListQuery):
        """List the workspace's knowledge bases, optionally filtered by name."""
        page = application_services().knowledge.datasets.list_datasets(
            ctx.request_context,
            DatasetListFilter(page=query.page, limit=query.limit, keyword=query.query or None),
        )
        return DatasetListResponse.build(
            page=page["page"],
            limit=page["limit"],
            total=page["total"],
            items=[_dataset_row(item) for item in page["data"]],
        )

    @endpoint(
        op="create.dataset",
        pat_policy=_PAT,
        kind=Kind.OBJECT,
        summary="Create a knowledge base",
        examples=(
            Example(
                title="A product docs base",
                input={"name": "product-docs", "indexing_technique": "high_quality"},
            ),
        ),
        requirements=_DATASET_CREATE_GUARDS,
        body=DatasetCreatePayload,
        returns=(HTTPStatus.CREATED, DatasetResponse, "Knowledge base created"),
    )
    def post(self, ctx: Context, workspace_id: str, *, body: DatasetCreatePayload):
        """Create an empty knowledge base. `provider=external` binds an external
        knowledge API instead of indexing documents locally."""
        # `exclude_none` keeps schema defaults (description, permission,
        # provider) while dropping unset optional fields; `create_empty_dataset`
        # requires `description` even when the client omits it.
        values = body.model_dump(exclude_none=True)
        if "embedding_model" in values:
            values["embedding_model_name"] = values.pop("embedding_model")
        if isinstance(values.get("retrieval_model"), dict):
            values["retrieval_model"] = RetrievalModel.model_validate(values["retrieval_model"])
        with _dataset_errors():
            result = application_services().knowledge.datasets.create_dataset(ctx.request_context, values=values)
        return _dataset_row(result), HTTPStatus.CREATED


@openapi_ns.route(_ITEM)
class DatasetApi(Resource):
    @endpoint(
        op="describe.dataset",
        pat_policy=_PAT,
        kind=Kind.OBJECT,
        summary="One knowledge base",
        requirements=WORKSPACE_READ_GUARDS,
        returns=(HTTPStatus.OK, DatasetResponse, "Knowledge base"),
    )
    def get(self, ctx: Context, workspace_id: str, dataset_id: str):
        """Read one knowledge base by id."""
        with _dataset_errors():
            result = application_services().knowledge.datasets.get_dataset(ctx.request_context, dataset_id=dataset_id)
        return _dataset_row(result)

    @endpoint(
        op="set.dataset",
        pat_policy=_PAT,
        kind=Kind.OBJECT,
        summary="Update a knowledge base",
        requirements=_DATASET_UPDATE_GUARDS,
        body=DatasetUpdatePayload,
        returns=(HTTPStatus.OK, DatasetResponse, "Knowledge base updated"),
    )
    def patch(self, ctx: Context, workspace_id: str, dataset_id: str, *, body: DatasetUpdatePayload):
        """Update a knowledge base. Only the fields present in the body change."""
        values = body.model_dump(exclude_unset=True)
        values.pop("provider", None)
        with _dataset_errors():
            result = application_services().knowledge.datasets.update_dataset(
                ctx.request_context,
                dataset_id=dataset_id,
                values=values,
            )
        return _dataset_row(result)

    @endpoint(
        op="delete.dataset",
        pat_policy=_PAT,
        kind=Kind.OBJECT,
        effect=Effect.DESTRUCTIVE,
        summary="Delete a knowledge base",
        requirements=_DATASET_DELETE_GUARDS,
        returns=(HTTPStatus.OK, SimpleResultResponse, "Knowledge base deleted"),
    )
    def delete(self, ctx: Context, workspace_id: str, dataset_id: str):
        """Delete a knowledge base and its documents."""
        with _dataset_errors():
            application_services().knowledge.datasets.delete_dataset(ctx.request_context, dataset_id=dataset_id)
        return SimpleResultResponse(result="success")


@openapi_ns.route(_DOCUMENT_CREATE)
class DocumentCreateByTextApi(Resource):
    @endpoint(
        op="create.dataset_document",
        pat_policy=_PAT,
        kind=Kind.OBJECT,
        summary="Create a document from text",
        requirements=_DOCUMENT_CREATE_GUARDS,
        body=DocumentCreateByTextPayload,
        returns=(HTTPStatus.OK, DocumentAndBatchResponse, "Document created"),
    )
    def post(self, ctx: Context, workspace_id: str, dataset_id: str, *, body: DocumentCreateByTextPayload):
        """Create a document from raw text. Indexing runs asynchronously; track
        it with the document's `indexing_status` or the batch indexing-status op."""
        settings = _document_settings(ctx, dataset_id, body, original_document_id=None)
        with _document_errors():
            result = application_services().knowledge.documents.create_documents(
                ctx.request_context, dataset_id=dataset_id, settings=settings
            )
        return DocumentAndBatchResponse(
            document=_document_row(result["documents"][0], dataset_id=dataset_id),
            batch=result["batch"],
        )


@openapi_ns.route(_DOCUMENTS)
class DatasetDocumentsApi(Resource):
    @endpoint(
        op="list.dataset_document",
        pat_policy=_PAT,
        kind=Kind.LIST,
        summary="Documents in a knowledge base",
        requirements=_DOCUMENT_READ_GUARDS,
        query=DocumentListQuery,
        returns=(HTTPStatus.OK, DocumentListResponse, "Documents"),
    )
    def get(self, ctx: Context, workspace_id: str, dataset_id: str, *, query: DocumentListQuery):
        """List the documents of a knowledge base."""
        with _document_errors():
            result = application_services().knowledge.documents.list_documents(
                ctx.request_context,
                dataset_id=dataset_id,
                query=DocumentListFilter(
                    page=query.page,
                    limit=query.limit,
                    search=query.query,
                ),
            )
        return DocumentListResponse.build(
            page=result["page"],
            limit=result["limit"],
            total=result["total"],
            items=[_document_row(item, dataset_id=dataset_id) for item in result["data"]],
        )


@openapi_ns.route(_DOCUMENT)
class DatasetDocumentApi(Resource):
    @endpoint(
        op="describe.dataset_document",
        pat_policy=_PAT,
        kind=Kind.OBJECT,
        summary="One document",
        requirements=_DOCUMENT_READ_GUARDS,
        returns=(HTTPStatus.OK, DocumentResponse, "Document"),
    )
    def get(self, ctx: Context, workspace_id: str, dataset_id: str, document_id: str):
        """Read one document, including its indexing status."""
        with _document_errors():
            result = application_services().knowledge.documents.get_document(
                ctx.request_context, dataset_id=dataset_id, document_id=document_id
            )
        return _document_row(result, dataset_id=dataset_id)

    @endpoint(
        op="delete.dataset_document",
        pat_policy=_PAT,
        kind=Kind.OBJECT,
        effect=Effect.DESTRUCTIVE,
        summary="Delete a document",
        requirements=_DOCUMENT_DELETE_GUARDS,
        returns=(HTTPStatus.OK, SimpleResultResponse, "Document deleted"),
    )
    def delete(self, ctx: Context, workspace_id: str, dataset_id: str, document_id: str):
        """Delete a document from the knowledge base."""
        with _document_errors():
            application_services().knowledge.documents.delete_document(
                ctx.request_context, dataset_id=dataset_id, document_id=document_id
            )
        return SimpleResultResponse(result="success")


@openapi_ns.route(_DOCUMENT_UPDATE)
class DocumentUpdateByTextApi(Resource):
    @endpoint(
        op="set.dataset_document",
        pat_policy=_PAT,
        kind=Kind.OBJECT,
        summary="Replace a document's text",
        requirements=_DOCUMENT_CREATE_GUARDS,
        body=DocumentUpdateByTextPayload,
        returns=(HTTPStatus.OK, DocumentAndBatchResponse, "Document updated"),
    )
    def post(
        self, ctx: Context, workspace_id: str, dataset_id: str, document_id: str, *, body: DocumentUpdateByTextPayload
    ):
        """Replace a document's content and re-index it. Fields left out keep
        their current values; providing `text` replaces the document body."""
        settings = _document_settings(ctx, dataset_id, body, original_document_id=document_id)
        with _document_errors():
            result = application_services().knowledge.documents.create_documents(
                ctx.request_context, dataset_id=dataset_id, settings=settings
            )
        return DocumentAndBatchResponse(
            document=_document_row(result["documents"][0], dataset_id=dataset_id),
            batch=result["batch"],
        )


@openapi_ns.route(_DOCUMENT_BATCH)
class DocumentBatchIndexingStatusApi(Resource):
    @endpoint(
        op="describe.dataset_document_batch",
        pat_policy=_PAT,
        kind=Kind.OBJECT,
        summary="Indexing status of a document batch",
        requirements=_DOCUMENT_READ_GUARDS,
        returns=(HTTPStatus.OK, DocumentIndexingStatusResponse, "Indexing statuses"),
    )
    def get(self, ctx: Context, workspace_id: str, dataset_id: str, batch: str):
        """Aggregate indexing status of every document created under `batch`:
        `failed` if any document failed, `available` once all complete."""
        with _document_errors():
            result = application_services().knowledge.documents.get_batch_indexing_status(
                ctx.request_context, dataset_id=dataset_id, batch=batch
            )
        statuses = [_indexing_status(row) for row in result["data"]]
        errors = [row.get("error") for row in result["data"] if row.get("error")]
        if "failed" in statuses:
            status = "failed"
        elif statuses and all(status == "available" for status in statuses):
            status = "available"
        else:
            status = "indexing"
        return DocumentIndexingStatusResponse(batch=batch, indexing_status=status, error=errors[0] if errors else None)
