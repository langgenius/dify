"""Run Agent monitoring aggregation against the production PostgreSQL dialect."""

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models import Account, Tenant
from models.agent import Agent, AgentScope, AgentSource
from models.enums import ConversationFromSource
from models.model import App, AppMode
from repositories.agent_observability_repository import SQLAlchemyAgentObservabilityRepository
from services.agent.observability_contracts import AgentStatisticsQuery
from tests.helpers.unit.config_override import config_overrides_context
from tests.helpers.unit.model_factories import make_conversation, make_message


def test_statistics_aggregate_runs_in_postgres_with_account_timezone(db_session_with_containers: Session) -> None:
    session = db_session_with_containers
    account = Account(email=f"{uuid4()}@example.com", name="Agent owner", timezone="Asia/Shanghai")
    tenant = Tenant(name="Agent workspace")
    session.add_all([account, tenant])
    session.flush()
    app = App(
        tenant_id=tenant.id,
        name="Agent",
        mode=AppMode.AGENT,
        enable_site=False,
        enable_api=False,
        created_by=account.id,
        maintainer=account.id,
    )
    session.add(app)
    session.flush()
    agent = Agent(
        tenant_id=tenant.id,
        name="Agent",
        app_id=app.id,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        created_by=account.id,
    )
    session.add(agent)
    session.flush()
    conversation_id = str(uuid4())
    session.add(
        make_conversation(
            conversation_id=conversation_id,
            app_id=app.id,
            mode=AppMode.AGENT,
            inputs={},
            from_source=ConversationFromSource.CONSOLE,
        )
    )
    session.add(
        make_message(
            message_id=str(uuid4()),
            app_id=app.id,
            conversation_id=conversation_id,
            inputs={},
            query="hello",
            message={},
            answer="world",
            from_source=ConversationFromSource.CONSOLE,
            message_tokens=3,
            answer_tokens=4,
            created_at=datetime(2026, 1, 1, 20, tzinfo=UTC),
        )
    )
    session.commit()
    context = RequestContext("test", None, account.id, tenant.id)
    repository = SQLAlchemyAgentObservabilityRepository(session_factory=sessionmaker(bind=session.get_bind()))
    with config_overrides_context(DB_TYPE="postgresql"):
        result = repository.statistics(context, agent.id, AgentStatisticsQuery(source="webapp", start=None, end=None))
    summary = result["summary"]
    charts = result["charts"]
    assert isinstance(summary, dict)
    assert summary["total_messages"] == 1
    assert isinstance(charts, dict)
    assert charts["daily_messages"] == [{"date": "2026-01-02", "message_count": 1}]
