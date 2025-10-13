import logging
import time
from collections.abc import Callable

import click
import sqlalchemy as sa
from celery import shared_task
from sqlalchemy import delete
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from extensions.ext_database import db
from models import (
    ApiToken,
    AppAnnotationHitHistory,
    AppAnnotationSetting,
    AppDatasetJoin,
    AppMCPServer,
    AppModelConfig,
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
)
from models.tools import WorkflowToolProvider
from models.web import PinnedConversation, SavedMessage
from models.workflow import (
    ConversationVariable,
    Workflow,
    WorkflowAppLog,
)
from repositories.factory import DifyAPIRepositoryFactory

logger = logging.getLogger(__name__)


@shared_task(queue="app_deletion", bind=True, max_retries=3)
def remove_app_and_related_data_task(self, tenant_id: str, app_id: str):
    logger.info(click.style(f"Start deleting app and related data: {tenant_id}:{app_id}", fg="green"))
    start_at = time.perf_counter()
    try:
        # Delete related data
        _delete_app_model_configs(tenant_id, app_id)
        _delete_app_site(tenant_id, app_id)
        _delete_app_mcp_servers(tenant_id, app_id)
        _delete_app_api_tokens(tenant_id, app_id)
        _delete_installed_apps(tenant_id, app_id)
        _delete_recommended_apps(tenant_id, app_id)
        _delete_app_annotation_data(tenant_id, app_id)
        _delete_app_dataset_joins(tenant_id, app_id)
        _delete_app_workflows(tenant_id, app_id)
        _delete_app_workflow_runs(tenant_id, app_id)
        _delete_app_workflow_node_executions(tenant_id, app_id)
        _delete_app_workflow_app_logs(tenant_id, app_id)
        _delete_app_conversations(tenant_id, app_id)
        _delete_app_messages(tenant_id, app_id)
        _delete_workflow_tool_providers(tenant_id, app_id)
        _delete_app_tag_bindings(tenant_id, app_id)
        _delete_end_users(tenant_id, app_id)
        _delete_trace_app_configs(tenant_id, app_id)
        _delete_conversation_variables(app_id=app_id)
        _delete_draft_variables(app_id)

        end_at = time.perf_counter()
        logger.info(click.style(f"App and related data deleted: {app_id} latency: {end_at - start_at}", fg="green"))
    except SQLAlchemyError as e:
        logger.exception(click.style(f"Database error occurred while deleting app {app_id} and related data", fg="red"))
        raise self.retry(exc=e, countdown=60)  # Retry after 60 seconds
    except Exception as e:
        logger.exception(click.style(f"Error occurred while deleting app {app_id} and related data", fg="red"))
        raise self.retry(exc=e, countdown=60)  # Retry after 60 seconds


def _delete_app_model_configs(tenant_id: str, app_id: str):
    def del_model_config(model_config_id: str):
        db.session.query(AppModelConfig).where(AppModelConfig.id == model_config_id).delete(synchronize_session=False)

    _delete_records(
        """select id from app_model_configs where app_id=:app_id limit 1000""",
        {"app_id": app_id},
        del_model_config,
        "app model config",
    )


def _delete_app_site(tenant_id: str, app_id: str):
    def del_site(site_id: str):
        db.session.query(Site).where(Site.id == site_id).delete(synchronize_session=False)

    _delete_records(
        """select id from sites where app_id=:app_id limit 1000""",
        {"app_id": app_id},
        del_site,
        "site",
    )


def _delete_app_mcp_servers(tenant_id: str, app_id: str):
    def del_mcp_server(mcp_server_id: str):
        db.session.query(AppMCPServer).where(AppMCPServer.id == mcp_server_id).delete(synchronize_session=False)

    _delete_records(
        """select id from app_mcp_servers where app_id=:app_id limit 1000""",
        {"app_id": app_id},
        del_mcp_server,
        "app mcp server",
    )


