import json
from collections.abc import Iterator
from unittest.mock import create_autospec, patch

import httpx
import pytest
from sqlalchemy import Engine, event, func, select
from sqlalchemy.orm import Session, sessionmaker

from constants import HIDDEN_VALUE
from controllers.console.datasets.external import ExternalKnowledgeApiListResponse
from machinery.context import RequestContext
from models.dataset import Dataset, DatasetQuery, ExternalKnowledgeApis, ExternalKnowledgeBindings
from repositories.app.console_repository import ConsoleAppRepository
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.external_repository import SQLAlchemyExternalKnowledgeRepository
from services.errors.dataset import DatasetNameDuplicateError
from services.errors.knowledge_retrieval import (
    ExternalKnowledgeRetrievalError,
    ExternalTemplateConcurrentUpdateError,
    ExternalTemplateNotFoundError,
)
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccess
from services.knowledge.datasets.adapters import SQLAlchemyDatasetOperations
from services.knowledge.entities.external import (
    ExternalDatasetCreatePayload,
    ExternalKnowledgeRetrievalRequest,
    ExternalRetrievalConfig,
)
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.external.adapters import ExternalKnowledgeGateway, sync_external_dataset_creator_access
from services.knowledge.external.application import (
    ExternalHitTestingError,
    ExternalKnowledgeApplicationService,
)
from services.tag_application_service import TagApplicationService
from tests.helpers.unit.rbac_fakes import RBACDomain

CONTEXT = RequestContext("request", None, "actor", "tenant")
REF = DatasetRef("tenant", "dataset")


@pytest.fixture
def application(
    sqlite_session_factory: sessionmaker[Session],
    rbac_domain: RBACDomain,
    application_tags: TagApplicationService,
) -> ExternalKnowledgeApplicationService:
    with sqlite_session_factory.begin() as session:
        for workspace, template_id, dataset_id in [
            ("tenant", "template", "dataset"),
            ("other", "foreign", "foreign-dataset"),
        ]:
            template = ExternalKnowledgeApis(
                tenant_id=workspace,
                created_by="actor",
                updated_by="actor",
                name="API",
                description="",
                settings=json.dumps({"endpoint": "https://example", "api_key": "secret"}),
            )
            template.id = template_id
            session.add_all(
                [
                    template,
                    Dataset(
                        id=dataset_id,
                        tenant_id=workspace,
                        created_by="actor",
                        name="Dataset",
                        provider="external",
                    ),
                    ExternalKnowledgeBindings(
                        tenant_id=workspace,
                        dataset_id=dataset_id,
                        external_knowledge_api_id=template_id,
                        external_knowledge_id="knowledge",
                        created_by="actor",
                    ),
                ]
            )
    access = create_autospec(DatasetAccess, instance=True, spec_set=True)
    access.require_accessible.side_effect = lambda context, dataset_id: AccessibleDataset(
        dataset_id, context.active_workspace_id
    )
    datasets = SQLAlchemyDatasetRepository(
        session_factory=sqlite_session_factory,
        revoke_keys_after_commit=lambda _session, _key_ids: None,
    )
    dataset_details = SQLAlchemyDatasetOperations(
        session_factory=sqlite_session_factory,
        tags=application_tags,
        app_queries=ConsoleAppRepository(session_factory=sqlite_session_factory),
        members=rbac_domain.rbac.members,
        datasets=datasets,
    )
    return ExternalKnowledgeApplicationService(
        dataset_access=access,
        repository=SQLAlchemyExternalKnowledgeRepository(session_factory=sqlite_session_factory),
        retrieval=ExternalKnowledgeGateway(),
        queries=datasets,
        dataset_details=dataset_details,
        sync_creator_access=sync_external_dataset_creator_access,
        api_key_mask=HIDDEN_VALUE,
    )


@pytest.fixture
def checked_out(sqlite_engine: Engine) -> Iterator[set[object]]:
    active: set[object] = set()

    def checkout(_connection: object, record: object, _proxy: object) -> None:
        active.add(record)

    def checkin(_connection: object, record: object) -> None:
        active.discard(record)

    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)
    try:
        yield active
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)


