import logging
import time
from collections.abc import Callable, Sequence
from contextlib import suppress
from dataclasses import dataclass, field
from typing import Any

import click
import sqlalchemy as sa
from celery import shared_task
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from constants.resource_access_token import ResourceAccessTokenResourceType
from core.db.session_factory import session_factory
from enums import DeploymentEdition
from extensions.application_services.resource_access_token import build_resource_access_token_cleanup_service
from extensions.ext_database import db
from libs.archive_storage import ArchiveStorageNotConfiguredError, get_archive_storage
from models import (
    ApiToken,
    AppAnnotationHitHistory,
    AppAnnotationSetting,
    AppDatasetJoin,
    AppMCPServer,
    AppModelConfig,
    AppStar,
    AppTrigger,
    Conversation,
    EndUser,
    InstalledApp,
    Message,
    MessageAgentThought,
    MessageAnnotation,
    MessageChain,
    MessageFeedback,
    MessageFile,
    RecommendedApp,
    Site,
    TagBinding,
    TraceAppConfig,
    UploadFile,
    WorkflowSchedulePlan,
)
from models.agent import WorkflowAgentNodeBinding
from models.tools import WorkflowToolProvider
from models.trigger import WorkflowPluginTrigger, WorkflowTriggerLog, WorkflowWebhookTrigger
from models.web import PinnedConversation, SavedMessage
from models.workflow import (
    ConversationVariable,
    Workflow,
    WorkflowAppLog,
    WorkflowArchiveLog,
    WorkflowDraftVariable,
    WorkflowDraftVariableFile,
)
from repositories.workflow.factory import WorkflowRepositoryFactory
from services.api_token_service import ApiTokenCache
from services.app_storage_cleanup_service import cleanup_app_storage, cleanup_app_uploads

logger = logging.getLogger(__name__)

NETWORK_ACCESS_BINDING_CLEANUP_DELAY_SECONDS = 10
NETWORK_ACCESS_BINDING_CLEANUP_RETRY_BASE_SECONDS = 15
NETWORK_ACCESS_BINDING_CLEANUP_RETRY_MAX_SECONDS = 10 * 60


def _network_access_binding_cleanup_retry_delay(retries: int) -> int:
    exponent = min(max(retries, 0), 6)
    return min(
        NETWORK_ACCESS_BINDING_CLEANUP_RETRY_BASE_SECONDS * (2**exponent),
        NETWORK_ACCESS_BINDING_CLEANUP_RETRY_MAX_SECONDS,
    )


@shared_task(queue="app_deletion", bind=True, max_retries=24)
def cleanup_app_network_access_group_binding_task(self, tenant_id: str, app_id: str) -> None:
    """Reliably remove a SaaS binding after its owning App was committed deleted."""

    if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
        return
    try:
        # Import lazily because AppService imports this task module while the
        # application-service composition root imports AppService dependencies.
        from extensions.ext_application_services import application_services

        application_services().network_access_groups.cleanup_app_binding(
            workspace_id=tenant_id,
            app_id=app_id,
        )
    except Exception as error:
        countdown = _network_access_binding_cleanup_retry_delay(self.request.retries)
        logger.exception(
            "Failed to clean up App network access group binding",
            extra={"tenant_id": tenant_id, "app_id": app_id, "retry_countdown": countdown},
        )
        raise self.retry(exc=error, countdown=countdown) from error


def _schedule_app_network_access_group_binding_cleanup(tenant_id: str, app_id: str) -> None:
    """Schedule only from App lifecycle cleanup, never account/member deletion."""

    if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
        return
    cleanup_app_network_access_group_binding_task.apply_async(
        kwargs={"tenant_id": tenant_id, "app_id": app_id},
        countdown=NETWORK_ACCESS_BINDING_CLEANUP_DELAY_SECONDS,
    )


_MAX_REPORTED_CLEANUP_FAILURES = 5


class AppCleanupIncompleteError(RuntimeError):
    """Some App-owned records or blobs could not be removed.

    Raised only after every independent record and step was still attempted, so
    the retrying task reports one summary instead of stopping at the first
    failure. ``failures`` keeps every individual description.
    """

    def __init__(self, failures: Sequence[str]) -> None:
        self.failures = tuple(failures)
        reported = "; ".join(self.failures[:_MAX_REPORTED_CLEANUP_FAILURES])
        remaining = len(self.failures) - _MAX_REPORTED_CLEANUP_FAILURES
        suffix = f"; and {remaining} more" if remaining > 0 else ""
        super().__init__(f"App cleanup incomplete ({len(self.failures)} failure(s)): {reported}{suffix}")


