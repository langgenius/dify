"""Service policy tests use the Store contract without ORM/session fixtures."""

import pytest

from constants.resource_access_token import ResourceAccessTokenManagedBy as ManagedBy
from constants.resource_access_token import ResourceAccessTokenResourceType as ResourceType
from machinery.context import RequestContext
from services.auth.resource_access_token_contracts import (
    BoundResource,
    ResourceAccessTokenAccess,
    ResourceAccessTokenCreateResult,
    ResourceAccessTokenForbiddenError,
    ResourceAccessTokenInputError,
    ResourceAccessTokenInvalidError,
    ResourceAccessTokenResource,
    ResourceAccessTokenRow,
)
from services.resource_access_token_service import ResourceAccessTokenService

CONTEXT = RequestContext("request", None, "owner", "workspace")
APP = ResourceAccessTokenResource(ResourceType.APP, "app")


class FakeResourceAccessTokenStore:
    def __init__(self) -> None:
        self.create_calls: list[tuple[str, str | None, str, tuple[ResourceAccessTokenResource, ...], ManagedBy]] = []
        self.update_calls: list[tuple[str, str, str, tuple[ResourceAccessTokenResource, ...] | None]] = []
        self.usage_calls: list[tuple[str, str]] = []
        self.secret_calls: list[str] = []
        self.id_calls: list[str] = []
        self.create_result = ResourceAccessTokenCreateResult("token", "secret", ())
        self.access = ResourceAccessTokenAccess("token", "workspace", True, (), ManagedBy.USER)

    def create(
        self,
        tenant_id: str,
        created_by: str | None,
        name: str,
        resources: tuple[ResourceAccessTokenResource, ...],
        managed_by: ManagedBy,
    ) -> ResourceAccessTokenCreateResult:
        self.create_calls.append((tenant_id, created_by, name, resources, managed_by))
        return self.create_result

    def update(
        self, tenant_id: str, token_id: str, name: str, resources: tuple[ResourceAccessTokenResource, ...] | None
    ) -> tuple[ResourceAccessTokenRow, ...]:
        self.update_calls.append((tenant_id, token_id, name, resources))
        return ()

    def list_rows(
        self, tenant_id: str, page: int, limit: int, keyword: str | None = None
    ) -> tuple[ResourceAccessTokenRow, ...]:
        raise NotImplementedError

    def count_tokens(self, tenant_id: str, keyword: str | None = None) -> int:
        raise NotImplementedError

    def delete(self, tenant_id: str, token_id: str, relation_id: str) -> None:
        raise NotImplementedError

    def delete_token(self, tenant_id: str, token_id: str) -> None:
        raise NotImplementedError

    def access_by_secret(self, token: str) -> ResourceAccessTokenAccess:
        self.secret_calls.append(token)
        return self.access

    def access_by_id(self, token_id: str) -> ResourceAccessTokenAccess:
        self.id_calls.append(token_id)
        return self.access

    def record_usage(self, tenant_id: str, token_id: str) -> None:
        self.usage_calls.append((tenant_id, token_id))


@pytest.fixture
def store() -> FakeResourceAccessTokenStore:
    return FakeResourceAccessTokenStore()


@pytest.fixture
def service(store: FakeResourceAccessTokenStore) -> ResourceAccessTokenService:
    return ResourceAccessTokenService(tokens=store)


def test_create_normalizes_and_deduplicates_with_explicit_owner(
    service: ResourceAccessTokenService, store: FakeResourceAccessTokenStore
) -> None:
    result = service.create(CONTEXT, name="  CLI  ", resources=(APP, APP))
    assert store.create_calls == [("workspace", "owner", "CLI", (APP,), ManagedBy.USER)]
    assert result is store.create_result


@pytest.mark.parametrize(("name", "resources"), [("  ", (APP,)), ("CLI", ())])
def test_invalid_input_never_writes(
    service: ResourceAccessTokenService,
    store: FakeResourceAccessTokenStore,
    name: str,
    resources: tuple[ResourceAccessTokenResource, ...],
) -> None:
    with pytest.raises(ResourceAccessTokenInputError):
        service.create(CONTEXT, name=name, resources=resources)
    assert store.create_calls == []
    with pytest.raises(ResourceAccessTokenInputError):
        service.update(CONTEXT, token_id="token", name=name, resources=resources)
    assert store.update_calls == []


