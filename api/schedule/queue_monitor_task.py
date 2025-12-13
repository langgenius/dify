import logging
from datetime import datetime

import click
from kombu.utils.url import parse_url  # type: ignore
from redis import Redis

import app
from configs import dify_config
from extensions.ext_database import db
from libs.email_i18n import EmailType, get_email_i18n_service

redis_config = parse_url(dify_config.CELERY_BROKER_URL)
celery_redis = Redis(
    host=redis_config.get("hostname") or "localhost",
    port=redis_config.get("port") or 6379,
    password=redis_config.get("password") or None,
    db=int(redis_config.get("virtual_host")) if redis_config.get("virtual_host") else 1,
    ssl=bool(dify_config.BROKER_USE_SSL),
    ssl_ca_certs=dify_config.REDIS_SSL_CA_CERTS if dify_config.BROKER_USE_SSL else None,
    ssl_cert_reqs=getattr(dify_config, "REDIS_SSL_CERT_REQS", None) if dify_config.BROKER_USE_SSL else None,
    ssl_certfile=getattr(dify_config, "REDIS_SSL_CERTFILE", None) if dify_config.BROKER_USE_SSL else None,
    ssl_keyfile=getattr(dify_config, "REDIS_SSL_KEYFILE", None) if dify_config.BROKER_USE_SSL else None,
)

logger = logging.getLogger(__name__)


@app.celery.task(queue="monitor")
def queue_monitor_task():
    queue_name = "dataset"
    threshold = dify_config.QUEUE_MONITOR_THRESHOLD

    if threshold is None:
        logger.warning(click.style("QUEUE_MONITOR_THRESHOLD is not configured, skipping monitoring", fg="yellow"))
        return

    try:
        queue_length = celery_redis.llen(f"{queue_name}")
        logger.info(click.style(f"Start monitor {queue_name}", fg="green"))

        if queue_length is None:
            logger.error(
                click.style(f"Failed to get queue length for {queue_name} - Redis may be unavailable", fg="red")
            )
            return

        logger.info(click.style(f"Queue length: {queue_length}", fg="green"))

        if queue_length >= threshold:
            warning_msg = f"Queue {queue_name} task count exceeded the limit.: {queue_length}/{threshold}"
            logging.warning(click.style(warning_msg, fg="red"))
            alert_emails = dify_config.QUEUE_MONITOR_ALERT_EMAILS
            if alert_emails:
                to_list = alert_emails.split(",")
                email_service = get_email_i18n_service()
                for to in to_list:
                    try:
                        current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        email_service.send_email(
                            email_type=EmailType.QUEUE_MONITOR_ALERT,
                            language_code="en-US",
                            to=to,
                            template_context={
                                "queue_name": queue_name,
                                "queue_length": queue_length,
                                "threshold": threshold,
                                "alert_time": current_time,
                            },
                        )
                    except Exception:
                        logger.exception(click.style("Exception occurred during sending email", fg="red"))

    except Exception:
        logger.exception(click.style("Exception occurred during queue monitoring", fg="red"))
    finally:
        if db.session.is_active:
            db.session.close()
