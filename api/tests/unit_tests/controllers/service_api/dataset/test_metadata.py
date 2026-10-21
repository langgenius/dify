"""Service API metadata controllers only adapt HTTP data to application use cases."""

from dataclasses import dataclass
from unittest.mock import Mock, create_autospec
from uuid import uuid4

import pytest
from flask import Flask

from controllers.common.errors import ForbiddenError, InvalidArgumentError, NotFoundError
from controllers.service_api.dataset import metadata as metadata_module
from controllers.service_api.dataset.metadata import (
    DatasetMetadataBuiltInFieldActionServiceApi,
    DatasetMetadataBuiltInFieldServiceApi,
    DatasetMetadataCreateServiceApi,
    DatasetMetadataServiceApi,
    DocumentMetadataEditServiceApi,
)
from machinery.context import RequestContext
from services.errors.metadata import MetadataResourceNotFoundError
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.entities.knowledge_entities import MetadataArgs, MetadataOperationData
from services.knowledge.metadata.application import MetadataInvalidActionError, MetadataService

CONTEXT = RequestContext(
    request_id="request-1",
    trace_id="trace-1",
    account_id="account-1",
    active_workspace_id="workspace-1",
)


@dataclass(frozen=True)
class _KnowledgeServices:
    metadata: Mock


@dataclass(frozen=True)
class _ApplicationServices:
    knowledge: _KnowledgeServices


@pytest.fixture
def metadata_service(monkeypatch: pytest.MonkeyPatch) -> Mock:
    service = create_autospec(MetadataService, instance=True, spec_set=True)
    services = _ApplicationServices(knowledge=_KnowledgeServices(metadata=service))
    monkeypatch.setattr(metadata_module, "application_services", lambda: services)
    return service


def test_create_metadata_parses_payload_and_serializes_response(app: Flask, metadata_service: Mock) -> None:
    dataset_id = uuid4()
    metadata_service.create_dataset_metadata.return_value = {
        "id": "metadata-1",
        "name": "author",
        "type": "string",
    }

    with app.test_request_context(json={"name": "author", "type": "string"}, method="POST"):
        body, status = DatasetMetadataCreateServiceApi().post(CONTEXT, dataset_id)

    assert status == 201
    assert body == {"id": "metadata-1", "name": "author", "type": "string"}
    metadata_service.create_dataset_metadata.assert_called_once()
    context, called_dataset_id, payload = metadata_service.create_dataset_metadata.call_args.args
    assert context == CONTEXT
    assert called_dataset_id == str(dataset_id)
    assert payload == MetadataArgs(name="author", type="string")


def test_list_metadata_serializes_application_result(metadata_service: Mock) -> None:
    dataset_id = uuid4()
    metadata_service.list_dataset_metadata.return_value = {
        "doc_metadata": [{"id": "metadata-1", "name": "author", "type": "string", "count": 2}],
        "built_in_field_enabled": False,
    }

    body, status = DatasetMetadataCreateServiceApi().get(CONTEXT, dataset_id)

    assert status == 200
    assert body["doc_metadata"] == [{"id": "metadata-1", "name": "author", "type": "string", "count": 2}]
    metadata_service.list_dataset_metadata.assert_called_once_with(CONTEXT, str(dataset_id))


def test_rename_metadata_parses_payload(metadata_service: Mock, app: Flask) -> None:
    dataset_id, metadata_id = uuid4(), uuid4()
    metadata_service.rename_dataset_metadata.return_value = {
        "id": str(metadata_id),
        "name": "writer",
        "type": "string",
    }

    with app.test_request_context(json={"name": "writer"}, method="PATCH"):
        body, status = DatasetMetadataServiceApi().patch(CONTEXT, dataset_id, metadata_id)

    assert status == 200
    assert body["name"] == "writer"
    metadata_service.rename_dataset_metadata.assert_called_once_with(
        CONTEXT,
        str(dataset_id),
        str(metadata_id),
        name="writer",
    )


def test_delete_metadata_returns_no_content(metadata_service: Mock) -> None:
    dataset_id, metadata_id = uuid4(), uuid4()

    body, status = DatasetMetadataServiceApi().delete(CONTEXT, dataset_id, metadata_id)

    assert (body, status) == ("", 204)
    metadata_service.delete_dataset_metadata.assert_called_once_with(CONTEXT, str(dataset_id), str(metadata_id))


