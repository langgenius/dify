import datetime
import logging
import time

import click
from sqlalchemy.exc import SQLAlchemyError

import app
from configs import dify_config
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.model import (
    App,
    Message,
    MessageAgentThought,
    MessageAnnotation,
    MessageChain,
    MessageFeedback,
    MessageFile,
)
from models.web import SavedMessage
from services.feature_service import FeatureService

logger = logging.getLogger(__name__)


@app.celery.task(queue="dataset")
def clean_messages():
    click.echo(click.style("Start clean messages.", fg="green"))
    start_at = time.perf_counter()
    plan_sandbox_clean_message_day = datetime.datetime.now() - datetime.timedelta(
        days=dify_config.PLAN_SANDBOX_CLEAN_MESSAGE_DAY_SETTING
    )
    while True:
        try:
            # Main query with join and filter
            messages = (
                db.session.query(Message)
                .where(Message.created_at < plan_sandbox_clean_message_day)
                .order_by(Message.created_at.desc())
                .limit(100)
                .all()
            )

        except SQLAlchemyError:
            raise
        if not messages:
            break
        for message in messages:
            app = db.session.query(App).filter_by(id=message.app_id).first()
            if not app:
                logger.warning(
                    "Expected App record to exist, but none was found, app_id=%s, message_id=%s",
                    message.app_id,
                    message.id,
                )
                continue
            features_cache_key = f"features:{app.tenant_id}"
            plan_cache = redis_client.get(features_cache_key)
            if plan_cache is None:
                features = FeatureService.get_features(app.tenant_id)
                redis_client.setex(features_cache_key, 600, features.billing.subscription.plan)
                plan = features.billing.subscription.plan
            else:
                plan = plan_cache.decode()
            if plan == "sandbox":
                # clean related message
                db.session.query(MessageFeedback).where(MessageFeedback.message_id == message.id).delete(
                    synchronize_session=False
                )
                db.session.query(MessageAnnotation).where(MessageAnnotation.message_id == message.id).delete(
                    synchronize_session=False
                )
                db.session.query(MessageChain).where(MessageChain.message_id == message.id).delete(
                    synchronize_session=False
                )
                db.session.query(MessageAgentThought).where(MessageAgentThought.message_id == message.id).delete(
                    synchronize_session=False
                )
                db.session.query(MessageFile).where(MessageFile.message_id == message.id).delete(
                    synchronize_session=False
                )
                db.session.query(SavedMessage).where(SavedMessage.message_id == message.id).delete(
                    synchronize_session=False
                )
                db.session.query(Message).where(Message.id == message.id).delete()
                db.session.commit()
    end_at = time.perf_counter()
    click.echo(click.style(f"Cleaned messages from db success latency: {end_at - start_at}", fg="green"))
