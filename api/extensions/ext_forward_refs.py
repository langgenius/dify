import logging

from dify_app import DifyApp


def is_enabled() -> bool:
    return True


def init_app(app: DifyApp):
    """Resolve Pydantic forward refs that would otherwise cause circular imports.

    Rebuilds models in core.app.entities.app_invoke_entities with the real TraceQueueManager type.
    Safe to run multiple times.
    """
    logger = logging.getLogger(__name__)
    try:
        from core.app.entities.app_invoke_entities import (
            AdvancedChatAppGenerateEntity,
            AgentChatAppGenerateEntity,
            AppGenerateEntity,
            ChatAppGenerateEntity,
            CompletionAppGenerateEntity,
            ConversationAppGenerateEntity,
            EasyUIBasedAppGenerateEntity,
            RagPipelineGenerateEntity,
            WorkflowAppGenerateEntity,
        )
        from core.ops.ops_trace_manager import TraceQueueManager  # heavy import, do it at startup only

        ns = {"TraceQueueManager": TraceQueueManager}
        for Model in (
            AppGenerateEntity,
            EasyUIBasedAppGenerateEntity,
            ConversationAppGenerateEntity,
            ChatAppGenerateEntity,
            CompletionAppGenerateEntity,
            AgentChatAppGenerateEntity,
            AdvancedChatAppGenerateEntity,
            WorkflowAppGenerateEntity,
            RagPipelineGenerateEntity,
        ):
            try:
                Model.model_rebuild(_types_namespace=ns)
            except Exception as e:
                logger.debug("model_rebuild skipped for %s: %s", Model.__name__, e)
    except Exception as e:
        # Don't block app startup; just log at debug level.
        logger.debug("ext_forward_refs init skipped: %s", e)
