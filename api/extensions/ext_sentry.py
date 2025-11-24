from configs import dify_config
from dify_app import DifyApp


def init_app(app: DifyApp):
    if dify_config.SENTRY_DSN:
        import sentry_sdk
        from langfuse import parse_error
        from sentry_sdk.integrations.celery import CeleryIntegration
        from sentry_sdk.integrations.flask import FlaskIntegration
        from werkzeug.exceptions import HTTPException

        from core.model_runtime.errors.invoke import InvokeRateLimitError

        def before_send(event, hint):
            if "exc_info" in hint:
                _, exc_value, _ = hint["exc_info"]
                if parse_error.defaultErrorResponse in str(exc_value):
                    return None

            return event

        sentry_sdk.init(
            dsn=dify_config.SENTRY_DSN,
            integrations=[FlaskIntegration(), CeleryIntegration()],
            ignore_errors=[
                HTTPException,
                ValueError,
                FileNotFoundError,
                InvokeRateLimitError,
                parse_error.defaultErrorResponse,
            ],
            traces_sample_rate=dify_config.SENTRY_TRACES_SAMPLE_RATE,
            profiles_sample_rate=dify_config.SENTRY_PROFILES_SAMPLE_RATE,
            environment=dify_config.DEPLOY_ENV,
            release=f"dify-{dify_config.project.version}-{dify_config.COMMIT_SHA}",
            before_send=before_send,
        )
