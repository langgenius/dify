"""Real Chatflow conversations and selection services with scripted Providers."""

from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from context.connection_execution import ConnectionExecutionContext
from core.app.entities.app_invoke_entities import InvokeFrom
from models.enums import ConversationFromSource
from models.model import App, AppMode, Conversation, EndUser
from models.workflow import Workflow
from services.end_user_connection_execution_adapters import prepare_web_connection_execution
from services.end_user_connection_preflight_adapters import PublishedPreflightRequirements
from services.end_user_connections.conversation import ConversationConnectionService
from services.end_user_connections.execution import ConnectionExecutionService
from services.end_user_connections.preflight import ConnectionPreflightService
from tests.helpers.end_user_oauth import OAuthHarness


@dataclass
class ConversationHarness:
    oauth: OAuthHarness
    service: ConversationConnectionService
    execution: ConnectionExecutionService
    sessions: sessionmaker[Session]

    def create_conversation(self) -> str:
        identity = self.oauth.base.context
        with self.sessions.begin() as session:
            row = Conversation(
                app_id=identity.app_id,
                mode=AppMode.ADVANCED_CHAT,
                name="Chat",
                from_source=ConversationFromSource.API,
                from_end_user_id=identity.end_user_id,
                from_account_id=None,
                invoke_from=InvokeFrom.WEB_APP,
                _inputs={},
                is_deleted=False,
            )
            session.add(row)
            session.flush()
            return row.id

    def run(
        self, conversation_id: str | None, connections: dict[str, str | None] | None = None
    ) -> ConnectionExecutionContext:
        base = self.oauth.base
        with self.sessions() as session:
            app = session.get(App, base.context.app_id)
            user = session.get(EndUser, base.context.end_user_id)
            workflow = session.get(Workflow, base.workflow_id)
            assert app is not None
            assert user is not None
            assert workflow is not None
        args: dict[str, Any] = {"workflow_id": base.workflow_id}
        if conversation_id is not None:
            args["conversation_id"] = conversation_id
        if connections is not None:
            args["connections"] = connections
        result = prepare_web_connection_execution(app=app, user=user, workflow=workflow, args=args)
        assert result is not None
        return result

    def saved(self, conversation_id: str) -> dict[str, str]:
        base = self.oauth.base
        return {
            node: str(value)
            for node, value in self.service.restore(base.context, base.workflow_id, conversation_id).items()
        }


def make_conversation_harness(oauth: OAuthHarness) -> ConversationHarness:
    with oauth.base.sessions.begin() as session:
        session.execute(sa.update(App).where(App.id == oauth.base.context.app_id).values(mode=AppMode.ADVANCED_CHAT))
    requirements = PublishedPreflightRequirements(
        workflows=oauth.base.repository, providers=oauth.providers, oauth=oauth.gateway
    )
    return ConversationHarness(
        oauth=oauth,
        service=ConversationConnectionService(store=oauth.base.repository),
        execution=ConnectionExecutionService(
            preflight=ConnectionPreflightService(
                connections=oauth.base.repository, checks=oauth.base.service, requirements=requirements
            )
        ),
        sessions=oauth.base.sessions,
    )
