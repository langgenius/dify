import openai
import sentry_sdk
from sentry_sdk.integrations.celery import CeleryIntegration
from sentry_sdk.integrations.flask import FlaskIntegration
from werkzeug.exceptions import HTTPException


def init_app(app):
    if app.config.get("SENTRY_DSN"):
        sentry_sdk.init(
            dsn=app.config.get("SENTRY_DSN"),
            integrations=[FlaskIntegration(), CeleryIntegration()],
            ignore_errors=[HTTPException, ValueError, openai.APIStatusError],
            traces_sample_rate=app.config.get("SENTRY_TRACES_SAMPLE_RATE", 1.0),
            profiles_sample_rate=app.config.get("SENTRY_PROFILES_SAMPLE_RATE", 1.0),
            environment=app.config.get("DEPLOY_ENV"),
            release=f"dify-{app.config.get('CURRENT_VERSION')}-{app.config.get('COMMIT_SHA')}",
        )