def _delete_app_api_tokens(tenant_id: str, app_id: str):
    def del_api_token(api_token_id: str):
        db.session.query(ApiToken).where(ApiToken.id == api_token_id).delete(synchronize_session=False)

    _delete_records(
        """select id from api_tokens where app_id=:app_id limit 1000""",
        {"app_id": app_id},
        del_api_token,
        "api token",
    )


def _delete_installed_apps(tenant_id: str, app_id: str):
    def del_installed_app(installed_app_id: str):
        db.session.query(InstalledApp).where(InstalledApp.id == installed_app_id).delete(synchronize_session=False)

    _delete_records(
        """select id from installed_apps where tenant_id=:tenant_id and app_id=:app_id limit 1000""",
        {"tenant_id": tenant_id, "app_id": app_id},
        del_installed_app,
        "installed app",
    )


def _delete_recommended_apps(tenant_id: str, app_id: str):
    def del_recommended_app(recommended_app_id: str):
        db.session.query(RecommendedApp).where(RecommendedApp.id == recommended_app_id).delete(
            synchronize_session=False
        )

    _delete_records(
        """select id from recommended_apps where app_id=:app_id limit 1000""",
        {"app_id": app_id},
        del_recommended_app,
        "recommended app",
    )


def _delete_app_annotation_data(tenant_id: str, app_id: str):
    def del_annotation_hit_history(annotation_hit_history_id: str):
        db.session.query(AppAnnotationHitHistory).where(AppAnnotationHitHistory.id == annotation_hit_history_id).delete(
            synchronize_session=False
        )

    _delete_records(
        """select id from app_annotation_hit_histories where app_id=:app_id limit 1000""",
        {"app_id": app_id},
        del_annotation_hit_history,
        "annotation hit history",
    )

    def del_annotation_setting(annotation_setting_id: str):
        db.session.query(AppAnnotationSetting).where(AppAnnotationSetting.id == annotation_setting_id).delete(
            synchronize_session=False
        )

    _delete_records(
        """select id from app_annotation_settings where app_id=:app_id limit 1000""",
        {"app_id": app_id},
        del_annotation_setting,
        "annotation setting",
    )


def _delete_app_dataset_joins(tenant_id: str, app_id: str):
    def del_dataset_join(dataset_join_id: str):
        db.session.query(AppDatasetJoin).where(AppDatasetJoin.id == dataset_join_id).delete(synchronize_session=False)

    _delete_records(
        """select id from app_dataset_joins where app_id=:app_id limit 1000""",
        {"app_id": app_id},
        del_dataset_join,
        "dataset join",
    )


def _delete_app_workflows(tenant_id: str, app_id: str):
    def del_workflow(workflow_id: str):
        db.session.query(Workflow).where(Workflow.id == workflow_id).delete(synchronize_session=False)

    _delete_records(
        """select id from workflows where tenant_id=:tenant_id and app_id=:app_id limit 1000""",
        {"tenant_id": tenant_id, "app_id": app_id},
        del_workflow,
        "workflow",
    )


def _delete_app_workflow_runs(tenant_id: str, app_id: str):
    """Delete all workflow runs for an app using the service repository."""
    session_maker = sessionmaker(bind=db.engine)
    workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)

    deleted_count = workflow_run_repo.delete_runs_by_app(
        tenant_id=tenant_id,
        app_id=app_id,
        batch_size=1000,
    )

    logger.info("Deleted %s workflow runs for app %s", deleted_count, app_id)


def _delete_app_workflow_node_executions(tenant_id: str, app_id: str):
    """Delete all workflow node executions for an app using the service repository."""
    session_maker = sessionmaker(bind=db.engine)
    node_execution_repo = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(session_maker)

    deleted_count = node_execution_repo.delete_executions_by_app(
        tenant_id=tenant_id,
        app_id=app_id,
        batch_size=1000,
    )

    logger.info("Deleted %s workflow node executions for app %s", deleted_count, app_id)


