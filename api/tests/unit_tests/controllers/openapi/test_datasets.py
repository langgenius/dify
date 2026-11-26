import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from http import HTTPStatus

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest

from constants.oauth_bearer import TokenType
from controllers.openapi import datasets as datasets_module
from controllers.openapi._models import (
    DatasetCreatePayload,
    DatasetDetailResponse,
    DatasetResponse,
    DatasetUpdatePayload,
    DocumentCreateByTextPayload,
    DocumentDisplayStatus,
    DocumentIndexingStatusResponse,
    DocumentUpdateByTextPayload,
    DocumentUpdateResponse,
)
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import AccountSubject
from controllers.openapi.datasets import (
    DatasetApi,
    DatasetsApi,
    DocumentBatchIndexingStatusApi,
    DocumentUpdateByTextApi,
    _dataset_detail_row,
    _dataset_row,
    _display_status,
    _document_row,
)
from libs.oauth_bearer import AuthContext
from services.knowledge.documents.application import DocumentTextUpload
from tests.helpers.unit.model_factories import make_account, make_tenant


def _endpoint_handler(view: object) -> Callable[..., object]:
    """Return the request handler the `@endpoint` decorator attaches to a view.

    ``__handler__`` is injected at decoration time, so it is absent from the
    static type of the decorated view; read it through the instance dictionary
    once here instead of at every call site.
    """
    handler = vars(view).get("__handler__")
    assert callable(handler)
    return handler


def _ctx(session: Session) -> Context:
    auth = AuthContext(
        token_type=TokenType.OAUTH_ACCOUNT,
        subject_email="caller@example.com",
        subject_issuer="dify:account",
        account_id=uuid.uuid4(),
        client_id="difyctl",
        token_id=uuid.uuid4(),
        expires_at=None,
    )
    ctx = Context(AccountSubject(auth), session, {"workspace_id": "ws-1"})
    ctx._workspace = make_tenant(tenant_id="ws-1")
    ctx._caller = make_account(account_id="acct-1")
    return ctx


class _FakeDatasets:
    """Dataset service fake that records created values and returns one row."""

    def __init__(self, row: Mapping[str, object] | None = None) -> None:
        self.row = row if row is not None else _dataset()
        self.created_values: list[Mapping[str, object]] = []
        self.updated_values: list[tuple[str, Mapping[str, object]]] = []
        self.queried_dataset_ids: list[str] = []

    def get_dataset(self, _request_context: object, *, dataset_id: str) -> Mapping[str, object]:
        self.queried_dataset_ids.append(dataset_id)
        return self.row

    def create_dataset(self, _request_context: object, *, values: Mapping[str, object]) -> Mapping[str, object]:
        self.created_values.append(values)
        return self.row

    def update_dataset(
        self, _request_context: object, *, dataset_id: str, values: Mapping[str, object]
    ) -> Mapping[str, object]:
        self.updated_values.append((dataset_id, values))
        return self.row


class _FakeDocuments:
    """Documents service fake whose ingestion outcome the test chooses."""

    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []
        self.batch_rows: list[Mapping[str, object]] = []

    def create_documents(self, _request_context: object, **kwargs: object) -> Mapping[str, object]:
        self.calls.append(kwargs)
        return {"documents": [_document()], "batch": "batch-1"}

    def get_batch_indexing_status(
        self,
        _request_context: object,
        *,
        dataset_id: str,  # noqa: ARG002
        batch: str,  # noqa: ARG002
    ) -> Mapping[str, object]:
        return {"data": self.batch_rows}


@dataclass
class _FakeKnowledge:
    datasets: _FakeDatasets
    documents: _FakeDocuments


@dataclass
class _FakeServices:
    knowledge: _FakeKnowledge


