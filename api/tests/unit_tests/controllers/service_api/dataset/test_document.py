"""Unit tests for the Service API document HTTP adapter."""

import io
import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal, cast
from uuid import uuid4

import pytest
from flask import Flask
from pydantic import ValidationError

from controllers.common.errors import NoFileUploadedError, NotFoundError
from controllers.service_api.app.error import (
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.service_api.dataset import document as document_module
from controllers.service_api.dataset.document import (
    DeprecatedDocumentAddByTextApi,
    DeprecatedDocumentUpdateByFileApi,
    DeprecatedDocumentUpdateByTextApi,
    DocumentAddByFileApi,
    DocumentAddByTextApi,
    DocumentApi,
    DocumentDownloadApi,
    DocumentListApi,
    DocumentUpdateByTextApi,
)
from controllers.service_api.dataset.error import DocumentSourceConflictError as DocumentSourceConflictRequestError
from core.rag.index_processor.constant.index_type import IndexStructureType
from fields.service_api.document import DocumentListQuery, DocumentTextCreatePayload, DocumentTextUpdate
from libs.exception import BaseHTTPException
from machinery.context import RequestContext
from services.knowledge.documents.application import (
    DocumentNotFoundError,
    DocumentProviderError,
    DocumentSourceConflictError,
    DocumentUploadError,
)
from services.knowledge.documents.contracts import DocumentListFilter


def _document(document_id: str = "document-id") -> dict[str, object]:
    return {"id": document_id, "name": "Document", "data_source_detail_dict": {}}


@dataclass
class RecordingDocuments:
    responses: dict[str, object] = field(default_factory=dict)
    errors: dict[str, Exception] = field(default_factory=dict)
    calls: list[tuple[str, RequestContext, dict[str, object]]] = field(default_factory=list)

    def _invoke(self, method: str, context: RequestContext, arguments: dict[str, object]) -> object:
        self.calls.append((method, context, arguments))
        if error := self.errors.get(method):
            raise error
        return self.responses[method]

    def create_by_text(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        name: str,
        text: str,
        settings: Mapping[str, object],
    ) -> dict[str, object]:
        return cast(
            dict[str, object],
            self._invoke(
                "create_by_text",
                context,
                {"dataset_id": dataset_id, "name": name, "text": text, "settings": dict(settings)},
            ),
        )

    def update_by_text(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        settings: Mapping[str, object],
    ) -> dict[str, object]:
        return cast(
            dict[str, object],
            self._invoke(
                "update_by_text",
                context,
                {"dataset_id": dataset_id, "document_id": document_id, "settings": dict(settings)},
            ),
        )

    def create_by_file(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        filename: str,
        content: bytes,
        mimetype: str,
        settings: Mapping[str, object],
    ) -> dict[str, object]:
        return cast(
            dict[str, object],
            self._invoke(
                "create_by_file",
                context,
                {
                    "dataset_id": dataset_id,
                    "filename": filename,
                    "content": content,
                    "mimetype": mimetype,
                    "settings": dict(settings),
                },
            ),
        )

    def list_documents(
        self, context: RequestContext, *, dataset_id: str, query: DocumentListFilter
    ) -> dict[str, object]:
        return cast(
            dict[str, object], self._invoke("list_documents", context, {"dataset_id": dataset_id, "query": query})
        )

    def get_document(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        metadata_only: bool,
    ) -> dict[str, object]:
        return cast(
            dict[str, object],
            self._invoke(
                "get_document",
                context,
                {"dataset_id": dataset_id, "document_id": document_id, "metadata_only": metadata_only},
            ),
        )

    def delete_document(self, context: RequestContext, *, dataset_id: str, document_id: str) -> None:
        self._invoke("delete_document", context, {"dataset_id": dataset_id, "document_id": document_id})

    def get_download_url(self, context: RequestContext, *, dataset_id: str, document_id: str) -> str:
        return cast(
            str,
            self._invoke("get_download_url", context, {"dataset_id": dataset_id, "document_id": document_id}),
        )


@dataclass(frozen=True)
class KnowledgeServices:
    documents: RecordingDocuments


@dataclass(frozen=True)
class ApplicationServices:
    knowledge: KnowledgeServices


@pytest.fixture
def request_context() -> RequestContext:
    return RequestContext(
        request_id="request-id",
        trace_id="trace-id",
        account_id="account-id",
        active_workspace_id="workspace-id",
        remote_ip="127.0.0.1",
    )


@pytest.fixture
def documents(monkeypatch: pytest.MonkeyPatch) -> RecordingDocuments:
    service = RecordingDocuments()
    registry = ApplicationServices(knowledge=KnowledgeServices(documents=service))
    monkeypatch.setattr(document_module, "application_services", lambda: registry)
    return service


class TestDocumentPayloads:
    def test_create_payload_defaults(self) -> None:
        payload = DocumentTextCreatePayload(name="Document", text="content")

        assert payload.doc_form == IndexStructureType.PARAGRAPH_INDEX
        assert payload.doc_language == "English"
        assert payload.indexing_technique is None

    def test_create_payload_rejects_unknown_document_form(self) -> None:
        with pytest.raises(ValidationError, match="Invalid doc_form"):
            DocumentTextCreatePayload(name="Document", text="content", doc_form="unknown")  # type: ignore[arg-type]

    def test_update_requires_name_when_text_is_present(self) -> None:
        with pytest.raises(ValidationError, match="name is required"):
            DocumentTextUpdate(text="replacement")

    def test_update_allows_settings_without_text(self) -> None:
        payload = DocumentTextUpdate(doc_language="French")

        assert payload.text is None
        assert payload.name is None

    def test_list_query_defaults(self) -> None:
        query = DocumentListQuery()

        assert query.page == 1
        assert query.limit == 20
        assert query.keyword is None
        assert query.status is None


class TestDocumentControllerDelegation:
    def test_create_by_text_parses_input_and_delegates(
        self, app: Flask, documents: RecordingDocuments, request_context: RequestContext
    ) -> None:
        dataset_id = uuid4()
        documents.responses["create_by_text"] = {"documents": [_document()], "batch": "batch-id"}

        with app.test_request_context(
            json={
                "name": "Guide",
                "text": "content",
                "doc_language": "French",
                "indexing_technique": "economy",
            }
        ):
            body, status = DocumentAddByTextApi().post(request_context, dataset_id)

        assert status == 200
        assert body["document"]["id"] == "document-id"
        assert body["batch"] == "batch-id"
        method, used_context, arguments = documents.calls[-1]
        assert method == "create_by_text"
        assert used_context is request_context
        assert arguments["dataset_id"] == str(dataset_id)
        assert arguments["name"] == "Guide"
        assert arguments["text"] == "content"
        settings = cast(dict[str, object], arguments["settings"])
        assert settings["doc_language"] == "French"

    def test_update_by_text_delegates_document_identity(
        self, app: Flask, documents: RecordingDocuments, request_context: RequestContext
    ) -> None:
        dataset_id, document_id = uuid4(), uuid4()
        documents.responses["update_by_text"] = {"documents": [_document(str(document_id))], "batch": "batch-id"}

        with app.test_request_context(json={"name": "Renamed", "text": "replacement"}):
            body, status = DocumentUpdateByTextApi().post(request_context, dataset_id, document_id)

        assert status == 200
        assert body["document"]["id"] == str(document_id)
        _, _, arguments = documents.calls[-1]
        assert arguments == {
            "dataset_id": str(dataset_id),
            "document_id": str(document_id),
            "settings": {
                "name": "Renamed",
                "text": "replacement",
                "doc_form": "text_model",
                "doc_language": "English",
            },
        }

    def test_create_by_file_parses_multipart_input(
        self, app: Flask, documents: RecordingDocuments, request_context: RequestContext
    ) -> None:
        dataset_id = uuid4()
        documents.responses["create_by_file"] = {"documents": [_document()], "batch": "batch-id"}

        with app.test_request_context(
            method="POST",
            data={
                "data": json.dumps({"doc_language": "Japanese", "indexing_technique": "economy"}),
                "file": (io.BytesIO(b"file contents"), "guide.txt", "text/plain"),
            },
            content_type="multipart/form-data",
        ):
            _, status = DocumentAddByFileApi().post(request_context, dataset_id)

        assert status == 200
        method, used_context, arguments = documents.calls[-1]
        assert method == "create_by_file"
        assert used_context is request_context
        assert arguments == {
            "dataset_id": str(dataset_id),
            "filename": "guide.txt",
            "content": b"file contents",
            "mimetype": "text/plain",
            "settings": {"doc_language": "Japanese", "indexing_technique": "economy"},
        }

    def test_create_by_file_requires_upload(
        self, app: Flask, documents: RecordingDocuments, request_context: RequestContext
    ) -> None:
        with app.test_request_context(method="POST", data={}, content_type="multipart/form-data"):
            with pytest.raises(NoFileUploadedError):
                DocumentAddByFileApi().post(request_context, uuid4())

        assert documents.calls == []

    def test_create_by_file_preserves_invalid_param_for_unsupported_type(
        self, app: Flask, documents: RecordingDocuments, request_context: RequestContext
    ) -> None:
        documents.errors["create_by_file"] = DocumentUploadError("File type not allowed.", kind="unsupported")

        with app.test_request_context(
            method="POST",
            data={"file": (io.BytesIO(b"contents"), "guide.exe", "application/octet-stream")},
            content_type="multipart/form-data",
        ):
            with pytest.raises(ValueError, match="File type not allowed"):
                DocumentAddByFileApi().post(request_context, uuid4())

    def test_create_maps_source_cleanup_race_to_conflict(
        self, app: Flask, documents: RecordingDocuments, request_context: RequestContext
    ) -> None:
        documents.errors["create_by_text"] = DocumentSourceConflictError("source is pending deletion")

        with app.test_request_context(json={"name": "Guide", "text": "content", "indexing_technique": "economy"}):
            with pytest.raises(DocumentSourceConflictRequestError) as raised:
                DocumentAddByTextApi().post(request_context, uuid4())

        assert raised.value.code == 409
        assert raised.value.error_code == "document_source_conflict"

    @pytest.mark.parametrize(
        ("kind", "error_type", "error_code"),
        [
            ("uninitialized", ProviderNotInitializeError, "provider_not_initialize"),
            ("quota", ProviderQuotaExceededError, "provider_quota_exceeded"),
            ("unsupported", ProviderModelCurrentlyNotSupportError, "model_currently_not_support"),
        ],
    )
    def test_create_maps_provider_failures_to_stable_400_contract(
        self,
        app: Flask,
        documents: RecordingDocuments,
        request_context: RequestContext,
        kind: Literal["uninitialized", "quota", "unsupported"],
        error_type: type[BaseHTTPException],
        error_code: str,
    ) -> None:
        documents.errors["create_by_text"] = DocumentProviderError("provider failed", kind=kind)

        with app.test_request_context(json={"name": "Guide", "text": "content", "indexing_technique": "economy"}):
            with pytest.raises(error_type) as raised:
                DocumentAddByTextApi().post(request_context, uuid4())

        error = raised.value
        assert error.code == 400
        assert error.error_code == error_code

    def test_list_translates_query_to_domain_contract(
        self, app: Flask, documents: RecordingDocuments, request_context: RequestContext
    ) -> None:
        dataset_id = uuid4()
        documents.responses["list_documents"] = {
            "data": [
                {
                    **_document(),
                    "enabled": True,
                    "indexing_state": "failed",
                    "error": "provider unavailable",
                }
            ],
            "has_more": False,
            "limit": 5,
            "total": 1,
            "page": 2,
        }

        with app.test_request_context("/?page=2&limit=5&keyword=guide&status=available"):
            result = DocumentListApi().get(request_context, dataset_id)

        assert result["data"][0]["id"] == "document-id"
        assert result["data"][0]["enabled"] is True
        assert result["data"][0]["indexing_state"] == "failed"
        assert result["data"][0]["error"] == "provider unavailable"
        _, used_context, arguments = documents.calls[-1]
        assert used_context is request_context
        assert arguments == {
            "dataset_id": str(dataset_id),
            "query": DocumentListFilter(page=2, limit=5, search="guide", status="available"),
        }

    def test_metadata_only_detail_uses_application_result(
        self, app: Flask, documents: RecordingDocuments, request_context: RequestContext
    ) -> None:
        dataset_id, document_id = uuid4(), uuid4()
        metadata: list[dict[str, object]] = []
        documents.responses["get_document"] = {
            "id": str(document_id),
            "doc_type": "book",
            "doc_metadata": metadata,
        }

        with app.test_request_context("/?metadata=only"):
            result = DocumentApi().get(request_context, dataset_id, document_id)

        assert result == {"id": str(document_id), "doc_type": "book", "doc_metadata": metadata}
        assert documents.calls[-1][2]["metadata_only"] is True

    def test_full_detail_serializes_missing_process_rule_as_empty_object(
        self, app: Flask, documents: RecordingDocuments, request_context: RequestContext
    ) -> None:
        dataset_id, document_id = uuid4(), uuid4()
        empty_source: dict[str, object] = {}
        documents.responses["get_document"] = {
            "id": str(document_id),
            "data_source_detail_dict": empty_source,
            "document_process_rule": None,
            "enabled": False,
            "indexing_state": "failed",
            "error": "vector cleanup failed",
        }

        with app.test_request_context("/"):
            result = DocumentApi().get(request_context, dataset_id, document_id)

        assert result["data_source_info"] == {}
        assert result["document_process_rule"] == {}
        assert result["enabled"] is False
        assert result["indexing_state"] == "failed"
        assert result["error"] == "vector cleanup failed"

    def test_domain_not_found_is_mapped_at_http_boundary(
        self, documents: RecordingDocuments, request_context: RequestContext
    ) -> None:
        documents.errors["delete_document"] = DocumentNotFoundError("Document not found.")

        with pytest.raises(NotFoundError) as raised:
            DocumentApi().delete(request_context, uuid4(), uuid4())

        assert raised.value.code == 404
        assert raised.value.description == "Document not found."

    def test_download_delegates_and_serializes_url(
        self, documents: RecordingDocuments, request_context: RequestContext
    ) -> None:
        dataset_id, document_id = uuid4(), uuid4()
        documents.responses["get_download_url"] = "https://files.example/document"

        result = DocumentDownloadApi().get(request_context, dataset_id, document_id)

        assert result == {"url": "https://files.example/document"}
        assert documents.calls[-1] == (
            "get_download_url",
            request_context,
            {"dataset_id": str(dataset_id), "document_id": str(document_id)},
        )


class TestDocumentAdmissionPolicies:
    def test_create_by_text_declares_rate_and_billing_checks(self) -> None:
        policy = DocumentAddByTextApi.post.__dataset_admission_policy__

        assert policy.rate_limit is True
        assert policy.billing_resources == ("vector_space", "documents")

    def test_delete_declares_rate_limit(self) -> None:
        policy = DocumentApi.delete.__dataset_admission_policy__

        assert policy.rate_limit is True
        assert policy.billing_resources == ()


class TestDocumentRouteDeprecation:
    def test_create_by_text_legacy_alias_is_deprecated(self) -> None:
        assert DeprecatedDocumentAddByTextApi.post.__apidoc__["deprecated"] is True
        assert DocumentAddByTextApi.post.__apidoc__.get("deprecated") is not True

    def test_update_by_text_legacy_alias_is_deprecated(self) -> None:
        assert DeprecatedDocumentUpdateByTextApi.post.__apidoc__["deprecated"] is True
        assert DocumentUpdateByTextApi.post.__apidoc__.get("deprecated") is not True

    def test_update_by_file_legacy_aliases_are_deprecated(self) -> None:
        assert DeprecatedDocumentUpdateByFileApi.post.__apidoc__["deprecated"] is True
        assert DocumentApi.patch.__apidoc__.get("deprecated") is not True
