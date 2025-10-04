import psycogreen.gevent as pscycogreen_gevent  # type: ignore
from grpc.experimental import gevent as grpc_gevent  # type: ignore

# grpc gevent
grpc_gevent.init_gevent()
print("gRPC patched with gevent.", flush=True)  # noqa: T201
pscycogreen_gevent.patch_psycopg()
print("psycopg2 patched with gevent.", flush=True)  # noqa: T201


from app import app, celery

__all__ = ["app", "celery"]