def _bind_services(
    monkeypatch: pytest.MonkeyPatch,
    *,
    datasets: _FakeDatasets | None = None,
    documents: _FakeDocuments | None = None,
) -> tuple[_FakeDatasets, _FakeDocuments]:
    """Bind the controller's service locator to explicit fakes."""
    dataset_service = datasets if datasets is not None else _FakeDatasets()
    document_service = documents if documents is not None else _FakeDocuments()
    services = _FakeServices(_FakeKnowledge(dataset_service, document_service))
    monkeypatch.setattr(datasets_module, "application_services", lambda: services)
    return dataset_service, document_service


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


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("indexing_technique", "economy"),
        ("embedding_model", "text-embedding-3-small"),
        ("embedding_model_provider", "openai"),
        ("is_multimodal", True),
    ],
)
def test_update_dataset_payload_rejects_indexing_changes(field: str, value: object) -> None:
    """Indexing settings rebuild the whole index, so the patch contract omits them."""
    with pytest.raises(ValidationError, match=field):
        DatasetUpdatePayload.model_validate({field: value})


def test_update_dataset_payload_accepts_non_indexing_changes() -> None:
    payload = DatasetUpdatePayload.model_validate({"name": "Docs", "description": ""})

    assert payload.model_dump(exclude_unset=True) == {"name": "Docs", "description": ""}


@pytest.mark.parametrize("members", [[{}], [{"user_id": "not-a-uuid"}]])
def test_update_dataset_payload_rejects_malformed_members(members: list[object]) -> None:
    with pytest.raises(ValidationError, match="partial_member_list"):
        DatasetUpdatePayload.model_validate({"partial_member_list": members})


def test_update_dataset_payload_dumps_member_ids_as_strings() -> None:
    member_id = str(uuid.uuid4())
    payload = DatasetUpdatePayload.model_validate(
        {"permission": "partial_members", "partial_member_list": [{"user_id": member_id}]}
    )

    [member] = payload.model_dump(exclude_unset=True)["partial_member_list"]
    assert member["user_id"] == member_id
    assert isinstance(member["user_id"], str)


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


