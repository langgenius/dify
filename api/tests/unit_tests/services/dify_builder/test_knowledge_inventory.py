"""Actor-scoped metadata discovery: real SQL policies, native RBAC readback boundary."""

from collections.abc import Callable, Sequence
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from enums.account import TenantAccountRole
from models.account import Account, AccountStatus, TenantAccountJoin
from models.dataset import Dataset, DatasetPermission, Document
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, PermissionEnum, TagType
from models.model import Tag, TagBinding
from services.dify_builder.agent import resources
from services.dify_builder.native_testing.agent_catalog import AgentCatalogService
from services.enterprise.rbac_service import RBACService
from services.rbac.contracts import ResourceWhitelistResources

TENANT = "aaaaaaaa-0000-4000-8000-000000000001"
OTHER = "aaaaaaaa-0000-4000-8000-000000000002"
ACTOR = "bbbbbbbb-0000-4000-8000-000000000001"
MAINTAINER = "bbbbbbbb-0000-4000-8000-000000000002"
IDS = [f"cccccccc-0000-4000-8000-{i:012d}" for i in range(1, 7)]


@pytest.fixture(autouse=True)
def inventory(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]
) -> sessionmaker[Session]:
    monkeypatch.setattr(resources, "db", SimpleNamespace(engine=sqlite_engine))
    monkeypatch.setattr(resources, "_list_models", lambda *_: [])
    monkeypatch.setattr(resources, "_list_tools", lambda *_: [])
    monkeypatch.setattr(AgentCatalogService, "list_candidates", lambda *_args, **_kwargs: [])
    with sqlite_session_factory.begin() as sql:
        account = Account(name="Synthetic", email="knowledge-_inventory@test.invalid")
        account.id = ACTOR
        sql.add(account)
        sql.add(TenantAccountJoin(tenant_id=TENANT, account_id=ACTOR, role=TenantAccountRole.EDITOR))
        for dataset_id, permission, tenant, maintainer in [
            (IDS[0], PermissionEnum.ALL_TEAM, TENANT, MAINTAINER),
            (IDS[1], PermissionEnum.ONLY_ME, TENANT, MAINTAINER),
            (IDS[2], PermissionEnum.ONLY_ME, TENANT, ACTOR),
            (IDS[3], PermissionEnum.PARTIAL_TEAM, TENANT, MAINTAINER),
            (IDS[4], PermissionEnum.PARTIAL_TEAM, TENANT, MAINTAINER),
            (IDS[5], PermissionEnum.ALL_TEAM, OTHER, ACTOR),
        ]:
            sql.add(
                Dataset(
                    id=dataset_id,
                    tenant_id=tenant,
                    name=f"KB {dataset_id}",
                    description="Synthetic metadata",
                    provider="vendor",
                    permission=permission,
                    maintainer=maintainer,
                    created_by=maintainer,
                )
            )
        sql.add(DatasetPermission(dataset_id=IDS[3], tenant_id=TENANT, account_id=ACTOR, has_permission=True))
        sql.add(DatasetPermission(dataset_id=IDS[4], tenant_id=TENANT, account_id=ACTOR, has_permission=False))
    return sqlite_session_factory


def test_no_actor_never_returns_tenant_catalogue(config_overrides: Callable[..., None]) -> None:
    config_overrides(RBAC_ENABLED=False)
    assert resources.list_tenant_resources(TENANT).datasets == []


def test_legacy_access_uses_actual_member_and_positive_partial_grants(config_overrides: Callable[..., None]) -> None:
    config_overrides(RBAC_ENABLED=False)
    inv = resources.list_tenant_resources(TENANT, account_id=ACTOR)
    assert {ref.id for ref in inv.datasets} == {IDS[0], IDS[2], IDS[3]}
    assert inv.dataset_source_error is None


@pytest.mark.parametrize(("actor", "tenant"), [(MAINTAINER, TENANT), (ACTOR, OTHER)])
def test_nonmember_or_cross_workspace_actor_returns_no_names(
    config_overrides: Callable[..., None], actor: str, tenant: str
) -> None:
    config_overrides(RBAC_ENABLED=False)
    assert resources.list_tenant_resources(tenant, account_id=actor).datasets == []