def _delete_app_workflow_app_logs(tenant_id: str, app_id: str):
    def del_workflow_app_log(workflow_app_log_id: str):
        db.session.query(WorkflowAppLog).where(WorkflowAppLog.id == workflow_app_log_id).delete(
            synchronize_session=False
        )

    _delete_records(
        """select id from workflow_app_logs where tenant_id=:tenant_id and app_id=:app_id limit 1000""",
        {"tenant_id": tenant_id, "app_id": app_id},
        del_workflow_app_log,
        "workflow app log",
    )


def _delete_app_conversations(tenant_id: str, app_id: str):
    def del_conversation(conversation_id: str):
        db.session.query(PinnedConversation).where(PinnedConversation.conversation_id == conversation_id).delete(
            synchronize_session=False
        )
        db.session.query(Conversation).where(Conversation.id == conversation_id).delete(synchronize_session=False)

    _delete_records(
        """select id from conversations where app_id=:app_id limit 1000""",
        {"app_id": app_id},
        del_conversation,
        "conversation",
    )


def _delete_conversation_variables(*, app_id: str):
    stmt = delete(ConversationVariable).where(ConversationVariable.app_id == app_id)
    with db.engine.connect() as conn:
        conn.execute(stmt)
        conn.commit()
        logger.info(click.style(f"Deleted conversation variables for app {app_id}", fg="green"))


def _delete_app_messages(tenant_id: str, app_id: str):
    def del_message(message_id: str):
        db.session.query(MessageFeedback).where(MessageFeedback.message_id == message_id).delete(
            synchronize_session=False
        )
        db.session.query(MessageAnnotation).where(MessageAnnotation.message_id == message_id).delete(
            synchronize_session=False
        )
        db.session.query(MessageChain).where(MessageChain.message_id == message_id).delete(synchronize_session=False)
        db.session.query(MessageAgentThought).where(MessageAgentThought.message_id == message_id).delete(
            synchronize_session=False
        )
        db.session.query(MessageFile).where(MessageFile.message_id == message_id).delete(synchronize_session=False)
        db.session.query(SavedMessage).where(SavedMessage.message_id == message_id).delete(synchronize_session=False)
        db.session.query(Message).where(Message.id == message_id).delete()

    _delete_records(
        """select id from messages where app_id=:app_id limit 1000""",
        {"app_id": app_id},
        del_message,
        "message",
    )


def _delete_workflow_tool_providers(tenant_id: str, app_id: str):
    def del_tool_provider(tool_provider_id: str):
        db.session.query(WorkflowToolProvider).where(WorkflowToolProvider.id == tool_provider_id).delete(
            synchronize_session=False
        )

    _delete_records(
        """select id from tool_workflow_providers where tenant_id=:tenant_id and app_id=:app_id limit 1000""",
        {"tenant_id": tenant_id, "app_id": app_id},
        del_tool_provider,
        "tool workflow provider",
    )


def _delete_app_tag_bindings(tenant_id: str, app_id: str):
    def del_tag_binding(tag_binding_id: str):
        db.session.query(TagBinding).where(TagBinding.id == tag_binding_id).delete(synchronize_session=False)

    _delete_records(
        """select id from tag_bindings where tenant_id=:tenant_id and target_id=:app_id limit 1000""",
        {"tenant_id": tenant_id, "app_id": app_id},
        del_tag_binding,
        "tag binding",
    )


def _delete_end_users(tenant_id: str, app_id: str):
    def del_end_user(end_user_id: str):
        db.session.query(EndUser).where(EndUser.id == end_user_id).delete(synchronize_session=False)

    _delete_records(
        """select id from end_users where tenant_id=:tenant_id and app_id=:app_id limit 1000""",
        {"tenant_id": tenant_id, "app_id": app_id},
        del_end_user,
        "end user",
    )


