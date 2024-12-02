from configs import dify_config
from dify_app import DifyApp


def init_app(app: DifyApp):
    if dify_config.SENTRY_DSN:
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

        sentry_sdk.init(
            dsn=dify_config.SENTRY_DSN,
            integrations=[FlaskIntegration(), CeleryIntegration()],
            ignore_errors=[
                HTTPException,
                ValueError,
                openai.APIStatusError,
                InvokeRateLimitError,
                parse_error.defaultErrorResponse,
            ],
            traces_sample_rate=dify_config.SENTRY_TRACES_SAMPLE_RATE,
            profiles_sample_rate=dify_config.SENTRY_PROFILES_SAMPLE_RATE,
            environment=dify_config.DEPLOY_ENV,
            release=f"dify-{dify_config.CURRENT_VERSION}-{dify_config.COMMIT_SHA}",
            before_send=before_send,
        )
