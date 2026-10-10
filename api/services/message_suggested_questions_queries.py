"""Select message configuration using the existing Agent and Workflow policy owners.

Each operation owns a short read session. Only scalar configuration or detached
history leaves this module; model resolution and attachment I/O happen afterwards.
"""

from collections.abc import Callable, Mapping
from copy import deepcopy
from types import MappingProxyType

from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.features.suggested_questions_after_answer.manager import (
    SuggestedQuestionsAfterAnswerConfigManager,
)
from core.app.apps.agent_app.app_feature_projection import merge_agent_app_features
from core.memory.token_buffer_memory import PreparedHistory
from models import AppMode
from models.agent_config_entities import AgentSoulConfig
from models.model import AppModelConfig, load_annotation_reply_config
from repositories.message_repository import MessageRepository, SuggestedQuestionsRecords
from services.agent.runtime_config_service import AgentRuntimeConfigService
from services.entities.message_entities import MessageAccount, MessageActor
from services.message_suggested_questions_service import (
    SuggestedQuestionsContext,
    SuggestedQuestionsInvokeFrom,
)
from services.workflow_service import WorkflowService


class SuggestedQuestionsQuery:
    """Coordinate repository reads with the existing ORM-based config readers.

    This query owns each short session because AgentRuntimeConfigService,
    WorkflowService and conversation config helpers still need a caller session.
    The composition root supplies repository_factory to select the repository;
    it borrows that same session rather than opening another one.

    TODO: Move session ownership into repositories once those config readers
    expose detached results, keeping their configuration policies in services.
    """

    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        repository_factory: Callable[[Session], MessageRepository],
    ) -> None:
        self._session_factory: sessionmaker[Session] = session_factory
        self._repository_factory: Callable[[Session], MessageRepository] = repository_factory

    def prepare(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        expected_app_mode: str,
        actor: MessageActor,
        invoke_from: SuggestedQuestionsInvokeFrom,
        message_id: str,
    ) -> SuggestedQuestionsContext | None:
        with self._session_factory(expire_on_commit=False) as session:
            repository = self._repository_factory(session)
            records = repository.get_context(
                app_id=app_id,
                app_owner_tenant_id=app_owner_tenant_id,
                expected_app_mode=expected_app_mode,
                actor=actor,
                message_id=message_id,
            )
            config = self._configuration(
                session=session, repository=repository, records=records, actor=actor, invoke_from=invoke_from
            )
            if config is None:
                return None
            return SuggestedQuestionsContext(
                app_id=app_id,
                tenant_id=app_owner_tenant_id,
                app_mode=records.app.mode,
                message_id=message_id,
                conversation_id=records.conversation.id,
                actor=actor,
                invoke_from=invoke_from,
                config=MappingProxyType(deepcopy(dict(config))),
            )

    @staticmethod
    def _configuration(
        *,
        session: Session,
        repository: MessageRepository,
        records: SuggestedQuestionsRecords,
        actor: MessageActor,
        invoke_from: SuggestedQuestionsInvokeFrom,
    ) -> Mapping[str, object] | None:
        app, conversation = records
        if app.mode == AppMode.ADVANCED_CHAT:
            workflows = WorkflowService()
            workflow = (
                workflows.get_draft_workflow(app_model=app, session=session)
                if invoke_from == "debugger"
                else workflows.get_published_workflow(app_model=app, session=session)
            )
            if workflow is None:
                return None
            # features_dict mutates the workflow during compatibility normalization.
            # This is a query: use the same normalization without rewriting stored JSON.
            features = workflow.normalized_features_dict
            config = features.get("suggested_questions_after_answer")
            return {
                **(config if isinstance(config, dict) else {}),
                "enabled": SuggestedQuestionsAfterAnswerConfigManager.convert(features),
            }

        if app.mode == AppMode.AGENT:
            soul = AgentRuntimeConfigService(session).resolve_conversation_soul(
                app_model=app,
                conversation=conversation,
                account_id=actor.account_id if isinstance(actor, MessageAccount) else None,
                use_debug_draft=invoke_from == "debugger",
            )
            model_config = repository.get_model_config(app_id=app.id, config_id=app.app_model_config_id)
            annotation_reply = load_annotation_reply_config(session, app.id) if model_config else None
            features = merge_agent_app_features(
                agent_soul=soul or AgentSoulConfig(),
                app_model_config=model_config,
                annotation_reply=annotation_reply,
            )
            config = features.get("suggested_questions_after_answer")
            return config if isinstance(config, dict) else {}

        if conversation.override_model_configs:
            model_config = AppModelConfig(app_id=app.id).from_model_config_dict(
                conversation.model_config_with_session(session=session)
            )
        else:
            model_config = repository.get_model_config(app_id=app.id, config_id=conversation.app_model_config_id)
        if model_config is None:
            raise ValueError("did not find app model config")
        return model_config.suggested_questions_after_answer_dict

    def load_history(self, context: SuggestedQuestionsContext) -> PreparedHistory:
        with self._session_factory(expire_on_commit=False) as session:
            return self._repository_factory(session).load_history(context=context)