class _DraftVariableOffloadCleanupError(AppCleanupIncompleteError):
    """Blobs of the listed draft-variable offload files could not be deleted."""

    def __init__(self, failed_file_ids: Sequence[str], failures: Sequence[str], *, files_deleted: int) -> None:
        super().__init__(failures)
        self.failed_file_ids = tuple(failed_file_ids)
        self.files_deleted = files_deleted


def _failure_descriptions(name: str, error: Exception) -> tuple[str, ...]:
    """Flatten a step failure into the per-record descriptions it already collected."""

    if isinstance(error, AppCleanupIncompleteError):
        return error.failures
    return (f"{name}: {error}",)


@dataclass
class _AppCleanupRun:
    """Run App cleanup steps to the end while protecting retry evidence.

    Invariants:
    - A failing step never prevents an independent later step from running.
    - A step that deletes rows another step needs to rediscover storage objects
      runs only after that step succeeded in this attempt; otherwise it is
      skipped (not failed) and stays available to the next attempt.
    """

    tenant_id: str
    app_id: str
    failures: list[str] = field(default_factory=list)
    failed_steps: set[str] = field(default_factory=set)
    first_error: Exception | None = None

    def step(
        self,
        name: str,
        action: Callable[[], object],
        *,
        requires: tuple[str, ...] = (),
        requires_clean_run: bool = False,
    ) -> None:
        """Run ``action`` unless evidence it would delete is still needed.

        Postcondition: on failure the step name and its descriptions are
        recorded and the exception is not propagated.
        """
        blocked_by = (
            sorted(self.failed_steps) if requires_clean_run else sorted(self.failed_steps.intersection(requires))
        )
        if blocked_by:
            logger.warning(
                "Skipping app cleanup step %s for app %s: retry evidence is still required by failed step(s) %s",
                name,
                self.app_id,
                blocked_by,
            )
            return
        try:
            action()
        except Exception as error:
            logger.exception(
                "App cleanup step %s failed: tenant_id=%s app_id=%s; continuing with remaining steps",
                name,
                self.tenant_id,
                self.app_id,
            )
            self.failed_steps.add(name)
            self.failures.extend(_failure_descriptions(name, error))
            if self.first_error is None:
                self.first_error = error


