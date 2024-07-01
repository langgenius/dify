import logging
import time

import click
from celery import shared_task
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from extensions.ext_database import db
from models.dataset import AppDatasetJoin
from models.model import (
    ApiToken,
    AppAnnotationHitHistory,
    AppAnnotationSetting,
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
)
from models.tools import WorkflowToolProvider
from models.web import PinnedConversation, SavedMessage
from models.workflow import Workflow, WorkflowAppLog, WorkflowNodeExecution, WorkflowRun


@shared_task(queue='app_deletion', bind=True, max_retries=3)
def remove_app_and_related_data_task(self, app_id: str):
    logging.info(click.style(f'Start deleting app and related data: {app_id}', fg='green'))
    start_at = time.perf_counter()
    try:
        # Use a transaction to ensure all deletions succeed or none do
        with db.session.begin_nested():
            # Delete related data
            _delete_app_model_configs(app_id)
            _delete_app_site(app_id)
            _delete_app_api_tokens(app_id)
            _delete_installed_apps(app_id)
            _delete_recommended_apps(app_id)
            _delete_app_annotation_data(app_id)
            _delete_app_dataset_joins(app_id)
            _delete_app_workflows(app_id)
            _delete_app_conversations(app_id)
            _delete_app_messages(app_id)
            _delete_workflow_tool_providers(app_id)
            _delete_app_tag_bindings(app_id)
            _delete_end_users(app_id)

        # If we reach here, the transaction was successful
        db.session.commit()

        end_at = time.perf_counter()
        logging.info(click.style(f'App and related data deleted: {app_id} latency: {end_at - start_at}', fg='green'))

    except SQLAlchemyError as e:
        db.session.rollback()
        logging.exception(
            click.style(f"Database error occurred while deleting app {app_id} and related data", fg='red'))
        raise self.retry(exc=e, countdown=60)  # Retry after 60 seconds

    except Exception as e:
        logging.exception(click.style(f"Error occurred while deleting app {app_id} and related data", fg='red'))
        raise self.retry(exc=e, countdown=60)  # Retry after 60 seconds


def _delete_app_model_configs(app_id: str):
    db.session.query(AppModelConfig).filter(AppModelConfig.app_id == app_id).delete()


def _delete_app_site(app_id: str):
    db.session.query(Site).filter(Site.app_id == app_id).delete()


def _delete_app_api_tokens(app_id: str):
    db.session.query(ApiToken).filter(ApiToken.app_id == app_id).delete()


def _delete_installed_apps(app_id: str):
    db.session.query(InstalledApp).filter(InstalledApp.app_id == app_id).delete()


def _delete_recommended_apps(app_id: str):
    db.session.query(RecommendedApp).filter(RecommendedApp.app_id == app_id).delete()


def _delete_app_annotation_data(app_id: str):
    db.session.query(AppAnnotationHitHistory).filter(AppAnnotationHitHistory.app_id == app_id).delete()
    db.session.query(AppAnnotationSetting).filter(AppAnnotationSetting.app_id == app_id).delete()


def _delete_app_dataset_joins(app_id: str):
    db.session.query(AppDatasetJoin).filter(AppDatasetJoin.app_id == app_id).delete()


def _delete_app_workflows(app_id: str):
    db.session.query(WorkflowRun).filter(
        WorkflowRun.workflow_id.in_(
            db.session.query(Workflow.id).filter(Workflow.app_id == app_id)
        )
    ).delete(synchronize_session=False)
    db.session.query(WorkflowNodeExecution).filter(
        WorkflowNodeExecution.workflow_id.in_(
            db.session.query(Workflow.id).filter(Workflow.app_id == app_id)
        )
    ).delete(synchronize_session=False)
    db.session.query(WorkflowAppLog).filter(WorkflowAppLog.app_id == app_id).delete(synchronize_session=False)
    db.session.query(Workflow).filter(Workflow.app_id == app_id).delete(synchronize_session=False)


def _delete_app_conversations(app_id: str):
    db.session.query(PinnedConversation).filter(
        PinnedConversation.conversation_id.in_(
            db.session.query(Conversation.id).filter(Conversation.app_id == app_id)
        )
    ).delete(synchronize_session=False)
    db.session.query(Conversation).filter(Conversation.app_id == app_id).delete()


def _delete_app_messages(app_id: str):
    message_ids = select(Message.id).filter(Message.app_id == app_id).scalar_subquery()
    db.session.query(MessageFeedback).filter(MessageFeedback.message_id.in_(message_ids)).delete(
        synchronize_session=False)
    db.session.query(MessageAnnotation).filter(MessageAnnotation.message_id.in_(message_ids)).delete(
        synchronize_session=False)
    db.session.query(MessageChain).filter(MessageChain.message_id.in_(message_ids)).delete(synchronize_session=False)
    db.session.query(MessageAgentThought).filter(MessageAgentThought.message_id.in_(message_ids)).delete(
        synchronize_session=False)
    db.session.query(MessageFile).filter(MessageFile.message_id.in_(message_ids)).delete(synchronize_session=False)
    db.session.query(SavedMessage).filter(SavedMessage.message_id.in_(message_ids)).delete(synchronize_session=False)
    db.session.query(Message).filter(Message.app_id == app_id).delete(synchronize_session=False)


def _delete_workflow_tool_providers(app_id: str):
    db.session.query(WorkflowToolProvider).filter(
        WorkflowToolProvider.app_id == app_id
    ).delete(synchronize_session=False)


def _delete_app_tag_bindings(app_id: str):
    db.session.query(TagBinding).filter(
        TagBinding.target_id == app_id
    ).delete(synchronize_session=False)


def _delete_end_users(app_id: str):
    db.session.query(EndUser).filter(EndUser.app_id == app_id).delete()