def rbac(
    monkeypatch: pytest.MonkeyPatch,
    *,
    unrestricted: bool = True,
    whitelist: Sequence[str] = (),
    permissions: dict[str, list[str]] | None = None,
) -> Mock:
    monkeypatch.setattr(
        RBACService.DatasetAccess,
        "whitelist_resources",
        Mock(return_value=ResourceWhitelistResources(unrestricted=unrestricted, resource_ids=list(whitelist))),
    )
    get = Mock(return_value=permissions or {})
    monkeypatch.setattr(RBACService.DatasetPermissions, "batch_get", get)
    return get


def test_rbac_uses_native_whitelist_and_exact_resource_permissions(
    config_overrides: Callable[..., None], monkeypatch: pytest.MonkeyPatch
) -> None:
    config_overrides(RBAC_ENABLED=True)
    get = rbac(
        monkeypatch,
        unrestricted=False,
        whitelist=[IDS[0], IDS[1], IDS[5]],
        permissions={
            IDS[0]: ["dataset.acl.preview", "dataset.acl.use"],
            IDS[1]: ["dataset.acl.preview"],
            IDS[2]: [],
            IDS[3]: ["dataset.acl.preview", "dataset.acl.use"],
            IDS[5]: ["dataset.acl.preview", "dataset.acl.use"],
        },
    )
    inv = resources.list_tenant_resources(TENANT, account_id=ACTOR)
    assert {r.id for r in inv.datasets} == {IDS[0], IDS[1], IDS[2]}
    assert IDS[5] not in get.call_args.args[2]
    preview = next(r for r in inv.datasets if r.id == IDS[1])
    assert preview.availability["use"] == "not_allowed"
    assert preview.availability["scope"] == "discovery_only"


def test_permission_use_does_not_imply_metadata_preview(
    config_overrides: Callable[..., None], monkeypatch: pytest.MonkeyPatch
) -> None:
    config_overrides(RBAC_ENABLED=True)
    rbac(monkeypatch, permissions={IDS[0]: ["dataset.acl.use"]})
    refs = resources.list_tenant_resources(TENANT, account_id=ACTOR).datasets
    assert {ref.id for ref in refs} == {IDS[2]}


@pytest.mark.parametrize("unrestricted", [False, True])
def test_rbac_maintainer_retains_native_visibility_and_use_without_batch_grants(
    config_overrides: Callable[..., None], monkeypatch: pytest.MonkeyPatch, unrestricted: bool
) -> None:
    config_overrides(RBAC_ENABLED=True)
    get = rbac(monkeypatch, unrestricted=unrestricted, permissions={})
    inv = resources.list_tenant_resources(TENANT, account_id=ACTOR)
    assert [ref.id for ref in inv.datasets] == [IDS[2]]
    assert inv.datasets[0].availability["use"] == "allowed"
    assert inv.datasets[0].availability["runtime"] == "not_supported"
    assert IDS[5] not in get.call_args.args[2]  # Same maintainer in another tenant grants nothing.


def test_rbac_failure_is_unavailable_not_tenantwide_or_successful_empty(
    config_overrides: Callable[..., None], monkeypatch: pytest.MonkeyPatch
) -> None:
    config_overrides(RBAC_ENABLED=True)
    rbac(monkeypatch)
    monkeypatch.setattr(
        RBACService.DatasetPermissions, "batch_get", Mock(side_effect=RuntimeError("private backend failure"))
    )
    inv = resources.list_tenant_resources(TENANT, account_id=ACTOR)
    assert inv.datasets == []
    assert inv.dataset_source_error == "inventory_unavailable"


def test_empty_knowledge_is_discoverable_but_not_runtime_readiness(config_overrides: Callable[..., None]) -> None:
    config_overrides(RBAC_ENABLED=False)
    ref = resources.list_tenant_resources(TENANT, account_id=ACTOR).datasets[0]
    assert ref.description == "Synthetic metadata"
    assert ref.availability["documents"] == "empty"
    assert ref.availability["runtime"] == "not_supported"
    assert ref.readiness == "waiting_setup"
    assert "Discovery only" in ref.meta


def test_document_status_metadata_ignores_disabled_and_archived_content(
    inventory: sessionmaker[Session], config_overrides: Callable[..., None]
) -> None:
    config_overrides(RBAC_ENABLED=False)
    with inventory.begin() as sql:
        for status, enabled, archived in [
            ("completed", True, False),
            ("indexing", True, False),
            ("completed", False, False),
            ("completed", True, True),
        ]:
            sql.add(
                Document(
                    tenant_id=TENANT,
                    dataset_id=IDS[0],
                    position=1,
                    data_source_type=DataSourceType.UPLOAD_FILE,
                    batch="synthetic",
                    name="Never read this document name",
                    created_from=DocumentCreatedFrom.WEB,
                    created_by=ACTOR,
                    indexing_status=IndexingStatus(status),
                    enabled=enabled,
                    archived=archived,
                    data_source_info="SECRET DOCUMENT BODY",
                )
            )
    refs = resources.list_tenant_resources(TENANT, account_id=ACTOR).datasets
    ref = next(r for r in refs if r.id == IDS[0])
    assert ref.availability["documents"] == "indexing"
    assert ref.availability["runtime"] == "not_supported"
    assert "SECRET" not in repr(ref)


