"""Bridge admitted apps and actors to the existing suggested-question runtime.

TODO: Remove this bridge when message configuration, history and model lookups
share a framework-neutral application boundary. Reuse their current policy here.
"""

from typing import override

from flask import current_app
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from models import Account, App
from models.model import EndUser
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.message_service import MessageService
from services.message_suggested_questions_service import (
    MessageSuggestedQuestions,
    SuggestedQuestionsAccount,
    SuggestedQuestionsActor,
    SuggestedQuestionsActorNotFoundError,
)


class MessageSuggestedQuestionsRuntime(MessageSuggestedQuestions):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory: sessionmaker[Session] = session_factory

    @override
    def get_suggested_questions(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        expected_app_mode: str,
        actor: SuggestedQuestionsActor,
        message_id: str,
    ) -> list[str]:
        with self._session_factory(expire_on_commit=False) as session:
            app_model = session.get(App, app_id)
            if app_model is None or app_model.tenant_id != app_owner_tenant_id:
                raise AppDefinitionUnavailableError(f"App {app_id} no longer exists in tenant {app_owner_tenant_id}")
            if app_model.mode != expected_app_mode:
                raise AppDefinitionUnavailableError(
                    f"App {app_id} mode changed from {expected_app_mode} to {app_model.mode} after admission"
                )

            user: Account | EndUser | None
            if isinstance(actor, SuggestedQuestionsAccount):
                user = session.get(Account, actor.account_id)
                if user is None:
                    raise SuggestedQuestionsActorNotFoundError(f"Account {actor.account_id} no longer exists")
            else:
                user = session.scalar(
                    select(EndUser).where(
                        EndUser.id == actor.end_user_id,
                        EndUser.app_id == app_id,
                        EndUser.tenant_id == app_owner_tenant_id,
                    )
                )
                if user is None:
                    raise SuggestedQuestionsActorNotFoundError(
                        f"End user {actor.end_user_id} does not exist for app {app_id} in tenant {app_owner_tenant_id}"
                    )

        # Legacy history/model lookups still use db.session internally. Give them
        # one scoped session, released on success or failure without removing the
        # caller's session. They may still hold it during provider I/O.
        with current_app.app_context():
            return MessageService.get_suggested_questions_after_answer(
                app_model=app_model,
                user=user,
                message_id=message_id,
                invoke_from=InvokeFrom(actor.invoke_from),
                session=db.session(),
            )
