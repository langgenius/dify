"""Unit tests for dataset API key scoping helpers."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.enums import ApiTokenBindingResourceType, ApiTokenType
from models.knowledge_fs import KnowledgeFSControlSpace, KnowledgeFSControlSpaceState
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


def _control_space(
    session: Session,
    tenant_id: str,
    *,
    state: KnowledgeFSControlSpaceState = KnowledgeFSControlSpaceState.ACTIVE,
) -> KnowledgeFSControlSpace:
    space = KnowledgeFSControlSpace(
        tenant_id=tenant_id,
        owner_account_id=str(uuid.uuid4()),
        provisioning_key=str(uuid.uuid4()),
        knowledge_space_id=str(uuid.uuid4()),
        knowledge_space_revision=1,
        state=state,
    )
    session.add(space)
    return space


def _space_binding(api_token_id: str, control_space_id: str) -> DatasetApiTokenBinding:
    return DatasetApiTokenBinding(
        api_token_id=api_token_id,
        resource_type=ApiTokenBindingResourceType.KNOWLEDGE_FS_SPACE,
        control_space_id=control_space_id,
    )


class TestGetKeyScope:
    def test_unbound_key_is_unrestricted(self, sqlite_session: Session) -> None:
        token = _dataset_token(sqlite_session)
        sqlite_session.commit()

        scope = dataset_api_key_service.get_key_scope(sqlite_session, token.id)

        assert not scope.restricted
        assert scope.allows_dataset(str(uuid.uuid4()))
        assert scope.allows_dataset(None)
        assert scope.allows_knowledge_space(str(uuid.uuid4()))

    def test_dataset_binding_only_grants_that_dataset(self, sqlite_session: Session) -> None:
        dataset_id = str(uuid.uuid4())
        token = _dataset_token(sqlite_session)
        sqlite_session.add(DatasetApiTokenBinding(api_token_id=token.id, dataset_id=dataset_id))
        sqlite_session.commit()

        scope = dataset_api_key_service.get_key_scope(sqlite_session, token.id)

        assert scope.restricted
        assert scope.dataset_ids == {dataset_id}
        assert scope.allows_dataset(dataset_id)
        assert not scope.allows_dataset(str(uuid.uuid4()))
        assert not scope.allows_dataset(None)
        # A legacy binding never opens KnowledgeFS spaces: the two live in different tables.
        assert not scope.allows_knowledge_space(str(uuid.uuid4()))

    def test_knowledge_space_binding_only_grants_that_space(self, sqlite_session: Session) -> None:
        space_id = str(uuid.uuid4())
        token = _dataset_token(sqlite_session)
        sqlite_session.add(_space_binding(token.id, space_id))
        sqlite_session.commit()

        scope = dataset_api_key_service.get_key_scope(sqlite_session, token.id)

        assert scope.restricted
        assert scope.knowledge_space_ids == {space_id}
        assert scope.allows_knowledge_space(space_id)
        assert not scope.allows_knowledge_space(str(uuid.uuid4()))
        # Restricted to KnowledgeFS only: legacy dataset endpoints must reject the key.
        assert not scope.allows_dataset(str(uuid.uuid4()))

    def test_other_keys_bindings_are_ignored(self, sqlite_session: Session) -> None:
        token = _dataset_token(sqlite_session)
        other = _dataset_token(sqlite_session)
        sqlite_session.add(_space_binding(other.id, str(uuid.uuid4())))
        sqlite_session.commit()

        assert not dataset_api_key_service.get_key_scope(sqlite_session, token.id).restricted

    def test_bound_dataset_ids_helper_only_reports_legacy_bindings(self, sqlite_session: Session) -> None:
        dataset_id = str(uuid.uuid4())
        token = _dataset_token(sqlite_session)
        sqlite_session.add(DatasetApiTokenBinding(api_token_id=token.id, dataset_id=dataset_id))
        sqlite_session.add(_space_binding(token.id, str(uuid.uuid4())))
        sqlite_session.commit()

        assert dataset_api_key_service.get_bound_dataset_ids(sqlite_session, token.id) == {dataset_id}


class TestListBindingsByToken:
    def test_groups_each_kind_separately(self, sqlite_session: Session) -> None:
        dataset_id = str(uuid.uuid4())
        space_id = str(uuid.uuid4())
        token = _dataset_token(sqlite_session)
        unbound = _dataset_token(sqlite_session)
        sqlite_session.add(DatasetApiTokenBinding(api_token_id=token.id, dataset_id=dataset_id))
        sqlite_session.add(_space_binding(token.id, space_id))
        sqlite_session.commit()

        bindings = dataset_api_key_service.list_bindings_by_token(sqlite_session, [token.id, unbound.id])

        assert set(bindings) == {token.id}
        assert bindings[token.id].dataset_ids == [dataset_id]
        assert bindings[token.id].knowledge_space_ids == [space_id]

    def test_empty_input(self, sqlite_session: Session) -> None:
        assert dataset_api_key_service.list_bindings_by_token(sqlite_session, []) == {}


class TestFindUnknownKnowledgeSpaceIds:
    def test_accepts_active_spaces_of_the_tenant_only(self, sqlite_session: Session) -> None:
        tenant_id = str(uuid.uuid4())
        own = _control_space(sqlite_session, tenant_id)
        foreign = _control_space(sqlite_session, str(uuid.uuid4()))
        deleted = _control_space(sqlite_session, tenant_id, state=KnowledgeFSControlSpaceState.DELETED)
        deleting = _control_space(sqlite_session, tenant_id, state=KnowledgeFSControlSpaceState.DELETING)
        sqlite_session.commit()
        missing = str(uuid.uuid4())

        unknown = dataset_api_key_service.find_unknown_knowledge_space_ids(
            sqlite_session, [missing, own.id, foreign.id, deleted.id, deleting.id], tenant_id
        )

        # Order is preserved so the console can echo the offending ids back verbatim.
        assert unknown == [missing, foreign.id, deleted.id, deleting.id]

    def test_empty_input(self, sqlite_session: Session) -> None:
        assert dataset_api_key_service.find_unknown_knowledge_space_ids(sqlite_session, [], "tenant") == []


class TestBindKnowledgeSpaces:
    def test_persists_typed_rows(self, sqlite_session: Session) -> None:
        space_id = str(uuid.uuid4())
        token = _dataset_token(sqlite_session)
        sqlite_session.flush()

        dataset_api_key_service.bind_knowledge_spaces(sqlite_session, token.id, [space_id])
        sqlite_session.commit()

        row = sqlite_session.scalar(
            select(DatasetApiTokenBinding).where(DatasetApiTokenBinding.api_token_id == token.id)
        )
        assert row is not None
        assert row.resource_type is ApiTokenBindingResourceType.KNOWLEDGE_FS_SPACE
        assert row.control_space_id == space_id
        assert row.dataset_id is None


class TestDeleteKeysScopedOnlyTo:
    def test_keeps_key_also_bound_to_a_knowledge_space(self, sqlite_session: Session) -> None:
        """A KnowledgeFS binding (NULL dataset_id) must count as "bound elsewhere"."""
        dataset_id = str(uuid.uuid4())
        token = _dataset_token(sqlite_session)
        sqlite_session.add(DatasetApiTokenBinding(api_token_id=token.id, dataset_id=dataset_id))
        sqlite_session.add(_space_binding(token.id, str(uuid.uuid4())))
        sqlite_session.commit()

        deleted = dataset_api_key_service.delete_keys_scoped_only_to(sqlite_session, dataset_id)
        sqlite_session.commit()

        assert deleted == []
        assert sqlite_session.scalar(select(ApiToken).where(ApiToken.id == token.id)) is not None

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


class TestDeleteKeysScopedOnlyToKnowledgeSpace:
    def test_deletes_key_bound_only_to_the_space(self, sqlite_session: Session) -> None:
        space_id = str(uuid.uuid4())
        token = _dataset_token(sqlite_session)
        sqlite_session.add(_space_binding(token.id, space_id))
        sqlite_session.commit()

        deleted = dataset_api_key_service.delete_keys_scoped_only_to_knowledge_space(sqlite_session, space_id)
        sqlite_session.commit()

        assert deleted == [token.id]
        assert sqlite_session.scalar(select(ApiToken).where(ApiToken.id == token.id)) is None
        assert (
            sqlite_session.scalar(
                select(DatasetApiTokenBinding).where(DatasetApiTokenBinding.control_space_id == space_id)
            )
            is None
        )

    def test_keeps_key_bound_elsewhere_but_drops_the_space_binding(self, sqlite_session: Session) -> None:
        space_id = str(uuid.uuid4())
        dataset_id = str(uuid.uuid4())
        token = _dataset_token(sqlite_session)
        sqlite_session.add(_space_binding(token.id, space_id))
        sqlite_session.add(DatasetApiTokenBinding(api_token_id=token.id, dataset_id=dataset_id))
        sqlite_session.commit()

        deleted = dataset_api_key_service.delete_keys_scoped_only_to_knowledge_space(sqlite_session, space_id)
        sqlite_session.commit()

        assert deleted == []
        assert sqlite_session.scalar(select(ApiToken).where(ApiToken.id == token.id)) is not None
        # The soft-deleted space no longer counts toward the key's scope; the dataset binding stays.
        assert dataset_api_key_service.get_key_scope(sqlite_session, token.id).knowledge_space_ids == frozenset()
        assert dataset_api_key_service.get_key_scope(sqlite_session, token.id).dataset_ids == {dataset_id}

    def test_ignores_unrestricted_keys(self, sqlite_session: Session) -> None:
        unbound = _dataset_token(sqlite_session)
        sqlite_session.commit()

        deleted = dataset_api_key_service.delete_keys_scoped_only_to_knowledge_space(sqlite_session, str(uuid.uuid4()))
        sqlite_session.commit()

        assert deleted == []
        assert sqlite_session.scalar(select(ApiToken).where(ApiToken.id == unbound.id)) is not None