def test_template_list_materializes_bindings_and_settings(
    application: ExternalKnowledgeApplicationService,
) -> None:
    result = ExternalKnowledgeApiListResponse.model_validate(
        application.list_templates(CONTEXT, page=0, limit=0, keyword=None)
    ).model_dump(mode="json")
    assert result["total"] == 1
    assert result["limit"] == 1
    assert result["has_more"] is False
    assert result["data"][0]["settings"] == {"endpoint": "https://example", "api_key": HIDDEN_VALUE}
    assert result["data"][0]["dataset_bindings"] == [{"id": "dataset", "name": "Dataset"}]


@pytest.mark.parametrize("method", ["get_template", "update_template", "delete_template"])
def test_template_read_write_scope(application: ExternalKnowledgeApplicationService, method: str) -> None:
    if method == "update_template":
        with (
            patch.object(ExternalKnowledgeGateway, "check_settings"),
            pytest.raises(ExternalTemplateNotFoundError),
        ):
            application.update_template(
                CONTEXT,
                template_id="foreign",
                name="changed",
                settings={"api_key": "key", "endpoint": "https://example"},
            )
    else:
        operation = application.get_template if method == "get_template" else application.delete_template
        with pytest.raises(ExternalTemplateNotFoundError):
            operation(CONTEXT, template_id="foreign")
    assert application.template_usage(CONTEXT, template_id="foreign") == (False, 0)


def test_masked_update_preserves_secret(
    application: ExternalKnowledgeApplicationService, sqlite_session_factory: sessionmaker[Session]
) -> None:
    settings = {"endpoint": "https://changed", "api_key": HIDDEN_VALUE}
    with patch.object(ExternalKnowledgeGateway, "check_settings") as check_settings:
        application.update_template(CONTEXT, template_id="template", name="Renamed", settings=settings)
    check_settings.assert_called_once_with({"endpoint": "https://changed", "api_key": "secret"})
    with sqlite_session_factory() as session:
        template = session.get(ExternalKnowledgeApis, "template")
        assert template is not None
        assert template.name == "Renamed"
        persisted_settings = template.settings_dict
        assert persisted_settings is not None
        assert persisted_settings["api_key"] == "secret"


