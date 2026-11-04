from configs import dify_config
from dify_app import DifyApp
from enums import DeploymentEdition


def init_app(app: DifyApp):
    if dify_config.SENTRY_DSN:
        import sentry_sdk
        from sentry_sdk.integrations.celery import CeleryIntegration
        from sentry_sdk.integrations.flask import FlaskIntegration
        from sentry_sdk.integrations.logging import ignore_logger
        from werkzeug.exceptions import HTTPException

        from graphon.model_runtime.errors.invoke import InvokeRateLimitError

        sentry_sdk.init(
            dsn=dify_config.SENTRY_DSN,
            integrations=[FlaskIntegration(), CeleryIntegration()],
            ignore_errors=[
                HTTPException,
                ValueError,
                FileNotFoundError,
                InvokeRateLimitError,
            ],
            traces_sample_rate=dify_config.SENTRY_TRACES_SAMPLE_RATE,
            profiles_sample_rate=dify_config.SENTRY_PROFILES_SAMPLE_RATE,
            environment=dify_config.DEPLOY_ENV,
            release=f"dify-{dify_config.project.version}-{dify_config.COMMIT_SHA}",
        )

        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            # Cloud only. `opentelemetry.context.detach()` catches its own failures and reports
            # them through `logger.exception`, so a double-detach surfaces as an error event
            # rather than as a raised exception. Under gevent this can fire about once per
            # workflow run, which is enough volume to crowd real errors out of the issue stream.
            # Self-hosted deployments rarely see enough of it to be worth silencing, and the
            # records still reach the normal logging handlers either way.
            ignore_logger("opentelemetry.context")