@shared_task(queue="app_deletion", bind=True, max_retries=3)
def remove_app_and_related_data_task(self, tenant_id: str, app_id: str) -> None:
    """Delete everything an already-deleted App owned.

    Precondition: the App row is committed deleted, so no later request can
    reach rows this task leaves behind.
    Postconditions: every cleanup step whose retry evidence is intact was
    attempted, even after earlier records or steps failed. On any failure the
    task retries with one ``AppCleanupIncompleteError`` summarizing all of
    them; redelivery is idempotent because each step re-reads what remains.
    Evidence rules: rows that locate App-owned storage objects (runs, node
    executions, workflows, conversations, messages) are kept while the storage
    step is failing, and EndUser rows are removed only by a fully clean run.
    """
    logger.info(click.style(f"Start deleting app and related data: {tenant_id}:{app_id}", fg="green"))
    start_at = time.perf_counter()
    run = _AppCleanupRun(tenant_id=tenant_id, app_id=app_id)
    storage_evidence = ("app storage",)
    run.step(
        "network access group binding",
        lambda: _schedule_app_network_access_group_binding_cleanup(tenant_id, app_id),
    )
    run.step("app storage", lambda: cleanup_app_storage(tenant_id, app_id))
    # Delete related data
    run.step("evaluation data", lambda: _delete_app_evaluation_data(tenant_id, app_id))
    run.step("app model configs", lambda: _delete_app_model_configs(tenant_id, app_id))
    run.step("site", lambda: _delete_app_site(tenant_id, app_id))
    run.step("mcp servers", lambda: _delete_app_mcp_servers(tenant_id, app_id))
    run.step("api tokens", lambda: _delete_app_api_tokens(tenant_id, app_id))
    run.step(
        "resource access token relations",
        lambda: _delete_app_resource_access_token_relations(tenant_id, app_id),
    )
    run.step("installed apps", lambda: _delete_installed_apps(tenant_id, app_id))
    run.step("app stars", lambda: _delete_app_stars(tenant_id, app_id))
    run.step("recommended apps", lambda: _delete_recommended_apps(tenant_id, app_id))
    run.step("annotation data", lambda: _delete_app_annotation_data(tenant_id, app_id))
    run.step("dataset joins", lambda: _delete_app_dataset_joins(tenant_id, app_id))
    run.step("workflow agent node bindings", lambda: _delete_workflow_agent_node_bindings(tenant_id, app_id))
    run.step("workflows", lambda: _delete_app_workflows(tenant_id, app_id), requires=storage_evidence)
    run.step(
        "workflow node executions",
        lambda: _delete_app_workflow_node_executions(tenant_id, app_id),
        requires=storage_evidence,
    )
    run.step("workflow runs", lambda: _delete_app_workflow_runs(tenant_id, app_id), requires=storage_evidence)
    run.step("workflow app logs", lambda: _delete_app_workflow_app_logs(tenant_id, app_id))
    if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and dify_config.ARCHIVE_STORAGE_ENABLED:
        run.step("workflow archive logs", lambda: _delete_app_workflow_archive_logs(tenant_id, app_id))
        run.step("archived workflow run files", lambda: _delete_archived_workflow_run_files(tenant_id, app_id))
    run.step("conversations", lambda: _delete_app_conversations(tenant_id, app_id), requires=storage_evidence)
    run.step("messages", lambda: _delete_app_messages(tenant_id, app_id), requires=storage_evidence)
    run.step("workflow tool providers", lambda: _delete_workflow_tool_providers(tenant_id, app_id))
    run.step("tag bindings", lambda: _delete_app_tag_bindings(tenant_id, app_id))
    run.step("trace app configs", lambda: _delete_trace_app_configs(tenant_id, app_id))
    run.step("conversation variables", lambda: _delete_conversation_variables(app_id=app_id))
    run.step("draft variables", lambda: _delete_draft_variables(app_id))
    run.step("app triggers", lambda: _delete_app_triggers(tenant_id, app_id))
    run.step("workflow plugin triggers", lambda: _delete_workflow_plugin_triggers(tenant_id, app_id))
    run.step("workflow webhook triggers", lambda: _delete_workflow_webhook_triggers(tenant_id, app_id))
    run.step("workflow schedule plans", lambda: _delete_workflow_schedule_plans(tenant_id, app_id))
    run.step("workflow trigger logs", lambda: _delete_workflow_trigger_logs(tenant_id, app_id))
    run.step("app uploads", lambda: cleanup_app_uploads(tenant_id, app_id))
    # EndUser rows are the last evidence that rediscovers App-owned uploads and
    # tool files; an incomplete attempt must leave them for its retry.
    run.step("end users", lambda: _delete_end_users(tenant_id, app_id), requires_clean_run=True)
    if run.failures:
        error = AppCleanupIncompleteError(run.failures)
        error.__cause__ = run.first_error
        logger.error(
            click.style(f"Error occurred while deleting app {app_id} and related data: {error}", fg="red"),
        )
        raise self.retry(exc=error, countdown=60)
    end_at = time.perf_counter()
    logger.info(click.style(f"App and related data deleted: {app_id} latency: {end_at - start_at}", fg="green"))


def _delete_app_evaluation_data(tenant_id: str, app_id: str) -> None:
    from models.evaluation import EvaluationTargetType
    from services.evaluation_service import EvaluationService

    with session_factory.create_session() as session:
        EvaluationService.stage_target_evaluation_cleanup(
            session=session,
            tenant_id=tenant_id,
            target_type=EvaluationTargetType.APPS.value,
            target_id=app_id,
        )
        session.commit()


def _delete_app_model_configs(tenant_id: str, app_id: str):
    def del_model_config(session: Session, model_config_id: str):
        session.execute(
            delete(AppModelConfig)
            .where(AppModelConfig.id == model_config_id)
            .execution_options(synchronize_session=False)
        )

    _delete_records(
        """select id from app_model_configs where app_id=:app_id limit 1000""",
        {"app_id": app_id},
        del_model_config,
        "app model config",
    )


def _delete_app_site(tenant_id: str, app_id: str):
    def del_site(session: Session, site_id: str):
        site = session.get(Site, site_id)
        if site is not None:
            session.delete(site)

    _delete_records(
        """select id from sites where app_id=:app_id limit 1000""",
        {"app_id": app_id},
        del_site,
        "site",
    )


def _delete_app_mcp_servers(tenant_id: str, app_id: str):
    def del_mcp_server(session: Session, mcp_server_id: str):
        session.execute(
            delete(AppMCPServer).where(AppMCPServer.id == mcp_server_id).execution_options(synchronize_session=False)
        )

    _delete_records(
        """select id from app_mcp_servers where app_id=:app_id limit 1000""",
        {"app_id": app_id},
        del_mcp_server,
        "app mcp server",
    )


