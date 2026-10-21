"""PostgreSQL concurrency coverage for dataset-key revocation."""

from concurrent.futures import ThreadPoolExecutor
from functools import partial
from threading import Barrier, Lock
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexTechniqueType
from models.dataset import Dataset
from models.enums import ApiTokenType, DataSourceType
from models.model import ApiToken, DatasetApiTokenBinding
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from services.api_token_service import ApiTokenCache
from services.knowledge.resource_scope import DatasetRef


def _dataset(*, tenant_id: str, owner_id: str, name: str) -> Dataset:
    return Dataset(
        tenant_id=tenant_id,
        name=name,
        description="",
        provider="vendor",
        permission="only_me",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.ECONOMY,
        created_by=owner_id,
    )


def test_concurrent_dataset_deletes_revoke_the_last_scoped_key(
    db_session_with_containers: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two dataset deletions cannot turn their shared scoped key into an unbound key."""

    tenant_id = str(uuid4())
    owner_id = str(uuid4())
    raw_token = f"dataset-concurrent-{uuid4()}"
    datasets = [
        _dataset(tenant_id=tenant_id, owner_id=owner_id, name="Concurrent A"),
        _dataset(tenant_id=tenant_id, owner_id=owner_id, name="Concurrent B"),
    ]
    token = ApiToken(tenant_id=tenant_id, type=ApiTokenType.DATASET, token=raw_token)
    db_session_with_containers.add_all([*datasets, token])
    db_session_with_containers.flush()
    dataset_ids = tuple(dataset.id for dataset in datasets)
    token_id = token.id
    db_session_with_containers.add_all(
        DatasetApiTokenBinding(api_token_id=token_id, dataset_id=dataset_id) for dataset_id in dataset_ids
    )
    db_session_with_containers.commit()

    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    evictions: list[tuple[str, str]] = []
    evictions_lock = Lock()

    def record_cache_delete(token_value: str, scope: str) -> bool:
        with evictions_lock:
            evictions.append((token_value, scope))
        return True

    monkeypatch.setattr(ApiTokenCache, "delete", record_cache_delete)
    repository = SQLAlchemyDatasetRepository(
        session_factory=sessions,
        wake_after_commit=lambda _session: None,
        revoke_keys_after_commit=partial(ApiTokenCache.delete_after_commit, scope="dataset"),
    )
    ready = Barrier(2)

    def delete_dataset(dataset_id: str) -> bool:
        ready.wait(timeout=30)
        return repository.delete_with_relations(DatasetRef(tenant_id, dataset_id))

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(delete_dataset, dataset_id) for dataset_id in dataset_ids]
        assert [future.result(timeout=30) for future in futures] == [True, True]

    db_session_with_containers.expire_all()
    assert db_session_with_containers.get(ApiToken, token_id) is None
    assert (
        db_session_with_containers.scalar(
            select(func.count(DatasetApiTokenBinding.id)).where(DatasetApiTokenBinding.api_token_id == token_id)
        )
        == 0
    )
    assert evictions == [(raw_token, "dataset")]
