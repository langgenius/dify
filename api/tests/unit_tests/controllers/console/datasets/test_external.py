from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import create_autospec
from uuid import UUID

import pytest
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

from controllers.console.datasets import external as controller
from controllers.console.datasets.error import DatasetNameDuplicateError
from machinery.context import RequestContext
from services.errors.dataset import DatasetNameDuplicateError as DuplicateName
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.external.application import (
    ExternalHitTestingError,
    ExternalKnowledgeApplicationService,
    ExternalTemplateNotFoundError,
)

CONTEXT = RequestContext("request-1", None, "actor-1", "tenant-1")
ID = UUID(int=1)


@pytest.fixture
def external(monkeypatch):
    service = create_autospec(ExternalKnowledgeApplicationService, instance=True, spec_set=True)
    monkeypatch.setattr(
        controller, "application_services", lambda: SimpleNamespace(knowledge=SimpleNamespace(external=service))
    )
    return service


def test_templates_preserve_pagination(external):
    page = {"data": [], "total": 0, "has_more": False, "page": 1, "limit": 100}
    external.list_templates.return_value = page
    result = unwrap(controller.ExternalApiTemplateListApi.get)(
        controller.ExternalApiTemplateListApi(),
        controller.ExternalApiTemplateListQuery(page=0, limit=1000, keyword="test"),
        CONTEXT,
    )
    assert result == (page, 200)
    external.list_templates.assert_called_once_with(CONTEXT, page=0, limit=1000, keyword="test")


@pytest.mark.parametrize(
    ("resource", "verb", "operation", "payload"),
    [
        (controller.ExternalApiTemplateListApi, "post", "create_template", True),
        (controller.ExternalApiTemplateApi, "get", "get_template", False),
        (controller.ExternalApiTemplateApi, "patch", "update_template", True),
        (controller.ExternalApiTemplateApi, "delete", "delete_template", False),
    ],
)
def test_template_missing_is_mapped_and_context_forwarded(external, resource, verb, operation, payload):
    method = getattr(external, operation)
    method.side_effect = ExternalTemplateNotFoundError("API template not found.")
    args = (
        [
            controller.ExternalKnowledgeApiPayload(
                name="API", settings={"endpoint": "https://example", "api_key": "secret"}
            )
        ]
        if payload
        else []
    )
    args.append(CONTEXT)
    if resource is controller.ExternalApiTemplateApi:
        args.append(ID)
    with pytest.raises(NotFound):
        unwrap(getattr(resource, verb))(resource(), *args)
    assert method.call_args.args == (CONTEXT,)
    if resource is controller.ExternalApiTemplateApi:
        assert method.call_args.kwargs["template_id"] == str(ID)


def test_template_serializes_settings_and_timestamp(external):
    external.get_template.return_value = {
        "id": str(ID),
        "name": "API",
        "tenant_id": "tenant-1",
        "settings": {"endpoint": "https://example", "api_key": "[__HIDDEN__]"},
        "description": "",
        "created_by": "actor-1",
        "created_at": "2024-01-01T00:00:00",
        "dataset_bindings": [],
    }
    result, status = unwrap(controller.ExternalApiTemplateApi.get)(controller.ExternalApiTemplateApi(), CONTEXT, ID)
    assert status == 200
    assert result == external.get_template.return_value


def test_delete_and_usage_response_contracts(external):
    assert unwrap(controller.ExternalApiTemplateApi.delete)(controller.ExternalApiTemplateApi(), CONTEXT, ID) == (
        "",
        204,
    )
    external.template_usage.return_value = (True, 3)
    assert unwrap(controller.ExternalApiUseCheckApi.get)(controller.ExternalApiUseCheckApi(), CONTEXT, ID) == (
        {"is_using": True, "count": 3},
        200,
    )


def test_external_dataset_duplicate_name_maps_to_409(external):
    payload = controller.ExternalDatasetCreatePayload(
        name="Dataset", external_knowledge_api_id="api", external_knowledge_id="knowledge"
    )
    external.create_dataset.side_effect = DuplicateName()
    with pytest.raises(DatasetNameDuplicateError):
        unwrap(controller.ExternalDatasetCreateApi.post)(controller.ExternalDatasetCreateApi(), payload, CONTEXT)
    external.create_dataset.assert_called_once_with(CONTEXT, payload=payload)


@pytest.mark.parametrize(
    ("error", "http_error"),
    [
        (DatasetNotFoundError(), NotFound),
        (DatasetAccessDeniedError(), Forbidden),
        (ExternalHitTestingError("failed"), InternalServerError),
    ],
)
def test_retrieval_maps_application_errors(external, error, http_error):
    external.hit_testing.side_effect = error
    with pytest.raises(http_error):
        unwrap(controller.ExternalKnowledgeHitTestingApi.post)(
            controller.ExternalKnowledgeHitTestingApi(),
            controller.ExternalHitTestingPayload(query="query"),
            CONTEXT,
            ID,
        )
    external.hit_testing.assert_called_once_with(
        CONTEXT, dataset_id=str(ID), query="query", retrieval_model=None, metadata_filters=None
    )


def test_retrieval_response_is_serialized(external):
    external.hit_testing.return_value = {
        "query": {"content": "query"},
        "records": [{"content": "answer", "title": "title", "score": 0.8, "metadata": {"source": "doc"}}],
    }
    result = unwrap(controller.ExternalKnowledgeHitTestingApi.post)(
        controller.ExternalKnowledgeHitTestingApi(), controller.ExternalHitTestingPayload(query="query"), CONTEXT, ID
    )
    assert result == external.hit_testing.return_value