def _delete_app_api_tokens(tenant_id: str, app_id: str):
    def del_api_token(session: Session, api_token_id: str):
        # Fetch token details for cache invalidation
        token_obj = session.scalar(select(ApiToken).where(ApiToken.id == api_token_id).limit(1))
        if token_obj:
            # Invalidate cache before deletion
            ApiTokenCache.delete(token_obj.token, token_obj.type)

        session.execute(
            delete(ApiToken).where(ApiToken.id == api_token_id).execution_options(synchronize_session=False)
        )

    _delete_records(
        """select id from api_tokens where app_id=:app_id limit 1000""",
        {"app_id": app_id},
        del_api_token,
        "api token",
    )


def _delete_app_resource_access_token_relations(tenant_id: str, app_id: str):
    with session_factory.get_session_maker()() as session:
        build_resource_access_token_cleanup_service(session=session).delete_resource_relations(
            tenant_id=tenant_id, resource_type=ResourceAccessTokenResourceType.APP, resource_id=app_id
        )
        session.commit()


def _delete_installed_apps(tenant_id: str, app_id: str):
    def del_installed_app(session: Session, installed_app_id: str):
        session.execute(
            delete(InstalledApp).where(InstalledApp.id == installed_app_id).execution_options(synchronize_session=False)
        )

    _delete_records(
        """select id from installed_apps where tenant_id=:tenant_id and app_id=:app_id limit 1000""",
        {"tenant_id": tenant_id, "app_id": app_id},
        del_installed_app,
        "installed app",
    )


def _delete_app_stars(tenant_id: str, app_id: str):
    def del_app_star(session, app_star_id: str):
        session.execute(delete(AppStar).where(AppStar.id == app_star_id).execution_options(synchronize_session=False))

    _delete_records(
        """select id from app_stars where tenant_id=:tenant_id and app_id=:app_id limit 1000""",
        {"tenant_id": tenant_id, "app_id": app_id},
        del_app_star,
        "app star",
    )


def _delete_recommended_apps(tenant_id: str, app_id: str):
    def del_recommended_app(session: Session, recommended_app_id: str):
        session.execute(
            delete(RecommendedApp)
            .where(RecommendedApp.id == recommended_app_id)
            .execution_options(synchronize_session=False)
        )

    _delete_records(
        """select id from recommended_apps where app_id=:app_id limit 1000""",
        {"app_id": app_id},
        del_recommended_app,
        "recommended app",
    )


def _delete_app_annotation_data(tenant_id: str, app_id: str):
    def del_annotation_hit_history(session: Session, annotation_hit_history_id: str):
        session.execute(
            delete(AppAnnotationHitHistory)
            .where(AppAnnotationHitHistory.id == annotation_hit_history_id)
            .execution_options(synchronize_session=False)
        )

    _delete_records(
        """select id from app_annotation_hit_histories where app_id=:app_id limit 1000""",
        {"app_id": app_id},
        del_annotation_hit_history,
        "annotation hit history",
    )

    def del_annotation_setting(session: Session, annotation_setting_id: str):
        session.execute(
            delete(AppAnnotationSetting)
            .where(AppAnnotationSetting.id == annotation_setting_id)
            .execution_options(synchronize_session=False)
        )

    _delete_records(
        """select id from app_annotation_settings where app_id=:app_id limit 1000""",
        {"app_id": app_id},
        del_annotation_setting,
        "annotation setting",
    )


def _delete_app_dataset_joins(tenant_id: str, app_id: str):
    def del_dataset_join(session: Session, dataset_join_id: str):
        session.execute(
            delete(AppDatasetJoin)
            .where(AppDatasetJoin.id == dataset_join_id)
            .execution_options(synchronize_session=False)
        )

    _delete_records(
        """select id from app_dataset_joins where app_id=:app_id limit 1000""",
        {"app_id": app_id},
        del_dataset_join,
        "dataset join",
    )


def _delete_app_workflows(tenant_id: str, app_id: str):
    def del_workflow(session: Session, workflow_id: str):
        session.execute(delete(Workflow).where(Workflow.id == workflow_id).execution_options(synchronize_session=False))

    _delete_records(
        """select id from workflows where tenant_id=:tenant_id and app_id=:app_id limit 1000""",
        {"tenant_id": tenant_id, "app_id": app_id},
        del_workflow,
        "workflow",
    )


