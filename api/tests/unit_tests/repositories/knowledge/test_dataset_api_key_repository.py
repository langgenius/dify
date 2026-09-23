"""Real persistence checks for the resource API key boundary."""

from functools import partial

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Tenant
from models.dataset import Dataset
from models.enums import ApiTokenType
from models.model import ApiToken, DatasetApiTokenBinding
from repositories.knowledge import dataset_api_key_bindings
from repositories.knowledge.dataset_api_key_repository import DatasetApiKeyRepository
from services.auth.api_key_contracts import (
    ApiKeyLimitExceededError,
    ApiKeyNotFoundError,
    ApiKeyResourceNotFoundError,
)
from services.knowledge.api_key_service import UnknownDatasetIdsError


@pytest.fixture
def repository(sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]) -> DatasetApiKeyRepository:
    tenant = Tenant(name="Workspace")
    tenant.id = "tenant"
    sqlite_session.add(tenant)
    sqlite_session.add_all(
        [
            Dataset(id="dataset", tenant_id="tenant", name="Dataset", created_by="actor"),
            Dataset(id="other-dataset", tenant_id="tenant", name="Other dataset", created_by="actor"),
        ]
    )
    sqlite_session.commit()
    return DatasetApiKeyRepository(session_factory=sqlite_session_factory)


@pytest.mark.parametrize("operation", ["list", "create", "delete"])
def test_resource_must_belong_to_workspace(repository: DatasetApiKeyRepository, operation: str) -> None:
    def invoke() -> object:
        if operation == "list":
            return repository.list_keys("foreign", "dataset")
        if operation == "create":
            return repository.create_key("foreign", "dataset", max_keys=10, prefix="test-")
        return repository.delete_key("foreign", "dataset", "missing")

    with pytest.raises(ApiKeyResourceNotFoundError):
        invoke()


def test_dataset_keys_use_persisted_bindings_and_cannot_manage_broader_scopes(
    repository: DatasetApiKeyRepository,
    sqlite_session: Session,
) -> None:
    created = repository.create_key("tenant", "dataset", max_keys=10, prefix="ds-")
    assert created.dataset_ids == ("dataset",)
    assert created.token.startswith("ds-")
    assert (
        sqlite_session.scalar(
            select(DatasetApiTokenBinding.dataset_id).where(DatasetApiTokenBinding.api_token_id == created.id)
        )
        == "dataset"
    )
    scopes: list[tuple[str, list[str], str]] = [
        ("unrestricted", [], "tenant"),
        ("multiple", ["dataset", "other-dataset"], "tenant"),
        ("foreign", ["dataset"], "foreign"),
        ("other", ["other-dataset"], "tenant"),
    ]
    for key_id, dataset_ids, tenant_id in scopes:
        sqlite_session.add(ApiToken(id=key_id, type=ApiTokenType.DATASET, token=key_id, tenant_id=tenant_id))
        sqlite_session.add_all(DatasetApiTokenBinding(api_token_id=key_id, dataset_id=value) for value in dataset_ids)
    sqlite_session.commit()

    assert repository.list_keys("tenant", "dataset") == (created,)
    for key_id in ["unrestricted", "multiple", "foreign", "other"]:
        with pytest.raises(ApiKeyNotFoundError):
            repository.delete_key("tenant", "dataset", key_id)
    with pytest.raises(ApiKeyLimitExceededError):
        repository.create_key("tenant", "dataset", max_keys=1, prefix="ds-")
    repository.delete_key("tenant", "dataset", created.id)
    assert repository.list_keys("tenant", "dataset") == ()


@pytest.mark.parametrize("workspace", [False, True])
def test_failed_binding_rolls_back_the_new_token(
    repository: DatasetApiKeyRepository, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, workspace: bool
) -> None:
    def fail_binding(_session: Session, _api_token_id: str, _dataset_ids: object) -> None:
        raise RuntimeError("binding write failed")

    monkeypatch.setattr(dataset_api_key_bindings, "bind_datasets", fail_binding)
    create_key = (
        partial(repository.create_workspace_key, "tenant", ("dataset",), max_keys=10, prefix="dataset-")
        if workspace
        else partial(repository.create_key, "tenant", "dataset", max_keys=10, prefix="ds-")
    )
    with pytest.raises(RuntimeError, match="binding write failed"):
        create_key()

    assert sqlite_session.scalar(select(ApiToken)) is None


@pytest.mark.parametrize("scope", [(), ("other-dataset",), ("dataset", "other-dataset")])
@pytest.mark.parametrize("workspace_creates_last", [False, True])
def test_both_scopes_share_the_workspace_quota(
    repository: DatasetApiKeyRepository,
    sqlite_session: Session,
    scope: tuple[str, ...],
    workspace_creates_last: bool,
) -> None:
    # Neither another tenant's keys nor app keys consume the dataset quota.
    sqlite_session.add_all(
        [ApiToken(tenant_id="foreign", type=ApiTokenType.DATASET, token=f"foreign-{i}") for i in range(10)]
        + [ApiToken(tenant_id="tenant", type=ApiTokenType.APP, token=f"app-{i}") for i in range(10)]
    )
    sqlite_session.commit()
    for _ in range(9):
        repository.create_workspace_key("tenant", scope, max_keys=10, prefix="dataset-")

    if workspace_creates_last:
        repository.create_workspace_key("tenant", scope, max_keys=10, prefix="dataset-")
    else:
        repository.create_key("tenant", "dataset", max_keys=10, prefix="ds-")

    with pytest.raises(ApiKeyLimitExceededError):
        repository.create_key("tenant", "dataset", max_keys=10, prefix="ds-")
    with pytest.raises(ApiKeyLimitExceededError):
        repository.create_workspace_key("tenant", (), max_keys=10, prefix="dataset-")
    assert len(repository.list_workspace_keys("tenant")) == 10


def test_workspace_operations_preserve_scope_and_tenant(
    repository: DatasetApiKeyRepository, sqlite_session: Session
) -> None:
    sqlite_session.add(Dataset(id="foreign-dataset", tenant_id="foreign", name="Foreign", created_by="actor"))
    sqlite_session.commit()
    with pytest.raises(UnknownDatasetIdsError):
        repository.create_workspace_key("tenant", ("dataset", "foreign-dataset"), max_keys=10, prefix="dataset-")
    assert sqlite_session.scalar(select(ApiToken)) is None

    key = repository.create_workspace_key("tenant", ("dataset", "other-dataset"), max_keys=10, prefix="dataset-")
    listed = repository.list_workspace_keys("tenant")
    assert len(listed) == 1
    assert set(listed[0].dataset_ids) == {"dataset", "other-dataset"}
    assert repository.list_workspace_keys("foreign") == ()
    with pytest.raises(ApiKeyNotFoundError):
        repository.delete_workspace_key("foreign", key.id)
    repository.delete_workspace_key("tenant", key.id)
    assert repository.list_workspace_keys("tenant") == ()
