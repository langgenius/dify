"""Bind the bearer authenticator at startup. Must run after ext_database
and ext_redis (needs both factories).
"""

from __future__ import annotations

from configs import dify_config
from dify_app import DifyApp
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.oauth_bearer import build_and_bind


def is_enabled() -> bool:
    return dify_config.ENABLE_OAUTH_BEARER


def init_app(app: DifyApp) -> None:
    # scoped_session isn't a context manager; request teardown closes it.
    def session_factory():
        return db.session

    build_and_bind(session_factory=session_factory, redis_client=redis_client)