def _delete_workflow_agent_node_bindings(tenant_id: str, app_id: str) -> None:
    with session_factory.create_session() as session:
        session.execute(
            delete(WorkflowAgentNodeBinding).where(
                WorkflowAgentNodeBinding.tenant_id == tenant_id,
                WorkflowAgentNodeBinding.app_id == app_id,
            )
        )
        session.commit()


def _delete_app_workflow_runs(tenant_id: str, app_id: str):
    """Delete all workflow runs for an app using the service repository."""
    session_maker = sessionmaker(bind=db.engine)
    workflow_run_repo = WorkflowRepositoryFactory.create_api_workflow_run_repository(session_maker)

    deleted_count = workflow_run_repo.delete_runs_by_app(
        tenant_id=tenant_id,
        app_id=app_id,
        batch_size=1000,
    )

    logger.info("Deleted %s workflow runs for app %s", deleted_count, app_id)


def _delete_app_workflow_node_executions(tenant_id: str, app_id: str):
    """Delete all workflow node executions for an app using the service repository."""
    session_maker = sessionmaker(bind=db.engine)
    node_execution_repo = WorkflowRepositoryFactory.create_api_workflow_node_execution_repository(session_maker)

    deleted_count = node_execution_repo.delete_executions_by_app(
        tenant_id=tenant_id,
        app_id=app_id,
        batch_size=1000,
    )

    logger.info("Deleted %s workflow node executions for app %s", deleted_count, app_id)


def _delete_app_workflow_app_logs(tenant_id: str, app_id: str):
    def del_workflow_app_log(session: Session, workflow_app_log_id: str):
        session.execute(
            delete(WorkflowAppLog)
            .where(WorkflowAppLog.id == workflow_app_log_id)
            .execution_options(synchronize_session=False)
        )

    _delete_records(
        """select id from workflow_app_logs where tenant_id=:tenant_id and app_id=:app_id limit 1000""",
        {"tenant_id": tenant_id, "app_id": app_id},
        del_workflow_app_log,
        "workflow app log",
    )


def _delete_app_workflow_archive_logs(tenant_id: str, app_id: str):
    def del_workflow_archive_log(session: Session, workflow_archive_log_id: str):
        session.execute(
            delete(WorkflowArchiveLog)
            .where(WorkflowArchiveLog.id == workflow_archive_log_id)
            .execution_options(synchronize_session=False)
        )

    _delete_records(
        """select id from workflow_archive_logs where tenant_id=:tenant_id and app_id=:app_id limit 1000""",
        {"tenant_id": tenant_id, "app_id": app_id},
        del_workflow_archive_log,
        "workflow archive log",
    )


def _delete_archived_workflow_run_files(tenant_id: str, app_id: str):
    prefix = f"{tenant_id}/app_id={app_id}/"
    try:
        archive_storage = get_archive_storage()
    except ArchiveStorageNotConfiguredError:
        logger.exception("Archive storage not configured for archive file cleanup")
        raise

    try:
        keys = archive_storage.list_objects(prefix)
    except Exception:
        logger.exception("Failed to list archive files for app %s", app_id)
        raise

    deleted = 0
    failures: list[str] = []
    for key in keys:
        try:
            with suppress(FileNotFoundError):
                archive_storage.delete_object(key)
            deleted += 1
        except Exception as error:
            # Keep deleting the remaining objects; the task reports every failed key at the end.
            logger.exception("Failed to delete archive object %s", key)
            failures.append(f"archive object {key}: {error}")

    logger.info("Deleted %s archive objects for app %s", deleted, app_id)
    if failures:
        raise AppCleanupIncompleteError(failures)


def _delete_app_conversations(tenant_id: str, app_id: str):
    def del_conversation(session: Session, conversation_id: str):
        session.execute(
            delete(PinnedConversation)
            .where(PinnedConversation.conversation_id == conversation_id)
            .execution_options(synchronize_session=False)
        )
        session.execute(
            delete(Conversation).where(Conversation.id == conversation_id).execution_options(synchronize_session=False)
        )

    _delete_records(
        """select id from conversations where app_id=:app_id limit 1000""",
        {"app_id": app_id},
        del_conversation,
        "conversation",
    )


def _delete_conversation_variables(*, app_id: str):
    with session_factory.create_session() as session:
        stmt = delete(ConversationVariable).where(ConversationVariable.app_id == app_id)
        session.execute(stmt)
        session.commit()
        logger.info(click.style(f"Deleted conversation variables for app {app_id}", fg="green"))


