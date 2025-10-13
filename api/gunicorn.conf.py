import psycogreen.gevent as pscycogreen_gevent  # type: ignore
from gevent import events as gevent_events
from grpc.experimental import gevent as grpc_gevent  # type: ignore

# NOTE(QuantumGhost): here we cannot use post_fork to patch gRPC, as
# grpc_gevent.init_gevent must be called after patching stdlib.
# Gunicorn calls `post_init` before applying monkey patch.
# Use `post_init` to setup gRPC gevent support would cause deadlock and
# some other weird issues.
#
# ref:
# - https://github.com/grpc/grpc/blob/62533ea13879d6ee95c6fda11ec0826ca822c9dd/src/python/grpcio/grpc/experimental/gevent.py
# - https://github.com/gevent/gevent/issues/2060#issuecomment-3016768668
# - https://github.com/benoitc/gunicorn/blob/master/gunicorn/arbiter.py#L607-L613


def post_patch(event):
    # this function is only called for gevent worker.
    # from gevent docs (https://www.gevent.org/api/gevent.monkey.html):
    # You can also subscribe to the events to provide additional patching beyond what gevent distributes, either for
    # additional standard library modules, or for third-party packages. The suggested time to do this patching is in
    # the subscriber for gevent.events.GeventDidPatchBuiltinModulesEvent.
    if not isinstance(event, gevent_events.GeventDidPatchBuiltinModulesEvent):
        return
    # grpc gevent
    grpc_gevent.init_gevent()
    print("gRPC patched with gevent.", flush=True)  # noqa: T201
    pscycogreen_gevent.patch_psycopg()
    print("psycopg2 patched with gevent.", flush=True)  # noqa: T201


gevent_events.subscribers.append(post_patch)
