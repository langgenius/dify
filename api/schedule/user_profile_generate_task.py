import logging
import time
from datetime import datetime

from sqlalchemy import asc, func, or_

import app
from configs import dify_config
from core.app.entities.app_invoke_entities import InvokeFrom
from models.model import App, EndUser, Message, db
from services.app_generate_service import AppGenerateService

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


@app.celery.task(queue="dataset")
def user_profile_generate_task():
    """Generate or update user memory based on recent messages."""

    logger.info("Starting user profile generate task.")
    start_at = time.perf_counter()

    app_ids = (
        dify_config.NEED_USER_PROFILE_GENERATION_APP_IDS.split(",")
        if dify_config.NEED_USER_PROFILE_GENERATION_APP_IDS
        else [dify_config.DEFAULT_APP_ID]
    )

    if len(app_ids) == 0:
        logger.info("No app_id provided, skipping user profile generation.")
        return

    for app_id in app_ids:
        if len(app_id) == 0:
            logger.error(f"Invalid app_id: {app_id}")
            return

    for app_id in app_ids:
        users_to_update = fetch_users_to_update(app_id)

        if users_to_update is None or len(users_to_update) == 0:
            logger.info(f"No users to update. for app_id {app_id}")
            continue

        logger.info(f"Found {len(users_to_update)} users profile and memory updates. in app_id {app_id}")
        update_user_profile_for_appid(users_to_update)

    end_at = time.perf_counter()

    logger.info(f"Finished user profile generate task. Latency: {end_at - start_at}")


def update_user_profile_for_appid(users_to_update: list[EndUser]):
    """Update memory for a given app_id."""

    updated_users_count = 0
    batch_size = 10

    # Process in batches to avoid memory issues
    for i in range(0, len(users_to_update), batch_size):
        batch = users_to_update[i : i + batch_size]
        try:
            for user in batch:
                new_messages, latest_messages_created_at = fetch_new_messages_for_user(user)

                if len(new_messages) > 0:
                    process_user_memory(user, new_messages)
                    process_user_health_summary(user, new_messages)
                    user.profile_updated_at = latest_messages_created_at
                    updated_users_count += 1

            # Commit after each batch
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            user_ids = [user.id for user in batch]
            logger.exception(f"Error updating user profile for user {user_ids}")


def fetch_users_to_update(app_id: str) -> list[EndUser]:
    """Fetch users to update memory for."""

    latest_message_query = db.session.query(
        Message.from_end_user_id,
        func.max(Message.created_at).label("latest_message_time"),
    )

    latest_message_query = latest_message_query.filter(Message.app_id == app_id)
    latest_message_subquery = latest_message_query.group_by(Message.from_end_user_id).subquery()

    # Then join with EndUser to find users who need memory updates
    users_query = (
        db.session.query(EndUser, latest_message_subquery.c.latest_message_time)
        .join(
            latest_message_subquery,
            EndUser.id == latest_message_subquery.c.from_end_user_id,
        )
        .filter(
            EndUser.app_id == app_id,
            or_(
                EndUser.profile_updated_at.is_(None),
                EndUser.profile_updated_at < latest_message_subquery.c.latest_message_time,
            ),
        )
    )

    results = users_query.all()
    # Extract users from the query results (each result is a tuple of (EndUser, latest_message_time))
    users = [result[0] for result in results]

    return users


def fetch_new_messages_for_user(user: EndUser) -> tuple[str, datetime]:
    """Fetch new messages for a user."""

    message_query = db.session.query(Message).filter(Message.from_end_user_id == user.id)
    message_query = message_query.filter(Message.app_id == user.app_id)
    if user.profile_updated_at:
        message_query = message_query.filter(Message.created_at > user.profile_updated_at)
    new_messages = message_query.order_by(asc(Message.created_at)).all()

    if len(new_messages) == 0:
        logger.warning(f"No new messages for user id {user.id}")
        return "", datetime.now()

    # Format messages for input - safely handle missing query attributes
    message_texts = []
    for msg in new_messages:
        message_texts.append(f"user: {msg.query}\nassistant: {msg.answer}\n")

    return "\n".join(message_texts), new_messages[-1].created_at


def process_user_memory(user: EndUser, new_messages: str):
    """Process a user to update memory."""
    logger.info(f"Updating memory for user id {user.id}")

    memory_app_id = dify_config.USER_MEMORY_GENERATION_APP_ID
    if memory_app_id == "":
        logger.warning("No memory generation app_id provided, skipping memory generation.")
        return

    memory_app_model = db.session.query(App).filter(App.id == memory_app_id).first()
    if memory_app_model is None:
        logger.error(f"App not found for memory generation app_id {memory_app_id}")
        return

    # Set up arguments for memory generation
    args = {
        "inputs": {
            "new_messages": new_messages,
            "current_memory": user.memory or "",
            "name": user.name,
            "profile": user.profile,
        }
    }

    response = AppGenerateService.generate(
        app_model=memory_app_model,
        user=user,
        args=args,
        invoke_from=InvokeFrom.SERVICE_API,
        streaming=False,
    )

    logger.info(f"Generated memory raw response for user {user.id}: {response}")

    if not isinstance(response, dict):
        return

    result = response["data"]["outputs"]["result"]
    user.memory = result

    logger.info(f"Successfully updated memory for user {user.id}")


def process_user_health_summary(user: EndUser, new_messages: str):
    """Process a user to update health status."""
    logger.info(f"Updating health summary for user id {user.id}")

    health_summary_app_id = dify_config.USER_HEALTH_SUMMARY_GENERATION_APP_ID
    if health_summary_app_id == "":
        logger.warning("No health summary app_id provided, skipping health summary generation.")
        return

    health_summary_app_model = db.session.query(App).filter(App.id == health_summary_app_id).first()
    if health_summary_app_model is None:
        logger.error(f"App not found for health summary generation app_id {health_summary_app_id}")
        return

    args = {
        "inputs": {
            "name": user.name,
            "profile": user.profile,
            "new_messages": new_messages,
        }
    }

    logger.info(f"Start to generate health summary for user {user.id}")

    response = AppGenerateService.generate(
        app_model=health_summary_app_model,
        user=user,
        args=args,
        invoke_from=InvokeFrom.SERVICE_API,
        streaming=False,
    )

    logger.info(f"Generated health summary raw response for user {user.id}: {response}")

    if not isinstance(response, dict):
        return

    import json

    result = response["data"]["outputs"]["result"]

    if result is None:
        logger.warning(f"Health summary generation failed with None result for user {user.id}")
        return

    # preprocess result in case of ```json xxxx```
    if result.startswith("```json") or result.endswith("```"):
        result = result.strip("```json").strip("```")

    result = json.loads(result)

    if "health_status" in result:
        user.health_status = result["health_status"]

    if "summary" in result:
        user.summary = result["summary"]

    if "topics" in result and isinstance(result["topics"], list):
        user.topics = result["topics"]

    logger.info(f"Successfully updated health summary for user {user.id}")