def _delete_app_messages(tenant_id: str, app_id: str):
    def del_message(session: Session, message_id: str):
        session.execute(
            delete(MessageFeedback)
            .where(MessageFeedback.message_id == message_id)
            .execution_options(synchronize_session=False)
        )
        session.execute(
            delete(MessageAnnotation)
            .where(MessageAnnotation.message_id == message_id)
            .execution_options(synchronize_session=False)
        )
        session.execute(
            delete(MessageChain)
            .where(MessageChain.message_id == message_id)
            .execution_options(synchronize_session=False)
        )
        session.execute(
            delete(MessageAgentThought)
            .where(MessageAgentThought.message_id == message_id)
            .execution_options(synchronize_session=False)
        )
        session.execute(
            delete(MessageFile).where(MessageFile.message_id == message_id).execution_options(synchronize_session=False)
        )
        session.execute(
            delete(SavedMessage)
            .where(SavedMessage.message_id == message_id)
            .execution_options(synchronize_session=False)
        )
        session.execute(delete(Message).where(Message.id == message_id).execution_options(synchronize_session=False))

    _delete_records(
        """select id from messages where app_id=:app_id limit 1000""",
        {"app_id": app_id},
        del_message,
        "message",
    )


def _delete_workflow_tool_providers(tenant_id: str, app_id: str):
    def del_tool_provider(session: Session, tool_provider_id: str):
        session.execute(
            delete(WorkflowToolProvider)
            .where(WorkflowToolProvider.id == tool_provider_id)
            .execution_options(synchronize_session=False)
        )

    _delete_records(
        """select id from tool_workflow_providers where tenant_id=:tenant_id and app_id=:app_id limit 1000""",
        {"tenant_id": tenant_id, "app_id": app_id},
        del_tool_provider,
        "tool workflow provider",
    )


def _delete_app_tag_bindings(tenant_id: str, app_id: str):
    def del_tag_binding(session: Session, tag_binding_id: str):
        session.execute(
            delete(TagBinding).where(TagBinding.id == tag_binding_id).execution_options(synchronize_session=False)
        )

    _delete_records(
        """select id from tag_bindings where tenant_id=:tenant_id and target_id=:app_id limit 1000""",
        {"tenant_id": tenant_id, "app_id": app_id},
        del_tag_binding,
        "tag binding",
    )


def _delete_end_users(tenant_id: str, app_id: str):
    def del_end_user(session: Session, end_user_id: str):
        session.execute(delete(EndUser).where(EndUser.id == end_user_id).execution_options(synchronize_session=False))

    _delete_records(
        """select id from end_users where tenant_id=:tenant_id and app_id=:app_id limit 1000""",
        {"tenant_id": tenant_id, "app_id": app_id},
        del_end_user,
        "end user",
    )


def _delete_trace_app_configs(tenant_id: str, app_id: str):
    def del_trace_app_config(session: Session, trace_app_config_id: str):
        session.execute(
            delete(TraceAppConfig)
            .where(TraceAppConfig.id == trace_app_config_id)
            .execution_options(synchronize_session=False)
        )

    _delete_records(
        """select id from trace_app_config where app_id=:app_id limit 1000""",
        {"app_id": app_id},
        del_trace_app_config,
        "trace app config",
    )


def _delete_draft_variables(app_id: str):
    """Delete all workflow draft variables for an app in batches."""
    return delete_draft_variables_batch(app_id, batch_size=1000)