def _delete_trace_app_configs(tenant_id: str, app_id: str):
    def del_trace_app_config(trace_app_config_id: str):
        db.session.query(TraceAppConfig).where(TraceAppConfig.id == trace_app_config_id).delete(
            synchronize_session=False
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

    while True:
        with db.engine.begin() as conn:
            # Get a batch of draft variable IDs along with their file_ids
            query_sql = """
                SELECT id, file_id FROM workflow_draft_variables
                WHERE app_id = :app_id
                LIMIT :batch_size
            """
            result = conn.execute(sa.text(query_sql), {"app_id": app_id, "batch_size": batch_size})

            rows = list(result)
            if not rows:
                break

            draft_var_ids = [row[0] for row in rows]
            file_ids = [row[1] for row in rows if row[1] is not None]

            # Clean up associated Offload data first
            if file_ids:
                files_deleted = _delete_draft_variable_offload_data(conn, file_ids)
                total_files_deleted += files_deleted

            # Delete the draft variables
            delete_sql = """
                DELETE FROM workflow_draft_variables
                WHERE id IN :ids
            """
            deleted_result = conn.execute(sa.text(delete_sql), {"ids": tuple(draft_var_ids)})
            batch_deleted = deleted_result.rowcount
            total_deleted += batch_deleted

            logger.info(click.style(f"Deleted {batch_deleted} draft variables (batch) for app {app_id}", fg="green"))

    logger.info(
        click.style(
            f"Deleted {total_deleted} total draft variables for app {app_id}. "
            f"Cleaned up {total_files_deleted} total associated files.",
            fg="green",
        )
    )
    return total_deleted


def _delete_draft_variable_offload_data(conn, file_ids: list[str]) -> int:
    """
    Delete Offload data associated with WorkflowDraftVariable file_ids.

    This function:
    1. Finds WorkflowDraftVariableFile records by file_ids
    2. Deletes associated files from object storage
    3. Deletes UploadFile records
    4. Deletes WorkflowDraftVariableFile records

    Args:
        conn: Database connection
        file_ids: List of WorkflowDraftVariableFile IDs

    Returns:
        Number of files cleaned up
    """
    from extensions.ext_storage import storage

    if not file_ids:
        return 0

    files_deleted = 0

    try:
        # Get WorkflowDraftVariableFile records and their associated UploadFile keys
        query_sql = """
            SELECT wdvf.id, uf.key, uf.id as upload_file_id
            FROM workflow_draft_variable_files wdvf
            JOIN upload_files uf ON wdvf.upload_file_id = uf.id
            WHERE wdvf.id IN :file_ids
        """
        result = conn.execute(sa.text(query_sql), {"file_ids": tuple(file_ids)})
        file_records = list(result)

        # Delete from object storage and collect upload file IDs
        upload_file_ids = []
        for _, storage_key, upload_file_id in file_records:
            try:
                storage.delete(storage_key)
                upload_file_ids.append(upload_file_id)
                files_deleted += 1
            except Exception:
                logging.exception("Failed to delete storage object %s", storage_key)
                # Continue with database cleanup even if storage deletion fails
                upload_file_ids.append(upload_file_id)

        # Delete UploadFile records
        if upload_file_ids:
            delete_upload_files_sql = """
                DELETE FROM upload_files
                WHERE id IN :upload_file_ids
            """
            conn.execute(sa.text(delete_upload_files_sql), {"upload_file_ids": tuple(upload_file_ids)})

        # Delete WorkflowDraftVariableFile records
        delete_variable_files_sql = """
            DELETE FROM workflow_draft_variable_files
            WHERE id IN :file_ids
        """
        conn.execute(sa.text(delete_variable_files_sql), {"file_ids": tuple(file_ids)})

    except Exception:
        logging.exception("Error deleting draft variable offload data:")
        # Don't raise, as we want to continue with the main deletion process

    return files_deleted


def _delete_records(query_sql: str, params: dict, delete_func: Callable, name: str) -> None:
    while True:
        with db.engine.begin() as conn:
            rs = conn.execute(sa.text(query_sql), params)
            if rs.rowcount == 0:
                break

            for i in rs:
                record_id = str(i.id)
                try:
                    delete_func(record_id)
                    db.session.commit()
                    logger.info(click.style(f"Deleted {name} {record_id}", fg="green"))
                except Exception:
                    logger.exception("Error occurred while deleting %s %s", name, record_id)
                    continue
            rs.close()
