from __future__ import annotations

import pytest
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import KnowledgeFSControlSpace, KnowledgeFSControlSpaceState
from repositories.sqlalchemy_knowledge_fs_control_space_state_metrics import (
    SQLAlchemyKnowledgeFSControlSpaceStateCountReader,
)


@pytest.mark.parametrize("sqlite_session", [(KnowledgeFSControlSpace,)], indirect=True)
def test_state_count_reader_aggregates_only_operational_states(sqlite_session: Session) -> None:
    sqlite_session.add_all(
        [
            _control_space("provision-1", KnowledgeFSControlSpaceState.PROVISIONING),
            _control_space("provision-2", KnowledgeFSControlSpaceState.PROVISIONING),
            _control_space("provision-3", KnowledgeFSControlSpaceState.DELETING),
            _control_space("provision-4", KnowledgeFSControlSpaceState.ACTIVE),
        ]
    )
    sqlite_session.commit()
    reader = SQLAlchemyKnowledgeFSControlSpaceStateCountReader(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
    )

    assert reader() == {"deleting": 1, "error": 0, "provisioning": 2}


def _control_space(
    provisioning_key: str,
    state: KnowledgeFSControlSpaceState,
) -> KnowledgeFSControlSpace:
    return KnowledgeFSControlSpace(
        tenant_id=f"tenant-{provisioning_key}",
        owner_account_id=f"account-{provisioning_key}",
        provisioning_key=provisioning_key,
        knowledge_space_id=f"space-{provisioning_key}" if state is KnowledgeFSControlSpaceState.ACTIVE else None,
        state=state,
    )
