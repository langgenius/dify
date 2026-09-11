"""Unit tests for dataset API key scoping helpers."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.dataset import Dataset
from models.enums import ApiTokenType
from models.model import ApiToken, DatasetApiTokenBinding
from services import dataset_api_key_service


def _dataset_token(session: Session) -> ApiToken:
    token = ApiToken(
        id=str(uuid.uuid4()),
        tenant_id=str(uuid.uuid4()),
        type=ApiTokenType.DATASET,
        token=f"dataset-{uuid.uuid4().hex}",
    )
    session.add(token)
    return token


class TestListKeysForDataset:
    def test_lists_unrestricted_and_bound_keys(self, sqlite_session: Session) -> None:
        dataset_id = str(uuid.uuid4())
        other_dataset_id = str(uuid.uuid4())
        tenant_id = str(uuid.uuid4())
        unrestricted = _dataset_token(sqlite_session)
        unrestricted.tenant_id = tenant_id
        bound = _dataset_token(sqlite_session)
        bound.tenant_id = tenant_id
        foreign = _dataset_token(sqlite_session)
        foreign.tenant_id = tenant_id
        sqlite_session.add(DatasetApiTokenBinding(api_token_id=bound.id, dataset_id=dataset_id))
        sqlite_session.add(DatasetApiTokenBinding(api_token_id=foreign.id, dataset_id=other_dataset_id))
        sqlite_session.commit()

        keys = dataset_api_key_service.list_keys_for_dataset(sqlite_session, tenant_id, dataset_id)

        assert {key.id for key in keys} == {unrestricted.id, bound.id}

    def test_create_key_for_dataset_persists_binding(self, sqlite_session: Session) -> None:
        tenant_id = str(uuid.uuid4())
        dataset_id = str(uuid.uuid4())
        dataset = Dataset(
            id=dataset_id,
            tenant_id=tenant_id,
            name="Dataset",
            data_source_type="upload_file",
            created_by=str(uuid.uuid4()),
            permission="only_me",
            provider="vendor",
        )
        sqlite_session.add(dataset)
        sqlite_session.commit()

        api_token = dataset_api_key_service.create_key_for_dataset(
            sqlite_session,
            tenant_id,
            dataset_id,
            token_prefix="ds-",
            max_keys=2,
        )
        sqlite_session.commit()

        assert api_token.token.startswith("ds-")
        assert dataset_api_key_service.get_bound_dataset_ids(sqlite_session, api_token.id) == {dataset_id}


class TestDeleteKeysScopedOnlyTo:
    def test_deletes_key_bound_only_to_the_dataset(self, sqlite_session: Session) -> None:
        dataset_id = str(uuid.uuid4())
        token = _dataset_token(sqlite_session)
        sqlite_session.add(DatasetApiTokenBinding(api_token_id=token.id, dataset_id=dataset_id))
        sqlite_session.commit()

        deleted = dataset_api_key_service.delete_keys_scoped_only_to(sqlite_session, dataset_id)
        sqlite_session.commit()

        assert deleted == [token.id]
        assert sqlite_session.scalar(select(ApiToken).where(ApiToken.id == token.id)) is None

    def test_keeps_key_bound_to_other_datasets(self, sqlite_session: Session) -> None:
        dataset_id = str(uuid.uuid4())
        other_dataset_id = str(uuid.uuid4())
        token = _dataset_token(sqlite_session)
        sqlite_session.add(DatasetApiTokenBinding(api_token_id=token.id, dataset_id=dataset_id))
        sqlite_session.add(DatasetApiTokenBinding(api_token_id=token.id, dataset_id=other_dataset_id))
        sqlite_session.commit()

        deleted = dataset_api_key_service.delete_keys_scoped_only_to(sqlite_session, dataset_id)
        sqlite_session.commit()

        # The key is bound elsewhere, so it survives and stays scoped.
        assert deleted == []
        assert sqlite_session.scalar(select(ApiToken).where(ApiToken.id == token.id)) is not None

    def test_ignores_unrestricted_keys(self, sqlite_session: Session) -> None:
        """A key with no bindings (access-all) must never be touched."""
        dataset_id = str(uuid.uuid4())
        unbound = _dataset_token(sqlite_session)
        sqlite_session.commit()

        deleted = dataset_api_key_service.delete_keys_scoped_only_to(sqlite_session, dataset_id)
        sqlite_session.commit()

        assert deleted == []
        assert sqlite_session.scalar(select(ApiToken).where(ApiToken.id == unbound.id)) is not None
