"""Knowledge key composition and post-commit cache invalidation."""

from collections.abc import Callable
from functools import partial

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from extensions.application_services.knowledge import build_dataset_api_key_service
from machinery.context import RequestContext
from models.account import Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, DatasetPermission
from models.enums import PermissionEnum
from models.model import ApiToken
from services.api_token_service import ApiTokenCache
from services.auth.api_key_contracts import ApiKeyNotFoundError
from services.errors.account import NoPermissionError
from services.knowledge.api_key_service import DatasetApiKeyService


@pytest.fixture
def service(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
) -> DatasetApiKeyService:
    config_overrides(RBAC_ENABLED=False)
    tenant = Tenant(name="Workspace")
    tenant.id = "tenant"
    sqlite_session.add_all(
        [
            tenant,
            TenantAccountJoin(tenant_id="tenant", account_id="actor", role=TenantAccountRole.OWNER),
            Dataset(id="dataset", tenant_id="tenant", name="Dataset", created_by="actor", maintainer="maintainer"),
        ]
    )
    sqlite_session.commit()
    return build_dataset_api_key_service(database_client=sqlite_session_factory)


@pytest.mark.parametrize("workspace", [False, True])
def test_dataset_keys_commit_before_invalidating_cache(
    service: DatasetApiKeyService,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    workspace: bool,
) -> None:
    calls: list[tuple[str, str | None]] = []

    def invalidate(token: str, scope: str | None = None) -> bool:
        with sqlite_session_factory() as session:
            assert session.scalar(select(ApiToken).where(ApiToken.token == token)) is None
        calls.append((token, scope))
        return True

    monkeypatch.setattr(ApiTokenCache, "delete", invalidate)
    context = RequestContext("request", None, "actor", "tenant")

    key = (
        service.create_workspace_key(context, ("dataset", "dataset"))
        if workspace
        else service.create_key(context, "dataset")
    )
    assert key.token.startswith("dataset-" if workspace else "ds-")
    assert key.dataset_ids == ("dataset",)
    assert service.list_keys(context, "dataset") == (key,)

    delete_key = (
        partial(service.delete_workspace_key, context) if workspace else partial(service.delete_key, context, "dataset")
    )
    with pytest.raises(ApiKeyNotFoundError):
        delete_key("missing")
    assert calls == []

    delete_key(key.id)
    assert calls == [(key.token, key.type)]
    assert service.list_keys(context, "dataset") == ()


@pytest.mark.parametrize(
    ("permission", "role", "maintainer", "grant", "allowed"),
    [
        (PermissionEnum.ONLY_ME, TenantAccountRole.EDITOR, "other", None, False),
        (PermissionEnum.ONLY_ME, TenantAccountRole.ADMIN, "other", None, False),
        (PermissionEnum.ONLY_ME, TenantAccountRole.OWNER, "other", None, True),
        (PermissionEnum.ONLY_ME, TenantAccountRole.EDITOR, "actor", None, True),
        (PermissionEnum.PARTIAL_TEAM, TenantAccountRole.EDITOR, "other", None, False),
        (PermissionEnum.PARTIAL_TEAM, TenantAccountRole.EDITOR, "other", "allowed", True),
        (PermissionEnum.PARTIAL_TEAM, TenantAccountRole.EDITOR, "actor", None, True),
        (PermissionEnum.PARTIAL_TEAM, TenantAccountRole.EDITOR, "other", "revoked", False),
        (PermissionEnum.PARTIAL_TEAM, TenantAccountRole.EDITOR, "other", "foreign", False),
        (PermissionEnum.ALL_TEAM, TenantAccountRole.EDITOR, "other", None, True),
    ],
)
def test_dataset_acl_controls_key_management(
    service: DatasetApiKeyService,
    sqlite_session: Session,
    permission: PermissionEnum,
    role: TenantAccountRole,
    maintainer: str,
    grant: str | None,
    allowed: bool,
) -> None:
    dataset = sqlite_session.get(Dataset, "dataset")
    member = sqlite_session.scalar(select(TenantAccountJoin))
    assert dataset is not None
    assert member is not None
    dataset.permission = permission
    dataset.maintainer = maintainer
    member.role = role
    if grant:
        sqlite_session.add(
            DatasetPermission(
                dataset_id="dataset",
                account_id="actor",
                tenant_id="foreign" if grant == "foreign" else "tenant",
                has_permission=grant != "revoked",
            )
        )
    sqlite_session.commit()
    context = RequestContext("request", None, "actor", "tenant")

    if allowed:
        key = service.create_key(context, "dataset")
        assert service.list_keys(context, "dataset") == (key,)
    else:
        with pytest.raises(NoPermissionError):
            service.create_key(context, "dataset")
        with pytest.raises(NoPermissionError):
            service.list_keys(context, "dataset")
        with pytest.raises(NoPermissionError):
            service.delete_key(context, "dataset", "missing")
        assert sqlite_session.scalar(select(ApiToken)) is None


def test_acl_requires_membership_in_the_active_workspace(
    service: DatasetApiKeyService, sqlite_session: Session
) -> None:
    member = sqlite_session.scalar(select(TenantAccountJoin))
    assert member is not None
    member.tenant_id = "foreign"
    sqlite_session.commit()
    with pytest.raises(NoPermissionError):
        service.create_key(RequestContext("request", None, "actor", "tenant"), "dataset")
    assert sqlite_session.scalar(select(ApiToken)) is None


def test_rbac_admitted_request_uses_rbac_instead_of_community_acl(
    service: DatasetApiKeyService, config_overrides: Callable[..., None]
) -> None:
    config_overrides(RBAC_ENABLED=True)
    key = service.create_key(RequestContext("request", None, "rbac-actor", "tenant"), "dataset")
    assert key.dataset_ids == ("dataset",)
