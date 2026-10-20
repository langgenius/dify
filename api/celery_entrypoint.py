import psycogreen.gevent as pscycogreen_gevent
from grpc.experimental import gevent as grpc_gevent

# grpc gevent
grpc_gevent.init_gevent()
print("gRPC patched with gevent.", flush=True)  # noqa: T201
pscycogreen_gevent.patch_psycopg()
print("psycopg2 patched with gevent.", flush=True)  # noqa: T201


# Import after gevent patching.
from app import app, celery  # noqa: E402

__all__ = ["app", "celery"]
