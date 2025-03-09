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
def user_memory_generate_task():
    """Generate or update user memory based on recent messages."""

    click.echo(click.style("Starting user memory generate task.", fg="green"))
    start_at = time.perf_counter()

    memory_app_id = dify_config.MEMORY_GENERATION_APP_ID
    if memory_app_id == "":
        click.echo(click.style("No memory generation app_id provided, skipping memory generation.", fg="yellow"))
        return

    app_ids = (
        dify_config.NEED_MEMORY_GENERATION_APP_IDS.split(",")
        if dify_config.NEED_MEMORY_GENERATION_APP_IDS
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
        update_memory_for_appid(app_id, memory_app_id)

    end_at = time.perf_counter()
    click.echo(
        click.style(
            f"Updated memory for app_id {app_ids} users memory. Latency: {end_at - start_at}",
            fg="green",
        )
    )


def update_memory_for_appid(app_id: str, memory_app_id: str):
    """Update memory for a given app_id."""
    users_to_update = fetch_users_to_update(app_id)

    if users_to_update is None or len(users_to_update) == 0:
        click.echo(click.style("No users to update.", fg="green"))
        return

    click.echo(
        click.style(f"Found {len(users_to_update)} users who need memory updates. for app_id {app_id}", fg="green")
    )

    updated_users_count = 0
    batch_size = 10

    # Process in batches to avoid memory issues
    for i in range(0, len(users_to_update), batch_size):
        batch = users_to_update[i : i + batch_size]
        try:
            for user in batch:
                process_user(user, memory_app_id, app_id)
                updated_users_count += 1

            # Commit after each batch
            db.session.commit()
        except Exception as e:
            user_ids = [user.id for user in batch]
            click.echo(click.style(f"Error updating memory for user {user_ids}: {str(e)}", fg="red"))
            db.session.rollback()


def fetch_users_to_update(app_id: str):
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
                EndUser.memory_updated_at.is_(None),
                EndUser.memory_updated_at < latest_message_subquery.c.latest_message_time,
            ),
        )
    )

    results = users_query.all()
    # Extract users from the query results (each result is a tuple of (EndUser, latest_message_time))
    users = [result[0] for result in results]

    return users


def process_user(user: EndUser, memory_app_id: str, app_id: str):
    """Process a user to update memory."""
    click.echo(click.style(f"Updating memory for user id {user.id}", fg="green"))

    memory_app_model = App.query.filter(App.id == memory_app_id).first()
    if memory_app_model is None:
        click.echo(click.style(f"App not found for memory generation app_id {memory_app_id}", fg="yellow"))
        return

    # Get the latest messages efficiently
    message_query = db.session.query(Message).filter(Message.from_end_user_id == user.id)

    # Filter messages by app_id to ensure consistency
    message_query = message_query.filter(Message.app_id == app_id)

    # Only include messages created after the last memory update
    if user.memory_updated_at:
        message_query = message_query.filter(Message.created_at > user.memory_updated_at)

    latest_messages = message_query.order_by(asc(Message.created_at)).limit(10).all()

    # Skip if no messages found (unlikely due to our query, but just to be safe)
    if not latest_messages:
        click.echo(click.style(f"No messages found for user id {user.id}", fg="yellow"))
        return

    click.echo(click.style(f"Found {len(latest_messages)} messages for user id {user.id}", fg="green"))

    # Format messages for input - safely handle missing query attributes
    message_texts = []
    for msg in latest_messages:
        message_texts.append(f"user: {msg.query}\nassistant: {msg.answer}\n")

    # If no valid messages remain, exit early
    if not message_texts:
        click.echo(click.style(f"No valid message content for user id {user.id}", fg="yellow"))
        return

    formatted_messages = "\n".join(message_texts)

    # Set up arguments for memory generation
    args = {
        "inputs": {
            "new_messages": formatted_messages,
            "current_memory": user.memory or "",
        }
    }

    click.echo(click.style(f"Args: {args}", fg="green"))

    # Call the memory generation service
    response = AppGenerateService.generate(
        app_model=memory_app_model, user=user, args=args, invoke_from=InvokeFrom.SCHEDULER, streaming=False
    )

    click.echo(click.style(f"Response: {response}, type: {type(response)}", fg="green"))

    # Save the updated memory to the user
    if (
        response
        and isinstance(response, dict)
        and "data" in response
        and "outputs" in response["data"]
        and "result" in response["data"]["outputs"]
    ):
        user.memory = response["data"]["outputs"]["result"]
        user.memory_updated_at = latest_messages[-1].created_at
        click.echo(click.style(f"Updated memory for user {user.id}", fg="green"))
    else:
        click.echo(click.style(f"Failed to update memory for user {user.id}, invalid response", fg="yellow"))
