"""Run suggested questions with bounded query and model-resolution sessions.

Keep legacy configuration, history and provider policy with their existing
owners. This bridge controls their lifetimes until those owners accept only
framework-neutral inputs; it never closes the caller's scoped session.
"""

from typing import override

from flask import current_app
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom, get_credit_usage_app_type
from core.llm_generator.llm_generator import LLMGenerator
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_context import use_credit_usage_metadata
from core.ops.utils import measure_time
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

            context = MessageService.prepare_suggested_questions_after_answer(
                app_model=app_model,
                user=user,
                message_id=message_id,
                invoke_from=InvokeFrom(actor.invoke_from),
                session=session,
            )
        if context is None:
            return []

        # Legacy model resolution, quota and tracing use db.session and may
        # commit. Own one isolated scope so none can commit or close the caller's
        # session. Release its sessions explicitly between phases; teardown also
        # handles early returns and exceptions.
        with current_app.app_context():
            history_model = MessageService.get_suggested_questions_history_model(tenant_id=context.tenant_id)
            db.session.remove()
            if history_model is None:
                return []

            # Resolve the history model first to preserve the no-model fallback
            # even when old history contains invalid file configuration.
            with self._session_factory(expire_on_commit=False) as session:
                history = TokenBufferMemory.load_history(
                    conversation=context.conversation,
                    app_record=app_model,
                    session=session,
                    message_limit=3,
                )

            histories = history.get_prompt_text(model_instance=history_model, max_token_limit=3000)

            with (
                measure_time() as timer,
                use_credit_usage_metadata({"app_type": get_credit_usage_app_type(context.app_mode)}),
            ):
                model = LLMGenerator.prepare_suggested_questions_model(
                    tenant_id=context.tenant_id, model_config=context.model_config
                )
                db.session.remove()
                questions = (
                    list(
                        LLMGenerator.invoke_suggested_questions_after_answer(
                            prepared_model=model,
                            histories=histories,
                            instruction_prompt=context.instruction_prompt,
                        )
                    )
                    if model is not None
                    else []
                )

            # Generation can return [] after catching an error. Tracing must not
            # inherit an open or failed transaction from that invocation.
            db.session.remove()
            MessageService.trace_suggested_questions(context=context, questions=questions, timer=timer)
            return questions