def test_inventory_reads_only_authorized_metadata_columns(
    inventory: sessionmaker[Session], config_overrides: Callable[..., None]
) -> None:
    config_overrides(RBAC_ENABLED=False)
    statements = []

    def record(
        _connection: object, _cursor: object, statement: str, _parameters: object, _context: object, _many: object
    ) -> None:
        statements.append(statement.lower())

    engine = inventory.kw["bind"]
    event.listen(engine, "before_cursor_execute", record)
    try:
        resources.list_tenant_resources(TENANT, account_id=ACTOR)
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert not any(
        "datasets.index_struct" in statement
        or "datasets.retrieval_model" in statement
        or "documents.data_source_info" in statement
        or "accounts.password" in statement
        for statement in statements
    )


@pytest.mark.parametrize(
    ("role", "expected"),
    [(TenantAccountRole.OWNER, set(IDS[:5])), (TenantAccountRole.DATASET_OPERATOR, {IDS[3]})],
)
def test_native_legacy_role_visibility_is_retained(
    inventory: sessionmaker[Session],
    config_overrides: Callable[..., None],
    role: TenantAccountRole,
    expected: set[str],
) -> None:
    config_overrides(RBAC_ENABLED=False)
    with inventory.begin() as sql:
        member = sql.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == ACTOR))
        assert member is not None
        member.role = role
    assert {r.id for r in resources.list_tenant_resources(TENANT, account_id=ACTOR).datasets} == expected


def test_banned_account_cannot_discover_metadata(
    inventory: sessionmaker[Session],
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(RBAC_ENABLED=False)
    with inventory.begin() as sql:
        account = sql.get(Account, ACTOR)
        assert account is not None
        account.status = AccountStatus.BANNED
    assert resources.list_tenant_resources(TENANT, account_id=ACTOR).datasets == []


@pytest.mark.parametrize(
    ("status", "state", "readiness"),
    [(IndexingStatus.COMPLETED, "indexed", "ready"), (IndexingStatus.ERROR, "unavailable", "waiting_setup")],
)
def test_indexed_and_failed_document_metadata_remains_discovery_only(
    inventory: sessionmaker[Session],
    config_overrides: Callable[..., None],
    status: IndexingStatus,
    state: str,
    readiness: str,
) -> None:
    config_overrides(RBAC_ENABLED=False)
    with inventory.begin() as sql:
        sql.add(
            Document(
                tenant_id=TENANT,
                dataset_id=IDS[0],
                position=1,
                data_source_type=DataSourceType.UPLOAD_FILE,
                batch="synthetic",
                name="Never read",
                created_from=DocumentCreatedFrom.WEB,
                created_by=ACTOR,
                indexing_status=status,
            )
        )
    inv = resources.list_tenant_resources(TENANT, account_id=ACTOR)
    assert inv.models == inv.tools == inv.agents == []
    ref = next(r for r in inv.datasets if r.id == IDS[0])
    assert ref.availability["documents"] == state
    assert ref.readiness == readiness
    assert ref.availability["runtime"] == "not_supported"


def test_tags_are_authorized_tenant_metadata_only(
    inventory: sessionmaker[Session],
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(RBAC_ENABLED=False)
    with inventory.begin() as sql:
        for tenant, label in [(TENANT, "Public topic"), (OTHER, "PRIVATE FOREIGN TAG")]:
            tag = Tag(tenant_id=tenant, type=TagType.KNOWLEDGE, name=label, created_by=ACTOR)
            sql.add(tag)
            sql.flush()
            sql.add(TagBinding(tenant_id=tenant, tag_id=tag.id, target_id=IDS[0], created_by=ACTOR))
    ref = next(r for r in resources.list_tenant_resources(TENANT, account_id=ACTOR).datasets if r.id == IDS[0])
    assert "Public topic" in ref.meta
    assert "PRIVATE FOREIGN TAG" not in repr(ref)
