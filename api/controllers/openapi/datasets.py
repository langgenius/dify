"""Knowledge bases (datasets) and their documents."""

from __future__ import annotations

from collections.abc import Generator, Mapping
from contextlib import contextmanager
from http import HTTPStatus
from typing import Any, Final

from flask_restx import Resource
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound

from configs import dify_config
from constants.personal_access_token import PersonalAccessTokenPolicy
from controllers.common.fields import SimpleResultResponse
from controllers.common.rbac import DatasetId, RBACCheck, RBACPermission
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Effect, Example, Kind, endpoint
from controllers.openapi._models import (
    DatasetCreatePayload,
    DatasetDetailResponse,
    DatasetListQuery,
    DatasetListResponse,
    DatasetPermission,
    DatasetResponse,
    DatasetUpdatePayload,
    DocumentAndBatchResponse,
    DocumentBatchItem,
    DocumentCreateByTextPayload,
    DocumentDisplayStatus,
    DocumentIndexingStatusResponse,
    DocumentListQuery,
    DocumentListResponse,
    DocumentResponse,
    DocumentUpdateByTextPayload,
    DocumentUpdateResponse,
)
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import (
    WORKSPACE_READ_GUARDS,
    CheckDocumentsUploadQuota,
    CheckKnowledgeRateLimit,
    CheckRBACPermission,
    CheckVectorSpaceQuota,
    workspace_write_guards,
)
from extensions.ext_application_services import application_services
from libs.helper import to_timestamp
from models.account import TenantAccountRole
from models.enums import DocumentCreatedFrom
from services.errors.dataset import DatasetNameDuplicateError as DatasetNameDuplicateFailure
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.datasets.application import DatasetListFilter
from services.knowledge.documents.application import (
    DocumentApplicationError,
    DocumentListFilter,
    DocumentNotFoundError,
    DocumentProviderError,
    DocumentTextUpload,
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


_DATASET_CREATE_GUARDS: Final = workspace_write_guards(
    RBACPermission.DATASET_CREATE_AND_MANAGEMENT,
    roles=_DATASET_EDIT_ROLES,
    extra=(CheckKnowledgeRateLimit(),),
)
_DATASET_UPDATE_GUARDS: Final = workspace_write_guards(
    RBACPermission.DATASET_EDIT,
    roles=_DATASET_EDIT_ROLES,
    locator=DatasetId(),
    extra=(CheckKnowledgeRateLimit(),),
)
_DATASET_DELETE_GUARDS: Final = workspace_write_guards(
    RBACPermission.DATASET_DELETE,
    roles=_DATASET_EDIT_ROLES,
    locator=DatasetId(),
    extra=(CheckKnowledgeRateLimit(),),
)
_DOCUMENT_CREATE_GUARDS: Final = workspace_write_guards(
    RBACPermission.DATASET_USE,
    roles=_DATASET_EDIT_ROLES,
    locator=DatasetId(),
    extra=(CheckKnowledgeRateLimit(), CheckDocumentsUploadQuota(), CheckVectorSpaceQuota()),
)
_DOCUMENT_UPDATE_GUARDS: Final = workspace_write_guards(
    RBACPermission.DATASET_USE,
    roles=_DATASET_EDIT_ROLES,
    locator=DatasetId(),
    extra=(CheckKnowledgeRateLimit(), CheckVectorSpaceQuota()),
)
_DOCUMENT_DELETE_GUARDS: Final = workspace_write_guards(
    RBACPermission.DATASET_DELETE_FILE,
    roles=_DATASET_EDIT_ROLES,
    locator=DatasetId(),
    extra=(CheckKnowledgeRateLimit(),),
)
_DATASET_READ_GUARDS: Final = (
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


def _dataset_detail_row(record: Mapping[str, Any]) -> DatasetDetailResponse:
    return DatasetDetailResponse(
        **_dataset_row(record).model_dump(),
        partial_member_list=None if dify_config.RBAC_ENABLED else record.get("partial_member_list"),
    )


def _display_status(record: Mapping[str, Any]) -> str | None:
    """The public document status vocabulary shared with the legacy service API."""
    status = record.get("display_status")
    return str(status) if status is not None else None


def _document_row(record: Mapping[str, Any], *, dataset_id: str) -> DocumentResponse:
    return DocumentResponse(
        id=record["id"],
        dataset_id=dataset_id,
        name=record["name"],
        data_source_type=record.get("data_source_type"),
        display_status=_display_status(record),
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
) -> tuple[dict[str, Any], DocumentTextUpload | None]:
    """Resolve dataset defaults and translate the payload without writing files."""
    defaults = _dataset_defaults(ctx, dataset_id)
    if defaults["provider"] == "external":
        raise BadRequest("External datasets do not support local documents.")
    settings: dict[str, Any] = {
        "name": body.name,
        "doc_form": body.doc_form or defaults.get("doc_form") or "text_model",
        "indexing_technique": defaults.get("indexing_technique"),
        "process_rule": body.process_rule,
    }
    if isinstance(body, DocumentCreateByTextPayload):
        settings.update(
            doc_language=body.doc_language or "English",
            indexing_technique=body.indexing_technique or settings["indexing_technique"],
            retrieval_model=body.retrieval_model,
            embedding_model=body.embedding_model,
            embedding_model_provider=body.embedding_model_provider,
        )
    if settings["indexing_technique"] is None:
        raise BadRequest("indexing_technique is required for the first document of a knowledge base.")
    if original_document_id is not None:
        settings["original_document_id"] = original_document_id
    else:
        # `duplicate=False` keeps create from silently overwriting a same-name
        # document; update passes `original_document_id` instead.
        settings["duplicate"] = False
    text_upload = (
        DocumentTextUpload(text=body.text, name=body.name or defaults.get("name") or "document")
        if body.text is not None
        else None
    )
    return {key: value for key, value in settings.items() if value is not None}, text_upload


def _create_documents(
    ctx: Context,
    dataset_id: str,
    body: DocumentCreateByTextPayload | DocumentUpdateByTextPayload,
    *,
    original_document_id: str | None,
) -> dict[str, Any]:
    """Translate text ingestion inputs and map service failures to HTTP errors."""
    with _document_errors():
        settings, text_upload = _document_settings(ctx, dataset_id, body, original_document_id=original_document_id)
        return application_services().knowledge.documents.create_documents(
            ctx.request_context,
            dataset_id=dataset_id,
            settings=settings,
            created_from=DocumentCreatedFrom.API,
            text_upload=text_upload,
        )


@openapi_ns.route(_COLLECTION)
class DatasetsApi(Resource):
    @endpoint(
        op="get.dataset",
        pat_policy=_PAT,
        kind=Kind.LIST,
        summary="Knowledge bases in the workspace",
        examples=(Example(title="List the first page of knowledge bases", input={"page": 1, "limit": 20}),),
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
        if not dify_config.RBAC_ENABLED and body.permission == DatasetPermission.PARTIAL_MEMBERS:
            raise BadRequest("partial_members is not supported when creating a dataset.")
        # `exclude_none` keeps schema defaults (description, permission,
        # provider) while dropping unset optional fields; `create_empty_dataset`
        # requires `description` even when the client omits it.
        values = body.model_dump(exclude_none=True, exclude={"retrieval_model"})
        # RBAC owns dataset access; the legacy permission value is inert there.
        if dify_config.RBAC_ENABLED:
            values.pop("permission", None)
        # The legacy adapter takes `indexing_technique` as an argument even when null.
        values["indexing_technique"] = body.indexing_technique
        if "embedding_model" in values:
            values["embedding_model_name"] = values.pop("embedding_model")
        if body.retrieval_model is not None:
            # The payload validates the shape so this can no longer escape as a 500.
            values["retrieval_model"] = RetrievalModel.model_validate(body.retrieval_model)
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
        examples=(Example(title="Read a knowledge base", input={"dataset_id": "<dataset_id>"}),),
        requirements=_DATASET_READ_GUARDS,
        returns=(HTTPStatus.OK, DatasetDetailResponse, "Knowledge base"),
    )
    def get(self, ctx: Context, workspace_id: str, dataset_id: str):
        """Read one knowledge base by id."""
        with _dataset_errors():
            result = application_services().knowledge.datasets.get_dataset(ctx.request_context, dataset_id=dataset_id)
        return _dataset_detail_row(result)

    @endpoint(
        op="set.dataset",
        pat_policy=_PAT,
        kind=Kind.OBJECT,
        summary="Update a knowledge base",
        examples=(
            Example(title="Rename a knowledge base", input={"dataset_id": "<dataset_id>", "name": "product-docs"}),
        ),
        requirements=_DATASET_UPDATE_GUARDS,
        body=DatasetUpdatePayload,
        returns=(HTTPStatus.OK, DatasetDetailResponse, "Knowledge base updated"),
    )
    def patch(self, ctx: Context, workspace_id: str, dataset_id: str, *, body: DatasetUpdatePayload):
        """Update a knowledge base. Only the fields present in the body change.

        Indexing settings are fixed after creation; changing them rebuilds the
        whole index and is not exposed here.
        """
        values = body.model_dump(exclude_unset=True)
        if dify_config.RBAC_ENABLED:
            values.pop("permission", None)
            values.pop("partial_member_list", None)
        elif (body.permission == DatasetPermission.PARTIAL_MEMBERS) != (body.partial_member_list is not None):
            raise BadRequest("partial_member_list must be supplied exactly when permission is partial_members")
        with _dataset_errors():
            result = application_services().knowledge.datasets.update_dataset(
                ctx.request_context,
                dataset_id=dataset_id,
                values=values,
            )
        return _dataset_detail_row(result)

    @endpoint(
        op="delete.dataset",
        pat_policy=_PAT,
        kind=Kind.OBJECT,
        effect=Effect.DESTRUCTIVE,
        summary="Delete a knowledge base",
        examples=(Example(title="Delete a knowledge base", input={"dataset_id": "<dataset_id>"}),),
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
        examples=(
            Example(
                title="Create a document from raw text",
                input={"dataset_id": "<dataset_id>", "name": "guide.md", "text": "# Guide\nDeploy with Docker."},
            ),
        ),
        requirements=_DOCUMENT_CREATE_GUARDS,
        body=DocumentCreateByTextPayload,
        returns=(HTTPStatus.OK, DocumentAndBatchResponse, "Document created"),
    )
    def post(self, ctx: Context, workspace_id: str, dataset_id: str, *, body: DocumentCreateByTextPayload):
        """Create a document from raw text. Indexing runs asynchronously; track
        it with the document's `display_status` or the batch indexing-status op."""
        result = _create_documents(ctx, dataset_id, body, original_document_id=None)
        return DocumentAndBatchResponse(
            document=_document_row(result["documents"][0], dataset_id=dataset_id),
            batch=result["batch"],
        )


@openapi_ns.route(_DOCUMENTS)
class DatasetDocumentsApi(Resource):
    @endpoint(
        op="get.dataset_document",
        pat_policy=_PAT,
        kind=Kind.LIST,
        summary="Documents in a knowledge base",
        examples=(Example(title="Find documents by name", input={"dataset_id": "<dataset_id>", "query": "guide"}),),
        requirements=_DATASET_READ_GUARDS,
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
        examples=(
            Example(
                title="Read a document and its indexing status",
                input={"dataset_id": "<dataset_id>", "document_id": "<document_id>"},
            ),
        ),
        requirements=_DATASET_READ_GUARDS,
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
        examples=(
            Example(
                title="Delete a document",
                input={"dataset_id": "<dataset_id>", "document_id": "<document_id>"},
            ),
        ),
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
        examples=(
            Example(
                title="Replace a document's text",
                input={
                    "dataset_id": "<dataset_id>",
                    "document_id": "<document_id>",
                    "name": "guide.md",
                    "text": "# Guide\nUpdated deployment steps.",
                },
            ),
        ),
        requirements=_DOCUMENT_UPDATE_GUARDS,
        body=DocumentUpdateByTextPayload,
        returns=(HTTPStatus.OK, DocumentUpdateResponse, "Document updated"),
    )
    def post(
        self, ctx: Context, workspace_id: str, dataset_id: str, document_id: str, *, body: DocumentUpdateByTextPayload
    ):
        """Replace a document's content and re-index it. Poll the document by ID
        to track indexing; its original import batch does not track this update."""
        result = _create_documents(ctx, dataset_id, body, original_document_id=document_id)
        return DocumentUpdateResponse(document=_document_row(result["documents"][0], dataset_id=dataset_id))


@openapi_ns.route(_DOCUMENT_BATCH)
class DocumentBatchIndexingStatusApi(Resource):
    @endpoint(
        op="get.dataset_document.indexing_status",
        pat_policy=_PAT,
        kind=Kind.OBJECT,
        summary="Indexing status of a document batch",
        examples=(
            Example(
                title="Check a document batch",
                input={"dataset_id": "<dataset_id>", "batch": "<batch>"},
            ),
        ),
        requirements=_DATASET_READ_GUARDS,
        returns=(HTTPStatus.OK, DocumentIndexingStatusResponse, "Indexing statuses"),
    )
    def get(self, ctx: Context, workspace_id: str, dataset_id: str, batch: str):
        """Aggregate indexing status for a batch: `error` if any document failed,
        `available` once all complete, even if some are disabled or archived."""
        with _document_errors():
            result = application_services().knowledge.documents.get_batch_indexing_status(
                ctx.request_context, dataset_id=dataset_id, batch=batch
            )
        rows = result["data"]
        statuses = [_display_status(row) for row in rows]
        errors = [row.get("error") for row in rows if row.get("error")]
        if DocumentDisplayStatus.ERROR in statuses:
            status = DocumentDisplayStatus.ERROR
        elif statuses and all(
            value
            in {
                DocumentDisplayStatus.AVAILABLE,
                DocumentDisplayStatus.DISABLED,
                DocumentDisplayStatus.ARCHIVED,
            }
            for value in statuses
        ):
            status = DocumentDisplayStatus.AVAILABLE
        elif statuses and all(value == DocumentDisplayStatus.QUEUING for value in statuses):
            status = DocumentDisplayStatus.QUEUING
        elif statuses and all(value == DocumentDisplayStatus.PAUSED for value in statuses):
            status = DocumentDisplayStatus.PAUSED
        else:
            status = DocumentDisplayStatus.INDEXING
        return DocumentIndexingStatusResponse(
            batch=batch,
            display_status=status,
            error=errors[0] if errors else None,
            documents=[
                DocumentBatchItem(
                    id=row["id"],
                    display_status=_display_status(row),
                    error=row.get("error"),
                    completed_segments=row.get("completed_segments"),
                    total_segments=row.get("total_segments"),
                )
                for row in rows
            ],
        )