def test_masked_update_preserves_secret_without_mutating_request(
    application: ExternalKnowledgeApplicationService,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    settings = {"endpoint": "https://changed", "api_key": HIDDEN_VALUE}
    with patch.object(ExternalKnowledgeGateway, "check_settings"):
        application.update_template(CONTEXT, template_id="template", name="Renamed", settings=settings)
    assert settings["api_key"] == HIDDEN_VALUE
    with sqlite_session_factory() as session:
        template = session.get(ExternalKnowledgeApis, "template")
        assert template is not None
        assert template.name == "Renamed"
        persisted_settings = template.settings_dict
        assert persisted_settings is not None
        assert persisted_settings["api_key"] == "secret"


def test_missing_template_is_rejected_before_provider_probe(application: ExternalKnowledgeApplicationService) -> None:
    with (
        patch.object(ExternalKnowledgeGateway, "check_settings") as check_settings,
        pytest.raises(ExternalTemplateNotFoundError),
    ):
        application.update_template(
            CONTEXT,
            template_id="missing",
            name="Renamed",
            settings={"endpoint": "https://changed", "api_key": HIDDEN_VALUE},
        )
    check_settings.assert_not_called()


def test_masked_update_rejects_secret_rotation_between_probe_and_publication(
    application: ExternalKnowledgeApplicationService,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    def rotate_secret_after_probe(_settings: dict[str, object]) -> None:
        with sqlite_session_factory.begin() as session:
            template = session.get(ExternalKnowledgeApis, "template")
            assert template is not None
            template.settings = json.dumps({"endpoint": "https://example", "api_key": "rotated-secret"})

    with (
        patch.object(ExternalKnowledgeGateway, "check_settings", side_effect=rotate_secret_after_probe),
        pytest.raises(ExternalTemplateConcurrentUpdateError),
    ):
        application.update_template(
            CONTEXT,
            template_id="template",
            name="Renamed",
            settings={"endpoint": "https://changed", "api_key": HIDDEN_VALUE},
        )

    with sqlite_session_factory() as session:
        template = session.get(ExternalKnowledgeApis, "template")
        assert template is not None
        assert template.name == "API"
        assert template.settings_dict == {"endpoint": "https://example", "api_key": "rotated-secret"}


def test_creation_probes_outside_transaction_then_commits(
    application: ExternalKnowledgeApplicationService,
    checked_out: set[object],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    def probe(_settings: dict[str, object]) -> None:
        assert not checked_out

    with patch.object(ExternalKnowledgeGateway, "check_settings", side_effect=probe):
        result = application.create_template(
            CONTEXT,
            name="New",
            settings={"endpoint": "https://example", "api_key": "secret"},
        )
    with sqlite_session_factory() as session:
        assert session.get(ExternalKnowledgeApis, result["id"]) is not None


def test_external_dataset_cannot_bind_foreign_template(
    application: ExternalKnowledgeApplicationService,
) -> None:
    with pytest.raises(ExternalTemplateNotFoundError):
        application.create_dataset(
            CONTEXT,
            payload=ExternalDatasetCreatePayload(
                name="New",
                external_knowledge_api_id="foreign",
                external_knowledge_id="knowledge",
            ),
        )


def test_external_dataset_duplicate_name_uses_application_error(
    application: ExternalKnowledgeApplicationService,
) -> None:
    with pytest.raises(DatasetNameDuplicateError):
        application.create_dataset(
            CONTEXT,
            payload=ExternalDatasetCreatePayload(
                name="Dataset",
                external_knowledge_api_id="template",
                external_knowledge_id="knowledge",
            ),
        )


def test_dataset_creation_commits_binding_before_creator_sync(
    application: ExternalKnowledgeApplicationService,
    sqlite_session_factory: sessionmaker[Session],
    checked_out: set[object],
) -> None:
    synced: list[str] = []

    def sync(workspace_id: str, actor_id: str, _resource_type: object, dataset_id: str) -> None:
        assert not checked_out
        assert workspace_id == "tenant"
        assert actor_id == "actor"
        with sqlite_session_factory() as session:
            assert session.get(Dataset, dataset_id) is not None
            binding = session.scalar(
                select(ExternalKnowledgeBindings).where(
                    ExternalKnowledgeBindings.dataset_id == dataset_id,
                    ExternalKnowledgeBindings.tenant_id == workspace_id,
                )
            )
            assert binding is not None
            assert binding.external_knowledge_api_id == "template"
        synced.append(dataset_id)

    with patch(
        "services.knowledge.external.adapters.rbac_service.try_sync_creator_access_policy_member_bindings",
        side_effect=sync,
    ):
        result = application.create_dataset(
            CONTEXT,
            payload=ExternalDatasetCreatePayload(
                name="New",
                external_knowledge_api_id="template",
                external_knowledge_id="knowledge",
            ),
        )
    assert result["id"] == synced[0]
    assert result["name"] == "New"
    assert result["provider"] == "external"


@pytest.mark.parametrize(
    "query",
    [
        '查找 "hello"',
        r"查找 C:\docs\hello",
        r'查找 "hello" C:\docs\hello',
        r"查找 \"hello\" C:\docs\\hello",
    ],
)
def test_retrieval_releases_read_session_before_http_and_preserves_query(
    application: ExternalKnowledgeApplicationService,
    checked_out: set[object],
    sqlite_session_factory: sessionmaker[Session],
    query: str,
) -> None:
    def send(_url: str, **_kwargs: object) -> httpx.Response:
        assert not checked_out
        return httpx.Response(
            200,
            json={"records": [{"content": "answer", "title": "title", "score": 0.9, "metadata": {"source": "doc"}}]},
        )

    with patch("services.knowledge.external.adapters.ssrf_proxy.post", autospec=True, side_effect=send) as request:
        result = application.hit_testing(
            CONTEXT, dataset_id=REF.dataset_id, query=query, retrieval_model={"top_k": 3}, metadata_filters=None
        )
    request.assert_called_once()
    assert result["query"] == {"content": query}
    assert result["records"][0]["content"] == "answer"
    payload = json.loads(request.call_args.kwargs["data"])
    assert payload["query"] == query
    assert payload["knowledge_id"] == "knowledge"
    assert payload["retrieval_setting"] == {"top_k": 3, "score_threshold": 0.0}
    with sqlite_session_factory() as session:
        saved = session.scalar(select(DatasetQuery))
        assert saved is not None
        assert saved.created_by == "actor"
        assert saved.content == query
        assert saved.dataset_id == "dataset"


@pytest.mark.parametrize("retrieval_model", [None, {}])
def test_hit_testing_uses_default_external_retrieval_settings(
    application: ExternalKnowledgeApplicationService, retrieval_model: dict[str, object] | None
) -> None:
    with patch(
        "services.knowledge.external.adapters.ssrf_proxy.post",
        autospec=True,
        return_value=httpx.Response(200, json={"records": []}),
    ) as request:
        application.hit_testing(
            CONTEXT,
            dataset_id=REF.dataset_id,
            query="question",
            retrieval_model=retrieval_model,
            metadata_filters=None,
        )

    request.assert_called_once()
    payload = json.loads(request.call_args.kwargs["data"])
    assert payload["retrieval_setting"] == {"top_k": 2, "score_threshold": 0.0}


@pytest.mark.parametrize(
    ("status_code", "message"),
    [(401, "Unauthorized"), (403, "Forbidden")],
)
def test_gateway_rejects_authorization_failures(status_code: int, message: str) -> None:
    with patch(
        "services.knowledge.external.adapters.ssrf_proxy.post",
        autospec=True,
        return_value=httpx.Response(status_code),
    ):
        with pytest.raises(ValueError, match=message):
            ExternalKnowledgeGateway.check_endpoint_and_api_key(
                {"endpoint": "https://provider.example", "api_key": "invalid"}
            )


@pytest.mark.parametrize("status_code", [400, 405, 429])
def test_gateway_allows_non_authorization_client_responses(status_code: int) -> None:
    with patch(
        "services.knowledge.external.adapters.ssrf_proxy.post",
        autospec=True,
        return_value=httpx.Response(status_code),
    ):
        ExternalKnowledgeGateway.check_endpoint_and_api_key(
            {"endpoint": "https://provider.example", "api_key": "secret"}
        )


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ([{"content": "answer", "score": 0.9}], "response"),
        ({}, "records must be a list"),
        ({"records": "invalid"}, "records must be a list"),
        ({"records": [1]}, r"records\[0\] must be an object"),
        ({"records": [{"content": None}]}, r"records\[0\]\.content must be a string"),
        ({"records": [{"content": 1}]}, r"records\[0\]\.content must be a string"),
        ({"records": [{"score": None}]}, r"records\[0\]\.score must be a number"),
        (
            {"records": [{"content": "answer", "score": "high"}]},
            r"records\[0\]\.score must be a number",
        ),
        (
            {"records": [{"content": "answer", "score": True}]},
            r"records\[0\]\.score must be a number",
        ),
        (
            {"records": [{"content": "answer", "score": 0.9, "title": 1}]},
            r"records\[0\]\.title must be a string",
        ),
        (
            {"records": [{"content": "answer", "score": 0.9, "metadata": None}]},
            r"records\[0\]\.metadata must contain JSON values",
        ),
        (
            {"records": [{"content": "answer", "score": 0.9, "metadata": []}]},
            r"records\[0\]\.metadata must contain JSON values",
        ),
    ],
)
def test_gateway_rejects_malformed_provider_records(payload: object, message: str) -> None:
    request = ExternalKnowledgeRetrievalRequest(
        endpoint="https://provider.example",
        api_key="secret",
        knowledge_id="knowledge",
        query="question",
        retrieval_model=ExternalRetrievalConfig(top_k=2),
        metadata_filters=None,
    )
    with patch(
        "services.knowledge.external.adapters.ssrf_proxy.post",
        autospec=True,
        return_value=httpx.Response(200, json=payload),
    ):
        with pytest.raises(ExternalKnowledgeRetrievalError, match=message):
            ExternalKnowledgeGateway().retrieve(request)


def test_gateway_accepts_missing_provider_fields_with_runtime_safe_defaults() -> None:
    request = ExternalKnowledgeRetrievalRequest(
        endpoint="https://provider.example",
        api_key=None,
        knowledge_id="knowledge",
        query="question",
        retrieval_model=ExternalRetrievalConfig(top_k=2),
        metadata_filters=None,
    )
    with patch(
        "services.knowledge.external.adapters.ssrf_proxy.post",
        autospec=True,
        return_value=httpx.Response(
            200,
            json={
                "records": [
                    {},
                    {"content": "answer"},
                    {"score": 0.75},
                    {"title": "Document"},
                    {"title": None},
                    {"metadata": {"source": "legacy"}},
                ]
            },
        ),
    ):
        records = ExternalKnowledgeGateway().retrieve(request)
        assert [(record.content, record.score, record.title, dict(record.metadata)) for record in records] == [
            ("", 0.0, None, {}),
            ("answer", 0.0, None, {}),
            ("", 0.75, None, {}),
            ("", 0.0, "Document", {}),
            ("", 0.0, None, {}),
            ("", 0.0, None, {"source": "legacy"}),
        ]


def test_hit_testing_formats_missing_provider_fields(application: ExternalKnowledgeApplicationService) -> None:
    with patch(
        "services.knowledge.external.adapters.ssrf_proxy.post",
        autospec=True,
        return_value=httpx.Response(200, json={"records": [{}]}),
    ):
        result = application.hit_testing(
            CONTEXT,
            dataset_id=REF.dataset_id,
            query="question",
            retrieval_model=None,
            metadata_filters=None,
        )

    assert result["records"] == [{"content": "", "title": None, "score": 0.0, "metadata": {}}]


def test_retrieval_failure_does_not_record_query(
    application: ExternalKnowledgeApplicationService,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with patch(
        "services.knowledge.external.adapters.ssrf_proxy.post",
        autospec=True,
        return_value=httpx.Response(502, text="unavailable"),
    ):
        with pytest.raises(ExternalHitTestingError):
            application.hit_testing(
                CONTEXT,
                dataset_id=REF.dataset_id,
                query="query",
                retrieval_model=None,
                metadata_filters=None,
            )
    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(DatasetQuery)) == 0


def test_retrieval_rejects_foreign_dataset_before_network(
    application: ExternalKnowledgeApplicationService,
) -> None:
    with patch("services.knowledge.external.adapters.ssrf_proxy.post", autospec=True) as request:
        with pytest.raises(ExternalHitTestingError):
            application.hit_testing(
                CONTEXT,
                dataset_id="foreign-dataset",
                query="query",
                retrieval_model=None,
                metadata_filters=None,
            )
        request.assert_not_called()


def test_malformed_provider_response_is_reported_as_hit_testing_error(
    application: ExternalKnowledgeApplicationService, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with patch(
        "services.knowledge.external.adapters.ssrf_proxy.post",
        autospec=True,
        return_value=httpx.Response(200, json={"records": [1]}),
    ):
        with pytest.raises(ExternalHitTestingError, match=r"records\[0\] must be an object"):
            application.hit_testing(
                CONTEXT, dataset_id=REF.dataset_id, query="query", retrieval_model=None, metadata_filters=None
            )
    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(DatasetQuery)) == 0


def test_retrieval_releases_read_session_before_http_and_commits_query(
    application: ExternalKnowledgeApplicationService,
    checked_out: set[object],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    outbound_body: dict[str, object] = {}

    def send(_url: str, *, data: str, **_kwargs: object) -> httpx.Response:
        assert not checked_out
        outbound_body.update(json.loads(data))
        return httpx.Response(
            200,
            json={
                "records": [
                    {
                        "content": "answer",
                        "title": "title",
                        "score": 0.9,
                        "metadata": {"source": "doc"},
                    }
                ]
            },
        )

    with patch("services.knowledge.external.adapters.ssrf_proxy.post", side_effect=send):
        result = application.hit_testing(
            CONTEXT,
            dataset_id=REF.dataset_id,
            query='say "hello"',
            retrieval_model={"top_k": 3},
            metadata_filters=None,
        )
    assert result["query"] == {"content": 'say "hello"'}
    assert result["records"][0]["content"] == "answer"
    assert outbound_body["query"] == 'say "hello"'
    assert outbound_body["knowledge_id"] == "knowledge"
    assert outbound_body["retrieval_setting"] == {"top_k": 3, "score_threshold": 0.0}
    with sqlite_session_factory() as session:
        saved = session.scalar(select(DatasetQuery))
        assert saved is not None
        assert saved.created_by == "actor"
        assert saved.content == 'say "hello"'
        assert saved.dataset_id == "dataset"
