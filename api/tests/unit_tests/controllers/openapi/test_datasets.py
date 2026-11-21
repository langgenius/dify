import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from http import HTTPStatus
from types import SimpleNamespace
from typing import Protocol, cast
from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from constants.oauth_bearer import TokenType
from controllers.openapi import datasets as datasets_module
from controllers.openapi._models import (
    DatasetCreatePayload,
    DatasetResponse,
    DocumentCreateByTextPayload,
    DocumentUpdateByTextPayload,
)
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import AccountSubject
from controllers.openapi.datasets import _dataset_row, _display_status, _document_row
from libs.oauth_bearer import AuthContext
from tests.helpers.unit.model_factories import make_account, make_tenant


class _EndpointView(Protocol):
    __handler__: Callable[..., tuple[DatasetResponse, HTTPStatus]]


def _ctx() -> Context:
    auth = AuthContext(
        token_type=TokenType.OAUTH_ACCOUNT,
        subject_email="caller@example.com",
        subject_issuer="dify:account",
        account_id=uuid.uuid4(),
        client_id="difyctl",
        token_id=uuid.uuid4(),
        expires_at=None,
    )
    ctx = Context(AccountSubject(auth), Mock(), {"workspace_id": "ws-1"})
    ctx._workspace = make_tenant(tenant_id="ws-1")
    ctx._caller = make_account(account_id="acct-1")
    return ctx


def _services(
    *,
    create_dataset=None,
    get_dataset=None,
    create_documents=None,
) -> SimpleNamespace:
    return SimpleNamespace(
        knowledge=SimpleNamespace(
            datasets=SimpleNamespace(create_dataset=create_dataset, get_dataset=get_dataset),
            documents=SimpleNamespace(create_documents=create_documents),
        )
    )


def _dataset(**extra: object) -> dict[str, object]:
    return {
        "id": "ds-1",
        "name": "Docs",
        "description": "desc",
        "provider": "vendor",
        "permission": "only_me",
        "indexing_technique": "high_quality",
        "embedding_model": "text-embedding-3-small",
        "embedding_model_provider": "openai",
        "retrieval_model_dict": {"search_method": "semantic_search"},
        "external_knowledge_info": {},
        "created_at": datetime(2025, 1, 1, tzinfo=UTC),
        "updated_at": datetime(2025, 1, 2, tzinfo=UTC),
        **extra,
    }


def _document(**extra: object) -> dict[str, object]:
    return {
        "id": "doc-1",
        "name": "guide.md",
        "data_source_type": "upload_file",
        "indexing_status": "completed",
        "display_status": "available",
        "error": None,
        "enabled": True,
        "archived": False,
        "doc_form": "text_model",
        "doc_language": "English",
        "document_process_rule": {"mode": "custom", "rules": {}},
        "created_at": datetime(2025, 1, 1, tzinfo=UTC),
        "updated_at": datetime(2025, 1, 2, tzinfo=UTC),
        "completed_at": datetime(2025, 1, 2, tzinfo=UTC),
        **extra,
    }


def test_dataset_row_maps_external_knowledge_fields() -> None:
    row = _dataset_row(
        _dataset(
            provider="external",
            external_knowledge_info={
                "external_knowledge_api_id": "api-1",
                "external_knowledge_id": "kb-9",
            },
        )
    )
    assert row.provider == "external"
    assert row.external_knowledge_api_id == "api-1"
    assert row.external_knowledge_id == "kb-9"
    assert row.retrieval_model == {"search_method": "semantic_search"}


def test_display_status_uses_public_vocabulary() -> None:
    assert _display_status({"display_status": "available"}) == "available"
    assert _display_status({"display_status": "error"}) == "error"
    assert _display_status({}) is None


def test_document_row_carries_dataset_id_and_mapped_status() -> None:
    row = _document_row(_document(), dataset_id="ds-1")
    assert row.dataset_id == "ds-1"
    assert row.display_status == "available"
    assert row.document_process_rule == {"mode": "custom", "rules": {}}