def delete_draft_variables_batch(app_id: str, batch_size: int = 1000) -> int:
    """
    Delete draft variables for an app in batches.

    This function now handles cleanup of associated Offload data including:
    - WorkflowDraftVariableFile records
    - UploadFile records
    - Object storage files

    Args:
        app_id: The ID of the app whose draft variables should be deleted
        batch_size: Number of records to delete per batch

    Returns:
        Total number of records deleted
    """
    if batch_size <= 0:
        raise ValueError("batch_size must be positive")

    total_deleted = 0
    total_files_deleted = 0
    failures: list[str] = []
    # Keyset pagination: variables retained as evidence for a failed blob must
    # not be selected again by the next batch of this same call.
    after_id: str | None = None
    has_more = True

    while has_more:
        # Read the batch in a transaction of its own: the offload cleanup in between
        # must run with no transaction open.
        with session_factory.create_session() as session:
            query = select(WorkflowDraftVariable.id, WorkflowDraftVariable.file_id).where(
                WorkflowDraftVariable.app_id == app_id
            )
            if after_id is not None:
                query = query.where(WorkflowDraftVariable.id > after_id)
            rows = session.execute(query.order_by(WorkflowDraftVariable.id).limit(batch_size)).all()

        has_more = bool(rows)
        if has_more:
            after_id = rows[-1][0]
            file_ids = [row[1] for row in rows if row[1] is not None]
            failed_file_ids: frozenset[str] = frozenset()

            # Clean up associated Offload data first, outside any transaction, so the rows
            # remain visible if the storage cleanup has to be retried.
            if file_ids:
                try:
                    total_files_deleted += _delete_draft_variable_offload_data(file_ids)
                except _DraftVariableOffloadCleanupError as error:
                    total_files_deleted += error.files_deleted
                    failed_file_ids = frozenset(error.failed_file_ids)
                    failures.extend(error.failures)

            # Variables whose blob could not be deleted stay as retry evidence.
            draft_var_ids = [row[0] for row in rows if row[1] is None or row[1] not in failed_file_ids]

            # Delete the draft variables
            if draft_var_ids:
                with session_factory.create_session() as session, session.begin():
                    deleted_result = session.execute(
                        delete(WorkflowDraftVariable).where(
                            WorkflowDraftVariable.app_id == app_id,
                            WorkflowDraftVariable.id.in_(draft_var_ids),
                        )
                    )
                    batch_deleted: int = int(getattr(deleted_result, "rowcount", 0) or 0)
                    total_deleted += batch_deleted

                    logger.info(
                        click.style(f"Deleted {batch_deleted} draft variables (batch) for app {app_id}", fg="green")
                    )

    logger.info(
        click.style(
            f"Deleted {total_deleted} total draft variables for app {app_id}. "
            f"Cleaned up {total_files_deleted} total associated files.",
            fg="green",
        )
    )
    if failures:
        raise AppCleanupIncompleteError(failures)
    return total_deleted


def _delete_draft_variable_offload_data(file_ids: list[str]) -> int:
    """Delete exclusively owned draft-variable offload files and their metadata.

    ``DraftVariableSaver`` creates a fresh UploadFile for every offload record;
    no production path attaches those uploads to another owner. Keep both rows
    as durable storage-key evidence until every blob delete succeeds. If the
    database commit then fails, the retry treats an already-missing blob as
    success and repeats the metadata deletion.

    A blob that cannot be deleted does not stop the batch: every other blob is
    still deleted together with its metadata, the failing record keeps both of
    its rows as evidence, and ``_DraftVariableOffloadCleanupError`` reports the
    failed variable-file ids once the rest is committed.
    """

    unique_file_ids = tuple(dict.fromkeys(file_id for file_id in file_ids if file_id))
    if not unique_file_ids:
        return 0
    from extensions.ext_storage import storage

    with session_factory.create_session() as session:
        records = session.execute(
            select(
                WorkflowDraftVariableFile.id.label("variable_file_id"),
                WorkflowDraftVariableFile.upload_file_id,
                UploadFile.key,
            )
            .join(
                UploadFile,
                (UploadFile.id == WorkflowDraftVariableFile.upload_file_id)
                & (UploadFile.tenant_id == WorkflowDraftVariableFile.tenant_id),
            )
            .where(WorkflowDraftVariableFile.id.in_(unique_file_ids))
            .order_by(WorkflowDraftVariableFile.id)
        ).all()

    failed_file_ids: list[str] = []
    failures: list[str] = []
    for record in records:
        try:
            with suppress(FileNotFoundError):
                storage.delete(record.key)
        except Exception as error:
            logger.exception(
                "Failed to delete draft variable offload blob: variable_file_id=%s upload_file_id=%s",
                record.variable_file_id,
                record.upload_file_id,
            )
            failed_file_ids.append(record.variable_file_id)
            failures.append(f"draft variable offload file {record.variable_file_id}: {error}")

    failed = frozenset(failed_file_ids)
    cleaned_records = [record for record in records if record.variable_file_id not in failed]
    cleaned_file_ids = [file_id for file_id in unique_file_ids if file_id not in failed]
    with session_factory.create_session() as session, session.begin():
        upload_file_ids = tuple(dict.fromkeys(record.upload_file_id for record in cleaned_records))
        if upload_file_ids:
            session.execute(delete(UploadFile).where(UploadFile.id.in_(upload_file_ids)))
        if cleaned_file_ids:
            session.execute(delete(WorkflowDraftVariableFile).where(WorkflowDraftVariableFile.id.in_(cleaned_file_ids)))

    if failures:
        raise _DraftVariableOffloadCleanupError(failed_file_ids, failures, files_deleted=len(cleaned_records))
    return len(records)


