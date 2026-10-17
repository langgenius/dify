from gevent.monkey import is_module_patched

# Celery patches the stdlib before importing this entrypoint for -P gevent. Prefork workers
# (including the KnowledgeFS local engine) must retain native subprocess, DB and gRPC behavior.
if is_module_patched("socket"):
    import psycogreen.gevent as pscycogreen_gevent
    from grpc.experimental import gevent as grpc_gevent

    grpc_gevent.init_gevent()
    print("gRPC patched with gevent.", flush=True)  # noqa: T201
    pscycogreen_gevent.patch_psycopg()
    print("psycopg2 patched with gevent.", flush=True)  # noqa: T201


from app import app, celery

__all__ = ["app", "celery"]