def test_rename_preserves_bindings(service: ResourceAccessTokenService, store: FakeResourceAccessTokenStore) -> None:
    service.update(CONTEXT, token_id="token", name="  Renamed  ", resources=None)
    assert store.update_calls == [("workspace", "token", "Renamed", None)]


@pytest.mark.parametrize("app_id", [None, "app"])
def test_openapi_grant_uses_live_store_and_records_usage(
    service: ResourceAccessTokenService, store: FakeResourceAccessTokenStore, app_id: str | None
) -> None:
    store.access = ResourceAccessTokenAccess(
        "token", "workspace", True, (BoundResource(ResourceType.APP, "app", True, True),), ManagedBy.USER
    )
    grant = service.authorize_openapi(token_id="token", workspace_id="workspace", app_id=app_id)
    assert grant.tenant_id == "workspace"
    assert grant.app_ids == frozenset({"app"})
    assert store.usage_calls == [("workspace", "token")]
    store.access = ResourceAccessTokenAccess("token", "workspace", True, (), ManagedBy.USER)
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
    service: ResourceAccessTokenService,
    store: FakeResourceAccessTokenStore,
    workspace: str,
    active: bool,
    resource: BoundResource,
) -> None:
    store.access = ResourceAccessTokenAccess("token", "workspace", active, (resource,), ManagedBy.USER)
    with pytest.raises(ResourceAccessTokenForbiddenError):
        service.authorize_openapi(token_id="token", workspace_id=workspace, app_id="app")
    assert store.usage_calls == []


def test_service_api_requires_explicit_app_when_ambiguous(
    service: ResourceAccessTokenService, store: FakeResourceAccessTokenStore
) -> None:
    store.access = ResourceAccessTokenAccess(
        "token",
        "workspace",
        True,
        (
            BoundResource(ResourceType.APP, "app", True, True),
            BoundResource(ResourceType.APP, "other", True, True),
        ),
        ManagedBy.USER,
    )
    with pytest.raises(ResourceAccessTokenInputError):
        service.resolve_app_for_service_api(token="secret", requested_app_id=None)
    assert store.usage_calls == []
    assert service.resolve_app_for_service_api(token="secret", requested_app_id="app").app_ids == frozenset({"app"})


def test_dataset_scope_never_uses_an_app_binding(
    service: ResourceAccessTokenService, store: FakeResourceAccessTokenStore
) -> None:
    store.access = ResourceAccessTokenAccess(
        "token", "workspace", True, (BoundResource(ResourceType.APP, "dataset", True, True),), ManagedBy.USER
    )
    with pytest.raises(ResourceAccessTokenForbiddenError):
        service.resolve_tenant_for_dataset_service_api(token="secret", dataset_id="dataset")
    assert store.usage_calls == []


def test_enterprise_user_token_requires_creator_but_managed_token_does_not(
    service: ResourceAccessTokenService, store: FakeResourceAccessTokenStore
) -> None:
    with pytest.raises(ResourceAccessTokenInputError):
        service.create_for_enterprise(
            tenant_id="workspace", managed_by=ManagedBy.USER, name="CI", created_by=None, resources=(APP,)
        )
    assert store.create_calls == []

    service.create_for_enterprise(
        tenant_id="workspace", managed_by=ManagedBy.APPDEPLOY, name=" appdeploy ", created_by=None, resources=(APP,)
    )
    assert store.create_calls == [("workspace", None, "appdeploy", (APP,), ManagedBy.APPDEPLOY)]


@pytest.mark.parametrize(
    "authorize",
    [
        lambda service: service.authenticate("secret"),
        lambda service: service.authorize_openapi(token_id="token", workspace_id=None, app_id=None),
        lambda service: service.resolve_app_for_service_api(token="secret", requested_app_id="app"),
        lambda service: service.resolve_tenant_for_dataset_service_api(token="secret", dataset_id="dataset"),
    ],
)
def test_managed_token_is_invalid_on_account_facing_routes(
    service: ResourceAccessTokenService, store: FakeResourceAccessTokenStore, authorize
) -> None:
    store.access = ResourceAccessTokenAccess(
        "token",
        "workspace",
        True,
        (
            BoundResource(ResourceType.APP, "app", True, True),
            BoundResource(ResourceType.KNOWLEDGE, "dataset", True, True),
        ),
        ManagedBy.APPDEPLOY,
    )
    with pytest.raises(ResourceAccessTokenInvalidError):
        authorize(service)
    assert store.usage_calls == []
