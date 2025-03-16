import json
import time
import uuid
from datetime import datetime
from typing import Optional

import app
import click
from configs import dify_config
from core.app.entities.app_invoke_entities import InvokeFrom
from models.model import App, EndUser, Message, db
from services.app_generate_service import AppGenerateService
from sqlalchemy import and_, asc, desc, func, or_


@app.celery.task(queue="dataset")
def user_profile_generate_task():
    """Generate or update user memory based on recent messages."""

    click.echo(click.style("Starting user memory generate task.", fg="green"))
    start_at = time.perf_counter()

    app_ids = (
        dify_config.NEED_USER_PROFILE_GENERATION_APP_IDS.split(",")
        if dify_config.NEED_USER_PROFILE_GENERATION_APP_IDS
        else [dify_config.DEFAULT_APP_ID]
    )

    if len(app_ids) == 0:
        click.echo(click.style("No app_id provided, skipping memory generation.", fg="yellow"))
        return

    for app_id in app_ids:
        if len(app_id) == 0:
            click.echo(click.style(f"Invalid app_id: {app_id}", fg="red"))
            return

    for app_id in app_ids:
        users_to_update = fetch_users_to_update(app_id)
        update_user_profile_for_appid(users_to_update)

    end_at = time.perf_counter()

    click.echo(
        click.style(
            f"Updated memory for app_id {app_ids} users memory. Latency: {end_at - start_at}",
            fg="green",
        )
    )


def update_user_profile_for_appid(users_to_update: list[EndUser]):
    """Update memory for a given app_id."""

    if users_to_update is None or len(users_to_update) == 0:
        click.echo(click.style("No users to update.", fg="green"))
        return

    click.echo(click.style(f"Found {len(users_to_update)} users who need memory updates.", fg="green"))

    updated_users_count = 0
    batch_size = 10

    # Process in batches to avoid memory issues
    for i in range(0, len(users_to_update), batch_size):
        batch = users_to_update[i : i + batch_size]
        try:
            for user in batch:
                new_messages, latest_messages_created_at = fetch_new_messages_for_user(user)
                process_user_memory(user, new_messages)
                process_user_health_summary(user, new_messages)
                user.profile_updated_at = latest_messages_created_at
                updated_users_count += 1

            # Commit after each batch
            db.session.commit()
        except Exception as e:
            user_ids = [user.id for user in batch]
            click.echo(click.style(f"Error updating memory for user {user_ids}: {str(e)}", fg="red"))
            db.session.rollback()


def fetch_users_to_update(app_id: str) -> list[EndUser]:
    """Fetch users to update memory for."""

    latest_message_query = db.session.query(
        Message.from_end_user_id, func.max(Message.created_at).label('latest_message_time')
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

    # Format messages for input - safely handle missing query attributes
    message_texts = []
    for msg in new_messages:
        message_texts.append(f"user: {msg.query}\nassistant: {msg.answer}\n")

    # If no valid messages remain, exit early
    if not message_texts:
        click.echo(click.style(f"No valid message content for user id {user.id}", fg="yellow"))

    return "\n".join(message_texts), new_messages[-1].created_at


def process_user_memory(user: EndUser, new_messages: str):
    """Process a user to update memory."""
    click.echo(click.style(f"Updating memory for user id {user.id}", fg="green"))

    memory_app_id = dify_config.USER_MEMORY_GENERATION_APP_ID
    if memory_app_id == "":
        click.echo(click.style("No memory generation app_id provided, skipping memory generation.", fg="yellow"))
        return

    memory_app_model = App.query.filter(App.id == memory_app_id).first()
    if memory_app_model is None:
        click.echo(click.style(f"App not found for memory generation app_id {memory_app_id}", fg="yellow"))
        return

    # Set up arguments for memory generation
    args = {
        "inputs": {
            "new_messages": new_messages,
            "current_memory": user.memory or "",
        }
    }

    # Call the memory generation service
    click.echo(click.style(f"Start to generate memory for user {user.id}", fg="green"))
    response = AppGenerateService.generate(
        app_model=memory_app_model, user=user, args=args, invoke_from=InvokeFrom.SCHEDULER, streaming=False
    )

    # Save the updated memory to the user
    if (
        response
        and isinstance(response, dict)
        and "data" in response
        and "outputs" in response["data"]
        and "result" in response["data"]["outputs"]
    ):
        user.memory = response["data"]["outputs"]["result"]
        click.echo(click.style(f"Updated memory for user {user.id}", fg="green"))
    else:
        click.echo(click.style(f"Failed to update memory for user {user.id}, invalid response format", fg="yellow"))

    try:

        if not isinstance(response, dict):
            return

        import json

        result = response["data"]["outputs"]["result"]
        user.memory = result

        click.echo(click.style(f"Updated memory for user {user.id}", fg="green"))
    except Exception as e:
        click.echo(click.style(f"Failed to update memory for user {user.id}, {str(e)}", fg="yellow"))


def process_user_health_summary(user: EndUser, new_messages: str):
    """Process a user to update health status."""
    click.echo(click.style(f"Updating health summary for user id {user.id}", fg="green"))

    health_summary_app_id = dify_config.USER_HEALTH_SUMMARY_GENERATION_APP_ID
    if health_summary_app_id == "":
        click.echo(click.style("No health_summary_app_id provided, skipping health summary generation.", fg="yellow"))
        return

    health_summary_app_model = App.query.filter(App.id == health_summary_app_id).first()
    if health_summary_app_model is None:
        click.echo(
            click.style(f"App not found for health summary generation app_id {health_summary_app_id}", fg="yellow")
        )
        return

    args = {
        "inputs": {
            "name": user.name,
            "profile": user.extra_profile,
            "new_messages": new_messages,
        }
    }

    click.echo(click.style(f"Start to generate health summary for user {user.id}", fg="green"))
    response = AppGenerateService.generate(
        app_model=health_summary_app_model, user=user, args=args, invoke_from=InvokeFrom.SCHEDULER, streaming=False
    )

    try:

        if not isinstance(response, dict):
            return

        import json

        result = response["data"]["outputs"]["result"]
        result = json.loads(result)
        if "health_status" in result:
            user.health_status = result["health_status"]

        if "summary" in result:
            user.summary = result["summary"]

        if "topics" in result and isinstance(result["topics"], list):
            user.topics = result["topics"]

        click.echo(click.style(f"Updated health summary for user {user.id}", fg="green"))

    except json.JSONDecodeError:
        click.echo(click.style(f"Failed to parse health summary for user {user.id}, invalid json format", fg="yellow"))
        return
    except Exception as e:
        click.echo(click.style(f"Failed to update health summary for user {user.id}, {str(e)}", fg="yellow"))
        return
