"""Service policy tests use the Store contract without ORM/session fixtures."""

from unittest.mock import Mock

import pytest

from constants.resource_access_token import ResourceAccessTokenResourceType as ResourceType
from machinery.context import RequestContext
from services.auth.resource_access_token_contracts import (
    BoundResource,
    ResourceAccessTokenAccess,
    ResourceAccessTokenForbiddenError,
    ResourceAccessTokenInputError,
    ResourceAccessTokenResource,
)
from services.resource_access_token_service import ResourceAccessTokenService, ResourceAccessTokenStore

CONTEXT = RequestContext("request", None, "owner", "workspace")
APP = ResourceAccessTokenResource(ResourceType.APP, "app")


@pytest.fixture
def store() -> Mock:
    return Mock(spec=ResourceAccessTokenStore)


@pytest.fixture
def service(store: Mock) -> ResourceAccessTokenService:
    return ResourceAccessTokenService(tokens=store)


def test_create_normalizes_and_deduplicates_with_explicit_owner(
    service: ResourceAccessTokenService, store: Mock
) -> None:
    result = service.create(CONTEXT, name="  CLI  ", resources=(APP, APP))
    store.create.assert_called_once_with("workspace", "owner", "CLI", (APP,))
    assert result is store.create.return_value


@pytest.mark.parametrize(("name", "resources"), [("  ", (APP,)), ("CLI", ())])
def test_invalid_input_never_writes(
    service: ResourceAccessTokenService, store: Mock, name: str, resources: tuple[ResourceAccessTokenResource, ...]
) -> None:
    with pytest.raises(ResourceAccessTokenInputError):
        service.create(CONTEXT, name=name, resources=resources)
    store.create.assert_not_called()
    with pytest.raises(ResourceAccessTokenInputError):
        service.update(CONTEXT, token_id="token", name=name, resources=resources)
    store.update.assert_not_called()


def test_rename_preserves_bindings(service: ResourceAccessTokenService, store: Mock) -> None:
    service.update(CONTEXT, token_id="token", name="  Renamed  ", resources=None)
    store.update.assert_called_once_with("workspace", "token", "Renamed", None)


@pytest.mark.parametrize("app_id", [None, "app"])
def test_openapi_grant_uses_live_store_and_records_usage(
    service: ResourceAccessTokenService, store: Mock, app_id: str | None
) -> None:
    store.access_by_id.return_value = ResourceAccessTokenAccess(
        "token", "workspace", True, (BoundResource(ResourceType.APP, "app", True, True),)
    )
    grant = service.authorize_openapi(token_id="token", workspace_id="workspace", app_id=app_id)
    assert grant.tenant_id == "workspace"
    assert grant.app_ids == frozenset({"app"})
    store.record_usage.assert_called_once_with("workspace", "token")
    store.access_by_id.return_value = ResourceAccessTokenAccess("token", "workspace", True, ())
    with pytest.raises(ResourceAccessTokenForbiddenError):
        service.authorize_openapi(token_id="token", workspace_id="workspace", app_id="app")


@pytest.mark.parametrize(
    ("workspace", "active", "resource"),
    [
        ("foreign", True, BoundResource(ResourceType.APP, "app", True, True)),
        ("workspace", False, BoundResource(ResourceType.APP, "app", True, True)),
        ("workspace", True, BoundResource(ResourceType.APP, "app", True, False)),
        ("workspace", True, BoundResource(ResourceType.APP, "app", False, True)),
        ("workspace", True, BoundResource(ResourceType.KNOWLEDGE, "app", True, True)),
    ],
)
def test_openapi_denials_do_not_record_usage(
    service: ResourceAccessTokenService, store: Mock, workspace: str, active: bool, resource: BoundResource
) -> None:
    store.access_by_id.return_value = ResourceAccessTokenAccess("token", "workspace", active, (resource,))
    with pytest.raises(ResourceAccessTokenForbiddenError):
        service.authorize_openapi(token_id="token", workspace_id=workspace, app_id="app")
    store.record_usage.assert_not_called()


def test_service_api_requires_explicit_app_when_ambiguous(service: ResourceAccessTokenService, store: Mock) -> None:
    store.access_by_secret.return_value = ResourceAccessTokenAccess(
        "token",
        "workspace",
        True,
        (
            BoundResource(ResourceType.APP, "app", True, True),
            BoundResource(ResourceType.APP, "other", True, True),
        ),
    )
    with pytest.raises(ResourceAccessTokenInputError):
        service.resolve_app_for_service_api(token="secret", requested_app_id=None)
    store.record_usage.assert_not_called()
    assert service.resolve_app_for_service_api(token="secret", requested_app_id="app").app_ids == frozenset({"app"})


def test_dataset_scope_never_uses_an_app_binding(service: ResourceAccessTokenService, store: Mock) -> None:
    store.access_by_secret.return_value = ResourceAccessTokenAccess(
        "token", "workspace", True, (BoundResource(ResourceType.APP, "dataset", True, True),)
    )
    with pytest.raises(ResourceAccessTokenForbiddenError):
        service.resolve_tenant_for_dataset_service_api(token="secret", dataset_id="dataset")
    store.record_usage.assert_not_called()
