"""Concurrent resource deletion must never turn a scoped key into a workspace key."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import uuid4

import pytest
from sqlalchemy import event, text
from sqlalchemy.orm import Session, sessionmaker

from models.account import Tenant
from models.enums import ApiTokenBindingResourceType, ApiTokenType
from models.knowledge_fs import KnowledgeFSControlSpace, KnowledgeFSControlSpaceState
from models.model import ApiToken, DatasetApiTokenBinding
from repositories.knowledge import dataset_api_key_bindings


def test_concurrent_space_deletions_revoke_the_last_scoped_key(db_session_with_containers: Session) -> None:
    session = db_session_with_containers
    tenant_id, owner_id = str(uuid4()), str(uuid4())
    session.add(Tenant(id=tenant_id, name="KnowledgeFS key deletion test"))
    session.flush()
    spaces = [
        KnowledgeFSControlSpace(
            tenant_id=tenant_id,
            owner_account_id=owner_id,
            provisioning_key=str(uuid4()),
            knowledge_space_id=str(uuid4()),
            state=KnowledgeFSControlSpaceState.ACTIVE,
        )
        for _ in range(2)
    ]
    token = ApiToken(tenant_id=tenant_id, type=ApiTokenType.DATASET, token=f"dataset-{uuid4().hex}")
    session.add_all([*spaces, token])
    session.flush()
    token_id = token.id
    first_id, second_id = (space.id for space in spaces)
    session.add_all(
        DatasetApiTokenBinding(
            api_token_id=token_id,
            resource_type=ApiTokenBindingResourceType.KNOWLEDGE_FS_SPACE,
            control_space_id=space.id,
        )
        for space in spaces
    )
    session.commit()
    sessions = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    snapshot_read, first_binding_removed, second_delete_started = Event(), Event(), Event()

    def delete_second_space() -> None:
        with sessions.begin() as concurrent:
            concurrent.execute(text("SET LOCAL lock_timeout = '5s'"))
            scope = dataset_api_key_bindings.get_active_key_scope(
                concurrent, api_token_id=token_id, tenant_id=tenant_id
            )
            assert scope is not None
            assert scope.knowledge_space_ids == {first_id, second_id}
            snapshot_read.set()
            assert first_binding_removed.wait(timeout=5)

            def deleting(
                _connection: object,
                _cursor: object,
                _statement: object,
                _parameters: object,
                _context: object,
                _executemany: object,
            ) -> None:
                second_delete_started.set()

            connection = concurrent.connection()
            event.listen(connection, "before_cursor_execute", deleting, once=True)
            dataset_api_key_bindings.delete_keys_scoped_only_to_knowledge_space(concurrent, second_id)

    with ThreadPoolExecutor(max_workers=1) as executor:
        second = executor.submit(delete_second_space)
        try:
            assert snapshot_read.wait(timeout=5)
            with sessions.begin() as first:
                dataset_api_key_bindings.delete_keys_scoped_only_to_knowledge_space(first, first_id)
                first_binding_removed.set()
                assert second_delete_started.wait(timeout=5)
                # The second deletion must wait for the first transaction's key lock.
                # Without it, both transactions retain the key and remove its last bindings.
                with pytest.raises(TimeoutError):
                    second.result(timeout=0.5)
            second.result(timeout=5)
        finally:
            first_binding_removed.set()

    with sessions() as check:
        assert dataset_api_key_bindings.get_active_key_scope(check, api_token_id=token_id, tenant_id=tenant_id) is None
