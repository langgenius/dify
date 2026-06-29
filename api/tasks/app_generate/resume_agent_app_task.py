"""Background resume of an Agent v2 chat after a submitted ask_human HITL form.

ENG-635. When a human submits a conversation-owned ask_human form (delivered via
email/webapp), ``HumanInputService`` enqueues this task. It reconstructs the
conversation context and runs one blocking Agent App turn; the runner detects the
answered form and continues the agent run with the human's reply
(``deferred_tool_results``), persisting the assistant answer to the conversation.
"""

from __future__ import annotations

import logging

from celery import shared_task

from core.app.apps.agent_app.app_generator import AgentAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from models.account import Account
from models.human_input import HumanInputForm
from models.model import App, Conversation, EndUser
from tasks.app_generate.workflow_execute_task import WORKFLOW_BASED_APP_EXECUTION_QUEUE

logger = logging.getLogger(__name__)


@shared_task(queue=WORKFLOW_BASED_APP_EXECUTION_QUEUE, name="resume_agent_app_execution")
def resume_agent_app_execution(*, conversation_id: str, form_id: str) -> None:
    form = db.session.get(HumanInputForm, form_id)
    if form is None or form.conversation_id != conversation_id:
        logger.warning("Agent App resume: form %s missing or conversation mismatch", form_id)
        return

    app_model = db.session.get(App, form.app_id)
    if app_model is None:
        logger.warning("Agent App resume: app %s not found for form %s", form.app_id, form_id)
        return

    conversation = db.session.get(Conversation, conversation_id)
    if conversation is None:
        logger.warning("Agent App resume: conversation %s not found", conversation_id)
        return

    user = _resolve_conversation_user(app_model=app_model, conversation=conversation)
    if user is None:
        logger.warning("Agent App resume: no user resolvable for conversation %s", conversation_id)
        return

    try:
        AgentAppGenerator().resume_after_form_submission(
            app_model=app_model,
            user=user,
            conversation_id=conversation_id,
            invoke_from=_resolve_invoke_from(conversation),
        )
    except Exception:
        logger.exception("Agent App resume failed for conversation %s form %s", conversation_id, form_id)
    finally:
        db.session.close()


def _resolve_conversation_user(*, app_model: App, conversation: Conversation) -> Account | EndUser | None:
    if conversation.from_account_id:
        account = db.session.get(Account, conversation.from_account_id)
        if account is not None:
            account.set_tenant_id(app_model.tenant_id)
        return account
    if conversation.from_end_user_id:
        return db.session.get(EndUser, conversation.from_end_user_id)
    return None


def _resolve_invoke_from(conversation: Conversation) -> InvokeFrom:
    if conversation.invoke_from is None:
        return InvokeFrom.WEB_APP
    return InvokeFrom.value_of(conversation.invoke_from.value)
