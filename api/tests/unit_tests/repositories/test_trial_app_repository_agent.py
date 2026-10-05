from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from models.agent import Agent, AgentConfigRevision, AgentConfigRevisionOperation, AgentConfigSnapshot
from models.model import App, AppMode, TrialApp
from repositories.trial_app_repository import TrialAppRepository


@pytest.mark.parametrize(
    ("operation", "include_snapshot", "expected"),
    [
        (AgentConfigRevisionOperation.PUBLISH_DRAFT, True, True),
        (AgentConfigRevisionOperation.IMPORT_PACKAGE, True, False),
        (AgentConfigRevisionOperation.PUBLISH_DRAFT, False, False),
    ],
    ids=["published-with-dirty-draft", "unpublished-seed", "missing-snapshot"],
)
def test_agent_trial_requires_a_visible_existing_snapshot(
    sqlite_session_factory: sessionmaker[Session],
    operation: AgentConfigRevisionOperation,
    include_snapshot: bool,
    expected: bool,
) -> None:
    app_id, tenant_id, agent_id, snapshot_id = (str(uuid4()) for _ in range(4))
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                App(
                    id=app_id,
                    tenant_id=tenant_id,
                    name="Trial Agent",
                    mode=AppMode.AGENT,
                    enable_site=True,
                    enable_api=False,
                ),
                TrialApp(app_id=app_id, tenant_id=tenant_id),
                Agent(
                    id=agent_id,
                    tenant_id=tenant_id,
                    app_id=app_id,
                    name="Agent",
                    scope="roster",
                    source="agent_app",
                    active_config_snapshot_id=snapshot_id,
                    active_config_is_published=False,
                ),
                AgentConfigRevision(
                    tenant_id=tenant_id,
                    agent_id=agent_id,
                    current_snapshot_id=snapshot_id,
                    revision=1,
                    operation=operation,
                ),
            ]
        )
        if include_snapshot:
            session.add(
                AgentConfigSnapshot(
                    id=snapshot_id, tenant_id=tenant_id, agent_id=agent_id, version=1, config_snapshot={}
                )
            )

    result = TrialAppRepository(sqlite_session_factory).existing_ids([app_id])
    assert result == (frozenset({app_id}) if expected else frozenset())