def test_invalid_retrieval_model_is_rejected_by_the_payload() -> None:
    with pytest.raises(ValidationError, match="retrieval_model"):
        DatasetCreatePayload.model_validate({"name": "Docs", "retrieval_model": {"search_method": "nope"}})


def test_external_dataset_requires_binding_ids() -> None:
    with pytest.raises(ValidationError, match="external_knowledge_api_id and external_knowledge_id"):
        DatasetCreatePayload.model_validate({"name": "Docs", "provider": "external"})


def test_create_document_requires_name_and_text() -> None:
    with pytest.raises(ValidationError):
        DocumentCreateByTextPayload.model_validate({"name": "guide.md"})
    with pytest.raises(ValidationError):
        DocumentCreateByTextPayload.model_validate({"text": "hello"})


def test_update_document_requires_a_change() -> None:
    with pytest.raises(ValidationError, match="provide at least one of text, name, or process_rule"):
        DocumentUpdateByTextPayload.model_validate({})
    with pytest.raises(ValidationError, match="provide at least one of text, name, or process_rule"):
        DocumentUpdateByTextPayload.model_validate({"name": ""})


def test_dataset_post_passes_null_indexing_technique(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def create_dataset(_request_context, *, values):
        captured.update(values)
        return _dataset()

    monkeypatch.setattr(datasets_module, "application_services", lambda: _services(create_dataset=create_dataset))

    api = datasets_module.DatasetsApi()
    response, status = cast(_EndpointView, api.post).__handler__(
        api, _ctx(), workspace_id="ws-1", body=DatasetCreatePayload(name="Docs")
    )

    assert status == HTTPStatus.CREATED
    assert response.name == "Docs"
    # The legacy adapter takes `indexing_technique` even when null.
    assert "indexing_technique" in captured
    assert captured["indexing_technique"] is None


def _stub_defaults_and_upload(monkeypatch: pytest.MonkeyPatch, file_service: Mock) -> None:
    file_service.upload_text.return_value = SimpleNamespace(id="file-1")
    monkeypatch.setattr(datasets_module, "db", SimpleNamespace(engine=Mock()))
    monkeypatch.setattr(datasets_module, "FileService", lambda *_args: file_service)
    monkeypatch.setattr(
        datasets_module,
        "application_services",
        lambda: _services(get_dataset=lambda *_args, **_kwargs: _dataset()),
    )


def test_document_settings_marks_create_as_non_duplicate(monkeypatch: pytest.MonkeyPatch) -> None:
    file_service = Mock()
    _stub_defaults_and_upload(monkeypatch, file_service)

    settings = datasets_module._document_settings(
        _ctx(),
        "ds-1",
        DocumentCreateByTextPayload(name="guide.md", text="hello"),
        original_document_id=None,
    )

    assert settings["duplicate"] is False
    assert settings["data_source"]["info_list"]["file_info_list"]["file_ids"] == ["file-1"]


def test_document_settings_update_does_not_mark_duplicate(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_defaults_and_upload(monkeypatch, Mock())

    settings = datasets_module._document_settings(
        _ctx(),
        "ds-1",
        DocumentUpdateByTextPayload(name="renamed.md"),
        original_document_id="doc-1",
    )

    assert settings["original_document_id"] == "doc-1"
    assert "duplicate" not in settings


def test_failed_ingestion_keeps_the_uploaded_file(monkeypatch: pytest.MonkeyPatch) -> None:
    file_service = Mock()
    file_service.upload_text.return_value = SimpleNamespace(id="file-1")
    monkeypatch.setattr(datasets_module, "db", SimpleNamespace(engine=Mock()))
    monkeypatch.setattr(datasets_module, "FileService", lambda *_args: file_service)
    monkeypatch.setattr(
        datasets_module,
        "application_services",
        lambda: _services(
            get_dataset=lambda *_args, **_kwargs: _dataset(),
            create_documents=Mock(side_effect=RuntimeError("ingestion failed")),
        ),
    )

    with pytest.raises(RuntimeError, match="ingestion failed"):
        datasets_module._create_documents(
            _ctx(),
            "ds-1",
            DocumentCreateByTextPayload(name="guide.md", text="hello"),
            original_document_id=None,
        )

    file_service.delete_file.assert_not_called()
