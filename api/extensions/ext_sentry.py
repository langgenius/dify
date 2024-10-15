import openai
import sentry_sdk
from langfuse import parse_error
from sentry_sdk.integrations.celery import CeleryIntegration
from sentry_sdk.integrations.flask import FlaskIntegration
from werkzeug.exceptions import HTTPException

from core.model_runtime.errors.invoke import InvokeRateLimitError


def before_send(event, hint):
    if "exc_info" in hint:
        exc_type, exc_value, tb = hint["exc_info"]
        if parse_error.defaultErrorResponse in str(exc_value):
            return None

    return event


def init_app(app):
    if app.config.get("SENTRY_DSN"):
        sentry_sdk.init(
            dsn=app.config.get("SENTRY_DSN"),
            integrations=[FlaskIntegration(), CeleryIntegration()],
            ignore_errors=[
                HTTPException,
                ValueError,
                openai.APIStatusError,
                InvokeRateLimitError,
                parse_error.defaultErrorResponse,
            ],
            traces_sample_rate=app.config.get("SENTRY_TRACES_SAMPLE_RATE", 1.0),
            profiles_sample_rate=app.config.get("SENTRY_PROFILES_SAMPLE_RATE", 1.0),
            environment=app.config.get("DEPLOY_ENV"),
            release=f"dify-{app.config.get('CURRENT_VERSION')}-{app.config.get('COMMIT_SHA')}",
            before_send=before_send,
        )