def _delete_app_triggers(tenant_id: str, app_id: str):
    def del_app_trigger(session: Session, trigger_id: str):
        session.execute(
            delete(AppTrigger).where(AppTrigger.id == trigger_id).execution_options(synchronize_session=False)
        )

    _delete_records(
        """select id from app_triggers where tenant_id=:tenant_id and app_id=:app_id limit 1000""",
        {"tenant_id": tenant_id, "app_id": app_id},
        del_app_trigger,
        "app trigger",
    )


def _delete_workflow_plugin_triggers(tenant_id: str, app_id: str):
    def del_plugin_trigger(session: Session, trigger_id: str):
        session.execute(
            delete(WorkflowPluginTrigger)
            .where(WorkflowPluginTrigger.id == trigger_id)
            .execution_options(synchronize_session=False)
        )

    _delete_records(
        """select id from workflow_plugin_triggers where tenant_id=:tenant_id and app_id=:app_id limit 1000""",
        {"tenant_id": tenant_id, "app_id": app_id},
        del_plugin_trigger,
        "workflow plugin trigger",
    )


def _delete_workflow_webhook_triggers(tenant_id: str, app_id: str):
    def del_webhook_trigger(session: Session, trigger_id: str):
        session.execute(
            delete(WorkflowWebhookTrigger)
            .where(WorkflowWebhookTrigger.id == trigger_id)
            .execution_options(synchronize_session=False)
        )

    _delete_records(
        """select id from workflow_webhook_triggers where tenant_id=:tenant_id and app_id=:app_id limit 1000""",
        {"tenant_id": tenant_id, "app_id": app_id},
        del_webhook_trigger,
        "workflow webhook trigger",
    )


def _delete_workflow_schedule_plans(tenant_id: str, app_id: str):
    def del_schedule_plan(session: Session, plan_id: str):
        session.execute(
            delete(WorkflowSchedulePlan)
            .where(WorkflowSchedulePlan.id == plan_id)
            .execution_options(synchronize_session=False)
        )

    _delete_records(
        """select id from workflow_schedule_plans where tenant_id=:tenant_id and app_id=:app_id limit 1000""",
        {"tenant_id": tenant_id, "app_id": app_id},
        del_schedule_plan,
        "workflow schedule plan",
    )


def _delete_workflow_trigger_logs(tenant_id: str, app_id: str):
    def del_trigger_log(session: Session, log_id: str):
        session.execute(
            delete(WorkflowTriggerLog)
            .where(WorkflowTriggerLog.id == log_id)
            .execution_options(synchronize_session=False)
        )

    _delete_records(
        """select id from workflow_trigger_logs where tenant_id=:tenant_id and app_id=:app_id limit 1000""",
        {"tenant_id": tenant_id, "app_id": app_id},
        del_trigger_log,
        "workflow trigger log",
    )


def _delete_records(
    query_sql: str, params: dict[str, Any], delete_func: Callable[[Session, str], None], name: str
) -> None:
    """Commit each deletion, skip failing records, and report them once at the end.

    Postconditions: every selected record that can be deleted is committed
    deleted. A record whose deletion fails is rolled back, remembered, and not
    attempted again in this call, so re-selecting it cannot loop forever; the
    loop stops as soon as a pass deletes nothing. If any record failed,
    ``AppCleanupIncompleteError`` lists them so the retrying task never marks
    an incomplete App cleanup completed. A later attempt reads only the
    remaining records.
    """
    failed: dict[str, str] = {}
    progressed = True
    while progressed:
        progressed = False
        with session_factory.create_session() as session:
            rs = session.execute(sa.text(query_sql), params)
            rows = rs.fetchall()
            rs.close()

            for i in rows:
                record_id = str(i.id)
                if record_id not in failed:
                    try:
                        delete_func(session, record_id)
                        session.commit()
                        progressed = True
                        logger.info(click.style(f"Deleted {name} {record_id}", fg="green"))
                    except Exception as error:
                        logger.exception("Error occurred while deleting %s %s", name, record_id)
                        # continue with next record even if one deletion fails
                        session.rollback()
                        failed[record_id] = str(error)
    if failed:
        raise AppCleanupIncompleteError([f"{name} {record_id}: {error}" for record_id, error in failed.items()])
