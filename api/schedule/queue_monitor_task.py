import logging
import re
from datetime import datetime
from urllib.parse import unquote, urlparse

import click
from redis import Redis

import app
from configs import dify_config
from extensions.ext_database import db
from libs.email_i18n import EmailType, get_email_i18n_service


def parse_redis_url_robust(url):
    """
    Robust Redis URL parser that handles special characters in passwords.

    Handles URLs in formats like:
    - redis://password/host:port/db (when password contains special chars like #)
    - redis://user:password@host:port/db (standard format)
    - redis://host:port/db (no password)

    Args:
        url (str): Redis URL to parse

    Returns:
        dict: Parsed components with keys: hostname, port, password, path
    """
    if not url:
        return {"hostname": "localhost", "port": 6379, "password": None, "path": "/1"}

    # Pattern for Redis URL format: redis://password/host:port/db (no @ separator)
    # This handles cases where password contains special characters like #
    pattern = r"redis://([^/]+)/([^:]+):(\d+)/(\d+)$"
    match = re.match(pattern, url)

    if match:
        password, host, port, db = match.groups()
        return {"hostname": host, "port": int(port), "password": password, "path": f"/{db}"}

    # Try standard URL parsing for properly formatted URLs
    try:
        parsed = urlparse(url)
        return {
            "hostname": parsed.hostname,
            "port": parsed.port,
            "password": unquote(parsed.password) if parsed.password else None,
            "path": parsed.path,
        }
    except Exception as e:
        logging.warning("Failed to parse Redis URL: %s, error: %s", url, e)
        return {"hostname": "localhost", "port": 6379, "password": None, "path": "/1"}


# Create a dedicated Redis connection (using the same configuration as Celery)
celery_broker_url = dify_config.CELERY_BROKER_URL

# Use robust parsing to handle special characters in passwords
parsed_result = parse_redis_url_robust(celery_broker_url)
host = parsed_result["hostname"] or "localhost"
port = parsed_result["port"] or 6379
password = parsed_result["password"] or None
redis_db = parsed_result["path"].strip("/") if parsed_result["path"] else "1"

# Log the parsed connection details (without password for security)
logging.info("Redis connection config - host: %s, port: %s, db: %s", host, port, redis_db)

celery_redis = Redis(host=host, port=port, password=password, db=redis_db)


@app.celery.task(queue="monitor")
def queue_monitor_task():
    queue_name = "dataset"
    threshold = dify_config.QUEUE_MONITOR_THRESHOLD

    try:
        queue_length = celery_redis.llen(f"{queue_name}")
        logging.info(click.style(f"Start monitor {queue_name}", fg="green"))
        logging.info(click.style(f"Queue length: {queue_length}", fg="green"))

        if queue_length >= threshold:
            warning_msg = f"Queue {queue_name} task count exceeded the limit.: {queue_length}/{threshold}"
            logging.warning(click.style(warning_msg, fg="red"))
            alter_emails = dify_config.QUEUE_MONITOR_ALERT_EMAILS
            if alter_emails:
                to_list = alter_emails.split(",")
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
                    except Exception as e:
                        logging.exception(click.style("Exception occurred during sending email", fg="red"))

    except Exception as e:
        logging.exception(click.style("Exception occurred during queue monitoring", fg="red"))
    finally:
        if db.session.is_active:
            db.session.close()