@pytest.mark.parametrize("error", [DatasetNotFoundError(), MetadataResourceNotFoundError("Metadata not found.")])
def test_missing_resource_is_translated_at_controller_boundary(metadata_service: Mock, error: Exception) -> None:
    metadata_service.delete_dataset_metadata.side_effect = error

    with pytest.raises(NotFoundError, match=str(error)):
        DatasetMetadataServiceApi().delete(CONTEXT, uuid4(), uuid4())


def test_access_denial_is_translated_at_controller_boundary(metadata_service: Mock) -> None:
    error = DatasetAccessDeniedError()
    metadata_service.list_dataset_metadata.side_effect = error

    with pytest.raises(ForbiddenError, match=str(error)):
        DatasetMetadataCreateServiceApi().get(CONTEXT, uuid4())


def test_built_in_fields_use_dataset_scoped_application_query(metadata_service: Mock) -> None:
    dataset_id = uuid4()
    metadata_service.list_dataset_built_in_fields.return_value = [{"name": "uploader", "type": "string"}]

    body, status = DatasetMetadataBuiltInFieldServiceApi().get(CONTEXT, dataset_id)

    assert status == 200
    assert body == {"fields": [{"name": "uploader", "type": "string"}]}
    metadata_service.list_dataset_built_in_fields.assert_called_once_with(CONTEXT, str(dataset_id))


@pytest.mark.parametrize("action", ["enable", "disable"])
def test_built_in_field_action_delegates_path_action(metadata_service: Mock, action: str) -> None:
    dataset_id = uuid4()

    body, status = DatasetMetadataBuiltInFieldActionServiceApi().post(CONTEXT, dataset_id, action)

    assert (body, status) == ({"result": "success"}, 200)
    metadata_service.apply_dataset_built_in_field_action.assert_called_once_with(
        CONTEXT, str(dataset_id), action=action
    )


def test_built_in_field_action_maps_unknown_action_to_bad_request(metadata_service: Mock) -> None:
    dataset_id = uuid4()
    metadata_service.apply_dataset_built_in_field_action.side_effect = MetadataInvalidActionError(
        "Unsupported metadata action: unknown"
    )

    with pytest.raises(InvalidArgumentError, match="Unsupported metadata action: unknown"):
        DatasetMetadataBuiltInFieldActionServiceApi().post(CONTEXT, dataset_id, "unknown")

    metadata_service.apply_dataset_built_in_field_action.assert_called_once_with(
        CONTEXT, str(dataset_id), action="unknown"
    )


def test_batch_document_metadata_parses_payload(metadata_service: Mock, app: Flask) -> None:
    dataset_id = uuid4()
    document_id, metadata_id = uuid4(), uuid4()
    raw_payload = {
        "operation_data": [
            {
                "document_id": str(document_id),
                "metadata_list": [{"id": str(metadata_id), "name": "author", "value": "Ada"}],
                "partial_update": True,
            }
        ]
    }

    with app.test_request_context(json=raw_payload, method="POST"):
        body, status = DocumentMetadataEditServiceApi().post(CONTEXT, dataset_id)

    assert (body, status) == ({"result": "success"}, 200)
    context, called_dataset_id, payload = metadata_service.update_dataset_documents_metadata.call_args.args
    assert context == CONTEXT
    assert called_dataset_id == str(dataset_id)
    assert payload == MetadataOperationData.model_validate(raw_payload)


def test_metadata_controller_has_no_persistence_or_identity_dependencies() -> None:
    forbidden_names = {"DatasetService", "Session", "current_user", "db", "with_session"}
    assert forbidden_names.isdisjoint(vars(metadata_module))


@pytest.mark.parametrize(
    ("method", "rate_limited"),
    [
        (DatasetMetadataCreateServiceApi.post, True),
        (DatasetMetadataCreateServiceApi.get, False),
        (DatasetMetadataServiceApi.patch, True),
        (DatasetMetadataServiceApi.delete, True),
        (DatasetMetadataBuiltInFieldServiceApi.get, False),
        (DatasetMetadataBuiltInFieldActionServiceApi.post, True),
        (DocumentMetadataEditServiceApi.post, True),
    ],
)
def test_metadata_routes_preserve_rate_limit_policy(method: object, rate_limited: bool) -> None:
    policy = vars(method)["__dataset_admission_policy__"]
    assert policy.rate_limit is rate_limited
