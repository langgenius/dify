import logging

import psycogreen.gevent as pscycogreen_gevent  # type: ignore
from grpc.experimental import gevent as grpc_gevent  # type: ignore

_logger = logging.getLogger(__name__)


def _log(message: str):
    print(message, flush=True)


# grpc gevent
grpc_gevent.init_gevent()
_log("gRPC  patched with gevent.")
pscycogreen_gevent.patch_psycopg()
_log("psycopg2 patched with gevent.")


from app import app, celery

__all__ = ["app", "celery"]