def test_dataset_post_passes_null_indexing_technique(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    dataset_service, _ = _bind_services(monkeypatch)

    api = DatasetsApi()
    result = _endpoint_handler(api.post)(
        api, _ctx(sqlite_session), workspace_id="ws-1", body=DatasetCreatePayload(name="Docs")
    )

    assert isinstance(result, tuple)
    response, status = result
    assert isinstance(response, DatasetResponse)
    assert status == HTTPStatus.CREATED
    assert response.name == "Docs"
    [values] = dataset_service.created_values
    # The legacy adapter takes `indexing_technique` even when null.
    assert "indexing_technique" in values
    assert values["indexing_technique"] is None


def test_document_settings_marks_create_as_non_duplicate(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    _bind_services(monkeypatch)

    settings, text_upload = datasets_module._document_settings(
        _ctx(sqlite_session),
        "ds-1",
        DocumentCreateByTextPayload(name="guide.md", text="hello"),
        original_document_id=None,
    )

    assert settings["duplicate"] is False
    assert "data_source" not in settings
    assert text_upload == DocumentTextUpload(text="hello", name="guide.md")


def test_document_settings_update_does_not_mark_duplicate(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    _bind_services(monkeypatch)

    settings, text_upload = datasets_module._document_settings(
        _ctx(sqlite_session),
        "ds-1",
        DocumentUpdateByTextPayload(name="renamed.md"),
        original_document_id="doc-1",
    )

    assert settings["original_document_id"] == "doc-1"
    assert "duplicate" not in settings
    assert text_upload is None


@pytest.mark.parametrize(
    ("body", "original_document_id"),
    [
        (DocumentCreateByTextPayload(name="guide.md", text="hello"), None),
        (DocumentUpdateByTextPayload(name="renamed.md", text="hello"), "doc-1"),
        (DocumentUpdateByTextPayload(name="renamed.md"), "doc-1"),
    ],
)
def test_external_dataset_rejects_documents_before_delegation(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    body: DocumentCreateByTextPayload | DocumentUpdateByTextPayload,
    original_document_id: str | None,
) -> None:
    _, document_service = _bind_services(monkeypatch, datasets=_FakeDatasets(_dataset(provider="external")))

    with pytest.raises(BadRequest, match="External datasets do not support local documents"):
        datasets_module._create_documents(_ctx(sqlite_session), "ds-1", body, original_document_id=original_document_id)

    assert document_service.calls == []


def test_create_documents_forwards_the_text_upload(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    _, document_service = _bind_services(monkeypatch)

    datasets_module._create_documents(
        _ctx(sqlite_session),
        "ds-1",
        DocumentCreateByTextPayload(name="guide.md", text="hello"),
        original_document_id=None,
    )

    [call] = document_service.calls
    assert call["text_upload"] == DocumentTextUpload(text="hello", name="guide.md")
    assert call["created_from"] == "api"


@pytest.mark.parametrize(
    "display_statuses",
    [
        ["available", "disabled"],
        ["available", "archived"],
        ["disabled", "archived"],
        ["available", "disabled", "archived"],
    ],
)
def test_batch_status_aggregates_completed_documents(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, display_statuses: list[str]
) -> None:
    document_service = _FakeDocuments()
    document_service.batch_rows = [
        _document(id=f"doc-{index}", display_status=status) for index, status in enumerate(display_statuses)
    ]
    _bind_services(monkeypatch, documents=document_service)

    api = DocumentBatchIndexingStatusApi()
    response = _endpoint_handler(api.get)(
        api, _ctx(sqlite_session), workspace_id="ws-1", dataset_id="ds-1", batch="batch-1"
    )

    assert isinstance(response, DocumentIndexingStatusResponse)
    assert response.display_status == DocumentDisplayStatus.AVAILABLE
    assert [item.display_status for item in response.documents] == display_statuses


@pytest.mark.parametrize(
    "create_only",
    [
        {"doc_language": "English"},
        {"indexing_technique": "economy"},
        {
            "retrieval_model": {
                "search_method": "semantic_search",
                "reranking_enable": False,
                "top_k": 3,
                "score_threshold_enabled": False,
            }
        },
        {"embedding_model": "text-embedding-3-small"},
        {"embedding_model_provider": "openai"},
    ],
)
def test_create_only_document_fields_are_forbidden_on_update(create_only: dict[str, object]) -> None:
    with pytest.raises(ValidationError, match="extra_forbidden"):
        DocumentUpdateByTextPayload.model_validate({"name": "guide.md", **create_only})
    DocumentCreateByTextPayload.model_validate({"name": "guide.md", "text": "hello", **create_only})


def test_update_document_response_carries_only_the_document(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    _bind_services(monkeypatch)

    api = DocumentUpdateByTextApi()
    response = _endpoint_handler(api.post)(
        api,
        _ctx(sqlite_session),
        workspace_id="ws-1",
        dataset_id="ds-1",
        document_id="doc-1",
        body=DocumentUpdateByTextPayload(name="guide.md", text="updated"),
    )

    assert isinstance(response, DocumentUpdateResponse)
    assert response.document.id == "doc-1"
    assert not hasattr(response, "batch")


@pytest.mark.parametrize("rbac_enabled", [False, True])
def test_dataset_detail_row_members_follow_rbac_mode(rbac_enabled: bool, config_overrides: Callable[..., None]) -> None:
    config_overrides(RBAC_ENABLED=rbac_enabled)
    row = _dataset_detail_row(_dataset(permission="partial_members", partial_member_list=["acct-1"]))
    assert isinstance(row, DatasetDetailResponse)
    assert row.partial_member_list == (None if rbac_enabled else ["acct-1"])


def test_create_dataset_rejects_partial_members_outside_rbac(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    dataset_service, _ = _bind_services(monkeypatch)

    api = DatasetsApi()
    with pytest.raises(BadRequest, match="partial_members is not supported"):
        _endpoint_handler(api.post)(
            api,
            _ctx(sqlite_session),
            workspace_id="ws-1",
            body=DatasetCreatePayload.model_validate({"name": "Docs", "permission": "partial_members"}),
        )
    assert dataset_service.created_values == []


@pytest.mark.parametrize("permission", ["only_me", "all_team_members", "partial_members", None])
def test_create_dataset_ignores_legacy_permission_under_rbac(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    config_overrides: Callable[..., None],
    permission: str | None,
) -> None:
    config_overrides(RBAC_ENABLED=True)
    dataset_service, _ = _bind_services(monkeypatch)
    payload = {"name": "Docs", **({"permission": permission} if permission else {})}

    api = DatasetsApi()
    result = _endpoint_handler(api.post)(
        api, _ctx(sqlite_session), workspace_id="ws-1", body=DatasetCreatePayload.model_validate(payload)
    )

    assert isinstance(result, tuple)
    [values] = dataset_service.created_values
    assert "permission" not in values


@pytest.mark.parametrize("body", [{"permission": "only_me"}, {"partial_member_list": [{"user_id": str(uuid.uuid4())}]}])
def test_update_dataset_strips_legacy_access_fields_under_rbac(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    config_overrides: Callable[..., None],
    body: dict[str, object],
) -> None:
    config_overrides(RBAC_ENABLED=True)
    dataset_service, _ = _bind_services(monkeypatch)

    api = DatasetApi()
    response = _endpoint_handler(api.patch)(
        api,
        _ctx(sqlite_session),
        workspace_id="ws-1",
        dataset_id="ds-1",
        body=DatasetUpdatePayload.model_validate(body),
    )

    assert isinstance(response, DatasetDetailResponse)
    [(_dataset_id, values)] = dataset_service.updated_values
    assert "permission" not in values
    assert "partial_member_list" not in values


@pytest.mark.parametrize(
    "body",
    [
        {"permission": "partial_members"},
        {"partial_member_list": [{"user_id": str(uuid.uuid4())}]},
    ],
)
def test_update_dataset_requires_paired_member_fields_outside_rbac(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, body: dict[str, object]
) -> None:
    dataset_service, _ = _bind_services(monkeypatch)

    api = DatasetApi()
    with pytest.raises(BadRequest, match="partial_member_list must be supplied"):
        _endpoint_handler(api.patch)(
            api,
            _ctx(sqlite_session),
            workspace_id="ws-1",
            dataset_id="ds-1",
            body=DatasetUpdatePayload.model_validate(body),
        )
    assert dataset_service.updated_values == []


def test_update_dataset_accepts_paired_member_fields_outside_rbac(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    dataset_service, _ = _bind_services(monkeypatch)
    member = {"user_id": str(uuid.uuid4())}

    api = DatasetApi()
    _endpoint_handler(api.patch)(
        api,
        _ctx(sqlite_session),
        workspace_id="ws-1",
        dataset_id="ds-1",
        body=DatasetUpdatePayload.model_validate({"permission": "partial_members", "partial_member_list": [member]}),
    )

    [(_dataset_id, values)] = dataset_service.updated_values
    assert values["permission"] == "partial_members"
    assert values["partial_member_list"] == [member]


@pytest.mark.parametrize("field", ["name", "external_knowledge_id", "external_knowledge_api_id"])
def test_update_dataset_payload_rejects_explicit_null(field: str) -> None:
    with pytest.raises(ValidationError, match="null is not allowed"):
        DatasetUpdatePayload.model_validate({field: None})


def test_update_dataset_payload_accepts_null_description() -> None:
    payload = DatasetUpdatePayload.model_validate({"description": None})
    assert payload.model_dump(exclude_unset=True) == {"description": None}
